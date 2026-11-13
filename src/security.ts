import nodeCrypto from "node:crypto";
import type { AppEnv } from "./env_types";

const ALLOWED_STATIC_ORIGINS = new Set([
  "https://aistudio.google.com",
]);

const EXACT_CLOUD_RUN_HOST_RE =
  /^(?:[a-z0-9-]+-853813963450|ais-(?:dev|pre)-[a-z0-9-]+-73428471351)\.[a-z0-9-]+\.run\.app$/;

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{16,}/g,
  /\bAQ\.[0-9A-Za-z._-]{16,}/g,
  /ya29\.[0-9A-Za-z._-]+/g,
  /(x-goog-api-key\s*[:=]\s*)([^\s"',;}\]]+)/gi,
  /([?&](?:key|api_key|token|secret)=)([^&\s"'#]+)/gi,
  /(Bearer\s+)([0-9A-Za-z._~+/=-]+)/gi,
];

let runtimeHmacSecret: string | null = null;

function getRuntimeHmacSecret(env?: AppEnv): string {
  const configured = env?.CREATOR_HMAC_SECRET?.trim();
  if (configured) return configured;
  if (!runtimeHmacSecret) {
    // Derive a deterministic per-token secret if HERMES_AGENT_TOKEN exists so restarts keep
    // visitor cookies valid, otherwise generate a cryptographic random 256-bit key.
    const seed = env?.HERMES_AGENT_TOKEN?.trim();
    if (seed) {
      runtimeHmacSecret = nodeCrypto
        .createHmac("sha256", "geminisland-visitor-hmac-v1")
        .update(seed)
        .digest("hex");
    } else {
      runtimeHmacSecret = nodeCrypto.randomBytes(32).toString("hex");
    }
  }
  return runtimeHmacSecret || "fallback-secret";
}

/**
 * Scrubs any API keys, HMAC secrets, Bearer tokens, or Google key patterns from strings/errors
 * before logging, throwing, or storing diagnostic notes.
 */
export function redactSecrets(
  input: unknown,
  extraSecrets: readonly (string | undefined | null)[] = [],
): string {
  let raw = "";
  if (input instanceof Error) {
    raw = `${input.name}: ${input.message}`;
  } else if (typeof input === "string") {
    raw = input;
  } else {
    try {
      raw = JSON.stringify(input) ?? String(input);
    } catch {
      raw = String(input);
    }
  }

  let out = raw;
  for (const s of extraSecrets) {
    if (typeof s === "string" && s.trim().length >= 8) {
      const trimmed = s.trim();
      out = out.split(trimmed).join("[REDACTED]");
      const encoded = encodeURIComponent(trimmed);
      if (encoded !== trimmed) {
        out = out.split(encoded).join("[REDACTED]");
      }
    }
  }

  out = out.replace(SECRET_PATTERNS[0], "[REDACTED_GCP_KEY]");
  out = out.replace(SECRET_PATTERNS[1], "[REDACTED_GCP_KEY]");
  out = out.replace(SECRET_PATTERNS[2], "[REDACTED_TOKEN]");
  out = out.replace(SECRET_PATTERNS[3], "$1[REDACTED]");
  out = out.replace(SECRET_PATTERNS[4], "$1[REDACTED]");
  out = out.replace(SECRET_PATTERNS[5], "$1[REDACTED]");

  return out.slice(0, 400);
}

export function safeLogError(
  context: string,
  err: unknown,
  extraSecrets: readonly (string | undefined | null)[] = [],
): void {
  console.error(
    JSON.stringify({
      level: "error",
      context,
      error: redactSecrets(err, extraSecrets),
      ts: Date.now(),
    }),
  );
}

export function safeLogWarn(
  context: string,
  detail: unknown,
  extraSecrets: readonly (string | undefined | null)[] = [],
): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      context,
      detail: redactSecrets(detail, extraSecrets),
      ts: Date.now(),
    }),
  );
}

export function isAllowedAppletOrigin(origin: string): boolean {
  if (!origin || origin === "null") {
    return false;
  }
  if (ALLOWED_STATIC_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "ai.studio" ||
      hostname.endsWith(".ai.studio") ||
      EXACT_CLOUD_RUN_HOST_RE.test(hostname)
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Enforces CSRF custom header (`X-Meadow-Client: 1` + JSON Content-Type) and strict
 * Origin / Sec-Fetch-Site verification on state-mutating POST requests.
 */
export function verifyMutationSecurity(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    if (!isAllowedAppletOrigin(origin)) {
      return "Invalid request origin.";
    }
  } else {
    const secFetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
    if (secFetchSite !== "same-origin") {
      return "Missing or disallowed request origin.";
    }
  }

  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return "Expected application/json content-type.";
  }

  if (request.headers.get("X-Meadow-Client") !== "1") {
    return "Missing required client security header.";
  }

  return null;
}

/**
 * Protects `/ws` from Cross-Site WebSocket Hijacking with strict Origin / Sec-Fetch-Site validation.
 */
export function verifyWebSocketOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    if (!isAllowedAppletOrigin(origin)) {
      return "Disallowed WebSocket Origin.";
    }
    return null;
  }
  const secFetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (secFetchSite !== "same-origin") {
    return "Missing or disallowed WebSocket Origin.";
  }
  return null;
}

export function normalizeClientIp(rawIp: string): string {
  const firstHop = rawIp.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!firstHop) return "0.0.0.0";

  if (firstHop.startsWith("::ffff:") && firstHop.includes(".")) {
    return firstHop.slice(7);
  }

  if (!firstHop.includes(":")) {
    return firstHop;
  }

  const zoneStripped = firstHop.split("%")[0];
  const parts = zoneStripped.split("::");
  if (parts.length > 2) return zoneStripped;

  const left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];
  const missing = Math.max(0, 8 - (left.length + right.length));
  const full = [...left, ...Array(missing).fill("0000"), ...right].slice(0, 8);
  const prefix64 = full
    .slice(0, 4)
    .map((h) => h.padStart(4, "0"))
    .join(":");
  return `${prefix64}::/64`;
}

function hmacSha256Hex(secret: string, message: string): string {
  return nodeCrypto.createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqualStrings(a: string, b: string): boolean {
  const digestA = nodeCrypto.createHmac("sha256", "cmp").update(a).digest();
  const digestB = nodeCrypto.createHmac("sha256", "cmp").update(b).digest();
  return nodeCrypto.timingSafeEqual(digestA, digestB);
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header || header.length > 4096) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k || k === "__proto__" || k === "constructor" || k === "prototype") continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

const PARTITIONED_COOKIE_NAME = "meadow_cid_p";
const LEGACY_COOKIE_NAME = "meadow_cid";
const CID_RE = /^[0-9a-f]{24,40}$/;
const SIG_RE = /^[0-9a-f]{28,64}$/;

export function formatDayKeyInTz(nowMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowMs));
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowMs));
  }
}

function resolveVisitorDayKey(request: Request): string {
  const clientTz = request.headers.get("X-Meadow-Tz")?.trim();
  const tz = clientTz && clientTz.includes("/") ? clientTz : "Australia/Sydney";
  return formatDayKeyInTz(Date.now(), tz);
}

export async function resolveVisitorIdentity(
  request: Request,
  env: AppEnv,
): Promise<{
  ipHash: string;
  cookieId: string;
  dayKey: string;
  visitorToken: string;
  setCookieHeader?: string;
}> {
  const isHttps =
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";
  const secret = getRuntimeHmacSecret(env);

  const dayKey = resolveVisitorDayKey(request);
  const rawIp =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("cf-connecting-ip") ||
    "127.0.0.1";

  const normalizedIp = normalizeClientIp(rawIp);
  const ipHash = hmacSha256Hex(secret, `ip:${normalizedIp}`).slice(0, 32);

  const cookies = parseCookies(request.headers.get("Cookie"));
  const headerToken = request.headers.get("X-Meadow-Visitor")?.trim();
  const candidates = [
    headerToken,
    cookies[PARTITIONED_COOKIE_NAME],
    cookies[LEGACY_COOKIE_NAME],
  ].filter((v): v is string => typeof v === "string" && v.includes("."));

  for (const token of candidates) {
    const dotIdx = token.indexOf(".");
    const cid = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    if (!CID_RE.test(cid) || !SIG_RE.test(sig)) continue;
    const expectedFull = hmacSha256Hex(secret, `cid:${cid}`);
    const expected = sig.length === 28 ? expectedFull.slice(0, 28) : expectedFull.slice(0, 32);
    if (safeEqualStrings(sig, expected)) {
      const canonicalToken = `${cid}.${expectedFull.slice(0, 32)}`;
      return {
        ipHash,
        cookieId: cid,
        dayKey,
        visitorToken: canonicalToken,
      };
    }
  }

  const freshCid = nodeCrypto.randomUUID().replace(/-/g, "");
  const freshSig = hmacSha256Hex(secret, `cid:${freshCid}`).slice(0, 32);
  const signedVal = `${freshCid}.${freshSig}`;
  const setCookieHeader = isHttps
    ? `${PARTITIONED_COOKIE_NAME}=${signedVal}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=None; Partitioned`
    : `${LEGACY_COOKIE_NAME}=${signedVal}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;

  return {
    ipHash,
    cookieId: freshCid,
    dayKey,
    visitorToken: signedVal,
    setCookieHeader,
  };
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes = 5_000_000,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, status: 413, error: "Request payload is too large." };
  }
  if (!request.body) {
    return { ok: false, status: 400, error: "Empty request body." };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, status: 413, error: "Request payload exceeds size limit." };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, status: 400, error: "Could not read request stream." };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const ch of chunks) {
    merged.set(ch, offset);
    offset += ch.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(merged);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "Expected a JSON object." };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON request body." };
  }
}

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function validateImageDataUrl(
  raw: unknown,
): { ok: true; mimeType?: string; base64?: string } | { ok: false; status: number; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true };
  }
  if (typeof raw !== "string" || !raw.startsWith("data:image/")) {
    return { ok: false, status: 400, error: "Unsupported image format — please upload a JPG, PNG, or WebP." };
  }

  const commaIdx = raw.indexOf(",");
  if (commaIdx === -1 || commaIdx > 64) {
    return { ok: false, status: 400, error: "Malformed image data URL." };
  }

  const meta = raw.slice(5, commaIdx).toLowerCase();
  const parts = meta.split(";").map((s) => s.trim());
  const mimeType = parts[0] || "";
  if (!ALLOWED_IMAGE_MIMES.has(mimeType) || !parts.includes("base64")) {
    return { ok: false, status: 415, error: "Only base64-encoded JPEG, PNG, or WebP images are supported." };
  }

  const b64 = raw.slice(commaIdx + 1).replace(/\s+/g, "");
  if (b64.length < 32) {
    return { ok: false, status: 400, error: "Image data is empty or truncated." };
  }
  if (b64.length > 4_500_000) {
    return { ok: false, status: 413, error: "Image is too large — please use an image under 3.3 MB." };
  }
  if (b64.length % 4 !== 0 || !BASE64_BODY_RE.test(b64)) {
    return { ok: false, status: 400, error: "Invalid base64 image encoding." };
  }

  let headerBytes: Uint8Array;
  try {
    headerBytes = new Uint8Array(Buffer.from(b64.slice(0, 24), "base64"));
  } catch {
    return { ok: false, status: 400, error: "Corrupted image header." };
  }

  const isJpeg =
    mimeType === "image/jpeg" &&
    headerBytes[0] === 0xff &&
    headerBytes[1] === 0xd8 &&
    headerBytes[2] === 0xff;
  const isPng =
    mimeType === "image/png" &&
    headerBytes[0] === 0x89 &&
    headerBytes[1] === 0x50 &&
    headerBytes[2] === 0x4e &&
    headerBytes[3] === 0x47 &&
    headerBytes[4] === 0x0d &&
    headerBytes[5] === 0x0a &&
    headerBytes[6] === 0x1a &&
    headerBytes[7] === 0x0a;
  const isWebp =
    mimeType === "image/webp" &&
    headerBytes[0] === 0x52 &&
    headerBytes[1] === 0x49 &&
    headerBytes[2] === 0x46 &&
    headerBytes[3] === 0x46 &&
    headerBytes[8] === 0x57 &&
    headerBytes[9] === 0x45 &&
    headerBytes[10] === 0x42 &&
    headerBytes[11] === 0x50;

  if (!isJpeg && !isPng && !isWebp) {
    return { ok: false, status: 415, error: "Image contents do not match JPEG, PNG, or WebP header." };
  }

  return { ok: true, mimeType, base64: b64 };
}

export function sanitizePlainText(raw: unknown, maxLen: number, stripUrls = false): string {
  if (typeof raw !== "string") return "";
  let s = raw
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripUrls) {
    s = s.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
  }
  return s.slice(0, maxLen);
}

/**
 * Security headers compatible with AI Studio's preview iframe (`aistudio.google.com` -> `*.usercontent.goog`).
 * Intentionally omits `X-Frame-Options: DENY` and `frame-ancestors 'none'` so AI Studio can embed the applet.
 */
export function buildSecurityHeaders(_isHttps: boolean): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

import nodeCrypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { redactSecrets, safeLogWarn } from "./security";

export function createGeminiSdkClient(apiKey?: string): GoogleGenAI {
  const resolvedKey = apiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
  return new GoogleGenAI({
    apiKey: resolvedKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export type GeminiCallMode = "sculpt" | "critic" | "director";

export interface GeminiAttemptRecord {
  model: string;
  ok: boolean;
  ms: number;
  firstChunkMs?: number;
  reason?: string;
}

/**
 * Complete Hydrogen model family discovered on `generativelanguage.googleapis.com/v1beta/models`.
 * Ordered by empirical live availability, 3D voxel blueprint fidelity & SSE first-chunk latency:
 *  - `hydrogen-l`: latest Hydrogen release (~2.3s first SSE thought chunk, ~18–24s full 3D voxel blueprint)
 *  - `gemini-4-hydrogen`: Gemini 4 Hydrogen alias
 */
export const DEFAULT_HYDROGEN_MODELS = [
  "hydrogen-l",
  "gemini-4-hydrogen",
] as const;

export const DEFAULT_ARGON_MODELS = ["gemini-4-argon"] as const;

export const DEFAULT_GEMINI_SAFETY_NET_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
] as const;

const MODEL_ID_RE = /^[a-zA-Z0-9._-]+$/;
const HYDROGEN_MODEL_RE = /^(?:hydrogen|gemini-[0-9.]+-hydrogen)(?:$|[-_.])/i;
const MODERN_NO_BUDGET_MODEL_RE = /^gemini-(?:4|3\.8)(?:$|[-_.])/i;
const SPECULATIVE_HYDROGEN_RE = /^(?:hydrogen-(?:[fghjk](?:$|[-_.])|.*(?:preview|exp))|gemini-[0-9.]+-hydrogen)/i;

export function isHydrogenModel(model: string): boolean {
  const clean = String(model ?? "").trim().replace(/^models\//, "");
  return HYDROGEN_MODEL_RE.test(clean);
}

function isModernNoBudgetModel(model: string): boolean {
  const clean = String(model ?? "").trim().replace(/^models\//, "");
  return MODERN_NO_BUDGET_MODEL_RE.test(clean);
}

interface ModelHealthEntry {
  cooldownUntil: number;
  hardUnavailable: boolean;
  consecutiveFailures: number;
  lastReason: string;
}

// Bounded primitive-only per-isolate circuit-breaker health map (never stores secrets or I/O handles)
const modelHealthMap = new Map<string, ModelHealthEntry>();
const MAX_HEALTH_ENTRIES = 128;

interface DiscoveredHydrogenCache {
  keyHash: string;
  models: string[];
  allModels: Set<string>;
  fetchedAt: number;
}
let discoveredHydrogenCache: DiscoveredHydrogenCache | null = null;
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;

function fingerprintApiKey(apiKey: string): string {
  return nodeCrypto.createHash("sha256").update(apiKey || "").digest("hex").slice(0, 16);
}

export function resetModelHealthForTesting(): void {
  modelHealthMap.clear();
  discoveredHydrogenCache = null;
}

function recordModelSuccess(model: string): void {
  modelHealthMap.delete(model);
}

function recordModelFailure(model: string, httpStatus: number | undefined, reason: string): void {
  const now = Date.now();
  if (modelHealthMap.size >= MAX_HEALTH_ENTRIES && !modelHealthMap.has(model)) {
    for (const [k, v] of modelHealthMap.entries()) {
      if (v.cooldownUntil <= now) modelHealthMap.delete(k);
    }
    if (modelHealthMap.size >= MAX_HEALTH_ENTRIES) {
      const oldestKey = modelHealthMap.keys().next().value;
      if (oldestKey) modelHealthMap.delete(oldestKey);
    }
  }

  const prev = modelHealthMap.get(model);
  const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1;
  const isNotFoundOrDenied =
    httpStatus === 404 ||
    httpStatus === 403 ||
    /model not found|not_found|permission_denied|not supported for generatecontent/i.test(reason);
  const isOverloadedOrTimeout =
    httpStatus === 429 ||
    httpStatus === 503 ||
    httpStatus === 529 ||
    /FirstByteTimeout|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand|overloaded/i.test(reason);

  let cooldownMs = 8_000;
  if (isNotFoundOrDenied) {
    cooldownMs = 10 * 60_000;
  } else if (isOverloadedOrTimeout) {
    cooldownMs = Math.min(60_000, 20_000 * Math.min(3, consecutiveFailures));
  } else if (httpStatus && httpStatus >= 500) {
    cooldownMs = 14_000;
  }

  modelHealthMap.set(model, {
    cooldownUntil: now + cooldownMs,
    hardUnavailable: isNotFoundOrDenied,
    consecutiveFailures,
    lastReason: reason.slice(0, 120),
  });
}

function orderTierByHealth(models: readonly string[], now: number): string[] {
  const healthy: string[] = [];
  const softCooled: string[] = [];
  const hardCooled: string[] = [];

  for (const m of models) {
    const h = modelHealthMap.get(m);
    if (!h || h.cooldownUntil <= now) {
      healthy.push(m);
    } else if (h.hardUnavailable) {
      hardCooled.push(m);
    } else {
      softCooled.push(m);
    }
  }

  // Always try healthy endpoints first, then soft-cooled (503/429/timeout) endpoints, and only
  // re-probe hard-404 endpoints if no healthy or soft-cooled endpoints exist in the tier.
  if (healthy.length > 0 || softCooled.length > 0) {
    return [...healthy, ...softCooled];
  }
  return [...hardCooled];
}

export function parseModelList(raw?: string | readonly string[] | null): string[] {
  if (!raw) return [];
  const items = typeof raw === "string" ? raw.split(",") : raw;
  const out: string[] = [];
  for (const item of items) {
    const clean = String(item ?? "").trim().replace(/^models\//, "");
    if (clean && MODEL_ID_RE.test(clean)) {
      out.push(clean);
    }
  }
  return out;
}

function rankHydrogenModelId(id: string): [number, number, string] {
  // Sort newest generation token descending (e.g. hydrogen-z .. hydrogen-m > hydrogen-l > hydrogen-j > hydrogen-g > hydrogen-f)
  const lower = id.toLowerCase();
  const m = lower.match(/^hydrogen-([a-z0-9]+)(?:-(.*))?$/);
  if (!m) return [0, 0, lower];
  const gen = m[1];
  const suffix = m[2] ?? "";
  let genScore = 0;
  for (let i = 0; i < Math.min(gen.length, 4); i++) {
    genScore = genScore * 40 + Math.max(1, gen.charCodeAt(i) - 47);
  }
  // Prefer base model (`hydrogen-l`) first, then mid/high effort pools (`0p70`, `1p00`, `0p50`, `0p30`, `0p10`)
  let variantRank = 50;
  if (!suffix) variantRank = 100;
  else if (suffix === "high-0p70") variantRank = 92;
  else if (suffix === "high-1p00") variantRank = 90;
  else if (suffix === "high-0p50") variantRank = 86;
  else if (suffix === "high-0p30") variantRank = 82;
  else if (suffix === "high-0p10") variantRank = 78;
  else if (/preview|exp|launch-prep/.test(suffix)) variantRank = 20;
  return [genScore, variantRank, lower];
}

export function sortHydrogenModelsLatestFirst(models: readonly string[]): string[] {
  return [...models].sort((a, b) => {
    const ra = rankHydrogenModelId(a);
    const rb = rankHydrogenModelId(b);
    if (rb[0] !== ra[0]) return rb[0] - ra[0];
    if (rb[1] !== ra[1]) return rb[1] - ra[1];
    return ra[2].localeCompare(rb[2]);
  });
}

/**
 * Queries the Gemini API model catalog via `@google/genai` (`ai.models.list`) with an HTTP fallback
 * to dynamically discover all `hydrogen*` models AND all supported `generateContent` models on
 * `process.env.GEMINI_API_KEY`. Cached for 5 minutes per runtime.
 */
async function discoverModelCatalogFromApi(
  apiKey: string,
  opts?: { forceRefresh?: boolean },
): Promise<{ hydrogenModels: string[]; allModels: Set<string> }> {
  const now = Date.now();
  const keyHash = fingerprintApiKey(apiKey);
  if (
    !opts?.forceRefresh &&
    discoveredHydrogenCache &&
    discoveredHydrogenCache.keyHash === keyHash &&
    now - discoveredHydrogenCache.fetchedAt < DISCOVERY_CACHE_TTL_MS
  ) {
    return {
      hydrogenModels: discoveredHydrogenCache.models,
      allModels: discoveredHydrogenCache.allModels,
    };
  }

  const allFound = new Set<string>();
  const hydrogenFound = new Set<string>();

  try {
    const ai = createGeminiSdkClient(apiKey);
    const pagerPromise = ai.models.list({ config: { pageSize: 250 } });
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_800));
    const pager = await Promise.race([pagerPromise, timeoutPromise]);
    if (pager) {
      for (const entry of pager.page ?? []) {
        const clean = String(entry?.name ?? "").trim().replace(/^models\//, "");
        if (!clean || !MODEL_ID_RE.test(clean)) continue;
        const actions = (entry as { supportedActions?: string[] })?.supportedActions;
        if (Array.isArray(actions) && actions.length > 0 && !actions.includes("generateContent")) {
          continue;
        }
        allFound.add(clean);
        if (isHydrogenModel(clean)) {
          hydrogenFound.add(clean);
        }
      }
    }
  } catch {
    // Fall back to direct REST catalog probe below if SDK list throws on custom mock/proxy
  }

  if (allFound.size === 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_800);
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=250",
        {
          method: "GET",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "x-goog-api-key": apiKey,
            "User-Agent": "aistudio-build",
          },
        },
      );
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          models?: {
            name?: string;
            supportedGenerationMethods?: string[];
          }[];
        };
        for (const entry of data.models ?? []) {
          const clean = String(entry?.name ?? "").trim().replace(/^models\//, "");
          if (!clean || !MODEL_ID_RE.test(clean)) continue;
          const methods = entry?.supportedGenerationMethods;
          if (Array.isArray(methods) && methods.length > 0 && !methods.includes("generateContent")) {
            continue;
          }
          allFound.add(clean);
          if (isHydrogenModel(clean)) {
            hydrogenFound.add(clean);
          }
        }
      }
    } catch {
      clearTimeout(timer);
    }
  }

  const sortedHydrogen = sortHydrogenModelsLatestFirst([...hydrogenFound]);
  if (allFound.size > 0 || sortedHydrogen.length > 0) {
    discoveredHydrogenCache = {
      keyHash,
      models: sortedHydrogen,
      allModels: allFound,
      fetchedAt: now,
    };
  }
  const sameKeyCache =
    discoveredHydrogenCache && discoveredHydrogenCache.keyHash === keyHash
      ? discoveredHydrogenCache
      : null;
  return {
    hydrogenModels: sortedHydrogen.length > 0 ? sortedHydrogen : (sameKeyCache?.models ?? []),
    allModels: allFound.size > 0 ? allFound : (sameKeyCache?.allModels ?? new Set()),
  };
}

export async function discoverHydrogenModelsFromApi(
  apiKey: string,
  opts?: { forceRefresh?: boolean },
): Promise<string[]> {
  const catalog = await discoverModelCatalogFromApi(apiKey, opts);
  return catalog.hydrogenModels;
}

export function buildGeminiModelCascade(opts?: {
  mode?: GeminiCallMode;
  hydrogenModel?: string;
  hydrogenModels?: string | readonly string[];
  primaryModel?: string;
  fallbackModel?: string;
  overrideModels?: readonly string[];
}): string[] {
  if (opts?.overrideModels && opts.overrideModels.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of opts.overrideModels) {
      const m = String(raw ?? "").trim().replace(/^models\//, "");
      if (m && MODEL_ID_RE.test(m) && !seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  }

  const configuredHydrogen = parseModelList(opts?.hydrogenModels);
  const discoveredHydrogen = discoveredHydrogenCache?.models ?? [];

  // Lead with Hydrogen and fall back through ALL versions of Hydrogen across sculpt, critic, and director modes,
  // before falling back to Argon and Gemini safety-net models.
  const rawOrder: string[] = [
    opts?.hydrogenModel?.trim() || DEFAULT_HYDROGEN_MODELS[0],
    ...configuredHydrogen,
    ...discoveredHydrogen,
    ...DEFAULT_HYDROGEN_MODELS,
    opts?.primaryModel?.trim() || DEFAULT_ARGON_MODELS[0],
    ...DEFAULT_ARGON_MODELS.slice(1),
    opts?.fallbackModel?.trim() || DEFAULT_GEMINI_SAFETY_NET_MODELS[0],
    ...DEFAULT_GEMINI_SAFETY_NET_MODELS,
  ];

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const raw of rawOrder) {
    const clean = raw.replace(/^models\//, "").trim();
    if (!clean || !MODEL_ID_RE.test(clean) || seen.has(clean)) continue;
    seen.add(clean);
    deduped.push(clean);
  }
  return deduped;
}

/**
 * String-aware JSON sanitizer for 3D voxel blueprints:
 *  - Escapes raw literal newlines/tabs/control chars inside JSON strings
 *  - Strips `//` and `/* ... *\/` comments outside strings
 *  - Strips unary `+` on numeric coordinates (`"x0": +4`, `[+2, 7, 9]`)
 *  - Replaces bare `NaN` / `Infinity` literals outside strings with `0`
 *  - Removes trailing commas before `}` or `]`
 */
function repairJsonCandidate(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  const len = input.length;

  for (let i = 0; i < len; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    // Strip single-line // comments outside strings
    if (ch === "/" && input[i + 1] === "/") {
      i += 2;
      while (i < len && input[i] !== "\n") i++;
      if (i < len) out += "\n";
      continue;
    }

    // Strip /* ... */ block comments outside strings
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < len && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 1;
      continue;
    }

    // Strip unary '+' before digits in coordinate values (e.g. `: +4` or `[+2,`)
    if (ch === "+" && i + 1 < len && input[i + 1] >= "0" && input[i + 1] <= "9") {
      const prevNonWs = out.trimEnd().slice(-1);
      if (prevNonWs === ":" || prevNonWs === "[" || prevNonWs === ",") {
        continue;
      }
    }

    out += ch;
  }

  return out
    .replace(/\b(?:-?Infinity|NaN)\b/g, "0")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractBalancedObjectSlices(text: string): string[] {
  const slices: string[] = [];
  const len = text.length;

  for (let start = 0; start < len; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < len; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          slices.push(text.slice(start, i + 1));
          start = i;
          break;
        }
      }
    }
  }

  slices.sort((a, b) => b.length - a.length);
  return slices;
}

export function extractJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  const text = String(raw ?? "").trim();
  const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const firstStart = stripped.indexOf("{");
  const lastEnd = stripped.lastIndexOf("}");
  if (firstStart === -1 || lastEnd <= firstStart) {
    throw new Error("Model response did not contain a JSON object");
  }

  const candidates: string[] = [stripped.slice(firstStart, lastEnd + 1)];
  for (const balanced of extractBalancedObjectSlices(stripped)) {
    if (!candidates.includes(balanced)) {
      candidates.push(balanced);
    }
  }

  let lastErr: unknown = null;
  for (const slice of candidates) {
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (err) {
      lastErr = err;
    }

    try {
      const repaired = repairJsonCandidate(slice);
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Failed to parse JSON object from response");
}

interface StreamTimeouts {
  firstChunkTimeoutMs: number;
  idleChunkTimeoutMs: number;
  totalTimeoutMs: number;
}

function getModelStreamTimeouts(model: string, mode: GeminiCallMode): StreamTimeouts {
  if (SPECULATIVE_HYDROGEN_RE.test(model)) {
    // Older/unmounted Hydrogen generations (`hydrogen-g`, `hydrogen-f`, `hydrogen-j`):
    // fail fast in <=4.2s if unscheduled/unmounted, but allow full 58s once streaming begins.
    return {
      firstChunkTimeoutMs: mode === "critic" ? 3_500 : 4_200,
      idleChunkTimeoutMs: 22_000,
      totalTimeoutMs: mode === "critic" ? 36_000 : 58_000,
    };
  }
  if (isHydrogenModel(model)) {
    // Active Hydrogen family (`hydrogen-l` and `hydrogen-l-high-*`):
    // with `includeThoughts: true`, first SSE thought chunk arrives in ~1.9–2.6s and
    // full 45-op 3D voxel blueprints complete in ~18–45s.
    return {
      firstChunkTimeoutMs: mode === "critic" ? 12_000 : 18_000,
      idleChunkTimeoutMs: 28_000,
      totalTimeoutMs: mode === "critic" ? 40_000 : mode === "director" ? 52_000 : 72_000,
    };
  }
  if (model.startsWith("gemini-4-argon")) {
    return {
      firstChunkTimeoutMs: mode === "critic" ? 14_000 : 22_000,
      idleChunkTimeoutMs: 28_000,
      totalTimeoutMs: mode === "critic" ? 38_000 : mode === "director" ? 48_000 : 62_000,
    };
  }
  return {
    firstChunkTimeoutMs: mode === "critic" ? 12_000 : 16_000,
    idleChunkTimeoutMs: 24_000,
    totalTimeoutMs: mode === "critic" ? 36_000 : mode === "director" ? 46_000 : 52_000,
  };
}

type ThinkingConfigStrategy =
  | { kind: "native_thoughts" }
  | { kind: "budget"; budget: number }
  | { kind: "none" };

interface SseAccumulator {
  nonThoughtText: string;
  allText: string;
  blockReason: string | null;
  streamError: string | null;
  finishReason: string | null;
}

function consumeSseLine(rawLine: string, acc: SseAccumulator): void {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return;

  let ev: {
    error?: { code?: number; message?: string; status?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
  };
  try {
    ev = JSON.parse(payload);
  } catch {
    // Ignore isolated malformed/non-JSON diagnostic SSE frames rather than aborting the stream
    return;
  }

  if (ev.error) {
    acc.streamError = `SSE ${ev.error.code ?? ""} ${ev.error.status ?? ""}: ${ev.error.message ?? "stream error"}`.trim();
    return;
  }
  if (ev.promptFeedback?.blockReason) {
    acc.blockReason = ev.promptFeedback.blockReason;
  }
  const cand = ev.candidates?.[0];
  if (cand?.finishReason) {
    acc.finishReason = cand.finishReason;
  }
  for (const part of cand?.content?.parts ?? []) {
    if (typeof part.text === "string") {
      acc.allText += part.text;
      if (!part.thought) {
        acc.nonThoughtText += part.text;
      }
    }
  }
}

function buildGenerationConfig(opts: {
  temperature?: number;
  maxOutputTokens: number;
  thinking: ThinkingConfigStrategy;
  useJsonMimeType: boolean;
}): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: opts.maxOutputTokens,
  };
  if (typeof opts.temperature === "number") {
    generationConfig.temperature = opts.temperature;
  }
  if (opts.useJsonMimeType) {
    generationConfig.responseMimeType = "application/json";
  }
  if (opts.thinking.kind === "native_thoughts") {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
    };
  } else if (opts.thinking.kind === "budget" && opts.thinking.budget > 0) {
    generationConfig.thinkingConfig = {
      thinkingBudget: opts.thinking.budget,
      includeThoughts: true,
    };
  }
  return generationConfig;
}

type SingleAttemptOutcome =
  | {
      ok: true;
      rawText: string;
      blockReason: string | null;
      finishReason: string | null;
      firstChunkMs: number;
    }
  | {
      ok: false;
      httpStatus?: number;
      errorBody?: string;
      transportDropped?: boolean;
      reason: string;
    };

async function streamSingleModelAttempt(opts: {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userParts: Record<string, unknown>[];
  temperature?: number;
  maxOutputTokens: number;
  thinking: ThinkingConfigStrategy;
  useJsonMimeType: boolean;
  timeouts: StreamTimeouts;
}): Promise<SingleAttemptOutcome> {
  const t0 = Date.now();
  const controller = new AbortController();
  let abortReason = "aborted";

  const totalTimer = setTimeout(() => {
    abortReason = `TotalTimeout(${opts.timeouts.totalTimeoutMs}ms)`;
    controller.abort();
  }, opts.timeouts.totalTimeoutMs);

  let firstChunkTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    abortReason = `FirstByteTimeout(${opts.timeouts.firstChunkTimeoutMs}ms)`;
    controller.abort();
  }, opts.timeouts.firstChunkTimeoutMs);

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReason = `IdleStreamTimeout(${opts.timeouts.idleChunkTimeoutMs}ms)`;
      controller.abort();
    }, opts.timeouts.idleChunkTimeoutMs);
  };

  const clearAllTimers = (): void => {
    clearTimeout(totalTimer);
    if (firstChunkTimer !== null) {
      clearTimeout(firstChunkTimer);
      firstChunkTimer = null;
    }
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  let receivedHttp200 = false;
  try {
    // Security invariant: API key MUST only be sent via x-goog-api-key header, NEVER in URL query parameters
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;
    const generationConfig = buildGenerationConfig({
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      thinking: opts.thinking,
      useJsonMimeType: opts.useJsonMimeType,
    });

    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": opts.apiKey,
        "User-Agent": "aistudio-build",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.systemPrompt }] },
        contents: [{ role: "user", parts: opts.userParts }],
        generationConfig,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      clearAllTimers();
      return {
        ok: false,
        httpStatus: res.status,
        errorBody: errBody,
        reason: `HTTP ${res.status}: ${redactSecrets(errBody.slice(0, 160), [opts.apiKey])}`,
      };
    }

    receivedHttp200 = true;

    if (!res.body) {
      clearAllTimers();
      return { ok: false, transportDropped: true, reason: "Empty response stream body" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const acc: SseAccumulator = {
      nonThoughtText: "",
      allText: "",
      blockReason: null,
      streamError: null,
      finishReason: null,
    };

    let firstChunkMs = -1;
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (value && value.byteLength > 0) {
        if (firstChunkMs < 0) {
          firstChunkMs = Date.now() - t0;
          if (firstChunkTimer !== null) {
            clearTimeout(firstChunkTimer);
            firstChunkTimer = null;
          }
        }
        resetIdleTimer();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          consumeSseLine(line, acc);
          if (acc.streamError) {
            await reader.cancel().catch(() => {});
            clearAllTimers();
            return {
              ok: false,
              reason: redactSecrets(acc.streamError, [opts.apiKey]),
            };
          }
        }
      }
      if (done) break;
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        consumeSseLine(line, acc);
      }
    }

    clearAllTimers();

    if (acc.streamError) {
      return { ok: false, reason: redactSecrets(acc.streamError, [opts.apiKey]) };
    }

    const rawText = acc.nonThoughtText.trim() || acc.allText.trim();
    return {
      ok: true,
      rawText,
      blockReason: acc.blockReason,
      finishReason: acc.finishReason,
      firstChunkMs: firstChunkMs >= 0 ? firstChunkMs : Date.now() - t0,
    };
  } catch (err) {
    clearAllTimers();
    const aborted = controller.signal.aborted;
    const msg = aborted ? abortReason : redactSecrets(err, [opts.apiKey]);
    return {
      ok: false,
      transportDropped: !aborted && receivedHttp200,
      reason: msg,
    };
  }
}

/**
 * Non-streaming `:generateContent` fallback for cases where an intermediary/edge proxy drops an
 * HTTP 200 SSE stream mid-transfer (`terminated` / empty stream body).
 */
async function nonStreamSingleModelAttempt(opts: {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userParts: Record<string, unknown>[];
  temperature?: number;
  maxOutputTokens: number;
  thinking: ThinkingConfigStrategy;
  useJsonMimeType: boolean;
  timeoutMs: number;
}): Promise<SingleAttemptOutcome> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
    const generationConfig = buildGenerationConfig({
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      thinking: opts.thinking,
      useJsonMimeType: opts.useJsonMimeType,
    });

    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": opts.apiKey,
        "User-Agent": "aistudio-build",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.systemPrompt }] },
        contents: [{ role: "user", parts: opts.userParts }],
        generationConfig,
      }),
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        httpStatus: res.status,
        errorBody: errBody,
        reason: `HTTP ${res.status}: ${redactSecrets(errBody.slice(0, 160), [opts.apiKey])}`,
      };
    }

    const payload = (await res.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: {
        finishReason?: string;
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
    };

    const cand = payload.candidates?.[0];
    let nonThought = "";
    let allText = "";
    for (const part of cand?.content?.parts ?? []) {
      if (typeof part.text === "string") {
        allText += part.text;
        if (!part.thought) nonThought += part.text;
      }
    }

    return {
      ok: true,
      rawText: nonThought.trim() || allText.trim(),
      blockReason: payload.promptFeedback?.blockReason ?? null,
      finishReason: cand?.finishReason ?? null,
      firstChunkMs: Date.now() - t0,
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = controller.signal.aborted
      ? `NonStreamTimeout(${opts.timeoutMs}ms)`
      : redactSecrets(err, [opts.apiKey]);
    return { ok: false, reason: msg };
  }
}

async function runResilientModelAttempt(opts: {
  model: string;
  mode: GeminiCallMode;
  apiKey: string;
  systemPrompt: string;
  userParts: Record<string, unknown>[];
  temperature: number;
  requestedMaxOutputTokens: number;
  requestedThinkingBudget: number;
  timeouts: StreamTimeouts;
  priorTransportDrops: number;
}): Promise<SingleAttemptOutcome> {
  const hydrogen = isHydrogenModel(opts.model);
  const modernNoBudget = isModernNoBudgetModel(opts.model);
  let maxOutputTokens =
    hydrogen || modernNoBudget
      ? Math.max(opts.requestedMaxOutputTokens, opts.mode === "sculpt" ? 32_768 : 16_384)
      : opts.requestedMaxOutputTokens;

  // Hydrogen, Gemini 4, and Gemini 3.8 models use native thinking without `thinkingBudget`
  // (`thinkingBudget` returns HTTP 400 on `gemini-4-argon` and `gemini-3.8-flash`), and omit
  // deprecated `temperature` on Gemini 4 / 3.8 models.
  let thinking: ThinkingConfigStrategy =
    hydrogen || modernNoBudget
      ? { kind: "native_thoughts" }
      : opts.requestedThinkingBudget > 0
        ? { kind: "budget", budget: opts.requestedThinkingBudget }
        : { kind: "none" };
  let temperature: number | undefined = modernNoBudget ? undefined : opts.temperature;
  let useJsonMimeType = true;

  let res = await streamSingleModelAttempt({
    model: opts.model,
    apiKey: opts.apiKey,
    systemPrompt: opts.systemPrompt,
    userParts: opts.userParts,
    temperature,
    maxOutputTokens,
    thinking,
    useJsonMimeType,
    timeouts: opts.timeouts,
  });

  // Self-healing HTTP 400 parameter compatibility retries on the SAME model (up to 3 quick adjustments)
  for (let compatPass = 0; compatPass < 3 && !res.ok && res.httpStatus === 400 && res.errorBody; compatPass++) {
    const body = res.errorBody;
    let adjusted = false;

    if (thinking.kind !== "none" && /thinking|thought/i.test(body)) {
      thinking = { kind: "none" };
      adjusted = true;
    } else if (temperature !== undefined && /temperature|sampling/i.test(body)) {
      temperature = undefined;
      adjusted = true;
    } else if (maxOutputTokens > 16_384 && /max_?output_?tokens|output.*token|token.*limit/i.test(body)) {
      maxOutputTokens = 16_384;
      adjusted = true;
    } else if (useJsonMimeType && /response_?mime_?type|mime.*type|application\/json/i.test(body)) {
      useJsonMimeType = false;
      adjusted = true;
    }

    if (!adjusted) break;

    res = await streamSingleModelAttempt({
      model: opts.model,
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      userParts: opts.userParts,
      temperature,
      maxOutputTokens,
      thinking,
      useJsonMimeType,
      timeouts: opts.timeouts,
    });
  }

  // If SSE stream body was dropped mid-transfer after HTTP 200 (or multiple SSE transport drops occurred),
  // rescue on the same active Hydrogen model via non-streaming `:generateContent`.
  if (
    !res.ok &&
    res.transportDropped &&
    hydrogen &&
    !SPECULATIVE_HYDROGEN_RE.test(opts.model) &&
    (res.reason === "Empty response stream body" || opts.priorTransportDrops >= 1)
  ) {
    res = await nonStreamSingleModelAttempt({
      model: opts.model,
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      userParts: opts.userParts,
      temperature,
      maxOutputTokens,
      thinking,
      useJsonMimeType,
      timeoutMs: Math.min(50_000, opts.timeouts.totalTimeoutMs),
    });
  }

  // If a thinking-heavy response hit MAX_TOKENS truncation, retry once with 65,536 token headroom
  if (
    res.ok &&
    (hydrogen || modernNoBudget) &&
    res.finishReason === "MAX_TOKENS" &&
    maxOutputTokens < 65_536
  ) {
    res = await streamSingleModelAttempt({
      model: opts.model,
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      userParts: opts.userParts,
      temperature,
      maxOutputTokens: 65_536,
      thinking,
      useJsonMimeType,
      timeouts: opts.timeouts,
    });
  }

  return res;
}

export async function callGeminiWithFallbacks(opts: {
  apiKey: string;
  mode?: GeminiCallMode;
  hydrogenModel?: string;
  hydrogenModels?: string | readonly string[];
  primaryModel?: string;
  fallbackModel?: string;
  overrideModels?: readonly string[];
  systemPrompt: string;
  userText: string;
  imageBase64?: string;
  imageMimeType?: string;
  extraImages?: { mimeType: string; data: string }[];
  temperature?: number;
  thinkingBudget?: number;
  maxOutputTokens?: number;
  maxCascadeMs?: number;
  validateJson?: (json: Record<string, unknown>) => string | null;
}): Promise<{
  json: Record<string, unknown>;
  modelUsed: string;
  attempts: GeminiAttemptRecord[];
}> {
  const mode: GeminiCallMode = opts.mode ?? "sculpt";
  // Pre-warm the key's model catalog via `@google/genai` once per 5 min so standard external AI Studio keys
  // without internal Hydrogen/Argon pools don't stall on sequential 404 probes, while keys WITH
  // Hydrogen immediately discover and prioritize every `hydrogen-*` endpoint (`hydrogen-l` first).
  if (!opts.overrideModels || opts.overrideModels.length === 0) {
    await discoverModelCatalogFromApi(opts.apiKey);
  }
  const sameKeyCache =
    discoveredHydrogenCache && discoveredHydrogenCache.keyHash === fingerprintApiKey(opts.apiKey)
      ? discoveredHydrogenCache
      : null;
  const catalogSet = sameKeyCache?.allModels ?? new Set<string>();
  const discoveredHydrogenSet = new Set(sameKeyCache?.models ?? []);

  const baseCascade = buildGeminiModelCascade({
    mode,
    hydrogenModel: opts.hydrogenModel,
    hydrogenModels: opts.hydrogenModels,
    primaryModel: opts.primaryModel,
    fallbackModel: opts.fallbackModel,
    overrideModels: opts.overrideModels,
  });

  // Strictly keep ALL Hydrogen versions ahead of non-Hydrogen safety-net models, prioritizing
  // live-discovered Hydrogen versions first (when `models.list` reports them) followed by all
  // remaining Hydrogen versions so every Hydrogen fallback is attempted before stepping down.
  const now = Date.now();
  let models: string[];
  if (opts.overrideModels && opts.overrideModels.length > 0) {
    models = [...baseCascade];
  } else {
    const allHydrogenTier = baseCascade.filter((m) => isHydrogenModel(m));
    const listedHydrogen =
      discoveredHydrogenSet.size > 0
        ? allHydrogenTier.filter((m) => discoveredHydrogenSet.has(m))
        : [];
    const unlistedHydrogen =
      discoveredHydrogenSet.size > 0
        ? allHydrogenTier.filter((m) => !discoveredHydrogenSet.has(m))
        : allHydrogenTier;

    const orderedHydrogen = [
      ...orderTierByHealth(listedHydrogen, now),
      ...orderTierByHealth(unlistedHydrogen, now),
    ];

    const safetyNetTier = baseCascade.filter((m) => !isHydrogenModel(m));
    const orderedSafety = orderTierByHealth(safetyNetTier, now);
    const filteredSafety =
      catalogSet.size > 0
        ? [
            ...orderedSafety.filter((m) => catalogSet.has(m)),
            ...orderedSafety.filter((m) => !catalogSet.has(m)),
          ]
        : orderedSafety;

    models = [...orderedHydrogen, ...filteredSafety];
  }

  const userParts: Record<string, unknown>[] = [];
  if (opts.imageBase64 && opts.imageMimeType) {
    userParts.push({
      inlineData: {
        mimeType: opts.imageMimeType,
        data: opts.imageBase64,
      },
    });
  }
  if (Array.isArray(opts.extraImages)) {
    for (const img of opts.extraImages) {
      if (img?.data && img?.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      }
    }
  }
  userParts.push({ text: opts.userText });

  const cascadeStart = Date.now();
  const maxCascadeMs =
    opts.maxCascadeMs ??
    (mode === "critic" ? 55_000 : mode === "director" ? 75_000 : 145_000);

  const attempts: GeminiAttemptRecord[] = [];
  const attemptedSet = new Set<string>();
  let ranDynamicHydrogenDiscovery = false;
  let priorTransportDrops = 0;

  for (let idx = 0; idx < models.length; idx++) {
    const model = models[idx];
    if (attemptedSet.has(model)) continue;

    // Before stepping out of the Hydrogen family, dynamically query `v1beta/models` once
    // in case newer `hydrogen-*` versions were mounted on `GEMINI_API_KEY`.
    if (
      !opts.overrideModels &&
      !ranDynamicHydrogenDiscovery &&
      !isHydrogenModel(model) &&
      attempts.length > 0
    ) {
      ranDynamicHydrogenDiscovery = true;
      const liveHydrogen = await discoverHydrogenModelsFromApi(opts.apiKey, { forceRefresh: true });
      const unseenHydrogen = liveHydrogen.filter(
        (m) => !attemptedSet.has(m) && !models.slice(idx).includes(m),
      );
      if (unseenHydrogen.length > 0) {
        models.splice(idx, 0, ...unseenHydrogen);
        idx--;
        continue;
      }
    }

    const elapsedTotal = Date.now() - cascadeStart;

    // If >=70% of total wall-clock cascade budget is already spent, skip older/speculative aliases
    // (`hydrogen-f/g/j`) so active Hydrogen-l / Flash safety-net pools get clean time.
    if (
      idx > 0 &&
      elapsedTotal > maxCascadeMs * 0.7 &&
      SPECULATIVE_HYDROGEN_RE.test(model)
    ) {
      continue;
    }
    if (idx > 0 && elapsedTotal >= maxCascadeMs) {
      break;
    }

    attemptedSet.add(model);
    const attemptStart = Date.now();
    const timeouts = getModelStreamTimeouts(model, mode);
    const desiredThinking = opts.thinkingBudget ?? (mode === "critic" ? 512 : 1024);

    const res = await runResilientModelAttempt({
      model,
      mode,
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      userParts,
      temperature: opts.temperature ?? 0.42,
      requestedMaxOutputTokens: opts.maxOutputTokens ?? 12_288,
      requestedThinkingBudget: desiredThinking,
      timeouts,
      priorTransportDrops,
    });

    const attemptMs = Math.max(1, Date.now() - attemptStart);

    if (!res.ok) {
      if (res.transportDropped) priorTransportDrops++;
      recordModelFailure(model, res.httpStatus, res.reason);
      attempts.push({
        model,
        ok: false,
        ms: attemptMs,
        reason: res.reason,
      });

      // If the API key itself is rejected as invalid, abort cascade immediately rather than stalling across 25 more models
      if (res.reason && /API_KEY_INVALID|API key not valid|key not found|invalid api key/i.test(res.reason)) {
        break;
      }

      // Never bulk-skip Hydrogen versions when a single Hydrogen variant returns 404/403 —
      // always allow the cascade to try every remaining Hydrogen version (`hydrogen-l`,
      // `hydrogen-l-high-*`, `hydrogen-k/j/h/g/f`, etc.) before stepping down to non-Hydrogen fallbacks.

      // Short jittered pause on 429 / 503 spikes to desynchronize burst retries across Hydrogen pools
      if (
        (res.httpStatus === 429 || res.httpStatus === 503) &&
        Date.now() - cascadeStart + 450 < maxCascadeMs
      ) {
        const jitterMs = 160 + Math.floor(Math.random() * 200);
        await new Promise((r) => setTimeout(r, jitterMs));
      }
      continue;
    }

    if (
      !res.rawText &&
      res.blockReason &&
      /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|IMAGE_SAFETY)$/i.test(res.blockReason) &&
      mode === "sculpt"
    ) {
      recordModelSuccess(model);
      attempts.push({
        model,
        ok: true,
        ms: attemptMs,
        firstChunkMs: res.firstChunkMs,
      });
      return {
        json: {
          safe: false,
          safeReason:
            "That creation doesn't fit our family-friendly shared meadow — please try something else.",
        },
        modelUsed: model,
        attempts,
      };
    }

    try {
      const json = extractJsonObject(res.rawText);

      if (opts.validateJson) {
        let validationErr: string | null = null;
        try {
          validationErr = opts.validateJson(json);
        } catch (vErr) {
          validationErr = redactSecrets(vErr, [opts.apiKey]).slice(0, 90);
        }
        if (validationErr) {
          const reason = `Blueprint validation failed: ${validationErr}`;
          recordModelFailure(model, undefined, reason);
          attempts.push({
            model,
            ok: false,
            ms: attemptMs,
            firstChunkMs: res.firstChunkMs,
            reason,
          });
          continue;
        }
      }

      recordModelSuccess(model);
      attempts.push({
        model,
        ok: true,
        ms: attemptMs,
        firstChunkMs: res.firstChunkMs,
      });

      if (attempts.length > 1) {
        const failedSummary = attempts
          .slice(0, -1)
          .map((a) => `${a.model}(${a.reason ?? "err"},${a.ms}ms)`)
          .join(" -> ");
        safeLogWarn(
          "gemini_model_fallback",
          `[${mode}] Rescued by ${model} (${attemptMs}ms) after: ${failedSummary}`,
          [opts.apiKey],
        );
      }

      return { json, modelUsed: model, attempts };
    } catch (parseErr) {
      const parseReason = `JSON parse error (${res.finishReason ?? "incomplete_stream"}): ${redactSecrets(parseErr, [opts.apiKey]).slice(0, 90)}`;
      if (!res.finishReason) priorTransportDrops++;
      recordModelFailure(model, undefined, parseReason);
      attempts.push({
        model,
        ok: false,
        ms: attemptMs,
        firstChunkMs: res.firstChunkMs,
        reason: parseReason,
      });
    }
  }

  const trace = attempts
    .map((a) => `${a.model}: ${a.reason ?? "failed"} (${a.ms}ms)`)
    .join(" | ");
  throw new Error(
    redactSecrets(
      `All ${attempts.length}/${models.length} Hydrogen/Gemini cascade models failed [${mode}]: ${trace}`,
      [opts.apiKey],
    ),
  );
}

import type { AppEnv } from "./env_types";
import { safeLogWarn } from "./security";

/**
 * Single AI backend for the island: a local Hermes agent gateway that speaks the
 * OpenAI-compatible `/v1/chat/completions` protocol (e.g. the Hermes gateway at
 * http://127.0.0.1:8642). Configure via:
 *   - HERMES_AGENT_URL    (default http://127.0.0.1:8642)
 *   - HERMES_AGENT_TOKEN  (bearer token, e.g. the gateway's API_SERVER_KEY)
 *   - HERMES_AGENT_MODEL  (default "hermes-agent")
 */

export const DEFAULT_AGENT_ENDPOINT = "http://127.0.0.1:8642";
export const DEFAULT_AGENT_MODEL = "hermes-agent";

export type AgentCallMode = "sculpt" | "critic" | "director" | "minigame";

export interface AgentAttemptRecord {
  model: string;
  ok: boolean;
  ms: number;
  firstChunkMs?: number;
  reason?: string;
}

export function resolveAgentEndpoint(env: AppEnv): string {
  return (env.HERMES_AGENT_URL || DEFAULT_AGENT_ENDPOINT).trim();
}

export function resolveAgentModel(env: AppEnv): string {
  return (env.HERMES_AGENT_MODEL || DEFAULT_AGENT_MODEL).trim();
}

function agentAuthHeaders(env: AppEnv): Record<string, string> {
  const token = env.HERMES_AGENT_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function defaultTimeoutMsForMode(mode: AgentCallMode): number {
  switch (mode) {
    case "sculpt":
      return 1_500_000;
    case "critic":
      return 300_000;
    case "minigame":
      return 20_000;
    default:
      return 120_000;
  }
}

/** Quick fail-fast reachability + auth check against the gateway's /health route. */
export async function probeAgentGateway(
  env: AppEnv,
  timeoutMs = 2_000,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const endpoint = resolveAgentEndpoint(env);
  const t0 = Date.now();
  try {
    const res = await fetch(`${endpoint}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", ...agentAuthHeaders(env) },
    });
    if (!res.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error:
          res.status === 401
            ? `Hermes agent gateway at ${endpoint} rejected HERMES_AGENT_TOKEN (HTTP 401).`
            : `Hermes agent gateway at ${endpoint} returned HTTP ${res.status}.`,
      };
    }
    return { ok: true, latencyMs: Math.max(1, Date.now() - t0) };
  } catch (err) {
    return {
      ok: false,
      error: `No Hermes agent gateway reachable at ${endpoint} (${err instanceof Error ? err.message : "unreachable"}). Start the Hermes agent or set HERMES_AGENT_URL.`,
    };
  }
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

interface ChatCompletionOk {
  ok: true;
  text: string;
  model: string;
}
interface ChatCompletionErr {
  ok: false;
  status?: number;
  reason: string;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

async function postChatCompletion(opts: {
  env: AppEnv;
  endpointOverride?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  disableReasoning?: boolean;
  timeoutMs: number;
}): Promise<ChatCompletionOk | ChatCompletionErr> {
  const endpoint = (opts.endpointOverride || resolveAgentEndpoint(opts.env)).replace(/\/+$/, "");
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    // Stream so very long generations (e.g. full voxel blueprints) keep data
    // flowing instead of holding one giant response open for many minutes.
    stream: true,
  };
  if (opts.env.HERMES_AGENT_PROVIDER) body.provider = opts.env.HERMES_AGENT_PROVIDER;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (typeof opts.maxOutputTokens === "number") body.max_tokens = opts.maxOutputTokens;
  if (opts.disableReasoning) {
    // Structured-output tasks don't need the model's thinking phase — without
    // this a full voxel blueprint generation can run 10+ minutes.
    body.model_options = { reasoning: { enabled: false } };
  }

  const idleTimeoutMs = Math.min(120_000, opts.timeoutMs);
  const controller = new AbortController();
  let abortCause: "idle" | "deadline" | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    abortCause = "idle";
    controller.abort();
  }, idleTimeoutMs);
  const deadlineTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    abortCause = "deadline";
    controller.abort();
  }, Math.max(1, opts.timeoutMs));
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortCause = "idle";
      controller.abort();
    }, idleTimeoutMs);
  };

  try {
    const res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...agentAuthHeaders(opts.env),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = (await res.text().catch(() => "")).slice(0, 300);
      return {
        ok: false,
        status: res.status,
        reason: `Hermes agent gateway HTTP ${res.status}${errBody ? `: ${errBody}` : ""}`,
      };
    }
    if (!res.body) {
      return { ok: false, reason: "Hermes agent gateway returned no response body." };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let reasoning = "";
    let model = opts.model;
    let sawDone = false;

    while (!sawDone) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      resetIdle();
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          sawDone = true;
          break;
        }
        try {
          const chunk = JSON.parse(payload) as {
            model?: string;
            choices?: {
              delta?: {
                content?: unknown;
                reasoning_content?: string;
              };
              message?: { content?: unknown };
            }[];
          };
          if (typeof chunk.model === "string" && chunk.model) model = chunk.model;
          const delta = chunk.choices?.[0]?.delta;
          if (delta) {
            if (typeof delta.content === "string") text += delta.content;
            else if (Array.isArray(delta.content)) text += textFromContent(delta.content);
            if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
          } else {
            const msg = chunk.choices?.[0]?.message;
            if (msg) text += textFromContent(msg.content);
          }
        } catch {
          // Skip malformed SSE line.
        }
      }
    }

    const finalText = text.trim() || reasoning.trim();
    if (!finalText) {
      return { ok: false, reason: "Hermes agent gateway returned an empty completion." };
    }
    return { ok: true, text: finalText, model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (abortCause === "idle") {
      return {
        ok: false,
        reason: `Hermes agent gateway sent no data for ${idleTimeoutMs}ms.`,
      };
    }
    return {
      ok: false,
      reason: /timeout|abort/i.test(msg)
        ? `Hermes agent gateway timed out after ${opts.timeoutMs}ms.`
        : `Could not reach Hermes agent gateway at ${endpoint} (${msg}).`,
    };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/** Plain chat round-trip with the lead Hermes agent (no JSON contract). */
export async function callHermesAgentChat(opts: {
  env: AppEnv;
  endpointOverride?: string;
  systemPrompt: string;
  userText: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ text: string; modelUsed: string }> {
  const res = await postChatCompletion({
    env: opts.env,
    endpointOverride: opts.endpointOverride,
    model: opts.model || resolveAgentModel(opts.env),
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userText },
    ],
    timeoutMs: opts.timeoutMs ?? 60_000,
  });
  if (!res.ok) {
    throw new Error(res.reason);
  }
  return { text: res.text, modelUsed: res.model };
}

/*
 * JSON extraction & repair utilities (carried over unchanged from the previous
 * model layer so downstream parsing behavior is preserved).
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

/**
 * Ask the lead Hermes agent a question whose answer must be a JSON object.
 * Mirrors the old model-cascade contract ({ json, modelUsed, attempts }) but
 * against a single agent endpoint, with up to two strict-JSON repair rounds.
 */
export async function callHermesAgentForJson(opts: {
  env: AppEnv;
  mode?: AgentCallMode;
  systemPrompt: string;
  userText: string;
  imageBase64?: string;
  imageMimeType?: string;
  extraImages?: { mimeType: string; data: string }[];
  temperature?: number;
  maxOutputTokens?: number;
  maxCascadeMs?: number;
  validateJson?: (json: Record<string, unknown>) => string | null;
  callerLabel?: string;
}): Promise<{
  json: Record<string, unknown>;
  modelUsed: string;
  attempts: AgentAttemptRecord[];
}> {
  const mode: AgentCallMode = opts.mode ?? "director";
  const model = resolveAgentModel(opts.env);
  const totalBudgetMs = opts.maxCascadeMs ?? defaultTimeoutMsForMode(mode);
  const deadline = Date.now() + totalBudgetMs;
  const attempts: AgentAttemptRecord[] = [];
  const label = opts.callerLabel ?? mode;

  const imageParts: ChatContentPart[] = [];
  if (opts.imageBase64 && opts.imageMimeType) {
    imageParts.push({
      type: "image_url",
      image_url: { url: `data:${opts.imageMimeType};base64,${opts.imageBase64}` },
    });
  }
  for (const img of opts.extraImages ?? []) {
    imageParts.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    });
  }

  let userContent: string | ChatContentPart[] = opts.userText;
  if (imageParts.length > 0) {
    userContent = [{ type: "text", text: opts.userText }, ...imageParts];
  }

  const baseMessages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: userContent },
  ];
  let messages = [...baseMessages];
  let droppedImages = false;

  const maxRounds = 3;
  let lastFailure = "Hermes agent did not return usable JSON.";

  for (let round = 1; round <= maxRounds; round++) {
    const remaining = deadline - Date.now();
    if (remaining <= 5_000) {
      attempts.push({ model, ok: false, ms: 0, reason: `out of time budget (${totalBudgetMs}ms)` });
      break;
    }

    const t0 = Date.now();
    const res = await postChatCompletion({
      env: opts.env,
      model,
      messages,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      disableReasoning: true,
      timeoutMs: remaining,
    });
    const ms = Date.now() - t0;

    if (!res.ok) {
      attempts.push({ model, ok: false, ms, reason: res.reason.slice(0, 200) });

      // If the gateway refuses multimodal payloads, retry once with text only.
      if (
        imageParts.length > 0 &&
        !droppedImages &&
        res.status !== undefined &&
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 401 &&
        res.status !== 429
      ) {
        droppedImages = true;
        messages = [
          { role: "system", content: opts.systemPrompt },
          {
            role: "user",
            content: `${opts.userText}\n\n(Note: an image was attached but the Hermes agent gateway did not accept image input; rely on the text description.)`,
          },
        ];
        continue;
      }
      lastFailure = res.reason;
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Hermes agent gateway rejected the request (HTTP ${res.status}) — check HERMES_AGENT_TOKEN.`,
        );
      }
      break;
    }

    let parsed: Record<string, unknown>;
    let validationError: string | null = null;
    try {
      parsed = extractJsonObject(res.text);
    } catch (err) {
      parsed = { __unparseable: true };
      validationError = `reply was not valid JSON (${err instanceof Error ? err.message : String(err)})`;
    }
    if (!validationError && opts.validateJson) {
      try {
        validationError = opts.validateJson(parsed);
      } catch (err) {
        validationError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!validationError) {
      attempts.push({ model, ok: true, ms });
      return { json: parsed, modelUsed: res.model, attempts };
    }

    attempts.push({ model, ok: false, ms, reason: validationError.slice(0, 200) });
    lastFailure = `Hermes agent reply failed validation: ${validationError}`;
    safeLogWarn(`hermes_agent_json_round_${round}`, lastFailure.slice(0, 300));

    messages = [
      ...messages,
      { role: "assistant", content: res.text.slice(0, 20_000) },
      {
        role: "user",
        content: `Your previous reply was not usable: ${validationError}\nRespond again with ONLY the strict JSON object requested — no prose, no explanations, no code fences.`,
      },
    ];
  }

  throw new Error(
    `${label}: ${lastFailure} (endpoint ${resolveAgentEndpoint(opts.env)}, model ${model})`,
  );
}

export interface AppEnv {
  GEMINI_API_KEY?: string;
  CREATOR_HMAC_SECRET?: string;
  HYDROGEN_MODEL?: string;
  HYDROGEN_MODELS?: string;
  ARGON_MODEL?: string;
  FALLBACK_MODEL?: string;
  MINIGAME_MODEL?: string;
  WORLD_STATE_PATH?: string;
  HERMES_AGENT_URL?: string;
  HERMES_HOME?: string;
}

function sanitizeSecretApiKey(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (
    trimmed === "MY_GEMINI_API_KEY" ||
    trimmed === "YOUR_GEMINI_API_KEY" ||
    trimmed.startsWith("TODO") ||
    trimmed.startsWith("PLACEHOLDER")
  ) {
    return "";
  }
  return trimmed;
}

export function resolveRuntimeEnv(): AppEnv {
  const resolvedApiKey = sanitizeSecretApiKey(process.env.GEMINI_API_KEY);

  return {
    GEMINI_API_KEY: resolvedApiKey || undefined,
    CREATOR_HMAC_SECRET: process.env.CREATOR_HMAC_SECRET?.trim() || undefined,
    HYDROGEN_MODEL: process.env.HYDROGEN_MODEL?.trim() || "hydrogen-l",
    HYDROGEN_MODELS: process.env.HYDROGEN_MODELS?.trim() || undefined,
    ARGON_MODEL: process.env.ARGON_MODEL?.trim() || "gemini-4-argon",
    FALLBACK_MODEL: process.env.FALLBACK_MODEL?.trim() || "gemini-3.8-flash",
    MINIGAME_MODEL: process.env.MINIGAME_MODEL?.trim() || undefined,
    WORLD_STATE_PATH: process.env.WORLD_STATE_PATH?.trim() || undefined,
    HERMES_AGENT_URL: process.env.HERMES_AGENT_URL?.trim() || undefined,
    HERMES_HOME: process.env.HERMES_HOME?.trim() || undefined,
  };
}

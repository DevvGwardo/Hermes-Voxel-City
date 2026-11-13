export interface AppEnv {
  CREATOR_HMAC_SECRET?: string;
  WORLD_STATE_PATH?: string;
  HERMES_AGENT_URL?: string;
  HERMES_HOME?: string;
  HERMES_AGENT_TOKEN?: string;
  HERMES_AGENT_MODEL?: string;
}

export function resolveRuntimeEnv(): AppEnv {
  return {
    CREATOR_HMAC_SECRET: process.env.CREATOR_HMAC_SECRET?.trim() || undefined,
    WORLD_STATE_PATH: process.env.WORLD_STATE_PATH?.trim() || undefined,
    HERMES_AGENT_URL: process.env.HERMES_AGENT_URL?.trim() || undefined,
    HERMES_HOME: process.env.HERMES_HOME?.trim() || undefined,
    HERMES_AGENT_TOKEN: process.env.HERMES_AGENT_TOKEN?.trim() || undefined,
    HERMES_AGENT_MODEL: process.env.HERMES_AGENT_MODEL?.trim() || undefined,
  };
}

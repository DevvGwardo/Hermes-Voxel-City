import nodeCrypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppEnv } from "./env_types";
import { callGeminiWithFallbacks } from "./gemini_models";
import { redactSecrets, sanitizePlainText } from "./security";
import type {
  HermesAgentSource,
  HermesLeadAgentInfo,
  HermesLocalProbeResult,
  HermesLogEntry,
  HermesStateSnapshot,
  HermesSubAgent,
  HermesSubAgentRole,
  HermesSubAgentStatus,
} from "./types";

export interface IslandStation {
  id: string;
  label: string;
  x: number;
  z: number;
  role: HermesSubAgentRole;
}

export const HERMES_ISLAND_STATIONS: readonly IslandStation[] = [
  { id: "station-plaza", label: "Hermes Central Plaza", x: 0, z: -13.5, role: "orchestrator" },
  { id: "station-clocktower", label: "Clocktower Relay", x: 0, z: -26.5, role: "architect" },
  { id: "station-compute", label: "Hyperion Compute Node", x: -24, z: -22, role: "coder" },
  { id: "station-memory", label: "Memory Bookshop", x: 28, z: 8, role: "memory" },
  { id: "station-forge", label: "Windmill Forge", x: -30, z: -2, role: "critic" },
  { id: "station-pond", label: "Clover Research Dock", x: -2, z: 9, role: "researcher" },
  { id: "station-transit", label: "Loop Runner", x: 20, z: -14, role: "tool_runner" },
];

const VALID_ROLES = new Set<HermesSubAgentRole>([
  "orchestrator",
  "architect",
  "coder",
  "researcher",
  "critic",
  "tool_runner",
  "memory",
  "sculptor",
]);

const VALID_STATUSES = new Set<HermesSubAgentStatus>([
  "standby",
  "thinking",
  "executing",
  "delegating",
  "completed",
  "error",
]);

export function sanitizeHermesRole(raw: unknown, fallback: HermesSubAgentRole = "tool_runner"): HermesSubAgentRole {
  const s = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return VALID_ROLES.has(s as HermesSubAgentRole) ? (s as HermesSubAgentRole) : fallback;
}

export function sanitizeHermesStatus(
  raw: unknown,
  fallback: HermesSubAgentStatus = "executing",
): HermesSubAgentStatus {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return VALID_STATUSES.has(s as HermesSubAgentStatus) ? (s as HermesSubAgentStatus) : fallback;
}

/**
 * Only permit local loopback endpoints (or the explicitly configured HERMES_AGENT_URL)
 * so SSRF against arbitrary internal/external network hosts is impossible.
 */
export function validateLocalHermesEndpoint(rawUrl: string, configuredUrl?: string): string | null {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return null;
  if (configuredUrl && trimmed === configuredUrl.trim()) {
    try {
      const u = new URL(trimmed);
      if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") {
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function stationForRole(role: HermesSubAgentRole): IslandStation {
  return (
    HERMES_ISLAND_STATIONS.find((s) => s.role === role) ??
    HERMES_ISLAND_STATIONS[0]
  );
}

function createInitialSubAgents(now: number): HermesSubAgent[] {
  const specs: {
    id: string;
    name: string;
    role: HermesSubAgentRole;
    task: string;
    tool: string;
  }[] = [
    {
      id: "sub-architect",
      name: "Hermes-Architect",
      role: "architect",
      task: "Watching island layout & planning sub-agent topology",
      tool: "spatial_plan",
    },
    {
      id: "sub-coder",
      name: "Hermes-Coder",
      role: "coder",
      task: "Standby at Hyperion Compute Node for code & build tasks",
      tool: "terminal",
    },
    {
      id: "sub-researcher",
      name: "Hermes-Researcher",
      role: "researcher",
      task: "Indexing live island feeds & external context",
      tool: "web_search",
    },
    {
      id: "sub-critic",
      name: "Hermes-Critic",
      role: "critic",
      task: "Verifying voxel geometry & sub-agent outputs",
      tool: "verify_audit",
    },
    {
      id: "sub-memory",
      name: "Hermes-Memory",
      role: "memory",
      task: "Maintaining ~/.hermes session & skill memory index",
      tool: "memory_store",
    },
    {
      id: "sub-runner",
      name: "Hermes-Runner",
      role: "tool_runner",
      task: "Patrolling transit loop & relaying tool calls",
      tool: "execute_tool",
    },
  ];

  return specs.map((sp) => {
    const st = stationForRole(sp.role);
    return {
      id: sp.id,
      name: sp.name,
      role: sp.role,
      status: "standby",
      task: sp.task,
      tool: sp.tool,
      progress: 0,
      stationId: st.id,
      stationLabel: st.label,
      x: st.x,
      z: st.z,
      targetX: st.x,
      targetZ: st.z,
      parentId: "hermes-prime",
      source: "island_runtime",
      output: "",
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      ephemeral: false,
    };
  });
}

interface DetectedLocalSessionAgent {
  id: string;
  name: string;
  role: HermesSubAgentRole;
  status: HermesSubAgentStatus;
  task: string;
  tool: string;
  progress: number;
  parentId?: string;
  sessionId: string;
}

function inspectLocalHermesHome(customHome?: string): {
  found: boolean;
  homePath: string | null;
  sessionCount: number;
  skillCount: number;
  memoryCount: number;
  recentSessionAgents: DetectedLocalSessionAgent[];
} {
  try {
    const candidate = customHome?.trim() || path.join(os.homedir(), ".hermes");
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      return {
        found: false,
        homePath: null,
        sessionCount: 0,
        skillCount: 0,
        memoryCount: 0,
        recentSessionAgents: [],
      };
    }
    const countEntries = (sub: string): number => {
      const p = path.join(candidate, sub);
      if (!fs.existsSync(p)) return 0;
      const st = fs.statSync(p);
      if (st.isDirectory()) return fs.readdirSync(p).length;
      return 1;
    };
    const sessionCount = countEntries("sessions");
    const skillCount = countEntries("skills");
    const memoryCount = countEntries("memories") + (fs.existsSync(path.join(candidate, "MEMORY.md")) ? 1 : 0);

    // Safely inspect recent active JSON session/agent state files in ~/.hermes/sessions
    const recentSessionAgents: DetectedLocalSessionAgent[] = [];
    const sessionsDir = path.join(candidate, "sessions");
    if (fs.existsSync(sessionsDir) && fs.statSync(sessionsDir).isDirectory()) {
      const cutoffMs = Date.now() - 30 * 60_000;
      const files = fs
        .readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".json"))
        .slice(0, 24);
      for (const fname of files) {
        const full = path.join(sessionsDir, fname);
        try {
          const st = fs.statSync(full);
          if (!st.isFile() || st.size > 65_536 || st.mtimeMs < cutoffMs) continue;
          const parsed = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
          const rawStatus = sanitizeHermesStatus(parsed.status, "standby");
          if (rawStatus === "standby") continue;
          const sessId = sanitizePlainText(parsed.id || fname.replace(/\.json$/, ""), 42, true);
          if (!sessId) continue;
          recentSessionAgents.push({
            id: `sess-${sessId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
            name: sanitizePlainText(parsed.name || parsed.agentName || sessId, 34, true) || sessId,
            role: sanitizeHermesRole(parsed.role, "orchestrator"),
            status: rawStatus,
            task: sanitizePlainText(parsed.task || parsed.prompt || "Local Hermes session", 200, true),
            tool: sanitizePlainText(parsed.tool || "hermes_cli", 44, true),
            progress: typeof parsed.progress === "number" ? parsed.progress : 45,
            parentId: typeof parsed.parentId === "string" ? parsed.parentId : "hermes-prime",
            sessionId: sessId,
          });
          if (Array.isArray(parsed.subagents)) {
            for (const sub of parsed.subagents.slice(0, 6)) {
              if (!sub || typeof sub !== "object") continue;
              const sr = sub as Record<string, unknown>;
              const subId = sanitizePlainText(sr.id, 42, true).replace(/[^a-zA-Z0-9_-]/g, "");
              if (!subId) continue;
              recentSessionAgents.push({
                id: subId,
                name: sanitizePlainText(sr.name, 34, true) || `Helper-${subId.slice(0, 6)}`,
                role: sanitizeHermesRole(sr.role, "tool_runner"),
                status: sanitizeHermesStatus(sr.status, "executing"),
                task: sanitizePlainText(sr.task, 200, true) || "Assisting local Hermes session",
                tool: sanitizePlainText(sr.tool, 44, true) || "hermes_tool",
                progress: typeof sr.progress === "number" ? sr.progress : 40,
                parentId: `sess-${sessId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
                sessionId: sessId,
              });
            }
          }
        } catch {
          // Ignore malformed or unreadable session file
        }
      }
    }

    return {
      found: true,
      homePath: candidate,
      sessionCount,
      skillCount,
      memoryCount,
      recentSessionAgents,
    };
  } catch {
    return {
      found: false,
      homePath: null,
      sessionCount: 0,
      skillCount: 0,
      memoryCount: 0,
      recentSessionAgents: [],
    };
  }
}

export class HermesRuntimeHub {
  private envGetter: () => AppEnv;
  private onBroadcast: (payload: unknown) => void;

  private version = 1;
  private leadAgent: HermesLeadAgentInfo;
  private localProbe: HermesLocalProbeResult;
  private subAgents: HermesSubAgent[];
  private logs: HermesLogEntry[] = [];
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private activeBuildRoleLock = false;
  private dispatchPlotIndex = 0;

  constructor(opts: {
    getEnv: () => AppEnv;
    onBroadcast: (payload: unknown) => void;
  }) {
    this.envGetter = opts.getEnv;
    this.onBroadcast = opts.onBroadcast;

    const now = Date.now();
    const env = this.envGetter();
    const defaultEndpoint = env.HERMES_AGENT_URL || "http://127.0.0.1:8642";
    const homeInfo = inspectLocalHermesHome(env.HERMES_HOME);

    this.leadAgent = {
      id: "hermes-prime",
      name: "Hermes Prime",
      status: "standby",
      currentTask: "Coordinating local Hermes runtime & sub-agent swarm",
      endpoint: defaultEndpoint,
      mode: "hybrid_swarm",
      model: "hermes-agent",
      cwd: homeInfo.homePath,
      activeSince: now,
      tasksCompleted: 0,
    };

    this.localProbe = {
      connected: homeInfo.found,
      endpoint: defaultEndpoint,
      transport: homeInfo.found ? "local_files" : "standby",
      latencyMs: null,
      models: [],
      hermesHomeFound: homeInfo.found,
      hermesHomePath: homeInfo.homePath,
      sessionCount: homeInfo.sessionCount,
      skillCount: homeInfo.skillCount,
      memoryCount: homeInfo.memoryCount,
      error: null,
      checkedAt: now,
    };

    this.subAgents = createInitialSubAgents(now);
    for (const sa of homeInfo.recentSessionAgents) {
      this.upsertExternalSubAgent(sa as unknown as Record<string, unknown>, "local_daemon");
    }
    this.appendLog({
      agentId: "hermes-prime",
      agentName: "Hermes Prime",
      role: "orchestrator",
      kind: "bridge",
      message: homeInfo.found
        ? `Detected ~/.hermes workspace (${homeInfo.skillCount} skills, ${homeInfo.sessionCount} sessions).`
        : `Hermes Island swarm initialized (${this.subAgents.length} sub-agents on standby).`,
    });

    // Non-blocking startup probe of configured local Hermes endpoint
    void this.probeLocalEndpoint(defaultEndpoint).catch(() => {});
  }

  private get env(): AppEnv {
    return this.envGetter();
  }

  private appendLog(entry: Omit<HermesLogEntry, "id" | "ts">): void {
    this.logs.unshift({
      id: `hlog-${Date.now().toString(36)}-${nodeCrypto.randomUUID().slice(0, 5)}`,
      ts: Date.now(),
      ...entry,
    });
    if (this.logs.length > 60) {
      this.logs.length = 60;
    }
  }

  private scheduleBroadcast(): void {
    this.version += 1;
    if (this.broadcastTimer !== null) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.onBroadcast({
        type: "hermes_state",
        hermes: this.getSnapshot(),
      });
    }, 65);
    this.broadcastTimer.unref?.();
  }

  public getSnapshot(): HermesStateSnapshot {
    return {
      version: this.version,
      leadAgent: { ...this.leadAgent },
      localProbe: { ...this.localProbe },
      subAgents: this.subAgents.map((a) => ({ ...a })),
      logs: this.logs.slice(0, 35),
    };
  }

  public async probeLocalEndpoint(requestedEndpoint?: string): Promise<HermesLocalProbeResult> {
    const env = this.env;
    const candidate = requestedEndpoint?.trim() || this.leadAgent.endpoint || env.HERMES_AGENT_URL || "http://127.0.0.1:8642";
    const validated = validateLocalHermesEndpoint(candidate, env.HERMES_AGENT_URL);
    const homeInfo = inspectLocalHermesHome(env.HERMES_HOME);
    const now = Date.now();

    if (!validated) {
      this.localProbe = {
        ...this.localProbe,
        connected: homeInfo.found,
        endpoint: candidate.slice(0, 120),
        transport: homeInfo.found ? "local_files" : "standby",
        latencyMs: null,
        hermesHomeFound: homeInfo.found,
        hermesHomePath: homeInfo.homePath,
        sessionCount: homeInfo.sessionCount,
        skillCount: homeInfo.skillCount,
        memoryCount: homeInfo.memoryCount,
        error: "Only local loopback endpoints (http://127.0.0.1:<port> or http://localhost:<port>) can be probed.",
        checkedAt: now,
      };
      this.scheduleBroadcast();
      return this.localProbe;
    }

    for (const sa of homeInfo.recentSessionAgents) {
      this.upsertExternalSubAgent(sa as unknown as Record<string, unknown>, "local_daemon");
    }

    this.leadAgent.endpoint = validated;
    const t0 = Date.now();
    let httpOk = false;
    let models: string[] = [];
    let remoteSubAgents: unknown[] = [];
    let lastError: string | null = null;

    const tryJsonFetch = async (urlPath: string, timeoutMs = 1100): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch(`${validated}${urlPath}`, {
          method: "GET",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: "application/json" },
        });
        if (!res.ok) return null;
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("json")) {
          httpOk = true;
          return {};
        }
        httpOk = true;
        return (await res.json()) as Record<string, unknown>;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Unreachable";
        return null;
      }
    };

    const [healthRes, modelsRes, subRes] = await Promise.all([
      tryJsonFetch("/health"),
      tryJsonFetch("/v1/models"),
      tryJsonFetch("/api/subagents"),
    ]);

    if (!httpOk) {
      await tryJsonFetch("/api/health");
    }

    if (modelsRes && Array.isArray(modelsRes.data)) {
      models = modelsRes.data
        .map((m) => (m && typeof m === "object" ? String((m as Record<string, unknown>).id || "") : ""))
        .filter(Boolean)
        .slice(0, 12);
    }

    if (subRes && Array.isArray(subRes.subagents)) {
      remoteSubAgents = subRes.subagents;
    } else if (subRes && Array.isArray(subRes.agents)) {
      remoteSubAgents = subRes.agents;
    }

    const latencyMs = httpOk ? Math.max(1, Date.now() - t0) : null;
    const connected = httpOk || homeInfo.found;

    this.localProbe = {
      connected,
      endpoint: validated,
      transport: httpOk ? "local_http" : homeInfo.found ? "local_files" : "standby",
      latencyMs,
      models,
      hermesHomeFound: homeInfo.found,
      hermesHomePath: homeInfo.homePath,
      sessionCount: homeInfo.sessionCount,
      skillCount: homeInfo.skillCount,
      memoryCount: homeInfo.memoryCount,
      error: httpOk ? null : lastError ? `No local HTTP listener at ${validated} (${lastError})` : null,
      checkedAt: Date.now(),
    };

    if (httpOk) {
      this.leadAgent.mode = "local_daemon";
      if (models[0]) this.leadAgent.model = models[0];
      if (healthRes && typeof healthRes.model === "string") {
        this.leadAgent.model = sanitizePlainText(healthRes.model, 64, true) || this.leadAgent.model;
      }
      this.appendLog({
        agentId: "hermes-prime",
        agentName: "Hermes Prime",
        role: "orchestrator",
        kind: "bridge",
        message: `Connected to local Hermes daemon at ${validated} (${latencyMs}ms).`,
      });
      for (const rawSub of remoteSubAgents.slice(0, 14)) {
        if (rawSub && typeof rawSub === "object") {
          this.upsertAgentWithHelpers(rawSub as Record<string, unknown>, "local_daemon");
        }
      }
    } else if (this.leadAgent.mode === "local_daemon") {
      this.leadAgent.mode = "hybrid_swarm";
    }

    this.scheduleBroadcast();
    return this.localProbe;
  }

  public recordHeartbeat(body: Record<string, unknown>): HermesStateSnapshot {
    const now = Date.now();
    const model = sanitizePlainText(body.model, 64, true);
    const task = sanitizePlainText(body.task || body.currentTask, 180, true);
    const cwd = sanitizePlainText(body.cwd, 140, true);
    const endpoint = typeof body.endpoint === "string" ? validateLocalHermesEndpoint(body.endpoint, this.env.HERMES_AGENT_URL) : null;

    if (model) this.leadAgent.model = model;
    if (task) this.leadAgent.currentTask = task;
    if (cwd) this.leadAgent.cwd = cwd;
    if (endpoint) this.leadAgent.endpoint = endpoint;
    if (body.status) {
      this.leadAgent.status = sanitizeHermesStatus(body.status, this.leadAgent.status);
    }
    this.leadAgent.mode = "local_daemon";
    this.localProbe.connected = true;
    this.localProbe.transport = "local_http";
    this.localProbe.checkedAt = now;
    this.localProbe.error = null;

    if (typeof body.sessionCount === "number" && Number.isFinite(body.sessionCount)) {
      this.localProbe.sessionCount = Math.max(0, Math.trunc(body.sessionCount));
    }
    if (typeof body.skillCount === "number" && Number.isFinite(body.skillCount)) {
      this.localProbe.skillCount = Math.max(0, Math.trunc(body.skillCount));
    }
    if (typeof body.memoryCount === "number" && Number.isFinite(body.memoryCount)) {
      this.localProbe.memoryCount = Math.max(0, Math.trunc(body.memoryCount));
    }

    // Optional batch array of working agents / helper sub-agents sent in heartbeat
    const batch = Array.isArray(body.agents)
      ? body.agents
      : Array.isArray(body.subAgents)
        ? body.subAgents
        : null;
    if (batch) {
      for (const item of batch.slice(0, 14)) {
        if (item && typeof item === "object") {
          this.upsertAgentWithHelpers(item as Record<string, unknown>, "local_daemon");
        }
      }
    }

    this.appendLog({
      agentId: "hermes-prime",
      agentName: this.leadAgent.name,
      role: "orchestrator",
      kind: "bridge",
      message: `Local Hermes heartbeat (${this.leadAgent.model})${task ? `: ${task}` : ""}`,
    });
    this.scheduleBroadcast();
    return this.getSnapshot();
  }

  public syncFromBrowserBridge(body: Record<string, unknown>): HermesStateSnapshot {
    const now = Date.now();
    const endpoint = sanitizePlainText(body.endpoint, 120, true) || this.leadAgent.endpoint;
    const connected = Boolean(body.connected);
    const latencyMs = typeof body.latencyMs === "number" && Number.isFinite(body.latencyMs) ? Math.max(1, Math.round(body.latencyMs)) : null;
    const models = Array.isArray(body.models)
      ? body.models.map((m) => sanitizePlainText(m, 64, true)).filter(Boolean).slice(0, 12)
      : [];

    this.leadAgent.endpoint = endpoint;
    this.leadAgent.mode = connected ? "browser_bridge" : "hybrid_swarm";
    if (models[0]) this.leadAgent.model = models[0];

    this.localProbe = {
      ...this.localProbe,
      connected: connected || this.localProbe.hermesHomeFound,
      endpoint,
      transport: connected ? "browser_bridge" : this.localProbe.hermesHomeFound ? "local_files" : "standby",
      latencyMs,
      models,
      error: connected ? null : sanitizePlainText(body.error, 160, true) || null,
      checkedAt: now,
    };

    if (Array.isArray(body.subAgents)) {
      for (const rawSub of body.subAgents.slice(0, 10)) {
        if (rawSub && typeof rawSub === "object") {
          this.upsertExternalSubAgent(rawSub as Record<string, unknown>, "browser_bridge");
        }
      }
    }

    if (connected) {
      this.appendLog({
        agentId: "hermes-prime",
        agentName: "Hermes Prime",
        role: "orchestrator",
        kind: "bridge",
        message: `Browser localhost bridge linked to ${endpoint} (${latencyMs ?? "?"}ms).`,
      });
    }

    this.scheduleBroadcast();
    return this.getSnapshot();
  }

  private computeClusterPositionForParent(
    parentId: string | null,
    selfId: string,
    fallbackStation: IslandStation,
  ): { x: number; z: number; stationLabel: string } {
    if (parentId && parentId !== "hermes-prime" && parentId !== selfId) {
      const parent = this.subAgents.find((a) => a.id === parentId);
      if (parent) {
        const siblingCount = this.subAgents.filter(
          (a) => a.id !== selfId && a.parentId === parentId,
        ).length;
        const angle = (siblingCount * 2.15 + 0.55) % (Math.PI * 2);
        const radius = 3.1;
        return {
          x: Number(Math.max(-140, Math.min(140, parent.targetX + Math.cos(angle) * radius)).toFixed(2)),
          z: Number(Math.max(-140, Math.min(140, parent.targetZ + Math.sin(angle) * radius)).toFixed(2)),
          stationLabel: `Helping ${parent.name}`,
        };
      }
    }
    return {
      x: fallbackStation.x,
      z: fallbackStation.z,
      stationLabel: fallbackStation.label,
    };
  }

  public upsertExternalSubAgent(
    raw: Record<string, unknown>,
    source: HermesAgentSource = "hook",
  ): HermesSubAgent {
    const now = Date.now();
    const id =
      sanitizePlainText(raw.id, 48, true).replace(/[^a-zA-Z0-9_-]/g, "") ||
      `sub-${now.toString(36)}-${nodeCrypto.randomUUID().slice(0, 4)}`;
    const role = sanitizeHermesRole(raw.role, "tool_runner");
    const st = stationForRole(role);
    const name = sanitizePlainText(raw.name, 36, true) || `Hermes-${role.replace(/_/g, " ")}`;
    const status = sanitizeHermesStatus(raw.status, "executing");
    const task = sanitizePlainText(raw.task, 220, true) || "Executing local Hermes sub-task";
    const tool = sanitizePlainText(raw.tool, 48, true) || "hermes_tool";
    const output = sanitizePlainText(raw.output, 1600, false);
    const sessionId = typeof raw.sessionId === "string" ? sanitizePlainText(raw.sessionId, 48, true) : undefined;
    const progress =
      typeof raw.progress === "number" && Number.isFinite(raw.progress)
        ? Math.max(0, Math.min(100, Math.round(raw.progress)))
        : status === "completed"
          ? 100
          : 35;

    const rawParentId =
      typeof raw.parentId === "string"
        ? sanitizePlainText(raw.parentId, 48, true).replace(/[^a-zA-Z0-9_-]/g, "")
        : undefined;
    const resolvedParentId =
      rawParentId && rawParentId !== id ? rawParentId : undefined;

    const existing = this.subAgents.find((a) => a.id === id);
    const nextParentId = resolvedParentId ?? existing?.parentId ?? "hermes-prime";
    const clustered = this.computeClusterPositionForParent(nextParentId, id, st);
    const hasCoords =
      typeof raw.x === "number" &&
      Number.isFinite(raw.x) &&
      typeof raw.z === "number" &&
      Number.isFinite(raw.z);
    const reqX = hasCoords ? Math.max(-145, Math.min(145, raw.x as number)) : clustered.x;
    const reqZ = hasCoords ? Math.max(-145, Math.min(145, raw.z as number)) : clustered.z;

    if (existing) {
      const wasCompleted = existing.status === "completed";
      existing.name = name;
      existing.role = role;
      existing.status = status;
      existing.task = task;
      existing.tool = tool;
      existing.progress = progress;
      existing.parentId = nextParentId;
      if (hasCoords || resolvedParentId) {
        existing.targetX = reqX;
        existing.targetZ = reqZ;
      }
      if (clustered.stationLabel && nextParentId !== "hermes-prime") {
        existing.stationLabel = clustered.stationLabel;
      }
      if (sessionId !== undefined) existing.sessionId = sessionId;
      if (output) existing.output = output;
      existing.source = source;
      existing.updatedAt = now;
      if (status === "completed" || status === "error") {
        existing.finishedAt = now;
        if (status === "completed" && !wasCompleted) {
          this.leadAgent.tasksCompleted += 1;
        }
      } else {
        existing.finishedAt = null;
      }
      this.appendLog({
        agentId: existing.id,
        agentName: existing.name,
        role: existing.role,
        kind: status === "completed" ? "result" : status === "error" ? "error" : "tool",
        message: `${task} [${tool}]`,
      });
      this.scheduleBroadcast();
      return existing;
    }

    const jitterAng = (this.subAgents.length * 2.39996) % (Math.PI * 2);
    const created: HermesSubAgent = {
      id,
      name,
      role,
      status,
      task,
      tool,
      progress,
      stationId: st.id,
      stationLabel: clustered.stationLabel,
      x: Number((reqX + Math.cos(jitterAng) * 1.9).toFixed(2)),
      z: Number((reqZ + Math.sin(jitterAng) * 1.9).toFixed(2)),
      targetX: reqX,
      targetZ: reqZ,
      parentId: nextParentId,
      ...(sessionId ? { sessionId } : {}),
      source,
      output,
      startedAt: now,
      updatedAt: now,
      finishedAt: status === "completed" || status === "error" ? now : null,
      ephemeral: true,
    };

    if (status === "completed") {
      this.leadAgent.tasksCompleted += 1;
    }

    // Keep bounded sub-agent list (max 24) by pruning oldest finished ephemeral agents
    if (this.subAgents.length >= 24) {
      const idx = this.subAgents.findIndex(
        (a) => a.ephemeral && (a.status === "completed" || a.status === "error"),
      );
      if (idx >= 0) this.subAgents.splice(idx, 1);
    }

    this.subAgents.push(created);
    const parentName =
      nextParentId && nextParentId !== "hermes-prime"
        ? this.subAgents.find((a) => a.id === nextParentId)?.name
        : null;
    this.appendLog({
      agentId: created.id,
      agentName: created.name,
      role: created.role,
      kind: "spawn",
      message: parentName
        ? `Spawned ${created.name} (${created.role}) helping ${parentName} — ${created.task}`
        : `Spawned ${created.name} (${created.role}) — ${created.task}`,
    });
    this.scheduleBroadcast();
    return created;
  }

  public upsertAgentWithHelpers(
    raw: Record<string, unknown>,
    source: HermesAgentSource = "hook",
  ): { agent: HermesSubAgent; helpers: HermesSubAgent[] } {
    const agent = this.upsertExternalSubAgent(raw, source);
    const helpers: HermesSubAgent[] = [];
    const rawHelpers = Array.isArray(raw.helpers)
      ? raw.helpers
      : Array.isArray(raw.subAgents)
        ? raw.subAgents
        : Array.isArray(raw.subagents)
          ? raw.subagents
          : [];
    for (const item of rawHelpers.slice(0, 8)) {
      if (!item || typeof item !== "object") continue;
      const helperRaw = { ...(item as Record<string, unknown>), parentId: agent.id };
      helpers.push(this.upsertExternalSubAgent(helperRaw, source));
    }
    return { agent, helpers };
  }

  public stopSubAgent(id: string): boolean {
    const target = this.subAgents.find((a) => a.id === id);
    if (!target) return false;
    const now = Date.now();
    if (target.ephemeral) {
      this.subAgents = this.subAgents.filter((a) => a.id !== id);
    } else {
      const st = stationForRole(target.role);
      target.status = "standby";
      target.progress = 0;
      target.targetX = st.x;
      target.targetZ = st.z;
      target.task = `Returned to ${st.label} standby`;
      target.finishedAt = now;
      target.updatedAt = now;
    }
    this.appendLog({
      agentId: target.id,
      agentName: target.name,
      role: target.role,
      kind: "result",
      message: `Stopped ${target.name} and returned to standby.`,
    });
    this.scheduleBroadcast();
    return true;
  }

  public notifyWorldBuildPhase(opts: {
    phase: "approving" | "sculpting" | "reviewing" | "refining" | "placing" | "done" | "failed";
    prompt: string;
    x?: number | null;
    z?: number | null;
    creationName?: string | null;
  }): void {
    const now = Date.now();
    const tx = typeof opts.x === "number" && Number.isFinite(opts.x) ? opts.x : 14;
    const tz = typeof opts.z === "number" && Number.isFinite(opts.z) ? opts.z : 10;
    const subject = sanitizePlainText(opts.creationName || opts.prompt || "voxel creation", 72, true);

    const architect = this.subAgents.find((a) => a.id === "sub-architect");
    const coder = this.subAgents.find((a) => a.id === "sub-coder");
    const critic = this.subAgents.find((a) => a.id === "sub-critic");

    if (opts.phase === "done" || opts.phase === "failed") {
      this.activeBuildRoleLock = false;
      this.leadAgent.status = "standby";
      this.leadAgent.currentTask =
        opts.phase === "done"
          ? `Placed "${subject}" onto Hermes Island`
          : "Coordinating local Hermes runtime & sub-agent swarm";
      if (opts.phase === "done") this.leadAgent.tasksCompleted += 1;
      for (const ag of [architect, coder, critic]) {
        if (!ag) continue;
        const st = stationForRole(ag.role);
        ag.status = "standby";
        ag.progress = 0;
        ag.targetX = st.x;
        ag.targetZ = st.z;
        ag.task = `Standby at ${st.label}`;
        ag.updatedAt = now;
      }
      this.appendLog({
        agentId: "hermes-prime",
        agentName: "Hermes Prime",
        role: "orchestrator",
        kind: opts.phase === "done" ? "result" : "error",
        message:
          opts.phase === "done"
            ? `Sub-agents finished sculpting "${subject}" at (${tx.toFixed(1)}, ${tz.toFixed(1)}).`
            : `Sculpt job halted for "${subject}".`,
      });
      this.scheduleBroadcast();
      return;
    }

    this.activeBuildRoleLock = true;
    this.leadAgent.status = "delegating";
    this.leadAgent.currentTask = `Orchestrating sub-agents to build "${subject}"`;

    if (architect) {
      architect.status = opts.phase === "approving" ? "thinking" : "executing";
      architect.task = `Planning 3D layout for "${subject}"`;
      architect.tool = "spatial_plan";
      architect.progress = opts.phase === "approving" ? 30 : 85;
      architect.targetX = tx - 2.6;
      architect.targetZ = tz - 2.2;
      architect.updatedAt = now;
    }
    if (coder) {
      coder.status = opts.phase === "sculpting" || opts.phase === "refining" ? "executing" : "thinking";
      coder.task = `Compiling voxel blueprint for "${subject}"`;
      coder.tool = "voxel_sculpt";
      coder.progress = opts.phase === "sculpting" ? 55 : opts.phase === "refining" ? 88 : 25;
      coder.targetX = tx + 2.8;
      coder.targetZ = tz - 1.8;
      coder.updatedAt = now;
    }
    if (critic) {
      critic.status = opts.phase === "reviewing" ? "executing" : "thinking";
      critic.task = `Auditing voxel geometry & grounding for "${subject}"`;
      critic.tool = "voxel_critic";
      critic.progress = opts.phase === "reviewing" ? 75 : 40;
      critic.targetX = tx;
      critic.targetZ = tz + 3.0;
      critic.updatedAt = now;
    }

    this.appendLog({
      agentId: opts.phase === "reviewing" ? "sub-critic" : "sub-coder",
      agentName: opts.phase === "reviewing" ? "Hermes-Critic" : "Hermes-Coder",
      role: opts.phase === "reviewing" ? "critic" : "coder",
      kind: "tool",
      message: `Phase ${opts.phase}: "${subject}" at plot (${tx.toFixed(0)}, ${tz.toFixed(0)})`,
    });
    this.scheduleBroadcast();
  }

  public async spawnSubAgentWithTask(opts: {
    name?: string;
    role?: string;
    task: string;
    parentId?: string;
    x?: number;
    z?: number;
  }): Promise<{ ok: true; subAgent: HermesSubAgent; snapshot: HermesStateSnapshot }> {
    const task = sanitizePlainText(opts.task, 260, true) || "Inspect island state and report findings";
    const role = sanitizeHermesRole(opts.role, "researcher");
    const st = stationForRole(role);
    const id = `sub-${Date.now().toString(36)}-${nodeCrypto.randomUUID().slice(0, 4)}`;
    const name = sanitizePlainText(opts.name, 36, true) || `Hermes-${role.charAt(0).toUpperCase()}${role.slice(1)}`;
    const parentId =
      opts.parentId && opts.parentId !== "hermes-prime"
        ? sanitizePlainText(opts.parentId, 48, true).replace(/[^a-zA-Z0-9_-]/g, "") || "hermes-prime"
        : "hermes-prime";

    const parentAgent = parentId !== "hermes-prime" ? this.subAgents.find((a) => a.id === parentId) : null;

    const payload: Record<string, unknown> = {
      id,
      name,
      role,
      status: "thinking",
      task,
      tool: `${role}_run`,
      progress: 18,
      parentId,
    };
    if (typeof opts.x === "number") payload.x = opts.x;
    else if (!parentAgent) payload.x = st.x;
    if (typeof opts.z === "number") payload.z = opts.z;
    else if (!parentAgent) payload.z = st.z;

    const subAgent = this.upsertExternalSubAgent(payload, "island_runtime");

    // Run real local daemon or Gemini-backed sub-agent execution in background
    void this.executeSingleSubAgent(subAgent.id, task, role, parentAgent || undefined);

    return {
      ok: true,
      subAgent,
      snapshot: this.getSnapshot(),
    };
  }

  private async executeSingleSubAgent(
    agentId: string,
    task: string,
    role: HermesSubAgentRole,
    parentAgent?: HermesSubAgent,
  ): Promise<void> {
    const env = this.env;
    const setStage = (status: HermesSubAgentStatus, progress: number, tool: string, output?: string) => {
      const ag = this.subAgents.find((a) => a.id === agentId);
      if (!ag) return;
      ag.status = status;
      ag.progress = progress;
      ag.tool = tool;
      if (output !== undefined) ag.output = output;
      ag.updatedAt = Date.now();
      if (status === "completed" || status === "error") {
        ag.finishedAt = Date.now();
      }
      this.scheduleBroadcast();
    };

    const parentHint = parentAgent
      ? `\nYou are helping ${parentAgent.name} (${parentAgent.role}) whose active task is: "${parentAgent.task}".`
      : "";

    try {
      // 1. Try local running Hermes HTTP endpoint if connected
      if (this.localProbe.connected && this.localProbe.transport === "local_http") {
        setStage("executing", 48, "local_hermes_rpc");
        try {
          const res = await fetch(`${this.leadAgent.endpoint}/v1/chat/completions`, {
            method: "POST",
            signal: AbortSignal.timeout(25_000),
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: this.leadAgent.model || "hermes-agent",
              messages: [
                {
                  role: "system",
                  content: `You are ${role} sub-agent of Hermes Agent.${parentHint} Respond concisely with actionable findings and tools used.`,
                },
                { role: "user", content: task },
              ],
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              choices?: { message?: { content?: string } }[];
              output?: string;
            };
            const text =
              data.choices?.[0]?.message?.content?.trim() ||
              data.output?.trim() ||
              "Completed via local Hermes daemon.";
            setStage("completed", 100, "local_hermes_rpc", text.slice(0, 1400));
            this.leadAgent.tasksCompleted += 1;
            this.appendLog({
              agentId,
              agentName: this.subAgents.find((a) => a.id === agentId)?.name || role,
              role,
              kind: "result",
              message: text.slice(0, 180),
            });
            this.scheduleBroadcast();
            return;
          }
        } catch {
          // Fall through to server-side runtime if local endpoint stopped responding
        }
      }

      // 2. Server-side Hermes sub-agent execution via Gemini API if configured
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        setStage(
          "error",
          0,
          "runtime_check",
          `No local Hermes HTTP listener detected at ${this.leadAgent.endpoint} and no server GEMINI_API_KEY is configured. Start a local Hermes daemon or connect via the Local tab.`,
        );
        this.appendLog({
          agentId,
          agentName: this.subAgents.find((a) => a.id === agentId)?.name || role,
          role,
          kind: "error",
          message: `Could not execute "${task.slice(0, 60)}" — no local Hermes endpoint or server key.`,
        });
        this.scheduleBroadcast();
        return;
      }

      setStage("executing", 55, `${role}_reason`);
      const res = await callGeminiWithFallbacks({
        apiKey,
        mode: "director",
        hydrogenModel: env.HYDROGEN_MODEL,
        hydrogenModels: env.HYDROGEN_MODELS,
        primaryModel: env.ARGON_MODEL,
        fallbackModel: env.FALLBACK_MODEL,
        systemPrompt: `You are a Hermes Agent sub-agent operating in the "${role}" role inside the Hermes Island workspace.${parentHint}
Return STRICT JSON:
{
  "toolUsed": "short_tool_name",
  "summary": "1-3 crisp factual sentences answering or completing the task",
  "nextStep": "optional short follow-up note"
}`,
        userText: `Sub-agent role: ${role}\nAssigned task: ${task}`,
        maxOutputTokens: 2048,
        maxCascadeMs: 25_000,
      });

      const toolUsed = sanitizePlainText(res.json.toolUsed, 40, true) || `${role}_tool`;
      const summary =
        sanitizePlainText(res.json.summary, 1200, false) ||
        "Sub-agent finished task.";
      setStage("completed", 100, toolUsed, summary);
      this.leadAgent.tasksCompleted += 1;
      this.appendLog({
        agentId,
        agentName: this.subAgents.find((a) => a.id === agentId)?.name || role,
        role,
        kind: "result",
        message: summary.slice(0, 180),
      });
      this.scheduleBroadcast();
    } catch (err) {
      const msg = redactSecrets(err, [env.GEMINI_API_KEY, env.CREATOR_HMAC_SECRET]);
      setStage("error", 0, "error", msg.slice(0, 260));
      this.appendLog({
        agentId,
        agentName: this.subAgents.find((a) => a.id === agentId)?.name || role,
        role,
        kind: "error",
        message: msg.slice(0, 160),
      });
      this.scheduleBroadcast();
    }
  }

  public async dispatchTask(opts: {
    prompt: string;
    preferredStation?: string;
  }): Promise<{
    ok: boolean;
    summary: string;
    spawnedIds: string[];
    modelUsed?: string;
    error?: string;
    snapshot: HermesStateSnapshot;
  }> {
    const prompt = sanitizePlainText(opts.prompt, 800, false);
    if (!prompt) {
      return { ok: false, summary: "", spawnedIds: [], error: "Enter a task for Hermes Agent.", snapshot: this.getSnapshot() };
    }

    const now = Date.now();
    this.leadAgent.status = "delegating";
    this.leadAgent.currentTask = prompt.slice(0, 180);

    // Allocate a visible Task Lead Agent on campus so users see the working agent + its helper sub-agents huddled together
    const stationChoices = HERMES_ISLAND_STATIONS.slice(1);
    const chosenStation =
      stationChoices[this.dispatchPlotIndex % stationChoices.length] ?? HERMES_ISLAND_STATIONS[1];
    this.dispatchPlotIndex += 1;

    const leadTaskAgent = this.upsertExternalSubAgent(
      {
        id: `agent-${now.toString(36)}`,
        name: `Task-Agent-${(this.dispatchPlotIndex).toString().padStart(2, "0")}`,
        role: chosenStation.role || "architect",
        status: "delegating",
        task: prompt.slice(0, 180),
        tool: "task_lead",
        progress: 15,
        x: chosenStation.x,
        z: chosenStation.z,
        parentId: "hermes-prime",
      },
      "island_runtime",
    );

    this.appendLog({
      agentId: "hermes-prime",
      agentName: "Hermes Prime",
      role: "orchestrator",
      kind: "dispatch",
      message: `Dispatched to ${leadTaskAgent.name}: "${prompt.slice(0, 130)}"`,
    });
    this.scheduleBroadcast();

    const env = this.env;
    const spawnedIds: string[] = [leadTaskAgent.id];

    // 1. If connected to a real local Hermes HTTP daemon, forward directly first
    if (this.localProbe.connected && this.localProbe.transport === "local_http") {
      try {
        const res = await fetch(`${this.leadAgent.endpoint}/v1/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(35_000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.leadAgent.model || "hermes-agent",
            messages: [
              {
                role: "system",
                content:
                  "You are Hermes Agent coordinating specialized sub-agents. Complete the user request and concisely list any sub-agent delegations.",
              },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
            model?: string;
          };
          const reply = data.choices?.[0]?.message?.content?.trim() || "Task completed by local Hermes daemon.";
          leadTaskAgent.status = "completed";
          leadTaskAgent.progress = 100;
          leadTaskAgent.output = reply.slice(0, 1400);
          leadTaskAgent.finishedAt = Date.now();
          leadTaskAgent.updatedAt = Date.now();
          this.leadAgent.status = "standby";
          this.leadAgent.tasksCompleted += 1;
          this.leadAgent.currentTask = `Completed: ${prompt.slice(0, 90)}`;
          this.appendLog({
            agentId: leadTaskAgent.id,
            agentName: leadTaskAgent.name,
            role: leadTaskAgent.role,
            kind: "result",
            message: reply.slice(0, 200),
          });
          this.scheduleBroadcast();
          return {
            ok: true,
            summary: reply,
            spawnedIds,
            modelUsed: data.model || this.leadAgent.model,
            snapshot: this.getSnapshot(),
          };
        }
      } catch {
        // Fall through to hybrid swarm execution
      }
    }

    // 2. Hybrid Swarm orchestration via Gemini API
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      leadTaskAgent.status = "error";
      leadTaskAgent.finishedAt = Date.now();
      leadTaskAgent.updatedAt = Date.now();
      this.leadAgent.status = "error";
      const errMsg = `No local Hermes daemon is reachable at ${this.leadAgent.endpoint} and GEMINI_API_KEY is not configured.`;
      leadTaskAgent.output = errMsg;
      this.appendLog({
        agentId: leadTaskAgent.id,
        agentName: leadTaskAgent.name,
        role: leadTaskAgent.role,
        kind: "error",
        message: errMsg,
      });
      this.scheduleBroadcast();
      return { ok: false, summary: "", spawnedIds, error: errMsg, snapshot: this.getSnapshot() };
    }

    try {
      const planRes = await callGeminiWithFallbacks({
        apiKey,
        mode: "director",
        hydrogenModel: env.HYDROGEN_MODEL,
        hydrogenModels: env.HYDROGEN_MODELS,
        primaryModel: env.ARGON_MODEL,
        fallbackModel: env.FALLBACK_MODEL,
        systemPrompt: `You are Hermes Prime coordinating a working Task Agent (${leadTaskAgent.name}) and helper Sub-Agents on Hermes Island.
Give the Task Agent a short descriptive team name (2-3 words max) and decompose the user's request into 2 to 3 focused helper sub-agent tasks, picking roles from: "architect", "coder", "researcher", "critic", "tool_runner", "memory".
Return STRICT JSON:
{
  "leadName": "Short Agent Name",
  "planNote": "short 1-sentence orchestration plan",
  "subTasks": [
    { "name": "Research-Helper", "role": "researcher", "tool": "web_search", "task": "focused helper task" }
  ]
}`,
        userText: prompt,
        maxOutputTokens: 2048,
        maxCascadeMs: 25_000,
      });

      const leadTitle = sanitizePlainText(planRes.json.leadName, 32, true);
      if (leadTitle) leadTaskAgent.name = leadTitle;
      leadTaskAgent.progress = 35;
      leadTaskAgent.status = "delegating";
      leadTaskAgent.updatedAt = Date.now();

      const rawTasks = Array.isArray(planRes.json.subTasks) ? planRes.json.subTasks.slice(0, 3) : [];
      const subTasks =
        rawTasks.length > 0
          ? rawTasks
          : [
              { name: "Research-Helper", role: "researcher", tool: "context_scan", task: `Analyze: ${prompt}` },
              { name: "Critic-Helper", role: "critic", tool: "plan_review", task: `Verify steps for: ${prompt}` },
            ];

      const activeHelpers: HermesSubAgent[] = [];
      for (let i = 0; i < subTasks.length; i++) {
        const item = subTasks[i] as Record<string, unknown>;
        const role = sanitizeHermesRole(item.role, i === 0 ? "researcher" : "architect");
        const angle = (i / subTasks.length) * Math.PI * 2 + 0.4;
        const subId = `sub-task-${now.toString(36)}-${i}`;
        const sub = this.upsertExternalSubAgent(
          {
            id: subId,
            name: sanitizePlainText(item.name, 36, true) || `Helper-${role}`,
            role,
            status: "executing",
            task: sanitizePlainText(item.task, 200, true) || prompt.slice(0, 140),
            tool: sanitizePlainText(item.tool, 40, true) || `${role}_tool`,
            progress: 35,
            parentId: leadTaskAgent.id,
            x: Number((leadTaskAgent.targetX + Math.cos(angle) * 3.1).toFixed(2)),
            z: Number((leadTaskAgent.targetZ + Math.sin(angle) * 3.1).toFixed(2)),
          },
          "island_runtime",
        );
        spawnedIds.push(sub.id);
        activeHelpers.push(sub);
      }

      // Execute helper sub-agents concurrently while they flank the Task Lead Agent
      const subResults = await Promise.all(
        activeHelpers.map(async (sub) => {
          try {
            const subRes = await callGeminiWithFallbacks({
              apiKey,
              mode: "director",
              hydrogenModel: env.HYDROGEN_MODEL,
              hydrogenModels: env.HYDROGEN_MODELS,
              primaryModel: env.ARGON_MODEL,
              fallbackModel: env.FALLBACK_MODEL,
              systemPrompt: `You are ${sub.name} (role: ${sub.role}), a Hermes helper sub-agent assisting ${leadTaskAgent.name}. Deliver a concise, concrete result for your helper sub-task in JSON: {"output": "2-4 crisp sentences"}`,
              userText: `Parent goal: ${prompt}\nAssisting agent: ${leadTaskAgent.name}\nYour helper task: ${sub.task}`,
              maxOutputTokens: 2048,
              maxCascadeMs: 25_000,
            });
            const outText =
              sanitizePlainText(subRes.json.output, 900, false) || "Helper sub-task completed.";
            sub.status = "completed";
            sub.progress = 100;
            sub.output = outText;
            sub.finishedAt = Date.now();
            sub.updatedAt = Date.now();
            this.appendLog({
              agentId: sub.id,
              agentName: sub.name,
              role: sub.role,
              kind: "result",
              message: outText.slice(0, 170),
            });
            this.scheduleBroadcast();
            return { name: sub.name, role: sub.role, output: outText };
          } catch (err) {
            sub.status = "error";
            sub.finishedAt = Date.now();
            sub.updatedAt = Date.now();
            sub.output = redactSecrets(err, [apiKey]);
            this.scheduleBroadcast();
            return { name: sub.name, role: sub.role, output: sub.output };
          }
        }),
      );

      // Synthesize final answer at Task Lead + Hermes Prime
      leadTaskAgent.status = "thinking";
      leadTaskAgent.progress = 80;
      leadTaskAgent.updatedAt = Date.now();
      this.leadAgent.status = "thinking";
      this.scheduleBroadcast();

      const synthRes = await callGeminiWithFallbacks({
        apiKey,
        mode: "director",
        hydrogenModel: env.HYDROGEN_MODEL,
        hydrogenModels: env.HYDROGEN_MODELS,
        primaryModel: env.ARGON_MODEL,
        fallbackModel: env.FALLBACK_MODEL,
        systemPrompt: `You are ${leadTaskAgent.name}, synthesizing outputs from your helper sub-agents for Hermes Prime. Return STRICT JSON: {"summary": "clear, direct final synthesis for the user"}`,
        userText: `User request: ${prompt}\n\nHelper sub-agent reports:\n${subResults.map((r) => `- ${r.name} (${r.role}): ${r.output}`).join("\n")}`,
        maxOutputTokens: 2048,
        maxCascadeMs: 22_000,
      });

      const finalSummary =
        sanitizePlainText(synthRes.json.summary, 1800, false) ||
        subResults.map((r) => `${r.name}: ${r.output}`).join("\n\n");

      leadTaskAgent.status = "completed";
      leadTaskAgent.progress = 100;
      leadTaskAgent.output = finalSummary;
      leadTaskAgent.finishedAt = Date.now();
      leadTaskAgent.updatedAt = Date.now();

      this.leadAgent.status = "standby";
      this.leadAgent.tasksCompleted += 1;
      this.leadAgent.currentTask = `Synthesized ${subResults.length} helper reports via ${leadTaskAgent.name}`;
      this.appendLog({
        agentId: leadTaskAgent.id,
        agentName: leadTaskAgent.name,
        role: leadTaskAgent.role,
        kind: "result",
        message: finalSummary.slice(0, 200),
      });
      this.scheduleBroadcast();

      return {
        ok: true,
        summary: finalSummary,
        spawnedIds,
        modelUsed: synthRes.modelUsed,
        snapshot: this.getSnapshot(),
      };
    } catch (err) {
      const msg = redactSecrets(err, [apiKey, env.CREATOR_HMAC_SECRET]);
      leadTaskAgent.status = "error";
      leadTaskAgent.output = msg.slice(0, 260);
      leadTaskAgent.finishedAt = Date.now();
      leadTaskAgent.updatedAt = Date.now();
      this.leadAgent.status = "error";
      this.leadAgent.currentTask = msg.slice(0, 140);
      this.appendLog({
        agentId: leadTaskAgent.id,
        agentName: leadTaskAgent.name,
        role: leadTaskAgent.role,
        kind: "error",
        message: msg.slice(0, 180),
      });
      this.scheduleBroadcast();
      return { ok: false, summary: "", spawnedIds, error: msg, snapshot: this.getSnapshot() };
    }
  }
}

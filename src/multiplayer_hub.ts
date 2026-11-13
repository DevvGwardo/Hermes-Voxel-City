import nodeCrypto from "node:crypto";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";

interface UpgradeIncomingRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface UpgradeSocket {
  write(chunk: string | Uint8Array): boolean;
  destroy(): void;
}
import { verifyWebSocketOrigin } from "./security";
import type {
  MultiplayerAnim,
  MultiplayerAppearance,
  MultiplayerEmoteKind,
  MultiplayerMode,
  MultiplayerPlayerState,
  MultiplayerPose,
  MultiplayerServerMessage,
  MultiplayerSocketAttachment,
} from "./types";

const MP_MAX_WS_BYTES = 2048;
const MP_STALE_TIMEOUT_MS = 120_000;
const MP_HTTP_SESSION_TTL_MS = 35_000;
const MP_POSE_WINDOW_MS = 1_000;
const MP_MAX_POSES_PER_WINDOW = 26;
const MP_MIN_PROFILE_INTERVAL_MS = 200;
const MP_MIN_EMOTE_INTERVAL_MS = 250;

const MP_VALID_ANIMS = new Set<MultiplayerAnim>([
  "idle",
  "walk",
  "run",
  "jump",
  "ride",
  "sit",
  "wave",
]);
const MP_VALID_EMOTES = new Set<MultiplayerEmoteKind>(["wave", "jump", "cheer"]);
const MP_RIDE_ID_RE = /^[a-zA-Z0-9_#-]+$/;
const MP_ROOM_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MP_STYLE_TOKEN_RE = /^[a-zA-Z0-9_-]{1,24}$/;
const MP_COLOR_TOKEN_RE = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z0-9_-]{1,24})$/;
const MP_CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;

const DEFAULT_MP_APPEARANCE: Readonly<MultiplayerAppearance> = {
  skin: "#f2c29b",
  hairStyle: "short",
  hairColor: "#3b281e",
  hatStyle: "none",
  hatColor: "#d9534f",
  eyeStyle: "classic",
  accessory: "none",
  accessoryColor: "#4a90d9",
  topStyle: "tee",
  topColor: "#3b82f6",
  bottomStyle: "jeans",
  bottomColor: "#1e3a5f",
  shoeColor: "#e5e7eb",
};

const DEFAULT_MP_POSE: Readonly<MultiplayerPose> = {
  mode: "walk",
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  vx: 0,
  vz: 0,
  anim: "idle",
  ride: null,
  seat: 0,
  room: null,
};

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function stripMpControlChars(raw: string): string {
  return raw.replace(MP_CONTROL_CHARS_RE, "");
}

function sanitizeMpName(raw: unknown, fallback = ""): string {
  if (typeof raw !== "string") return fallback;
  return stripMpControlChars(raw).replace(/\s+/g, " ").trim().slice(0, 16);
}

function sanitizeMpToken(raw: unknown, re: RegExp, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = stripMpControlChars(raw).trim().slice(0, 24);
  return re.test(cleaned) ? cleaned : fallback;
}

function sanitizeMpAppearance(
  raw: unknown,
  fallback: Readonly<MultiplayerAppearance> = DEFAULT_MP_APPEARANCE,
): MultiplayerAppearance {
  const obj = isPlainRecord(raw) ? raw : {};
  return {
    skin: sanitizeMpToken(obj.skin, MP_COLOR_TOKEN_RE, fallback.skin),
    hairStyle: sanitizeMpToken(obj.hairStyle, MP_STYLE_TOKEN_RE, fallback.hairStyle),
    hairColor: sanitizeMpToken(obj.hairColor, MP_COLOR_TOKEN_RE, fallback.hairColor),
    hatStyle: sanitizeMpToken(obj.hatStyle, MP_STYLE_TOKEN_RE, fallback.hatStyle),
    hatColor: sanitizeMpToken(obj.hatColor, MP_COLOR_TOKEN_RE, fallback.hatColor),
    eyeStyle: sanitizeMpToken(obj.eyeStyle, MP_STYLE_TOKEN_RE, fallback.eyeStyle),
    accessory: sanitizeMpToken(obj.accessory, MP_STYLE_TOKEN_RE, fallback.accessory),
    accessoryColor: sanitizeMpToken(obj.accessoryColor, MP_COLOR_TOKEN_RE, fallback.accessoryColor),
    topStyle: sanitizeMpToken(obj.topStyle, MP_STYLE_TOKEN_RE, fallback.topStyle),
    topColor: sanitizeMpToken(obj.topColor, MP_COLOR_TOKEN_RE, fallback.topColor),
    bottomStyle: sanitizeMpToken(obj.bottomStyle, MP_STYLE_TOKEN_RE, fallback.bottomStyle),
    bottomColor: sanitizeMpToken(obj.bottomColor, MP_COLOR_TOKEN_RE, fallback.bottomColor),
    shoeColor: sanitizeMpToken(obj.shoeColor, MP_COLOR_TOKEN_RE, fallback.shoeColor),
  };
}

function clampMpRound(
  raw: unknown,
  min: number,
  max: number,
  scale: number,
  fallback: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const clamped = Math.max(min, Math.min(max, raw));
  const rounded = Math.round(clamped * scale) / scale;
  return rounded === 0 ? 0 : rounded;
}

function sanitizeMpYaw(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const twoPi = Math.PI * 2;
  let v = raw;
  if (v < -twoPi || v > twoPi) {
    v = ((((v + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
  }
  const clamped = Math.max(-twoPi, Math.min(twoPi, v));
  const rounded = Math.round(clamped * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

function sanitizeMpOptionalId(
  raw: unknown,
  re: RegExp,
  fallback: string | null,
): string | null {
  if (raw === null || raw === "") return null;
  if (typeof raw === "string") {
    const cleaned = stripMpControlChars(raw).trim().slice(0, 48);
    return cleaned && re.test(cleaned) ? cleaned : null;
  }
  return fallback;
}

function sanitizeMpPose(
  raw: Record<string, unknown>,
  fallback: Readonly<MultiplayerPose> = DEFAULT_MP_POSE,
): MultiplayerPose {
  const mode: MultiplayerMode =
    raw.mode === "aerial" ? "aerial" : raw.mode === "walk" ? "walk" : fallback.mode;
  const anim: MultiplayerAnim =
    typeof raw.anim === "string" && MP_VALID_ANIMS.has(raw.anim as MultiplayerAnim)
      ? (raw.anim as MultiplayerAnim)
      : fallback.anim;
  const seat =
    typeof raw.seat === "number" && Number.isFinite(raw.seat)
      ? Math.max(0, Math.min(3, Math.trunc(raw.seat)))
      : fallback.seat;

  return {
    mode,
    x: clampMpRound(raw.x, -240, 240, 1000, fallback.x),
    y: clampMpRound(raw.y, -20, 600, 1000, fallback.y),
    z: clampMpRound(raw.z, -240, 240, 1000, fallback.z),
    yaw: sanitizeMpYaw(raw.yaw, fallback.yaw),
    pitch: clampMpRound(raw.pitch, -1.6, 1.6, 1000, fallback.pitch),
    vx: clampMpRound(raw.vx, -25, 25, 100, fallback.vx),
    vz: clampMpRound(raw.vz, -25, 25, 100, fallback.vz),
    anim,
    ride: sanitizeMpOptionalId(raw.ride, MP_RIDE_ID_RE, fallback.ride),
    seat,
    room: sanitizeMpOptionalId(raw.room, MP_ROOM_ID_RE, fallback.room),
  };
}

function toPublicPlayerState(state: MultiplayerSocketAttachment): MultiplayerPlayerState {
  return {
    id: state.id,
    name: state.name,
    appearance: state.appearance,
    mode: state.mode,
    x: state.x,
    y: state.y,
    z: state.z,
    yaw: state.yaw,
    pitch: state.pitch,
    vx: state.vx,
    vz: state.vz,
    anim: state.anim,
    ride: state.ride,
    seat: state.seat,
    room: state.room,
  };
}

interface ClientSession {
  sessionId: string;
  transport: "ws" | "http";
  ws: NodeWebSocket | null;
  outbox: unknown[];
  state: MultiplayerSocketAttachment;
  windowStartMs: number;
  windowCount: number;
  lastProfileMs: number;
  lastEmoteMs: number;
  lastPollMs: number;
}

/**
 * Dual-transport Multiplayer Hub for AI Studio Applets & Cloud Run:
 *  1. Native WebSocket (`/ws`) for instant low-latency avatar & world streaming.
 *  2. Automatic HTTP `/api/mp` fallback so multiplayer continues seamlessly even inside
 *     Service-Worker-proxied preview iframes where `Upgrade: websocket` may be intercepted.
 */
export class MultiplayerHub {
  private wss: WebSocketServer;
  private sessions = new Map<string, ClientSession>();
  private wsToSessionId = new Map<NodeWebSocket, string>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MP_MAX_WS_BYTES * 2 });

    this.wss.on("connection", (ws: NodeWebSocket) => {
      const session = this.createSession("ws", ws);
      this.wsToSessionId.set(ws, session.sessionId);

      ws.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        const raw = isBinary
          ? Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Buffer.from(data as ArrayBuffer).toString("utf8")
          : String(data);
        if (raw === "ping") {
          this.deliverToSession(session, { type: "pong" });
          return;
        }
        if (Buffer.byteLength(raw, "utf8") > MP_MAX_WS_BYTES) {
          this.destroySession(session.sessionId, 1009, "Message too large");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        this.handleClientEvent(session, parsed);
      });

      ws.on("close", () => {
        this.destroySession(session.sessionId);
      });

      ws.on("error", () => {
        this.destroySession(session.sessionId);
      });
    });

    this.cleanupTimer = setInterval(() => {
      this.pruneStaleHttpSessions();
    }, 8_000);
    this.cleanupTimer.unref?.();
  }

  public handleUpgrade(
    req: UpgradeIncomingRequest,
    socket: UpgradeSocket,
    head: Uint8Array,
  ): boolean {
    const rawUrl = req.url || "/";
    const pathname = rawUrl.split("?")[0];
    if (pathname !== "/ws") {
      return false;
    }

    const host = req.headers.host || "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const syntheticReq = new Request(`${proto}://${host}${rawUrl}`, {
      method: req.method || "GET",
      headers: Object.entries(req.headers).reduce<Record<string, string>>((acc, [k, v]) => {
        if (typeof v === "string") acc[k] = v;
        else if (Array.isArray(v)) acc[k] = v.join(", ");
        return acc;
      }, {}),
    });

    const originErr = verifyWebSocketOrigin(syntheticReq);
    if (originErr) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return true;
    }

    if (this.sessions.size >= 200) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.destroySession(oldest, 1000, "Connection rotation");
    }

    this.wss.handleUpgrade(
      req as Parameters<WebSocketServer["handleUpgrade"]>[0],
      socket as Parameters<WebSocketServer["handleUpgrade"]>[1],
      head as Parameters<WebSocketServer["handleUpgrade"]>[2],
      (ws: NodeWebSocket) => {
        this.wss.emit("connection", ws, req);
      },
    );
    return true;
  }

  public handleHttpSync(body: Record<string, unknown>): {
    ok: true;
    sessionId: string;
    messages: unknown[];
  } {
    const now = Date.now();
    const requestedId =
      typeof body.sessionId === "string" && /^mps-[a-zA-Z0-9_-]{8,48}$/.test(body.sessionId)
        ? body.sessionId
        : "";

    if (body.disconnect === true && requestedId) {
      this.destroySession(requestedId);
      return { ok: true, sessionId: requestedId, messages: [] };
    }

    let session = requestedId ? this.sessions.get(requestedId) : undefined;
    if (!session || session.transport !== "http") {
      if (this.sessions.size >= 200) {
        const oldest = this.sessions.keys().next().value;
        if (oldest) this.destroySession(oldest);
      }
      session = this.createSession("http", null);
    }
    session.lastPollMs = now;

    const events = Array.isArray(body.events) ? body.events.slice(0, 24) : [];
    for (const ev of events) {
      this.handleClientEvent(session, ev);
    }

    const messages = session.outbox.splice(0, session.outbox.length);
    return {
      ok: true,
      sessionId: session.sessionId,
      messages,
    };
  }

  public broadcastWorldEvent(payload: unknown): void {
    for (const session of this.sessions.values()) {
      this.deliverToSession(session, payload);
    }
  }

  public dispose(): void {
    clearInterval(this.cleanupTimer);
    for (const sid of [...this.sessions.keys()]) {
      this.destroySession(sid);
    }
    this.wss.close();
  }

  private createSession(transport: "ws" | "http", ws: NodeWebSocket | null): ClientSession {
    const now = Date.now();
    const sessionId = `mps-${nodeCrypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const playerId = `p-${nodeCrypto.randomUUID().slice(0, 8)}`;
    const session: ClientSession = {
      sessionId,
      transport,
      ws,
      outbox: [],
      state: {
        id: playerId,
        joined: false,
        connectedAt: now,
        lastSeenAt: now,
        name: "",
        appearance: { ...DEFAULT_MP_APPEARANCE },
        ...DEFAULT_MP_POSE,
      },
      windowStartMs: now,
      windowCount: 0,
      lastProfileMs: 0,
      lastEmoteMs: 0,
      lastPollMs: now,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private deliverToSession(session: ClientSession, payload: unknown): void {
    if (session.transport === "ws") {
      if (session.ws && session.ws.readyState === NodeWebSocket.OPEN) {
        try {
          session.ws.send(JSON.stringify(payload));
        } catch {
          // ignore
        }
      }
      return;
    }

    // Coalesce high-frequency pose updates per remote player in HTTP outbox so polling stays tiny
    if (isPlainRecord(payload) && payload.type === "mp_pose" && typeof payload.id === "string") {
      const existingIdx = session.outbox.findIndex(
        (m) => isPlainRecord(m) && m.type === "mp_pose" && m.id === payload.id,
      );
      if (existingIdx >= 0) {
        session.outbox[existingIdx] = payload;
        return;
      }
    }
    if (session.outbox.length >= 160) {
      session.outbox.shift();
    }
    session.outbox.push(payload);
  }

  private broadcastLocalExcept(excludeSessionId: string, payload: MultiplayerServerMessage): void {
    for (const peer of this.sessions.values()) {
      if (peer.sessionId === excludeSessionId) continue;
      if (!peer.state.joined) continue;
      this.deliverToSession(peer, payload);
    }
  }

  private collectLocalPeers(nowMs: number, excludeSessionId: string): MultiplayerPlayerState[] {
    const out: MultiplayerPlayerState[] = [];
    for (const peer of this.sessions.values()) {
      if (peer.sessionId === excludeSessionId) continue;
      if (!peer.state.joined) continue;
      if (nowMs - peer.state.lastSeenAt > MP_STALE_TIMEOUT_MS) continue;
      out.push(toPublicPlayerState(peer.state));
    }
    return out;
  }

  private applyLocalHello(session: ClientSession, parsed: Record<string, unknown>): void {
    const now = Date.now();
    const rawAppObj = isPlainRecord(parsed.appearance)
      ? parsed.appearance
      : typeof parsed.skin === "string"
        ? parsed
        : undefined;
    const rawAppName = rawAppObj ? rawAppObj.name : undefined;
    const nameSource = parsed.name !== undefined ? parsed.name : rawAppName;
    const nextPose = sanitizeMpPose(parsed, session.state);

    session.state = {
      ...session.state,
      joined: true,
      lastSeenAt: now,
      name: sanitizeMpName(nameSource, session.state.name),
      appearance: sanitizeMpAppearance(rawAppObj, session.state.appearance),
      ...nextPose,
    };

    const peers = this.collectLocalPeers(now, session.sessionId);
    const onlineCount = peers.length + 1;
    const welcome: MultiplayerServerMessage = {
      type: "mp_welcome",
      selfId: session.state.id,
      onlineCount,
      players: peers,
    };
    this.deliverToSession(session, welcome);
    this.broadcastLocalExcept(session.sessionId, {
      type: "mp_join",
      onlineCount,
      player: toPublicPlayerState(session.state),
    });
  }

  private handleClientEvent(session: ClientSession, rawEvent: unknown): void {
    if (!isPlainRecord(rawEvent) || typeof rawEvent.t !== "string") return;
    const now = Date.now();

    if (now - session.windowStartMs >= MP_POSE_WINDOW_MS) {
      session.windowStartMs = now;
      session.windowCount = 0;
    }
    session.windowCount += 1;
    if (session.windowCount > MP_MAX_POSES_PER_WINDOW) return;

    const t = rawEvent.t;
    if (t === "hello") {
      this.applyLocalHello(session, rawEvent);
      return;
    }

    if (t === "pose") {
      const nextPose = sanitizeMpPose(rawEvent, session.state);
      session.state = { ...session.state, ...nextPose, lastSeenAt: now };
      if (session.state.joined) {
        this.broadcastLocalExcept(session.sessionId, {
          type: "mp_pose",
          id: session.state.id,
          ...nextPose,
        });
      }
      return;
    }

    if (t === "profile") {
      if (now - session.lastProfileMs < MP_MIN_PROFILE_INTERVAL_MS) return;
      session.lastProfileMs = now;
      const rawAppObj = isPlainRecord(rawEvent.appearance)
        ? rawEvent.appearance
        : typeof rawEvent.skin === "string"
          ? rawEvent
          : undefined;
      const rawAppName = rawAppObj ? rawAppObj.name : undefined;
      const nameSource = rawEvent.name !== undefined ? rawEvent.name : rawAppName;
      const nextName =
        nameSource !== undefined ? sanitizeMpName(nameSource, session.state.name) : session.state.name;
      const nextAppearance =
        rawAppObj !== undefined
          ? sanitizeMpAppearance(rawAppObj, session.state.appearance)
          : session.state.appearance;

      session.state = {
        ...session.state,
        name: nextName,
        appearance: nextAppearance,
        lastSeenAt: now,
      };
      if (session.state.joined) {
        this.broadcastLocalExcept(session.sessionId, {
          type: "mp_profile",
          id: session.state.id,
          name: nextName,
          appearance: nextAppearance,
        });
      }
      return;
    }

    if (t === "emote") {
      if (
        typeof rawEvent.kind !== "string" ||
        !MP_VALID_EMOTES.has(rawEvent.kind as MultiplayerEmoteKind)
      ) {
        return;
      }
      if (now - session.lastEmoteMs < MP_MIN_EMOTE_INTERVAL_MS) return;
      session.lastEmoteMs = now;
      session.state.lastSeenAt = now;

      if (session.state.joined) {
        this.broadcastLocalExcept(session.sessionId, {
          type: "mp_emote",
          id: session.state.id,
          kind: rawEvent.kind as MultiplayerEmoteKind,
        });
      }
    }
  }

  private pruneStaleHttpSessions(): void {
    const now = Date.now();
    for (const [sid, session] of this.sessions.entries()) {
      if (session.transport === "http" && now - session.lastPollMs > MP_HTTP_SESSION_TTL_MS) {
        this.destroySession(sid);
      }
    }
  }

  private destroySession(sessionId: string, code = 1000, reason = ""): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);

    if (session.ws) {
      this.wsToSessionId.delete(session.ws);
      try {
        session.ws.close(code, reason);
      } catch {
        // ignore
      }
    }

    if (session.state.joined) {
      const remaining = this.collectLocalPeers(Date.now(), sessionId);
      this.broadcastLocalExcept(sessionId, {
        type: "mp_leave",
        id: session.state.id,
        onlineCount: remaining.length,
      });
    }
  }
}

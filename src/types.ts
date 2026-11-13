export type CreationCategory = "vehicle" | "creature" | "building" | "prop" | "aircraft" | "watercraft";
export type ScaleClass = "tiny" | "small" | "medium" | "large" | "colossal";

export type LiveFeedKind = "weather" | "surf" | "wind" | "time" | "moon" | "iss";

export interface LiveFeedSpec {
  kind: LiveFeedKind;
  place?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
}

export interface LiveFeedReading {
  kind: LiveFeedKind;
  badge: string;
  summary: string;
  value?: number;
  updatedAt: number;
}

export type VoxelPartKind =
  | "wheel"
  | "spinY"
  | "spinZ"
  | "spinX"
  | "bob"
  | "swingX"
  | "swingY"
  | "swingZ";

export type VoxelOp =
  | { op: "plinth"; sizeX: number; heightY: number; sizeZ: number; base: string; top: string; corner: string }
  | { op: "box"; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; color: string; emit?: number; mirrorX?: boolean }
  | { op: "roundedBox"; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; radius: number; color: string; emit?: number; mirrorX?: boolean }
  | { op: "clear"; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; mirrorX?: boolean }
  | { op: "hollowBox"; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; wall: number; color: string; trim?: string }
  | { op: "pillars"; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; color: string }
  | {
      op: "cylinder";
      axis?: "x" | "y" | "z";
      cx?: number;
      cy?: number;
      cz?: number;
      x0?: number;
      x1?: number;
      y0?: number;
      y1?: number;
      z0?: number;
      z1?: number;
      radius: number;
      color?: string;
      carve?: boolean;
      emit?: number;
      mirrorX?: boolean;
    }
  | {
      op: "ring";
      axis?: "x" | "y" | "z";
      cx?: number;
      cy?: number;
      cz?: number;
      x0?: number;
      x1?: number;
      y0?: number;
      y1?: number;
      z0?: number;
      z1?: number;
      outerR: number;
      innerR: number;
      color: string;
      emit?: number;
      mirrorX?: boolean;
    }
  | { op: "cone"; cx: number; y0: number; y1: number; cz: number; rBottom: number; rTop: number; color: string; emit?: number; mirrorX?: boolean }
  | { op: "sphere"; cx: number; cy: number; cz: number; rx: number; ry: number; rz: number; color?: string; carve?: boolean; emit?: number; mirrorX?: boolean }
  | { op: "dome"; cx: number; yBase: number; cz: number; radius: number; color: string; emit?: number; mirrorX?: boolean }
  | { op: "roofGable"; x0: number; yBase: number; z0: number; x1: number; z1: number; rise: number; axis: "x" | "z"; color: string; trim?: string }
  | { op: "roofPyramid"; x0: number; yBase: number; z0: number; x1: number; z1: number; color: string; trim?: string }
  | { op: "stairs"; x0: number; y0: number; z0: number; steps: number; width: number; dir: "+z" | "-z" | "+x" | "-x"; color: string }
  | { op: "arch"; cx: number; y0: number; cz: number; halfSpan: number; height: number; depth: number; axis: "x" | "z"; color: string }
  | { op: "line"; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; radius: number; color: string; emit?: number; mirrorX?: boolean }
  | { op: "voxels"; list: [number, number, number, string, number?][]; mirrorX?: boolean };

export interface VoxelPart {
  name: string;
  kind: VoxelPartKind;
  speed: number;
  amp?: number;
  phase?: number;
  pivot: [number, number, number];
  ops: VoxelOp[];
}

export interface BlueprintCriticReview {
  approved: boolean;
  score: number;
  attempts: number;
  summary?: string;
  reviewedAt: number;
}

export type InteractionKind =
  | "tic_tac_toe"
  | "connect_four"
  | "whack_a_mole"
  | "floor_piano"
  | "simon_synth"
  | "lights_out"
  | "step_sequencer"
  | "basketball_hoop"
  | "slot_machine"
  | "fireworks_mortar"
  | "tesla_coil"
  | "gravity_inverter"
  | "marble_run";

export interface BlueprintInteraction {
  kind: InteractionKind;
}

export interface VoxelBlueprint {
  version: 1;
  name: string;
  description: string;
  category: CreationCategory;
  scaleClass: ScaleClass;
  palette: Record<string, string>;
  ops: VoxelOp[];
  parts: VoxelPart[];
  liveFeed?: LiveFeedSpec | null;
  interaction?: BlueprintInteraction | null;
  criticReview?: BlueprintCriticReview;
  stats: {
    voxels: number;
    footprintX: number;
    footprintZ: number;
    maxY: number;
  };
}

export interface RouteStop {
  id: string;
  name: string;
  x: number;
  z: number;
  dwellSec: number;
  nearCreationId?: string;
}

export type CreationBehavior =
  | {
      type: "vehicle_route";
      speed: number;
      waypoints: [number, number][];
      stops: RouteStop[];
      loopMode?: "loop" | "pingpong";
      statusLine: string;
    }
  | {
      type: "wander";
      style: "walk" | "hop" | "trot" | "glide";
      speed: number;
      homeX: number;
      homeZ: number;
      radius: number;
      hoverHeight?: number;
      targets?: [number, number][];
      statusLine: string;
    }
  | {
      type: "fly_circle";
      speed: number;
      altitude: number;
      centerX: number;
      centerZ: number;
      radius: number;
      waypoints?: [number, number, number][];
      statusLine: string;
    }
  | {
      type: "water_float";
      speed: number;
      pondX: number;
      pondZ: number;
      radius: number;
      statusLine: string;
    }
  | {
      type: "landmark";
      facingYaw: number;
      activity: string;
      statusLine: string;
    };

export interface BlueprintAmendment {
  category?: CreationCategory;
  scaleClass?: ScaleClass;
  stripPlinth?: boolean;
  clearOps?: VoxelOp[];
  upsertParts?: VoxelPart[];
}

export interface WorldCreation {
  id: string;
  name: string;
  description: string;
  creatorPrompt?: string;
  category: CreationCategory;
  scaleClass: ScaleClass;
  x: number;
  z: number;
  yaw: number;
  blueprint: VoxelBlueprint;
  behavior: CreationBehavior;
  liveFeed?: LiveFeedSpec | null;
  integratedLevel: number;
  createdAt: number;
  isSeed?: boolean;
  isCompanion?: boolean;
  companionOfId?: string;
}

export type PathKind =
  | "road"
  | "cottage_road"
  | "footpath"
  | "dirt_trail"
  | "cobblestone"
  | "boardwalk"
  | "volcanic_trail";

export interface WorldPath {
  id: string;
  kind: PathKind;
  points: [number, number][];
  closed?: boolean;
}

export type TerrainBiomeKind =
  | "meadow_clover"
  | "sandy_shore"
  | "misty_moss"
  | "volcanic_basalt"
  | "snow_frost"
  | "stone_plaza"
  | "autumn_grove"
  | "desert_mesa";

export interface WorldTerrainZone {
  id: string;
  biome: TerrainBiomeKind;
  x: number;
  z: number;
  radius: number;
  intensity?: number;
}

export interface WorldProp {
  id: string;
  kind: "bus_stop" | "lamp_post" | "bench" | "pond" | "tree_cluster" | "flower_patch" | "signpost";
  x: number;
  z: number;
  yaw: number;
  label?: string;
  radius?: number;
}

export interface WorldVillager {
  id: string;
  name: string;
  role: "commuter" | "student" | "baker" | "gardener" | "artist" | "explorer";
  hatColor: string;
  shirtColor: string;
  homeX: number;
  homeZ: number;
  stops: [number, number][];
  usesTransit: boolean;
}

export interface BuildQueueJobInfo {
  jobId: string;
  status: "queued" | "sculpting" | "done" | "failed";
  phase?: "queued" | "approving" | "sculpting" | "reviewing" | "refining" | "placing";
  /** 0 when actively sculpting right now; >= 1 for your spot in the waiting queue */
  position: number;
  activeCount: number;
  queuedCount: number;
  etaSeconds: number;
  basedOnBuilds?: number;
  creationId?: string | null;
  creation?: WorldCreation | null;
  error?: string | null;
}

export interface WorldStateSnapshot {
  version: number;
  creations: WorldCreation[];
  paths: WorldPath[];
  props: WorldProp[];
  terrainZones: WorldTerrainZone[];
  villagers: WorldVillager[];
  contributorCount: number;
  contributionCount?: number;
  myCreationId: string | null;
  myActiveJob?: BuildQueueJobInfo | null;
  lastWeaveNote: string;
}

export type MultiplayerMode = "walk" | "aerial";

export type MultiplayerAnim = "idle" | "walk" | "run" | "jump" | "ride" | "sit" | "wave";

export type MultiplayerEmoteKind = "wave" | "jump" | "cheer";

export interface MultiplayerAppearance {
  skin: string;
  hairStyle: string;
  hairColor: string;
  hatStyle: string;
  hatColor: string;
  eyeStyle: string;
  accessory: string;
  accessoryColor: string;
  topStyle: string;
  topColor: string;
  bottomStyle: string;
  bottomColor: string;
  shoeColor: string;
}

export interface MultiplayerPose {
  mode: MultiplayerMode;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  anim: MultiplayerAnim;
  ride: string | null;
  seat: number;
  room: string | null;
}

export interface MultiplayerPlayerState extends MultiplayerPose {
  id: string;
  name: string;
  appearance: MultiplayerAppearance;
}

export interface MultiplayerSocketAttachment extends MultiplayerPlayerState {
  joined: boolean;
  connectedAt: number;
  lastSeenAt: number;
}

export type MultiplayerClientMessage =
  | ({
      t: "hello";
      name?: string;
      appearance?: Partial<MultiplayerAppearance>;
    } & Partial<MultiplayerPose>)
  | ({
      t: "pose";
    } & Partial<MultiplayerPose>)
  | {
      t: "profile";
      name?: string;
      appearance?: Partial<MultiplayerAppearance>;
    }
  | {
      t: "emote";
      kind: MultiplayerEmoteKind;
    };

export type MultiplayerServerMessage =
  | {
      type: "mp_welcome";
      selfId: string;
      onlineCount: number;
      players: MultiplayerPlayerState[];
    }
  | {
      type: "mp_join";
      onlineCount: number;
      player: MultiplayerPlayerState;
    }
  | ({
      type: "mp_pose";
      id: string;
    } & MultiplayerPose)
  | {
      type: "mp_profile";
      id: string;
      name: string;
      appearance: MultiplayerAppearance;
    }
  | {
      type: "mp_emote";
      id: string;
      kind: MultiplayerEmoteKind;
    }
  | {
      type: "mp_leave";
      id: string;
      onlineCount: number;
    };

export type TrafficIncidentReason =
  | "clash_gridlock"
  | "turnaround_blocked"
  | "building_obstruction"
  | "self_restored";

export interface TrafficIncidentRecord {
  id: string;
  vehicleId: string;
  peerVehicleId?: string | null;
  x: number;
  z: number;
  reason: TrafficIncidentReason;
  count: number;
  lastReportedAt: number;
}

export type HermesSubAgentRole =
  | "orchestrator"
  | "architect"
  | "coder"
  | "researcher"
  | "critic"
  | "tool_runner"
  | "memory"
  | "sculptor";

export type HermesSubAgentStatus =
  | "standby"
  | "thinking"
  | "executing"
  | "delegating"
  | "completed"
  | "error";

export type HermesAgentSource = "local_daemon" | "browser_bridge" | "hook" | "island_runtime";

export interface HermesSubAgent {
  id: string;
  name: string;
  role: HermesSubAgentRole;
  status: HermesSubAgentStatus;
  task: string;
  tool: string;
  progress: number;
  stationId: string;
  stationLabel: string;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  parentId: string | null;
  sessionId?: string | null;
  source: HermesAgentSource;
  output: string;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  ephemeral?: boolean;
}

export interface HermesLogEntry {
  id: string;
  ts: number;
  agentId: string;
  agentName: string;
  role: HermesSubAgentRole;
  kind: "dispatch" | "spawn" | "tool" | "result" | "error" | "bridge";
  message: string;
}

export interface HermesLocalProbeResult {
  connected: boolean;
  endpoint: string;
  transport: "local_http" | "local_files" | "browser_bridge" | "standby";
  latencyMs: number | null;
  models: string[];
  hermesHomeFound: boolean;
  hermesHomePath: string | null;
  sessionCount: number;
  skillCount: number;
  memoryCount: number;
  error: string | null;
  checkedAt: number;
}

export interface HermesLeadAgentInfo {
  id: string;
  name: string;
  status: HermesSubAgentStatus;
  currentTask: string;
  endpoint: string;
  mode: "local_daemon" | "browser_bridge" | "hybrid_swarm";
  model: string;
  cwd: string | null;
  activeSince: number;
  tasksCompleted: number;
}

export interface HermesStateSnapshot {
  version: number;
  leadAgent: HermesLeadAgentInfo;
  localProbe: HermesLocalProbeResult;
  subAgents: HermesSubAgent[];
  logs: HermesLogEntry[];
}



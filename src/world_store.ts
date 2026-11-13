import nodeCrypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import {
  approveBuildQueryWithOrchestrator,
  approveSculptedCreationWithOrchestrator,
  buildInitialIntegration,
  CITY_SIGN_POS,
  integrateCreationWithArgon,
  needsMobilityAmendment,
  weaveWorldCronWithArgon,
  type WorldPatch,
} from "./argon_director";
import { sculptWithArgon } from "./argon_sculptor";
import {
  checkIslandContentPolicy,
  DISALLOWED_CREATION_IDS,
  filterWorldCollectionsByPolicy,
  isCreationAllowedOnIsland,
} from "./content_policy";
import type { AppEnv } from "./env_types";
import {
  type BuildComplexityBucket,
  type BuildEtaTelemetrySummary,
  type BuildTelemetrySample,
  classifyBuildFeatures,
  estimateInitialBuildMs,
  estimateMultiSlotQueueEtaMs,
  estimateRemainingBuildMs,
  summarizeTelemetryStats,
} from "./eta_estimator";
import { buildGeminiModelCascade } from "./gemini_models";
import {
  formatDayKeyInTz,
  redactSecrets,
  safeLogError,
  sanitizePlainText,
} from "./security";
import { buildSeedWorld } from "./seed_world";
import {
  analyzeWorldTrafficCongestion,
  chooseLeastCongestedRoad,
  chooseSimCityPlot,
  computeIntelligentBuildingYaw,
  decongestWorldTraffic,
  ensureOuterRingRoad,
  getIslandInlandMargin,
  normalizeFactualDescription,
  nudgeWanderPointClearOfWorld,
  resolveTrafficIncidentsWithObserver,
  sanitizeWanderTargetsForWorld,
} from "./town_planner";
import type {
  BuildQueueJobInfo,
  TrafficIncidentReason,
  TrafficIncidentRecord,
  WorldCreation,
  WorldPath,
  WorldProp,
  WorldStateSnapshot,
  WorldTerrainZone,
  WorldVillager,
} from "./types";
import {
  alignLandmarksToFrontage,
  auditAndRepairWorldSpatial,
  auditBlueprintOverlaps,
  autoRepairBlueprintOverlaps,
  detectPathCrossings,
  distPointToPolyline2D,
  sampleCatmullRom2D,
} from "./voxel_audit";
import {
  applyBlueprintAmendment,
  getCreationFootprintRadius,
  normalizeAndGroundBlueprint,
} from "./voxel_dsl";
import { applyCuratedDistrictRelocations } from "./curated_district_relocations";
import { buildCompanionVehicleBlueprint } from "./world_landmarks_v16";

const MAX_CONCURRENT_SCULPTS = 3;
const MAX_QUEUE_DEPTH = 40;

export interface WorldCreationAuditEntry {
  id: string;
  name: string;
  clean: boolean;
  overlapCells: number;
  coplanarFaces: number;
  groundClips: number;
  partsCount: number;
}

export interface WorldAuditSummary {
  ok: true;
  clean: boolean;
  creationsChecked: number;
  blueprintConflicts: number;
  spatialConflicts: number;
  pathCrossings: number;
  totalAutoRepairs: number;
  lastAuditAt: number;
  lastAuditNote: string;
  creations: WorldCreationAuditEntry[];
}

export interface PlaceCreationInput {
  ipHash: string;
  cookieId: string;
  dayKey: string;
  creatorPrompt?: string;
  blueprintRaw: Record<string, unknown>;
  x?: number | null;
  z?: number | null;
  yaw?: number | null;
}

export type PlaceCreationResult =
  | { ok: true; creation: WorldCreation; world: WorldStateSnapshot }
  | { ok: false; alreadyPlaced?: boolean; myCreationId?: string; error: string };

export interface EnqueueBuildInput {
  ipHash: string;
  cookieId: string;
  dayKey: string;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  x?: number | null;
  z?: number | null;
  yaw?: number | null;
}

export type EnqueueBuildResult =
  | { ok: true; queued: true; job: BuildQueueJobInfo }
  | {
      ok: false;
      status: 400 | 403 | 429 | 503;
      alreadyPlaced?: boolean;
      myCreationId?: string;
      retryAfterSec?: number;
      error: string;
    };

interface BuildJobRecord {
  jobId: string;
  cookieId: string;
  ipHash: string;
  dayKey: string;
  status: "queued" | "sculpting" | "done" | "failed";
  phase: "queued" | "approving" | "sculpting" | "reviewing" | "refining" | "placing";
  round1Ms: number | null;
  hasImage: boolean;
  retryCount: number;
  nextRetryAt: number;
  prompt: string;
  imageBase64: string | null;
  imageMime: string | null;
  reqX: number | null;
  reqZ: number | null;
  reqYaw: number | null;
  simDelayMs: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  creationId: string | null;
  modelUsed: string | null;
  errorMsg: string | null;
  errorDetail: string | null;
}

export interface SanitizedBuildJobDiagnostic {
  jobId: string;
  status: "done" | "failed";
  phase: string;
  hasImage: boolean;
  complexity: BuildComplexityBucket;
  round1Ms: number | null;
  durationMs: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  modelUsed: string | null;
  failureKind?: "safety_policy" | "upstream_or_timeout";
  errorMsg?: string | null;
  errorDetail?: string | null;
}

export interface BuildDiagnosticsSummary {
  modelCascade: string[];
  fallbackRate: number;
  countsLast36h: {
    done: number;
    failed: number;
    active: number;
    queued: number;
  };
  recentFailures: SanitizedBuildJobDiagnostic[];
  recentCompleted: SanitizedBuildJobDiagnostic[];
}

interface CreatorBuildRecord {
  creationId: string;
  cookieId: string;
  dayKey: string;
  createdAt: number;
}

interface PersistedWorldFile {
  version: number;
  creations: WorldCreation[];
  paths: WorldPath[];
  props: WorldProp[];
  terrainZones: WorldTerrainZone[];
  villagers: WorldVillager[];
  contributorCount: number;
  lastWeaveNote: string;
  lastWeaveAt: number;
  lastWeaveCount: number;
  lastAuditAt: number;
  lastAuditNote: string;
  totalAutoRepairs: number;
  creatorBuilds: CreatorBuildRecord[];
  telemetry: BuildTelemetrySample[];
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const len2 = vx * vx + vz * vz;
  if (len2 < 0.001) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2));
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}

function loadBundledLiveSeed(): Partial<PersistedWorldFile> | null {
  const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
  const candidates = [
    path.join(currentDir, "data", "live_world_seed.json"),
    path.resolve(process.cwd(), "src", "data", "live_world_seed.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8")) as Partial<PersistedWorldFile>;
      }
    } catch {
      // Fall through to next candidate
    }
  }
  return null;
}

export type BuildPhaseHookInfo = {
  phase: "approving" | "sculpting" | "reviewing" | "refining" | "placing" | "done" | "failed";
  prompt: string;
  x?: number | null;
  z?: number | null;
  creationName?: string | null;
};

export class WorldStore {
  private envGetter: () => AppEnv;
  private onBroadcast: (payload: unknown) => void;
  private onBuildPhase?: (info: BuildPhaseHookInfo) => void;
  private persistPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight = false;
  private savePending = false;

  private version = 1;
  private creations: WorldCreation[] = [];
  private paths: WorldPath[] = [];
  private props: WorldProp[] = [];
  private terrainZones: WorldTerrainZone[] = [];
  private villagers: WorldVillager[] = [];
  private baseContributorCount = 101;
  private lastWeaveNote = "Hermes Island swarm humming quietly in the sun.";
  private lastWeaveAt = Date.now();
  private lastWeaveCount = 0;
  private lastAuditAt = Date.now();
  private lastAuditNote = "Verified clean";
  private totalAutoRepairs = 0;

  private creatorBuilds: CreatorBuildRecord[] = [];
  private telemetry: BuildTelemetrySample[] = [];
  private jobs: BuildJobRecord[] = [];
  private activeJobPromises = new Map<string, Promise<void>>();
  private integrationQueue = new Set<string>();
  private integrationRunning = false;
  private rateLimits = new Map<string, { count: number; windowStart: number }>();
  private trafficIncidents = new Map<string, TrafficIncidentRecord>();
  private observerWeaveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastObserverWeaveAt = 0;

  constructor(opts: {
    getEnv: () => AppEnv;
    onBroadcast: (payload: unknown) => void;
    onBuildPhase?: (info: BuildPhaseHookInfo) => void;
    persistPath?: string;
  }) {
    this.envGetter = opts.getEnv;
    this.onBroadcast = opts.onBroadcast;
    this.onBuildPhase = opts.onBuildPhase;
    this.persistPath =
      opts.persistPath ||
      opts.getEnv().WORLD_STATE_PATH ||
      path.join(os.tmpdir(), "geminisland-aistudio-world-v1.json");

    this.initFromSeedAndDisk();
  }

  private get env(): AppEnv {
    return this.envGetter();
  }

  private initFromSeedAndDisk(): void {
    const bundled = loadBundledLiveSeed();
    if (bundled && Array.isArray(bundled.creations) && bundled.creations.length > 0) {
      this.version = Number(bundled.version) || 2382;
      this.creations = bundled.creations;
      this.paths = Array.isArray(bundled.paths) ? bundled.paths : [];
      this.props = Array.isArray(bundled.props) ? bundled.props : [];
      this.terrainZones = Array.isArray(bundled.terrainZones) ? bundled.terrainZones : [];
      this.villagers = Array.isArray(bundled.villagers) ? bundled.villagers : [];
      this.baseContributorCount = Number(bundled.contributorCount) || 101;
      this.lastWeaveNote =
        typeof bundled.lastWeaveNote === "string" && bundled.lastWeaveNote
          ? bundled.lastWeaveNote
          : this.lastWeaveNote;
      this.lastWeaveCount = this.creations.length;
    } else {
      const fallbackSeed = buildSeedWorld();
      this.creations = fallbackSeed.creations;
      this.paths = fallbackSeed.paths;
      this.props = fallbackSeed.props;
      this.terrainZones = fallbackSeed.terrainZones;
      this.villagers = fallbackSeed.villagers;
      this.lastWeaveNote = fallbackSeed.lastWeaveNote;
      this.baseContributorCount = 0;
      this.lastWeaveCount = this.creations.length;
    }

    // Overlay persisted state if present on disk
    try {
      if (fs.existsSync(this.persistPath)) {
        const disk = JSON.parse(fs.readFileSync(this.persistPath, "utf8")) as Partial<PersistedWorldFile>;
        if (Array.isArray(disk.creations) && disk.creations.length > 0) {
          const byId = new Map(this.creations.map((c) => [c.id, c]));
          for (const dc of disk.creations) {
            if (dc && typeof dc.id === "string") byId.set(dc.id, dc);
          }
          this.creations = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        }
        if (Array.isArray(disk.paths) && disk.paths.length >= this.paths.length) {
          this.paths = disk.paths;
        }
        if (Array.isArray(disk.props) && disk.props.length >= this.props.length) {
          this.props = disk.props;
        }
        if (Array.isArray(disk.terrainZones) && disk.terrainZones.length > 0) {
          this.terrainZones = disk.terrainZones.slice(0, 28);
        }
        if (Array.isArray(disk.villagers) && disk.villagers.length > 0) {
          this.villagers = disk.villagers;
        }
        if (Array.isArray(disk.creatorBuilds)) {
          this.creatorBuilds = disk.creatorBuilds;
        }
        if (Array.isArray(disk.telemetry)) {
          this.telemetry = disk.telemetry.slice(0, 150);
        }
        if (typeof disk.version === "number" && disk.version > this.version) {
          this.version = disk.version;
        }
        if (typeof disk.lastWeaveNote === "string" && disk.lastWeaveNote) {
          this.lastWeaveNote = disk.lastWeaveNote;
        }
      }
    } catch {
      // Ignore corrupted temp cache and retain clean bundled world
    }

    const curatedChanged = applyCuratedDistrictRelocations({
      creations: this.creations,
      paths: this.paths,
      props: this.props,
      terrainZones: this.terrainZones,
      villagers: this.villagers,
    });

    // Enforce island content & brand/political neutrality policy on loaded world state
    const policyFiltered = filterWorldCollectionsByPolicy({
      creations: this.creations,
      paths: this.paths,
      props: this.props,
    });
    this.creations = policyFiltered.creations;
    this.paths = policyFiltered.paths;
    this.props = policyFiltered.props;

    // Ensure spatial & voxel overlap audit runs on loaded world state (matching WorldDO initialization)
    this.auditAndRepairWorld();

    if (curatedChanged) {
      this.version += 1;
      this.schedulePersist();
    }
  }

  private schedulePersist(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushPersist();
    }, 350);
    this.saveTimer.unref?.();
  }

  private async flushPersist(): Promise<void> {
    if (this.saveInFlight) {
      this.savePending = true;
      return;
    }
    this.saveInFlight = true;
    try {
      const payload: PersistedWorldFile = {
        version: this.version,
        creations: this.creations,
        paths: this.paths,
        props: this.props,
        terrainZones: this.terrainZones,
        villagers: this.villagers,
        contributorCount: this.baseContributorCount,
        lastWeaveNote: this.lastWeaveNote,
        lastWeaveAt: this.lastWeaveAt,
        lastWeaveCount: this.lastWeaveCount,
        lastAuditAt: this.lastAuditAt,
        lastAuditNote: this.lastAuditNote,
        totalAutoRepairs: this.totalAutoRepairs,
        creatorBuilds: this.creatorBuilds,
        telemetry: this.telemetry,
      };
      const dir = path.dirname(this.persistPath);
      await fsPromises.mkdir(dir, { recursive: true });
      const tmp = `${this.persistPath}.${process.pid}.tmp`;
      await fsPromises.writeFile(tmp, JSON.stringify(payload), "utf8");
      await fsPromises.rename(tmp, this.persistPath);
    } catch {
      // Ephemeral filesystem errors are non-fatal; in-memory state stays authoritative
    } finally {
      this.saveInFlight = false;
      if (this.savePending) {
        this.savePending = false;
        this.schedulePersist();
      }
    }
  }

  private readBaseWorld(): Omit<WorldStateSnapshot, "myCreationId"> {
    const localDistinctCookies = new Set(this.creatorBuilds.map((cb) => cb.cookieId)).size;
    const contributorCount = this.baseContributorCount + localDistinctCookies;
    const contributionCount = this.creations.filter((c) => !c.isSeed && !c.isCompanion).length;

    return {
      version: this.version,
      creations: this.creations,
      paths: this.paths,
      props: this.props,
      terrainZones: this.terrainZones,
      villagers: this.villagers,
      contributorCount,
      contributionCount,
      lastWeaveNote: this.lastWeaveNote,
    };
  }

  public lookupTodayCreation(cookieId: string, dayKey: string): string | null {
    if (!cookieId || !dayKey) return null;
    for (let i = this.creatorBuilds.length - 1; i >= 0; i--) {
      const cb = this.creatorBuilds[i];
      if (cb.cookieId === cookieId && cb.dayKey === dayKey) {
        return cb.creationId;
      }
    }
    return null;
  }

  public getWorldSnapshot(cookieId: string, dayKey: string): WorldStateSnapshot {
    const base = this.readBaseWorld();
    const myCreationId = this.lookupTodayCreation(cookieId, dayKey);
    const myActiveJob = !myCreationId ? this.lookupActiveJobForCookie(cookieId, dayKey) : null;
    return {
      ...base,
      myCreationId,
      myActiveJob,
    };
  }

  private auditAndRepairWorld(): { repairedCount: number; repairs: string[] } {
    const repairs: string[] = [];

    if (ensureOuterRingRoad(this.paths)) {
      repairs.push("added outer ring road beltway");
    }

    for (const c of this.creations) {
      const res = autoRepairBlueprintOverlaps(c.blueprint);
      if (res.repairsApplied.length > 0) {
        c.blueprint = res.blueprint;
        repairs.push(...res.repairsApplied.map((r) => `${c.id}: ${r}`));
      }
    }

    const spatial = auditAndRepairWorldSpatial(this.creations, this.paths, this.props);
    if (
      spatial.report.footpathTrimCount > 0 ||
      spatial.report.pathCrossingsFixed > 0 ||
      spatial.report.redundantPathsRemoved > 0 ||
      spatial.report.propNudgeCount > 0
    ) {
      this.paths = spatial.paths;
      this.props = spatial.props;
      if (spatial.report.footpathTrimCount > 0) {
        repairs.push(`trimmed ${spatial.report.footpathTrimCount} footpath overlap(s)`);
      }
      if (spatial.report.pathCrossingsFixed > 0) {
        repairs.push(`resolved ${spatial.report.pathCrossingsFixed} path crossing(s)`);
      }
    }

    const roadPaths = this.paths.filter((p) => p.kind === "road" && p.points.length >= 2);
    if (roadPaths.length > 0) {
      const roadCurves = roadPaths.map((p) => ({
        path: p,
        curve: sampleCatmullRom2D(p.points, Boolean(p.closed), p.closed ? 14 : 10),
      }));
      const mainLoopEntry =
        roadCurves.find((r) => r.path.id === "path-main-loop") ?? roadCurves[0];
      let vehIdx = 0;

      for (const c of this.creations) {
        if (c.behavior?.type !== "vehicle_route") continue;
        const myVehSlot = vehIdx++;
        const isPingPong = c.behavior.loopMode === "pingpong";
        const minWps = isPingPong ? 2 : 4;
        const maxTol = isPingPong ? 4.4 : 3.2;
        const wps = c.behavior.waypoints ?? [];
        const hasOffRoad =
          wps.length < minWps ||
          wps.some(
            ([wx, wz]) =>
              !roadCurves.some((rc) => distPointToPolyline2D(wx, wz, rc.curve).dist <= maxTol),
          );
        if (hasOffRoad) {
          const chosenRoad =
            chooseLeastCongestedRoad(c.x, c.z, "road", this.creations, this.paths, c.id) ??
            mainLoopEntry.path;
          const isClosedRoad = Boolean(chosenRoad.closed) && chosenRoad.points.length >= 4;
          const basePts = chosenRoad.points;
          const shift = isClosedRoad
            ? (myVehSlot * Math.floor(basePts.length / 2)) % basePts.length
            : 0;
          const alignedWps: [number, number][] = basePts.map((_, idx) => {
            const p = basePts[(idx + shift) % basePts.length];
            return [p[0], p[1]];
          });
          c.x = alignedWps[0][0];
          c.z = alignedWps[0][1];
          c.behavior = {
            ...c.behavior,
            loopMode: isClosedRoad ? "loop" : "pingpong",
            waypoints: alignedWps,
          };
          repairs.push(`aligned vehicle "${c.name}" (${c.id}) onto ${chosenRoad.id}`);
        }
      }
    }

    const decong = decongestWorldTraffic(this.creations, this.paths);
    if (decong.changedIds.length > 0) {
      repairs.push(...decong.notes);
    }

    const activeIncidents = this.getActiveTrafficIncidents();
    const obsRes = resolveTrafficIncidentsWithObserver(
      this.creations,
      this.paths,
      activeIncidents,
    );
    if (obsRes.resolvedIncidentIds.length > 0) {
      for (const rid of obsRes.resolvedIncidentIds) {
        this.trafficIncidents.delete(rid);
      }
    }
    if (obsRes.changedIds.length > 0) {
      repairs.push(...obsRes.notes);
    }

    const frontage = alignLandmarksToFrontage(this.creations, this.paths);
    if (frontage.changedIds.length > 0) {
      repairs.push(`aligned ${frontage.changedIds.length} frontage(s)`);
    }

    for (const c of this.creations) {
      if (c.behavior?.type !== "wander") continue;
      const existingTargets = Array.isArray(c.behavior.targets) ? c.behavior.targets : [];
      const sanitizedTargets = sanitizeWanderTargetsForWorld(
        c,
        c.behavior.style,
        existingTargets,
        this.creations,
        this.props,
      );
      const [cleanHomeX, cleanHomeZ] = nudgeWanderPointClearOfWorld(
        c.behavior.homeX ?? c.x,
        c.behavior.homeZ ?? c.z,
        c,
        c.behavior.style,
        this.creations,
        this.props,
      );
      const [cleanX, cleanZ] = nudgeWanderPointClearOfWorld(
        c.x,
        c.z,
        c,
        c.behavior.style,
        this.creations,
        this.props,
      );
      const targetsChanged = JSON.stringify(existingTargets) !== JSON.stringify(sanitizedTargets);
      const posChanged =
        Math.hypot(cleanHomeX - (c.behavior.homeX ?? c.x), cleanHomeZ - (c.behavior.homeZ ?? c.z)) > 0.15 ||
        Math.hypot(cleanX - c.x, cleanZ - c.z) > 0.15;
      if (targetsChanged || posChanged) {
        c.x = cleanX;
        c.z = cleanZ;
        c.behavior = {
          ...c.behavior,
          homeX: cleanHomeX,
          homeZ: cleanHomeZ,
          targets: sanitizedTargets,
        };
        repairs.push(`routed wanderer "${c.name}" (${c.id}) cleanly around obstacles`);
      }
    }

    this.lastAuditAt = Date.now();
    if (repairs.length > 0) {
      this.totalAutoRepairs += repairs.length;
      this.lastAuditNote = `Auto-repaired ${repairs.length} overlap(s): ${repairs.slice(0, 3).join(" | ")}`;
      this.version += 1;
      this.schedulePersist();
    }
    return { repairedCount: repairs.length, repairs };
  }

  public getWorldAuditReport(): WorldAuditSummary {
    let blueprintConflicts = 0;
    const creationEntries: WorldCreationAuditEntry[] = [];

    for (const c of this.creations) {
      const r = auditBlueprintOverlaps(c.blueprint);
      blueprintConflicts += r.totalConflicts;
      creationEntries.push({
        id: c.id,
        name: c.name,
        clean: r.clean,
        overlapCells: r.overlapCells,
        coplanarFaces: r.coplanarFaces,
        groundClips: r.groundClips,
        partsCount: c.blueprint.parts.length,
      });
    }

    const spatial = auditAndRepairWorldSpatial(this.creations, this.paths, this.props);
    const crossings = detectPathCrossings(this.paths);
    const spatialConflicts =
      spatial.report.footpathTrimCount +
      spatial.report.pathCrossingsFixed +
      spatial.report.redundantPathsRemoved +
      spatial.report.propNudgeCount +
      crossings.count;

    return {
      ok: true,
      clean: blueprintConflicts === 0 && spatialConflicts === 0,
      creationsChecked: this.creations.length,
      blueprintConflicts,
      spatialConflicts,
      pathCrossings: crossings.count,
      totalAutoRepairs: this.totalAutoRepairs,
      lastAuditAt: this.lastAuditAt,
      lastAuditNote: this.lastAuditNote,
      creations: creationEntries,
    };
  }

  public runWorldAuditAndRepair(): {
    repairedCount: number;
    repairs: string[];
    audit: WorldAuditSummary;
  } {
    const res = this.auditAndRepairWorld();
    if (res.repairedCount > 0) {
      this.onBroadcast({
        type: "world_updated",
        note: "",
        world: { ...this.readBaseWorld(), myCreationId: null },
      });
    }
    return {
      repairedCount: res.repairedCount,
      repairs: res.repairs,
      audit: this.getWorldAuditReport(),
    };
  }

  public recordBuildTelemetry(sample: {
    durationMs: number;
    round1Ms: number;
    hadRefinementPass: boolean;
    usedFallback: boolean;
    hasImage: boolean;
    complexity: BuildComplexityBucket;
    scaleClass?: string | null;
  }): void {
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 4_000 || sample.durationMs > 240_000) {
      return;
    }
    const totalMs = Math.round(sample.durationMs);
    const r1Ms = Math.max(1_000, Math.min(totalMs, Math.round(sample.round1Ms || totalMs)));
    this.telemetry.unshift({
      durationMs: totalMs,
      round1Ms: r1Ms,
      hadRefinementPass: sample.hadRefinementPass,
      usedFallback: sample.usedFallback,
      hasImage: sample.hasImage,
      complexity: sample.complexity,
      createdAt: Date.now(),
    });
    if (this.telemetry.length > 150) {
      this.telemetry.length = 150;
    }
    this.schedulePersist();
  }

  public getBuildEtaTelemetry(): BuildEtaTelemetrySummary {
    return summarizeTelemetryStats(this.telemetry);
  }

  public getBuildDiagnostics(): BuildDiagnosticsSummary {
    const fallbackCount = this.telemetry.filter((s) => s.usedFallback).length;
    const fallbackRate =
      this.telemetry.length > 0 ? Number((fallbackCount / this.telemetry.length).toFixed(3)) : 0;

    const counts = { done: 0, failed: 0, active: 0, queued: 0 };
    for (const j of this.jobs) {
      if (j.status === "done") counts.done++;
      else if (j.status === "failed") counts.failed++;
      else if (j.status === "sculpting") counts.active++;
      else if (j.status === "queued") counts.queued++;
    }

    const toDiag = (j: BuildJobRecord, status: "done" | "failed"): SanitizedBuildJobDiagnostic => {
      const feat = classifyBuildFeatures(j.prompt, j.hasImage);
      const durationMs =
        j.startedAt !== null && j.finishedAt !== null && j.finishedAt >= j.startedAt
          ? j.finishedAt - j.startedAt
          : null;
      const rawErrMsg = j.errorMsg
        ? redactSecrets(j.errorMsg, [
            this.env.GEMINI_API_KEY,
            this.env.CREATOR_HMAC_SECRET,
          ])
        : null;
      const isSafetyRejection =
        typeof rawErrMsg === "string" &&
        /^(I cannot|That creation doesn't fit|Let's keep (?:our shared meadow|GeminIsland)|GeminIsland is a welcoming|Please try creating something family-friendly)/i.test(
          rawErrMsg.trim(),
        );
      return {
        jobId: j.jobId,
        status,
        phase: j.phase,
        hasImage: j.hasImage,
        complexity: feat.complexity,
        round1Ms: j.round1Ms,
        durationMs,
        createdAt: j.createdAt,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        modelUsed: j.modelUsed,
        ...(status === "failed"
          ? {
              failureKind: isSafetyRejection ? "safety_policy" : "upstream_or_timeout",
              errorMsg: isSafetyRejection ? "Blocked by family-friendly safety filter." : rawErrMsg,
              errorDetail: j.errorDetail
                ? redactSecrets(j.errorDetail, [
                    this.env.GEMINI_API_KEY,
                    this.env.CREATOR_HMAC_SECRET,
                  ])
                : null,
            }
          : {}),
      };
    };

    const recentFailures = this.jobs
      .filter((j) => j.status === "failed")
      .slice(-10)
      .reverse()
      .map((j) => toDiag(j, "failed"));
    const recentCompleted = this.jobs
      .filter((j) => j.status === "done" && j.simDelayMs === null)
      .slice(-8)
      .reverse()
      .map((j) => toDiag(j, "done"));

    return {
      modelCascade: buildGeminiModelCascade({
        mode: "sculpt",
        hydrogenModel: this.env.HYDROGEN_MODEL,
        hydrogenModels: this.env.HYDROGEN_MODELS,
        primaryModel: this.env.ARGON_MODEL,
        fallbackModel: this.env.FALLBACK_MODEL,
      }),
      fallbackRate,
      countsLast36h: counts,
      recentFailures,
      recentCompleted,
    };
  }

  private checkWindowBucket(
    bucket: string,
    maxCount: number,
    windowMs: number,
    now: number,
  ): { allowed: boolean; retryAfterSec?: number } {
    const row = this.rateLimits.get(bucket);
    if (!row || now - row.windowStart > windowMs) {
      return { allowed: true };
    }
    if (row.count >= maxCount) {
      return {
        allowed: false,
        retryAfterSec: Math.max(5, Math.ceil((windowMs - (now - row.windowStart)) / 1000)),
      };
    }
    return { allowed: true };
  }

  private incrementWindowBucket(bucket: string, windowMs: number, now: number): void {
    if (this.rateLimits.size > 2048) {
      for (const [k, v] of this.rateLimits.entries()) {
        if (now - v.windowStart > 25 * 60 * 60 * 1000) this.rateLimits.delete(k);
      }
    }
    const row = this.rateLimits.get(bucket);
    if (!row || now - row.windowStart > windowMs) {
      this.rateLimits.set(bucket, { count: 1, windowStart: now });
      return;
    }
    row.count += 1;
  }

  private computeJobInfo(target: BuildJobRecord): BuildQueueJobInfo {
    const now = Date.now();
    const sculptingRows = this.jobs.filter((j) => j.status === "sculpting");
    const queuedRows = this.jobs.filter((j) => j.status === "queued");
    const activeCount = sculptingRows.length;
    const queuedCount = queuedRows.length;

    if (target.status === "done") {
      const creation = target.creationId
        ? (this.creations.find((c) => c.id === target.creationId) ?? null)
        : null;
      return {
        jobId: target.jobId,
        status: "done",
        position: 0,
        activeCount,
        queuedCount,
        etaSeconds: 0,
        creationId: target.creationId,
        creation,
      };
    }

    if (target.status === "failed") {
      return {
        jobId: target.jobId,
        status: "failed",
        position: 0,
        activeCount,
        queuedCount,
        etaSeconds: 0,
        ...(target.creationId ? { creationId: target.creationId } : {}),
        error: target.errorMsg || "Could not sculpt that right now — try again.",
      };
    }

    const targetFeatures = classifyBuildFeatures(target.prompt, target.hasImage);

    if (target.status === "sculpting" || (target.status === "queued" && target.retryCount > 0)) {
      const elapsed = Math.max(0, now - (target.startedAt ?? target.createdAt ?? now));
      const activePhase: "approving" | "sculpting" | "reviewing" | "refining" =
        target.phase === "refining"
          ? "refining"
          : target.phase === "reviewing"
            ? "reviewing"
            : target.phase === "approving"
              ? "approving"
              : "sculpting";
      const remainingMs =
        typeof target.simDelayMs === "number" && target.simDelayMs > 0
          ? Math.max(1_500, target.simDelayMs - elapsed)
          : estimateRemainingBuildMs({
              elapsedMs: elapsed,
              phase: activePhase,
              round1Ms: target.round1Ms,
              features: targetFeatures,
              history: this.telemetry,
            });
      return {
        jobId: target.jobId,
        status: "sculpting",
        phase: activePhase,
        position: 0,
        activeCount,
        queuedCount,
        etaSeconds: Math.max(3, Math.ceil(remainingMs / 1000)),
        basedOnBuilds: this.telemetry.length,
      };
    }

    const activeSlots = sculptingRows.map((r) => ({
      elapsedMs: Math.max(0, now - (r.startedAt ?? now)),
      phase: r.phase,
      round1Ms: r.round1Ms,
      simDelayMs: r.simDelayMs,
      features: classifyBuildFeatures(r.prompt, r.hasImage),
    }));

    const queuedItems = queuedRows.map((r) => ({
      jobId: r.jobId,
      simDelayMs: r.simDelayMs,
      features: classifyBuildFeatures(r.prompt, r.hasImage),
    }));

    const sim = estimateMultiSlotQueueEtaMs({
      workerConcurrency: MAX_CONCURRENT_SCULPTS,
      activeSlots,
      queuedItems,
      targetJobId: target.jobId,
      targetFallbackFeatures: targetFeatures,
      history: this.telemetry,
    });

    return {
      jobId: target.jobId,
      status: "queued",
      phase: "queued",
      position: sim.position,
      activeCount,
      queuedCount,
      etaSeconds: Math.max(4, Math.ceil(sim.totalEtaMs / 1000)),
      basedOnBuilds: this.telemetry.length,
    };
  }

  private lookupActiveJobForCookie(cookieId: string, dayKey: string): BuildQueueJobInfo | null {
    if (!cookieId) return null;
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      if (
        j.cookieId === cookieId &&
        j.dayKey === dayKey &&
        (j.status === "queued" || j.status === "sculpting")
      ) {
        return this.computeJobInfo(j);
      }
    }
    return null;
  }

  public getBuildJobStatus(
    jobId: string | null | undefined,
    cookieId: string,
    dayKey: string,
  ): { job: BuildQueueJobInfo | null; world?: WorldStateSnapshot } {
    let found: BuildJobRecord | null = null;
    if (jobId) {
      found = this.jobs.find((j) => j.jobId === jobId) ?? null;
    }
    if (!found && cookieId && dayKey) {
      for (let i = this.jobs.length - 1; i >= 0; i--) {
        const j = this.jobs[i];
        if (j.cookieId === cookieId && j.dayKey === dayKey) {
          found = j;
          break;
        }
      }
    }
    if (!found) return { job: null };
    const job = this.computeJobInfo(found);
    if (job.status === "done") {
      return {
        job,
        world: this.getWorldSnapshot(cookieId || found.cookieId, dayKey || found.dayKey),
      };
    }
    return { job };
  }

  public async enqueueBuildJob(input: EnqueueBuildInput): Promise<EnqueueBuildResult> {
    const now = Date.now();
    // Prune completed/failed jobs older than 36h
    if (this.jobs.length > 120) {
      const cutoff = now - 36 * 60 * 60 * 1000;
      this.jobs = this.jobs.filter(
        (j) => j.status === "queued" || j.status === "sculpting" || j.createdAt >= cutoff,
      );
    }

    const existingTodayId = this.lookupTodayCreation(input.cookieId, input.dayKey);
    if (existingTodayId) {
      return {
        ok: false,
        status: 403,
        alreadyPlaced: true,
        myCreationId: existingTodayId,
        error: "You've already added your creation for today — come back tomorrow to add another!",
      };
    }

    if (input.prompt) {
      const policyCheck = checkIslandContentPolicy(input.prompt);
      if (!policyCheck.allowed) {
        return {
          ok: false,
          status: 400,
          error: policyCheck.reason,
        };
      }
    }

    const existingJob = this.lookupActiveJobForCookie(input.cookieId, input.dayKey);
    if (existingJob) {
      void this.pumpBuildQueue();
      return { ok: true, queued: true, job: existingJob };
    }

    const activeTotal = this.jobs.filter(
      (j) => j.status === "queued" || j.status === "sculpting",
    ).length;
    if (activeTotal >= MAX_QUEUE_DEPTH) {
      return {
        ok: false,
        status: 429,
        retryAfterSec: 20,
        error: "The GeminIsland build queue is full right now — please try again in 20 seconds.",
      };
    }

    const visitorWindowMs = 15 * 60 * 1000;
    const cidCheck = this.checkWindowBucket(`gen_cid:${input.cookieId}`, 8, visitorWindowMs, now);
    if (!cidCheck.allowed) {
      return {
        ok: false,
        status: 429,
        retryAfterSec: cidCheck.retryAfterSec,
        error: `Please wait ${cidCheck.retryAfterSec ?? 45}s before trying again.`,
      };
    }
    this.incrementWindowBucket(`gen_cid:${input.cookieId}`, visitorWindowMs, now);

    const jobId = `job-${now.toString(36)}-${nodeCrypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    const record: BuildJobRecord = {
      jobId,
      cookieId: input.cookieId,
      ipHash: input.ipHash || "",
      dayKey: input.dayKey,
      status: "queued",
      phase: "queued",
      round1Ms: null,
      hasImage: Boolean(input.imageBase64 && input.imageMimeType),
      retryCount: 0,
      nextRetryAt: 0,
      prompt: input.prompt,
      imageBase64: input.imageBase64 ?? null,
      imageMime: input.imageMimeType ?? null,
      reqX: typeof input.x === "number" && Number.isFinite(input.x) ? input.x : null,
      reqZ: typeof input.z === "number" && Number.isFinite(input.z) ? input.z : null,
      reqYaw: typeof input.yaw === "number" && Number.isFinite(input.yaw) ? input.yaw : null,
      simDelayMs: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      creationId: null,
      modelUsed: null,
      errorMsg: null,
      errorDetail: null,
    };
    this.jobs.push(record);

    await this.pumpBuildQueue();
    return { ok: true, queued: true, job: this.computeJobInfo(record) };
  }

  public async enqueueDevSimulatedBatch(
    items: {
      cookieId: string;
      prompt: string;
      delayMs: number;
      refineAfterMs?: number;
      placeBlueprint?: Record<string, unknown> | null;
    }[],
    dayKey: string,
  ): Promise<BuildQueueJobInfo[]> {
    const now = Date.now();
    const created: BuildJobRecord[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rec: BuildJobRecord = {
        jobId: `simjob-${now.toString(36)}-${i}-${nodeCrypto.randomUUID().slice(0, 4)}`,
        cookieId: it.cookieId,
        ipHash: "sim",
        dayKey,
        status: "queued",
        phase: "queued",
        round1Ms:
          typeof it.refineAfterMs === "number" && it.refineAfterMs > 0
            ? Math.round(it.refineAfterMs)
            : null,
        hasImage: false,
        retryCount: 0,
        nextRetryAt: 0,
        prompt: it.prompt,
        imageBase64: it.placeBlueprint ? JSON.stringify(it.placeBlueprint) : null,
        imageMime: "__dev_sim_bp__",
        reqX: null,
        reqZ: null,
        reqYaw: null,
        simDelayMs: Math.max(800, Math.min(30_000, it.delayMs)),
        createdAt: now + i,
        startedAt: null,
        finishedAt: null,
        creationId: null,
        modelUsed: null,
        errorMsg: null,
        errorDetail: null,
      };
      this.jobs.push(rec);
      created.push(rec);
    }
    await this.pumpBuildQueue();
    return created.map((r) => this.computeJobInfo(r));
  }

  private broadcastQueueTick(): void {
    const avgMs = estimateInitialBuildMs(
      { complexity: "standard", hasImage: false },
      this.telemetry,
    );
    const sculpting = this.jobs
      .filter((j) => j.status === "sculpting")
      .map((j) => ({
        jobId: j.jobId,
        phase: j.phase,
        startedAt: j.startedAt || Date.now(),
        expectedMs:
          typeof j.simDelayMs === "number" && j.simDelayMs > 0
            ? j.simDelayMs
            : estimateInitialBuildMs(
                classifyBuildFeatures(j.prompt, j.hasImage),
                this.telemetry,
              ),
      }));
    const queuedIds = this.jobs.filter((j) => j.status === "queued").map((j) => j.jobId);

    this.onBroadcast({
      type: "queue_tick",
      activeCount: sculpting.length,
      sculpting,
      queuedIds,
      avgSculptMs: avgMs,
    });
  }

  private async pumpBuildQueue(): Promise<void> {
    let promoted = false;
    const now = Date.now();

    for (const j of this.jobs) {
      if (
        j.status === "sculpting" &&
        j.startedAt !== null &&
        j.startedAt < now - 150_000 &&
        !this.activeJobPromises.has(j.jobId)
      ) {
        j.status = "queued";
        j.phase = "sculpting";
        j.retryCount += 1;
        j.nextRetryAt = 0;
      }
    }

    while (this.activeJobPromises.size < MAX_CONCURRENT_SCULPTS) {
      const nowReady = Date.now();
      const next = this.jobs.find(
        (j) =>
          j.status === "queued" &&
          j.nextRetryAt <= nowReady &&
          !this.activeJobPromises.has(j.jobId),
      );
      if (!next) break;

      next.status = "sculpting";
      next.phase = "approving";
      next.startedAt = next.startedAt ?? Date.now();
      promoted = true;

      const p = this.runSingleBuildJob(next).finally(() => {
        this.activeJobPromises.delete(next.jobId);
        void this.pumpBuildQueue();
      });
      this.activeJobPromises.set(next.jobId, p);
    }

    if (promoted) {
      this.broadcastQueueTick();
    }
  }

  private async runSingleBuildJob(job: BuildJobRecord): Promise<void> {
    const t0 = Date.now();
    try {
      if (job.imageMime === "__dev_sim_bp__" && job.simDelayMs) {
        if (typeof job.round1Ms === "number" && job.round1Ms > 0 && job.round1Ms < job.simDelayMs) {
          await new Promise((r) => setTimeout(r, job.round1Ms!));
          job.phase = "refining";
          this.broadcastQueueTick();
          await new Promise((r) => setTimeout(r, job.simDelayMs! - job.round1Ms!));
        } else {
          await new Promise((r) => setTimeout(r, job.simDelayMs!));
        }
        let creationId: string | null = null;
        if (job.imageBase64) {
          const bpRaw = JSON.parse(job.imageBase64) as Record<string, unknown>;
          const placed = await this.placeCreation({
            ipHash: job.ipHash,
            cookieId: job.cookieId,
            dayKey: job.dayKey,
            creatorPrompt: job.prompt,
            blueprintRaw: bpRaw,
            x: job.reqX,
            z: job.reqZ,
            yaw: job.reqYaw,
          });
          if (placed.ok) creationId = placed.creation.id;
        }
        job.status = "done";
        job.finishedAt = Date.now();
        job.creationId = creationId;
        job.imageBase64 = null;
        job.imageMime = null;
        this.broadcastQueueTick();
        return;
      }

      const apiKey = this.env.GEMINI_API_KEY;
      if (!apiKey) {
        job.status = "failed";
        job.finishedAt = Date.now();
        job.errorMsg = "Sculpting service requires GEMINI_API_KEY.";
        job.imageBase64 = null;
        this.broadcastQueueTick();
        return;
      }

      const hasImg = Boolean(job.hasImage || (job.imageBase64 && job.imageMime));
      const features = classifyBuildFeatures(job.prompt, hasImg);

      // Step 1: Orchestration Agent double-check & approval gate on EVERY query (text + image)
      job.phase = "approving";
      this.onBuildPhase?.({ phase: "approving", prompt: job.prompt, x: job.reqX, z: job.reqZ });
      this.broadcastQueueTick();

      const queryApproval = await approveBuildQueryWithOrchestrator({
        prompt: job.prompt,
        imageBase64: job.imageBase64 ?? undefined,
        imageMimeType: job.imageMime ?? undefined,
        apiKey,
        hydrogenModel: this.env.HYDROGEN_MODEL,
        hydrogenModels: this.env.HYDROGEN_MODELS,
        primaryModel: this.env.ARGON_MODEL,
        fallbackModel: this.env.FALLBACK_MODEL,
      });

      if (!queryApproval.approved) {
        if (queryApproval.retryable && job.retryCount < 3) {
          const nextRetries = job.retryCount + 1;
          const retryDelayMs = Math.min(6_000, 1_500 * nextRetries);
          job.status = "queued";
          job.phase = "approving";
          job.retryCount = nextRetries;
          job.nextRetryAt = Date.now() + retryDelayMs;
          job.startedAt = job.startedAt ?? t0;
          this.broadcastQueueTick();
          setTimeout(() => {
            void this.pumpBuildQueue();
          }, retryDelayMs).unref?.();
          return;
        }
        job.status = "failed";
        job.finishedAt = Date.now();
        job.modelUsed = queryApproval.modelUsed;
        job.errorMsg = queryApproval.reason;
        job.imageBase64 = null;
        this.onBuildPhase?.({ phase: "failed", prompt: job.prompt, x: job.reqX, z: job.reqZ });
        this.broadcastQueueTick();
        return;
      }

      // Step 2: Sculpt with Gemini 4 Hydrogen cascade
      job.phase = "sculpting";
      this.onBuildPhase?.({ phase: "sculpting", prompt: job.prompt, x: job.reqX, z: job.reqZ });
      this.broadcastQueueTick();

      const sculpted = await sculptWithArgon(
        {
          prompt: job.prompt,
          imageBase64: job.imageBase64 ?? undefined,
          imageMimeType: job.imageMime ?? undefined,
          onPhase: (phase, r1Ms) => {
            job.phase = phase;
            job.round1Ms = Math.round(r1Ms);
            this.onBuildPhase?.({ phase, prompt: job.prompt, x: job.reqX, z: job.reqZ });
            this.broadcastQueueTick();
          },
        },
        apiKey,
        this.env.ARGON_MODEL,
        this.env.FALLBACK_MODEL,
        this.env.HYDROGEN_MODEL,
        this.env.HYDROGEN_MODELS,
      );

      if (!sculpted.ok) {
        if (sculpted.unsafe || sculpted.retryable === false || job.retryCount >= 3) {
          job.status = "failed";
          job.finishedAt = Date.now();
          job.errorMsg =
            sculpted.error ||
            "Could not sculpt that creation right now — please try again.";
          job.errorDetail = sculpted.errorDetail
            ? redactSecrets(sculpted.errorDetail, [apiKey, this.env.CREATOR_HMAC_SECRET])
            : null;
          job.imageBase64 = null;
          this.onBuildPhase?.({ phase: "failed", prompt: job.prompt, x: job.reqX, z: job.reqZ });
          this.broadcastQueueTick();
          return;
        }

        const nextRetries = job.retryCount + 1;
        const retryDelayMs = Math.min(8_000, 1_500 * nextRetries);
        job.status = "queued";
        job.phase = "sculpting";
        job.retryCount = nextRetries;
        job.nextRetryAt = Date.now() + retryDelayMs;
        job.startedAt = job.startedAt ?? t0;
        job.errorDetail = sculpted.errorDetail
          ? redactSecrets(sculpted.errorDetail, [apiKey, this.env.CREATOR_HMAC_SECRET])
          : null;
        this.broadcastQueueTick();
        setTimeout(() => {
          void this.pumpBuildQueue();
        }, retryDelayMs).unref?.();
        return;
      }

      // Step 3: Orchestration Agent post-sculpt double-check before placing on the island
      job.phase = "placing";
      this.onBuildPhase?.({
        phase: "placing",
        prompt: job.prompt,
        x: job.reqX,
        z: job.reqZ,
        creationName: sculpted.blueprint.name,
      });
      this.broadcastQueueTick();

      const postApproval = await approveSculptedCreationWithOrchestrator({
        prompt: job.prompt,
        blueprintName: sculpted.blueprint.name,
        blueprintDescription: sculpted.blueprint.description,
        extractedSubject: sculpted.extractedSubject,
        apiKey,
        hydrogenModel: this.env.HYDROGEN_MODEL,
        hydrogenModels: this.env.HYDROGEN_MODELS,
        primaryModel: this.env.ARGON_MODEL,
        fallbackModel: this.env.FALLBACK_MODEL,
      });

      if (!postApproval.approved) {
        job.status = "failed";
        job.finishedAt = Date.now();
        job.modelUsed = postApproval.modelUsed;
        job.errorMsg = postApproval.reason;
        job.imageBase64 = null;
        this.onBuildPhase?.({ phase: "failed", prompt: job.prompt, x: job.reqX, z: job.reqZ });
        this.broadcastQueueTick();
        return;
      }

      const placed = await this.placeCreation({
        ipHash: job.ipHash,
        cookieId: job.cookieId,
        dayKey: job.dayKey,
        creatorPrompt: job.prompt,
        blueprintRaw: sculpted.blueprint as unknown as Record<string, unknown>,
        x: job.reqX,
        z: job.reqZ,
        yaw: job.reqYaw,
      });

      const finishedAt = Date.now();
      this.recordBuildTelemetry({
        durationMs: finishedAt - t0,
        round1Ms: sculpted.telemetry.round1Ms,
        hadRefinementPass: sculpted.telemetry.hadRefinementPass,
        usedFallback: sculpted.telemetry.usedFallback,
        hasImage: hasImg,
        complexity: features.complexity,
        scaleClass: placed.ok ? placed.creation.scaleClass : sculpted.blueprint.scaleClass,
      });

      if (!placed.ok) {
        job.status = "failed";
        job.finishedAt = finishedAt;
        job.modelUsed = sculpted.modelUsed;
        job.errorMsg = placed.error;
        job.creationId = placed.myCreationId ?? null;
        job.imageBase64 = null;
        this.onBuildPhase?.({ phase: "failed", prompt: job.prompt, x: job.reqX, z: job.reqZ });
        this.broadcastQueueTick();
        return;
      }

      job.status = "done";
      job.finishedAt = finishedAt;
      job.creationId = placed.creation.id;
      job.modelUsed = sculpted.modelUsed;
      job.imageBase64 = null;
      this.onBuildPhase?.({
        phase: "done",
        prompt: job.prompt,
        x: placed.creation.x,
        z: placed.creation.z,
        creationName: placed.creation.name,
      });
      this.broadcastQueueTick();
    } catch (err) {
      const apiKey = this.env.GEMINI_API_KEY;
      safeLogError("build_queue_worker_retrying", err, [
        apiKey,
        this.env.GEMINI_API_KEY,
        this.env.CREATOR_HMAC_SECRET,
      ]);
      if (job.retryCount >= 3) {
        job.status = "failed";
        job.finishedAt = Date.now();
        job.errorMsg = "Could not complete build right now — please try again.";
        job.imageBase64 = null;
        this.onBuildPhase?.({ phase: "failed", prompt: job.prompt, x: job.reqX, z: job.reqZ });
        this.broadcastQueueTick();
        return;
      }
      const nextRetries = job.retryCount + 1;
      const retryDelayMs = Math.min(8_000, 1_500 * nextRetries);
      job.status = "queued";
      job.phase = "sculpting";
      job.retryCount = nextRetries;
      job.nextRetryAt = Date.now() + retryDelayMs;
      job.errorDetail = redactSecrets(err, [
        apiKey,
        this.env.GEMINI_API_KEY,
        this.env.CREATOR_HMAC_SECRET,
      ]);
      this.broadcastQueueTick();
      setTimeout(() => {
        void this.pumpBuildQueue();
      }, retryDelayMs).unref?.();
    }
  }

  private isSpotClear(
    x: number,
    z: number,
    category: WorldCreation["category"],
    newRadius: number,
    world: Omit<WorldStateSnapshot, "myCreationId">,
    ignoreId?: string,
    tightInfill = false,
  ): boolean {
    const coastalPad = tightInfill ? 1.8 : 2.6;
    if (getIslandInlandMargin(x, z) < newRadius + coastalPad) return false;
    const signPad = tightInfill ? 2.15 : 2.8;
    if (Math.hypot(x - CITY_SIGN_POS[0], z - CITY_SIGN_POS[1]) < newRadius + signPad) return false;

    const neighborPad = tightInfill ? 0.72 : 1.8;
    for (const c of world.creations) {
      if (c.id === ignoreId) continue;
      if (c.category === "aircraft" || c.behavior.type === "fly_circle") continue;
      if (c.category === "watercraft" || c.behavior.type === "water_float") continue;
      const otherR = getCreationFootprintRadius(
        c.scaleClass,
        c.blueprint?.stats?.footprintX ?? 14,
        c.blueprint?.stats?.footprintZ ?? 14,
      );
      if (Math.hypot(x - c.x, z - c.z) < newRadius + otherR + neighborPad) return false;
    }

    if (category !== "watercraft") {
      const pondPad = tightInfill ? 0.85 : 1.4;
      for (const pr of world.props) {
        if (
          pr.kind === "pond" &&
          Math.hypot(x - pr.x, z - pr.z) < (pr.radius ?? 6.5) + newRadius + pondPad
        ) {
          return false;
        }
      }
    }

    if (category === "building" || category === "prop") {
      const roadClear = newRadius + (tightInfill ? 2.12 : 2.6);
      for (const p of world.paths) {
        if (p.kind !== "road") continue;
        for (let i = 0; i < p.points.length; i++) {
          const a = p.points[i];
          const b = p.points[(i + 1) % p.points.length];
          if (!p.closed && i === p.points.length - 1) break;
          if (distToSegment(x, z, a[0], a[1], b[0], b[1]) < roadClear) return false;
        }
      }
    }
    return true;
  }

  private chooseMeadowSpot(
    reqX: number | null | undefined,
    reqZ: number | null | undefined,
    category: WorldCreation["category"],
    newRadius: number,
    world: Omit<WorldStateSnapshot, "myCreationId">,
    ignoreId?: string,
    scaleClass: WorldCreation["scaleClass"] = "medium",
    contextText = "",
  ): [number, number] {
    const hasExplicitReq =
      typeof reqX === "number" &&
      Number.isFinite(reqX) &&
      typeof reqZ === "number" &&
      Number.isFinite(reqZ);
    return chooseSimCityPlot({
      reqX,
      reqZ,
      category,
      scaleClass,
      newRadius,
      contextText,
      world,
      isSpotClear: (tx, tz) =>
        this.isSpotClear(tx, tz, category, newRadius, world, ignoreId, hasExplicitReq),
    });
  }

  private applyWorldPatch(patch: WorldPatch): void {
    const hasCustomRoad = patch.newPaths.some((p) => p.kind === "road");
    const nonRoadTrailKinds = new Set([
      "footpath",
      "cottage_road",
      "dirt_trail",
      "cobblestone",
      "boardwalk",
      "volcanic_trail",
    ]);

    for (const upd of patch.updatedBehaviors) {
      const existing = this.creations.find((c) => c.id === upd.creationId);
      if (!existing) continue;
      const wasLandmark = existing.behavior?.type === "landmark";
      const prevScale = existing.scaleClass;

      if (upd.blueprintAmendment) {
        existing.blueprint = applyBlueprintAmendment(existing.blueprint, upd.blueprintAmendment);
        existing.category = existing.blueprint.category;
        existing.scaleClass = existing.blueprint.scaleClass;
      }
      if (upd.category) {
        existing.category = upd.category;
        existing.blueprint.category = upd.category;
      }
      if (typeof upd.description === "string" && upd.description.trim().length > 0) {
        existing.description = upd.description.trim();
        existing.blueprint.description = upd.description.trim();
      }

      existing.behavior = upd.behavior;
      if (typeof upd.yaw === "number" && Number.isFinite(upd.yaw)) {
        existing.yaw = upd.yaw;
      }
      if (typeof upd.integratedLevel === "number") {
        existing.integratedLevel = Math.max(existing.integratedLevel, upd.integratedLevel);
      }
      if (upd.liveFeed && !existing.liveFeed) {
        existing.liveFeed = upd.liveFeed;
      }

      if (existing.scaleClass !== prevScale && upd.behavior.type === "landmark") {
        const updatedR = getCreationFootprintRadius(
          existing.scaleClass,
          existing.blueprint.stats.footprintX,
          existing.blueprint.stats.footprintZ,
        );
        const worldSnap = this.readBaseWorld();
        if (!this.isSpotClear(existing.x, existing.z, existing.category, updatedR, worldSnap, existing.id)) {
          const [nx, nz] = this.chooseMeadowSpot(
            existing.x,
            existing.z,
            existing.category,
            updatedR,
            worldSnap,
            existing.id,
          );
          existing.x = nx;
          existing.z = nz;
        }
      }

      if (upd.removeStationaryFootpath || upd.behavior.type !== "landmark") {
        this.paths = this.paths.filter((p) => p.id !== `initpath-${upd.creationId}`);
        this.terrainZones = this.terrainZones.filter((z) => z.id !== `initzone-${upd.creationId}`);
        if (wasLandmark && upd.behavior.type !== "landmark") {
          this.paths = this.paths.filter((p) => {
            if (p.id.startsWith("path-") || !nonRoadTrailKinds.has(p.kind) || p.points.length === 0) {
              return true;
            }
            const firstPt = p.points[0];
            const lastPt = p.points[p.points.length - 1];
            return !(
              Math.hypot(firstPt[0] - existing.x, firstPt[1] - existing.z) < 6.8 ||
              Math.hypot(lastPt[0] - existing.x, lastPt[1] - existing.z) < 6.8
            );
          });
        }
      }
      if ((upd.integratedLevel ?? 0) >= 2 && upd.behavior.type === "landmark" && patch.newPaths.length > 0) {
        this.paths = this.paths.filter((p) => p.id !== `initpath-${upd.creationId}`);
      }
      if ((upd.integratedLevel ?? 0) >= 2 && (hasCustomRoad || upd.behavior.type === "vehicle_route")) {
        this.paths = this.paths.filter((p) => p.id !== `initroad-${upd.creationId}`);
        if (patch.newProps.some((pr) => pr.kind === "bus_stop")) {
          this.props = this.props.filter((pr) => pr.id !== `initstop-${upd.creationId}`);
        }
      }
    }

    if (patch.removePathIds && patch.removePathIds.length > 0) {
      const protectedSeed = new Set([
        "path-main-loop",
        "path-clocktower-spur",
        "path-bakery-spur",
        "path-bookshop-spur",
        "path-green-walk",
      ]);
      const delSet = new Set(patch.removePathIds.filter((id) => !protectedSeed.has(id)));
      this.paths = this.paths.filter((p) => !delSet.has(p.id));
    }

    if (this.paths.length < 220) {
      const byId = new Map(this.paths.map((p) => [p.id, p]));
      for (const p of patch.newPaths) {
        byId.set(p.id, p);
      }
      this.paths = [...byId.values()];
    }

    if (patch.newTerrainZones && patch.newTerrainZones.length > 0) {
      const byId = new Map(this.terrainZones.map((z) => [z.id, z]));
      for (const tz of patch.newTerrainZones) {
        byId.set(tz.id, tz);
      }
      const merged = [...byId.values()];
      if (merged.length > 28) {
        const seeds = merged.filter((z) => z.id.startsWith("zone-seed-"));
        const nonSeeds = merged.filter((z) => !z.id.startsWith("zone-seed-"));
        this.terrainZones = [...seeds, ...nonSeeds.slice(-(28 - seeds.length))].slice(0, 28);
      } else {
        this.terrainZones = merged;
      }
    }

    if (this.props.length < 96) {
      const byId = new Map(this.props.map((pr) => [pr.id, pr]));
      for (const pr of patch.newProps) {
        byId.set(pr.id, pr);
      }
      this.props = [...byId.values()];
    }

    if (patch.companionCreations && patch.companionCreations.length > 0) {
      let companionCount = this.creations.filter(
        (c) => Boolean(c.isCompanion) || c.id.startsWith("comp-"),
      ).length;
      for (const spec of patch.companionCreations) {
        const existingComp = this.creations.find((c) => c.companionOfId === spec.sourceCreationId);
        if (existingComp) {
          existingComp.name = spec.name;
          existingComp.description = spec.description;
          existingComp.blueprint.name = spec.name;
          existingComp.blueprint.description = spec.description;
          existingComp.behavior = spec.behavior;
          existingComp.integratedLevel = 2;
          continue;
        }
        if (companionCount >= 8) break;
        const bp = buildCompanionVehicleBlueprint(spec.archetype, spec.name, spec.description);
        const startWp =
          spec.behavior.type === "vehicle_route" && spec.behavior.waypoints.length > 0
            ? spec.behavior.waypoints[0]
            : ([24, 0] as [number, number]);
        this.creations.push({
          id: `comp-${nodeCrypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
          name: bp.name,
          description: bp.description,
          category: "vehicle",
          scaleClass: bp.scaleClass,
          createdAt: Date.now(),
          x: startWp[0],
          z: startWp[1],
          yaw: 0,
          blueprint: bp,
          behavior: spec.behavior,
          integratedLevel: 2,
          isCompanion: true,
          companionOfId: spec.sourceCreationId,
        });
        companionCount++;
      }
    }

    const contributors = this.creations.filter((c) => !c.isSeed && !c.isCompanion).length;
    const maxVillagers = Math.min(18, 6 + contributors * 2);
    for (const v of patch.newVillagers) {
      if (this.villagers.length >= maxVillagers) break;
      const tooClose = this.villagers.some(
        (ev) => Math.hypot((ev.homeX ?? 0) - v.homeX, (ev.homeZ ?? 0) - v.homeZ) < 2.2,
      );
      if (!tooClose) {
        this.villagers.push(v);
      }
    }

    if (patch.weaveNote) {
      this.lastWeaveNote = patch.weaveNote;
    }
    this.lastWeaveAt = Date.now();
    this.version += 1;
    this.schedulePersist();
  }

  public async placeCreation(input: PlaceCreationInput): Promise<PlaceCreationResult> {
    const existingId = this.lookupTodayCreation(input.cookieId, input.dayKey);
    if (existingId) {
      return {
        ok: false,
        alreadyPlaced: true,
        myCreationId: existingId,
        error: "You've already added your creation for today — come back tomorrow to add another!",
      };
    }

    const cleanPrompt = sanitizePlainText(input.creatorPrompt, 240, true);
    const bp = normalizeAndGroundBlueprint(input.blueprintRaw, "Island Creation", {
      contextText: cleanPrompt,
    });
    if (bp.stats.voxels < 20) {
      return { ok: false, error: "Blueprint has too few voxels to place." };
    }

    const newRadius = getCreationFootprintRadius(
      bp.scaleClass,
      bp.stats.footprintX,
      bp.stats.footprintZ,
    );
    const worldBefore = this.readBaseWorld();
    const cleanDesc = normalizeFactualDescription(bp.description);
    bp.description = cleanDesc;
    const contextText = `${bp.name} ${cleanDesc} ${cleanPrompt}`;
    const placementPolicy = checkIslandContentPolicy(contextText);
    if (!placementPolicy.allowed) {
      return { ok: false, error: placementPolicy.reason };
    }
    const [x, z] = this.chooseMeadowSpot(
      input.x,
      input.z,
      bp.category,
      newRadius,
      worldBefore,
      undefined,
      bp.scaleClass,
      contextText,
    );
    const now = Date.now();
    const id = `c-${now.toString(36)}-${nodeCrypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    const draftForYaw: WorldCreation = {
      id,
      name: bp.name,
      description: cleanDesc,
      ...(cleanPrompt ? { creatorPrompt: cleanPrompt } : {}),
      category: bp.category,
      scaleClass: bp.scaleClass,
      x,
      z,
      yaw: 0,
      blueprint: bp,
      behavior: { type: "landmark", facingYaw: 0, activity: "landmark", statusLine: cleanDesc },
      integratedLevel: 0,
      createdAt: now,
    };
    const smartInitialYaw = computeIntelligentBuildingYaw(draftForYaw, worldBefore.paths);
    const yaw =
      typeof input.yaw === "number" && Number.isFinite(input.yaw)
        ? input.yaw
        : smartInitialYaw !== null
          ? smartInitialYaw
          : 0;

    const creation: WorldCreation = {
      id,
      name: bp.name,
      description: cleanDesc,
      ...(cleanPrompt ? { creatorPrompt: cleanPrompt } : {}),
      category: bp.category,
      scaleClass: bp.scaleClass,
      x,
      z,
      yaw,
      blueprint: bp,
      ...(bp.liveFeed ? { liveFeed: bp.liveFeed } : {}),
      behavior: {
        type: "landmark",
        facingYaw: yaw,
        activity: "landmark",
        statusLine: cleanDesc || bp.name,
      },
      integratedLevel: 0,
      createdAt: now,
    };

    this.creations.push(creation);
    if (input.cookieId) {
      const dayKey = input.dayKey || formatDayKeyInTz(now, "Australia/Sydney");
      this.creatorBuilds.push({
        creationId: creation.id,
        cookieId: input.cookieId,
        dayKey,
        createdAt: now,
      });
    }

    const worldWithNew = this.readBaseWorld();
    const initialPatch = buildInitialIntegration(worldWithNew, creation);
    this.applyWorldPatch(initialPatch);
    this.auditAndRepairWorld();

    const finalBase = this.readBaseWorld();
    const updatedCreation = finalBase.creations.find((c) => c.id === creation.id) ?? creation;

    this.onBroadcast({
      type: "creation_placed",
      creation: updatedCreation,
      world: { ...finalBase, myCreationId: null },
    });

    this.integrationQueue.add(creation.id);
    setTimeout(() => {
      void this.drainIntegrationQueue();
    }, 250).unref?.();

    return {
      ok: true,
      creation: updatedCreation,
      world: {
        ...finalBase,
        myCreationId: creation.id,
      },
    };
  }

  private async drainIntegrationQueue(): Promise<void> {
    if (this.integrationRunning) return;
    const apiKey = this.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.integrationQueue.clear();
      return;
    }

    this.integrationRunning = true;
    try {
      while (this.integrationQueue.size > 0) {
        const nextId = this.integrationQueue.values().next().value;
        if (!nextId) break;
        this.integrationQueue.delete(nextId);

        try {
          const patch = await integrateCreationWithArgon(
            this.readBaseWorld(),
            nextId,
            apiKey,
            this.env.ARGON_MODEL,
            this.env.FALLBACK_MODEL,
            this.env.HYDROGEN_MODEL,
            this.env.HYDROGEN_MODELS,
          );
          if (patch) {
            this.applyWorldPatch(patch);
            this.auditAndRepairWorld();
            this.onBroadcast({
              type: "world_updated",
              note: "",
              world: { ...this.readBaseWorld(), myCreationId: null },
            });
          }
        } catch (err) {
          safeLogError("background_integration", err, [
            apiKey,
            this.env.GEMINI_API_KEY,
            this.env.CREATOR_HMAC_SECRET,
          ]);
        }
      }
    } finally {
      this.integrationRunning = false;
    }
  }

  public getActiveTrafficIncidents(): TrafficIncidentRecord[] {
    const now = Date.now();
    const out: TrafficIncidentRecord[] = [];
    for (const [key, rec] of this.trafficIncidents.entries()) {
      if (now - rec.lastReportedAt > 25 * 60_000) {
        this.trafficIncidents.delete(key);
        continue;
      }
      out.push(rec);
    }
    return out;
  }

  public reportTrafficIncident(input: {
    vehicleId: string;
    peerVehicleId?: string | null;
    x: number;
    z: number;
    reason: TrafficIncidentReason;
  }): {
    ok: boolean;
    resolvedImmediately: boolean;
    scheduledObserverWeave: boolean;
    note: string;
  } {
    const veh = this.creations.find(
      (c) => c.id === input.vehicleId && c.behavior?.type === "vehicle_route",
    );
    if (!veh) {
      return {
        ok: false,
        resolvedImmediately: false,
        scheduledObserverWeave: false,
        note: "Unknown vehicle creation",
      };
    }

    const now = Date.now();
    const key = `${input.vehicleId}:${input.reason}`;
    const existing = this.trafficIncidents.get(key);
    const updated: TrafficIncidentRecord = {
      id: key,
      vehicleId: input.vehicleId,
      peerVehicleId: input.peerVehicleId || existing?.peerVehicleId || null,
      x: Number(Math.max(-180, Math.min(180, input.x || veh.x)).toFixed(1)),
      z: Number(Math.max(-180, Math.min(180, input.z || veh.z)).toFixed(1)),
      reason: input.reason,
      count: (existing?.count || 0) + 1,
      lastReportedAt: now,
    };
    this.trafficIncidents.set(key, updated);
    if (this.trafficIncidents.size > 64) {
      const oldestKey = this.trafficIncidents.keys().next().value;
      if (oldestKey) this.trafficIncidents.delete(oldestKey);
    }

    const auditRes = this.auditAndRepairWorld();
    let resolvedImmediately = false;
    let note = "Recorded vehicle telemetry for Observer Agent.";

    if (auditRes.repairedCount > 0) {
      resolvedImmediately = true;
      this.version += 1;
      note = "Updated traffic routing.";
      this.schedulePersist();
      this.onBroadcast({
        type: "world_updated",
        note: "",
        world: { ...this.readBaseWorld(), myCreationId: null },
      });
    }

    const stillActive = this.trafficIncidents.has(key);
    let scheduledObserverWeave = false;
    if (
      (stillActive || updated.count >= 2) &&
      !this.observerWeaveTimer &&
      now - this.lastObserverWeaveAt >= 40_000
    ) {
      scheduledObserverWeave = true;
      this.observerWeaveTimer = setTimeout(() => {
        this.observerWeaveTimer = null;
        this.lastObserverWeaveAt = Date.now();
        void this.runCronWeaver();
      }, 4_500);
    }

    return {
      ok: true,
      resolvedImmediately,
      scheduledObserverWeave,
      note,
    };
  }

  public async runCronWeaver(): Promise<{ ok: boolean; note: string }> {
    void this.pumpBuildQueue();
    const auditRes = this.auditAndRepairWorld();
    if (auditRes.repairedCount > 0) {
      this.version += 1;
      this.schedulePersist();
      this.onBroadcast({
        type: "world_updated",
        note: "",
        world: { ...this.readBaseWorld(), myCreationId: null },
      });
    }

    const apiKey = this.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { ok: false, note: "Director unavailable" };
    }

    const world = this.readBaseWorld();
    const activeIncidents = this.getActiveTrafficIncidents();
    const hasUnintegrated = world.creations.some((c) => !c.isCompanion && c.integratedLevel < 2);
    const hasStuckMobile = world.creations.some(
      (c) => !c.isSeed && !c.isCompanion && needsMobilityAmendment(c),
    );
    const hasTrafficCongestion = analyzeWorldTrafficCongestion(
      world.creations,
      world.paths,
      activeIncidents,
    ).congested;
    const hasNewCreations = world.creations.length > this.lastWeaveCount;

    if (
      !hasUnintegrated &&
      !hasStuckMobile &&
      !hasTrafficCongestion &&
      !hasNewCreations &&
      activeIncidents.length === 0
    ) {
      return { ok: true, note: "Verified 0 voxel overlaps — no new creations since last weave" };
    }

    try {
      const patch = await weaveWorldCronWithArgon(
        world,
        apiKey,
        this.env.ARGON_MODEL,
        this.env.FALLBACK_MODEL,
        this.env.HYDROGEN_MODEL,
        this.env.HYDROGEN_MODELS,
        activeIncidents,
      );
      if (patch) {
        this.applyWorldPatch(patch);
        this.trafficIncidents.clear();
        this.auditAndRepairWorld();
        this.lastWeaveCount = this.creations.length;
        this.onBroadcast({
          type: "world_updated",
          note: "",
          world: { ...this.readBaseWorld(), myCreationId: null },
        });
        return { ok: true, note: patch.weaveNote };
      }
    } catch (err) {
      safeLogError("cron_weaver", err, [
        apiKey,
        this.env.GEMINI_API_KEY,
        this.env.CREATOR_HMAC_SECRET,
      ]);
      return { ok: false, note: "Cron weave skipped due to transient upstream error" };
    }
    return { ok: true, note: "No changes needed" };
  }

  public loadDevWorldSnapshot(snapshot: {
    creations?: WorldCreation[];
    paths?: WorldPath[];
    props?: WorldProp[];
    terrainZones?: WorldTerrainZone[];
    villagers?: WorldVillager[];
  }): {
    repairedCount: number;
    repairs: string[];
    pathsAfter: number;
    propsAfter: number;
    audit: WorldAuditSummary;
  } {
    if (Array.isArray(snapshot.creations)) this.creations = snapshot.creations;
    if (Array.isArray(snapshot.paths)) this.paths = snapshot.paths;
    if (Array.isArray(snapshot.props)) this.props = snapshot.props;
    if (Array.isArray(snapshot.terrainZones)) this.terrainZones = snapshot.terrainZones.slice(0, 28);
    if (Array.isArray(snapshot.villagers)) this.villagers = snapshot.villagers;
    const repairRes = this.auditAndRepairWorld();
    this.version += 1;
    this.schedulePersist();
    return {
      ...repairRes,
      pathsAfter: this.paths.length,
      propsAfter: this.props.length,
      audit: this.getWorldAuditReport(),
    };
  }
}

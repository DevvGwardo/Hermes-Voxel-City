import type {
  CreationBehavior,
  PathKind,
  VoxelBlueprint,
  VoxelOp,
  VoxelPart,
  VoxelPartKind,
  WorldCreation,
  WorldPath,
  WorldProp,
} from "./types";
import {
  applySimOps,
  detectBlueprintFrontAngle,
  getCreationFootprintRadius,
  SimVox,
  translateOp,
} from "./voxel_dsl";
import { computeIntelligentBuildingYaw } from "./town_planner";

export interface PartOverlapReport {
  partIndex: number;
  name: string;
  kind: VoxelPartKind;
  pivot: [number, number, number];
  overlapCells: number;
  coplanarFaces: number;
  groundClips: number;
  totalIssues: number;
  conflictSampleBox: [number, number, number, number, number, number] | null;
}

export interface BlueprintAuditReport {
  clean: boolean;
  totalConflicts: number;
  overlapCells: number;
  coplanarFaces: number;
  groundClips: number;
  partReports: PartOverlapReport[];
}

export interface BlueprintRepairResult {
  blueprint: VoxelBlueprint;
  reportBefore: BlueprintAuditReport;
  reportAfter: BlueprintAuditReport;
  repairsApplied: string[];
}

export interface WorldSpatialAuditReport {
  clean: boolean;
  footpathTrimCount: number;
  pathCrossingsFixed: number;
  redundantPathsRemoved: number;
  propNudgeCount: number;
  details: string[];
}

const FACE_DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const INSET_OFFSETS: readonly [number, number, number][] = [
  [0.5, 0.5, 0.5],
  [0.16, 0.16, 0.16],
  [0.84, 0.16, 0.16],
  [0.16, 0.84, 0.16],
  [0.84, 0.84, 0.16],
  [0.16, 0.16, 0.84],
  [0.84, 0.16, 0.84],
  [0.16, 0.84, 0.84],
  [0.84, 0.84, 0.84],
];

function cellKey(x: number, y: number, z: number): string {
  return `${x | 0},${y | 0},${z | 0}`;
}

interface PoseTransform {
  rx: number;
  ry: number;
  rz: number;
  dy: number;
}

function samplePartPoses(part: VoxelPart): PoseTransform[] {
  const amp = typeof part.amp === "number" ? part.amp : 0.38;
  switch (part.kind) {
    case "wheel":
    case "spinX": {
      const out: PoseTransform[] = [];
      for (let i = 0; i < 16; i++) {
        out.push({ rx: (i / 16) * Math.PI * 2, ry: 0, rz: 0, dy: 0 });
      }
      return out;
    }
    case "spinY": {
      const out: PoseTransform[] = [];
      for (let i = 0; i < 16; i++) {
        out.push({ rx: 0, ry: (i / 16) * Math.PI * 2, rz: 0, dy: 0 });
      }
      return out;
    }
    case "spinZ": {
      const out: PoseTransform[] = [];
      for (let i = 0; i < 16; i++) {
        out.push({ rx: 0, ry: 0, rz: (i / 16) * Math.PI * 2, dy: 0 });
      }
      return out;
    }
    case "swingX": {
      const out: PoseTransform[] = [];
      for (let i = -4; i <= 4; i++) {
        out.push({ rx: (i / 4) * amp, ry: 0, rz: 0, dy: 0 });
      }
      return out;
    }
    case "swingY": {
      const out: PoseTransform[] = [];
      for (let i = -4; i <= 4; i++) {
        out.push({ rx: 0, ry: (i / 4) * amp, rz: 0, dy: 0 });
      }
      return out;
    }
    case "swingZ": {
      const out: PoseTransform[] = [];
      for (let i = -4; i <= 4; i++) {
        out.push({ rx: 0, ry: 0, rz: (i / 4) * amp, dy: 0 });
      }
      return out;
    }
    case "bob":
    default: {
      const out: PoseTransform[] = [];
      for (let i = -3; i <= 3; i++) {
        out.push({ rx: 0, ry: 0, rz: 0, dy: (i / 3) * amp * 2.5 });
      }
      return out;
    }
  }
}

function rotatePoint(
  lx: number,
  ly: number,
  lz: number,
  pose: PoseTransform,
): [number, number, number] {
  let x = lx;
  let y = ly;
  let z = lz;
  if (pose.rx !== 0) {
    const c = Math.cos(pose.rx);
    const s = Math.sin(pose.rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  }
  if (pose.ry !== 0) {
    const c = Math.cos(pose.ry);
    const s = Math.sin(pose.ry);
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx;
    z = nz;
  }
  if (pose.rz !== 0) {
    const c = Math.cos(pose.rz);
    const s = Math.sin(pose.rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }
  return [x, y + pose.dy, z];
}

interface ExposedFace {
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
}

function collectExposedFaces(vox: SimVox): ExposedFace[] {
  const faces: ExposedFace[] = [];
  for (const cell of vox.v.values()) {
    for (const [nx, ny, nz] of FACE_DIRS) {
      if (!vox.v.has(cellKey(cell.x + nx, cell.y + ny, cell.z + nz))) {
        faces.push({
          cx: cell.x + 0.5 + nx * 0.5,
          cy: cell.y + 0.5 + ny * 0.5,
          cz: cell.z + 0.5 + nz * 0.5,
          nx,
          ny,
          nz,
        });
      }
    }
  }
  return faces;
}

/**
 * Checks whether a plane-aligned face center (wx, wy, wz) with unit axis normal
 * lies coplanar (within ~0.06 voxels) with an exposed face of `occMap` (either flush contact
 * or overlapping same-facing skin, both of which cause GPU depth Z-fighting).
 */
function hasCoplanarBoundaryOnGrid(
  occMap: Map<string, unknown>,
  wx: number,
  wy: number,
  wz: number,
  wnx: number,
  wny: number,
  wnz: number,
): boolean {
  const eps = 0.065;
  if (Math.abs(wnx) > 0.96) {
    const planeX = Math.round(wx);
    if (Math.abs(wx - planeX) > eps) return false;
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);
    const leftHas = occMap.has(cellKey(planeX - 1, iy, iz));
    const rightHas = occMap.has(cellKey(planeX, iy, iz));
    return leftHas !== rightHas;
  }
  if (Math.abs(wny) > 0.96) {
    const planeY = Math.round(wy);
    if (Math.abs(wy - planeY) > eps) return false;
    const ix = Math.floor(wx);
    const iz = Math.floor(wz);
    const downHas = occMap.has(cellKey(ix, planeY - 1, iz));
    const upHas = occMap.has(cellKey(ix, planeY, iz));
    return downHas !== upHas;
  }
  if (Math.abs(wnz) > 0.96) {
    const planeZ = Math.round(wz);
    if (Math.abs(wz - planeZ) > eps) return false;
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const backHas = occMap.has(cellKey(ix, iy, planeZ - 1));
    const frontHas = occMap.has(cellKey(ix, iy, planeZ));
    return backHas !== frontHas;
  }
  return false;
}

function auditSinglePartAgainstOccupied(
  part: VoxelPart,
  partIndex: number,
  palette: Record<string, string>,
  occupied: Map<string, unknown>,
  sweptOut?: Set<string>,
): { report: PartOverlapReport; conflictSum: [number, number, number]; conflictN: number } {
  const pv = new SimVox();
  applySimOps(pv, part.ops, palette);

  const [px, py, pz] = part.pivot;
  const cells = Array.from(pv.v.values());
  if (!cells.length) {
    return {
      report: {
        partIndex,
        name: part.name,
        kind: part.kind,
        pivot: [px, py, pz],
        overlapCells: 0,
        coplanarFaces: 0,
        groundClips: 0,
        totalIssues: 0,
        conflictSampleBox: null,
      },
      conflictSum: [0, 0, 0],
      conflictN: 0,
    };
  }

  const exposedFaces = collectExposedFaces(pv);
  const poses = samplePartPoses(part);

  const overlapSet = new Set<string>();
  const coplanarSet = new Set<string>();
  const groundClipSet = new Set<string>();

  let minCX = Infinity, maxCX = -Infinity;
  let minCY = Infinity, maxCY = -Infinity;
  let minCZ = Infinity, maxCZ = -Infinity;
  let sumX = 0, sumY = 0, sumZ = 0, sumN = 0;

  // Ground clip applies to non-wheel elevated parts (e.g. windmill sails sweeping underground)
  const checkGroundSweep =
    (part.kind === "spinZ" || part.kind === "spinX") && py >= 3.5;

  for (let pi = 0; pi < poses.length; pi++) {
    const pose = poses[pi];
    for (const c of cells) {
      for (let oi = 0; oi < INSET_OFFSETS.length; oi++) {
        const [ox, oy, oz] = INSET_OFFSETS[oi];
        const [rx, ry, rz] = rotatePoint(c.x + ox, c.y + oy, c.z + oz, pose);
        const wx = px + rx;
        const wy = py + ry;
        const wz = pz + rz;
        const gx = Math.floor(wx);
        const gy = Math.floor(wy);
        const gz = Math.floor(wz);
        const gk = cellKey(gx, gy, gz);

        if (oi === 0 && sweptOut) {
          sweptOut.add(gk);
        }

        if (occupied.has(gk)) {
          if (!overlapSet.has(gk)) {
            overlapSet.add(gk);
            if (gx < minCX) minCX = gx;
            if (gx + 1 > maxCX) maxCX = gx + 1;
            if (gy < minCY) minCY = gy;
            if (gy + 1 > maxCY) maxCY = gy + 1;
            if (gz < minCZ) minCZ = gz;
            if (gz + 1 > maxCZ) maxCZ = gz + 1;
            sumX += gx + 0.5;
            sumY += gy + 0.5;
            sumZ += gz + 0.5;
            sumN++;
          }
        }

        if (checkGroundSweep && wy < -0.15) {
          groundClipSet.add(`${gx},${gz}`);
        }
      }
    }

    // Coplanar boundary graze check
    for (const f of exposedFaces) {
      const [rx, ry, rz] = rotatePoint(f.cx, f.cy, f.cz, pose);
      const [wnx, wny, wnz] = rotatePoint(f.nx, f.ny, f.nz, { ...pose, dy: 0 });
      const wx = px + rx;
      const wy = py + ry;
      const wz = pz + rz;
      if (hasCoplanarBoundaryOnGrid(occupied, wx, wy, wz, wnx, wny, wnz)) {
        const fk = `${Math.round(wx * 2)},${Math.round(wy * 2)},${Math.round(wz * 2)}`;
        if (!coplanarSet.has(fk)) {
          coplanarSet.add(fk);
          const gx = Math.floor(wx);
          const gy = Math.floor(wy);
          const gz = Math.floor(wz);
          if (gx < minCX) minCX = gx;
          if (gx + 1 > maxCX) maxCX = gx + 1;
          if (gy < minCY) minCY = gy;
          if (gy + 1 > maxCY) maxCY = gy + 1;
          if (gz < minCZ) minCZ = gz;
          if (gz + 1 > maxCZ) maxCZ = gz + 1;
          sumX += wx;
          sumY += wy;
          sumZ += wz;
          sumN++;
        }
      }
    }
  }

  const overlapCells = overlapSet.size;
  const coplanarFaces = coplanarSet.size;
  const groundClips = groundClipSet.size;
  const totalIssues = overlapCells + coplanarFaces + groundClips;

  return {
    report: {
      partIndex,
      name: part.name,
      kind: part.kind,
      pivot: [px, py, pz],
      overlapCells,
      coplanarFaces,
      groundClips,
      totalIssues,
      conflictSampleBox:
        minCX <= maxCX ? [minCX, minCY, minCZ, maxCX, maxCY, maxCZ] : null,
    },
    conflictSum: [sumX, sumY, sumZ],
    conflictN: sumN,
  };
}

/**
 * Audits a VoxelBlueprint across all kinematic animation poses of all `parts`
 * for volumetric voxel collisions, coplanar Z-fighting faces, and sub-ground blade sweeps.
 */
export function auditBlueprintOverlaps(bp: VoxelBlueprint): BlueprintAuditReport {
  const baseVox = new SimVox();
  applySimOps(baseVox, bp.ops, bp.palette);

  // Combined occupancy starts with baseVox and accumulates each earlier part's swept volume
  // so part-vs-base AND part-vs-part Z-fighting are both caught.
  const combinedOccupied = new Map<string, boolean>();
  for (const k of baseVox.v.keys()) {
    combinedOccupied.set(k, true);
  }

  const partReports: PartOverlapReport[] = [];
  let overlapCells = 0;
  let coplanarFaces = 0;
  let groundClips = 0;

  for (let i = 0; i < bp.parts.length; i++) {
    const swept = new Set<string>();
    const { report } = auditSinglePartAgainstOccupied(
      bp.parts[i],
      i,
      bp.palette,
      combinedOccupied,
      swept,
    );
    partReports.push(report);
    overlapCells += report.overlapCells;
    coplanarFaces += report.coplanarFaces;
    groundClips += report.groundClips;
    for (const sk of swept) {
      combinedOccupied.set(sk, true);
    }
  }

  const totalConflicts = overlapCells + coplanarFaces + groundClips;
  return {
    clean: totalConflicts === 0,
    totalConflicts,
    overlapCells,
    coplanarFaces,
    groundClips,
    partReports,
  };
}

/**
 * Formats a concise diagnostic summary for Gemini 4 Argon when self-repairing a draft blueprint.
 */
export function formatAuditFeedbackForArgon(report: BlueprintAuditReport): string {
  if (report.clean) return "";
  const lines: string[] = [];
  for (const pr of report.partReports) {
    if (pr.totalIssues === 0) continue;
    const boxNote = pr.conflictSampleBox
      ? ` in region x=[${pr.conflictSampleBox[0]}..${pr.conflictSampleBox[3]}], y=[${pr.conflictSampleBox[1]}..${pr.conflictSampleBox[4]}], z=[${pr.conflictSampleBox[2]}..${pr.conflictSampleBox[5]}]`
      : "";
    lines.push(
      `- Animated part "${pr.name}" (${pr.kind} at pivot [${pr.pivot.join(", ")}]) has ${pr.overlapCells} overlapping voxels, ${pr.coplanarFaces} coplanar Z-fighting faces, and ${pr.groundClips} ground clips${boxNote}. Move its pivot outward or carve >=1 voxel clearance so it spins/swings with zero contact.`,
    );
  }
  return lines.join("\n");
}

function recomputeBlueprintStats(
  bp: VoxelBlueprint,
  ops: VoxelOp[],
  parts: VoxelPart[],
): VoxelBlueprint["stats"] {
  const worldVox = new SimVox();
  applySimOps(worldVox, ops, bp.palette);
  for (const pt of parts) {
    const pv = new SimVox();
    applySimOps(pv, pt.ops, bp.palette);
    worldVox.merge(pv, Math.round(pt.pivot[0]), Math.round(pt.pivot[1]), Math.round(pt.pivot[2]));
  }
  const b = worldVox.bounds();
  return {
    voxels: b.count,
    footprintX: Math.max(2, b.maxX - b.minX),
    footprintZ: Math.max(2, b.maxZ - b.minZ),
    maxY: Math.max(2, b.maxY),
  };
}

/**
 * Carve clean wheel-well arches into `ops` for a `wheel` part so tires spin freely
 * without lifting the wheels off the ground (`Y = 0`).
 */
function carveWheelArches(
  ops: VoxelOp[],
  part: VoxelPart,
  palette: Record<string, string>,
): VoxelOp[] {
  const pv = new SimVox();
  applySimOps(pv, part.ops, palette);
  if (!pv.size) return ops;

  const negCells: { x: number; y: number; z: number }[] = [];
  const posCells: { x: number; y: number; z: number }[] = [];
  for (const c of pv.v.values()) {
    if (c.x < 0) negCells.push(c);
    else posCells.push(c);
  }

  const clusters = [negCells, posCells].filter((cl) => cl.length > 0);
  const nextOps = [...ops];
  const [px, py, pz] = part.pivot;

  for (const cl of clusters) {
    let minLX = Infinity, maxLX = -Infinity;
    let maxR = 1.0;
    for (const c of cl) {
      if (c.x < minLX) minLX = c.x;
      if (c.x + 1 > maxLX) maxLX = c.x + 1;
      const r = Math.hypot(c.y + 0.5, c.z + 0.5) + 0.55;
      if (r > maxR) maxR = r;
    }
    const rPad = Math.ceil(maxR + 0.65);
    const x0 = Math.floor(px + minLX - 0.6);
    const x1 = Math.ceil(px + maxLX + 0.6);
    const y0 = Math.max(0, Math.floor(py - rPad));
    const y1 = Math.ceil(py + rPad);
    const z0 = Math.floor(pz - rPad);
    const z1 = Math.ceil(pz + rPad);
    nextOps.push({
      op: "clear",
      x0,
      y0,
      z0,
      x1,
      y1,
      z1,
    });
  }
  return nextOps;
}

/**
 * Deterministically resolves any part-vs-base and part-vs-part voxel overlaps or coplanar Z-fighting
 * across all animated parts of a `VoxelBlueprint`.
 */
export function autoRepairBlueprintOverlaps(bp: VoxelBlueprint): BlueprintRepairResult {
  const reportBefore = auditBlueprintOverlaps(bp);
  if (reportBefore.clean) {
    return {
      blueprint: bp,
      reportBefore,
      reportAfter: reportBefore,
      repairsApplied: [],
    };
  }

  let ops: VoxelOp[] = bp.ops.map((o) => ({ ...o }));
  const parts: VoxelPart[] = bp.parts.map((p) => ({
    ...p,
    pivot: [...p.pivot] as [number, number, number],
    ops: p.ops.map((o) => ({ ...o })),
  }));
  const repairsApplied: string[] = [];

  // Pass 1: Carve clean wheel arches for any colliding `wheel` parts first (keeps wheels grounded at Y=0)
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind !== "wheel") continue;
    const baseCheck = new SimVox();
    applySimOps(baseCheck, ops, bp.palette);
    const { report } = auditSinglePartAgainstOccupied(parts[i], i, bp.palette, baseCheck.v);
    if (report.totalIssues > 0) {
      ops = carveWheelArches(ops, parts[i], bp.palette);
      repairsApplied.push(`carved wheel-arch clearance for "${parts[i].name}"`);
    }
  }

  // Rebuild occupancy incrementally for Pass 2 across all parts
  const baseVox = new SimVox();
  applySimOps(baseVox, ops, bp.palette);
  const occupied = new Map<string, boolean>();
  for (const k of baseVox.v.keys()) occupied.set(k, true);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const sweptInitial = new Set<string>();
    const initialEval = auditSinglePartAgainstOccupied(part, i, bp.palette, occupied, sweptInitial);

    if (initialEval.report.totalIssues === 0) {
      for (const sk of sweptInitial) occupied.set(sk, true);
      continue;
    }

    const [origX, origY, origZ] = part.pivot;
    const pv = new SimVox();
    applySimOps(pv, part.ops, bp.palette);
    const pb = pv.bounds();

    // Compute escape hint vector away from colliding voxels
    let escX = 0, escY = 0, escZ = 0;
    if (initialEval.conflictN > 0) {
      const cx = initialEval.conflictSum[0] / initialEval.conflictN;
      const cy = initialEval.conflictSum[1] / initialEval.conflictN;
      const cz = initialEval.conflictSum[2] / initialEval.conflictN;
      escX = origX - cx;
      escY = origY - cy;
      escZ = origZ - cz;
    }

    const candidates: [number, number, number][] = [];

    if (part.kind === "spinZ") {
      // If part ops extend behind local z=0 into the tower wall, shift local ops so back sits at local z=0
      const signZ = origZ >= -0.5 ? 1 : -1;
      if (signZ > 0 && pb.minZ < 0) {
        const zShift = -pb.minZ;
        part.ops = part.ops.map((o) => translateOp(o, 0, 0, zShift));
      } else if (signZ < 0 && pb.maxZ > 0) {
        const zShift = -pb.maxZ;
        part.ops = part.ops.map((o) => translateOp(o, 0, 0, zShift));
      }

      for (let dzStep = 0; dzStep <= 18; dzStep++) {
        const dz = signZ * (dzStep * 0.5);
        for (let dyStep = 0; dyStep <= 16; dyStep++) {
          const dy = dyStep * 0.5;
          candidates.push([0, dy, dz]);
          if (dyStep > 0 && origY - dy >= 6) {
            candidates.push([0, -dy, dz]);
          }
        }
      }
    } else if (part.kind === "spinX") {
      const signX = origX >= 0 ? 1 : -1;
      if (signX > 0 && pb.minX < 0) {
        part.ops = part.ops.map((o) => translateOp(o, -pb.minX, 0, 0));
      } else if (signX < 0 && pb.maxX > 0) {
        part.ops = part.ops.map((o) => translateOp(o, -pb.maxX, 0, 0));
      }
      for (let dxStep = 0; dxStep <= 18; dxStep++) {
        const dx = signX * (dxStep * 0.5);
        for (let dyStep = 0; dyStep <= 14; dyStep++) {
          candidates.push([dx, dyStep * 0.5, 0]);
        }
      }
    } else if (part.kind === "spinY") {
      for (let dyStep = 1; dyStep <= 16; dyStep++) {
        const dy = dyStep * 0.5;
        candidates.push([0, dy, 0]);
        candidates.push([0, dy, 0.5], [0, dy, -0.5], [0.5, dy, 0], [-0.5, dy, 0]);
        candidates.push([0, dy, 1.5], [0, dy, -1.5], [1.5, dy, 0], [-1.5, dy, 0]);
      }
    } else {
      // swingX, swingY, swingZ, bob, or residual wheel
      const isGroundLimb =
        (part.kind === "swingX" || part.kind === "wheel") && origY + pb.minY <= 0.75;
      const sx = Math.abs(escX) > 0.15 ? Math.sign(escX) : origX >= 0 ? 1 : -1;
      const sz = Math.abs(escZ) > 0.15 ? Math.sign(escZ) : origZ >= 0 ? 1 : -1;
      const sy = Math.abs(escY) > 0.15 ? Math.sign(escY) : 1;

      if (isGroundLimb) {
        // Keep Y fixed so paws/wheels stay grounded on Y=0; push outward in X/Z
        for (let step = 1; step <= 12; step++) {
          const d = step * 0.5;
          candidates.push([sx * d, 0, 0]);
          candidates.push([0, 0, sz * d]);
          candidates.push([sx * d, 0, sz * d * 0.5]);
          candidates.push([-sx * d, 0, 0]);
        }
      } else {
        for (let step = 1; step <= 26; step++) {
          const d = step * 0.5;
          candidates.push([0, d, 0]);
          candidates.push([0, 0, sz * d], [0, 0, -sz * d]);
          candidates.push([sx * d, 0, 0], [-sx * d, 0, 0]);
          candidates.push([0, -d, 0]);
          candidates.push([sx * d, 0, sz * d], [-sx * d, 0, -sz * d]);
          candidates.push([0, d, sz * d], [0, d, -sz * d]);
          candidates.push([sx * d, d, 0], [-sx * d, d, 0]);
        }
      }
    }

    // Sort candidates by weighted Euclidean shift so we pick the gentlest clean fix
    candidates.sort((a, b) => {
      const da = a[0] * a[0] + a[1] * a[1] * 1.15 + a[2] * a[2];
      const db = b[0] * b[0] + b[1] * b[1] * 1.15 + b[2] * b[2];
      return da - db;
    });

    let bestPivot: [number, number, number] | null = null;
    let lowestPivot: [number, number, number] = [origX, origY, origZ];
    let lowestScore = initialEval.report.totalIssues;

    for (const [dx, dy, dz] of candidates) {
      const candPivot: [number, number, number] = [
        Number((origX + dx).toFixed(2)),
        Number(Math.max(0, origY + dy).toFixed(2)),
        Number((origZ + dz).toFixed(2)),
      ];
      if (Math.abs(candPivot[0]) > 22 || candPivot[1] > 44 || Math.abs(candPivot[2]) > 22) continue;

      const testPart: VoxelPart = { ...part, pivot: candPivot };
      const { report } = auditSinglePartAgainstOccupied(testPart, i, bp.palette, occupied);
      if (report.totalIssues === 0) {
        bestPivot = candPivot;
        break;
      }
      if (report.totalIssues < lowestScore) {
        lowestScore = report.totalIssues;
        lowestPivot = candPivot;
      }
    }

    if (bestPivot) {
      // If we pushed a front/back spinZ hub outward by >= 2 voxels, add a non-touching support shaft on base
      if (part.kind === "spinZ" && Math.abs(bestPivot[2] - origZ) >= 2.0) {
        const signZ = bestPivot[2] >= origZ ? 1 : -1;
        const zStart = Math.round(origZ - signZ * 2);
        const zEnd = signZ > 0 ? Math.floor(bestPivot[2]) - 1 : Math.ceil(bestPivot[2]) + 1;
        if ((signZ > 0 && zEnd > zStart) || (signZ < 0 && zStart > zEnd)) {
          const axleOp: VoxelOp = {
            op: "cylinder",
            axis: "z",
            cx: Math.round(bestPivot[0]),
            cy: Math.round(bestPivot[1]),
            z0: Math.min(zStart, zEnd),
            z1: Math.max(zStart, zEnd),
            radius: 1.1,
            color: "woodDark",
          };
          ops.push(axleOp);
          applySimOps(baseVox, [axleOp], bp.palette);
          for (const k of baseVox.v.keys()) occupied.set(k, true);
        }
      }
      part.pivot = bestPivot;
      repairsApplied.push(
        `nudged "${part.name}" (${part.kind}) pivot [${origX},${origY},${origZ}] -> [${bestPivot.join(",")}]`,
      );
    } else {
      // Apply best partial pivot shift and carve a full 1-voxel clearance pocket around the swept volume
      part.pivot = lowestPivot;
      const pvSwept = new Set<string>();
      auditSinglePartAgainstOccupied(part, i, bp.palette, occupied, pvSwept);
      let cMinX = Infinity, cMaxX = -Infinity;
      let cMinY = Infinity, cMaxY = -Infinity;
      let cMinZ = Infinity, cMaxZ = -Infinity;
      for (const sk of pvSwept) {
        const [sx, sy, sz] = sk.split(",").map(Number);
        if (sx < cMinX) cMinX = sx;
        if (sx + 1 > cMaxX) cMaxX = sx + 1;
        if (sy < cMinY) cMinY = sy;
        if (sy + 1 > cMaxY) cMaxY = sy + 1;
        if (sz < cMinZ) cMinZ = sz;
        if (sz + 1 > cMaxZ) cMaxZ = sz + 1;
      }
      if (cMinX <= cMaxX) {
        const clearOp: VoxelOp = {
          op: "clear",
          x0: cMinX - 1,
          y0: Math.max(0, cMinY - 1),
          z0: cMinZ - 1,
          x1: cMaxX + 1,
          y1: cMaxY + 1,
          z1: cMaxZ + 1,
        };
        ops.push(clearOp);
        baseVox.clear(clearOp.x0, clearOp.y0, clearOp.z0, clearOp.x1, clearOp.y1, clearOp.z1);
        occupied.clear();
        for (const k of baseVox.v.keys()) occupied.set(k, true);
        for (let j = 0; j < i; j++) {
          const prevSwept = new Set<string>();
          auditSinglePartAgainstOccupied(parts[j], j, bp.palette, occupied, prevSwept);
          for (const pk of prevSwept) occupied.set(pk, true);
        }
        // Verify if any part-vs-part conflict remains after base pocket clear; if so, lift cleanly above
        const postCheck = auditSinglePartAgainstOccupied(part, i, bp.palette, occupied);
        if (postCheck.report.totalIssues > 0) {
          for (let lift = 1; lift <= 24; lift++) {
            const lifted: VoxelPart = {
              ...part,
              pivot: [part.pivot[0], Number((part.pivot[1] + lift).toFixed(2)), part.pivot[2]],
            };
            if (auditSinglePartAgainstOccupied(lifted, i, bp.palette, occupied).report.totalIssues === 0) {
              part.pivot = lifted.pivot;
              break;
            }
          }
        }
        repairsApplied.push(`carved joint socket clearance for "${part.name}"`);
      }
    }

    const finalSwept = new Set<string>();
    auditSinglePartAgainstOccupied(part, i, bp.palette, occupied, finalSwept);
    for (const sk of finalSwept) occupied.set(sk, true);
  }

  const repairedBp: VoxelBlueprint = {
    ...bp,
    ops,
    parts,
    stats: recomputeBlueprintStats(bp, ops, parts),
  };
  const reportAfter = auditBlueprintOverlaps(repairedBp);

  return {
    blueprint: repairedBp,
    reportBefore,
    reportAfter,
    repairsApplied,
  };
}

export const OUTER_RING_ROAD_POINTS: [number, number][] = [
  [-81, -6],
  [-78, -44],
  [-58, -60],
  [-32, -82],
  [0, -86],
  [36, -80],
  [58, -58],
  [78, -36],
  [79, 0],
  [76, 34],
  [62, 60],
  [26, 56],
  [-8, 66],
  [-34, 74],
  [-68, 42],
  [-85, 18],
];

const SEED_PATH_IDS = new Set([
  "path-main-loop",
  "path-outer-ring",
  "path-clocktower-spur",
  "path-bakery-spur",
  "path-bookshop-spur",
  "path-green-walk",
]);

const SEED_PROP_IDS = new Set([
  "prop-central-pond",
  "prop-stop-clocktower",
  "prop-stop-bookshop",
  "prop-stop-bakery",
  "prop-lamp-1",
  "prop-lamp-2",
  "prop-lamp-3",
  "prop-bench-pond",
  "prop-flowers-1",
  "prop-flowers-2",
]);

function round1(v: number): number {
  return Number(v.toFixed(1));
}

function dedupeSequentialPts(pts: [number, number][], minStep = 0.85): [number, number][] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return [[round1(pts[0][0]), round1(pts[0][1])]];
  const out: [number, number][] = [[round1(pts[0][0]), round1(pts[0][1])]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const cur: [number, number] = [round1(pts[i][0]), round1(pts[i][1])];
    const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    if (d >= minStep) {
      out.push(cur);
    } else if (i === pts.length - 1) {
      if (out.length >= 2) {
        out[out.length - 1] = cur;
      } else if (d >= 0.4) {
        out.push(cur);
      }
    }
  }
  return out;
}

function deKinkPolyline2D(
  pts: [number, number][],
  closed = false,
): { points: [number, number][]; changed: boolean } {
  const deduped = dedupeSequentialPts(pts, 1.15);
  const samePts = (a: [number, number][], b: [number, number][]): boolean =>
    a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
  if (closed || deduped.length < 3) {
    return { points: deduped, changed: !samePts(pts, deduped) };
  }
  let cur = deduped;
  for (let pass = 0; pass < 3 && cur.length >= 3; pass++) {
    const next: [number, number][] = [cur[0]];
    let removedInPass = false;
    for (let i = 1; i < cur.length - 1; i++) {
      const prev = next[next.length - 1];
      const p = cur[i];
      const after = cur[i + 1];
      const v1x = p[0] - prev[0];
      const v1z = p[1] - prev[1];
      const v2x = after[0] - p[0];
      const v2z = after[1] - p[1];
      const l1 = Math.hypot(v1x, v1z);
      const l2 = Math.hypot(v2x, v2z);
      if (l1 < 1.15 || l2 < 1.15) {
        removedInPass = true;
        continue;
      }
      const cosTurn = (v1x * v2x + v1z * v2z) / (l1 * l2);
      // Drop sharp hairpin folds (> ~102 degree turn)
      if (cosTurn < -0.2) {
        removedInPass = true;
        continue;
      }
      next.push(p);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
    if (!removedInPass) break;
  }
  return { points: cur, changed: !samePts(pts, cur) };
}

/**
 * Evaluates a centripetal Catmull-Rom 2D spline (`alpha = 0.5`) matching `THREE.CatmullRomCurve3(..., "centripetal")`.
 */
export function sampleCatmullRom2D(
  pts: [number, number][],
  closed = false,
  stepMeters = 0.65,
): [number, number][] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return [[pts[0][0], pts[0][1]]];
  if (pts.length === 2 && !closed) {
    const [ax, az] = pts[0];
    const [bx, bz] = pts[1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(len / Math.max(0.25, stepMeters)));
    const out: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      out.push([ax + (bx - ax) * u, az + (bz - az) * u]);
    }
    return out;
  }

  const n = pts.length;
  const segCount = closed ? n : n - 1;
  const getPt = (idx: number): [number, number] => {
    if (closed) {
      return pts[((idx % n) + n) % n];
    }
    if (idx < 0) {
      return [pts[0][0] + (pts[0][0] - pts[1][0]), pts[0][1] + (pts[0][1] - pts[1][1])];
    }
    if (idx >= n) {
      return [
        pts[n - 1][0] + (pts[n - 1][0] - pts[n - 2][0]),
        pts[n - 1][1] + (pts[n - 1][1] - pts[n - 2][1]),
      ];
    }
    return pts[idx];
  };

  const out: [number, number][] = [];
  for (let s = 0; s < segCount; s++) {
    const p0 = getPt(s - 1);
    const p1 = getPt(s);
    const p2 = getPt(s + 1);
    const p3 = getPt(s + 2);

    const d01 = Math.max(1e-3, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
    const d12 = Math.max(1e-3, Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    const d23 = Math.max(1e-3, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));

    const t1x = ((p1[0] - p0[0]) / d01 - (p2[0] - p0[0]) / (d01 + d12) + (p2[0] - p1[0]) / d12) * d12;
    const t1z = ((p1[1] - p0[1]) / d01 - (p2[1] - p0[1]) / (d01 + d12) + (p2[1] - p1[1]) / d12) * d12;
    const t2x = ((p2[0] - p1[0]) / d12 - (p3[0] - p1[0]) / (d12 + d23) + (p3[0] - p2[0]) / d23) * d12;
    const t2z = ((p2[1] - p1[1]) / d12 - (p3[1] - p1[1]) / (d12 + d23) + (p3[1] - p2[1]) / d23) * d12;

    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const subSteps = Math.max(3, Math.min(28, Math.ceil(chord / Math.max(0.25, stepMeters))));
    const startK = s === 0 ? 0 : 1;
    for (let k = startK; k <= subSteps; k++) {
      const u = k / subSteps;
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      out.push([
        h00 * p1[0] + h10 * t1x + h01 * p2[0] + h11 * t2x,
        h00 * p1[1] + h10 * t1z + h01 * p2[1] + h11 * t2z,
      ]);
    }
  }
  return out;
}

function polylineLength2D(pts: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return len;
}

function segSegHit2D(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number],
): [number, number] | null {
  const dax = a2[0] - a1[0];
  const daz = a2[1] - a1[1];
  const dbx = b2[0] - b1[0];
  const dbz = b2[1] - b1[1];
  const denom = dax * dbz - daz * dbx;
  if (Math.abs(denom) < 1e-8) return null;
  const ox = b1[0] - a1[0];
  const oz = b1[1] - a1[1];
  const t = (ox * dbz - oz * dbx) / denom;
  const u = (ox * daz - oz * dax) / denom;
  if (t >= -1e-5 && t <= 1 + 1e-5 && u >= -1e-5 && u <= 1 + 1e-5) {
    return [a1[0] + dax * t, a1[1] + daz * t];
  }
  return null;
}

/**
 * 2-opt uncrossing so neither paths nor vehicle route loops ever self-intersect into a figure-8.
 */
export function uncrossPolyline2D(pts: [number, number][], closed = false): {
  points: [number, number][];
  changed: boolean;
} {
  if (pts.length < 4) return { points: pts, changed: false };
  const out: [number, number][] = pts.map(([x, z]) => [x, z]);
  const n = out.length;
  const segCount = closed ? n : n - 1;
  let changed = false;

  for (let iter = 0; iter < 12; iter++) {
    let swapped = false;
    for (let i = 0; i < segCount; i++) {
      const i2 = (i + 1) % n;
      for (let j = i + 2; j < segCount; j++) {
        if (closed && i === 0 && j === segCount - 1) continue;
        const j2 = (j + 1) % n;
        const hit = segSegHit2D(out[i], out[i2], out[j], out[j2]);
        if (hit) {
          // Reverse vertex order between i+1 and j inclusive
          let l = i + 1;
          let r = j;
          while (l < r) {
            const tmp = out[l];
            out[l] = out[r];
            out[r] = tmp;
            l++;
            r--;
          }
          swapped = true;
          changed = true;
          break;
        }
      }
      if (swapped) break;
    }
    if (!swapped) break;
  }
  return { points: out, changed };
}

export function distPointToPolyline2D(
  px: number,
  pz: number,
  curve: [number, number][],
): {
  dist: number;
  closestX: number;
  closestZ: number;
  normalX: number;
  normalZ: number;
  segIndex: number;
} {
  let bestDist = Infinity;
  let closestX = curve[0]?.[0] ?? px;
  let closestZ = curve[0]?.[1] ?? pz;
  let bestSeg = 0;
  let segTanX = 1;
  let segTanZ = 0;

  for (let i = 0; i + 1 < curve.length; i++) {
    const ax = curve[i][0];
    const az = curve[i][1];
    const bx = curve[i + 1][0];
    const bz = curve[i + 1][1];
    const vx = bx - ax;
    const vz = bz - az;
    const lenSq = vx * vx + vz * vz;
    const t = lenSq > 1e-8 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / lenSq)) : 0;
    const cx = ax + vx * t;
    const cz = az + vz * t;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < bestDist) {
      bestDist = d;
      closestX = cx;
      closestZ = cz;
      bestSeg = i;
      const segLen = Math.sqrt(lenSq);
      if (segLen > 1e-5) {
        segTanX = vx / segLen;
        segTanZ = vz / segLen;
      }
    }
  }

  const dx = px - closestX;
  const dz = pz - closestZ;
  let normalX = bestDist > 1e-3 ? dx / bestDist : -segTanZ;
  let normalZ = bestDist > 1e-3 ? dz / bestDist : segTanX;
  const nLen = Math.hypot(normalX, normalZ);
  if (nLen > 1e-5) {
    normalX /= nLen;
    normalZ /= nLen;
  }
  return { dist: bestDist, closestX, closestZ, normalX, normalZ, segIndex: bestSeg };
}

function simplifyRDP2D(pts: [number, number][], epsilon: number, maxPoints = 6): [number, number][] {
  if (pts.length <= 2) return pts.map(([x, z]) => [round1(x), round1(z)]);

  const rdp = (arr: [number, number][], eps: number): [number, number][] => {
    if (arr.length <= 2) return arr;
    const [ax, az] = arr[0];
    const [bx, bz] = arr[arr.length - 1];
    const vx = bx - ax;
    const vz = bz - az;
    const lenSq = vx * vx + vz * vz;
    let maxD = -1;
    let maxIdx = 0;
    for (let i = 1; i < arr.length - 1; i++) {
      const [px, pz] = arr[i];
      const t = lenSq > 1e-8 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / lenSq)) : 0;
      const d = Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
      if (d > maxD) {
        maxD = d;
        maxIdx = i;
      }
    }
    if (maxD > eps && maxIdx > 0) {
      const left = rdp(arr.slice(0, maxIdx + 1), eps);
      const right = rdp(arr.slice(maxIdx), eps);
      return [...left.slice(0, -1), ...right];
    }
    return [arr[0], arr[arr.length - 1]];
  };

  let eps = epsilon;
  let simplified = rdp(pts, eps);
  while (simplified.length > maxPoints && eps < 4.0) {
    eps *= 1.45;
    simplified = rdp(pts, eps);
  }
  return dedupeSequentialPts(simplified, 0.9);
}

function polylineIntersectsCurveInterior(
  candSampled: [number, number][],
  candClosed: boolean,
  otherSampled: [number, number][],
  otherClosed: boolean,
  endpointGrace = 0.95,
): boolean {
  const openEndpoints: [number, number][] = [];
  if (!candClosed && candSampled.length >= 2) {
    openEndpoints.push(candSampled[0], candSampled[candSampled.length - 1]);
  }
  if (!otherClosed && otherSampled.length >= 2) {
    openEndpoints.push(otherSampled[0], otherSampled[otherSampled.length - 1]);
  }

  for (let i = 0; i + 1 < candSampled.length; i++) {
    const a1 = candSampled[i];
    const a2 = candSampled[i + 1];
    for (let j = 0; j + 1 < otherSampled.length; j++) {
      const b1 = otherSampled[j];
      const b2 = otherSampled[j + 1];
      const hit = segSegHit2D(a1, a2, b1, b2);
      if (!hit) continue;
      const nearOpenEndpoint = openEndpoints.some(
        (ep) => Math.hypot(hit[0] - ep[0], hit[1] - ep[1]) <= endpointGrace,
      );
      if (!nearOpenEndpoint) return true;
    }
  }
  return false;
}

/**
 * Pure 2D geometric crossing detector for roads & trails (evaluates actual Catmull-Rom curves).
 * Used both by the Argon Director world summary and by `/api/audit` verification.
 */
export function detectPathCrossings(paths: WorldPath[]): {
  count: number;
  pairs: string[];
} {
  const valid = paths.filter((p) => Array.isArray(p.points) && p.points.length >= 2);
  const sampled = valid.map((p) => ({
    path: p,
    curve: sampleCatmullRom2D(p.points, Boolean(p.closed), 0.7),
  }));

  const pairs: string[] = [];

  // 1. Self-intersections
  for (const s of sampled) {
    const pts = s.path.points;
    if (pts.length >= 4) {
      const check = uncrossPolyline2D(pts, Boolean(s.path.closed));
      if (check.changed) {
        pairs.push(`${s.path.id} (self-crossing)`);
      }
    }
  }

  // 2. Pairwise crossings & road-interior intrusions
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      const A = sampled[i];
      const B = sampled[j];
      const aRoad = A.path.kind === "road";
      const bRoad = B.path.kind === "road";

      if (aRoad && bRoad) {
        if (
          polylineIntersectsCurveInterior(
            A.curve,
            Boolean(A.path.closed),
            B.curve,
            Boolean(B.path.closed),
            2.15,
          )
        ) {
          pairs.push(`${A.path.id} x ${B.path.id}`);
        }
      } else if (aRoad !== bRoad) {
        const road = aRoad ? A : B;
        const trail = aRoad ? B : A;
        let intrudesRoad = false;
        for (const [tx, tz] of trail.curve) {
          if (distPointToPolyline2D(tx, tz, road.curve).dist < 1.95) {
            intrudesRoad = true;
            break;
          }
        }
        if (
          intrudesRoad ||
          polylineIntersectsCurveInterior(
            trail.curve,
            Boolean(trail.path.closed),
            road.curve,
            Boolean(road.path.closed),
            0.0,
          )
        ) {
          pairs.push(`${trail.path.id} x ${road.path.id}`);
        }
      } else {
        if (
          polylineIntersectsCurveInterior(
            A.curve,
            Boolean(A.path.closed),
            B.curve,
            Boolean(B.path.closed),
            0.95,
          )
        ) {
          pairs.push(`${A.path.id} x ${B.path.id}`);
        }
      }
    }
  }

  return { count: pairs.length, pairs };
}

/**
 * Deterministic contextual road & path classifier based on building/landmark function:
 * - `"volcanic_trail"` -> volcanoes, lava calderas, obsidian peaks
 * - `"boardwalk"`      -> beaches, coastlines, islands, surf docks, hammocks
 * - `"road"`           -> mines/quarries, heavy industry, firehouses, datacentres, downtown towers, terminals
 * - `"dirt_trail"`     -> waterfalls, cliffs, canyons, mountain camps, deep forest clearings
 * - `"cobblestone"`    -> grand civic halls, parliaments, mansions, manors, arenas, amphitheatres, courts, pavilions, ziggurats, clocktowers
 * - `"cottage_road"`   -> cottages, houses, bakeries, windmills, bookshops, pubs, cantinas, burger shacks, farms, apiaries
 */
export function inferContextualRoadKind(
  target: Pick<WorldCreation, "name" | "description" | "creatorPrompt" | "category">,
): PathKind {
  const text = `${target.name ?? ""} ${target.description ?? ""} ${target.creatorPrompt ?? ""}`;
  if (/\b(volcano|magma|lava|caldera|obsidian|geyser|brimstone)\b/i.test(text)) {
    return "volcanic_trail";
  }
  if (
    /\b(beach|surf|surfboard|lifeguard|dock|pier|coast(?:line|al)?|lagoon|island|tiki|hammock|lounger|palm)\b/i.test(
      text,
    )
  ) {
    return "boardwalk";
  }
  if (
    /\b(quarry|mine|mining|ore|refinery|smelter|foundry|factory|plant|warehouse|depot|firehouse|fire\s*station|datacentre|datacenter|steel\s*tower|glass\s*tower|office\s*tower|modernist.*tower|skyscraper|terminal|airport|spaceport|launchpad|launch\s*pad|rocket)\b/i.test(
      text,
    )
  ) {
    return "road";
  }
  if (
    /\b(waterfall|cascade|cataract|cliff|canyon|mountain|peak|forest|woods|grove|camp|campsite|tent|wilderness|cave|grotto)\b/i.test(
      text,
    )
  ) {
    return "dirt_trail";
  }
  if (
    /\b(castle|citadel|fortress|palace|mansion|manor|villa|estate|parliament|capitol|cathedral|temple|shrine|museum|library|clocktower|arena|stadium|colosseum|amphitheater|amphitheatre|pavilion|plaza|fountain|monument|ziggurat|pyramid|court|pickleball|padel|tennis|half-?pipe|skate)\b/i.test(
      text,
    )
  ) {
    return "cobblestone";
  }
  if (
    /\b(cottage|house|home|cabin|chalet|bungalow|shoe|boot|bakery|windmill|mill|bookshop|shop|store|pub|inn|tavern|cantina|burrito|shack|burger|diner|cafe|farm|barn|orchard|apiary|beehive|garden|greenhouse)\b/i.test(
      text,
    )
  ) {
    return "cottage_road";
  }
  return target.category === "building" ? "cottage_road" : "dirt_trail";
}

function wrapAnglePi(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function deterministicHashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Intelligent SimCity frontage alignment:
 * Snaps architectural city and village buildings uniformly to their fronting street block
 * (`0`, `±π/2`, `π`, or `45°` on diagonal boulevards — zero random jitter), while leaving
 * quarries, mines, waterfalls, cliffs, islands, and beach hammocks at their natural orientation.
 */
export function alignLandmarksToFrontage(
  creations: WorldCreation[],
  paths: WorldPath[],
): { changedIds: string[] } {
  const changedIds: string[] = [];
  if (!paths || paths.length === 0) return { changedIds };

  for (const c of creations) {
    if (c.isSeed || c.isCompanion) continue;
    if (c.category !== "building" && c.behavior?.type !== "landmark") continue;

    const desiredYaw = computeIntelligentBuildingYaw(c, paths);
    if (desiredYaw === null) continue;

    const yawDiff = Math.abs(wrapAnglePi((c.yaw || 0) - desiredYaw));
    const behaviorDiff =
      c.behavior?.type === "landmark"
        ? c.behavior.facingYaw === undefined
          ? 1
          : Math.abs(wrapAnglePi(c.behavior.facingYaw - desiredYaw))
        : 0;

    if (yawDiff > 0.04 || behaviorDiff > 0.04) {
      c.yaw = desiredYaw;
      if (c.behavior?.type === "landmark") {
        c.behavior = { ...c.behavior, facingYaw: desiredYaw };
      }
      changedIds.push(c.id);
    }
  }

  return { changedIds };
}

/**
 * World-level spatial overlap & planar road/path topology auditor + deterministic auto-repair:
 * - Eliminates crossing roads & crossing trails (clipping trails cleanly at road stone curbs `2.52m` from road centerlines).
 * - Prunes stale `initpath-*` placeholders and redundant parallel corridor duplicates.
 * - Prevents footpath flagstones from poking inside building plinths or pond water.
 * - Guarantees every stationary landmark remains connected to the road/trail network.
 * - Separates stacked/overlapping props idempotently.
 */
export function auditAndRepairWorldSpatial(
  creations: WorldCreation[],
  paths: WorldPath[],
  props: WorldProp[],
): {
  paths: WorldPath[];
  props: WorldProp[];
  report: WorldSpatialAuditReport;
} {
  const details: string[] = [];
  let footpathTrimCount = 0;
  let pathCrossingsFixed = 0;
  let redundantPathsRemoved = 0;
  let propNudgeCount = 0;

  const creationsById = new Map(creations.map((c) => [c.id, c]));
  const buildings = creations.filter(
    (c) => c.category === "building" || c.behavior?.type === "landmark",
  );
  const mobileCreations = creations.filter(
    (c) => c.category !== "building" && c.behavior?.type !== "landmark",
  );
  const ponds = props.filter((p) => p.kind === "pond");

  const plinthRadiusOf = (c: WorldCreation): number =>
    getCreationFootprintRadius(
      c.scaleClass,
      c.blueprint?.stats?.footprintX ?? 14,
      c.blueprint?.stats?.footprintZ ?? 14,
    );

  const pushPointClearOfObstacles = (
    px: number,
    pz: number,
    neighbor: [number, number],
    isRoad: boolean,
  ): { pt: [number, number]; moved: boolean } => {
    let x = px;
    let z = pz;
    let moved = false;
    if (isRoad) return { pt: [x, z], moved: false };

    for (let pass = 0; pass < 3; pass++) {
      let passMoved = false;
      for (const b of buildings) {
        const minR = plinthRadiusOf(b);
        const dx = x - b.x;
        const dz = z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < minR) {
          const ndx = neighbor[0] - b.x;
          const ndz = neighbor[1] - b.z;
          const nd = Math.hypot(ndx, ndz);
          const ux = d > 0.05 ? dx / d : nd > 0.05 ? ndx / nd : Math.sin(b.yaw || 0);
          const uz = d > 0.05 ? dz / d : nd > 0.05 ? ndz / nd : Math.cos(b.yaw || 0);
          x = round1(b.x + ux * (minR + 0.42));
          z = round1(b.z + uz * (minR + 0.42));
          moved = true;
          passMoved = true;
        }
      }
      for (const pond of ponds) {
        const pr = (pond.radius ?? 6.5) - 0.15;
        const dx = x - pond.x;
        const dz = z - pond.z;
        const d = Math.hypot(dx, dz);
        if (d < pr) {
          const ux = d > 0.05 ? dx / d : 1;
          const uz = d > 0.05 ? dz / d : 0;
          x = round1(pond.x + ux * ((pond.radius ?? 6.5) + 0.45));
          z = round1(pond.z + uz * ((pond.radius ?? 6.5) + 0.45));
          moved = true;
          passMoved = true;
        }
      }
      if (!passMoved) break;
    }
    return { pt: [x, z], moved };
  };

  // Pre-scan active vehicle routes to identify whether any non-seed asphalt road is actually driven on
  const mainLoopSeed = paths.find((p) => p.id === "path-main-loop");
  const mainLoopRefCurve = mainLoopSeed
    ? sampleCatmullRom2D(mainLoopSeed.points, true, 0.7)
    : [];
  const activeVehicleRouteSets = creations
    .filter(
      (
        c,
      ): c is WorldCreation & {
        behavior: Extract<CreationBehavior, { type: "vehicle_route" }>;
      } =>
        c.behavior?.type === "vehicle_route" &&
        Array.isArray(c.behavior.waypoints) &&
        c.behavior.waypoints.length >= (c.behavior.loopMode === "pingpong" ? 2 : 3),
    )
    .map((c) => c.behavior.waypoints);

  // Pre-scan non-init paths to see which creations already have dedicated integrated paths
  const nonInitPaths = paths.filter(
    (p) =>
      !p.id.startsWith("initpath-") &&
      !p.id.startsWith("initroad-") &&
      !p.id.startsWith("spur-") &&
      p.points.length >= 2,
  );

  // Stage 1: Upgrade legacy village-green mud strip, prune unused secondary asphalt roads & stale placeholders
  const candidatePool: WorldPath[] = [];
  for (const p of paths) {
    if (!Array.isArray(p.points) || p.points.length < 2) continue;

    if (SEED_PATH_IDS.has(p.id)) {
      if (p.id === "path-green-walk" && p.kind === "dirt_trail") {
        footpathTrimCount++;
        details.push(`refined central "path-green-walk" to garden stepping stones`);
        candidatePool.push({ ...p, kind: "footpath" });
      } else {
        candidatePool.push(p);
      }
      continue;
    }

    if (p.kind === "road") {
      // Allow:
      // 1. Smooth closed outer loops (minOrigin >= 95m) driven by outer loop vehicles, OR
      // 2. Clean open collector/haul roads (!p.closed) serving industrial/mining/firehouse landmarks or active vehicle routes.
      const minRad = Math.min(...p.points.map(([rx, rz]) => Math.hypot(rx, rz)));
      const isOuterSmoothLoop = Boolean(p.closed) && p.points.length >= 6 && minRad >= 95;
      const roadCurve = sampleCatmullRom2D(p.points, Boolean(p.closed), 0.75);
      const usedByActiveVehicle = activeVehicleRouteSets.some((wps) => {
        let offMainMatches = 0;
        for (const [wx, wz] of wps) {
          const onMain =
            mainLoopRefCurve.length >= 2 &&
            distPointToPolyline2D(wx, wz, mainLoopRefCurve).dist <= 5.0;
          if (!onMain && distPointToPolyline2D(wx, wz, roadCurve).dist <= 4.8) {
            offMainMatches++;
          }
        }
        return offMainMatches >= (p.closed ? 3 : 1);
      });
      const servesDistrictLandmark =
        !p.closed &&
        polylineLength2D(roadCurve) >= 7.5 &&
        (p.id.startsWith("road-") ||
          p.id.startsWith("grid-") ||
          buildings.some(
            (b) => distPointToPolyline2D(b.x, b.z, roadCurve).dist <= plinthRadiusOf(b) + 7.5,
          ));
      const keepRoad =
        (isOuterSmoothLoop && usedByActiveVehicle) ||
        (!p.closed && (usedByActiveVehicle || servesDistrictLandmark));
      if (!keepRoad) {
        redundantPathsRemoved++;
        details.push(`removed cluttered secondary asphalt road "${p.id}"`);
        continue;
      }
    }

    if (p.id.startsWith("initpath-")) {
      const cid = p.id.slice("initpath-".length);
      const owner = creationsById.get(cid);
      if (!owner || owner.behavior?.type !== "landmark") {
        redundantPathsRemoved++;
        details.push(`removed stale placeholder trail "${p.id}"`);
        continue;
      }
      const footR = plinthRadiusOf(owner);
      const hasBetterPath = nonInitPaths.some((other) =>
        other.points.some(([ox, oz]) => Math.hypot(ox - owner.x, oz - owner.z) <= footR + 6.2),
      );
      if (hasBetterPath) {
        redundantPathsRemoved++;
        details.push(`removed superseded placeholder trail "${p.id}" for "${owner.name}"`);
        continue;
      }
    }

    if (p.id.startsWith("initroad-")) {
      const cid = p.id.slice("initroad-".length);
      const owner = creationsById.get(cid);
      if (!owner || owner.behavior?.type !== "vehicle_route") {
        redundantPathsRemoved++;
        details.push(`removed stale placeholder road "${p.id}"`);
        continue;
      }
      const hasIntegratedRoad = nonInitPaths.some(
        (other) =>
          other.points.some(([ox, oz]) => Math.hypot(ox - owner.x, oz - owner.z) <= 10.0) &&
          owner.integratedLevel >= 2,
      );
      if (hasIntegratedRoad) {
        redundantPathsRemoved++;
        details.push(`removed superseded placeholder road "${p.id}"`);
        continue;
      }
    }

    let candidatePath = p;
    if (p.id.startsWith("spur-") || p.id.startsWith("initpath-")) {
      const prefix = p.id.startsWith("spur-") ? "spur-" : "initpath-";
      const cid = p.id.slice(prefix.length);
      const owner = creationsById.get(cid);
      if (!owner || (owner.category !== "building" && owner.behavior?.type !== "landmark")) {
        redundantPathsRemoved++;
        details.push(`removed stale landmark spur "${p.id}"`);
        continue;
      }
      const desired = inferContextualRoadKind(owner);
      const resolvedKind: PathKind =
        desired === "road" && p.kind !== "road" ? "cobblestone" : desired;
      if (candidatePath.kind !== resolvedKind) {
        footpathTrimCount++;
        details.push(`contextualized "${p.id}" from ${candidatePath.kind} to ${resolvedKind}`);
        candidatePath = { ...candidatePath, kind: resolvedKind };
      }
    }

    if (candidatePath.kind !== "road") {
      const firstPt = candidatePath.points[0];
      const lastPt = candidatePath.points[candidatePath.points.length - 1];
      const servesLandmark =
        buildings.some((b) => {
          const r = plinthRadiusOf(b) + 6.5;
          return (
            Math.hypot(firstPt[0] - b.x, firstPt[1] - b.z) <= r ||
            Math.hypot(lastPt[0] - b.x, lastPt[1] - b.z) <= r
          );
        }) ||
        ponds.some((pond) => {
          const r = (pond.radius ?? 6.5) + 4.0;
          return (
            Math.hypot(firstPt[0] - pond.x, firstPt[1] - pond.z) <= r ||
            Math.hypot(lastPt[0] - pond.x, lastPt[1] - pond.z) <= r
          );
        });
      const targetsMobileOnly =
        !servesLandmark &&
        mobileCreations.some(
          (mc) =>
            Math.hypot(firstPt[0] - mc.x, firstPt[1] - mc.z) < 6.8 ||
            Math.hypot(lastPt[0] - mc.x, lastPt[1] - mc.z) < 6.8,
        );
      if (targetsMobileOnly) {
        redundantPathsRemoved++;
        details.push(`removed orphan trail "${candidatePath.id}" targeting mobile creation`);
        continue;
      }
    }

    candidatePool.push(candidatePath);
  }

  // Priority order (radially outward from village core within each tier so inner paths accept before outer branches!):
  // 0. Seed main loop ("path-main-loop")
  // 1. Other seed paths
  // 2. Active vehicle roads
  // 3. Integrated pedestrian walkways (sorted radially outward from [0,0])
  // 4. Remaining initpath-* spurs
  // 5. Auto-generated Stage 5 radial spurs ("spur-*", sorted by owner landmark radial distance)
  const kindRank = (p: WorldPath): number => {
    if (p.id === "path-main-loop" || p.id === "path-outer-ring") return 0;
    if (SEED_PATH_IDS.has(p.id)) return 1;
    if (p.kind === "road") return 2;
    if (p.id.startsWith("spur-")) return 5;
    if (p.id.startsWith("initpath-")) return 4;
    return 3;
  };
  const sortDistKey = (p: WorldPath): number => {
    if (p.id.startsWith("spur-")) {
      const owner = creationsById.get(p.id.slice("spur-".length));
      if (owner) return Math.hypot(owner.x, owner.z);
    }
    return Math.min(...p.points.map(([x, z]) => Math.hypot(x, z)));
  };

  candidatePool.sort(
    (a, b) => kindRank(a) - kindRank(b) || sortDistKey(a) - sortDistKey(b) || a.id.localeCompare(b.id),
  );

  interface AcceptedPathEntry {
    path: WorldPath;
    curve: [number, number][];
    isRoad: boolean;
  }
  const accepted: AcceptedPathEntry[] = [];
  const acceptedCurbJunctions: { roadId: string; x: number; z: number; sign: number }[] = [];

  const getRoadCurbJunctions = (
    curvePts: [number, number][],
    closed: boolean,
  ): { roadId: string; x: number; z: number; sign: number }[] => {
    if (closed || curvePts.length < 2) return [];
    const out: { roadId: string; x: number; z: number; sign: number }[] = [];
    const endIndices = [
      { endIdx: 0, refIdx: Math.min(curvePts.length - 1, 2) },
      { endIdx: curvePts.length - 1, refIdx: Math.max(0, curvePts.length - 3) },
    ];
    for (const { endIdx, refIdx } of endIndices) {
      const ep = curvePts[endIdx];
      const ref = curvePts[refIdx];
      for (const acc of accepted) {
        if (!acc.isRoad) continue;
        const h = distPointToPolyline2D(ep[0], ep[1], acc.curve);
        if (h.dist <= 3.1) {
          const dot = (ref[0] - h.closestX) * h.normalX + (ref[1] - h.closestZ) * h.normalZ;
          out.push({
            roadId: acc.path.id,
            x: h.closestX,
            z: h.closestZ,
            sign: dot >= 0 ? 1 : -1,
          });
        }
      }
    }
    return out;
  };

  const hasOppositeCurbCrossOver = (
    curvePts: [number, number][],
    closed: boolean,
  ): boolean => {
    const junctions = getRoadCurbJunctions(curvePts, closed);
    for (const jn of junctions) {
      if (
        acceptedCurbJunctions.some(
          (prev) =>
            prev.roadId === jn.roadId &&
            prev.sign === -jn.sign &&
            Math.hypot(prev.x - jn.x, prev.z - jn.z) < 6.2,
        )
      ) {
        return true;
      }
    }
    return false;
  };

  const landmarkConnectedByAccepted = (b: WorldCreation): boolean => {
    const baseR = plinthRadiusOf(b);
    for (const acc of accepted) {
      const reach = baseR + (acc.isRoad ? 5.6 : 3.8);
      if (distPointToPolyline2D(b.x, b.z, acc.curve).dist <= reach) return true;
    }
    return false;
  };

  const isEndpointAnchored = (pt: [number, number], forRoad = false): boolean => {
    const [x, z] = pt;
    for (const acc of accepted) {
      if (forRoad && !acc.isRoad) continue;
      if (distPointToPolyline2D(x, z, acc.curve).dist <= 3.7) return true;
    }
    for (const b of buildings) {
      if (Math.hypot(x - b.x, z - b.z) <= plinthRadiusOf(b) + (forRoad ? 7.5 : 5.6)) return true;
    }
    if (!forRoad) {
      for (const pr of ponds) {
        if (Math.hypot(x - pr.x, z - pr.z) <= (pr.radius ?? 6.5) + 3.8) return true;
      }
    }
    return false;
  };

  const touchesConnectedNetwork = (pt: [number, number], forRoad = false): boolean => {
    const [x, z] = pt;
    for (const acc of accepted) {
      if (forRoad && !acc.isRoad) continue;
      if (distPointToPolyline2D(x, z, acc.curve).dist <= 3.7) return true;
    }
    if (!forRoad) {
      for (const b of buildings) {
        if (
          landmarkConnectedByAccepted(b) &&
          Math.hypot(x - b.x, z - b.z) <= plinthRadiusOf(b) + 5.6
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const isPointNearAccOpenEnd = (px: number, pz: number, acc: AcceptedPathEntry, grace: number): boolean => {
    if (acc.path.closed || acc.curve.length < 2) return false;
    const s = acc.curve[0];
    const e = acc.curve[acc.curve.length - 1];
    return Math.hypot(px - s[0], pz - s[1]) <= grace || Math.hypot(px - e[0], pz - e[1]) <= grace;
  };

  const validateCleanSpline = (
    ctrlPts: [number, number][],
    closed: boolean,
    isRoad: boolean,
  ): [number, number][] | null => {
    const curve = sampleCatmullRom2D(ctrlPts, closed, 0.6);
    if (curve.length < 2) return null;
    const cum: number[] = [0];
    for (let i = 1; i < curve.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]));
    }
    const tot = cum[curve.length - 1];

    for (const acc of accepted) {
      if (isRoad && acc.isRoad) {
        for (let i = 0; i < curve.length; i++) {
          const nearEnd = !closed && (cum[i] <= 1.25 || tot - cum[i] <= 1.25);
          if (distPointToPolyline2D(curve[i][0], curve[i][1], acc.curve).dist < (nearEnd ? 1.92 : 2.22)) {
            return null;
          }
        }
        if (polylineIntersectsCurveInterior(curve, closed, acc.curve, Boolean(acc.path.closed), 2.10)) {
          return null;
        }
      } else if (isRoad !== acc.isRoad) {
        for (const [cx, cz] of curve) {
          if (distPointToPolyline2D(cx, cz, acc.curve).dist < 2.16) return null;
        }
        if (polylineIntersectsCurveInterior(curve, closed, acc.curve, Boolean(acc.path.closed), 0.0)) {
          return null;
        }
      } else {
        for (let i = 0; i < curve.length; i++) {
          const nearOwnEnd = !closed && (cum[i] <= 1.25 || tot - cum[i] <= 1.25);
          const nearAccEnd = isPointNearAccOpenEnd(curve[i][0], curve[i][1], acc, 1.25);
          if (!nearOwnEnd && !nearAccEnd && distPointToPolyline2D(curve[i][0], curve[i][1], acc.curve).dist < 0.85) {
            return null;
          }
        }
        if (polylineIntersectsCurveInterior(curve, closed, acc.curve, Boolean(acc.path.closed), 0.90)) {
          return null;
        }
      }
    }
    return curve;
  };

  // Check corridor redundancy, road-hugging tracks, central village-green clutter & dangling ends
  const checkRedundant = (
    curvePts: [number, number][],
    curveClosed: boolean,
    isRoad: boolean,
  ): boolean => {
    if (accepted.length === 0 || curvePts.length < 2) return false;

    const totalCurveLen = polylineLength2D(curvePts);

    // Never allow non-seed asphalt roads to cut across Central Park inside path-main-loop
    if (isRoad) {
      let insideGreen = 0;
      for (const [sx, sz] of curvePts) {
        if (Math.abs(sx) < 20.5 && Math.abs(sz) < 16.5) insideGreen++;
      }
      if (insideGreen / curvePts.length >= 0.25) {
        return true;
      }
    }

    // Open paths/collector roads must have BOTH ends anchored and connect into the accepted island network
    if (!curveClosed) {
      const pStart = curvePts[0];
      const pEnd = curvePts[curvePts.length - 1];
      if (!isEndpointAnchored(pStart, isRoad) || !isEndpointAnchored(pEnd, isRoad)) {
        return true;
      }
      if (!touchesConnectedNetwork(pStart, isRoad) && !touchesConnectedNetwork(pEnd, isRoad)) {
        return true;
      }
    }

    // Keep if an active vehicle route relies on this open road branch
    if (isRoad && !curveClosed) {
      const drivenOnBranch = activeVehicleRouteSets.some((wps) => {
        let branchHits = 0;
        for (const [wx, wz] of wps) {
          const onMain =
            mainLoopRefCurve.length >= 2 &&
            distPointToPolyline2D(wx, wz, mainLoopRefCurve).dist <= 5.0;
          if (!onMain && distPointToPolyline2D(wx, wz, curvePts).dist <= 4.8) {
            branchHits++;
          }
        }
        return branchHits >= 1;
      });
      if (drivenOnBranch) return false;
    }

    // Keep if this path uniquely connects an otherwise-unconnected landmark
    const uniquelyConnectsLandmark = buildings.some((b) => {
      if (landmarkConnectedByAccepted(b)) return false;
      const reach = plinthRadiusOf(b) + (isRoad ? 7.2 : 3.8);
      return distPointToPolyline2D(b.x, b.z, curvePts).dist <= reach;
    });

    // Keep Central Park inside path-main-loop calm (only short direct landmark curb spurs allowed)
    if (!isRoad) {
      let insideCentralGreen = 0;
      for (const [sx, sz] of curvePts) {
        if (Math.abs(sx) < 21.2 && Math.abs(sz) < 17.2) {
          insideCentralGreen++;
        }
      }
      if (insideCentralGreen / curvePts.length > 0.30) {
        if (!uniquelyConnectsLandmark || totalCurveLen > 16.5) {
          return true;
        }
      }

      // Prune circumferential tracks running parallel beside an accepted asphalt road
      let parallelRoadLen = 0;
      for (let i = 0; i + 1 < curvePts.length; i++) {
        const ax = curvePts[i][0];
        const az = curvePts[i][1];
        const dx = curvePts[i + 1][0] - ax;
        const dz = curvePts[i + 1][1] - az;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 1e-4) continue;
        const mx = ax + dx * 0.5;
        const mz = az + dz * 0.5;
        for (const acc of accepted) {
          if (!acc.isRoad) continue;
          const h = distPointToPolyline2D(mx, mz, acc.curve);
          if (h.dist <= 10.2) {
            const radialDot = Math.abs((dx / segLen) * h.normalX + (dz / segLen) * h.normalZ);
            if (radialDot < 0.62) {
              parallelRoadLen += segLen;
            }
            break;
          }
        }
      }
      if (
        parallelRoadLen >= 7.2 ||
        (totalCurveLen > 8.0 && parallelRoadLen / Math.max(0.1, totalCurveLen) >= 0.45)
      ) {
        return true;
      }
    }

    // Prevent opposite-curb 4-way visual X-crossovers across an accepted road unless uniquely required by a landmark
    if (!uniquelyConnectsLandmark && hasOppositeCurbCrossOver(curvePts, curveClosed)) {
      return true;
    }

    const proxThresh = isRoad ? 7.6 : 4.2;
    let closeCount = 0;
    for (const [sx, sz] of curvePts) {
      for (const acc of accepted) {
        if (isRoad && !acc.isRoad) continue;
        if (distPointToPolyline2D(sx, sz, acc.curve).dist <= proxThresh) {
          closeCount++;
          break;
        }
      }
    }
    const ratio = closeCount / curvePts.length;
    if (ratio < (isRoad ? 0.62 : 0.58)) return false;

    return !uniquelyConnectsLandmark;
  };

  const normalizePathControlPoints = (
    rawPts: [number, number][],
    closed: boolean,
    isRoad: boolean,
  ): {
    points: [number, number][];
    deKinked: boolean;
    selfUncrossed: boolean;
    trimmedPlinth: boolean;
  } => {
    let pts: [number, number][] = rawPts.map(([x, z]) => [x, z]);
    let deKinked = false;
    let selfUncrossed = false;
    let trimmedPlinth = false;

    const kinkRes = deKinkPolyline2D(pts, closed);
    if (kinkRes.changed) {
      pts = kinkRes.points;
      deKinked = true;
    }
    if (pts.length < 2) {
      return { points: pts, deKinked, selfUncrossed, trimmedPlinth };
    }

    const uncrossed = uncrossPolyline2D(pts, closed);
    if (uncrossed.changed) {
      pts = uncrossed.points;
      selfUncrossed = true;
    }

    if (!isRoad) {
      for (let idx = 0; idx < pts.length; idx++) {
        const neighbor = pts[idx === 0 ? 1 : idx - 1];
        const nudged = pushPointClearOfObstacles(pts[idx][0], pts[idx][1], neighbor, false);
        if (nudged.moved) {
          pts[idx] = nudged.pt;
          trimmedPlinth = true;
        }
      }
      if (trimmedPlinth) {
        const reKink = deKinkPolyline2D(pts, closed);
        if (reKink.changed) {
          pts = reKink.points;
          deKinked = true;
        }
        const reUncross = uncrossPolyline2D(pts, closed);
        if (reUncross.changed) {
          pts = reUncross.points;
          selfUncrossed = true;
        }
      }
    }
    return { points: pts, deKinked, selfUncrossed, trimmedPlinth };
  };

  for (const rawPath of candidatePool) {
    if (SEED_PATH_IDS.has(rawPath.id)) {
      const curve = sampleCatmullRom2D(rawPath.points, Boolean(rawPath.closed), 0.65);
      accepted.push({ path: rawPath, curve, isRoad: rawPath.kind === "road" });
      continue;
    }

    const isRoad = rawPath.kind === "road";
    const closed = Boolean(rawPath.closed) && rawPath.points.length >= 3;
    const norm = normalizePathControlPoints(rawPath.points, closed, isRoad);
    const pts = norm.points;
    const { deKinked, selfUncrossed, trimmedPlinth } = norm;

    if (pts.length < 2) {
      redundantPathsRemoved++;
      details.push(`removed degenerate path "${rawPath.id}"`);
      continue;
    }
    if (selfUncrossed) {
      pathCrossingsFixed++;
      details.push(`uncrossed self-intersecting ${rawPath.kind} "${rawPath.id}"`);
    }

    // Step C: Sample curve and inspect against already-accepted planar network
    const sampled = sampleCatmullRom2D(pts, closed, 0.6);
    if (sampled.length < 2) continue;

    // Determine which sampled points are blocked by road interiors or trail crossings
    const M = sampled.length;
    const cumArc: number[] = [0];
    for (let i = 1; i < M; i++) {
      cumArc.push(
        cumArc[i - 1] + Math.hypot(sampled[i][0] - sampled[i - 1][0], sampled[i][1] - sampled[i - 1][1]),
      );
    }
    const totalArc = cumArc[M - 1];

    const blocked = new Uint8Array(M);
    let hasAnyCrossing = false;

    for (let i = 0; i < M; i++) {
      const [sx, sz] = sampled[i];
      const nearOwnOpenEnd = !closed && (cumArc[i] <= 1.25 || totalArc - cumArc[i] <= 1.25);

      for (const acc of accepted) {
        if (acc.isRoad) {
          const hit = distPointToPolyline2D(sx, sz, acc.curve);
          if (isRoad) {
            if (hit.dist < (nearOwnOpenEnd ? 1.85 : 2.15)) {
              blocked[i] = 1;
              hasAnyCrossing = true;
              break;
            }
          } else {
            if (hit.dist < 2.10) {
              blocked[i] = 1;
              hasAnyCrossing = true;
              break;
            }
          }
        } else if (isRoad) {
          const hit = distPointToPolyline2D(sx, sz, acc.curve);
          if (hit.dist < 2.10) {
            blocked[i] = 1;
            hasAnyCrossing = true;
            break;
          }
        } else {
          const hit = distPointToPolyline2D(sx, sz, acc.curve);
          const nearAccEnd = isPointNearAccOpenEnd(sx, sz, acc, 1.30);
          if (!nearOwnOpenEnd && !nearAccEnd && hit.dist < 0.80) {
            blocked[i] = 1;
            hasAnyCrossing = true;
            break;
          }
        }
      }
    }

    // Also mark exact segment-segment crossings
    for (let i = 0; i + 1 < M; i++) {
      const a1 = sampled[i];
      const a2 = sampled[i + 1];
      const nearOwnOpenEnd =
        !closed && (cumArc[i + 1] <= 0.95 || totalArc - cumArc[i] <= 0.95);

      for (const acc of accepted) {
        for (let j = 0; j + 1 < acc.curve.length; j++) {
          const hit = segSegHit2D(a1, a2, acc.curve[j], acc.curve[j + 1]);
          if (!hit) continue;
          const nearAccOpenEnd = isPointNearAccOpenEnd(hit[0], hit[1], acc, 0.95);
          if (!isRoad && !acc.isRoad && (nearOwnOpenEnd || nearAccOpenEnd)) continue;
          blocked[i] = 1;
          blocked[i + 1] = 1;
          hasAnyCrossing = true;
          break;
        }
        if (blocked[i] && blocked[i + 1]) break;
      }
    }

    if (!hasAnyCrossing) {
      if (checkRedundant(sampled, closed, isRoad)) {
        redundantPathsRemoved++;
        details.push(`removed redundant or unanchored ${rawPath.kind} "${rawPath.id}"`);
        continue;
      }
      const nextPath =
        trimmedPlinth || selfUncrossed || deKinked ? { ...rawPath, points: pts } : rawPath;
      if (trimmedPlinth || deKinked) {
        footpathTrimCount++;
        details.push(`smoothed/trimmed ${rawPath.kind} "${rawPath.id}"`);
      }
      const pathJunctions = getRoadCurbJunctions(sampled, closed);
      accepted.push({ path: nextPath, curve: sampled, isRoad });
      acceptedCurbJunctions.push(...pathJunctions);
      continue;
    }

    // Step D: Path had 1+ road/trail crossings — split into clean exterior segments snapped to curbs!
    pathCrossingsFixed++;
    const runs: { start: number; end: number }[] = [];
    let runStart = -1;
    for (let i = 0; i < M; i++) {
      if (!blocked[i]) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        if (i - 1 >= runStart) runs.push({ start: runStart, end: i - 1 });
        runStart = -1;
      }
    }
    if (runStart !== -1 && M - 1 >= runStart) {
      runs.push({ start: runStart, end: M - 1 });
    }
    if (closed && runs.length >= 2 && runs[0].start === 0 && runs[runs.length - 1].end === M - 1) {
      const tail = runs.pop()!;
      runs[0] = { start: tail.start, end: runs[0].end + M };
    }

    const snapCutBoundary = (freePt: [number, number], interiorRef: [number, number]): [number, number] => {
      let bestAcc: AcceptedPathEntry | null = null;
      let bestHit: ReturnType<typeof distPointToPolyline2D> | null = null;
      for (const acc of accepted) {
        const h = distPointToPolyline2D(freePt[0], freePt[1], acc.curve);
        if (!bestHit || h.dist < bestHit.dist) {
          bestHit = h;
          bestAcc = acc;
        }
      }
      if (!bestAcc || !bestHit || bestHit.dist > 4.2) {
        return [round1(freePt[0]), round1(freePt[1])];
      }
      const targetOffset = isRoad || bestAcc.isRoad ? 2.52 : 0.48;
      const refDx = interiorRef[0] - bestHit.closestX;
      const refDz = interiorRef[1] - bestHit.closestZ;
      const dot = refDx * bestHit.normalX + refDz * bestHit.normalZ;
      const sign = dot >= 0 ? 1 : -1;
      const nx = bestHit.normalX * sign;
      const nz = bestHit.normalZ * sign;
      const rawSnap: [number, number] = [
        round1(bestHit.closestX + nx * targetOffset),
        round1(bestHit.closestZ + nz * targetOffset),
      ];
      return pushPointClearOfObstacles(rawSnap[0], rawSnap[1], interiorRef, isRoad).pt;
    };

    let keptPieces = 0;
    const keptCutEnds: [number, number][] = [];
    for (let rIdx = 0; rIdx < runs.length; rIdx++) {
      const r = runs[rIdx];
      const subSamples: [number, number][] = [];
      for (let k = r.start; k <= r.end; k++) {
        subSamples.push(sampled[k % M]);
      }
      if (subSamples.length < 2) continue;

      const cutAtStart = r.start > 0 || closed;
      const cutAtEnd = r.end < M - 1 || closed;
      const refStart = subSamples[Math.min(subSamples.length - 1, 2)];
      const refEnd = subSamples[Math.max(0, subSamples.length - 3)];

      if (cutAtStart) {
        subSamples[0] = snapCutBoundary(subSamples[0], refStart);
      }
      if (cutAtEnd) {
        subSamples[subSamples.length - 1] = snapCutBoundary(
          subSamples[subSamples.length - 1],
          refEnd,
        );
      }

      const arcLen = polylineLength2D(subSamples);
      const minArc = isRoad ? 6.0 : 3.2;
      const connectsUnconnectedLandmark = buildings.some((b) => {
        if (landmarkConnectedByAccepted(b)) return false;
        return distPointToPolyline2D(b.x, b.z, subSamples).dist <= plinthRadiusOf(b) + 5.8;
      });
      if (arcLen < (connectsUnconnectedLandmark ? 1.85 : minArc)) continue;

      const formsOppositeCurbX =
        !connectsUnconnectedLandmark &&
        ((cutAtStart && keptCutEnds.some((ep) => Math.hypot(ep[0] - subSamples[0][0], ep[1] - subSamples[0][1]) < 8.5)) ||
          (cutAtEnd &&
            keptCutEnds.some(
              (ep) =>
                Math.hypot(
                  ep[0] - subSamples[subSamples.length - 1][0],
                  ep[1] - subSamples[subSamples.length - 1][1],
                ) < 8.5,
            )));
      if (formsOppositeCurbX) continue;

      const startOk = isEndpointAnchored(subSamples[0]);
      const endOk = isEndpointAnchored(subSamples[subSamples.length - 1]);
      if (!startOk || !endOk) continue;

      let ctrlPts = simplifyRDP2D(subSamples, 0.35, isRoad ? 7 : 4);
      ctrlPts = normalizePathControlPoints(ctrlPts, false, isRoad).points;
      // Ensure fixed-point stability on Pass 2
      ctrlPts = normalizePathControlPoints(ctrlPts, false, isRoad).points;
      if (ctrlPts.length < 2) continue;

      let verifiedCurve = validateCleanSpline(ctrlPts, false, isRoad);
      if (!verifiedCurve && ctrlPts.length > 2) {
        let chord: [number, number][] = [ctrlPts[0], ctrlPts[ctrlPts.length - 1]];
        chord = normalizePathControlPoints(chord, false, isRoad).points;
        if (chord.length >= 2) {
          verifiedCurve = validateCleanSpline(chord, false, isRoad);
          if (verifiedCurve) ctrlPts = chord;
        }
      }
      if (!verifiedCurve) continue;

      if (checkRedundant(verifiedCurve, false, isRoad)) continue;

      const pieceId = keptPieces === 0 ? rawPath.id : `${rawPath.id}-s${keptPieces + 1}`;
      const repairedPiece: WorldPath = {
        id: pieceId,
        kind: rawPath.kind,
        points: ctrlPts,
      };
      const pieceJunctions = getRoadCurbJunctions(verifiedCurve, false);
      accepted.push({ path: repairedPiece, curve: verifiedCurve, isRoad });
      acceptedCurbJunctions.push(...pieceJunctions);
      if (cutAtStart) keptCutEnds.push(ctrlPts[0]);
      if (cutAtEnd) keptCutEnds.push(ctrlPts[ctrlPts.length - 1]);
      keptPieces++;
    }

    details.push(
      keptPieces > 0
        ? `clipped crossing ${rawPath.kind} "${rawPath.id}" cleanly to road/trail curb (${keptPieces} segment${keptPieces > 1 ? "s" : ""})`
        : `removed crossing ${rawPath.kind} "${rawPath.id}" over existing corridor`,
    );
  }

  // Stage 5: Radial Spanning-Tree Spur Builder — connect every stationary landmark cleanly (outward from [0,0])
  const buildingsRadial = [...buildings].sort(
    (a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z),
  );
  const curveHitsObstacle = (curvePts: [number, number][], ownerId: string): boolean => {
    for (const [cx, cz] of curvePts) {
      for (const ob of buildings) {
        if (ob.id === ownerId) continue;
        if (Math.hypot(cx - ob.x, cz - ob.z) < plinthRadiusOf(ob) - 0.05) return true;
      }
      for (const pond of ponds) {
        if (Math.hypot(cx - pond.x, cz - pond.z) < (pond.radius ?? 6.5) - 0.2) return true;
      }
    }
    return false;
  };

  for (const b of buildingsRadial) {
    if (landmarkConnectedByAccepted(b) || accepted.length === 0) continue;

    const footR = plinthRadiusOf(b);
    let bestAcc: AcceptedPathEntry | null = null;
    let bestHit: ReturnType<typeof distPointToPolyline2D> | null = null;
    for (const acc of accepted) {
      const h = distPointToPolyline2D(b.x, b.z, acc.curve);
      if (!bestHit || h.dist < bestHit.dist) {
        bestHit = h;
        bestAcc = acc;
      }
    }
    if (!bestAcc || !bestHit || bestHit.dist > 220) continue;

    const buildSpurCandidatesForAnchor = (
      targetX: number,
      targetZ: number,
      curbOffset: number,
    ): [number, number][][] => {
      const dirToNetX = targetX - b.x;
      const dirToNetZ = targetZ - b.z;
      const dirLen = Math.hypot(dirToNetX, dirToNetZ);
      if (dirLen < footR + 1.6) return [];

      const ux = dirToNetX / dirLen;
      const uz = dirToNetZ / dirLen;
      const rawDoor: [number, number] = [
        round1(b.x + ux * (footR + 0.72)),
        round1(b.z + uz * (footR + 0.72)),
      ];
      const rawCurb: [number, number] = [
        round1(targetX - ux * curbOffset),
        round1(targetZ - uz * curbOffset),
      ];
      const doorPt = pushPointClearOfObstacles(rawDoor[0], rawDoor[1], rawCurb, false).pt;
      const curbPt = pushPointClearOfObstacles(rawCurb[0], rawCurb[1], doorPt, false).pt;
      const span = Math.hypot(curbPt[0] - doorPt[0], curbPt[1] - doorPt[1]);
      if (span < 1.35) return [];

      const sets: [number, number][][] = [];
      // 1. Prefer straight orthogonal/direct chord first, or clean SimCity 90° L-bend if oblique!
      sets.push([doorPt, curbPt]);
      const dxSpan = Math.abs(curbPt[0] - doorPt[0]);
      const dzSpan = Math.abs(curbPt[1] - doorPt[1]);
      if (dxSpan >= 2.8 && dzSpan >= 2.8) {
        const elbowA = pushPointClearOfObstacles(curbPt[0], doorPt[1], doorPt, false).pt;
        const elbowB = pushPointClearOfObstacles(doorPt[0], curbPt[1], doorPt, false).pt;
        sets.push([doorPt, elbowA, curbPt]);
        sets.push([doorPt, elbowB, curbPt]);
      }

      const perpX = -uz;
      const perpZ = ux;
      if (span > 18.0) {
        const bow = Math.min(3.2, span * 0.05);
        const midGentle = pushPointClearOfObstacles(
          round1((doorPt[0] + curbPt[0]) * 0.5 + perpX * bow),
          round1((doorPt[1] + curbPt[1]) * 0.5 + perpZ * bow),
          doorPt,
          false,
        ).pt;
        sets.push([doorPt, midGentle, curbPt]);
      }

      const chordRef: [number, number][] = [doorPt, curbPt];
      for (const ob of buildings) {
        if (ob.id === b.id) continue;
        const obR = plinthRadiusOf(ob);
        if (distPointToPolyline2D(ob.x, ob.z, chordRef).dist < obR + 1.4) {
          for (const extra of [1.8, 3.6, 6.2]) {
            for (const side of [1, -1]) {
              const wp = pushPointClearOfObstacles(
                round1(ob.x + perpX * (obR + extra) * side),
                round1(ob.z + perpZ * (obR + extra) * side),
                doorPt,
                false,
              ).pt;
              sets.push([doorPt, wp, curbPt]);
            }
          }
        }
      }
      for (const pond of ponds) {
        const pr = pond.radius ?? 6.5;
        if (distPointToPolyline2D(pond.x, pond.z, chordRef).dist < pr + 1.2) {
          for (const extra of [1.8, 3.8]) {
            for (const side of [1, -1]) {
              const wp = pushPointClearOfObstacles(
                round1(pond.x + perpX * (pr + extra) * side),
                round1(pond.z + perpZ * (pr + extra) * side),
                doorPt,
                false,
              ).pt;
              sets.push([doorPt, wp, curbPt]);
            }
          }
        }
      }
      for (const mag of [5.0, 9.5, 15.0, 22.0]) {
        for (const side of [1, -1]) {
          const midDeflect = pushPointClearOfObstacles(
            round1((doorPt[0] + curbPt[0]) * 0.5 + perpX * mag * side),
            round1((doorPt[1] + curbPt[1]) * 0.5 + perpZ * mag * side),
            doorPt,
            false,
          ).pt;
          sets.push([doorPt, midDeflect, curbPt]);
        }
      }
      return sets;
    };

    const candidateCtrlSets: [number, number][][] = buildSpurCandidatesForAnchor(
      bestHit.closestX,
      bestHit.closestZ,
      bestAcc.isRoad ? 2.52 : 0.48,
    );

    let chosenPts: [number, number][] | null = null;
    let chosenCurve: [number, number][] | null = null;

    for (const rawCand of candidateCtrlSets) {
      let cand = normalizePathControlPoints(rawCand, false, false).points;
      cand = normalizePathControlPoints(cand, false, false).points;
      if (cand.length < 2) continue;
      const recheck = normalizePathControlPoints(cand, false, false);
      if (recheck.deKinked || recheck.selfUncrossed || recheck.trimmedPlinth) continue;
      const verified = validateCleanSpline(cand, false, false);
      if (!verified) continue;
      if (curveHitsObstacle(verified, b.id)) continue;
      if (checkRedundant(verified, false, false)) continue;
      chosenPts = cand;
      chosenCurve = verified;
      break;
    }

    if (chosenPts && chosenCurve) {
      const desiredKind = inferContextualRoadKind(b);
      const canUsePavedRoad =
        desiredKind === "road" &&
        bestAcc.isRoad &&
        polylineLength2D(chosenCurve) >= 9.0 &&
        validateCleanSpline(chosenPts, false, true) !== null &&
        !checkRedundant(chosenCurve, false, true);
      const spurKind: PathKind =
        desiredKind === "road"
          ? canUsePavedRoad
            ? "road"
            : "cobblestone"
          : desiredKind;
      const spur: WorldPath = {
        id: `spur-${b.id}`,
        kind: spurKind,
        points: chosenPts,
      };
      const spurIsRoad = spurKind === "road";
      const spurJunctions = getRoadCurbJunctions(chosenCurve, false);
      accepted.push({ path: spur, curve: chosenCurve, isRoad: spurIsRoad });
      acceptedCurbJunctions.push(...spurJunctions);
      footpathTrimCount++;
      details.push(`added clean curb-snapped ${spurKind} "${spur.id}" for "${b.name}"`);
    }
  }

  const repairedPaths = accepted.map((a) => a.path);
  const acceptedRoads = accepted.filter((a) => a.isRoad);
  const acceptedTrails = accepted.filter((a) => !a.isRoad);

  const repairedProps: WorldProp[] = [];
  for (const pr of props) {
    // Prune orphaned non-seed bus stops sitting where no asphalt road exists
    if (!SEED_PROP_IDS.has(pr.id) && pr.kind === "bus_stop") {
      const onRoad = acceptedRoads.some(
        (rd) => distPointToPolyline2D(pr.x, pr.z, rd.curve).dist <= 5.2,
      );
      if (!onRoad) {
        propNudgeCount++;
        details.push(`removed orphaned bus_stop "${pr.id}" far from active roads`);
        continue;
      }
    }

    let px = pr.x;
    let pz = pr.z;
    let moved = false;

    if (pr.kind !== "pond" && !SEED_PROP_IDS.has(pr.id)) {
      for (let pass = 0; pass < 16; pass++) {
        let passMoved = false;
        // Keep props outside building plinths
        for (const b of buildings) {
          const minR = plinthRadiusOf(b) + 0.6;
          const dx = px - b.x;
          const dz = pz - b.z;
          const d = Math.hypot(dx, dz);
          if (d < minR) {
            const ux = d > 0.05 ? dx / d : 1;
            const uz = d > 0.05 ? dz / d : 0;
            px = round1(b.x + ux * (minR + 0.4));
            pz = round1(b.z + uz * (minR + 0.4));
            moved = true;
            passMoved = true;
          }
        }
        // Keep props off asphalt road interiors
        for (const rd of acceptedRoads) {
          const h = distPointToPolyline2D(px, pz, rd.curve);
          if (h.dist < 2.58) {
            px = round1(h.closestX + h.normalX * 2.9);
            pz = round1(h.closestZ + h.normalZ * 2.9);
            moved = true;
            passMoved = true;
          }
        }
        // Keep signposts/benches/lamps off cottage lanes and pedestrian trail centers
        for (const tr of acceptedTrails) {
          const isCottageLane = tr.path.kind === "cottage_road";
          const minDist = isCottageLane ? 1.42 : 1.15;
          const pushDist = isCottageLane ? 1.78 : 1.5;
          const h = distPointToPolyline2D(px, pz, tr.curve);
          if (h.dist < minDist) {
            px = round1(h.closestX + h.normalX * pushDist);
            pz = round1(h.closestZ + h.normalZ * pushDist);
            moved = true;
            passMoved = true;
          }
        }
        // Keep props separated from each other
        for (const prev of repairedProps) {
          if (prev.kind === "pond") continue;
          const minSep = 1.65;
          const dx = px - prev.x;
          const dz = pz - prev.z;
          const d = Math.hypot(dx, dz);
          if (d < minSep) {
            const ux = d > 0.05 ? dx / d : 0.707;
            const uz = d > 0.05 ? dz / d : 0.707;
            px = round1(prev.x + ux * (minSep + 0.4));
            pz = round1(prev.z + uz * (minSep + 0.4));
            moved = true;
            passMoved = true;
          }
        }
        if (!passMoved) break;
      }
    }

    if (moved) {
      propNudgeCount++;
      details.push(`nudged prop "${pr.id}" (${pr.kind}) to [${px}, ${pz}]`);
      repairedProps.push({ ...pr, x: px, z: pz });
    } else {
      repairedProps.push(pr);
    }
  }

  return {
    paths: repairedPaths,
    props: repairedProps,
    report: {
      clean:
        footpathTrimCount === 0 &&
        pathCrossingsFixed === 0 &&
        redundantPathsRemoved === 0 &&
        propNudgeCount === 0,
      footpathTrimCount,
      pathCrossingsFixed,
      redundantPathsRemoved,
      propNudgeCount,
      details,
    },
  };
}

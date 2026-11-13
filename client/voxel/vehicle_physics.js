// GeminIsland — Calm Solid-Object Vehicle Physics, Natural Lane Passing,
// Smooth End-of-Route Turnarounds, and Strict Max-Speed Enforcement.

function wrapPi(rad) {
  let a = Number(rad) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

const SCALE_VOXEL_SIZE = {
  tiny: 0.12,
  small: 0.17,
  medium: 0.23,
  large: 0.31,
  landmark: 0.37,
  colossal: 0.44,
  hero: 0.23,
};

/**
 * Computes tight oriented half-extents (`halfX`, `halfZ`) for a stationary building or landmark,
 * trimming outer roof eaves/porch overhangs (`leewayScale`) so vehicles and players get natural edge leeway.
 */
export function getBuildingTightBox(bld, leewayScale = 0.78) {
  const sc = bld?.data?.scaleClass || bld?.data?.blueprint?.scaleClass || "medium";
  const voxSize = SCALE_VOXEL_SIZE[sc] || 0.23;
  const stats = bld?.data?.blueprint?.stats;
  if (stats && Number(stats.footprintX) > 0 && Number(stats.footprintZ) > 0) {
    return {
      halfX: Math.max(0.7, Number(stats.footprintX) * voxSize * 0.5 * leewayScale),
      halfZ: Math.max(0.7, Number(stats.footprintZ) * voxSize * 0.5 * leewayScale),
    };
  }
  const fallback = Math.max(0.85, (bld?.footprintRadius || 3.2) * 0.65 * leewayScale);
  return { halfX: fallback, halfZ: fallback };
}

/**
 * Computes realistic oriented bounding-box half-extents (`hw` across X, `hl` along +Z)
 * for any voxel vehicle creation with edge leeway for mirrors, trim, and wheel arches.
 */
export function computeVehicleHullExtents(
  creation,
  worldVoxelSize = 0.23,
  isSecondary = false,
  isDualTransit = false,
) {
  if (isDualTransit) {
    return isSecondary
      ? { hw: 0.84, hl: 2.32, mass: 1.45 }
      : { hw: 0.92, hl: 2.68, mass: 1.75 };
  }
  const stats = creation?.blueprint?.stats || {};
  const rawX = (Number(stats.footprintX) || 10) * worldVoxelSize * 0.5;
  const rawZ = (Number(stats.footprintZ) || 15) * worldVoxelSize * 0.5;
  const minHalf = Math.min(rawX, rawZ);
  const maxHalf = Math.max(rawX, rawZ);
  const hw = clamp(minHalf * 0.76, 0.66, 1.22);
  const hl = clamp(maxHalf * 0.82, 1.15, 2.95);
  const scaleClass = creation?.scaleClass || creation?.blueprint?.scaleClass || "medium";
  const mass =
    scaleClass === "colossal" || scaleClass === "large"
      ? 1.65
      : scaleClass === "small" || scaleClass === "tiny"
        ? 0.85
        : 1.15;
  return { hw, hl, mass };
}

/**
 * Creates per-vehicle-unit calm driving, turnaround, and solid-body suspension state.
 */
export function createVehiclePhysicsState(seedIndex = 0) {
  return {
    hw: 0.92,
    hl: 2.1,
    mass: 1.15,

    // Smooth bounded linear velocity (strictly <= baseSpeed!)
    currentSpeed: 0,
    vx: 0,
    vz: 0,
    frameStartX: NaN,
    frameStartZ: NaN,

    // Calm natural lane-passing & obstacle-bypass state
    passOffset: 0,
    passHoldTimer: 0,
    wedgeBiasOffset: 0,
    wedgeBiasTimer: 0,
    politeWait: false,
    seedBiasSign: seedIndex % 2 === 0 ? -1 : 1,

    // Subtle suspension rock on solid contact
    clashPitch: 0,
    clashPitchVel: 0,
    clashRoll: 0,
    clashRollVel: 0,
    turnBankRoll: 0,
    clashCooldown: 0,

    // Smooth end-of-route turnaround state (replaces instant 180° routeDir flip)
    turnState: null,
    pendingTurnAtEnd: null,

    // Grounded stall tracking (only biases gentle steering around obstacles; never reverses or teleports!)
    anchorX: NaN,
    anchorZ: NaN,
    stuckSec: 0,
    recentClashCount: 0,
    recentClashWindowTimer: 0,
    lastIncidentReportAt: -120,
    lastClashPeerId: null,
  };
}

// ─── Zero-GC Scratch Structs for 2D OBB Separating Axis Theorem (SAT) ────────
const _satResult = {
  hit: false,
  nx: 0,
  nz: 1,
  depth: 0,
  contactX: 0,
  contactZ: 0,
};

/**
 * Exact 2D Oriented Bounding Box (OBB) overlap test in XZ plane.
 * `nx, nz` points from `b` toward `a` (pushing `a` by `+nx * depth` and `b` by `-nx * depth` separates them).
 */
export function intersectVehicleOBBs(
  ax,
  az,
  aYaw,
  aHw,
  aHl,
  bx,
  bz,
  bYaw,
  bHw,
  bHl,
  bumperPad = 0.02,
) {
  const dx = ax - bx;
  const dz = az - bz;
  const maxR = aHw + aHl + bHw + bHl + bumperPad;
  if (Math.abs(dx) > maxR || Math.abs(dz) > maxR) {
    _satResult.hit = false;
    return _satResult;
  }

  // Forward = (+sin(yaw), +cos(yaw)), Right = (-cos(yaw), +sin(yaw))
  const aFx = Math.sin(aYaw);
  const aFz = Math.cos(aYaw);
  const aRx = -aFz;
  const aRz = aFx;

  const bFx = Math.sin(bYaw);
  const bFz = Math.cos(bYaw);
  const bRx = -bFz;
  const bRz = bFx;

  const eA0 = aHw + bumperPad * 0.5;
  const eA1 = aHl + bumperPad * 0.5;
  const eB0 = bHw + bumperPad * 0.5;
  const eB1 = bHl + bumperPad * 0.5;

  let minOverlap = Infinity;
  let bestNx = 0;
  let bestNz = 1;

  // Test 4 separating axes: aRight, aFwd, bRight, bFwd
  for (let axisIdx = 0; axisIdx < 4; axisIdx++) {
    let ux, uz;
    if (axisIdx === 0) {
      ux = aRx;
      uz = aRz;
    } else if (axisIdx === 1) {
      ux = aFx;
      uz = aFz;
    } else if (axisIdx === 2) {
      ux = bRx;
      uz = bRz;
    } else {
      ux = bFx;
      uz = bFz;
    }

    const distProj = dx * ux + dz * uz;
    const absDist = Math.abs(distProj);
    const rA = eA0 * Math.abs(ux * aRx + uz * aRz) + eA1 * Math.abs(ux * aFx + uz * aFz);
    const rB = eB0 * Math.abs(ux * bRx + uz * bRz) + eB1 * Math.abs(ux * bFx + uz * bFz);
    const overlap = rA + rB - absDist;
    if (overlap <= 0) {
      _satResult.hit = false;
      return _satResult;
    }
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = distProj >= 0 ? 1 : -1;
      bestNx = ux * sign;
      bestNz = uz * sign;
    }
  }

  _satResult.hit = true;
  _satResult.nx = bestNx;
  _satResult.nz = bestNz;
  _satResult.depth = minOverlap;
  _satResult.contactX = (ax + bx) * 0.5;
  _satResult.contactZ = (az + bz) * 0.5;
  return _satResult;
}

const _circleHit = { hit: false, nx: 0, nz: 1, depth: 0 };

/**
 * Exact 2D OBB vs Circle overlap test (used for solid buildings, landmarks, ponds, signboard, and walking players).
 * `nx, nz` points from the circle `(cx, cz)` outward toward the OBB center `(ox, oz)`.
 */
export function intersectOBBCircle(ox, oz, oYaw, oHw, oHl, cx, cz, radius) {
  const dx = cx - ox;
  const dz = cz - oz;
  const bound = oHw + oHl + radius;
  if (Math.abs(dx) > bound || Math.abs(dz) > bound) {
    _circleHit.hit = false;
    return _circleHit;
  }

  const fX = Math.sin(oYaw);
  const fZ = Math.cos(oYaw);
  const rX = -fZ;
  const rZ = fX;

  const localR = dx * rX + dz * rZ;
  const localF = dx * fX + dz * fZ;

  const clampedR = clamp(localR, -oHw, oHw);
  const clampedF = clamp(localF, -oHl, oHl);

  const diffR = localR - clampedR;
  const diffF = localF - clampedF;
  const distSq = diffR * diffR + diffF * diffF;

  if (distSq >= radius * radius) {
    _circleHit.hit = false;
    return _circleHit;
  }

  if (distSq > 1e-6) {
    const dist = Math.sqrt(distSq);
    const worldDiffX = diffR * rX + diffF * fX;
    const worldDiffZ = diffR * rZ + diffF * fZ;
    _circleHit.hit = true;
    _circleHit.nx = -worldDiffX / dist;
    _circleHit.nz = -worldDiffZ / dist;
    _circleHit.depth = radius - dist;
    return _circleHit;
  }

  const penRight = oHw - Math.abs(localR);
  const penFwd = oHl - Math.abs(localF);
  _circleHit.hit = true;
  if (penRight <= penFwd) {
    const s = localR >= 0 ? -1 : 1;
    _circleHit.nx = rX * s;
    _circleHit.nz = rZ * s;
    _circleHit.depth = penRight + radius;
  } else {
    const s = localF >= 0 ? -1 : 1;
    _circleHit.nx = fX * s;
    _circleHit.nz = fZ * s;
    _circleHit.depth = penFwd + radius;
  }
  return _circleHit;
}

/**
 * Pushes a walking player or villager point `(px, pz)` with `playerRadius` cleanly outside a solid vehicle OBB.
 */
export function pushPointOutOfVehicleOBB(px, pz, playerRadius, vx, vz, vYaw, vHw, vHl) {
  const hit = intersectOBBCircle(vx, vz, vYaw, vHw, vHl, px, pz, playerRadius);
  if (!hit.hit) return null;
  return [px - hit.nx * hit.depth, pz - hit.nz * hit.depth];
}

// ─── Obstacle Clearance Probe for Smart Turnaround & Safe Passing Checks ─────
export function checkPointClearance(
  wx,
  wz,
  padR,
  buildingPeers,
  ponds,
  selfEnt,
  citySignPos,
  clampPointToIslandFn,
) {
  let minMargin = 99;

  if (clampPointToIslandFn) {
    const [cx, cz] = clampPointToIslandFn(wx, wz, padR + 1.1);
    const coastPen = Math.hypot(cx - wx, cz - wz);
    if (coastPen > 0.05) {
      minMargin = Math.min(minMargin, -coastPen);
    }
  }

  if (citySignPos) {
    const dSign = Math.hypot(wx - citySignPos[0], wz - citySignPos[1]) - (1.85 + padR);
    minMargin = Math.min(minMargin, dSign);
  }

  if (ponds) {
    for (let i = 0; i < ponds.length; i++) {
      const p = ponds[i];
      const dPond =
        Math.hypot(wx - p.x, wz - p.z) - (Math.max(1.5, (p.radius || 6.4) - 0.35) + padR);
      minMargin = Math.min(minMargin, dPond);
    }
  }

  if (buildingPeers) {
    for (let i = 0; i < buildingPeers.length; i++) {
      const b = buildingPeers[i];
      if (!b || b === selfEnt || b.interactive?.allowWalkOver) continue;
      if (b.data?.category !== "building" && b.data?.behavior?.type !== "landmark") continue;
      const box = getBuildingTightBox(b, 0.78);
      const yaw = b.yaw || 0;
      const fX = Math.sin(yaw);
      const fZ = Math.cos(yaw);
      const rX = -fZ;
      const rZ = fX;
      const dx = wx - b.x;
      const dz = wz - b.z;
      const lR = Math.abs(dx * rX + dz * rZ) - box.halfX;
      const lF = Math.abs(dx * fX + dz * fZ) - box.halfZ;
      const outDist = lR > 0 && lF > 0 ? Math.hypot(lR, lF) : Math.max(lR, lF);
      minMargin = Math.min(minMargin, outDist - padR);
    }
  }

  return minMargin;
}

/**
 * Plans a calm, unhurried turnaround maneuver when a `pingpong` vehicle reaches the end (`whichEnd = "end" | "start"`)
 * of its route, scanning nearby apron/plaza spots so it turns smoothly in a clear space without ever flipping 180°
 * and without ever exceeding 62% of its normal cruise speed.
 */
export function planVehicleTurnaround({
  routeCurve,
  routeLength,
  whichEnd,
  curX,
  curZ,
  curYaw,
  curLaneOffset,
  targetReturnLane,
  hw,
  hl,
  speed,
  buildingPeers,
  ponds,
  selfEnt,
  citySignPos,
  clampPointToIslandFn,
}) {
  const nextDir = whichEnd === "end" ? -1 : 1;
  const padR = Math.max(0.82, hw * 0.9);

  const candidateBackOffsets = [0.95, 2.6, 4.8, 7.2];
  let bestCand = null;
  let bestScore = -Infinity;

  const fX = Math.sin(curYaw);
  const fZ = Math.cos(curYaw);
  const rX = -fZ;
  const rZ = fX;

  for (let cIdx = 0; cIdx < candidateBackOffsets.length; cIdx++) {
    const backOff = candidateBackOffsets[cIdx];
    if (backOff > routeLength * 0.36) continue;
    const candDist =
      whichEnd === "end"
        ? Math.max(0.25, routeLength - backOff)
        : Math.min(routeLength - 0.25, backOff);
    const u = clamp(candDist / routeLength, 0.002, 0.998);
    const pt = routeCurve.getPointAt(u);
    const tan = routeCurve.getTangentAt(u);
    const endYaw = Math.atan2(tan.x * nextDir, tan.z * nextDir);
    const endRightX = -Math.cos(endYaw);
    const endRightZ = Math.sin(endYaw);
    const endX = pt.x + endRightX * targetReturnLane;
    const endZ = pt.z + endRightZ * targetReturnLane;

    const dx = endX - curX;
    const dz = endZ - curZ;
    const fEnd = dx * fX + dz * fZ;
    const rDelta = dx * rX + dz * rZ;

    for (const side of [-1, 1]) {
      const bulbFwd = 2.55;
      const apexX =
        curX + fX * (Math.max(0, fEnd * 0.5) + bulbFwd) + rX * (rDelta * 0.5 + side * 0.85);
      const apexZ =
        curZ + fZ * (Math.max(0, fEnd * 0.5) + bulbFwd) + rZ * (rDelta * 0.5 + side * 0.85);
      const midSideX = curX + fX * (bulbFwd * 0.55) + rX * (side * 1.45);
      const midSideZ = curZ + fZ * (bulbFwd * 0.55) + rZ * (side * 1.45);

      const cApex = checkPointClearance(
        apexX,
        apexZ,
        padR,
        buildingPeers,
        ponds,
        selfEnt,
        citySignPos,
        clampPointToIslandFn,
      );
      const cSide = checkPointClearance(
        midSideX,
        midSideZ,
        padR,
        buildingPeers,
        ponds,
        selfEnt,
        citySignPos,
        clampPointToIslandFn,
      );
      const cEnd = checkPointClearance(
        endX,
        endZ,
        padR * 0.85,
        buildingPeers,
        ponds,
        selfEnt,
        citySignPos,
        clampPointToIslandFn,
      );

      const minClear = Math.min(cApex, cSide, cEnd);
      const score = minClear * 3.0 - cIdx * 0.45 + (side === -1 ? 0.35 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestCand = {
          minClear,
          candDist,
          endYaw,
          fEnd,
          rDelta,
          side,
          bulbFwd: clamp(2.35 + Math.min(1.1, Math.max(0, minClear) * 0.3), 2.1, 3.4),
        };
      }
    }
  }

  const chosen = bestCand || {
    minClear: -1,
    candDist:
      whichEnd === "end"
        ? Math.max(0.25, routeLength - 0.95)
        : Math.min(routeLength - 0.25, 0.95),
    endYaw: wrapPi(curYaw + Math.PI),
    fEnd: 0,
    rDelta: -2.0 * curLaneOffset,
    side: -1,
    bulbFwd: 2.35,
  };

  const mode = chosen.minClear >= -0.05 ? "uturn" : "three_point";
  const baseSpd = clamp(speed || 5.2, 3.2, 7.5);
  const clampedFEnd = clamp(chosen.fEnd, -6.0, 4.2);
  const approxArc =
    Math.hypot(clampedFEnd, chosen.rDelta) +
    Math.PI * Math.max(1.6, Math.abs(chosen.rDelta) * 0.65) +
    2.8;
  // Conservative duration so peak turnaround speed never exceeds ~58% of baseSpeed
  const calmTurnSpeed = Math.max(1.85, baseSpd * 0.5);
  const duration =
    mode === "uturn"
      ? clamp((approxArc * 1.35) / calmTurnSpeed, 3.2, 5.4)
      : clamp((approxArc * 1.45) / calmTurnSpeed + hl * 0.15, 3.8, 5.8);

  return {
    mode,
    elapsed: 0,
    duration,
    anchorX: curX,
    anchorZ: curZ,
    startYaw: curYaw,
    endYaw: chosen.endYaw,
    fEnd: clampedFEnd,
    rDelta: chosen.rDelta,
    bulbFwd: chosen.bulbFwd,
    side: chosen.side,
    nextDir,
    nextRouteDist: chosen.candDist,
    nextLaneOffset: targetReturnLane,
  };
}

const _turnPoseOut = {
  x: 0,
  z: 0,
  yaw: 0,
  gear: 1,
  speedFactor: 0.45,
  steerRoll: 0,
  done: false,
};

/**
 * Evaluates a vehicle's smooth world `(x, z, yaw)` at time `dt` inside its turnaround maneuver.
 */
export function stepVehicleTurnaround(turn, dt) {
  turn.elapsed += dt;
  const rawS = clamp(turn.elapsed / Math.max(1.0, turn.duration), 0, 1);

  const fX = Math.sin(turn.startYaw);
  const fZ = Math.cos(turn.startYaw);
  const rX = -fZ;
  const rZ = fX;

  let totalTurnAngle = wrapPi(turn.endYaw - turn.startYaw);
  if (turn.side < 0 && totalTurnAngle > 2.55) {
    totalTurnAngle -= Math.PI * 2;
  } else if (turn.side > 0 && totalTurnAngle < -2.55) {
    totalTurnAngle += Math.PI * 2;
  }

  let localF = 0;
  let localR = 0;
  let yaw = turn.startYaw;
  let gear = 1;
  let speedFactor = 0.45;
  let steerRoll = 0;

  if (turn.mode === "uturn") {
    const s = 0.35 * rawS + 0.65 * smoothstep01(rawS);
    const phi = s * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    const halfR = Math.abs(turn.rDelta) >= 0.4 ? turn.rDelta * 0.5 : turn.side * 1.15;
    const turnDirSign = halfR >= 0 ? 1 : -1;
    const effHalfR = turnDirSign * Math.max(1.45, Math.abs(halfR));
    const minForwardBulb = Math.max(1.75, -turn.fEnd / Math.PI + 1.1);
    const circBulbFwd = Math.max(
      minForwardBulb,
      Math.min(turn.bulbFwd + 0.8, Math.abs(effHalfR) * 1.08),
    );

    const extraApex = (effHalfR - halfR) * sinPhi * sinPhi;
    localF = turn.fEnd * s + circBulbFwd * sinPhi;
    localR = halfR * (1 - cosPhi) + extraApex;

    yaw = wrapPi(turn.startYaw + totalTurnAngle * s);

    speedFactor = 0.28 + 0.38 * Math.sin(rawS * Math.PI);
    steerRoll = clamp(turnDirSign * 0.032 * Math.sin(rawS * Math.PI), -0.045, 0.045);
  } else {
    const f1 = 1.55;
    const r1 = turn.side * 1.12;
    const f2 = clamp(turn.fEnd * 0.65 - 0.8, -2.2, 0.75);
    const r2 = turn.rDelta * 0.72 - turn.side * 0.45;

    const yaw1 = turn.startYaw + totalTurnAngle * 0.38;
    const yaw2 = turn.startYaw + totalTurnAngle * 0.78;
    const yaw3 = turn.startYaw + totalTurnAngle;

    if (rawS < 0.36) {
      const u = smoothstep01(rawS / 0.36);
      localF = f1 * Math.sin(u * Math.PI * 0.5);
      localR = r1 * (1 - Math.cos(u * Math.PI * 0.5));
      yaw = wrapPi(turn.startYaw + (yaw1 - turn.startYaw) * u);
      gear = 1;
      speedFactor = 0.38 * Math.sin((rawS / 0.36) * Math.PI);
      steerRoll = -Math.sign(totalTurnAngle) * 0.025 * Math.sin((rawS / 0.36) * Math.PI);
    } else if (rawS < 0.72) {
      const u = smoothstep01((rawS - 0.36) / 0.36);
      localF = f1 + (f2 - f1) * u;
      localR = r1 + (r2 - r1) * u;
      yaw = wrapPi(yaw1 + (yaw2 - yaw1) * u);
      gear = -1;
      speedFactor = 0.34 * Math.sin(((rawS - 0.36) / 0.36) * Math.PI);
      steerRoll = Math.sign(totalTurnAngle) * 0.022 * Math.sin(((rawS - 0.36) / 0.36) * Math.PI);
    } else {
      const u = smoothstep01((rawS - 0.72) / 0.28);
      localF = f2 + (turn.fEnd - f2) * u;
      localR = r2 + (turn.rDelta - r2) * u;
      yaw = wrapPi(yaw2 + (yaw3 - yaw2) * u);
      gear = 1;
      speedFactor = 0.22 + 0.42 * u;
      steerRoll = -Math.sign(totalTurnAngle) * 0.024 * Math.sin(u * Math.PI);
    }
  }

  _turnPoseOut.x = turn.anchorX + fX * localF + rX * localR;
  _turnPoseOut.z = turn.anchorZ + fZ * localF + rZ * localR;
  _turnPoseOut.yaw = yaw;
  _turnPoseOut.gear = gear;
  _turnPoseOut.speedFactor = speedFactor;
  _turnPoseOut.steerRoll = steerRoll;
  _turnPoseOut.done = rawS >= 1.0;
  return _turnPoseOut;
}

// ─── Calm Natural Lane Passing & Intersection Yielding ───────────────────────
const _driveAdvice = {
  speedScale: 1.0,
  extraLaneOffset: 0,
  yielding: false,
};

const _activeUnitsScratch = [];

function gatherVehicleUnits(vehicleEntities) {
  let count = 0;
  for (let i = 0; i < vehicleEntities.length; i++) {
    const ent = vehicleEntities[i];
    if (!ent || ent.data?.behavior?.type !== "vehicle_route" || !ent.routeCurve) continue;
    if (!ent.phys) {
      ent.phys = createVehiclePhysicsState(ent.index || i);
    }
    let slot = _activeUnitsScratch[count];
    if (!slot) {
      slot = _activeUnitsScratch[count] = {};
    }
    slot.unitId = ent.id;
    slot.creationId = ent.id;
    slot.isSecondary = false;
    slot.isSeed = Boolean(ent.data?.isSeed);
    slot.ent = ent;
    slot.veh = ent;
    slot.phys = ent.phys;
    count++;

    if (ent.secondaryVehicle) {
      const sv = ent.secondaryVehicle;
      if (!sv.phys) {
        sv.phys = createVehiclePhysicsState((ent.index || i) + 31);
      }
      let svSlot = _activeUnitsScratch[count];
      if (!svSlot) {
        svSlot = _activeUnitsScratch[count] = {};
      }
      svSlot.unitId = `${ent.id}#sec`;
      svSlot.creationId = ent.id;
      svSlot.isSecondary = true;
      svSlot.isSeed = Boolean(ent.data?.isSeed);
      svSlot.ent = ent;
      svSlot.veh = sv;
      svSlot.phys = sv.phys;
      count++;
    }
  }
  _activeUnitsScratch.length = count;
  return _activeUnitsScratch;
}

/**
 * Computes calm, human-like traffic control:
 * - `speedScale` is STRICTLY in `[0, 1.0]` — vehicles NEVER speed up above cruise speed and NEVER slam into reverse!
 * - Same-direction slower/stopped vehicles ahead: if the left passing lane is clear of oncoming cars & obstacles,
 *   steers smoothly around on the left with full hull clearance; otherwise slows smoothly and waits behind.
 * - Oncoming vehicles: keeps calmly to the right lane so opposing cars glide past each other.
 * - Intersections / turnarounds: yields politely before the conflict zone until clear.
 */
export function computeProactiveTrafficControl({
  selfUnitId,
  x,
  z,
  yaw,
  cruiseLane = 1.12,
  hw,
  hl,
  speed,
  pullingOver,
  isSeed,
  phys,
  vehicleEntities,
  buildingPeers,
  ponds,
  selfEnt,
  citySignPos,
  clampPointToIslandFn,
  dt = 0.016,
}) {
  _driveAdvice.speedScale = 1.0;
  _driveAdvice.extraLaneOffset = 0;
  _driveAdvice.yielding = false;

  if (phys) {
    phys.politeWait = false;
    if (phys.passHoldTimer > 0) {
      phys.passHoldTimer = Math.max(0, phys.passHoldTimer - dt);
    }
    if (phys.wedgeBiasTimer > 0) {
      phys.wedgeBiasTimer = Math.max(0, phys.wedgeBiasTimer - dt);
    }
  }

  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const rightX = -fwdZ;
  const rightZ = fwdX;

  // First quick scan: check if oncoming or left-side traffic occupies the inner passing lane
  let oncomingInLeftLane = false;
  for (let i = 0; i < vehicleEntities.length; i++) {
    const ent = vehicleEntities[i];
    if (!ent || ent.data?.behavior?.type !== "vehicle_route" || !ent.routeCurve) continue;
    for (let sub = 0; sub < 2; sub++) {
      const ov = sub === 0 ? ent : ent.secondaryVehicle;
      if (!ov) continue;
      const oid = sub === 0 ? ent.id : `${ent.id}#sec`;
      if (oid === selfUnitId) continue;
      const dx = ov.x - x;
      const dz = ov.z - z;
      if (Math.abs(dx) > 21 || Math.abs(dz) > 21) continue;
      const ahead = dx * fwdX + dz * fwdZ;
      if (ahead < -3.8 || ahead > 19.5) continue;
      const lat = dx * rightX + dz * rightZ;
      const oYaw = ov.yaw || 0;
      const hDot = fwdX * Math.sin(oYaw) + fwdZ * Math.cos(oYaw);
      if (hDot < -0.25 && lat < hw + (ov.phys?.hw || 0.92) + 0.95) {
        oncomingInLeftLane = true;
        break;
      }
      if (hDot >= -0.25 && lat < -0.45 && Math.abs(ahead) < hl + (ov.phys?.hl || 2.1) + 1.8) {
        oncomingInLeftLane = true;
        break;
      }
    }
    if (oncomingInLeftLane) break;
  }

  // Also check static environment clearance along the left passing lane (now and 4m ahead)
  let leftEnvClear = true;
  if (buildingPeers || ponds || citySignPos || clampPointToIslandFn) {
    const probeShift = -2.25;
    const cNow = checkPointClearance(
      x + rightX * probeShift,
      z + rightZ * probeShift,
      hw * 0.85,
      buildingPeers,
      ponds,
      selfEnt,
      citySignPos,
      clampPointToIslandFn,
    );
    const cAhead = checkPointClearance(
      x + fwdX * 4.2 + rightX * probeShift,
      z + fwdZ * 4.2 + rightZ * probeShift,
      hw * 0.85,
      buildingPeers,
      ponds,
      selfEnt,
      citySignPos,
      clampPointToIslandFn,
    );
    if (cNow < -0.05 || cAhead < -0.05) {
      leftEnvClear = false;
    }
  }

  const canPassOnLeft = !pullingOver && !oncomingInLeftLane && leftEnvClear;

  if (phys && phys.passHoldTimer > 0) {
    if (oncomingInLeftLane) {
      phys.passHoldTimer = 0;
    } else {
      _driveAdvice.extraLaneOffset = Math.min(_driveAdvice.extraLaneOffset, phys.passOffset);
    }
  }

  for (let i = 0; i < vehicleEntities.length; i++) {
    const ent = vehicleEntities[i];
    if (!ent || ent.data?.behavior?.type !== "vehicle_route" || !ent.routeCurve) continue;

    for (let sub = 0; sub < 2; sub++) {
      const otherVeh = sub === 0 ? ent : ent.secondaryVehicle;
      if (!otherVeh) continue;
      const otherId = sub === 0 ? ent.id : `${ent.id}#sec`;
      if (otherId === selfUnitId) continue;

      const ox = otherVeh.x;
      const oz = otherVeh.z;
      const dx = ox - x;
      const dz = oz - z;
      const dist = Math.hypot(dx, dz);
      if (dist > 18.0 || dist < 0.001) continue;

      const oPhys = otherVeh.phys;
      const oHw = oPhys?.hw || 0.92;
      const oHl = oPhys?.hl || 2.1;
      const oYaw = otherVeh.yaw || 0;
      const oFwdX = Math.sin(oYaw);
      const oFwdZ = Math.cos(oYaw);

      const headingDot = fwdX * oFwdX + fwdZ * oFwdZ;
      const aheadDist = dx * fwdX + dz * fwdZ;
      const latSigned = dx * rightX + dz * rightZ; // > 0 means other is to our right
      const latAbs = Math.abs(latSigned);
      const minSafeGap = hl + oHl + 1.45;
      const minLatClear = hw + oHw + 0.48;

      const otherTurning = Boolean(oPhys?.turnState);
      const otherDwelling = Boolean(otherVeh.dwellingStop) && !otherTurning;
      const otherBaseSpd =
        sub === 1
          ? otherVeh.speed || 4.35
          : ent.effectiveSpeed || ent.data?.behavior?.speed || 5.5;
      const otherActualSpd =
        oPhys && Number.isFinite(oPhys.currentSpeed)
          ? oPhys.currentSpeed
          : (otherVeh.moveFactor ?? 0) * otherBaseSpd;

      // 1. Politely wait for any vehicle finishing an end-of-route turnaround ahead
      if (otherTurning && aheadDist > -1.2 && aheadDist < minSafeGap + 5.5 && dist < 11.0) {
        const brake = clamp((dist - (hl + oHl + 1.9)) / 5.2, 0, 1);
        _driveAdvice.speedScale = Math.min(_driveAdvice.speedScale, brake);
        _driveAdvice.yielding = true;
        if (phys && brake < 0.35) phys.politeWait = true;
        continue;
      }

      // 2. Same-direction vehicle (`headingDot > 0.38`): calm left-lane pass or smooth headway follow
      if (headingDot > 0.38) {
        if (aheadDist > -(hl + oHl + 0.9) && aheadDist < minSafeGap + 8.5) {
          const wantPass =
            canPassOnLeft &&
            (otherDwelling ||
              otherActualSpd < (speed || 5.4) - 0.32 ||
              (phys && phys.passHoldTimer > 0));

          if (wantPass) {
            const otherLane = otherVeh.currentLaneOffset ?? cruiseLane;
            const safeLeftLane = clamp(otherLane - (hw + oHw + 0.68), -2.15, -1.05);
            const passShift = safeLeftLane - cruiseLane;
            _driveAdvice.extraLaneOffset = Math.min(_driveAdvice.extraLaneOffset, passShift);
            if (phys) {
              phys.passOffset = passShift;
              phys.passHoldTimer = 1.15;
            }
            // Ease speed slightly if still directly behind the car while steering out into the passing lane
            if (aheadDist > 0.2 && latAbs < minLatClear) {
              const mergeScale = clamp((aheadDist - (hl + oHl + 0.55)) / 4.2, 0.2, 0.88);
              _driveAdvice.speedScale = Math.min(_driveAdvice.speedScale, mergeScale);
            } else {
              // Calm pass at <= 94% of cruise speed (NEVER speeding up!)
              _driveAdvice.speedScale = Math.min(_driveAdvice.speedScale, 0.94);
            }
          } else if (aheadDist > 0.15 && latAbs < minLatClear + 0.45) {
            const gap = aheadDist - minSafeGap;
            const followScale = gap <= 0 ? 0 : clamp(gap / 5.4, 0, 1.0);
            _driveAdvice.speedScale = Math.min(_driveAdvice.speedScale, followScale);
            if (followScale < 0.35) {
              _driveAdvice.yielding = true;
              if (phys) phys.politeWait = true;
            }
          }
        }
        continue;
      }

      // 3. Oncoming vehicle (`headingDot < -0.35`): keep calmly to our right lane so both cars glide past
      if (headingDot < -0.35) {
        if (aheadDist > -(hl + oHl + 0.8) && aheadDist < minSafeGap + 9.0) {
          if (latAbs < minLatClear + 0.85) {
            let rightOk = true;
            if (buildingPeers || ponds || citySignPos || clampPointToIslandFn) {
              rightOk =
                checkPointClearance(
                  x + rightX * 0.75,
                  z + rightZ * 0.75,
                  hw * 0.82,
                  buildingPeers,
                  ponds,
                  selfEnt,
                  citySignPos,
                  clampPointToIslandFn,
                ) >= -0.05;
            }
            if (rightOk) {
              const needRight = clamp((minLatClear + 0.65 - latAbs) * 0.65, 0.22, 0.78);
              _driveAdvice.extraLaneOffset = Math.max(_driveAdvice.extraLaneOffset, needRight);
            }
            _driveAdvice.speedScale = Math.min(_driveAdvice.speedScale, 0.88);
          }

          // Single-lane pinch point: lower-priority vehicle waits politely at right edge while the other passes
          if (latAbs < minLatClear - 0.05 && aheadDist > 0 && aheadDist < minSafeGap + 2.8) {
            const otherSeed = Boolean(ent.data?.isSeed);
            const iYield = (!isSeed && otherSeed) || (isSeed === otherSeed && selfUnitId > otherId);
            if (iYield) {
              const brake = clamp((aheadDist - (hl + oHl + 1.2)) / 3.2, 0, 0.35);
              _driveAdvice.speedScale = Math.min(_driveAdvice.speedScale, brake);
              _driveAdvice.yielding = true;
              if (phys) phys.politeWait = true;
            }
          }
        }
        continue;
      }

      // 4. Crossing / T-junction (`-0.35 <= headingDot <= 0.38`): smooth yield before conflict box
      if (aheadDist > -0.6 && dist < 11.0) {
        const mySpd = speed || 5.4;
        let willCross = false;
        for (let step = 1; step <= 3; step++) {
          const lookT = step * 0.5;
          const px = x + fwdX * mySpd * lookT;
          const pz = z + fwdZ * mySpd * lookT;
          const pox = ox + oFwdX * otherActualSpd * lookT;
          const poz = oz + oFwdZ * otherActualSpd * lookT;
          if (Math.hypot(pox - px, poz - pz) < hl + oHl + 0.95) {
            willCross = true;
            break;
          }
        }
        if (willCross) {
          const otherAhead = -dx * oFwdX + -dz * oFwdZ;
          const otherAlreadyInBox = otherAhead < aheadDist - 0.9 && otherActualSpd > 0.35;
          const otherSeed = Boolean(ent.data?.isSeed);
          const iYield =
            otherAlreadyInBox ||
            (!otherDwelling &&
              ((!isSeed && otherSeed) || (isSeed === otherSeed && selfUnitId > otherId)));
          if (iYield) {
            const stopGap = dist - (hl + oHl + 1.35);
            const crossScale = stopGap <= 0 ? 0 : clamp(stopGap / 4.4, 0, 0.55);
            _driveAdvice.speedScale = Math.min(_driveAdvice.speedScale, crossScale);
            _driveAdvice.yielding = true;
            if (phys && crossScale < 0.35) phys.politeWait = true;
          }
        }
      }
    }
  }

  // Apply gentle obstacle-bypass bias if paused against a stationary corner
  if (phys && phys.wedgeBiasTimer > 0 && _driveAdvice.extraLaneOffset === 0) {
    _driveAdvice.extraLaneOffset = phys.wedgeBiasOffset;
  }

  _driveAdvice.speedScale = clamp(_driveAdvice.speedScale, 0, 1.0);
  return _driveAdvice;
}

/**
 * Runs every frame right after all `CreationSimEntity` kinematics have stepped:
 * 1. Enforces smooth solid-body OBB separation between all vehicles and static obstacles (zero pass-through,
 *    with gentle per-frame push clamping so vehicles slide smoothly past each other without jerking or catapulting).
 * 2. Enforces a strict world-space speed cap (`step <= baseSpeed * dt`) so NO vehicle can EVER speed up or jump.
 * 3. Integrates subtle suspension rock and calm lateral bypass bias if blocked.
 */
export function stepWorldVehiclePhysicsPass({
  dt,
  t,
  vehicleEntities,
  buildingEntities,
  pondProps,
  allEntities,
  citySignPos,
  clampPointToIslandFn,
}) {
  const units = gatherVehicleUnits(vehicleEntities);
  if (units.length === 0) return;

  const safeDt = Math.max(0.001, Math.min(0.05, dt || 0.016));
  const maxPushPerIter = Math.max(0.015, 1.9 * safeDt);

  // ── Pass 0: Cooldowns ──────────────────────────────────────────────────────
  for (let i = 0; i < units.length; i++) {
    const phys = units[i].phys;
    if (phys.clashCooldown > 0) {
      phys.clashCooldown = Math.max(0, phys.clashCooldown - safeDt);
    }
    if (phys.recentClashWindowTimer > 0) {
      phys.recentClashWindowTimer = Math.max(0, phys.recentClashWindowTimer - safeDt);
      if (phys.recentClashWindowTimer <= 0) {
        phys.recentClashCount = 0;
      }
    }
  }

  // ── Pass 1: Smooth Solid-Body OBB Separation (Vehicles + Environment) ─────
  const SOLVER_ITERS = 2;
  for (let iter = 0; iter < SOLVER_ITERS; iter++) {
    // 1A. Vehicle OBB vs Vehicle OBB
    for (let i = 0; i < units.length; i++) {
      const A = units[i];
      for (let j = i + 1; j < units.length; j++) {
        const B = units[j];
        const hit = intersectVehicleOBBs(
          A.veh.x,
          A.veh.z,
          A.veh.yaw,
          A.phys.hw,
          A.phys.hl,
          B.veh.x,
          B.veh.z,
          B.veh.yaw,
          B.phys.hw,
          B.phys.hl,
          0.0,
        );
        if (!hit.hit) continue;

        const nx = hit.nx;
        const nz = hit.nz;
        const depth = hit.depth;

        const mA = A.phys.mass * (A.veh.dwellingStop && !A.phys.turnState ? 2.5 : 1.0);
        const mB = B.phys.mass * (B.veh.dwellingStop && !B.phys.turnState ? 2.5 : 1.0);
        const invA = 1 / mA;
        const invB = 1 / mB;
        const invSum = invA + invB;
        const shareA = invA / invSum;
        const shareB = invB / invSum;

        // Smooth bounded separation (prevents catapulting/glitching even if two hulls overlap)
        const pushA = Math.min(maxPushPerIter, depth * shareA);
        const pushB = Math.min(maxPushPerIter, depth * shareB);
        A.veh.x += nx * pushA;
        A.veh.z += nz * pushA;
        B.veh.x -= nx * pushB;
        B.veh.z -= nz * pushB;

        if (iter === 0) {
          // Dampen forward speed when blocked nose-to-tail or nose-to-nose so neither car pushes harder
          const aFx = Math.sin(A.veh.yaw);
          const aFz = Math.cos(A.veh.yaw);
          const bFx = Math.sin(B.veh.yaw);
          const bFz = Math.cos(B.veh.yaw);
          if (nx * aFx + nz * aFz < -0.35) {
            A.phys.currentSpeed *= 0.65;
          }
          if (-nx * bFx - nz * bFz < -0.35) {
            B.phys.currentSpeed *= 0.65;
          }

          // Subtle bumper suspension rock on first gentle touch
          const relVx = A.phys.vx - B.phys.vx;
          const relVz = A.phys.vz - B.phys.vz;
          const closingSpeed = -(relVx * nx + relVz * nz);
          if (closingSpeed > 0.45 && A.phys.clashCooldown <= 0) {
            const jolt = clamp(closingSpeed * 0.012, 0.008, 0.032);
            const aRx = -aFz;
            const aRz = aFx;
            A.phys.clashPitchVel += (nx * aFx + nz * aFz) * jolt * 6.0 * shareA * 2;
            A.phys.clashRollVel += -(nx * aRx + nz * aRz) * jolt * 7.0 * shareA * 2;
            A.phys.clashCooldown = 0.45;
          }
          if (closingSpeed > 0.45 && B.phys.clashCooldown <= 0) {
            const jolt = clamp(closingSpeed * 0.012, 0.008, 0.032);
            const bRx = -bFz;
            const bRz = bFx;
            B.phys.clashPitchVel += (-nx * bFx - nz * bFz) * jolt * 6.0 * shareB * 2;
            B.phys.clashRollVel += -(-nx * bRx - nz * bRz) * jolt * 7.0 * shareB * 2;
            B.phys.clashCooldown = 0.45;
          }
        }
      }
    }

    // 1B. Vehicle OBB vs Solid Buildings, Landmarks, Ponds, Signboard, Wanderers & Coastline
    for (let i = 0; i < units.length; i++) {
      const U = units[i];
      const veh = U.veh;
      const phys = U.phys;

      if (citySignPos) {
        const sh = intersectOBBCircle(
          veh.x,
          veh.z,
          veh.yaw,
          phys.hw,
          phys.hl,
          citySignPos[0],
          citySignPos[1],
          1.8,
        );
        if (sh.hit) {
          const p = Math.min(maxPushPerIter * 1.25, sh.depth);
          veh.x += sh.nx * p;
          veh.z += sh.nz * p;
        }
      }

      if (pondProps) {
        for (let pIdx = 0; pIdx < pondProps.length; pIdx++) {
          const pond = pondProps[pIdx];
          const ph = intersectOBBCircle(
            veh.x,
            veh.z,
            veh.yaw,
            phys.hw,
            phys.hl,
            pond.x,
            pond.z,
            Math.max(1.5, (pond.radius || 6.4) - 0.35),
          );
          if (ph.hit) {
            const p = Math.min(maxPushPerIter * 1.25, ph.depth);
            veh.x += ph.nx * p;
            veh.z += ph.nz * p;
          }
        }
      }

      if (buildingEntities) {
        for (let bIdx = 0; bIdx < buildingEntities.length; bIdx++) {
          const bld = buildingEntities[bIdx];
          if (!bld || bld === U.ent || bld.interactive?.allowWalkOver) continue;
          if (bld.data?.category !== "building" && bld.data?.behavior?.type !== "landmark") continue;
          const box = getBuildingTightBox(bld, 0.78);
          const bh = intersectVehicleOBBs(
            veh.x,
            veh.z,
            veh.yaw,
            phys.hw,
            phys.hl,
            bld.x,
            bld.z,
            bld.yaw || 0,
            box.halfX,
            box.halfZ,
            0.0,
          );
          if (bh.hit) {
            const p = Math.min(maxPushPerIter * 1.25, bh.depth);
            veh.x += bh.nx * p;
            veh.z += bh.nz * p;
          }
        }
      }

      if (iter === 0 && allEntities) {
        for (let wIdx = 0; wIdx < allEntities.length; wIdx++) {
          const wEnt = allEntities[wIdx];
          if (!wEnt || wEnt === U.ent || wEnt.data?.behavior?.type !== "wander") continue;
          if (wEnt.data.behavior.style === "glide") continue;
          const wRad = clamp((wEnt.footprintRadius || 1.5) * 0.4, 0.55, 1.8);
          const wh = intersectOBBCircle(
            veh.x,
            veh.z,
            veh.yaw,
            phys.hw,
            phys.hl,
            wEnt.x,
            wEnt.z,
            wRad,
          );
          if (wh.hit) {
            const p = Math.min(maxPushPerIter, wh.depth);
            veh.x += wh.nx * p * 0.25;
            veh.z += wh.nz * p * 0.25;
            wEnt.x -= wh.nx * wh.depth * 0.75;
            wEnt.z -= wh.nz * wh.depth * 0.75;
            wEnt.group?.position?.set(wEnt.x, wEnt.group.position.y, wEnt.z);
          }
        }
      }

      if (clampPointToIslandFn) {
        const [ix, iz] = clampPointToIslandFn(veh.x, veh.z, phys.hw + 0.9);
        veh.x = ix;
        veh.z = iz;
      }
    }
  }

  // ── Pass 2: Hard Max-Speed Clamp, Subtle Suspension & Calm Bypass Bias ─────
  for (let i = 0; i < units.length; i++) {
    const U = units[i];
    const ent = U.ent;
    const veh = U.veh;
    const phys = U.phys;
    veh.y = 0.092;

    const baseSpeed = U.isSecondary
      ? veh.speed || 4.35
      : ent.effectiveSpeed || ent.data?.behavior?.speed || 5.6;

    // Strict world-space displacement clamp: a vehicle can NEVER exceed baseSpeed * dt on any frame!
    if (Number.isFinite(phys.frameStartX) && Number.isFinite(phys.frameStartZ)) {
      const fdx = veh.x - phys.frameStartX;
      const fdz = veh.z - phys.frameStartZ;
      const frameDist = Math.hypot(fdx, fdz);
      const maxFrameDist = baseSpeed * safeDt;
      if (frameDist > maxFrameDist && frameDist > 1e-6) {
        const scale = maxFrameDist / frameDist;
        veh.x = phys.frameStartX + fdx * scale;
        veh.z = phys.frameStartZ + fdz * scale;
      }
      phys.vx = (veh.x - phys.frameStartX) / safeDt;
      phys.vz = (veh.z - phys.frameStartZ) / safeDt;
    }

    // Spring-damper for subtle suspension rock
    const springK = 72.0;
    const dampC = 14.0;
    phys.clashPitchVel += (-springK * phys.clashPitch - dampC * phys.clashPitchVel) * safeDt;
    phys.clashPitch = clamp(phys.clashPitch + phys.clashPitchVel * safeDt, -0.04, 0.04);
    phys.clashRollVel += (-springK * phys.clashRoll - dampC * phys.clashRollVel) * safeDt;
    phys.clashRoll = clamp(phys.clashRoll + phys.clashRollVel * safeDt, -0.045, 0.045);

    // Calm grounded obstacle-bypass bias (no reversing, no teleporting, no mid-road U-turns!)
    const intentionalPause =
      Boolean(veh.dwellingStop) || Boolean(phys.turnState) || Boolean(phys.politeWait);

    if (intentionalPause) {
      phys.anchorX = veh.x;
      phys.anchorZ = veh.z;
      phys.stuckSec = Math.max(0, phys.stuckSec - safeDt * 2.0);
    } else {
      if (!Number.isFinite(phys.anchorX) || !Number.isFinite(phys.anchorZ)) {
        phys.anchorX = veh.x;
        phys.anchorZ = veh.z;
      }
      const distFromAnchor = Math.hypot(veh.x - phys.anchorX, veh.z - phys.anchorZ);
      if (distFromAnchor >= 0.9) {
        phys.anchorX = veh.x;
        phys.anchorZ = veh.z;
        phys.stuckSec = Math.max(0, phys.stuckSec - safeDt * 2.5);
      } else {
        phys.stuckSec += safeDt;
      }

      if (phys.stuckSec >= 2.0 && phys.wedgeBiasTimer <= 0) {
        const rX = -Math.cos(veh.yaw);
        const rZ = Math.sin(veh.yaw);
        const leftClear = checkPointClearance(
          veh.x - rX * 1.9,
          veh.z - rZ * 1.9,
          phys.hw * 0.8,
          buildingEntities,
          pondProps,
          ent,
          citySignPos,
          clampPointToIslandFn,
        );
        const rightClear = checkPointClearance(
          veh.x + rX * 1.9,
          veh.z + rZ * 1.9,
          phys.hw * 0.8,
          buildingEntities,
          pondProps,
          ent,
          citySignPos,
          clampPointToIslandFn,
        );
        phys.wedgeBiasOffset =
          leftClear > rightClear + 0.15
            ? -1.65
            : rightClear > leftClear + 0.15
              ? 1.35
              : phys.seedBiasSign < 0
                ? -1.55
                : 1.25;
        phys.wedgeBiasTimer = 2.6;
        phys.stuckSec = 0.4;
      }
    }

    // Sync Three.js Group transforms & boarding door coordinates with final post-collision pose
    const rX = -Math.cos(veh.yaw);
    const rZ = Math.sin(veh.yaw);
    if (!U.isSecondary) {
      ent.doorX = veh.x + rX * 1.9 + Math.sin(veh.yaw) * 0.9;
      ent.doorZ = veh.z + rZ * 1.9 + Math.cos(veh.yaw) * 0.9;
      const poseOff = ent.interactive?.getPoseOffset?.(t) || null;
      const basePitch =
        veh.dwellingStop && !phys.turnState
          ? 0
          : Math.sin(t * 14) * 0.006 * Math.abs(veh.moveFactor || 0);
      const finalY = (veh.y ?? 0.092) + (poseOff?.liftY || 0);
      const finalPitch = basePitch + phys.clashPitch;
      const finalRoll = (phys.turnBankRoll || 0) + phys.clashRoll + (poseOff?.rollZ || 0);
      ent.group.position.set(veh.x, finalY, veh.z);
      ent.group.rotation.set(finalPitch, veh.yaw, finalRoll);
    } else {
      const secPitch =
        (veh.dwellingStop && !phys.turnState
          ? 0
          : Math.sin(t * 13 + 1.4) * 0.005 * Math.abs(veh.moveFactor || 0)) + phys.clashPitch;
      const secRoll = (phys.turnBankRoll || 0) + phys.clashRoll;
      veh.group.position.set(veh.x, veh.y ?? 0.092, veh.z);
      veh.group.rotation.set(secPitch, veh.yaw, secRoll);
    }
  }
}

// GeminIsland — Endless Sunlit Voxel World Engine.
// Features:
//  - Multi-biome voxel turf ground shader (clover meadow, sandy shore, misty moss, volcanic basalt w/ glowing magma cracks, snow frost, stone plaza, autumn grove, desert mesa) — 0 extra draw calls, 0 Z-fighting
//  - 6 distinct path styles (asphalt road, winding dirt trail, cobblestone lane, timber boardwalk, volcanic ember trail, stepping flagstones)
//  - Dynamic multi-scale 3D plot stake & construction scaffolding (tiny 1.4m up to colossal 22m+ volcano plots)
//  - Physical 3D GeminIsland Contributor Signboard + optional live API micro-badges
//  - Camera-tracking texel-snapped 4096^2 PCF golden-hour shadows + GTAO + UnrealBloom + ACESFilmic + SMAA

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { VillagerAgent, buildBatchedWorldProps, buildWorldPropMesh } from "./villagers.js";
import { HermesSwarmManager } from "./hermes_agents.js";
import {
  RemotePlayerManager,
  buildCharacterAvatarRig,
  loadSavedAppearance,
  sanitizeAppearance,
} from "./character_system.js";
import {
  INTERIOR_ORIGIN,
  canEnterCreation,
  createInteriorAndTransitSystem,
} from "./interiors_and_transit.js";
import { INTERACTIVE_HIT_LAYER, createInteractiveController } from "./interactive_games.js";
import {
  Vox,
  buildCreationGroup,
  buildSplitDualVehicleGroups,
  buildVoxelMesh,
  getCreationFootprintRadius,
  getWorldVoxelSize,
  mergeVoxelMeshInstances,
  setVoxelShaderDetailScale,
} from "./vox.js";
import {
  computeProactiveTrafficControl,
  computeVehicleHullExtents,
  createVehiclePhysicsState,
  getBuildingTightBox,
  planVehicleTurnaround,
  pushPointOutOfVehicleOBB,
  stepVehicleTurnaround,
  stepWorldVehiclePhysicsPass,
} from "./vehicle_physics.js";

const CITY_SIGN_POS = [3.8, -10.8];
const CITY_SIGN_YAW = 0.62;
const MAX_SHADER_ZONES = 28;

export const ISLAND_HALF_EXTENT = 163.5;
export const ISLAND_SUPERELLIPSE_EXP = 3.1;

export function getIslandCoastWarp(theta) {
  return (
    9.2 * Math.cos(2 * theta + 1.55) +
    7.8 * Math.sin(3 * theta + 0.75) +
    5.6 * Math.cos(4 * theta + 3.08) +
    4.1 * Math.sin(5 * theta - 0.85) +
    2.6 * Math.cos(7 * theta + 0.4)
  );
}

export function getIslandCliffFactor(theta) {
  return Math.max(
    0,
    Math.min(1, 0.48 + 0.58 * Math.sin(3 * theta - 0.4) + 0.34 * Math.cos(5 * theta + 1.1)),
  );
}

/**
 * Signed distance (in meters) inward from the flat buildable GeminIsland plateau rim.
 * `> 0` is on the flat buildable island plateau (`y = 0`); `0` is the coastal crest;
 * `< 0` slopes down through sandy beaches & terraced coastal cliffs into the ocean.
 */
export function getIslandInlandMargin(x, z) {
  const ax = Math.abs(x) / ISLAND_HALF_EXTENT;
  const az = Math.abs(z) / ISLAND_HALF_EXTENT;
  const superDist =
    Math.pow(
      Math.pow(ax, ISLAND_SUPERELLIPSE_EXP) + Math.pow(az, ISLAND_SUPERELLIPSE_EXP),
      1 / ISLAND_SUPERELLIPSE_EXP,
    ) * ISLAND_HALF_EXTENT;
  const theta = Math.atan2(z, x);
  return ISLAND_HALF_EXTENT + getIslandCoastWarp(theta) - superDist;
}

export function clampPointToIsland(x, z, minInlandMargin = 3.0) {
  if (getIslandInlandMargin(x, z) >= minInlandMargin) return [x, z];
  const r = Math.hypot(x, z);
  if (r < 0.001) return [0, 0];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) * 0.5;
    if (getIslandInlandMargin(x * mid, z * mid) >= minInlandMargin) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [x * lo, z * lo];
}

export function getIslandGroundHeight(x, z) {
  const m = getIslandInlandMargin(x, z);
  if (m >= 0) return 0;
  const theta = Math.atan2(z, x);
  const cliff = getIslandCliffFactor(theta);
  const out = -m; // meters beyond plateau crest
  // Gentle sandy beach slope (waterline y = -0.56 sits around out ~ 6.2m)
  const tBeach = Math.min(1, out / 22.0);
  const beachY = -2.95 * Math.pow(tBeach, 1.12);
  // Voxel-terraced coastal cliff drop-off on headlands
  const rawCliff = -3.2 * Math.pow(Math.min(1, out / 13.5), 0.82);
  const terracedCliff = Math.round(rawCliff / 0.42) * 0.42;
  return beachY * (1 - cliff * 0.72) + terracedCliff * (cliff * 0.72);
}

const BIOME_IDS = {
  meadow_clover: 1,
  sandy_shore: 2,
  misty_moss: 3,
  volcanic_basalt: 4,
  snow_frost: 5,
  stone_plaza: 6,
  autumn_grove: 7,
  desert_mesa: 8,
};

function distToSeg2D(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const len2 = vx * vx + vz * vz;
  if (len2 < 0.001) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2));
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}

export function estimatePreviewPlotRadius(promptText = "") {
  const s = String(promptText || "").trim();
  if (!s) return 3.3;
  if (
    /\b(volcano|stratovolcano|caldera|mountain|mt\.|everest|fuji|matterhorn|glacier|canyon|mesa|waterfall|cascade|cataract|niagara|castle|citadel|fortress|palace|cathedral|stadium|arena|colosseum|amphitheater|amphitheatre|pyramid|ziggurat|launch\s*pad|spaceport|world\s*tree|yggdrasil|colossus|kaiju|godzilla|skyscraper|megastructure)\b/i.test(
      s,
    )
  ) {
    return 9.8;
  }
  if (
    /\b(cliff|clocktower|tower|windmill|lighthouse|datacentre|datacenter|factory|quarry|mine|firehouse|station|barn|bridge|temple|pagoda|museum|library|hotel|ship|galleon|roller\s*coaster)\b/i.test(
      s,
    )
  ) {
    return 5.4;
  }
  if (
    /\b(tiny|miniature|micro|mailbox|letterbox|postbox|hydrant|mushroom|toadstool|flower\s*pot|bonsai|campfire|bonfire|lantern|birdhouse|gnome|acorn|pebble|teacup|hedgehog|hamster|kitten|bunny|frog)\b/i.test(
      s,
    ) &&
    !/\b(giant|huge|massive|colossal|large|house|castle|tower)\b/i.test(s)
  ) {
    return 1.45;
  }
  if (
    /\b(small|little|cart|bike|bicycle|scooter|skateboard|dog|puppy|cat|fox|duck|swan|boat|canoe|statue|fountain|bench|shrine|kiosk|stall|well)\b/i.test(
      s,
    )
  ) {
    return 2.25;
  }
  return 3.3;
}

function makeMeadowSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "#88bef0");
  grad.addColorStop(0.52, "#bfe1f7");
  grad.addColorStop(0.84, "#d8eefb");
  grad.addColorStop(1.0, "#bce0f5");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildFirstPersonSkyDome(uTimeUniform) {
  const geo = new THREE.SphereGeometry(460, 32, 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTimeUniform,
      uSunDir: { value: new THREE.Vector3(64, 118, 76).normalize() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: true,
    vertexShader: `
      varying vec3 vLocalDir;
      void main() {
        vLocalDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vLocalDir;

      vec3 srgb2lin(float r, float g, float b) {
        return pow(vec3(r, g, b) / 255.0, vec3(2.2));
      }
      float sHash(vec2 p) {
        vec2 q = fract(p * vec2(127.1, 311.7));
        q += dot(q, q + 34.23);
        return fract(q.x * q.y);
      }
      float sNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x),
          mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec3 dir = normalize(vLocalDir);
        float h = clamp(dir.y, 0.0, 1.0);

        vec3 cHorizonMist = srgb2lin(188.0, 224.0, 245.0);
        vec3 cLowHaze     = srgb2lin(216.0, 238.0, 251.0);
        vec3 cPaleSky     = srgb2lin(192.0, 225.0, 246.0);
        vec3 cMidSky      = srgb2lin(134.0, 192.0, 240.0);
        vec3 cZenith      = srgb2lin(96.0, 162.0, 228.0);

        vec3 col = mix(cHorizonMist, cLowHaze, smoothstep(0.002, 0.065, h));
        col = mix(col, cPaleSky, smoothstep(0.055, 0.21, h));
        col = mix(col, cMidSky, smoothstep(0.19, 0.54, h));
        col = mix(col, cZenith, smoothstep(0.50, 0.96, h));

        float sunAmt = max(0.0, dot(dir, uSunDir));
        col += srgb2lin(255.0, 242.0, 206.0) * (pow(sunAmt, 12.0) * 0.18 + pow(sunAmt, 220.0) * 0.72) * smoothstep(0.0, 0.08, h);

        if (h > 0.055) {
          vec2 cuv = dir.xz / (h + 0.22) * 1.45 + vec2(uTime * 0.0055, uTime * 0.0028);
          float c1 = sNoise(cuv);
          float c2 = sNoise(cuv * 2.15 + vec2(7.3, -4.1));
          float cloud = smoothstep(0.54, 0.82, c1 * 0.68 + c2 * 0.32);
          float cloudFade = smoothstep(0.06, 0.24, h) * (1.0 - smoothstep(0.75, 0.99, h) * 0.35);
          col = mix(col, srgb2lin(250.0, 252.0, 252.0), cloud * cloudFade * 0.46);
        }

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  mesh.visible = false;
  return mesh;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function createContributorSignboard(maxAniso = 4) {
  const group = new THREE.Group();
  const s = 0.21;
  const v = new Vox(905);

  v.box(-14, 0, -4, 14, 1, 4, "concrete2");
  v.box(-13, 1, -3, 13, 2, 3, "limestone");
  for (const [cx, cz] of [[-13, -3], [12, -3], [-13, 2], [12, 2]]) {
    v.put(cx, 2, cz, "brass");
  }

  v.box(-12, 2, -1, -10, 20, 1, "woodDark");
  v.box(10, 2, -1, 12, 20, 1, "woodDark");
  v.box(-12, 20, -1, -10, 21, 1, "brass");
  v.box(10, 20, -1, 12, 21, 1, "brass");

  v.box(-10, 5, -1, 10, 18, 1, "oak");
  v.box(-11, 4, -1, 11, 5, 1, "woodDark");
  v.box(-11, 18, -1, 11, 19, 1, "woodDark");

  v.box(-14, 19, -3, 14, 20, 3, "terracotta");
  v.box(-13, 20, -2, 13, 21, 2, "brickDark");
  v.box(-1, 21, -1, 1, 23, 1, "iron");
  v.box(-1, 22, 1, 1, 24, 3, "warmGlow", 1.45);

  v.sphere(-14, 1.5, 2, 1.8, 1.2, 1.6, "leaf");
  v.sphere(14, 1.5, 2, 1.8, 1.2, 1.6, "leafLight");
  v.clear(-18, -3, -8, 18, 0, 8);
  v.put(-14, 2, 2, "#f6d55c");
  v.put(14, 2, 2, "#ec8db0");

  group.add(buildVoxelMesh(v, { scale: s }));

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 280;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso);

  const plaqueGeo = new THREE.PlaneGeometry(4.15, 2.52);
  const plaqueMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.56,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const frontPlaque = new THREE.Mesh(plaqueGeo, plaqueMat);
  frontPlaque.position.set(0, 11.5 * s, 1.08 * s);
  group.add(frontPlaque);

  const backPlaque = new THREE.Mesh(plaqueGeo, plaqueMat);
  backPlaque.position.set(0, 11.5 * s, -1.08 * s);
  backPlaque.rotation.y = Math.PI;
  group.add(backPlaque);

  let renderedCount = -1;
  function updateCount(count) {
    const n = Math.max(0, Number(count) || 0);
    if (n === renderedCount) return;
    renderedCount = n;

    ctx.clearRect(0, 0, 512, 280);

    roundRectPath(ctx, 4, 4, 504, 272, 22);
    ctx.fillStyle = "#5c3b20";
    ctx.fill();

    roundRectPath(ctx, 18, 18, 476, 244, 14);
    ctx.fillStyle = "#fcf7ea";
    ctx.fill();

    roundRectPath(ctx, 28, 28, 456, 224, 10);
    ctx.strokeStyle = "#d3a14a";
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.fillStyle = "#c9953c";
    for (const [rx, ry] of [[42, 42], [470, 42], [42, 238], [470, 238]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#6b4f35";
    ctx.font = "800 30px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("HERMES ISLAND", 256, 66);

    ctx.fillStyle = "#18211b";
    ctx.font = "800 104px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif";
    ctx.fillText(String(n), 256, 148);

    ctx.fillStyle = "#267043";
    ctx.font = "800 28px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif";
    ctx.fillText(n === 1 ? "CONTRIBUTION" : "CONTRIBUTIONS", 256, 220);

    tex.needsUpdate = true;
  }

  let targetCount = 0;
  let animFrom = 0;
  let animElapsed = 0;
  let animDuration = 0.88;
  let animActive = false;

  function setTargetCount(nextCount, immediate = false) {
    const target = Math.max(0, Math.round(Number(nextCount) || 0));
    targetCount = target;
    if (immediate || renderedCount < 0 || Math.abs(target - renderedCount) <= 1) {
      animActive = false;
      updateCount(target);
      return;
    }
    animFrom = renderedCount;
    animElapsed = 0;
    animDuration = renderedCount === 0 ? 0.92 : 0.48;
    animActive = true;
  }

  function stepCount(dt, canStart = true) {
    if (!animActive || !canStart) return;
    animElapsed += dt;
    const p = Math.min(1, animElapsed / Math.max(0.1, animDuration));
    const eased = 1 - Math.pow(1 - p, 2.5);
    const cur = p >= 1 ? targetCount : Math.round(animFrom + (targetCount - animFrom) * eased);
    updateCount(cur);
    if (p >= 1) {
      animActive = false;
    }
  }

  updateCount(0);
  group.position.set(CITY_SIGN_POS[0], 0, CITY_SIGN_POS[1]);
  group.position.y = 0;
  group.rotation.y = CITY_SIGN_YAW;
  group.userData.creationId = "__city_sign__";

  return { group, updateCount, setTargetCount, stepCount };
}

const SKY_BANNER_GLYPHS = {
  G: [
    ".#####.",
    "#######",
    "##...##",
    "##.....",
    "##.....",
    "##..###",
    "##..###",
    "##...##",
    "##...##",
    "#######",
    ".#####.",
  ],
  E: [
    "#######",
    "#######",
    "##.....",
    "##.....",
    "######.",
    "######.",
    "##.....",
    "##.....",
    "##.....",
    "#######",
    "#######",
  ],
  M: [
    "##.....##",
    "###...###",
    "####.####",
    "#########",
    "##.###.##",
    "##..#..##",
    "##.....##",
    "##.....##",
    "##.....##",
    "##.....##",
    "##.....##",
  ],
  I: [
    "######",
    "######",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "######",
    "######",
  ],
  N: [
    "##....##",
    "###...##",
    "####..##",
    "####..##",
    "##.##.##",
    "##.##.##",
    "##.##.##",
    "##..####",
    "##..####",
    "##...###",
    "##....##",
  ],
  S: [
    ".#####.",
    "#######",
    "##...##",
    "###....",
    ".####..",
    ".#####.",
    "..####.",
    "....###",
    "##...##",
    "#######",
    ".#####.",
  ],
  L: [
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "##.....",
    "#######",
    "#######",
  ],
  A: [
    "..####..",
    ".######.",
    "##....##",
    "##....##",
    "##....##",
    "########",
    "########",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
  ],
  H: [
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "#######",
    "#######",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
  ],
  R: [
    "######.",
    "#######",
    "##...##",
    "##...##",
    "######.",
    "#####..",
    "##.###.",
    "##..###",
    "##...##",
    "##...##",
    "##...##",
  ],
  D: [
    "#####..",
    "######.",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "######.",
    "#####..",
  ],
};

function createFloatingSkyBanner() {
  const group = new THREE.Group();
  const text = "HERMES";
  const voxScale = 0.68;
  const letterGapCols = 2.3;

  // Curated Hollywood-sign-meets-sky-whimsy vertical & depth stagger per letter
  const staggerOffsetsY = [0.72, -0.82, 1.08, -0.56, 0.88, -0.94, 0.66, -0.78, 1.12, -0.58, 0.82];
  const staggerOffsetsZ = [0.35, -0.42, 0.48, -0.28, 0.38, -0.46, 0.32, -0.38, 0.44, -0.32, 0.36];
  const baseRolls = [-0.038, 0.032, -0.026, 0.041, -0.03, 0.036, -0.034, 0.028, -0.036, 0.031, -0.028];
  const baseYaws = [0.04, -0.025, 0.03, -0.032, 0.024, -0.028, 0.032, -0.024, 0.028, -0.03, 0.036];

  const chars = text.split("");
  let totalCols = 0;
  for (let i = 0; i < chars.length; i++) {
    const rows = SKY_BANNER_GLYPHS[chars[i]];
    totalCols += rows[0].length + (i < chars.length - 1 ? letterGapCols : 0);
  }

  const letters = [];
  let cursorCol = -totalCols * 0.5;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const rows = SKY_BANNER_GLYPHS[ch];
    const hRows = rows.length;
    const wCols = rows[0].length;
    const v = new Vox(1700 + i * 37);

    const xOff = -wCols * 0.5;
    const yOff = -hRows * 0.5;

    for (let r = 0; r < hRows; r++) {
      const rowStr = rows[r];
      const vy = Math.round(yOff + (hRows - 1 - r));
      const isTopCap = r === 0 || (r > 0 && rows[r - 1] !== undefined);
      for (let c = 0; c < wCols; c++) {
        if (rowStr[c] !== "#") continue;
        const vx = Math.round(xOff + c);
        const openAbove = r === 0 || rows[r - 1][c] !== "#";
        const faceCol = openAbove ? "snow" : r >= hRows - 2 ? "cream" : "white";
        v.put(vx, vy, 1, faceCol, openAbove ? 0.08 : 0.03);
        v.put(vx, vy, 0, "gold", openAbove && isTopCap ? 0.14 : 0.04);
        v.put(vx, vy, -1, "marble", 0.02);
      }
    }

    const mesh = buildVoxelMesh(v, {
      scale: voxScale,
      jitter: 0.024,
      castShadow: false,
      receiveShadow: false,
    });
    mesh.raycast = () => {};

    const holder = new THREE.Group();
    holder.add(mesh);

    const centerCol = cursorCol + wCols * 0.5;
    cursorCol += wCols + letterGapCols;

    const u = chars.length > 1 ? (i / (chars.length - 1)) * 2 - 1 : 0;
    const archY = (1 - u * u) * 1.15;
    const archZ = -u * u * 1.35;
    const baseX = centerCol * voxScale;
    const baseY = archY + staggerOffsetsY[i % staggerOffsetsY.length];
    const baseZ = archZ + staggerOffsetsZ[i % staggerOffsetsZ.length];
    const baseRoll = baseRolls[i % baseRolls.length];
    const baseYaw = baseYaws[i % baseYaws.length] - u * 0.055;

    holder.position.set(baseX, baseY, baseZ);
    holder.rotation.set(0, baseYaw, baseRoll);
    group.add(holder);

    letters.push({
      holder,
      baseX,
      baseY,
      baseZ,
      baseRoll,
      baseYaw,
      phase: i * 0.78 + (i % 3) * 0.42,
    });
  }

  // Subtle whimsical drifting voxel cloudlet puffs accompanying the sky banner
  const cloudSeeds = [
    { x: -27.5, y: -3.7, z: 1.6, scale: 0.46, phase: 0.4 },
    { x: -13.2, y: -4.2, z: -1.8, scale: 0.4, phase: 2.1 },
    { x: 1.4, y: -3.9, z: 1.7, scale: 0.48, phase: 3.7 },
    { x: 15.8, y: -4.1, z: -1.5, scale: 0.42, phase: 5.0 },
    { x: 28.0, y: -3.6, z: 1.4, scale: 0.45, phase: 1.3 },
  ];
  const clouds = [];
  cloudSeeds.forEach((cs, idx) => {
    const cv = new Vox(1920 + idx * 29);
    cv.sphere(0, 0, 0, 4.2, 2.0, 2.4, "white", 0.04);
    cv.sphere(-2.6, -0.3, 0.3, 2.8, 1.5, 1.9, "snow", 0.04);
    cv.sphere(2.7, -0.2, -0.2, 3.0, 1.6, 2.0, "cream", 0.03);
    cv.clear(-9, -5, -6, 9, -1, 6);
    const cMesh = buildVoxelMesh(cv, {
      scale: cs.scale,
      jitter: 0.04,
      castShadow: false,
      receiveShadow: false,
    });
    cMesh.raycast = () => {};
    cMesh.position.set(cs.x, cs.y, cs.z);
    group.add(cMesh);
    clouds.push({ mesh: cMesh, ...cs });
  });

  const anchorX = -48;
  const anchorY = 31.5;
  const anchorZ = -95;
  const anchorYaw = 0.55;

  group.position.set(anchorX, anchorY, anchorZ);
  group.rotation.y = anchorYaw;

  function step(t) {
    // Gentle slow island-sky drift on the whole banner + independent subtle letter float
    group.position.x = anchorX + Math.sin(t * 0.13) * 0.95;
    group.position.y = anchorY + Math.cos(t * 0.17) * 0.42;
    group.position.z = anchorZ + Math.sin(t * 0.11 + 1.2) * 0.65;

    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      const ph = L.phase;
      const dy = Math.sin(t * 0.58 + ph) * 0.48 + Math.sin(t * 0.29 + ph * 1.6) * 0.22;
      const dx = Math.cos(t * 0.36 + ph * 0.9) * 0.14;
      const dz = Math.sin(t * 0.33 + ph * 1.15) * 0.2;
      L.holder.position.set(L.baseX + dx, L.baseY + dy, L.baseZ + dz);
      L.holder.rotation.set(
        Math.cos(t * 0.41 + ph) * 0.026,
        L.baseYaw + Math.sin(t * 0.31 + ph * 0.8) * 0.032,
        L.baseRoll + Math.sin(t * 0.46 + ph * 1.1) * 0.03,
      );
    }

    for (let i = 0; i < clouds.length; i++) {
      const C = clouds[i];
      C.mesh.position.set(
        C.x + Math.sin(t * 0.24 + C.phase) * 0.75,
        C.y + Math.cos(t * 0.42 + C.phase) * 0.34,
        C.z + Math.sin(t * 0.28 + C.phase * 1.3) * 0.3,
      );
    }
  }

  return { group, step };
}

function buildPlotMarkerGroup() {
  const group = new THREE.Group();

  // Unit-radius ring (0.90..1.04) scaled dynamically by plot radius (1.45m tiny -> 9.8m colossal!)
  const ringGeo = new THREE.RingGeometry(0.9, 1.04, 64);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.122;
  group.add(ring);

  // 4 independent corner stakes repositioned dynamically to match plot footprint
  const singleStakeVox = new Vox(931);
  singleStakeVox.box(-1, 0, -1, 1, 5, 1, "woodDark");
  singleStakeVox.box(-1, 5, -1, 1, 6, 1, "gold", 0.45);
  const stakeProto = buildVoxelMesh(singleStakeVox, { scale: 0.24 });
  const stakeCorners = [];
  for (let i = 0; i < 4; i++) {
    const st = stakeProto.clone();
    group.add(st);
    stakeCorners.push(st);
  }

  // Construction scaffolding sub-group (scales with plot radius while queued/sculpting)
  const scaffoldGroup = new THREE.Group();
  const scafVox = new Vox(947);
  for (const [sx, sz] of [[-9, -9], [8, -9], [-9, 8], [8, 8]]) {
    scafVox.box(sx, 0, sz, sx + 2, 16, sz + 2, "wood");
  }
  scafVox.box(-9, 8, -9, 10, 9, -8, "hazard");
  scafVox.box(-9, 8, 9, 10, 9, 10, "hazard");
  scafVox.box(-9, 8, -9, -8, 9, 10, "hazard");
  scafVox.box(9, 8, -9, 10, 9, 10, "hazard");
  scafVox.box(-9, 15, -9, 10, 16, -8, "woodLight");
  scafVox.box(-9, 15, 9, 10, 16, 10, "woodLight");
  const scafFrame = buildVoxelMesh(scafVox, { scale: 0.22 });
  scaffoldGroup.add(scafFrame);

  const floatingCubes = [];
  const cubeCols = ["busYellow", "teal", "terracotta"];
  for (let i = 0; i < 3; i++) {
    const cv = new Vox(960 + i);
    cv.box(-2, -2, -2, 2, 2, 2, cubeCols[i], 0.35);
    const cm = buildVoxelMesh(cv, { scale: 0.2 });
    scaffoldGroup.add(cm);
    floatingCubes.push(cm);
  }
  scaffoldGroup.visible = false;
  group.add(scaffoldGroup);
  group.visible = false;

  let baseRadius = 3.3;
  function setPlotRadius(r) {
    baseRadius = Math.max(1.3, Math.min(12.5, Number(r) || 3.3));
    const corner = baseRadius * 0.7;
    const signs = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (let i = 0; i < 4; i++) {
      stakeCorners[i].position.set(signs[i][0] * corner, 0, signs[i][1] * corner);
      const stakeScale = Math.max(0.82, Math.min(1.55, 0.78 + baseRadius * 0.08));
      stakeCorners[i].scale.setScalar(stakeScale);
    }
    const scafScaleXZ = Math.max(0.55, Math.min(2.85, baseRadius / 2.75));
    const scafScaleY = Math.max(0.68, Math.min(2.1, 0.7 + baseRadius * 0.14));
    scafFrame.scale.set(scafScaleXZ, scafScaleY, scafScaleXZ);
  }
  setPlotRadius(3.3);

  return {
    group,
    ring,
    ringMat,
    scaffoldGroup,
    floatingCubes,
    setPlotRadius,
    getPlotRadius: () => baseRadius,
  };
}

const FEED_DOT_COLORS = {
  weather: "#f5b82e",
  surf: "#3ca7de",
  wind: "#4eb86e",
  time: "#d99b38",
  moon: "#9370cf",
  iss: "#3ec9bd",
};

function drawFeedBadgeCanvas(canvas, reading) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  roundRectPath(ctx, 6, 6, w - 12, h - 12, 54);
  ctx.fillStyle = "rgba(22, 28, 24, 0.88)";
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.stroke();

  const dotCol = FEED_DOT_COLORS[reading.kind] || "#3fb963";
  ctx.fillStyle = dotCol;
  ctx.beginPath();
  ctx.arc(46, h / 2, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 40px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(reading.badge || "").slice(0, 20), 74, h / 2 + 2);
}

const ISLAND_GLSL_HELPERS = `
  float islandCoastWarp(float theta) {
    return 9.2 * cos(2.0 * theta + 1.55)
         + 7.8 * sin(3.0 * theta + 0.75)
         + 5.6 * cos(4.0 * theta + 3.08)
         + 4.1 * sin(5.0 * theta - 0.85)
         + 2.6 * cos(7.0 * theta + 0.4);
  }
  float islandCliffFactor(float theta) {
    return clamp(0.48 + 0.58 * sin(3.0 * theta - 0.4) + 0.34 * cos(5.0 * theta + 1.1), 0.0, 1.0);
  }
  float islandInlandMargin(vec2 wp) {
    const float H = 163.5;
    const float P = 3.1;
    float ax = max(1e-5, abs(wp.x) / H);
    float az = max(1e-5, abs(wp.y) / H);
    float superDist = pow(pow(ax, P) + pow(az, P), 1.0 / P) * H;
    float theta = length(wp) > 1e-4 ? atan(wp.y, wp.x) : 0.0;
    return H + islandCoastWarp(theta) - superDist;
  }
`;

function buildEndlessGrassMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.88,
    metalness: 0.0,
    dithering: true,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFocusXZ = uniforms.uFocusXZ;
    shader.uniforms.uHorizonRange = uniforms.uHorizonRange;
    shader.uniforms.uZones = uniforms.uZones;
    shader.uniforms.uZoneCount = uniforms.uZoneCount;
    shader.uniforms.uShaderQuality = uniforms.uShaderQuality;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWorldPos;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform vec2 uFocusXZ;
        uniform vec2 uHorizonRange;
        uniform vec4 uZones[${MAX_SHADER_ZONES}];
        uniform int uZoneCount;
        uniform float uShaderQuality;
        varying vec3 vWorldPos;

        vec3 srgb2lin(float r, float g, float b) {
          return pow(vec3(r, g, b) / 255.0, vec3(2.2));
        }
        float mHash(vec2 p) {
          vec2 q = fract(p * vec2(123.34, 456.21));
          q += dot(q, q + 45.32);
          return fract(q.x * q.y);
        }
        float mNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mHash(i + vec2(0.0, 0.0)), mHash(i + vec2(1.0, 0.0)), u.x),
            mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }
        ${ISLAND_GLSL_HELPERS}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 wp = vWorldPos.xz;
        const float TILE = 0.85;
        vec2 tileCoord = wp / TILE;
        vec2 cell = floor(tileCoord);
        vec2 cellUv = fract(tileCoord);
        vec2 cellCenter = (cell + 0.5) * TILE;

        float tilePx = max(fwidth(tileCoord.x), fwidth(tileCoord.y));
        float tileDetail = (1.0 - smoothstep(0.06, 0.20, tilePx)) * uShaderQuality;

        vec3 turfDeep = srgb2lin(103.0, 174.0, 74.0);
        vec3 turfBase = srgb2lin(116.0, 187.0, 84.0);
        vec3 turfMid  = srgb2lin(128.0, 198.0, 94.0);
        vec3 turfSun  = srgb2lin(142.0, 209.0, 105.0);

        float meadowZone = mNoise(wp * 0.028);
        float subZone = mNoise(wp * 0.085 + vec2(19.4, -11.2));
        float cellH = mHash(cell);
        float cellH2 = mHash(cell + vec2(37.2, -91.7));
        vec2 terraceBlock = floor(cell * 0.25);
        float lawnCheck = mod(terraceBlock.x + terraceBlock.y, 2.0);

        vec3 grassCol = mix(turfDeep, turfBase, smoothstep(0.20, 0.68, meadowZone));
        grassCol = mix(grassCol, turfMid, smoothstep(0.42, 0.85, subZone) * 0.72);
        grassCol = mix(grassCol, turfSun, smoothstep(0.68, 0.96, meadowZone * 0.6 + subZone * 0.4) * 0.45);

        // Organic voxel-stepped ground biome zones
        float borderWarp = (mNoise(cellCenter * 0.15) - 0.5) * 4.2 + (mNoise(cellCenter * 0.37 + 11.3) - 0.5) * 1.8;
        float volcanicGlowMask = 0.0;

        for (int i = 0; i < ${MAX_SHADER_ZONES}; i++) {
          if (i >= uZoneCount) break;
          vec4 zn = uZones[i];
          float d = length(cellCenter - zn.xy) + borderWarp;
          float w = 1.0 - smoothstep(zn.z * 0.62, zn.z * 1.06, d);
          if (w > 0.01) {
            int bId = int(zn.w + 0.5);
            vec3 bCol = grassCol;
            if (bId == 1) {
              bCol = mix(srgb2lin(86.0, 168.0, 68.0), srgb2lin(118.0, 196.0, 82.0), subZone);
              if (cellH2 > 0.91) {
                bCol = cellH > 0.5 ? srgb2lin(249.0, 214.0, 92.0) : srgb2lin(242.0, 148.0, 184.0);
              }
            } else if (bId == 2) {
              bCol = mix(srgb2lin(224.0, 194.0, 134.0), srgb2lin(242.0, 221.0, 168.0), subZone);
              if (cellH2 > 0.93) bCol = srgb2lin(250.0, 243.0, 224.0);
            } else if (bId == 3) {
              bCol = mix(srgb2lin(68.0, 126.0, 69.0), srgb2lin(92.0, 152.0, 82.0), subZone);
              if (cellH2 > 0.86) bCol = srgb2lin(116.0, 125.0, 122.0);
            } else if (bId == 4) {
              bCol = mix(srgb2lin(42.0, 44.0, 52.0), srgb2lin(66.0, 64.0, 72.0), subZone);
              float crackField = abs(mNoise(cellCenter * 0.28 + vec2(4.2, -8.1)) - 0.5);
              if (crackField < 0.055 && d < zn.z * 0.85) {
                float pulse = 0.72 + 0.28 * sin(uTime * 2.6 + cellH * 6.28);
                bCol = mix(srgb2lin(235.0, 78.0, 28.0), srgb2lin(255.0, 174.0, 48.0), pulse);
                volcanicGlowMask = max(volcanicGlowMask, w * pulse);
              }
            } else if (bId == 5) {
              bCol = mix(srgb2lin(222.0, 236.0, 248.0), srgb2lin(247.0, 251.0, 255.0), subZone);
            } else if (bId == 6) {
              float checker = mod(cell.x + cell.y, 2.0);
              bCol = mix(srgb2lin(202.0, 190.0, 168.0), srgb2lin(224.0, 214.0, 194.0), checker * 0.65 + subZone * 0.35);
            } else if (bId == 7) {
              bCol = mix(srgb2lin(182.0, 124.0, 56.0), srgb2lin(218.0, 158.0, 68.0), subZone);
              if (cellH2 > 0.82) bCol = srgb2lin(174.0, 78.0, 52.0);
              else if (cellH2 < 0.22) bCol = srgb2lin(116.0, 162.0, 72.0);
            } else if (bId == 8) {
              bCol = mix(srgb2lin(198.0, 114.0, 68.0), srgb2lin(224.0, 152.0, 96.0), subZone);
            }
            grassCol = mix(grassCol, bCol, w);
          }
        }

        // Fast interior skip: inside radius 124m, superDist <= length(p) guarantees coastM > 6.5m (zero beach/dune contribution)
        if (dot(cellCenter, cellCenter) >= 15376.0) {
          float coastTheta = length(cellCenter) > 1e-4 ? atan(cellCenter.y, cellCenter.x) : 0.0;
          float cliffAmt = islandCliffFactor(coastTheta);
          float coastM = islandInlandMargin(cellCenter) + borderWarp * 0.38;

          float duneBlend = 1.0 - smoothstep(1.2, 5.6, coastM);
          if (duneBlend > 0.005) {
            vec3 duneGrass = mix(srgb2lin(154.0, 196.0, 92.0), srgb2lin(192.0, 206.0, 116.0), subZone);
            grassCol = mix(grassCol, duneGrass, duneBlend * 0.72);
          }

          float shoreBlend = 1.0 - smoothstep(-1.2, 1.8, coastM);
          if (shoreBlend > 0.005) {
            vec3 drySand = mix(srgb2lin(234.0, 206.0, 146.0), srgb2lin(249.0, 232.0, 184.0), subZone);
            if (cellH2 > 0.92) drySand = srgb2lin(253.0, 247.0, 230.0);
            float wetBand = smoothstep(-0.26, -0.68, vWorldPos.y);
            vec3 wetSand = mix(srgb2lin(182.0, 150.0, 98.0), srgb2lin(146.0, 122.0, 82.0), cellH * 0.5);
            vec3 beachCol = mix(drySand, wetSand, wetBand);

            float strata = fract(vWorldPos.y * -1.8 + cellH * 0.25);
            vec3 cliffRock = mix(srgb2lin(168.0, 160.0, 144.0), srgb2lin(132.0, 126.0, 116.0), smoothstep(0.25, 0.85, strata));
            cliffRock = mix(cliffRock, srgb2lin(112.0, 108.0, 102.0), wetBand * 0.55);

            float rockMask = smoothstep(0.46, 0.78, cliffAmt + (subZone - 0.5) * 0.22);
            vec3 coastCol = mix(beachCol, cliffRock, rockMask);
            grassCol = mix(grassCol, coastCol, shoreBlend);
          }
        }

        if (tileDetail > 0.01) {
          float blockTone = (floor(cellH * 4.0) / 3.0 - 0.5) * 0.075 + (lawnCheck - 0.5) * 0.028;
          grassCol *= 1.0 + blockTone * tileDetail;

          vec2 edgeDist = min(cellUv, 1.0 - cellUv);
          float minEdge = min(edgeDist.x, edgeDist.y);
          float seamW = max(0.042, tilePx * 1.35);
          float seam = smoothstep(0.0, seamW, minEdge);
          grassCol *= mix(1.0 - 0.085 * tileDetail, 1.0, seam);

          float topLip = (1.0 - smoothstep(0.0, 0.14, cellUv.y)) * seam;
          grassCol += grassCol * topLip * 0.045 * tileDetail;
        }

        vec2 cloudUv = wp * 0.011 + vec2(uTime * 0.008, uTime * 0.0045);
        float cloud = mNoise(cloudUv) * 0.65 + mNoise(cloudUv * 2.0 + 3.7) * 0.35;
        grassCol *= mix(0.92, 1.05, smoothstep(0.32, 0.70, cloud));

        diffuseColor.rgb = grassCol;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (volcanicGlowMask > 0.01) {
          totalEmissiveRadiance += srgb2lin(255.0, 102.0, 28.0) * (volcanicGlowMask * 0.85);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "geminisland-island-biomes-v10";
  return mat;
}

function buildIslandTerrainGeometry() {
  const size = 408;
  const half = size * 0.5;
  const fineSegs = 256;
  const macroSegs = 32;
  const sub = fineSegs / macroSegs; // 8 fine steps per macro cell
  const step = size / fineSegs;
  const gridStride = fineSegs + 1;

  // Classify each 12.75m x 12.75m macro cell: coastal slope/cliff band gets full 1.59m resolution;
  // strictly flat y=0 interior plateau and deep seabed under the opaque ocean use coarse quads.
  const isFine = new Uint8Array(macroSegs * macroSegs);
  for (let mz = 0; mz < macroSegs; mz++) {
    for (let mx = 0; mx < macroSegs; mx++) {
      let fine = 0;
      for (let sz = 0; sz <= 2 && !fine; sz++) {
        const z = -half + (mz * sub + sz * (sub * 0.5)) * step;
        for (let sx = 0; sx <= 2; sx++) {
          const x = -half + (mx * sub + sx * (sub * 0.5)) * step;
          const m = getIslandInlandMargin(x, z);
          if (m < 5.5 && m > -25.5) {
            fine = 1;
            break;
          }
        }
      }
      isFine[mz * macroSegs + mx] = fine;
    }
  }

  const vertMap = new Int32Array(gridStride * gridStride);
  vertMap.fill(-1);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const getVert = (gx, gz) => {
    const key = gz * gridStride + gx;
    let idx = vertMap[key];
    if (idx !== -1) return idx;
    idx = positions.length / 3;
    vertMap[key] = idx;
    const x = -half + gx * step;
    const z = -half + gz * step;
    const m = getIslandInlandMargin(x, z);
    const y = m >= 0 ? 0 : getIslandGroundHeight(x, z);
    positions.push(x, y, z);
    uvs.push(gx / fineSegs, 1 - gz / fineSegs);
    if (m >= 1.8) {
      normals.push(0, 1, 0);
    } else {
      const yL = getIslandGroundHeight(x - step, z);
      const yR = getIslandGroundHeight(x + step, z);
      const yD = getIslandGroundHeight(x, z - step);
      const yU = getIslandGroundHeight(x, z + step);
      const nx = yL - yR;
      const ny = 2 * step;
      const nz = yD - yU;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nLen, ny / nLen, nz / nLen);
    }
    return idx;
  };

  for (let mz = 0; mz < macroSegs; mz++) {
    const gz0 = mz * sub;
    for (let mx = 0; mx < macroSegs; mx++) {
      const gx0 = mx * sub;
      if (isFine[mz * macroSegs + mx]) {
        for (let dz = 0; dz < sub; dz++) {
          const r0 = gz0 + dz;
          const r1 = r0 + 1;
          for (let dx = 0; dx < sub; dx++) {
            const c0 = gx0 + dx;
            const c1 = c0 + 1;
            const nw = getVert(c0, r0);
            const ne = getVert(c1, r0);
            const sw = getVert(c0, r1);
            const se = getVert(c1, r1);
            indices.push(nw, sw, ne, sw, se, ne);
          }
        }
      } else {
        const fineN = mz > 0 && isFine[(mz - 1) * macroSegs + mx] === 1;
        const fineS = mz + 1 < macroSegs && isFine[(mz + 1) * macroSegs + mx] === 1;
        const fineW = mx > 0 && isFine[mz * macroSegs + (mx - 1)] === 1;
        const fineE = mx + 1 < macroSegs && isFine[mz * macroSegs + (mx + 1)] === 1;
        if (!fineN && !fineS && !fineW && !fineE) {
          const nw = getVert(gx0, gz0);
          const ne = getVert(gx0 + sub, gz0);
          const sw = getVert(gx0, gz0 + sub);
          const se = getVert(gx0 + sub, gz0 + sub);
          indices.push(nw, sw, ne, sw, se, ne);
        } else {
          // Crack-free center-fan stitch between coarse interior cells and 8x8 fine coastal cells
          const center = getVert(gx0 + (sub >> 1), gz0 + (sub >> 1));
          if (fineN) {
            for (let i = 0; i < sub; i++) {
              indices.push(center, getVert(gx0 + i + 1, gz0), getVert(gx0 + i, gz0));
            }
          } else {
            indices.push(center, getVert(gx0 + sub, gz0), getVert(gx0, gz0));
          }
          if (fineW) {
            for (let i = 0; i < sub; i++) {
              indices.push(center, getVert(gx0, gz0 + i), getVert(gx0, gz0 + i + 1));
            }
          } else {
            indices.push(center, getVert(gx0, gz0), getVert(gx0, gz0 + sub));
          }
          if (fineS) {
            for (let i = 0; i < sub; i++) {
              indices.push(center, getVert(gx0 + i, gz0 + sub), getVert(gx0 + i + 1, gz0 + sub));
            }
          } else {
            indices.push(center, getVert(gx0, gz0 + sub), getVert(gx0 + sub, gz0 + sub));
          }
          if (fineE) {
            for (let i = 0; i < sub; i++) {
              indices.push(center, getVert(gx0 + sub, gz0 + i + 1), getVert(gx0 + sub, gz0 + i));
            }
          } else {
            indices.push(center, getVert(gx0 + sub, gz0 + sub), getVert(gx0 + sub, gz0));
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(
    positions.length / 3 <= 65535
      ? new THREE.Uint16BufferAttribute(indices, 1)
      : new THREE.Uint32BufferAttribute(indices, 1),
  );
  geo.computeBoundingSphere();
  return geo;
}

function buildIslandOceanMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uFocusXZ: uniforms.uFocusXZ,
      uSunDir: { value: new THREE.Vector3(64, 118, 76).normalize() },
    },
    toneMapped: true,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uFocusXZ;
      uniform vec3 uSunDir;
      varying vec3 vWorldPos;

      vec3 srgb2lin(float r, float g, float b) {
        return pow(vec3(r, g, b) / 255.0, vec3(2.2));
      }
      float oHash(vec2 p) {
        vec2 q = fract(p * vec2(127.1, 311.7));
        q += dot(q, q + 34.23);
        return fract(q.x * q.y);
      }
      float oNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(oHash(i), oHash(i + vec2(1.0, 0.0)), u.x),
          mix(oHash(i + vec2(0.0, 1.0)), oHash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      ${ISLAND_GLSL_HELPERS}

      void main() {
        vec2 wp = vWorldPos.xz;
        if (dot(wp, wp) < 15376.0) discard;
        float rawMargin = islandInlandMargin(wp);
        // Cull ocean strictly under the dry interior plateau to save GPU fillrate
        if (rawMargin > 4.0) discard;

        // Voxel-quantized ocean cell for charming blocky surf & caustic shimmer
        const float WTILE = 0.95;
        vec2 wCell = floor(wp / WTILE);
        vec2 wCenter = (wCell + 0.5) * WTILE;
        float cellRand = oHash(wCell);

        float coastM = islandInlandMargin(wCenter) + (oNoise(wCenter * 0.14) - 0.5) * 1.4;
        // Waterline occurs around coastM = -5.6m (where terrain reaches y = -0.56)
        float offshore = max(0.0, -coastM - 5.2);

        // Shallow turquoise lagoon -> sunlit aquamarine shelf -> deep cobalt sea
        vec3 cShallow = srgb2lin(66.0, 208.0, 212.0);
        vec3 cLagoon  = srgb2lin(38.0, 166.0, 204.0);
        vec3 cShelf   = srgb2lin(26.0, 122.0, 184.0);
        vec3 cDeep    = srgb2lin(19.0, 86.0, 152.0);

        vec3 waterCol = mix(cShallow, cLagoon, smoothstep(0.0, 9.5, offshore));
        waterCol = mix(waterCol, cShelf, smoothstep(8.0, 28.0, offshore));
        waterCol = mix(waterCol, cDeep, smoothstep(26.0, 82.0, offshore));

        // Blocky voxel water swell & shallow reef caustics
        float swell1 = oNoise(wCenter * 0.075 + vec2(uTime * 0.22, -uTime * 0.16));
        float swell2 = oNoise(wCenter * 0.16 + vec2(-uTime * 0.18, uTime * 0.24));
        float caustic = smoothstep(0.56, 0.84, swell1 * 0.55 + swell2 * 0.45);
        float shallowMask = 1.0 - smoothstep(2.0, 22.0, offshore);
        waterCol += srgb2lin(125.0, 240.0, 245.0) * (caustic * shallowMask * 0.18);
        waterCol *= 0.94 + 0.12 * smoothstep(0.25, 0.78, swell1);

        // Animated lapping shoreline surf & voxel seafoam bands
        float wavePhase1 = offshore * 0.72 - uTime * 2.15 + swell1 * 2.2;
        float waveBand1 = smoothstep(0.72, 0.96, sin(wavePhase1)) * (1.0 - smoothstep(1.5, 13.5, offshore));
        float shoreLip = 1.0 - smoothstep(0.0, 1.85, offshore);
        float foam = clamp(max(shoreLip * (0.78 + 0.22 * sin(uTime * 2.8 + cellRand * 6.2)), waveBand1 * 0.88), 0.0, 1.0);
        waterCol = mix(waterCol, srgb2lin(246.0, 252.0, 255.0), foam);

        // Sunlit golden-hour ocean sparkles
        float glintNoise = oNoise(wp * 0.42 + vec2(uTime * 0.65, -uTime * 0.48));
        float glint = smoothstep(0.86, 0.97, glintNoise * 0.7 + cellRand * 0.3) * (1.0 - shoreLip * 0.7);
        waterCol += srgb2lin(255.0, 246.0, 214.0) * (glint * 0.34);

        // Seamless atmospheric blend into coastal horizon sky mist
        float distFocus = length(wp - uFocusXZ);
        float horizonMix = smoothstep(240.0, 680.0, distFocus);
        vec3 seaHorizon = srgb2lin(188.0, 224.0, 245.0);
        waterCol = mix(waterCol, seaHorizon, horizonMix);

        gl_FragColor = vec4(waterCol, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function buildCoastalRockMesh(variant = 0) {
  const v = new Vox(940 + variant * 29);
  const cMain = variant % 2 === 0 ? "stone" : "limestone";
  const cDark = "concrete2";
  v.sphere(0, 1.4, 0, 3.4, 2.2, 2.9, cMain);
  v.sphere(2.4, 0.9, 1.3, 2.3, 1.6, 2.1, cDark);
  if (variant % 3 === 0) {
    v.sphere(-2.1, 1.0, -1.1, 2.0, 1.5, 1.9, "moss");
  }
  v.clear(-7, -4, -7, 7, -1, 7);
  return buildVoxelMesh(v, { scale: 0.32 });
}

const sharedRibbonMatCache = new Map();

function getSharedRibbonMaterial(polyOffset) {
  let mat = sharedRibbonMatCache.get(polyOffset);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: polyOffset,
      polygonOffsetUnits: polyOffset * 1.5,
    });
    sharedRibbonMatCache.set(polyOffset, mat);
  }
  return mat;
}

function buildRibbonSliceData(
  curve,
  sampleCount,
  halfWidth,
  yOffset,
  colorHex,
  roundCaps = true,
) {
  const pts = curve.getSpacedPoints(sampleCount);
  const isClosed = Boolean(curve.closed);
  const ringCount = isClosed ? pts.length - 1 : pts.length;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < pts.length; i++) {
    const p = isClosed && i === pts.length - 1 ? pts[0] : pts[i];
    const prev = isClosed
      ? pts[(i - 1 + ringCount) % ringCount]
      : pts[Math.max(0, i - 1)];
    const next = isClosed
      ? pts[(i + 1) % ringCount]
      : pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const rx = -tz * halfWidth;
    const rz = tx * halfWidth;

    positions.push(p.x - rx, yOffset, p.z - rz);
    positions.push(p.x + rx, yOffset, p.z + rz);
    normals.push(0, 1, 0, 0, 1, 0);
    const v = i / Math.max(1, pts.length - 1);
    uvs.push(0, v, 1, v);

    if (i < pts.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  }

  for (const side of [-1, 1]) {
    const sideBase = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const p = isClosed && i === pts.length - 1 ? pts[0] : pts[i];
      const prev = isClosed
        ? pts[(i - 1 + ringCount) % ringCount]
        : pts[Math.max(0, i - 1)];
      const next = isClosed
        ? pts[(i + 1) % ringCount]
        : pts[Math.min(pts.length - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const nx = -tz * side;
      const nz = tx * side;
      const ex = p.x + nx * halfWidth;
      const ez = p.z + nz * halfWidth;

      positions.push(ex, yOffset, ez);
      positions.push(ex, 0, ez);
      normals.push(nx, 0.25, nz, nx, 0.25, nz);
      const v = i / Math.max(1, pts.length - 1);
      uvs.push(v, 1, v, 0);

      if (i < pts.length - 1) {
        const b = sideBase + i * 2;
        if (side === 1) {
          indices.push(b, b + 1, b + 3, b, b + 3, b + 2);
        } else {
          indices.push(b, b + 3, b + 1, b, b + 2, b + 3);
        }
      }
    }
  }

  if (!isClosed && roundCaps && pts.length >= 2) {
    const CAP_SEGS = 8;
    const appendCap = (centerPt, outTx, outTz) => {
      const lx = -outTz;
      const lz = outTx;
      const centerIdx = positions.length / 3;
      positions.push(centerPt.x, yOffset, centerPt.z);
      normals.push(0, 1, 0);
      uvs.push(0.5, 0.5);

      const fanStart = positions.length / 3;
      for (let k = 0; k <= CAP_SEGS; k++) {
        const th = (k / CAP_SEGS) * Math.PI;
        const dx = -lx * Math.cos(th) + outTx * Math.sin(th);
        const dz = -lz * Math.cos(th) + outTz * Math.sin(th);
        positions.push(centerPt.x + dx * halfWidth, yOffset, centerPt.z + dz * halfWidth);
        normals.push(0, 1, 0);
        uvs.push(0.5 + dx * 0.5, 0.5 + dz * 0.5);
      }
      for (let k = 0; k < CAP_SEGS; k++) {
        indices.push(centerIdx, fanStart + k + 1, fanStart + k);
      }

      const skirtStart = positions.length / 3;
      for (let k = 0; k <= CAP_SEGS; k++) {
        const th = (k / CAP_SEGS) * Math.PI;
        const dx = -lx * Math.cos(th) + outTx * Math.sin(th);
        const dz = -lz * Math.cos(th) + outTz * Math.sin(th);
        const ex = centerPt.x + dx * halfWidth;
        const ez = centerPt.z + dz * halfWidth;
        positions.push(ex, yOffset, ez);
        positions.push(ex, 0, ez);
        normals.push(dx, 0.25, dz, dx, 0.25, dz);
        uvs.push(k / CAP_SEGS, 1, k / CAP_SEGS, 0);
      }
      for (let k = 0; k < CAP_SEGS; k++) {
        const b = skirtStart + k * 2;
        indices.push(b, b + 2, b + 3, b, b + 3, b + 1);
      }
    };

    const sDx = pts[0].x - pts[1].x;
    const sDz = pts[0].z - pts[1].z;
    const sLen = Math.hypot(sDx, sDz) || 1;
    appendCap(pts[0], sDx / sLen, sDz / sLen);

    const last = pts.length - 1;
    const eDx = pts[last].x - pts[last - 1].x;
    const eDz = pts[last].z - pts[last - 1].z;
    const eLen = Math.hypot(eDx, eDz) || 1;
    appendCap(pts[last], eDx / eLen, eDz / eLen);
  }

  const col = new THREE.Color(colorHex);
  return {
    positions,
    normals,
    uvs,
    indices,
    r: col.r,
    g: col.g,
    b: col.b,
  };
}

function buildMergedRibbonMesh(slices, polyOffset = -1, receiveShadow = true) {
  if (!slices || slices.length === 0) return null;
  let totalVerts = 0;
  let totalIndices = 0;
  for (const s of slices) {
    totalVerts += s.positions.length / 3;
    totalIndices += s.indices.length;
  }
  if (totalVerts === 0 || totalIndices === 0) return null;

  const posOut = new Float32Array(totalVerts * 3);
  const normOut = new Float32Array(totalVerts * 3);
  const colOut = new Float32Array(totalVerts * 3);
  const uvOut = new Float32Array(totalVerts * 2);
  const idxOut =
    totalVerts <= 65535 ? new Uint16Array(totalIndices) : new Uint32Array(totalIndices);

  let vCur = 0;
  let iCur = 0;
  for (const s of slices) {
    const vCount = s.positions.length / 3;
    posOut.set(s.positions, vCur * 3);
    normOut.set(s.normals, vCur * 3);
    uvOut.set(s.uvs, vCur * 2);
    for (let v = 0; v < vCount; v++) {
      const o3 = (vCur + v) * 3;
      colOut[o3] = s.r;
      colOut[o3 + 1] = s.g;
      colOut[o3 + 2] = s.b;
    }
    for (let k = 0; k < s.indices.length; k++) {
      idxOut[iCur + k] = s.indices[k] + vCur;
    }
    vCur += vCount;
    iCur += s.indices.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posOut, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normOut, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colOut, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvOut, 2));
  geo.setIndex(new THREE.BufferAttribute(idxOut, 1));
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, getSharedRibbonMaterial(polyOffset));
  mesh.receiveShadow = receiveShadow;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.userData.sharedMaterial = true;
  return mesh;
}

function buildMeadowTreeMesh(variant = 0) {
  const v = new Vox(700 + variant * 19);
  v.box(-1, 0, -1, 2, 1, 2, "woodDark");
  v.box(0, 0, 0, 1, 8, 1, variant % 3 === 1 ? "cream" : "woodDark");
  if (variant % 3 === 0) {
    v.sphere(0.5, 11, 0.5, 4.8, 4.2, 4.8, "leaf");
    v.sphere(2.2, 10, 1.5, 3.0, 2.8, 3.0, "leafLight");
    v.sphere(-1.8, 9.5, -1.2, 3.2, 2.6, 3.2, "leafDark");
  } else if (variant % 3 === 1) {
    v.sphere(0.5, 11.5, 0.5, 4.2, 4.6, 4.2, "#f29cb8");
    v.sphere(1.8, 10.2, 1.4, 2.8, 2.6, 2.8, "#fbd0df");
  } else {
    v.cone(0.5, 5, 14, 0.5, 4.2, 0.9, "leafDark");
    v.cone(0.5, 9, 17, 0.5, 3.1, 0.6, "leaf");
  }
  return buildVoxelMesh(v, { scale: 0.28 });
}

function buildMeadowBushMesh(variant = 0) {
  const v = new Vox(820 + variant * 23);
  v.sphere(0, 1.6, 0, 3.2, 2.1, 2.9, variant % 2 === 0 ? "leaf" : "leafDark");
  v.sphere(2.2, 1.3, 1.2, 2.3, 1.7, 2.1, "leafLight");
  v.clear(-6, -4, -6, 6, 0, 6);
  const flowerCol = variant % 3 === 0 ? "#f6d55c" : variant % 3 === 1 ? "#ec8db0" : "#faf3e3";
  v.put(-1, 3, 1, flowerCol);
  v.put(2, 2, 2, flowerCol);
  v.put(0, 3, -1, flowerCol);
  return buildVoxelMesh(v, { scale: 0.24 });
}

function computeBlueprintSignature(bp) {
  if (!bp) return "";
  const opsSig = (bp.ops || []).map((o) => o.op).join(",");
  const partsSig = (bp.parts || [])
    .map((p) => `${p.name}:${p.kind}:${p.phase || 0}:${(p.pivot || []).join(",")}:${(p.ops || []).length}`)
    .join("|");
  return `${bp.category || ""}:${bp.scaleClass || ""}:${bp.interaction?.kind || ""}:${bp.stats?.voxels || 0}:${opsSig}#${partsSig}`;
}

function isDualTransitCreation(creation) {
  if (!creation || creation.behavior?.type !== "vehicle_route") return false;
  if (creation.id === "c-mvpvsf0l-5d0a39") return true;
  const parts = creation.blueprint?.parts || [];
  return parts.some((p) => /^waratah/i.test(p.name)) && parts.some((p) => /^tram/i.test(p.name));
}

function computeRouteBuildingDetour(posX, posZ, rightX, rightZ, baseLane, buildingEntities, selfEnt) {
  let extraOffset = 0;
  for (let i = 0; i < buildingEntities.length; i++) {
    const other = buildingEntities[i];
    if (other === selfEnt) continue;
    if (other.data.category !== "building" && other.data.behavior?.type !== "landmark") continue;
    const box = getBuildingTightBox(other, 0.78);
    const maxHalf = Math.max(box.halfX, box.halfZ);
    const clearPad = 0.88;
    const dx = other.x - posX;
    const dz = other.z - posZ;
    if (Math.abs(dx) > maxHalf + 4.2 || Math.abs(dz) > maxHalf + 4.2) continue;

    const candX = posX + rightX * (baseLane + extraOffset);
    const candZ = posZ + rightZ * (baseLane + extraOffset);
    const bYaw = other.yaw || 0;
    const bFx = Math.sin(bYaw);
    const bFz = Math.cos(bYaw);
    const bRx = -bFz;
    const bRz = bFx;
    const cdx = candX - other.x;
    const cdz = candZ - other.z;
    const lR = Math.abs(cdx * bRx + cdz * bRz) - box.halfX;
    const lF = Math.abs(cdx * bFx + cdz * bFz) - box.halfZ;
    const boxDist = lR > 0 && lF > 0 ? Math.hypot(lR, lF) : Math.max(lR, lF);
    if (boxDist >= clearPad) continue;

    const obsLat = dx * rightX + dz * rightZ;
    const pen = clearPad - boxDist;
    const pushRight = obsLat - baseLane <= 0;
    const needed = Math.max(-1.65, Math.min(1.65, extraOffset + (pushRight ? pen : -pen)));
    if (Math.abs(needed) > Math.abs(extraOffset)) {
      extraOffset = needed;
    }
  }
  return extraOffset;
}

class CreationSimEntity {
  constructor(creation, index = 0, onInteractiveEvent = null, creationsGroup = null) {
    this.id = creation.id;
    this.index = index;
    this.data = creation;
    this.onInteractiveEvent = onInteractiveEvent;
    this.blueprintSig = computeBlueprintSignature(creation.blueprint);
    this.isDualTransit = isDualTransitCreation(creation);
    this.isVegasSphere =
      creation.id === "c-mvoo26uh-4e0810" ||
      /vegas.*sphere|emoji.*sphere/i.test(creation.name || "");
    this.secondaryVehicle = null;

    const isGroundedStaticBuild =
      creation.category !== "aircraft" &&
      creation.category !== "watercraft" &&
      creation.behavior?.type !== "fly_circle" &&
      creation.behavior?.type !== "water_float" &&
      creation.behavior?.type !== "vehicle_route";

    const splitGroups = this.isDualTransit
      ? buildSplitDualVehicleGroups(creation.blueprint, {
          seed: 17 + index * 13,
          useWorldScale: true,
        })
      : null;

    if (splitGroups) {
      this.group = splitGroups.leftGroup;
      this.secondaryVehicle = this.createSecondaryVehicleState(splitGroups.rightGroup);
      if (creationsGroup) {
        creationsGroup.add(this.secondaryVehicle.group);
      }
    } else {
      this.group = buildCreationGroup(creation.blueprint, {
        seed: 17 + index * 13,
        useWorldScale: true,
        cullFloorY: isGroundedStaticBuild ? 0 : null,
      });
    }
    this.group.rotation.order = "YXZ";
    this.group.userData.creationId = this.id;

    this.x = creation.x;
    this.y = 0.004;
    this.z = creation.z;
    this.yaw = creation.yaw || 0;
    this.wheelAngle = 0;
    this.moveFactor = 0;
    this.spawnScale = creation.isSeed ? 1.0 : 0.05;

    const worldUnit = getWorldVoxelSize(creation.scaleClass);
    this.footprintRadius = splitGroups
      ? 3.1
      : getCreationFootprintRadius(
          creation.scaleClass,
          creation.blueprint?.stats?.footprintX ?? 14,
          creation.blueprint?.stats?.footprintZ ?? 14,
        );
    this.topY = Math.max(1.8, (creation.blueprint?.stats?.maxY || 14) * worldUnit);
    this.feedReading = null;
    this.feedBadgeText = "";
    this.feedCanvas = null;
    this.feedTex = null;
    this.feedMesh = null;

    this.routeCurve = null;
    this.routeSignature = "";
    this.routeClosed = true;
    this.routeDir = 1;
    this.routeLength = 1;
    this.routeDist = (index * 37.3) % 120;
    this.effectiveSpeed = splitGroups ? 5.45 : null;
    this.deBunchedOnce = false;
    this.hasSteppedOnce = false;
    this.stopArcPositions = [];
    this.dwellingStop = null;
    this.dwellTimer = 0;
    this.lastStoppedId = null;
    this.currentLaneOffset = splitGroups ? 0.68 : 1.12;
    this.buildingDetourOffset = 0;
    this.smoothVelX = Math.sin(this.yaw);
    this.smoothVelZ = Math.cos(this.yaw);
    this.yieldTimer = 0;
    this.doorX = this.x;
    this.doorZ = this.z;
    this.phys = createVehiclePhysicsState(index);
    const initHull = computeVehicleHullExtents(creation, worldUnit, false, this.isDualTransit);
    this.phys.hw = initHull.hw;
    this.phys.hl = initHull.hl;
    this.phys.mass = initHull.mass;

    this.flightCurve = null;
    this.flightLength = 1;
    this.flightDist = (index * 19.3) % 60;
    this.bankRoll = 0;

    this.wanderIdx = 0;
    this.wanderPause = (index * 1.3) % 2.5;
    this.wanderStuckSec = 0;
    this.wanderCheckX = this.x;
    this.wanderCheckZ = this.z;
    this.wanderAvoidSide = index % 2 === 0 ? 1 : -1;
    this.wanderDirX = Math.sin(this.yaw);
    this.wanderDirZ = Math.cos(this.yaw);
    this.hopPhase = 0;

    this.orbitAngle = (index * 1.9) % (Math.PI * 2);
    this.interactive = null;
    this.staticRootFrozen = false;
    this.batchedInChunk = false;
    this.staticGeoDisposed = false;
    this.shadowEnabled = true;
    this.shadowMeshes = null;
    this.hasActiveFeed = false;
    this.lodAccumDt = 0;

    this.lastSanRawX = NaN;
    this.lastSanRawZ = NaN;
    this.lastSanX = this.x;
    this.lastSanZ = this.z;
    this.lastSanBldCount = -1;
    this.lastSanPondCount = -1;

    // Las Vegas Emoji Sphere eye-tracking & playful spin state
    this.eyeGazeX = 0;
    this.eyeGazeY = 0;
    this.eyeSpinFlourishTimer = 1.35;
    this.lastTrackedCarId = null;
    this.nextAutoSpinAt = 8.5 + (index % 4);

    this.rebuildBehavior(creation, creationsGroup);
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;
    this.group.scale.setScalar(this.spawnScale);
  }

  setShadowEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.shadowEnabled === next) return;
    this.shadowEnabled = next;
    if (!this.shadowMeshes) {
      this.shadowMeshes = [];
      this.group?.traverse?.((o) => {
        if (o.isMesh && o.castShadow) this.shadowMeshes.push(o);
      });
      this.secondaryVehicle?.group?.traverse?.((o) => {
        if (o.isMesh && o.castShadow) this.shadowMeshes.push(o);
      });
    }
    for (let i = 0; i < this.shadowMeshes.length; i++) {
      this.shadowMeshes[i].castShadow = next;
    }
  }

  unfreezeStaticRoot() {
    if (!this.staticRootFrozen) return;
    this.staticRootFrozen = false;
    if (this.group) {
      this.group.matrixAutoUpdate = true;
      for (const ch of this.group.children) {
        if (ch.isMesh) ch.matrixAutoUpdate = true;
      }
    }
  }

  createSecondaryVehicleState(secGroup) {
    secGroup.rotation.order = "YXZ";
    secGroup.userData.creationId = this.id;
    const secPhys = createVehiclePhysicsState(this.index + 31);
    const secHull = computeVehicleHullExtents(
      this.data,
      getWorldVoxelSize(this.data?.scaleClass),
      true,
      true,
    );
    secPhys.hw = secHull.hw;
    secPhys.hl = secHull.hl;
    secPhys.mass = secHull.mass;
    return {
      group: secGroup,
      x: this.data?.x || 0,
      y: 0.092,
      z: this.data?.z || 0,
      yaw: this.data?.yaw || 0,
      speed: 4.35,
      routeDist: 0,
      routeDir: -1,
      initializedDist: false,
      currentLaneOffset: 1.24,
      buildingDetourOffset: 0,
      wheelAngle: 0,
      moveFactor: 1,
      dwellingStop: null,
      dwellTimer: 0,
      lastStoppedId: null,
      phys: secPhys,
    };
  }

  triggerEyeSpinFlourish() {
    if (this.isVegasSphere) {
      this.eyeSpinFlourishTimer = 1.65;
    }
  }

  setLiveFeedReading(reading, maxAniso = 4) {
    this.feedReading = reading || null;
    this.hasActiveFeed = Boolean(reading && reading.badge);
    if (!reading || !reading.badge) {
      if (this.feedMesh) this.feedMesh.visible = false;
      return;
    }
    if (!this.feedMesh) {
      this.unfreezeStaticRoot();
      this.feedCanvas = document.createElement("canvas");
      this.feedCanvas.width = 512;
      this.feedCanvas.height = 116;
      this.feedTex = new THREE.CanvasTexture(this.feedCanvas);
      this.feedTex.colorSpace = THREE.SRGBColorSpace;
      this.feedTex.anisotropy = Math.min(8, maxAniso);
      const geo = new THREE.PlaneGeometry(4.2, 0.95);
      const mat = new THREE.MeshBasicMaterial({
        map: this.feedTex,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.feedMesh = new THREE.Mesh(geo, mat);
      this.feedMesh.position.set(0, this.topY + 1.15, 0);
      this.group.add(this.feedMesh);
    }
    this.feedMesh.visible = true;
    const key = `${reading.kind}:${reading.badge}`;
    if (key !== this.feedBadgeText) {
      this.feedBadgeText = key;
      drawFeedBadgeCanvas(this.feedCanvas, reading);
      this.feedTex.needsUpdate = true;
    }
  }

  rebuildBehavior(creation, creationsGroup = null) {
    this.unfreezeStaticRoot();
    this.lastSanRawX = NaN;
    const wasStationary = this.data?.behavior?.type === "landmark";
    this.data = creation;
    this.isDualTransit = isDualTransitCreation(creation);
    this.isVegasSphere =
      creation.id === "c-mvoo26uh-4e0810" ||
      /vegas.*sphere|emoji.*sphere/i.test(creation.name || "");
    this.footprintRadius = this.isDualTransit
      ? 3.1
      : getCreationFootprintRadius(
          creation.scaleClass,
          creation.blueprint?.stats?.footprintX ?? 14,
          creation.blueprint?.stats?.footprintZ ?? 14,
        );
    if (wasStationary && creation.behavior?.type === "landmark") {
      this.x = creation.x;
      this.z = creation.z;
      this.yaw =
        typeof creation.behavior.facingYaw === "number"
          ? creation.behavior.facingYaw
          : creation.yaw || 0;
    }
    const nextSig = computeBlueprintSignature(creation.blueprint);
    let rebuiltGroup = false;
    const needsUnbatchRestore =
      this.batchedInChunk &&
      this.staticGeoDisposed &&
      (nextSig !== this.blueprintSig || Boolean(creation.blueprint?.interaction?.kind));
    if (creationsGroup && ((nextSig && nextSig !== this.blueprintSig) || needsUnbatchRestore)) {
      rebuiltGroup = true;
      this.blueprintSig = nextSig;
      this.batchedInChunk = false;
      this.staticGeoDisposed = false;
      this.shadowMeshes = null;
      this.interactive?.dispose?.();
      this.interactive = null;
      if (this.feedMesh) {
        this.group.remove(this.feedMesh);
      }
      creationsGroup.remove(this.group);
      this.group.userData.dispose?.();
      if (this.secondaryVehicle) {
        creationsGroup.remove(this.secondaryVehicle.group);
        this.secondaryVehicle.group.userData.dispose?.();
        this.secondaryVehicle = null;
      }
      const isGroundedStaticBuild =
        creation.category !== "aircraft" &&
        creation.category !== "watercraft" &&
        creation.behavior?.type !== "fly_circle" &&
        creation.behavior?.type !== "water_float" &&
        creation.behavior?.type !== "vehicle_route";
      const splitGroups = this.isDualTransit
        ? buildSplitDualVehicleGroups(creation.blueprint, {
            seed: 17 + this.index * 13,
            useWorldScale: true,
          })
        : null;
      if (splitGroups) {
        this.group = splitGroups.leftGroup;
        this.effectiveSpeed = 5.45;
        this.secondaryVehicle = this.createSecondaryVehicleState(splitGroups.rightGroup);
        creationsGroup.add(this.secondaryVehicle.group);
      } else {
        this.group = buildCreationGroup(creation.blueprint, {
          seed: 17 + this.index * 13,
          useWorldScale: true,
          cullFloorY: isGroundedStaticBuild ? 0 : null,
        });
      }
      this.group.rotation.order = "YXZ";
      this.group.userData.creationId = this.id;
      const worldUnit = getWorldVoxelSize(creation.scaleClass);
      this.topY = Math.max(1.8, (creation.blueprint?.stats?.maxY || 14) * worldUnit);
      if (this.feedMesh) {
        this.feedMesh.position.set(0, this.topY + 1.15, 0);
        this.group.add(this.feedMesh);
      }
      this.group.position.set(this.x, this.y, this.z);
      this.group.rotation.y = this.yaw;
      creationsGroup.add(this.group);
    } else if (creationsGroup && this.secondaryVehicle && !this.secondaryVehicle.group.parent) {
      creationsGroup.add(this.secondaryVehicle.group);
    }
    const desiredInteractionKind = creation.blueprint?.interaction?.kind || null;
    if (!this.interactive || rebuiltGroup || this.interactive.kind !== desiredInteractionKind) {
      this.interactive?.dispose?.();
      this.interactive = createInteractiveController(creation, this.group, (msg) => {
        this.onInteractiveEvent?.(this.data, msg);
      });
    }
    if (this.interactive?.extraRadius > 0) {
      this.footprintRadius = Math.max(this.footprintRadius, this.interactive.extraRadius);
    }
    const b = creation.behavior;
    const rebuildVoxUnit = getWorldVoxelSize(creation.scaleClass);
    const nextHull = computeVehicleHullExtents(creation, rebuildVoxUnit, false, this.isDualTransit);
    this.phys.hw = nextHull.hw;
    this.phys.hl = nextHull.hl;
    this.phys.mass = nextHull.mass;
    if (this.secondaryVehicle?.phys) {
      const secHull = computeVehicleHullExtents(creation, rebuildVoxUnit, true, true);
      this.secondaryVehicle.phys.hw = secHull.hw;
      this.secondaryVehicle.phys.hl = secHull.hl;
      this.secondaryVehicle.phys.mass = secHull.mass;
    }

    const hadRoute = Boolean(this.routeCurve);
    const isPingPong = b?.loopMode === "pingpong";
    const minRouteWps = isPingPong ? 2 : 3;
    if (b?.type === "vehicle_route" && Array.isArray(b.waypoints) && b.waypoints.length >= minRouteWps) {
      const nextRouteSig = JSON.stringify({
        loopMode: b.loopMode || "loop",
        waypoints: b.waypoints,
        stops: b.stops || [],
      });

      // Preserve active driving pose, routeDist, and any ongoing turnaround untouched if route geometry did not change!
      if (!hadRoute || nextRouteSig !== this.routeSignature) {
        this.routeSignature = nextRouteSig;
        const vecs = b.waypoints.map(([wx, wz]) => new THREE.Vector3(wx, 0, wz));
        this.routeClosed = !isPingPong;
        this.routeCurve = new THREE.CatmullRomCurve3(vecs, this.routeClosed, "centripetal", 0.5);
        this.routeLength = Math.max(4, this.routeCurve.getLength());

        const samples = 160;
        this.stopArcPositions = (b.stops || []).map((stop) => {
          let bestU = 0;
          let bestD = Infinity;
          for (let i = 0; i <= samples; i++) {
            const u = i / samples;
            const pt = this.routeCurve.getPointAt(u);
            const d = Math.hypot(pt.x - stop.x, pt.z - stop.z);
            if (d < bestD) {
              bestD = d;
              bestU = u;
            }
          }
          return { stop, distOnCurve: bestU * this.routeLength };
        });

        if (hadRoute) {
          // Grounded local re-projection onto updated nearby curve — NEVER teleport (x, z, yaw)!
          let bestU = 0;
          let bestD = Infinity;
          for (let s = 0; s <= 160; s++) {
            const u = s / 160;
            const pt = this.routeCurve.getPointAt(u);
            const d = Math.hypot(pt.x - this.x, pt.z - this.z);
            if (d < bestD) {
              bestD = d;
              bestU = u;
            }
          }
          const targetDist = this.routeClosed
            ? bestU * this.routeLength
            : Math.max(0.8, Math.min(this.routeLength - 0.8, bestU * this.routeLength));
          this.routeDist = targetDist;
          if (!this.routeClosed) {
            const tan = this.routeCurve.getTangentAt(bestU);
            const curFx = Math.sin(this.yaw);
            const curFz = Math.cos(this.yaw);
            this.routeDir = curFx * tan.x + curFz * tan.z >= 0 ? 1 : -1;
          }
          this.y = 0.092;
        } else {
          this.routeDist = this.routeClosed
            ? this.routeDist % this.routeLength
            : Math.max(0.8, Math.min(this.routeLength - 0.8, this.routeDist % this.routeLength));
          if (this.secondaryVehicle && !this.secondaryVehicle.initializedDist) {
            this.secondaryVehicle.routeDist = this.routeClosed
              ? (this.routeDist + this.routeLength * 0.5) % this.routeLength
              : Math.max(0.8, this.routeLength * 0.82);
            this.secondaryVehicle.routeDir = -1;
            this.secondaryVehicle.initializedDist = true;
          }
          this.syncVehiclePoseToRoute();
        }
      }
    } else {
      this.routeCurve = null;
      this.routeSignature = "";
      this.dwellingStop = null;
      this.phys.turnState = null;
      this.phys.pendingTurnAtEnd = null;
    }

    if (b?.type === "fly_circle" && Array.isArray(b.waypoints) && b.waypoints.length >= 3) {
      const defaultAlt = b.altitude || 14.0;
      const vecs = b.waypoints.map((wp) =>
        wp.length >= 3
          ? new THREE.Vector3(wp[0], wp[1], wp[2])
          : new THREE.Vector3(wp[0], defaultAlt, wp[1]),
      );
      this.flightCurve = new THREE.CatmullRomCurve3(vecs, true, "centripetal", 0.5);
      this.flightLength = Math.max(12, this.flightCurve.getLength());
      this.flightDist = this.flightDist % this.flightLength;
    } else {
      this.flightCurve = null;
    }
  }

  sanitizeWanderTarget(rawX, rawZ, selfPad, isGlide, ponds, allEntities) {
    const bldCount = allEntities ? allEntities.length : 0;
    const pondCount = ponds ? ponds.length : 0;
    if (
      Math.abs(rawX - this.lastSanRawX) < 0.05 &&
      Math.abs(rawZ - this.lastSanRawZ) < 0.05 &&
      bldCount === this.lastSanBldCount &&
      pondCount === this.lastSanPondCount
    ) {
      return [this.lastSanX, this.lastSanZ];
    }

    let [tx, tz] = clampPointToIsland(rawX, rawZ, selfPad + 2.4);
    for (let pass = 0; pass < 2; pass++) {
      // Town signboard
      {
        const clearR = 2.95 + selfPad;
        const dx = tx - CITY_SIGN_POS[0];
        const dz = tz - CITY_SIGN_POS[1];
        const d = Math.hypot(dx, dz);
        if (d < clearR) {
          const ang = d > 0.01 ? Math.atan2(dz, dx) : (this.index * 2.399) % (Math.PI * 2);
          tx = CITY_SIGN_POS[0] + Math.cos(ang) * clearR;
          tz = CITY_SIGN_POS[1] + Math.sin(ang) * clearR;
        }
      }
      if (!isGlide) {
        for (const pond of ponds) {
          const pr = (pond.radius || 6.4) + selfPad * 0.6 + 1.05;
          const dx = tx - pond.x;
          const dz = tz - pond.z;
          const d = Math.hypot(dx, dz);
          if (d < pr) {
            const ang = d > 0.01 ? Math.atan2(dz, dx) : (this.index * 2.399) % (Math.PI * 2);
            tx = pond.x + Math.cos(ang) * pr;
            tz = pond.z + Math.sin(ang) * pr;
          }
        }
      }
      for (const other of allEntities) {
        if (other === this) continue;
        if (other.data.category !== "building" && other.data.behavior?.type !== "landmark") continue;
        const br = (other.footprintRadius || 3.4) * 0.76 + selfPad + 0.65;
        const dx = tx - other.x;
        const dz = tz - other.z;
        const d = Math.hypot(dx, dz);
        if (d < br) {
          const ang = d > 0.01 ? Math.atan2(dz, dx) : (this.index * 2.399) % (Math.PI * 2);
          tx = other.x + Math.cos(ang) * br;
          tz = other.z + Math.sin(ang) * br;
        }
      }
      [tx, tz] = clampPointToIsland(tx, tz, selfPad + 2.0);
    }

    this.lastSanRawX = rawX;
    this.lastSanRawZ = rawZ;
    this.lastSanX = tx;
    this.lastSanZ = tz;
    this.lastSanBldCount = bldCount;
    this.lastSanPondCount = pondCount;
    return [tx, tz];
  }

  syncVehiclePoseToRoute() {
    if (!this.routeCurve) return;
    const syncUnit = (veh, baseLane) => {
      const u = this.routeClosed
        ? (((veh.routeDist % this.routeLength) + this.routeLength) % this.routeLength) /
          this.routeLength
        : Math.max(0.004, Math.min(0.996, veh.routeDist / this.routeLength));
      const pos = this.routeCurve.getPointAt(u);
      const tan = this.routeCurve.getTangentAt(u);
      const dirSign = this.routeClosed ? 1 : veh.routeDir || 1;
      const yaw = Math.atan2(tan.x * dirSign, tan.z * dirSign);
      const rightX = -Math.cos(yaw);
      const rightZ = Math.sin(yaw);
      veh.currentLaneOffset = baseLane;
      veh.x = pos.x + rightX * baseLane;
      veh.z = pos.z + rightZ * baseLane;
      veh.y = 0.092;
      veh.yaw = yaw;
      if (veh === this) {
        this.smoothVelX = Math.sin(yaw);
        this.smoothVelZ = Math.cos(yaw);
      }
      if (veh.phys) {
        veh.phys.turnState = null;
        veh.phys.pendingTurnAtEnd = null;
        veh.phys.currentSpeed = 0;
        veh.phys.frameStartX = veh.x;
        veh.phys.frameStartZ = veh.z;
        veh.phys.anchorX = veh.x;
        veh.phys.anchorZ = veh.z;
      }
    };
    syncUnit(this, this.isDualTransit ? 0.68 : 1.12);
    if (this.secondaryVehicle) {
      syncUnit(this.secondaryVehicle, 1.24);
    }
  }

  stepVehicleUnitKinematics(veh, isSecondary, dt, t, vehiclePeers, buildingPeers, ponds) {
    if (!this.routeCurve) return;
    this.hasSteppedOnce = true;

    const safeDt = Math.max(0.001, Math.min(0.05, dt || 0.016));
    const phys = veh.phys;
    const prevX = veh.x;
    const prevZ = veh.z;
    phys.frameStartX = prevX;
    phys.frameStartZ = prevZ;

    const unitId = isSecondary ? `${this.id}#sec` : this.id;
    const cruiseLane = isSecondary ? 1.24 : this.isDualTransit ? 0.68 : 1.12;
    const baseSpeed = isSecondary
      ? veh.speed || 4.35
      : this.effectiveSpeed || this.data?.behavior?.speed || 5.5;

    // 1. Active Smooth End-of-Route Turnaround (U-turn or 3-point K-turn — strictly <= 0.65 * baseSpeed!)
    if (phys.turnState) {
      const advice = computeProactiveTrafficControl({
        selfUnitId: unitId,
        x: veh.x,
        z: veh.z,
        yaw: veh.yaw,
        cruiseLane,
        hw: phys.hw,
        hl: phys.hl,
        speed: baseSpeed * 0.5,
        pullingOver: false,
        isSeed: Boolean(this.data?.isSeed),
        phys,
        vehicleEntities: vehiclePeers,
        buildingPeers,
        ponds,
        selfEnt: this,
        citySignPos: CITY_SIGN_POS,
        clampPointToIslandFn: clampPointToIsland,
        dt: safeDt,
      });
      const dtTurn = safeDt * Math.max(0.15, Math.min(1.0, advice.speedScale));
      const tp = stepVehicleTurnaround(phys.turnState, dtTurn);
      let nx = tp.x;
      let nz = tp.z;
      const maxTurnStep = baseSpeed * 0.68 * safeDt;
      const rawStep = Math.hypot(nx - prevX, nz - prevZ);
      if (rawStep > maxTurnStep && rawStep > 1e-6) {
        const s = maxTurnStep / rawStep;
        nx = prevX + (nx - prevX) * s;
        nz = prevZ + (nz - prevZ) * s;
      }
      veh.x = nx;
      veh.z = nz;
      veh.y = 0.092;
      let dTurnYaw = tp.yaw - veh.yaw;
      while (dTurnYaw > Math.PI) dTurnYaw -= Math.PI * 2;
      while (dTurnYaw < -Math.PI) dTurnYaw += Math.PI * 2;
      const maxTurnYawStep = safeDt * 2.45;
      veh.yaw += Math.max(-maxTurnYawStep, Math.min(maxTurnYawStep, dTurnYaw));
      const stepArc = Math.hypot(veh.x - prevX, veh.z - prevZ);
      phys.currentSpeed = stepArc / safeDt;
      veh.wheelAngle += (tp.gear * stepArc) / 0.62;
      veh.moveFactor = tp.speedFactor;
      phys.turnBankRoll = tp.steerRoll;

      if (veh === this) {
        this.smoothVelX = Math.sin(veh.yaw);
        this.smoothVelZ = Math.cos(veh.yaw);
      }

      if (tp.done && Math.abs(dTurnYaw) <= 0.18) {
        veh.routeDir = phys.turnState.nextDir;
        veh.routeDist = phys.turnState.nextRouteDist;
        veh.currentLaneOffset = phys.turnState.nextLaneOffset;
        veh.buildingDetourOffset = 0;
        phys.currentSpeed = Math.min(baseSpeed * 0.35, phys.currentSpeed);
        phys.turnBankRoll = 0;
        phys.turnState = null;
      }
      return;
    }

    phys.turnBankRoll *= Math.exp(-safeDt * 8.0);

    // 2. Scheduled Stop Dwell (stays facing arrival direction; launches turnaround AFTER dwell if at terminus!)
    if (veh.dwellingStop) {
      veh.dwellTimer -= safeDt;
      veh.moveFactor = 0;
      phys.currentSpeed = 0;
      phys.vx = 0;
      phys.vz = 0;
      if (veh === this) this.yieldTimer = 0;
      if (veh.dwellTimer <= 0) {
        veh.lastStoppedId = veh.dwellingStop.id;
        veh.dwellingStop = null;
        if (phys.pendingTurnAtEnd && !this.routeClosed) {
          const whichEnd = phys.pendingTurnAtEnd;
          phys.pendingTurnAtEnd = null;
          phys.turnState = planVehicleTurnaround({
            routeCurve: this.routeCurve,
            routeLength: this.routeLength,
            whichEnd,
            curX: veh.x,
            curZ: veh.z,
            curYaw: veh.yaw,
            curLaneOffset: veh.currentLaneOffset,
            targetReturnLane: cruiseLane,
            hw: phys.hw,
            hl: phys.hl,
            speed: baseSpeed,
            buildingPeers,
            ponds,
            selfEnt: this,
            citySignPos: CITY_SIGN_POS,
            clampPointToIslandFn: clampPointToIsland,
          });
          return;
        }
      } else {
        veh.y = 0.092;
        return;
      }
    }

    // 3. Position-Authoritative Pure-Pursuit Follower (NEVER speeds up above baseSpeed!)
    let targetLane = cruiseLane;
    let speedScale = 1.0;
    let pullingOver = false;

    for (let i = 0; i < this.stopArcPositions.length; i++) {
      const sp = this.stopArcPositions[i];
      let ahead = this.routeClosed
        ? sp.distOnCurve - veh.routeDist
        : (sp.distOnCurve - veh.routeDist) * veh.routeDir;
      if (this.routeClosed) {
        if (ahead < -this.routeLength * 0.5) ahead += this.routeLength;
        if (ahead > this.routeLength * 0.5) ahead -= this.routeLength;
      }

      if (Math.abs(ahead) > 5.0 && veh.lastStoppedId === sp.stop.id) {
        veh.lastStoppedId = null;
      }
      const worldDistToStop = Math.hypot(sp.stop.x - veh.x, sp.stop.z - veh.z);
      if (
        sp.stop.id !== veh.lastStoppedId &&
        ahead >= -0.6 &&
        ahead < 5.2 &&
        worldDistToStop < 7.5
      ) {
        pullingOver = true;
        speedScale = Math.min(speedScale, Math.max(0.22, ahead / 5.2));
        if (ahead <= 0.55 || worldDistToStop <= 1.65) {
          veh.routeDist = sp.distOnCurve;
          veh.dwellingStop = sp.stop;
          veh.dwellTimer = Math.min(2.2, sp.stop.dwellSec || 1.7);
          if (!this.routeClosed) {
            if (veh.routeDir > 0 && sp.distOnCurve >= this.routeLength - 2.8) {
              phys.pendingTurnAtEnd = "end";
            } else if (veh.routeDir < 0 && sp.distOnCurve <= 2.8) {
              phys.pendingTurnAtEnd = "start";
            }
          }
          veh.moveFactor = 0;
          phys.currentSpeed = 0;
          phys.vx = 0;
          phys.vz = 0;
          return;
        }
      }
    }

    if (pullingOver) {
      targetLane = 1.62;
    } else if (this.secondaryVehicle) {
      const sv = this.secondaryVehicle;
      const sameDir = this.routeClosed || sv.routeDir === this.routeDir;
      if (sameDir && Math.hypot(sv.x - this.x, sv.z - this.z) < 13.5) {
        targetLane = isSecondary ? 1.6 : 0.16;
      }
    }

    const advice = computeProactiveTrafficControl({
      selfUnitId: unitId,
      x: veh.x,
      z: veh.z,
      yaw: veh.yaw,
      cruiseLane,
      hw: phys.hw,
      hl: phys.hl,
      speed: baseSpeed,
      pullingOver,
      isSeed: Boolean(this.data?.isSeed),
      phys,
      vehicleEntities: vehiclePeers,
      buildingPeers,
      ponds,
      selfEnt: this,
      citySignPos: CITY_SIGN_POS,
      clampPointToIslandFn: clampPointToIsland,
      dt: safeDt,
    });

    speedScale = Math.max(0, Math.min(1.0, Math.min(speedScale, advice.speedScale)));
    targetLane = Math.max(-2.25, Math.min(2.65, targetLane + advice.extraLaneOffset));

    if (veh === this) {
      this.yieldTimer = advice.yielding
        ? this.yieldTimer + safeDt
        : Math.max(0, this.yieldTimer - safeDt * 2.0);
    }

    // Smoothly accelerate (<= 4.2 m/s²) and brake (<= 9.2 m/s²), strictly capped at baseSpeed!
    const desiredSpeed = baseSpeed * speedScale;
    const prevSpd = Number.isFinite(phys.currentSpeed) ? phys.currentSpeed : 0;
    if (desiredSpeed >= prevSpd) {
      phys.currentSpeed = Math.min(baseSpeed, Math.min(desiredSpeed, prevSpd + 4.2 * safeDt));
    } else {
      phys.currentSpeed = Math.max(0, Math.max(desiredSpeed, prevSpd - 9.2 * safeDt));
    }

    // Calm rate-limited lane change (<= 1.65 m/s lateral shift rate)
    const laneErr = targetLane - veh.currentLaneOffset;
    const maxLaneStep = 1.65 * safeDt;
    veh.currentLaneOffset += Math.max(-maxLaneStep, Math.min(maxLaneStep, laneErr * Math.min(1, safeDt * 4.2)));

    // Pure-pursuit carrot target 2.85m ahead along the route curve
    const endStopMargin = 0.75;
    const carrotLookAhead = 2.85;
    const dirSign = this.routeClosed ? 1 : veh.routeDir || 1;
    let carrotDist = veh.routeDist + dirSign * carrotLookAhead;
    let carrotAtTerminus = false;
    if (this.routeClosed) {
      carrotDist = (((carrotDist % this.routeLength) + this.routeLength) % this.routeLength);
    } else {
      if (dirSign > 0 && carrotDist >= this.routeLength - endStopMargin) {
        carrotDist = this.routeLength - endStopMargin;
        carrotAtTerminus = true;
      } else if (dirSign < 0 && carrotDist <= endStopMargin) {
        carrotDist = endStopMargin;
        carrotAtTerminus = true;
      } else {
        carrotDist = Math.max(endStopMargin, Math.min(this.routeLength - endStopMargin, carrotDist));
      }
    }

    const uCarrot = this.routeClosed
      ? carrotDist / this.routeLength
      : Math.max(0.002, Math.min(0.998, carrotDist / this.routeLength));
    const carrotPt = this.routeCurve.getPointAt(uCarrot);
    const carrotTan = this.routeCurve.getTangentAt(uCarrot);
    const carrotYaw = Math.atan2(carrotTan.x * dirSign, carrotTan.z * dirSign);
    const carrotRx = -Math.cos(carrotYaw);
    const carrotRz = Math.sin(carrotYaw);

    const detourTarget = computeRouteBuildingDetour(
      carrotPt.x,
      carrotPt.z,
      carrotRx,
      carrotRz,
      veh.currentLaneOffset,
      buildingPeers,
      this,
    );
    const detErr = detourTarget - veh.buildingDetourOffset;
    veh.buildingDetourOffset += Math.max(
      -maxLaneStep,
      Math.min(maxLaneStep, detErr * Math.min(1, safeDt * 4.2)),
    );
    const totalLane = Math.max(-3.0, Math.min(3.0, veh.currentLaneOffset + veh.buildingDetourOffset));

    const goalX = carrotPt.x + carrotRx * totalLane;
    const goalZ = carrotPt.z + carrotRz * totalLane;
    const gx = goalX - veh.x;
    const gz = goalZ - veh.z;
    const gDist = Math.hypot(gx, gz);

    // Smooth steering toward carrot goal (NEVER computed from post-collision rebound!)
    const desiredYaw = gDist > 0.22 ? Math.atan2(gx, gz) : carrotYaw;
    let dYaw = desiredYaw - veh.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const speedRatio = baseSpeed > 0.1 ? phys.currentSpeed / baseSpeed : 0;
    const maxYawStep = safeDt * 2.35 * (0.18 + 0.82 * speedRatio);
    veh.yaw += Math.max(-maxYawStep, Math.min(maxYawStep, dYaw * Math.min(1, safeDt * 6.5)));

    // Step world position strictly <= phys.currentSpeed * safeDt <= baseSpeed * safeDt
    const stepLen = gDist > 1e-4 ? Math.min(gDist, phys.currentSpeed * safeDt) : 0;
    if (stepLen > 1e-6 && gDist > 1e-4) {
      const hdgX = Math.sin(veh.yaw);
      const hdgZ = Math.cos(veh.yaw);
      const cUx = gx / gDist;
      const cUz = gz / gDist;
      let moveUx = hdgX * 0.65 + cUx * 0.35;
      let moveUz = hdgZ * 0.65 + cUz * 0.35;
      const mLen = Math.hypot(moveUx, moveUz) || 1;
      moveUx /= mLen;
      moveUz /= mLen;
      veh.x += moveUx * stepLen;
      veh.z += moveUz * stepLen;
    }
    veh.y = 0.092;

    if (veh === this) {
      this.smoothVelX = Math.sin(veh.yaw);
      this.smoothVelZ = Math.cos(veh.yaw);
    }

    veh.wheelAngle += stepLen / 0.62;
    veh.moveFactor = speedRatio;

    // Advance routeDist locally ONLY as (veh.x, veh.z) actually progresses past refPt (zero wind-up / slingshot!)
    const uRef = this.routeClosed
      ? (((veh.routeDist % this.routeLength) + this.routeLength) % this.routeLength) / this.routeLength
      : Math.max(0.002, Math.min(0.998, veh.routeDist / this.routeLength));
    const refPt = this.routeCurve.getPointAt(uRef);
    const refTan = this.routeCurve.getTangentAt(uRef);
    const refFx = refTan.x * dirSign;
    const refFz = refTan.z * dirSign;
    const alongRef = (veh.x - refPt.x) * refFx + (veh.z - refPt.z) * refFz;
    if (alongRef > 0) {
      const ds = Math.min(alongRef, baseSpeed * safeDt * 1.32);
      if (this.routeClosed) {
        veh.routeDist = (((veh.routeDist + ds) % this.routeLength) + this.routeLength) % this.routeLength;
      } else {
        veh.routeDist = Math.max(
          endStopMargin,
          Math.min(this.routeLength - endStopMargin, veh.routeDist + dirSign * ds),
        );
      }
    }

    // Check smooth arrival at open-route terminus
    let reachedTerminus = null;
    if (!this.routeClosed && carrotAtTerminus && gDist <= 0.6) {
      if (dirSign > 0) {
        veh.routeDist = this.routeLength - endStopMargin;
        reachedTerminus = "end";
      } else {
        veh.routeDist = endStopMargin;
        reachedTerminus = "start";
      }
    }

    if (reachedTerminus) {
      const termStop =
        reachedTerminus === "end"
          ? this.stopArcPositions.find((s) => s.distOnCurve >= this.routeLength - 3.0)
          : this.stopArcPositions.find((s) => s.distOnCurve <= 3.0);
      if (termStop && termStop.stop.id !== veh.lastStoppedId) {
        veh.dwellingStop = {
          ...termStop.stop,
          dwellSec: Math.min(2.0, termStop.stop.dwellSec || 1.5),
        };
        veh.dwellTimer = veh.dwellingStop.dwellSec || 1.5;
        veh.moveFactor = 0;
        phys.currentSpeed = 0;
        phys.pendingTurnAtEnd = reachedTerminus;
      } else {
        phys.turnState = planVehicleTurnaround({
          routeCurve: this.routeCurve,
          routeLength: this.routeLength,
          whichEnd: reachedTerminus,
          curX: veh.x,
          curZ: veh.z,
          curYaw: veh.yaw,
          curLaneOffset: totalLane,
          targetReturnLane: cruiseLane,
          hw: phys.hw,
          hl: phys.hl,
          speed: baseSpeed,
          buildingPeers,
          ponds,
          selfEnt: this,
          citySignPos: CITY_SIGN_POS,
          clampPointToIslandFn: clampPointToIsland,
        });
      }
    }
  }

  stepSecondaryVehicle(dt, t, buildingPeers, vehiclePeers, ponds, popEase) {
    const sv = this.secondaryVehicle;
    if (!sv || !this.routeCurve) return;
    this.stepVehicleUnitKinematics(sv, true, dt, t, vehiclePeers, buildingPeers, ponds);
    const secPitch =
      (sv.dwellingStop && !sv.phys?.turnState ? 0 : Math.sin(t * 13 + 1.4) * 0.007 * Math.abs(sv.moveFactor || 0)) +
      (sv.phys?.clashPitch || 0);
    const secRoll = (sv.phys?.turnBankRoll || 0) + (sv.phys?.clashRoll || 0);
    sv.group.position.set(sv.x, sv.y, sv.z);
    sv.group.rotation.set(secPitch, sv.yaw, secRoll);
    sv.group.scale.setScalar(popEase);
    sv.group.userData.animate?.(t, {
      wheelAngle: sv.wheelAngle,
      moveFactor: sv.moveFactor,
    });
  }

  updateVegasSphereEyes(dt, t, allEntities) {
    const pivots = this.group.userData?.partPivots;
    const leftEye = pivots?.["pupil-left"];
    const rightEye = pivots?.["pupil-right"];
    if (!leftEye || !rightEye) return;

    const voxScale = leftEye.voxScale || 0.43;
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const eyeWorldY = this.y + 21.8 * voxScale;

    // Gather all active road vehicles (including split secondary transit vehicles)
    let bestCar = null;
    let bestScore = Infinity;
    for (const ent of allEntities) {
      if (ent === this || ent.data.behavior?.type !== "vehicle_route") continue;
      const candidates = [{ id: ent.id, x: ent.x, y: ent.y || 0.5, z: ent.z, move: ent.moveFactor ?? 1 }];
      if (ent.secondaryVehicle) {
        candidates.push({
          id: `${ent.id}#tram`,
          x: ent.secondaryVehicle.x,
          y: ent.secondaryVehicle.y || 0.5,
          z: ent.secondaryVehicle.z,
          move: ent.secondaryVehicle.moveFactor ?? 1,
        });
      }
      for (const c of candidates) {
        const dx = c.x - this.x;
        const dz = c.z - this.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 102 || dist < 1) continue;
        // Convert world offset into Sphere local coordinates (+Z = front face, +X = Sphere's right/North)
        const lx = dx * cosY - dz * sinY;
        const lz = dx * sinY + dz * cosY;
        if (lz < -8) continue;
        const movingBonus = c.move > 0.08 ? 0.68 : 1.18;
        const frontBonus = lz > 8 ? 0.85 : 1.15;
        const score = dist * movingBonus * frontBonus;
        if (score < bestScore) {
          bestScore = score;
          bestCar = { ...c, dist, lx, lz };
        }
      }
    }

    // Trigger a playful 360° eye-roll flourish when switching tracked cars or every ~10.5s
    if (bestCar && bestCar.id !== this.lastTrackedCarId) {
      if (this.lastTrackedCarId !== null && this.eyeSpinFlourishTimer <= 0) {
        this.eyeSpinFlourishTimer = 0.95;
      }
      this.lastTrackedCarId = bestCar.id;
    }
    if (t >= this.nextAutoSpinAt) {
      this.eyeSpinFlourishTimer = Math.max(this.eyeSpinFlourishTimer, 1.15);
      this.nextAutoSpinAt = t + 9.5 + Math.sin(t * 0.7) * 2.0;
    }
    if (this.eyeSpinFlourishTimer > 0) {
      this.eyeSpinFlourishTimer = Math.max(0, this.eyeSpinFlourishTimer - dt);
    }

    // Playful spinning / looking-around gaze vector
    const spinAngle = t * 3.85;
    const wanderGx = Math.cos(t * 1.45) * 0.72 + Math.sin(t * 3.1) * 0.28;
    const wanderGy = Math.sin(t * 1.85) * 0.62 + Math.cos(t * 2.7) * 0.25;
    const flourishSpinGx = Math.cos(spinAngle) * 0.95;
    const flourishSpinGy = Math.sin(spinAngle) * 0.92;

    let targetGx = wanderGx;
    let targetGy = wanderGy;
    let pupilRollZ = Math.sin(t * 2.4) * 0.28;

    if (bestCar && bestCar.dist < 88) {
      const carHoriz = Math.max(11.0, Math.abs(bestCar.lz) * 0.68 + 4.0);
      const carGx = Math.max(-1, Math.min(1, (bestCar.lx / carHoriz) * 1.22));
      const carVert = (bestCar.y + 1.2 - eyeWorldY) / Math.max(14.0, bestCar.dist * 0.48);
      const carGy = Math.max(-0.92, Math.min(0.82, carVert * 1.35 + 0.08));

      // Blend smoothly: close moving road cars command crisp tracking; distant/stopped cars mix in curious eye rolls
      const trackWeight =
        bestCar.move > 0.05
          ? Math.max(0.25, Math.min(1.0, 1.0 - Math.max(0, bestCar.dist - 58) / 30))
          : 0.55;
      targetGx = wanderGx * (1 - trackWeight) + carGx * trackWeight;
      targetGy = wanderGy * (1 - trackWeight) + carGy * trackWeight;
      pupilRollZ = carGx * -0.22;
    }

    if (this.eyeSpinFlourishTimer > 0) {
      const w = Math.min(1, this.eyeSpinFlourishTimer / 0.35);
      targetGx = targetGx * (1 - w) + flourishSpinGx * w;
      targetGy = targetGy * (1 - w) + flourishSpinGy * w;
      pupilRollZ = spinAngle;
    }

    const damp = Math.min(1, dt * (this.eyeSpinFlourishTimer > 0 ? 14.0 : 8.2));
    this.eyeGazeX += (targetGx - this.eyeGazeX) * damp;
    this.eyeGazeY += (targetGy - this.eyeGazeY) * damp;

    // Position left & right pupils cleanly across the curved sclera (`eyeWhite` spheres at cx=-5.5 / +4.5, cy=21.9, cz=14.8..17.8)
    const applyEye = (eyeInfo, scleraCx, scleraCy, rxMax, ryMax, convergeSign) => {
      const gx = Math.max(-1.02, Math.min(1.02, this.eyeGazeX + convergeSign * 0.06));
      const gy = Math.max(-1.0, Math.min(1.0, this.eyeGazeY));
      const r2 = Math.min(1.35, gx * gx + gy * gy);
      const vx = scleraCx + gx * rxMax;
      const vy = scleraCy + gy * ryMax;
      const vz = 19.48 - 0.82 * r2;
      eyeInfo.pivot.position.set(vx * voxScale, vy * voxScale, vz * voxScale);
      eyeInfo.pivot.rotation.set(-gy * 0.38, gx * 0.44, pupilRollZ);
    };

    applyEye(leftEye, -5.5, 21.85, 2.32, 2.72, 1);
    applyEye(rightEye, 4.5, 21.85, 2.48, 2.85, -1);
  }

  step(dt, t, allEntities = [], ponds = [], camAz = 0.62, viewerPos = null, simCtx = null) {
    const b = this.data.behavior;
    const bType = b?.type;
    const isStationaryLandmark =
      bType !== "vehicle_route" &&
      bType !== "wander" &&
      bType !== "water_float" &&
      bType !== "fly_circle";

    if (isStationaryLandmark && this.staticRootFrozen) {
      const animFn = this.group.userData?.animate;
      const hasFeed = Boolean(this.hasActiveFeed && this.feedMesh);
      if (!this.interactive && !this.isVegasSphere && !hasFeed && !animFn) {
        return;
      }
      const dxF = simCtx ? this.x - simCtx.focusX : 0;
      const dzF = simCtx ? this.z - simCtx.focusZ : 0;
      const distSqFocus = dxF * dxF + dzF * dzF;
      if (this.feedReading?.kind === "wind" && typeof this.feedReading.value === "number") {
        this.moveFactor = Math.max(0.45, Math.min(2.1, this.feedReading.value / 15));
      } else {
        this.moveFactor = 1.0;
      }
      this.interactive?.step?.(dt, t, {
        viewerPos,
        entX: this.x,
        entZ: this.z,
        entYaw: this.yaw,
      });
      if (hasFeed) {
        const showFeed = !simCtx || distSqFocus <= simCtx.feedLodSq;
        this.feedMesh.visible = showFeed;
        if (showFeed) {
          this.feedMesh.position.y = this.topY + 1.15 + Math.sin(t * 2.1) * 0.05;
          const targetAz = viewerPos
            ? Math.atan2(viewerPos.x - this.x, viewerPos.z - this.z)
            : camAz;
          this.feedMesh.rotation.y = targetAz - this.yaw;
        }
      }
      if (animFn) {
        const farAway = simCtx && distSqFocus > simCtx.farLodSq;
        if (!farAway || ((simCtx.frameTick + this.index) % 3) === 0) {
          animFn(t, { wheelAngle: 0, moveFactor: this.moveFactor });
        }
      }
      if (this.isVegasSphere) {
        this.updateVegasSphereEyes(dt, t, simCtx?.vehicles || allEntities);
      }
      return;
    }

    if (this.spawnScale < 1.0) {
      this.spawnScale = Math.min(1.0, this.spawnScale + dt * 3.2);
    }

    const vehiclePeers = simCtx?.vehicles || allEntities;
    const buildingPeers = simCtx?.buildings || allEntities;
    this.moveFactor = 0;
    let pitchX = 0;
    let rollZ = 0;

    if (bType === "vehicle_route" && this.routeCurve) {
      this.stepVehicleUnitKinematics(this, false, dt, t, vehiclePeers, buildingPeers, ponds);
      const rightX = -Math.cos(this.yaw);
      const rightZ = Math.sin(this.yaw);
      this.doorX = this.x + rightX * 1.9 + Math.sin(this.yaw) * 0.9;
      this.doorZ = this.z + rightZ * 1.9 + Math.cos(this.yaw) * 0.9;
      pitchX =
        (this.dwellingStop && !this.phys?.turnState ? 0 : Math.sin(t * 14) * 0.008 * Math.abs(this.moveFactor || 0)) +
        (this.phys?.clashPitch || 0);
      rollZ = (this.phys?.turnBankRoll || 0) + (this.phys?.clashRoll || 0);
    } else if (b?.type === "wander") {
      const isGlide = b.style === "glide";
      const glideBaseY = b.hoverHeight || 1.9;
      const selfPad = Math.min(3.8, Math.max(0.85, (this.footprintRadius || 1.5) * 0.48));
      const rawTargets =
        b.targets && b.targets.length
          ? b.targets
          : [
              [b.homeX + 12, b.homeZ + 8],
              [b.homeX - 11, b.homeZ + 9],
              [b.homeX + 4, b.homeZ - 14],
            ];
      if (this.wanderPause > 0) {
        this.wanderPause -= dt;
        this.y = isGlide ? glideBaseY + Math.sin(t * 2.2 + this.index) * 0.22 : 0;
        this.moveFactor = isGlide ? 0.5 : 0;
        this.wanderStuckSec = 0;
        this.wanderCheckX = this.x;
        this.wanderCheckZ = this.z;
      } else {
        const candRaw = rawTargets[this.wanderIdx % rawTargets.length];
        const [tgtX, tgtZ] = this.sanitizeWanderTarget(
          candRaw[0],
          candRaw[1],
          selfPad,
          isGlide,
          ponds,
          buildingPeers,
        );
        const dx = tgtX - this.x;
        const dz = tgtZ - this.z;
        const dist = Math.hypot(dx, dz);
        const reachTol = Math.max(0.8, selfPad * 0.42);
        if (dist < reachTol) {
          this.wanderIdx = (this.wanderIdx + 1) % rawTargets.length;
          this.wanderPause = isGlide ? 0.6 : 1.5 + (this.wanderIdx % 2) * 0.8;
          this.wanderStuckSec = 0;
          this.wanderCheckX = this.x;
          this.wanderCheckZ = this.z;
          this.y = isGlide ? glideBaseY + Math.sin(t * 2.2 + this.index) * 0.22 : 0;
        } else {
          const prevX = this.x;
          const prevZ = this.z;
          const ux = dx / dist;
          const uz = dz / dist;

          // Proactive tangential steering with hysteretic passing side (no 60Hz yaw flip!)
          let steerX = ux;
          let steerZ = uz;
          const lookAhead = Math.min(dist, Math.max(6.5, selfPad * 2.4 + 4.8));

          const applyAvoidance = (obsX, obsZ, clearR) => {
            const ox = obsX - this.x;
            const oz = obsZ - this.z;
            const od = Math.hypot(ox, oz);
            if (od < 0.01 || od > lookAhead + clearR) return;
            const fwd = ox * ux + oz * uz;
            const lat = ox * -uz + oz * ux;
            const corridor = clearR + 1.65;
            if (fwd > -clearR * 0.35 && Math.abs(lat) < corridor) {
              if (Math.abs(lat) > 0.85 && od > clearR + 0.5) {
                this.wanderAvoidSide = lat > 0 ? -1 : 1;
              }
              const side = Math.abs(lat) > 1.15 ? (lat > 0 ? -1 : 1) : this.wanderAvoidSide;
              const urgency = Math.max(
                0,
                Math.min(
                  1.75,
                  ((corridor - Math.abs(lat)) / corridor) *
                    (1.3 - Math.max(0, od - clearR) / lookAhead),
                ),
              );
              const outUx = -ox / od;
              const outUz = -oz / od;
              steerX += -uz * side * urgency * 1.6 + outUx * urgency * 0.65;
              steerZ += ux * side * urgency * 1.6 + outUz * urgency * 0.65;
            }
          };

          applyAvoidance(CITY_SIGN_POS[0], CITY_SIGN_POS[1], 2.95 + selfPad);
          if (!isGlide) {
            for (const pond of ponds) {
              applyAvoidance(pond.x, pond.z, (pond.radius || 6.4) + selfPad * 0.6 + 0.85);
            }
          }
          for (const other of buildingPeers) {
            if (other === this) continue;
            if (other.data.category !== "building" && other.data.behavior?.type !== "landmark") continue;
            applyAvoidance(other.x, other.z, (other.footprintRadius || 4.0) + selfPad + 0.95);
          }

          const steerLen = Math.hypot(steerX, steerZ) || 1;
          steerX /= steerLen;
          steerZ /= steerLen;

          const speed = b.speed || 2.8;
          const stepLen = Math.min(dist, speed * dt);
          this.x += steerX * stepLen;
          this.z += steerZ * stepLen;

          // Two-pass hard non-penetration resolution (including town signboard + island coastline)
          for (let pass = 0; pass < 2; pass++) {
            {
              const sr = 2.95 + selfPad;
              const sdx = this.x - CITY_SIGN_POS[0];
              const sdz = this.z - CITY_SIGN_POS[1];
              const sd = Math.hypot(sdx, sdz);
              if (sd < sr && sd > 0.01) {
                this.x = CITY_SIGN_POS[0] + (sdx / sd) * sr;
                this.z = CITY_SIGN_POS[1] + (sdz / sd) * sr;
              }
            }
            if (!isGlide) {
              for (const pond of ponds) {
                const pr = (pond.radius || 6.4) + selfPad * 0.6 + 0.85;
                const pdx = this.x - pond.x;
                const pdz = this.z - pond.z;
                const pd = Math.hypot(pdx, pdz);
                if (pd < pr && pd > 0.01) {
                  this.x = pond.x + (pdx / pd) * pr;
                  this.z = pond.z + (pdz / pd) * pr;
                }
              }
            }
            for (const other of buildingPeers) {
              if (other === this) continue;
              if (other.data.category !== "building" && other.data.behavior?.type !== "landmark") continue;
              const br = (other.footprintRadius || 4.0) + selfPad + 0.95;
              const bdx = this.x - other.x;
              const bdz = this.z - other.z;
              const bd = Math.hypot(bdx, bdz);
              if (bd < br && bd > 0.01) {
                this.x = other.x + (bdx / bd) * br;
                this.z = other.z + (bdz / bd) * br;
              }
            }
            const [ix, iz] = clampPointToIsland(this.x, this.z, selfPad + 2.0);
            this.x = ix;
            this.z = iz;
          }

          const actualDx = this.x - prevX;
          const actualDz = this.z - prevZ;
          const actualMove = Math.hypot(actualDx, actualDz);
          const fwdProg = actualDx * steerX + actualDz * steerZ;
          const progressRatio =
            stepLen > 1e-4
              ? Math.max(0, Math.min(1, (fwdProg > -0.002 ? actualMove : 0) / stepLen))
              : 0;

          // Fast stuck watchdog: smoothly advance target instead of twitching against a wall
          if (progressRatio < 0.32) {
            this.wanderStuckSec += dt;
            if (this.wanderStuckSec >= 0.55) {
              this.wanderStuckSec = 0;
              this.wanderAvoidSide *= -1;
              this.wanderIdx = (this.wanderIdx + 1) % rawTargets.length;
              this.wanderPause = 0.35;
            }
          } else {
            this.wanderStuckSec = Math.max(0, this.wanderStuckSec - dt * 1.5);
          }

          this.wheelAngle += actualMove / 0.45;
          this.moveFactor = isGlide ? 0.85 : Math.max(0.05, progressRatio);

          // Smooth heading along intended steer direction (never snap 180° to collision rebound!)
          const dirBlend = Math.min(1, dt * 6.5);
          this.wanderDirX += (steerX - this.wanderDirX) * dirBlend;
          this.wanderDirZ += (steerZ - this.wanderDirZ) * dirBlend;
          const wdLen = Math.hypot(this.wanderDirX, this.wanderDirZ) || 1;
          this.wanderDirX /= wdLen;
          this.wanderDirZ /= wdLen;

          let dyaw = 0;
          if (progressRatio > 0.14 || isGlide) {
            const desiredYaw = Math.atan2(this.wanderDirX, this.wanderDirZ);
            dyaw = desiredYaw - this.yaw;
            while (dyaw > Math.PI) dyaw -= Math.PI * 2;
            while (dyaw < -Math.PI) dyaw += Math.PI * 2;
            const maxTurn = dt * 4.8;
            this.yaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw * Math.min(1, dt * 6.2)));
          }

          if (isGlide) {
            this.y = glideBaseY + Math.sin(t * 2.5 + this.index) * 0.26;
            pitchX = 0.06;
            rollZ = Math.max(-0.22, Math.min(0.22, -dyaw * 0.35));
          } else if (b.style === "hop") {
            this.hopPhase = (this.hopPhase + dt * 3.4 * Math.max(0.15, progressRatio)) % 1;
            const u = this.hopPhase;
            this.y = 4 * 0.58 * u * (1 - u) * progressRatio;
            pitchX = (0.5 - u) * 0.22 * progressRatio;
          } else if (b.style === "trot") {
            this.y = Math.abs(Math.sin(t * 9.0)) * 0.12 * progressRatio;
            rollZ = Math.sin(t * 9.0) * 0.04 * progressRatio;
          } else {
            this.y = Math.abs(Math.sin(t * 6.5)) * 0.06 * progressRatio;
          }
        }
      }
    } else if (b?.type === "water_float") {
      this.orbitAngle += ((b.speed || 1.4) / Math.max(2.2, b.radius || 4.0)) * dt;
      const r = b.radius || 4.0;
      const nx = b.pondX + Math.cos(this.orbitAngle) * r;
      const nz = b.pondZ + Math.sin(this.orbitAngle) * r * 0.82;
      const dx = nx - this.x;
      const dz = nz - this.z;
      this.x = nx;
      this.z = nz;
      this.y = 0.14 + Math.sin(t * 2.4 + this.orbitAngle) * 0.045;
      if (Math.hypot(dx, dz) > 0.0005) {
        this.yaw = Math.atan2(dx, dz);
      }
      const surfBoost =
        this.feedReading?.kind === "surf" && typeof this.feedReading.value === "number"
          ? Math.max(0.7, Math.min(2.2, this.feedReading.value))
          : 1.0;
      rollZ = Math.sin(t * 2.1) * 0.05 * surfBoost;
      pitchX = Math.cos(t * 1.8) * 0.035 * surfBoost;
      this.moveFactor = 0.7;
    } else if (b?.type === "fly_circle") {
      if (this.flightCurve) {
        this.flightDist = (this.flightDist + (b.speed || 6.4) * dt) % this.flightLength;
        const u = (((this.flightDist % this.flightLength) + this.flightLength) % this.flightLength) / this.flightLength;
        const pos = this.flightCurve.getPointAt(u);
        const tan = this.flightCurve.getTangentAt(u);
        const tanAhead = this.flightCurve.getTangentAt((u + 0.022) % 1);

        this.x = pos.x;
        this.z = pos.z;
        this.y = pos.y + Math.sin(t * 2.6 + this.index) * 0.36;
        this.yaw = Math.atan2(tan.x, tan.z);

        const yawAhead = Math.atan2(tanAhead.x, tanAhead.z);
        let dTurn = yawAhead - this.yaw;
        while (dTurn > Math.PI) dTurn -= Math.PI * 2;
        while (dTurn < -Math.PI) dTurn += Math.PI * 2;

        const targetBank = Math.max(-0.46, Math.min(0.46, -dTurn * 1.55));
        this.bankRoll += (targetBank - this.bankRoll) * Math.min(1, dt * 5.2);
        rollZ = this.bankRoll;
        pitchX = Math.max(-0.36, Math.min(0.36, -tan.y * 0.78));
        this.moveFactor = 1.0;
      } else {
        this.orbitAngle += ((b.speed || 5.6) / Math.max(10, b.radius || 24)) * dt;
        const r = b.radius || 24;
        const nx = b.centerX + Math.cos(this.orbitAngle) * r;
        const nz = b.centerZ + Math.sin(this.orbitAngle) * r * 0.86;
        const ny = (b.altitude || 14.0) + Math.sin(this.orbitAngle * 2.0 + t * 0.6) * 2.1;
        const dx = nx - this.x;
        const dy = ny - this.y;
        const dz = nz - this.z;
        const hDist = Math.hypot(dx, dz);
        this.x = nx;
        this.z = nz;
        this.y = ny;
        if (hDist > 0.001) {
          this.yaw = Math.atan2(dx, dz);
          pitchX = Math.max(-0.32, Math.min(0.32, -Math.atan2(dy, hDist) * 0.75));
        }
        rollZ = -0.24;
        this.moveFactor = 1.0;
      }
    } else {
      this.y = 0.004;
      if (typeof b?.facingYaw === "number") {
        this.yaw = b.facingYaw;
      } else if (typeof this.data?.yaw === "number") {
        this.yaw = this.data.yaw;
      }
      if (this.feedReading?.kind === "wind" && typeof this.feedReading.value === "number") {
        this.moveFactor = Math.max(0.45, Math.min(2.1, this.feedReading.value / 15));
      } else {
        this.moveFactor = 1.0;
      }
    }

    this.interactive?.step?.(dt, t, {
      viewerPos,
      entX: this.x,
      entZ: this.z,
      entYaw: this.yaw,
    });
    const poseOff = this.interactive?.getPoseOffset?.(t) || null;
    const finalY = this.y + (poseOff?.liftY || 0);
    const finalRollZ = rollZ + (poseOff?.rollZ || 0);

    this.group.position.set(this.x, finalY, this.z);
    this.group.rotation.set(pitchX, this.yaw, finalRollZ);
    const popEase = this.spawnScale < 1 ? 1 - (1 - this.spawnScale) ** 3 : 1;
    this.group.scale.setScalar(popEase);

    if (
      isStationaryLandmark &&
      this.spawnScale >= 1.0 &&
      !this.interactive?.getPoseOffset &&
      !this.staticRootFrozen
    ) {
      this.group.updateMatrixWorld(true);
      this.group.matrixAutoUpdate = false;
      for (const ch of this.group.children) {
        if (ch.isMesh && ch !== this.feedMesh) {
          ch.matrixAutoUpdate = false;
        }
      }
      this.staticRootFrozen = true;
    }

    if (this.secondaryVehicle) {
      this.stepSecondaryVehicle(dt, t, buildingPeers, vehiclePeers, ponds, popEase);
    }

    if (this.feedMesh && this.feedMesh.visible) {
      this.feedMesh.position.y = this.topY + 1.15 + Math.sin(t * 2.1) * 0.05;
      const targetAz = viewerPos
        ? Math.atan2(viewerPos.x - this.x, viewerPos.z - this.z)
        : camAz;
      this.feedMesh.rotation.y = targetAz - this.yaw;
    }

    this.group.userData.animate?.(t, {
      wheelAngle: this.wheelAngle,
      moveFactor: this.moveFactor,
    });

    if (this.isVegasSphere) {
      this.updateVegasSphereEyes(dt, t, vehiclePeers);
    }
  }

  dispose(creationsGroup = null) {
    this.interactive?.dispose?.();
    this.interactive = null;
    if (this.feedMesh) {
      this.feedMesh.geometry.dispose();
      this.feedMesh.material.dispose();
      this.feedTex?.dispose();
    }
    if (this.secondaryVehicle) {
      if (creationsGroup) {
        creationsGroup.remove(this.secondaryVehicle.group);
      } else {
        this.secondaryVehicle.group.parent?.remove(this.secondaryVehicle.group);
      }
      this.secondaryVehicle.group.userData.dispose?.();
      this.secondaryVehicle = null;
    }
    this.group.userData.dispose?.();
  }
}

/**
 * Ensures vehicles sharing any road corridor (especially Sunnyvale School Bus + Sweet Swirl Ice Cream Van
 * on `path-main-loop`) start maximally spaced in world coordinates and run at clearly distinct speeds
 * so two buses/vans never cruise side-by-side at the same pace.
 */
function deBunchVehicleRoutes(creationEntities) {
  const vehicles = [];
  for (const ent of creationEntities.values()) {
    if (ent.data?.behavior?.type === "vehicle_route" && ent.routeCurve) {
      const samples = [];
      for (let i = 0; i < 32; i++) {
        samples.push(ent.routeCurve.getPointAt(i / 32));
      }
      vehicles.push({ ent, samples });
    }
  }
  if (vehicles.length < 2) return;

  const visited = new Set();
  const corridorFactors = [1.0, 0.86, 0.93];

  for (let i = 0; i < vehicles.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [vehicles[i]];
    visited.add(i);

    for (let j = i + 1; j < vehicles.length; j++) {
      if (visited.has(j)) continue;
      let sharedCount = 0;
      for (const pa of vehicles[i].samples) {
        for (const pb of vehicles[j].samples) {
          if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < 4.8) {
            sharedCount++;
            break;
          }
        }
      }
      if (sharedCount >= 8) {
        cluster.push(vehicles[j]);
        visited.add(j);
      }
    }

    if (cluster.length < 2) continue;
    cluster.sort((a, b) => {
      if (Boolean(a.ent.data.isSeed) !== Boolean(b.ent.data.isSeed)) {
        return a.ent.data.isSeed ? -1 : 1;
      }
      return a.ent.id.localeCompare(b.ent.id);
    });

    const anchor = cluster[0].ent;
    const u0 = anchor.routeClosed
      ? (((anchor.routeDist % anchor.routeLength) + anchor.routeLength) % anchor.routeLength) /
        anchor.routeLength
      : 0.16;
    if (!anchor.deBunchedOnce && !anchor.hasSteppedOnce && !anchor.routeClosed) {
      anchor.routeDist = anchor.routeLength * 0.16;
      anchor.routeDir = 1;
    }
    const anchorPos = anchor.routeCurve.getPointAt(u0);
    const anchorTan = anchor.routeCurve.getTangentAt(u0);

    for (let k = 0; k < cluster.length; k++) {
      const v = cluster[k].ent;
      if (!v.isDualTransit) {
        const authored = v.data?.behavior?.speed || 5.4;
        const factor = corridorFactors[k % corridorFactors.length];
        // NEVER speed up a vehicle above its authored cruise speed!
        v.effectiveSpeed = Math.max(3.6, Math.min(authored, authored * factor));
      }
      const canPlaceInitial = !v.deBunchedOnce && !v.hasSteppedOnce;
      if (k > 0 && canPlaceInitial) {
        if (v.routeClosed) {
          let bestU = 0;
          let bestD = Infinity;
          for (let s = 0; s < 64; s++) {
            const u = s / 64;
            const pt = v.routeCurve.getPointAt(u);
            const d = Math.hypot(pt.x - anchorPos.x, pt.z - anchorPos.z);
            if (d < bestD) {
              bestD = d;
              bestU = u;
            }
          }
          const vTan = v.routeCurve.getTangentAt(bestU);
          const dirSign = anchorTan.x * vTan.x + anchorTan.z * vTan.z >= 0 ? 1 : -1;
          const targetU = (((bestU + dirSign * (k / cluster.length)) % 1) + 1) % 1;
          v.routeDist = targetU * v.routeLength;
        } else {
          const frac = k % 2 === 1 ? 0.84 : 0.48;
          v.routeDist = v.routeLength * frac;
          v.routeDir = k % 2 === 1 ? -1 : 1;
        }
      }
      v.deBunchedOnce = true;
      if (canPlaceInitial) {
        v.syncVehiclePoseToRoute?.();
      }
    }
  }
}

export function createMeadowWorldEngine(canvas, callbacks = {}, options = {}) {
  const ogMode = Boolean(options.ogMode);
  const scene = new THREE.Scene();
  scene.background = makeMeadowSkyTexture();

  const w0 = Math.max(320, window.innerWidth);
  const h0 = Math.max(240, window.innerHeight);

  const probeCanvas = document.createElement("canvas");
  const probeGl =
    probeCanvas.getContext("webgl2", { powerPreference: "high-performance" }) ||
    probeCanvas.getContext("webgl", { powerPreference: "high-performance" });
  const probeDbg = probeGl?.getExtension?.("WEBGL_debug_renderer_info") || null;
  const probeGpuName =
    probeGl && probeDbg ? String(probeGl.getParameter(probeDbg.UNMASKED_RENDERER_WEBGL) || "") : "";
  const isSoftwareProbe = /swiftshader|llvmpipe|software|basic render/i.test(probeGpuName);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isSoftwareProbe,
    powerPreference: "high-performance",
    preserveDrawingBuffer: ogMode,
  });
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : probeGpuName;
  const isSoftwareGpu =
    isSoftwareProbe || /swiftshader|llvmpipe|software|basic render/i.test(gpuName);
  const isTouchDevice =
    !ogMode &&
    (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") ||
      Boolean(window.matchMedia?.("(pointer: coarse)")?.matches && Math.min(w0, h0) < 1024));
  const isIntegratedGpu =
    /Intel\(R\) (HD|UHD|Iris)|Radeon\(TM\) Graphics|Mali|Adreno/i.test(gpuName);
  const isLowTierGpu =
    !ogMode &&
    (isSoftwareGpu ||
      isTouchDevice ||
      /Mali-G[357]|Adreno \(TM\) [2-6]|PowerVR|Intel\(R\) (HD|UHD) Graphics [456]/i.test(gpuName));
  const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 4;

  const QUALITY_STORAGE_KEY = "geminisland_quality_v1";
  function readSavedQualityMode() {
    if (ogMode) return "high";
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem(QUALITY_STORAGE_KEY) : null;
      if (v === "auto" || v === "high" || v === "fast") return v;
    } catch {
      // ignore storage access issues
    }
    return "auto";
  }

  let qualityMode = readSavedQualityMode();
  let autoStepLevel = 0; // 0 = Crisp full, 1 = Capped DPR 1.25 + tighter LOD, 2 = Direct MSAA (no composer), 3 = Fast 60 FPS lock
  let lastAutoStepChangeMs = 0;
  let govGoodWindows = 0;
  let govFrameCount = 0;
  let govFrameMsAccum = 0;
  let activeMaxDpr = isSoftwareGpu ? 1 : isLowTierGpu ? 1.25 : 1.5;
  let activeShadowRes = isSoftwareGpu || isLowTierGpu ? 1024 : 2048;
  let activeFarLodDist = 92;
  let activeShadowCullDist = 96;
  let activeFeedLodDist = 84;
  let activeUsePostProcessing = !isSoftwareGpu && !isLowTierGpu;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, activeMaxDpr));
  renderer.setSize(w0, h0, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const BASE_FRUSTUM = 34;
  const aspect0 = w0 / h0;
  const camera = new THREE.OrthographicCamera(
    -BASE_FRUSTUM * aspect0,
    BASE_FRUSTUM * aspect0,
    BASE_FRUSTUM,
    -BASE_FRUSTUM,
    12,
    980,
  );
  const fpCamera = new THREE.PerspectiveCamera(aspect0 < 0.8 ? 72 : 62, aspect0, 0.14, 820);
  fpCamera.rotation.order = "YXZ";

  let composer = null;
  let usePostProcessing = false;
  let renderPass = null;
  let gtaoPass = null;
  let bloomPass = null;
  let smaaPass = null;

  function ensureComposer() {
    if (isSoftwareGpu) return null;
    if (composer) return composer;
    const cw = Math.max(320, window.innerWidth);
    const ch = Math.max(240, window.innerHeight);
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    gtaoPass = new GTAOPass(scene, camera, cw, ch);
    gtaoPass.output = GTAOPass.OUTPUT.Default;
    gtaoPass.blendIntensity = 0.42;
    gtaoPass.updateGtaoMaterial({
      radius: 0.22,
      distanceExponent: 1.4,
      thickness: 0.65,
      scale: 1.0,
      samples: 5,
      distanceFallOff: 1.0,
      screenSpaceRadius: true,
    });
    composer.addPass(gtaoPass);
    if (!isIntegratedGpu) {
      bloomPass = new UnrealBloomPass(new THREE.Vector2(cw, ch), 0.11, 0.24, 1.16);
      composer.addPass(bloomPass);
    }
    composer.addPass(new OutputPass());
    if ((window.devicePixelRatio || 1) < 1.2) {
      smaaPass = new SMAAPass(cw, ch);
      composer.addPass(smaaPass);
    }
    return composer;
  }

  function syncComposerCamera(activeCam) {
    if (!usePostProcessing || !composer) return;
    if (renderPass) {
      renderPass.camera = activeCam;
    }
    if (gtaoPass) {
      gtaoPass.camera = activeCam;
      const isPersp = activeCam.isPerspectiveCamera ? 1 : 0;
      if (gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== isPersp) {
        gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA = isPersp;
        gtaoPass.gtaoMaterial.needsUpdate = true;
      }
      gtaoPass.gtaoMaterial.uniforms.cameraProjectionMatrix.value.copy(activeCam.projectionMatrix);
      gtaoPass.gtaoMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
        activeCam.projectionMatrixInverse,
      );
      gtaoPass.pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
        activeCam.projectionMatrixInverse,
      );
    }
  }

  // Sunlit Golden-Hour Directional Key Light with Camera-Tracking Texel-Snapped Shadows
  const SUN_OFFSET = new THREE.Vector3(64, 118, 76);
  const SHADOW_HALF = 86;
  const sun = new THREE.DirectionalLight(0xfff3db, 2.25);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(activeShadowRes, activeShadowRes);
  sun.shadow.camera.left = -SHADOW_HALF;
  sun.shadow.camera.right = SHADOW_HALF;
  sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.bottom = -SHADOW_HALF;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 360;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.028;
  sun.shadow.radius = 1.5;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xeef7ff, 0x6ea44c, 1.12);
  scene.add(hemi);

  const rim = new THREE.DirectionalLight(0xffe7c2, 0.35);
  rim.position.set(-85, 70, -90);
  scene.add(rim);

  // Sculpted 3D GeminIsland Plateau + Beaches/Cliffs + Sunlit Surrounding Ocean
  const grassUniforms = {
    uTime: { value: 0 },
    uFocusXZ: { value: new THREE.Vector2(0, 0) },
    uHorizonRange: { value: new THREE.Vector2(145, 295) },
    uZones: { value: Array.from({ length: MAX_SHADER_ZONES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uZoneCount: { value: 0 },
    uShaderQuality: { value: 1.0 },
  };
  const groundGeo = buildIslandTerrainGeometry();
  const groundMesh = new THREE.Mesh(groundGeo, buildEndlessGrassMaterial(grassUniforms));
  groundMesh.receiveShadow = true;
  groundMesh.matrixAutoUpdate = false;
  groundMesh.updateMatrix();
  scene.add(groundMesh);

  const oceanGeo = new THREE.PlaneGeometry(4600, 4600, 1, 1);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanMesh = new THREE.Mesh(oceanGeo, buildIslandOceanMaterial(grassUniforms));
  oceanMesh.position.set(0, -0.56, 0);
  oceanMesh.raycast = () => {};
  scene.add(oceanMesh);

  function updateShadowMapResolution(nextRes) {
    if (activeShadowRes === nextRes) return;
    activeShadowRes = nextRes;
    sun.shadow.mapSize.set(nextRes, nextRes);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }

  function getEffectiveQualityTier() {
    if (qualityMode === "high") return "high";
    if (qualityMode === "fast") return "fast";
    if (isSoftwareGpu || autoStepLevel >= 3) return "fast";
    if (isLowTierGpu || autoStepLevel >= 1) return "medium";
    return "high";
  }

  function getQualityInfo() {
    return {
      mode: qualityMode,
      effectiveTier: getEffectiveQualityTier(),
      autoStepLevel,
      usePostProcessing,
      activeMaxDpr,
      shadowRes: activeShadowRes,
    };
  }

  function applyQualityState(notify = true) {
    let targetDpr = 1.5;
    let targetPost = false;
    let targetShadow = 2048;
    let targetVoxDetail = 1.0;
    let targetGrassQuality = 1.0;
    let farLod = 92;
    let shadowCull = 96;
    let feedLod = 84;

    if (ogMode || qualityMode === "high") {
      targetDpr = isSoftwareGpu ? 1.0 : 1.5;
      targetPost = Boolean(ensureComposer());
      targetShadow = isSoftwareGpu ? 1024 : 2048;
      targetVoxDetail = 1.0;
      targetGrassQuality = 1.0;
      farLod = 115;
      shadowCull = 115;
      feedLod = 110;
    } else if (qualityMode === "fast") {
      targetDpr = isSoftwareGpu ? 1.0 : 1.15;
      targetPost = false;
      targetShadow = 1024;
      targetVoxDetail = 0.0;
      targetGrassQuality = 0.0;
      farLod = 68;
      shadowCull = 72;
      feedLod = 60;
    } else {
      // Auto: starts crisp, steps cleanly under frame-time pressure with hysteresis
      const basePost = !isSoftwareGpu && !isLowTierGpu && Boolean(ensureComposer());
      const baseDpr = isSoftwareGpu ? 1.0 : isLowTierGpu ? 1.25 : 1.5;
      const baseShadow = isSoftwareGpu || isLowTierGpu ? 1024 : 2048;

      if (autoStepLevel <= 0) {
        targetDpr = baseDpr;
        targetPost = basePost;
        targetShadow = baseShadow;
        targetVoxDetail = 1.0;
        targetGrassQuality = 1.0;
        farLod = 92;
        shadowCull = 96;
        feedLod = 84;
      } else if (autoStepLevel === 1) {
        targetDpr = Math.min(baseDpr, 1.25);
        targetPost = basePost;
        targetShadow = baseShadow;
        targetVoxDetail = 1.0;
        targetGrassQuality = 1.0;
        farLod = 82;
        shadowCull = 86;
        feedLod = 74;
      } else if (autoStepLevel === 2) {
        targetDpr = Math.min(baseDpr, 1.25);
        targetPost = false;
        targetShadow = baseShadow;
        targetVoxDetail = 1.0;
        targetGrassQuality = 1.0;
        farLod = 74;
        shadowCull = 80;
        feedLod = 68;
      } else {
        targetDpr = Math.min(baseDpr, 1.08);
        targetPost = false;
        targetShadow = 1024;
        targetVoxDetail = 0.0;
        targetGrassQuality = 0.0;
        farLod = 64;
        shadowCull = 68;
        feedLod = 58;
      }
    }

    activeMaxDpr = targetDpr;
    usePostProcessing = targetPost;
    activeUsePostProcessing = targetPost;
    activeFarLodDist = farLod;
    activeShadowCullDist = shadowCull;
    activeFeedLodDist = feedLod;

    setVoxelShaderDetailScale(targetVoxDetail);
    grassUniforms.uShaderQuality.value = targetGrassQuality;
    updateShadowMapResolution(targetShadow);
    if (typeof handleResize === "function") {
      handleResize();
    } else {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, activeMaxDpr));
    }
    if (notify) {
      callbacks.onQualityChange?.(getQualityInfo());
    }
  }

  function setQualityMode(nextMode) {
    const clean = nextMode === "high" || nextMode === "fast" || nextMode === "auto" ? nextMode : "auto";
    qualityMode = clean;
    autoStepLevel = 0;
    govGoodWindows = 0;
    govFrameCount = 0;
    govFrameMsAccum = 0;
    lastAutoStepChangeMs = performance.now();
    if (!ogMode) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(QUALITY_STORAGE_KEY, clean);
        }
      } catch {
        // ignore storage restrictions
      }
    }
    applyQualityState(true);
    return getQualityInfo();
  }

  const skyDome = buildFirstPersonSkyDome(grassUniforms.uTime);
  scene.add(skyDome);

  const citySignboard = createContributorSignboard(maxAniso);
  citySignboard.group.updateMatrixWorld(true);
  citySignboard.group.matrixAutoUpdate = false;
  scene.add(citySignboard.group);

  const floatingSkyBanner = createFloatingSkyBanner();
  scene.add(floatingSkyBanner.group);

  // Scattered scenic perimeter Meadow Groves + Coastal Shoreline Boulders (batched into 1 static mesh)
  const perimeterTreesGroup = new THREE.Group();
  scene.add(perimeterTreesGroup);
  const treeProtos = [buildMeadowTreeMesh(0), buildMeadowTreeMesh(1), buildMeadowTreeMesh(2)];
  const bushProtos = [buildMeadowBushMesh(0), buildMeadowBushMesh(1), buildMeadowBushMesh(2)];
  const rockProtos = [buildCoastalRockMesh(0), buildCoastalRockMesh(1), buildCoastalRockMesh(2)];
  const perimeterScenery = [];
  for (let i = 0; i < 46; i++) {
    const r = 44 + ((i * 19) % 92);
    const ang = i * 2.399963 + 0.4;
    const tx = Math.cos(ang) * r;
    const tz = Math.sin(ang) * r;
    if (getIslandInlandMargin(tx, tz) >= 6.5) {
      perimeterScenery.push({
        mesh: treeProtos[i % 3],
        x: tx,
        y: 0,
        z: tz,
        rotY: (i * 1.7) % (Math.PI * 2),
        scale: 0.85 + (i % 4) * 0.14,
        isTree: true,
        isCoastalRock: false,
        blocked: false,
      });
    }

    if (i % 2 === 0) {
      const bAng = ang + 0.05;
      const bx = tx + Math.cos(bAng * 7) * 2.4;
      const bz = tz + Math.sin(bAng * 5) * 2.4;
      if (getIslandInlandMargin(bx, bz) >= 6.0) {
        perimeterScenery.push({
          mesh: bushProtos[i % 3],
          x: bx,
          y: 0,
          z: bz,
          rotY: (i * 2.3) % (Math.PI * 2),
          scale: 1,
          isTree: false,
          isCoastalRock: false,
          blocked: false,
        });
      }
    }
  }
  for (let k = 0; k < 28; k++) {
    const ang = (k / 28) * Math.PI * 2 + ((k % 3) - 1) * 0.042;
    const shoreMargin = -3.3 + (k % 4) * 0.85;
    const [rx, rz] = clampPointToIsland(Math.cos(ang) * 260, Math.sin(ang) * 260, shoreMargin);
    const ry = getIslandGroundHeight(rx, rz) - 0.12;
    perimeterScenery.push({
      mesh: rockProtos[k % 3],
      x: rx,
      y: ry,
      z: rz,
      rotY: (k * 2.17) % (Math.PI * 2),
      scale: 0.88 + (k % 4) * 0.18,
      isTree: false,
      isCoastalRock: true,
      blocked: false,
    });
  }
  const initialPerimeterMesh = mergeVoxelMeshInstances(perimeterScenery, {
    depthLayer: 0,
    castShadow: true,
    receiveShadow: true,
  });
  if (initialPerimeterMesh) perimeterTreesGroup.add(initialPerimeterMesh);

  // Shared voxel prototypes for the 6 path styles
  const flagstoneProtos = [0, 1, 2].map((variant) => {
    const fv = new Vox(410 + variant * 17);
    const cMain = variant === 0 ? "limestone" : variant === 1 ? "path" : "cream";
    const cEdge = variant === 1 ? "path2" : "concrete";
    fv.box(-2, 0, -2, 2, 1, 2, cMain);
    fv.put(-2, 0, -2, cEdge);
    fv.put(1, 0, 1, cEdge);
    return buildVoxelMesh(fv, { scale: 0.21, castShadow: false, depthLayer: 1 });
  });

  const dirtPebbleProtos = [0, 1, 2].map((variant) => {
    const pv = new Vox(450 + variant * 13);
    pv.box(-1, 0, -1, 1, 1, 1, variant === 0 ? "stone" : variant === 1 ? "path2" : "moss");
    if (variant === 0) pv.put(1, 0, 0, "concrete2");
    return buildVoxelMesh(pv, { scale: 0.16, castShadow: false, depthLayer: 1 });
  });

  const cobbleProtos = [0, 1, 2].map((variant) => {
    const cv = new Vox(490 + variant * 19);
    const cA = variant === 0 ? "limestone" : variant === 1 ? "path" : "cream";
    const cB = variant === 0 ? "concrete" : variant === 1 ? "path2" : "stone";
    cv.box(-2, 0, -2, 0, 1, 0, cA);
    cv.box(1, 0, -1, 3, 1, 1, cB);
    cv.box(-1, 0, 1, 1, 1, 2, cB);
    return buildVoxelMesh(cv, { scale: 0.17, castShadow: false, depthLayer: 2 });
  });

  const boardwalkPlankProtos = [0, 1].map((variant) => {
    const bv = new Vox(530 + variant * 11);
    const plankCol = variant === 0 ? "oak" : "woodLight";
    bv.box(-4, 1, -1, 4, 2, 2, plankCol);
    bv.box(-4, 0, -1, -3, 1, 2, "woodDark");
    bv.box(3, 0, -1, 4, 1, 2, "woodDark");
    return buildVoxelMesh(bv, { scale: 0.19, castShadow: true, depthLayer: 2 });
  });

  const volcanicStepProtos = [0, 1].map((variant) => {
    const vv = new Vox(570 + variant * 17);
    vv.box(-2, 0, -2, 2, 1, 2, "basalt");
    vv.put(variant === 0 ? -2 : 1, 0, 0, "ash");
    vv.put(0, 0, variant === 0 ? 1 : -1, "lava", 1.15);
    return buildVoxelMesh(vv, { scale: 0.2, castShadow: false, depthLayer: 2 });
  });

  const cottageBorderProtos = [0, 1, 2].map((variant) => {
    const gv = new Vox(610 + variant * 15);
    const stoneCol = variant === 0 ? "limestone" : variant === 1 ? "path" : "stone";
    gv.box(-2, 0, -1, 1, 1, 1, stoneCol);
    gv.put(1, 0, 0, variant === 1 ? "cream" : "concrete");
    if (variant === 2) {
      gv.put(-1, 1, 0, "leaf");
      gv.put(0, 1, 0, "#f6d55c");
    }
    return buildVoxelMesh(gv, { scale: 0.16, castShadow: false, depthLayer: 1 });
  });

  const pathsGroup = new THREE.Group();
  const propsGroup = new THREE.Group();
  const staticLandmarksGroup = new THREE.Group();
  const creationsGroup = new THREE.Group();
  const villagersGroup = new THREE.Group();
  scene.add(pathsGroup, propsGroup, staticLandmarksGroup, creationsGroup, villagersGroup);

  const hermesSwarm = new HermesSwarmManager(scene);

  let localAppearance = loadSavedAppearance();
  const localAvatarRig = buildCharacterAvatarRig(localAppearance, {
    isLocalPlayer: true,
    castShadow: true,
  });
  localAvatarRig.root.visible = !ogMode;
  scene.add(localAvatarRig.root);
  let waveTimer = 0;

  const remotePlayers = new RemotePlayerManager();
  remotePlayers.group.visible = !ogMode;
  scene.add(remotePlayers.group);

  let interiorSystem = null;
  let activeInteractionTarget = null;
  let lastInteractionPromptKey = "";
  let hasWalkedOnce = false;
  let lastExitCamTarget = null;

  // Unit-radius Highlight Halo (scaled dynamically to match tiny vs colossal creation footprints!)
  const haloGeo = new THREE.RingGeometry(0.92, 1.06, 64);
  haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff7c2,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const selectionHalo = new THREE.Mesh(haloGeo, haloMat);
  selectionHalo.position.y = 0.122;
  selectionHalo.visible = false;
  scene.add(selectionHalo);

  const plotMarker = buildPlotMarkerGroup();
  scene.add(plotMarker.group);

  let spotState = { mode: "hidden", x: 16, z: 10 };
  let previewPlotRadius = 3.3;
  let liveFeedsById = {};

  const creationEntities = new Map();
  const villagerAgents = new Map();
  let currentWorld = null;
  let highlightedId = null;
  let ogSettledFrames = 0;

  const HOME_TX = 0;
  const HOME_TZ = -2;
  const HOME_AZ = 0.62;
  const HOME_EL = 0.66;
  const MIN_EL = 0.135;
  const MAX_EL = 1.24;

  function getHomeZoom() {
    const w = canvas.clientWidth || window.innerWidth || 1280;
    const h = Math.max(1, canvas.clientHeight || window.innerHeight || 800);
    return w / h < 0.78 ? 0.82 : 1.02;
  }

  function getBaseFpFov() {
    const w = canvas.clientWidth || window.innerWidth || 1280;
    const h = Math.max(1, canvas.clientHeight || window.innerHeight || 800);
    return w / h < 0.8 ? 72 : 62;
  }

  function smootherstep01(raw) {
    const u = Math.max(0, Math.min(1, raw));
    return u * u * u * (u * (u * 6 - 15) + 10);
  }

  function wrapPi(rad) {
    let a = rad;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function lowAngleTargetY(el) {
    return el < 0.32 ? (0.32 - el) * 14.0 : 0;
  }

  const prefersReducedMotion = Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
  const runIntroOnBoot = !ogMode && !prefersReducedMotion;
  const initialHomeZoom = getHomeZoom();

  const sessionSpawnAng = Math.random() * Math.PI * 2;
  const sessionSpawnRad = 1.4 + Math.random() * 2.4;
  const [initialSpawnX, initialSpawnZ] = clampPointToIsland(
    10.6 + Math.cos(sessionSpawnAng) * sessionSpawnRad,
    -0.6 + Math.sin(sessionSpawnAng) * sessionSpawnRad,
    4.0,
  );
  const initialSpawnYaw = Math.atan2(-(2.4 - initialSpawnX), -(-18.5 - initialSpawnZ));

  const introSweep = {
    active: runIntroOnBoot,
    elapsed: 0,
    holdSec: 0.55,
    panDurSec: 1.9,
    orbitDurSec: 3.7,
    walkDurSec: 2.05,
    fromTx: CITY_SIGN_POS[0],
    fromTy: 2.38,
    fromTz: CITY_SIGN_POS[1],
    fromZoom: 2.95,
    fromAz: HOME_AZ - 0.12,
    fromEl: 0.155,
    firedPan: false,
    firedOrbit: false,
    firedWalk: false,
    usingFpCam: false,
    walkX: initialSpawnX,
    walkZ: initialSpawnZ,
    walkYaw: initialSpawnYaw,
    walkPitch: 0.045,
  };

  const cam = {
    tx: runIntroOnBoot ? introSweep.fromTx : HOME_TX,
    ty: runIntroOnBoot ? introSweep.fromTy : 0,
    tz: runIntroOnBoot ? introSweep.fromTz : HOME_TZ,
    goalTx: HOME_TX,
    goalTy: 0,
    goalTz: HOME_TZ,
    zoom: runIntroOnBoot ? introSweep.fromZoom : initialHomeZoom,
    goalZoom: initialHomeZoom,
    az: runIntroOnBoot ? introSweep.fromAz : HOME_AZ,
    goalAz: HOME_AZ,
    el: runIntroOnBoot ? introSweep.fromEl : HOME_EL,
    goalEl: HOME_EL,
  };

  function cancelIntroSweep(requestedMode = null) {
    if (!introSweep.active) return;
    const wasFpSwoop = introSweep.usingFpCam;
    introSweep.active = false;
    introSweep.usingFpCam = false;
    fpCamera.fov = getBaseFpFov();
    fpCamera.near = 0.14;
    fpCamera.far = 820;
    fpCamera.updateProjectionMatrix();

    if (wasFpSwoop) {
      if (requestedMode === "pan" || requestedMode === "orbit") {
        skyDome.visible = false;
        syncComposerCamera(camera);
        cam.az = cam.goalAz = HOME_AZ;
        cam.el = cam.goalEl = HOME_EL;
        cam.tx = cam.goalTx = HOME_TX;
        cam.ty = cam.goalTy = 0;
        cam.tz = cam.goalTz = HOME_TZ;
        cam.zoom = cam.goalZoom = getHomeZoom();
      } else {
        const [rx, rz] = resolveWalkPosition(introSweep.walkX, introSweep.walkZ);
        fp.x = rx;
        fp.z = rz;
        const gY = getIslandGroundHeight(rx, rz);
        fp.feetY = gY;
        fp.y = gY + FP_EYE_HEIGHT;
        fp.yaw = fp.goalYaw = introSweep.walkYaw;
        fp.pitch = fp.goalPitch = introSweep.walkPitch;
        fp.vx = 0;
        fp.vz = 0;
        fp.jumpY = 0;
        fp.jumpVy = 0;
        fp.settleT = 1;
        fp.active = true;
        hasWalkedOnce = true;
        dragMode = "walk";
        localAvatarRig.setFirstPersonMode(true);
        skyDome.visible = true;
        skyDome.position.set(fp.x, 0, fp.z);
        fpCamera.position.set(fp.x, fp.y, fp.z);
        fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
        fpCamera.updateMatrixWorld();
        syncComposerCamera(fpCamera);
        canvas.style.cursor = idleCursor();
        callbacks.onDragModeChange?.("walk");
      }
      return;
    }

    cam.az = HOME_AZ + wrapPi(cam.az - HOME_AZ);
    cam.goalTx = cam.tx;
    cam.goalTy = lowAngleTargetY(cam.el);
    cam.goalTz = cam.tz;
    cam.goalZoom = cam.zoom;
    cam.goalAz = cam.az;
    cam.goalEl = cam.el;
  }

  const CLAMP_BOUND = 185;
  function clampTarget() {
    cam.goalTx = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, cam.goalTx));
    cam.goalTz = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, cam.goalTz));
  }

  function isClientSpotClear(x, z, candidateRadius = previewPlotRadius) {
    const rNew = Math.max(1.3, Number(candidateRadius) || 3.3);
    if (getIslandInlandMargin(x, z) < rNew + 2.2) return false;
    if (Math.hypot(x - CITY_SIGN_POS[0], z - CITY_SIGN_POS[1]) < rNew + 2.2) return false;
    if (!currentWorld) return true;
    for (const c of currentWorld.creations || []) {
      if (c.category === "aircraft" || c.behavior?.type === "fly_circle") continue;
      if (c.category === "watercraft" || c.behavior?.type === "water_float") continue;
      const otherR = getCreationFootprintRadius(
        c.scaleClass,
        c.blueprint?.stats?.footprintX ?? 14,
        c.blueprint?.stats?.footprintZ ?? 14,
      );
      if (Math.hypot(x - c.x, z - c.z) < rNew + otherR + 0.85) return false;
    }
    for (const pr of currentWorld.props || []) {
      if (pr.kind === "pond" && Math.hypot(x - pr.x, z - pr.z) < (pr.radius || 6.5) + rNew + 0.9) {
        return false;
      }
    }
    for (const p of currentWorld.paths || []) {
      if (p.kind !== "road" || !p.points) continue;
      for (let i = 0; i < p.points.length; i++) {
        const a = p.points[i];
        const b = p.points[(i + 1) % p.points.length];
        if (!p.closed && i === p.points.length - 1) break;
        if (distToSeg2D(x, z, a[0], a[1], b[0], b[1]) < rNew + 2.15) return false;
      }
    }
    return true;
  }

  function snapToClearMeadowSpot(rawX, rawZ, candidateRadius = previewPlotRadius) {
    const rNew = Math.max(1.3, Number(candidateRadius) || 3.3);
    const [cx, cz] = clampPointToIsland(rawX, rawZ, rNew + 2.6);
    if (isClientSpotClear(cx, cz, candidateRadius)) {
      return [Number(cx.toFixed(1)), Number(cz.toFixed(1))];
    }
    const baseAng = Math.atan2(cz, cx);
    for (let r = 2.5; r <= 78; r += 2.6) {
      for (let k = 0; k < 20; k++) {
        const ang = baseAng + (k / 20) * Math.PI * 2;
        const tx = cx + Math.cos(ang) * r;
        const tz = cz + Math.sin(ang) * r;
        if (isClientSpotClear(tx, tz, candidateRadius)) {
          return [Number(tx.toFixed(1)), Number(tz.toFixed(1))];
        }
      }
    }
    return [Number(cx.toFixed(1)), Number(cz.toFixed(1))];
  }

  function setPreviewPrompt(promptText) {
    const nextR = estimatePreviewPlotRadius(promptText);
    previewPlotRadius = nextR;
    plotMarker.setPlotRadius(nextR);
    if (spotState.mode === "staked" || spotState.mode === "picking") {
      if (!isClientSpotClear(spotState.x, spotState.z, nextR)) {
        const [sx, sz] = snapToClearMeadowSpot(spotState.x, spotState.z, nextR);
        spotState.x = sx;
        spotState.z = sz;
        plotMarker.group.position.set(sx, 0, sz);
        callbacks.onAutoNudgeSpot?.(sx, sz);
      }
    }
  }

  let sceneListsDirty = true;
  let cachedAllEntities = [];
  let cachedVehicles = [];
  let cachedBuildings = [];
  let cachedInteractiveEntities = [];
  let cachedPonds = [];
  let cachedVillagers = [];
  let cachedVillagerObstacles = [{ ent: null, x: CITY_SIGN_POS[0], z: CITY_SIGN_POS[1], r: 2.9 }];

  function markSceneListsDirty() {
    sceneListsDirty = true;
  }

  function rebuildSceneListsIfNeeded() {
    if (!sceneListsDirty) return;
    sceneListsDirty = false;
    cachedAllEntities = Array.from(creationEntities.values());
    cachedVehicles = [];
    cachedBuildings = [];
    cachedInteractiveEntities = [];
    cachedVillagerObstacles = [{ ent: null, x: CITY_SIGN_POS[0], z: CITY_SIGN_POS[1], r: 2.9 }];

    for (const ent of cachedAllEntities) {
      if (ent.interactive?.hitMeshes?.length) {
        cachedInteractiveEntities.push(ent);
      }
      if (ent.data.behavior?.type === "vehicle_route") {
        cachedVehicles.push(ent);
      } else if (ent.data.category === "building" || ent.data.behavior?.type === "landmark") {
        cachedBuildings.push(ent);
        cachedVillagerObstacles.push({
          ent,
          x: ent.x,
          z: ent.z,
          r: (ent.footprintRadius || 3.8) + 0.8,
        });
      }
    }

    cachedPonds = (currentWorld?.props || []).filter((p) => p.kind === "pond");
    cachedVillagers = Array.from(villagerAgents.values());
  }

  const raycaster = new THREE.Raycaster();
  const interactiveRaycaster = new THREE.Raycaster();
  interactiveRaycaster.layers.set(INTERACTIVE_HIT_LAYER);
  let hoveredInteractiveEnt = null;
  let pendingHover = null;
  const groundPlaneMath = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpHit = new THREE.Vector3();

  function clearInteractiveHover() {
    pendingHover = null;
    if (hoveredInteractiveEnt) {
      hoveredInteractiveEnt.interactive?.setHovered?.(null);
      hoveredInteractiveEnt = null;
    }
  }

  function pickInteractiveAt(clientX, clientY) {
    if (fp.active && interiorSystem?.isInside?.()) return null;
    rebuildSceneListsIfNeeded();
    if (cachedInteractiveEntities.length === 0) return null;

    const hitTargets = [];
    for (const ent of cachedInteractiveEntities) {
      if (fp.active) {
        const maxD = 44 + (ent.footprintRadius || 4.0);
        const dx = ent.x - fp.x;
        const dz = ent.z - fp.z;
        if (dx * dx + dz * dz > maxD * maxD) continue;
      }
      for (const m of ent.interactive.hitMeshes) {
        hitTargets.push(m);
      }
    }
    if (hitTargets.length === 0) return null;

    const rect = canvas.getBoundingClientRect();
    const locked = fp.active && document.pointerLockElement === canvas;
    const ndcX = locked ? 0 : ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ndcY = locked ? 0 : -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    interactiveRaycaster.setFromCamera({ x: ndcX, y: ndcY }, fp.active ? fpCamera : camera);
    interactiveRaycaster.far = fp.active ? 42 : 620;
    const hits = interactiveRaycaster.intersectObjects(hitTargets, false);
    if (!hits.length) return null;
    const top = hits[0].object;
    const cid = top.userData?.creationId;
    const ent = cid ? creationEntities.get(cid) : null;
    if (!ent || !ent.interactive) return null;
    return {
      ent,
      action: top.userData?.interactiveAction || null,
      point: hits[0].point,
    };
  }

  const FP_EYE_HEIGHT = 1.65;
  const FP_MIN_PITCH = -1.32;
  const FP_MAX_PITCH = 1.18;
  const FP_MAX_RADIUS = 148;
  const initialSpawnFeetY = getIslandGroundHeight(initialSpawnX, initialSpawnZ);
  const fp = {
    active: false,
    x: initialSpawnX,
    y: initialSpawnFeetY + FP_EYE_HEIGHT,
    z: initialSpawnZ,
    localX: 0,
    localY: 0,
    localZ: 3.85,
    feetY: initialSpawnFeetY,
    horizSpeed: 0,
    sprinting: false,
    yaw: initialSpawnYaw,
    goalYaw: initialSpawnYaw,
    pitch: -0.02,
    goalPitch: -0.02,
    vx: 0,
    vz: 0,
    jumpY: 0,
    jumpVy: 0,
    bobPhase: 0,
    settleT: 1,
  };

  function screenToGround(clientX, clientY) {
    if (fp.active && interiorSystem?.isInside?.()) return null;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ndcY = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, fp.active ? fpCamera : camera);
    if (fp.active && raycaster.ray.direction.y >= -0.015) {
      return null;
    }
    if (raycaster.ray.intersectPlane(groundPlaneMath, tmpHit)) {
      return [tmpHit.x, tmpHit.z];
    }
    return null;
  }

  function getCitySignHoverItem() {
    const n =
      typeof currentWorld?.contributionCount === "number"
        ? currentWorld.contributionCount
        : (currentWorld?.creations || []).filter((c) => !c.isSeed && !c.isCompanion).length;
    const total = currentWorld?.creations?.length ?? 0;
    return {
      id: "__city_sign__",
      x: CITY_SIGN_POS[0],
      z: CITY_SIGN_POS[1],
      data: {
        id: "__city_sign__",
        name: "Hermes Island Sign",
        description: `Timber town signboard displaying ${n} ${n === 1 ? "contribution" : "contributions"} (${total} total builds hosted with local Hermes Agent).`,
        behavior: {
          statusLine: `${n} ${n === 1 ? "contribution" : "contributions"} · ${total} creations`,
        },
      },
    };
  }

  function pickHermesAgentAt(clientX, clientY) {
    if (ogMode) return null;
    if (fp.active) {
      const rect = canvas.getBoundingClientRect();
      const locked = document.pointerLockElement === canvas;
      const ndcX = locked ? 0 : ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ndcY = locked ? 0 : -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, fpCamera);
      return hermesSwarm.pickAtRaycaster(raycaster);
    }
    const g = screenToGround(clientX, clientY);
    if (!g) return null;
    return hermesSwarm.pickAtGround(g[0], g[1]);
  }

  function pickCreationAt(clientX, clientY) {
    if (fp.active && interiorSystem?.isInside?.()) return null;
    rebuildSceneListsIfNeeded();
    if (fp.active) {
      const rect = canvas.getBoundingClientRect();
      const locked = document.pointerLockElement === canvas;
      const ndcX = locked ? 0 : ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ndcY = locked ? 0 : -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, fpCamera);

      const candidates = [];
      const sdx = CITY_SIGN_POS[0] - fp.x;
      const sdz = CITY_SIGN_POS[1] - fp.z;
      if (sdx * sdx + sdz * sdz <= 78 * 78) {
        candidates.push(citySignboard.group);
      }
      const camFwdX = -Math.sin(fp.yaw);
      const camFwdZ = -Math.cos(fp.yaw);
      for (const ent of cachedAllEntities) {
        if (ent.batchedInChunk) continue;
        const r = (ent.footprintRadius || 3.8) + 3.5;
        const maxD = 75 + r;
        const dx = ent.x - fp.x;
        const dz = ent.z - fp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= maxD * maxD && (d2 <= r * r || dx * camFwdX + dz * camFwdZ > -r)) {
          candidates.push(ent.group);
        }
        if (ent.secondaryVehicle) {
          const sv = ent.secondaryVehicle;
          const svDx = sv.x - fp.x;
          const svDz = sv.z - fp.z;
          const svD2 = svDx * svDx + svDz * svDz;
          if (svD2 <= 80 * 80 && (svD2 <= 25 || svDx * camFwdX + svDz * camFwdZ > -5)) {
            candidates.push(sv.group);
          }
        }
      }
      for (let ci = 0; ci < staticLandmarksGroup.children.length; ci++) {
        candidates.push(staticLandmarksGroup.children[ci]);
      }
      if (candidates.length === 0) return null;

      const prevFar = raycaster.far;
      raycaster.far = 75;
      const hits = raycaster.intersectObjects(candidates, true);
      raycaster.far = prevFar;
      for (const hit of hits) {
        if (hit.object?.userData?.isStaticChunk) {
          const chunkList = hit.object.userData.chunkEntities;
          if (Array.isArray(chunkList) && chunkList.length) {
            let bestId = null;
            let bestScore = Infinity;
            for (let k = 0; k < chunkList.length; k++) {
              const item = chunkList[k];
              const d = Math.hypot(hit.point.x - item.x, hit.point.z - item.z) / Math.max(1.2, item.r || 3.5);
              if (d < bestScore) {
                bestScore = d;
                bestId = item.id;
              }
            }
            if (bestId && creationEntities.has(bestId)) {
              return creationEntities.get(bestId);
            }
          }
        }
        let cur = hit.object;
        while (cur) {
          const cid = cur.userData?.creationId;
          if (cid === "__city_sign__") return getCitySignHoverItem();
          if (cid && creationEntities.has(cid)) return creationEntities.get(cid);
          cur = cur.parent;
        }
      }
      return null;
    }

    const g = screenToGround(clientX, clientY);
    if (!g) return null;

    if (Math.hypot(g[0] - CITY_SIGN_POS[0], g[1] - CITY_SIGN_POS[1]) < 3.4) {
      return getCitySignHoverItem();
    }

    let best = null;
    let bestScore = Infinity;
    for (const ent of cachedAllEntities) {
      const hitRadius = Math.max(4.4, (ent.footprintRadius || 3.5) + 1.2);
      const d = Math.hypot(ent.x - g[0], ent.z - g[1]);
      if (d < hitRadius && d < bestScore) {
        bestScore = d;
        best = ent;
      }
    }
    return best;
  }

  function updateBiomeShaderUniforms(zones) {
    const list = Array.isArray(zones) ? zones.slice(0, MAX_SHADER_ZONES) : [];
    let count = 0;
    for (let i = 0; i < MAX_SHADER_ZONES; i++) {
      const vec = grassUniforms.uZones.value[i];
      const zItem = list[i];
      if (zItem && BIOME_IDS[zItem.biome]) {
        vec.set(
          Number(zItem.x) || 0,
          Number(zItem.z) || 0,
          Math.max(4.0, Number(zItem.radius) || 9.0),
          BIOME_IDS[zItem.biome],
        );
        count++;
      } else {
        vec.set(0, 0, 0, 0);
      }
    }
    grassUniforms.uZoneCount.value = count;
  }

  function disposeStaticBatchGroup(grp) {
    while (grp.children.length) {
      const ch = grp.children.pop();
      ch.traverse((o) => {
        if (o.userData?.sharedProto) return;
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry && !o.userData?.sharedGeo) {
          o.geometry.dispose();
        }
      });
    }
  }

  let lastClearanceSig = "";
  let lastPerimeterVisMask = "1".repeat(perimeterScenery.length);

  function updatePerimeterTreeClearance(world) {
    const creations = world?.creations || [];
    const paths = world?.paths || [];
    let sig = `${creations.length}:${paths.length}`;
    for (let i = 0; i < creations.length; i++) {
      const c = creations[i];
      sig += `|${c.id}:${Math.round((c.x || 0) * 10)}:${Math.round((c.z || 0) * 10)}:${c.scaleClass || ""}`;
    }
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      const pts = p.points || [];
      const p0 = pts[0];
      const pN = pts[pts.length - 1];
      sig += `;${p.id}:${p.kind}:${pts.length}:${p0 ? `${p0[0]},${p0[1]}` : ""}:${pN ? `${pN[0]},${pN[1]}` : ""}`;
    }
    if (sig === lastClearanceSig) return;
    lastClearanceSig = sig;

    const sampledPaths = paths
      .filter((p) => Array.isArray(p.points) && p.points.length >= 2)
      .map((p) => {
        const vecs = p.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
        const curve = new THREE.CatmullRomCurve3(vecs, Boolean(p.closed), "centripetal", 0.5);
        const len = Math.max(3, curve.getLength());
        return {
          clearance: p.kind === "road" ? 3.8 : p.kind === "cottage_road" ? 2.75 : 2.35,
          pts: curve.getSpacedPoints(Math.min(120, Math.max(12, Math.round(len * 0.6)))),
        };
      });

    let visMask = "";
    const visibleEntries = [];
    for (const item of perimeterScenery) {
      let blocked = false;
      for (const c of creations) {
        if (c.category === "aircraft" || c.behavior?.type === "fly_circle") continue;
        const fr = getCreationFootprintRadius(
          c.scaleClass,
          c.blueprint?.stats?.footprintX ?? 14,
          c.blueprint?.stats?.footprintZ ?? 14,
        );
        if (Math.hypot(item.x - c.x, item.z - c.z) < fr + 3.0) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        for (const sp of sampledPaths) {
          for (let i = 0; i + 1 < sp.pts.length; i++) {
            const a = sp.pts[i];
            const b = sp.pts[i + 1];
            if (distToSeg2D(item.x, item.z, a.x, a.z, b.x, b.z) < sp.clearance) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
      }
      item.blocked = blocked;
      visMask += blocked ? "0" : "1";
      if (!blocked) visibleEntries.push(item);
    }

    if (visMask !== lastPerimeterVisMask) {
      lastPerimeterVisMask = visMask;
      disposeStaticBatchGroup(perimeterTreesGroup);
      const merged = mergeVoxelMeshInstances(visibleEntries, {
        depthLayer: 0,
        castShadow: true,
        receiveShadow: true,
      });
      if (merged) perimeterTreesGroup.add(merged);
    }
  }

  const sharedDashGeo = new THREE.BoxGeometry(0.2, 0.026, 1.3);
  const sharedDashMat = new THREE.MeshBasicMaterial({
    color: "#f6eed8",
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -4,
  });
  const tmpDashMatrix = new THREE.Matrix4();
  const tmpDashPos = new THREE.Vector3();
  const tmpDashQuat = new THREE.Quaternion();
  const tmpDashScale = new THREE.Vector3(1, 1, 1);
  const dashAxisY = new THREE.Vector3(0, 1, 0);
  let lastPathsPropsSig = "";

  function rebuildPathsAndProps(world) {
    const allPaths = world.paths || [];
    const allProps = world.props || [];
    let sig = `${allPaths.length}:${allProps.length}`;
    for (let i = 0; i < allPaths.length; i++) {
      const p = allPaths[i];
      sig += `|${p.id}:${p.kind}:${p.closed ? 1 : 0}:`;
      const pts = p.points || [];
      for (let j = 0; j < pts.length; j++) {
        sig += `${pts[j][0]},${pts[j][1]};`;
      }
    }
    for (let i = 0; i < allProps.length; i++) {
      const pr = allProps[i];
      sig += `|${pr.id || pr.kind}:${pr.x}:${pr.z}:${pr.yaw || 0}:${pr.radius || 0}:${pr.variant || 0}`;
    }
    if (sig === lastPathsPropsSig) return;
    lastPathsPropsSig = sig;

    disposeStaticBatchGroup(pathsGroup);
    disposeStaticBatchGroup(propsGroup);

    const ribbonBuckets = new Map();
    const pushRibbon = (polyOffset, slice) => {
      let arr = ribbonBuckets.get(polyOffset);
      if (!arr) {
        arr = [];
        ribbonBuckets.set(polyOffset, arr);
      }
      arr.push(slice);
    };
    const dashTransforms = [];
    const pathVoxLayer1NoShadow = [];
    const pathVoxLayer2NoShadow = [];
    const pathVoxLayer2PlankShadow = [];

    const roadSamples = allPaths
      .filter((rp) => rp.kind === "road" && rp.points && rp.points.length >= 2)
      .map((rp, rIdx) => {
        const rVecs = rp.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
        const rCurve = new THREE.CatmullRomCurve3(rVecs, Boolean(rp.closed), "centripetal", 0.5);
        const rLen = Math.max(4, rCurve.getLength());
        return {
          id: rp.id,
          rank: rp.id === "path-main-loop" ? 0 : rp.closed ? 1 : 2 + rIdx,
          pts: rCurve.getSpacedPoints(Math.min(180, Math.max(28, Math.round(rLen * 1.5)))),
        };
      });

    const snapRoadTJunctionEnd = (endVec, selfId) => {
      let bestCp = null;
      let bestDist = Infinity;
      for (const rc of roadSamples) {
        if (rc.id === selfId) continue;
        for (let i = 0; i < rc.pts.length - 1; i++) {
          const a = rc.pts[i];
          const b = rc.pts[i + 1];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const l2 = dx * dx + dz * dz;
          const t =
            l2 > 1e-6
              ? Math.max(0, Math.min(1, ((endVec.x - a.x) * dx + (endVec.z - a.z) * dz) / l2))
              : 0;
          const cx = a.x + dx * t;
          const cz = a.z + dz * t;
          const d = Math.hypot(endVec.x - cx, endVec.z - cz);
          if (d < bestDist) {
            bestDist = d;
            bestCp = { x: cx, z: cz };
          }
        }
      }
      if (!bestCp || bestDist > 3.35) return null;
      return new THREE.Vector3(bestCp.x, 0, bestCp.z);
    };

    const nearOtherRoadCenter = (px, pz, selfId) => {
      for (const rc of roadSamples) {
        if (rc.id === selfId) continue;
        for (let i = 0; i < rc.pts.length; i++) {
          if (Math.hypot(px - rc.pts[i].x, pz - rc.pts[i].z) < 2.85) return true;
        }
      }
      return false;
    };

    for (let pIdx = 0; pIdx < allPaths.length; pIdx++) {
      const p = allPaths[pIdx];
      if (!p.points || p.points.length < 2) continue;
      const vecs = p.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
      let tJunctionStart = false;
      let tJunctionEnd = false;
      if (p.kind === "road" && !p.closed) {
        const extStart = snapRoadTJunctionEnd(vecs[0], p.id);
        if (extStart) {
          vecs[0] = extStart;
          tJunctionStart = true;
        }
        const extEnd = snapRoadTJunctionEnd(vecs[vecs.length - 1], p.id);
        if (extEnd) {
          vecs[vecs.length - 1] = extEnd;
          tJunctionEnd = true;
        }
      }
      const curve = new THREE.CatmullRomCurve3(vecs, Boolean(p.closed), "centripetal", 0.5);
      const len = Math.max(2.5, curve.getLength());
      const samples = Math.min(200, Math.max(28, Math.round(len * 1.45)));

      if (p.kind === "road") {
        const isPrimaryRoad = p.id === "path-main-loop" || Boolean(p.closed);
        const asphaltY = isPrimaryRoad ? 0.091 : Math.max(0.084, 0.089 - Math.min(5, pIdx) * 0.001);
        const asphaltPoly = isPrimaryRoad ? -2.3 : -2.0;
        pushRibbon(-1, buildRibbonSliceData(curve, samples, 2.52, 0.052, "#dfd7c5", true));
        pushRibbon(asphaltPoly, buildRibbonSliceData(curve, samples, 2.1, asphaltY, "#4b505c", true));

        const dashCount = Math.floor(len / 3.4);
        for (let i = 0; i < dashCount; i++) {
          const u = (i + 0.5) / dashCount;
          const distFromStart = u * len;
          const distFromEnd = (1 - u) * len;
          if ((tJunctionStart && distFromStart < 2.8) || (tJunctionEnd && distFromEnd < 2.8)) {
            continue;
          }
          const pt = curve.getPointAt(u);
          if (!isPrimaryRoad && nearOtherRoadCenter(pt.x, pt.z, p.id)) continue;
          const tan = curve.getTangentAt(u);
          dashTransforms.push(pt.x, 0.106, pt.z, Math.atan2(tan.x, tan.z));
        }
      } else if (p.kind === "cottage_road") {
        // Warm country honey-gravel cottage lane with twin wheel tracks, sandy-clover center crown & fieldstone border stones
        const zBias = Math.min(28, pIdx) * 0.00022;
        pushRibbon(-1, buildRibbonSliceData(curve, samples, 1.24, 0.032 - zBias, "#c5b089", true));
        pushRibbon(-2, buildRibbonSliceData(curve, samples, 0.90, 0.048 - zBias, "#e6d8b9", true));
        pushRibbon(-2.5, buildRibbonSliceData(curve, samples, 0.24, 0.056 - zBias, "#bda67b", true));

        const borderCount = Math.max(2, Math.floor(len / 2.2));
        for (let i = 1; i < borderCount; i++) {
          const u = i / borderCount;
          const pt = curve.getPointAt(u);
          const tan = curve.getTangentAt(u);
          const side = i % 2 === 0 ? 1 : -1;
          const nx = -tan.z * side;
          const nz = tan.x * side;
          pathVoxLayer1NoShadow.push({
            mesh: cottageBorderProtos[i % cottageBorderProtos.length],
            x: pt.x + nx * 1.14,
            y: -0.11,
            z: pt.z + nz * 1.14,
            rotY: Math.atan2(tan.x, tan.z) + (((i * 3) % 5) - 2) * 0.12,
          });
        }
      } else if (p.kind === "dirt_trail") {
        // Gentle country dirt path with rounded ends, soft sandy-loam edge & subtle border stones
        const zBias = Math.min(28, pIdx) * 0.00022;
        pushRibbon(-1, buildRibbonSliceData(curve, samples, 0.98, 0.03 - zBias, "#bfa074", true));
        pushRibbon(-2, buildRibbonSliceData(curve, samples, 0.68, 0.045 - zBias, "#9b7248", true));

        const pebbleCount = Math.max(2, Math.floor(len / 2.8));
        for (let i = 1; i < pebbleCount; i++) {
          const u = i / pebbleCount;
          const pt = curve.getPointAt(u);
          const tan = curve.getTangentAt(u);
          const side = i % 2 === 0 ? 1 : -1;
          const nx = -tan.z * side;
          const nz = tan.x * side;
          pathVoxLayer1NoShadow.push({
            mesh: dirtPebbleProtos[i % dirtPebbleProtos.length],
            x: pt.x + nx * 0.88,
            y: -0.115,
            z: pt.z + nz * 0.88,
            rotY: (i * 1.9) % (Math.PI * 2),
          });
        }
      } else if (p.kind === "cobblestone") {
        // Refined warm stone cobble walkway with rounded limestone bed & staggered low-profile pavers
        const zBias = Math.min(28, pIdx) * 0.00022;
        pushRibbon(-1, buildRibbonSliceData(curve, samples, 0.88, 0.036 - zBias, "#c4baa6", true));
        const cobbleCount = Math.max(3, Math.floor(len / 0.95));
        for (let i = 0; i <= cobbleCount; i++) {
          const u = i / cobbleCount;
          const pt = curve.getPointAt(u);
          const tan = curve.getTangentAt(u);
          const side = ((i % 3) - 1) * 0.16;
          const nx = -tan.z * side;
          const nz = tan.x * side;
          pathVoxLayer2NoShadow.push({
            mesh: cobbleProtos[i % cobbleProtos.length],
            x: pt.x + nx,
            y: -0.115,
            z: pt.z + nz,
            rotY: Math.atan2(tan.x, tan.z) + (((i * 5) % 7) - 3) * 0.14,
          });
        }
      } else if (p.kind === "boardwalk") {
        // Cohesive timber plank boardwalk over continuous dark-oak stringer rails
        const zBias = Math.min(28, pIdx) * 0.00022;
        pushRibbon(-1, buildRibbonSliceData(curve, samples, 0.62, 0.032 - zBias, "#6b4b30", true));
        const plankCount = Math.max(4, Math.floor(len / 0.78));
        for (let i = 0; i <= plankCount; i++) {
          const u = i / plankCount;
          const pt = curve.getPointAt(u);
          const tan = curve.getTangentAt(u);
          pathVoxLayer2PlankShadow.push({
            mesh: boardwalkPlankProtos[i % boardwalkPlankProtos.length],
            x: pt.x,
            y: -0.145,
            z: pt.z,
            rotY: Math.atan2(tan.x, tan.z),
          });
        }
      } else if (p.kind === "volcanic_trail") {
        // Charred obsidian basalt path with staggered ember stones
        const zBias = Math.min(28, pIdx) * 0.00022;
        pushRibbon(-1, buildRibbonSliceData(curve, samples, 0.92, 0.038 - zBias, "#2b2d36", true));
        const stepCount = Math.max(3, Math.floor(len / 1.35));
        for (let i = 0; i <= stepCount; i++) {
          const u = i / stepCount;
          const pt = curve.getPointAt(u);
          const tan = curve.getTangentAt(u);
          pathVoxLayer2NoShadow.push({
            mesh: volcanicStepProtos[i % volcanicStepProtos.length],
            x: pt.x,
            y: -0.135,
            z: pt.z,
            rotY: Math.atan2(tan.x, tan.z) + (((i % 3) - 1) * 0.15),
          });
        }
      } else {
        // Airy garden stepping flagstones with gentle left/right walking rhythm
        const stoneCount = Math.max(2, Math.floor(len / 1.22));
        for (let i = 0; i <= stoneCount; i++) {
          const u = stoneCount === 0 ? 0.5 : i / stoneCount;
          const pt = curve.getPointAt(u);
          const tan = curve.getTangentAt(u);
          const sway = (i % 2 === 0 ? 1 : -1) * 0.1;
          const nx = -tan.z * sway;
          const nz = tan.x * sway;
          pathVoxLayer1NoShadow.push({
            mesh: flagstoneProtos[i % flagstoneProtos.length],
            x: pt.x + nx,
            y: -0.155,
            z: pt.z + nz,
            rotY: Math.atan2(tan.x, tan.z) + (((i % 3) - 1) * 0.08),
            scaleX: 1.0 + (i % 2) * 0.1,
            scaleY: 1,
            scaleZ: 0.92 + ((i + 1) % 2) * 0.1,
          });
        }
      }
    }

    for (const [polyOffset, slices] of ribbonBuckets.entries()) {
      const mergedRibbon = buildMergedRibbonMesh(slices, polyOffset, true);
      if (mergedRibbon) pathsGroup.add(mergedRibbon);
    }

    const totalDashes = dashTransforms.length >> 2;
    if (totalDashes > 0) {
      const dashInstanced = new THREE.InstancedMesh(sharedDashGeo, sharedDashMat, totalDashes);
      for (let i = 0; i < totalDashes; i++) {
        const b4 = i * 4;
        tmpDashPos.set(dashTransforms[b4], dashTransforms[b4 + 1], dashTransforms[b4 + 2]);
        tmpDashQuat.setFromAxisAngle(dashAxisY, dashTransforms[b4 + 3]);
        tmpDashMatrix.compose(tmpDashPos, tmpDashQuat, tmpDashScale);
        dashInstanced.setMatrixAt(i, tmpDashMatrix);
      }
      dashInstanced.instanceMatrix.needsUpdate = true;
      dashInstanced.frustumCulled = false;
      dashInstanced.matrixAutoUpdate = false;
      dashInstanced.updateMatrix();
      dashInstanced.userData.sharedGeo = true;
      dashInstanced.userData.sharedMaterial = true;
      pathsGroup.add(dashInstanced);
    }

    const mergedPathL1 = mergeVoxelMeshInstances(pathVoxLayer1NoShadow, {
      depthLayer: 1,
      castShadow: false,
      receiveShadow: true,
    });
    if (mergedPathL1) pathsGroup.add(mergedPathL1);

    const mergedPathL2 = mergeVoxelMeshInstances(pathVoxLayer2NoShadow, {
      depthLayer: 2,
      castShadow: false,
      receiveShadow: true,
    });
    if (mergedPathL2) pathsGroup.add(mergedPathL2);

    const mergedPlanks = mergeVoxelMeshInstances(pathVoxLayer2PlankShadow, {
      depthLayer: 2,
      castShadow: true,
      receiveShadow: true,
    });
    if (mergedPlanks) pathsGroup.add(mergedPlanks);

    buildBatchedWorldProps(allProps, propsGroup);
  }

  function frameActiveWorldForOg() {
    if (!currentWorld) return;
    const creations = currentWorld.creations || [];
    const userLandmarks = creations.filter((c) => !c.isSeed && c.behavior?.type === "landmark");
    const aspect = Math.max(0.5, window.innerWidth / Math.max(1, window.innerHeight));
    const blend = aspect < 0.75 ? 0.16 : aspect < 1.15 ? 0.26 : 0.38;
    let cx = 0;
    let cz = -3;
    if (userLandmarks.length > 0) {
      const latest = userLandmarks[userLandmarks.length - 1];
      cx = Math.max(-18, Math.min(18, latest.x * blend));
      cz = Math.max(-18, Math.min(18, latest.z * blend - 2));
    }
    const zoom = aspect < 0.75 ? 0.64 : aspect < 1.15 ? 0.82 : 0.94;
    introSweep.active = false;
    cam.tx = cam.goalTx = cx;
    cam.ty = cam.goalTy = 0;
    cam.tz = cam.goalTz = cz;
    cam.zoom = cam.goalZoom = zoom;
    cam.az = cam.goalAz = 0.64;
    cam.el = cam.goalEl = 0.64;
    highlightedId = null;
    for (const ent of creationEntities.values()) {
      ent.spawnScale = 1.0;
    }
  }

  function applyLiveFeeds(feedsMap) {
    liveFeedsById = feedsMap || {};
    let unbatchedAny = false;
    for (const [id, ent] of creationEntities.entries()) {
      const wasBatched = ent.batchedInChunk;
      ent.setLiveFeedReading(liveFeedsById[id] || null, maxAniso);
      if (wasBatched && ent.hasActiveFeed) {
        ent.batchedInChunk = false;
        if (ent.staticGeoDisposed) {
          ent.rebuildBehavior(ent.data, creationsGroup);
          ent.setLiveFeedReading(liveFeedsById[id] || null, maxAniso);
        } else if (ent.group && !ent.group.parent) {
          creationsGroup.add(ent.group);
        }
        unbatchedAny = true;
      }
    }
    if (unbatchedAny) {
      staticChunksDirty = true;
      rebuildStaticLandmarkChunks();
    }
  }

  let worldSnapshotGen = 0;
  let isStreamingCreations = false;
  const pendingCreationSpecs = new Map();
  let staticChunksDirty = true;
  let lastStaticChunkSig = "";

  function isEntityBatchableStatic(ent) {
    if (!ent || !ent.data?.isSeed) return false;
    if (ent.id === highlightedId) return false;
    if (ent.isDualTransit || ent.isVegasSphere) return false;
    if (ent.interactive || ent.hasActiveFeed || ent.feedMesh) return false;
    if (ent.group?.userData?.animate || (ent.group?.userData?.animatorCount || 0) > 0) return false;
    const bType = ent.data?.behavior?.type;
    if (
      bType === "vehicle_route" ||
      bType === "wander" ||
      bType === "water_float" ||
      bType === "fly_circle"
    ) {
      return false;
    }
    return ent.spawnScale >= 1.0 && Boolean(ent.group);
  }

  function rebuildStaticLandmarkChunks() {
    if (isStreamingCreations) return;

    const batchable = [];
    let sigParts = [];
    for (const ent of creationEntities.values()) {
      if (isEntityBatchableStatic(ent)) {
        batchable.push(ent);
        sigParts.push(`${ent.id}:${ent.blueprintSig}:${ent.x.toFixed(1)},${ent.z.toFixed(1)},${ent.yaw.toFixed(2)}`);
      } else if (ent.batchedInChunk) {
        ent.batchedInChunk = false;
        if (ent.staticGeoDisposed) {
          ent.rebuildBehavior(ent.data, creationsGroup);
        } else if (ent.group && !ent.group.parent) {
          creationsGroup.add(ent.group);
        }
      }
    }

    const nextSig = sigParts.join("|");
    if (!staticChunksDirty && nextSig === lastStaticChunkSig) {
      return;
    }

    // Restore any already-disposed batched entities so a clean merge never misses geometry
    for (let i = 0; i < batchable.length; i++) {
      const ent = batchable[i];
      if (ent.staticGeoDisposed) {
        ent.batchedInChunk = false;
        ent.staticGeoDisposed = false;
        const freshGroup = buildCreationGroup(ent.data.blueprint, {
          seed: 17 + ent.index * 13,
          useWorldScale: true,
          cullFloorY:
            ent.data.category !== "aircraft" && ent.data.category !== "watercraft" ? 0 : null,
        });
        freshGroup.rotation.order = "YXZ";
        freshGroup.userData.creationId = ent.id;
        ent.group = freshGroup;
      }
      if (typeof ent.data?.behavior?.facingYaw === "number") {
        ent.yaw = ent.data.behavior.facingYaw;
      } else if (typeof ent.data?.yaw === "number") {
        ent.yaw = ent.data.yaw;
      }
      ent.y = 0.004;
    }

    disposeStaticBatchGroup(staticLandmarksGroup);
    lastStaticChunkSig = nextSig;
    staticChunksDirty = false;
    if (batchable.length === 0) return;

    const CHUNK_SIZE = 72;
    const buckets = new Map();

    for (let i = 0; i < batchable.length; i++) {
      const ent = batchable[i];
      const cx = Math.floor(ent.x / CHUNK_SIZE);
      const cz = Math.floor(ent.z / CHUNK_SIZE);
      const chunkKey = `${cx},${cz}`;
      const cosY = Math.cos(ent.yaw);
      const sinY = Math.sin(ent.yaw);
      const chunkEntityMeta = {
        id: ent.id,
        x: ent.x,
        z: ent.z,
        r: ent.footprintRadius || 3.5,
      };

      const children = ent.group.children;
      for (let ci = 0; ci < children.length; ci++) {
        const ch = children[ci];
        if (ch.isMesh) {
          const layer = ch.userData?.depthLayer ?? 0;
          const cast = ch.castShadow ? 1 : 0;
          const key = `${chunkKey}|${layer}|${cast}`;
          let b = buckets.get(key);
          if (!b) {
            b = { layer, cast: Boolean(cast), entries: [], entityMetas: new Map() };
            buckets.set(key, b);
          }
          b.entries.push({
            mesh: ch,
            x: ent.x,
            y: ent.y,
            z: ent.z,
            rotY: ent.yaw,
            scaleX: ch.scale.x,
            scaleY: ch.scale.y,
            scaleZ: ch.scale.z,
          });
          b.entityMetas.set(ent.id, chunkEntityMeta);
        } else if (ch.children && ch.children.length > 0) {
          const px = ch.position.x;
          const py = ch.position.y;
          const pz = ch.position.z;
          const wx = ent.x + px * cosY + pz * sinY;
          const wy = ent.y + py;
          const wz = ent.z - px * sinY + pz * cosY;
          for (let pi = 0; pi < ch.children.length; pi++) {
            const pm = ch.children[pi];
            if (!pm.isMesh) continue;
            const layer = pm.userData?.depthLayer ?? 1;
            const cast = pm.castShadow ? 1 : 0;
            const key = `${chunkKey}|${layer}|${cast}`;
            let b = buckets.get(key);
            if (!b) {
              b = { layer, cast: Boolean(cast), entries: [], entityMetas: new Map() };
              buckets.set(key, b);
            }
            b.entries.push({
              mesh: pm,
              x: wx,
              y: wy,
              z: wz,
              rotY: ent.yaw,
              scaleX: pm.scale.x,
              scaleY: pm.scale.y,
              scaleZ: pm.scale.z,
            });
            b.entityMetas.set(ent.id, chunkEntityMeta);
          }
        }
      }
    }

    for (const bucket of buckets.values()) {
      const merged = mergeVoxelMeshInstances(bucket.entries, {
        depthLayer: bucket.layer,
        castShadow: bucket.cast,
        receiveShadow: true,
      });
      if (merged) {
        merged.userData.isStaticChunk = true;
        merged.userData.chunkEntities = Array.from(bucket.entityMetas.values());
        staticLandmarksGroup.add(merged);
      }
    }

    // Remove individual unmerged groups and release source geometries now consolidated into chunks
    for (let i = 0; i < batchable.length; i++) {
      const ent = batchable[i];
      creationsGroup.remove(ent.group);
      ent.group.userData.dispose?.();
      ent.batchedInChunk = true;
      ent.staticGeoDisposed = true;
    }
  }

  function instantiateCreationSpec(spec) {
    const { c, idx } = spec;
    if (creationEntities.has(c.id)) return creationEntities.get(c.id);
    const ent = new CreationSimEntity(
      c,
      idx,
      callbacks.onInteractiveEvent || null,
      creationsGroup,
    );
    if (ogMode) ent.spawnScale = 1.0;
    ent.setLiveFeedReading(liveFeedsById[c.id] || null, maxAniso);
    creationEntities.set(c.id, ent);
    creationsGroup.add(ent.group);
    if (isEntityBatchableStatic(ent)) {
      staticChunksDirty = true;
    }
    markSceneListsDirty();
    return ent;
  }

  function ensureCreationBuilt(id) {
    if (!id || creationEntities.has(id)) return creationEntities.get(id) || null;
    const spec = pendingCreationSpecs.get(id);
    if (!spec) return null;
    pendingCreationSpecs.delete(id);
    const ent = instantiateCreationSpec(spec);
    if (ent.data.behavior?.type === "vehicle_route") {
      deBunchVehicleRoutes(creationEntities);
    }
    return ent;
  }

  const yieldToNextFrame = () =>
    typeof requestAnimationFrame === "function" &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible"
      ? new Promise((resolve) => requestAnimationFrame(() => resolve()))
      : new Promise((resolve) => setTimeout(resolve, 0));

  async function streamRemainingCreations(gen) {
    isStreamingCreations = true;
    while (gen === worldSnapshotGen && pendingCreationSpecs.size > 0) {
      await yieldToNextFrame();
      if (gen !== worldSnapshotGen || pendingCreationSpecs.size === 0) break;
      const sliceStart = performance.now();
      let builtVehicle = false;
      for (const [id, spec] of pendingCreationSpecs) {
        pendingCreationSpecs.delete(id);
        const ent = instantiateCreationSpec(spec);
        if (ent.data.behavior?.type === "vehicle_route") builtVehicle = true;
        if (performance.now() - sliceStart >= 6.5) break;
      }
      if (builtVehicle) {
        deBunchVehicleRoutes(creationEntities);
      }
    }
    if (gen === worldSnapshotGen) {
      isStreamingCreations = false;
      deBunchVehicleRoutes(creationEntities);
      rebuildStaticLandmarkChunks();
      markSceneListsDirty();
      if (!ogMode && !hasWalkedOnce && !fp.active && !introSweep.firedWalk) {
        const [rx, rz] = resolveWalkPosition(fp.x, fp.z);
        fp.x = rx;
        fp.z = rz;
        fp.feetY = getIslandGroundHeight(rx, rz);
        fp.y = fp.feetY + FP_EYE_HEIGHT;
        introSweep.walkX = rx;
        introSweep.walkZ = rz;
        const nextYaw = Math.atan2(-(2.4 - rx), -(-18.5 - rz));
        introSweep.walkYaw = nextYaw;
        fp.yaw = fp.goalYaw = nextYaw;
      }
    }
  }

  function applyWorldSnapshot(world) {
    const myGen = ++worldSnapshotGen;
    pendingCreationSpecs.clear();
    isStreamingCreations = false;

    currentWorld = world;
    const contribCount =
      typeof world.contributionCount === "number"
        ? world.contributionCount
        : (world.creations || []).filter((c) => !c.isSeed && !c.isCompanion).length;
    citySignboard.setTargetCount(contribCount, ogMode || prefersReducedMotion);
    updateBiomeShaderUniforms(world.terrainZones || []);
    updatePerimeterTreeClearance(world);
    rebuildPathsAndProps(world);

    const seenIds = new Set();
    const newSpecs = [];
    world.creations.forEach((c, idx) => {
      seenIds.add(c.id);
      const existing = creationEntities.get(c.id);
      if (existing) {
        existing.onInteractiveEvent = callbacks.onInteractiveEvent || null;
        existing.rebuildBehavior(c, creationsGroup);
        existing.setLiveFeedReading(liveFeedsById[c.id] || null, maxAniso);
      } else {
        newSpecs.push({ c, idx });
      }
    });
    for (const [id, ent] of creationEntities.entries()) {
      if (!seenIds.has(id)) {
        if (ent.batchedInChunk) staticChunksDirty = true;
        creationsGroup.remove(ent.group);
        ent.dispose(creationsGroup);
        creationEntities.delete(id);
      }
    }

    if (ogMode || newSpecs.length <= 8) {
      for (const spec of newSpecs) {
        instantiateCreationSpec(spec);
      }
    } else {
      const refX = fp.active ? fp.x : cam.tx;
      const refZ = fp.active ? fp.z : cam.tz;
      newSpecs.sort((a, b) => {
        const pa = a.c.id === world.myCreationId || a.c.id === highlightedId ? 0 : 1;
        const pb = b.c.id === world.myCreationId || b.c.id === highlightedId ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const va = a.c.behavior?.type === "vehicle_route" ? 0 : 1;
        const vb = b.c.behavior?.type === "vehicle_route" ? 0 : 1;
        if (va !== vb) return va - vb;
        const da = (a.c.x - refX) ** 2 + (a.c.z - refZ) ** 2;
        const db = (b.c.x - refX) ** 2 + (b.c.z - refZ) ** 2;
        return da - db;
      });

      const syncStart = performance.now();
      let cursor = 0;
      while (cursor < newSpecs.length) {
        const spec = newSpecs[cursor];
        const mustBuildNow =
          cursor < 4 ||
          spec.c.id === world.myCreationId ||
          spec.c.id === highlightedId ||
          spec.c.behavior?.type === "vehicle_route";
        if (!mustBuildNow && performance.now() - syncStart >= 6.5) {
          break;
        }
        instantiateCreationSpec(spec);
        cursor++;
      }

      if (cursor < newSpecs.length) {
        for (let i = cursor; i < newSpecs.length; i++) {
          pendingCreationSpecs.set(newSpecs[i].c.id, newSpecs[i]);
        }
        void streamRemainingCreations(myGen);
      }
    }

    deBunchVehicleRoutes(creationEntities);
    if (!isStreamingCreations) {
      rebuildStaticLandmarkChunks();
    }

    const seenVillagers = new Set();
    world.villagers.forEach((v, idx) => {
      seenVillagers.add(v.id);
      const existing = villagerAgents.get(v.id);
      if (existing) {
        existing.updateFromServer(v);
      } else {
        const agent = new VillagerAgent(v, idx);
        villagerAgents.set(v.id, agent);
        villagersGroup.add(agent.group);
      }
    });
    for (const [id, ag] of villagerAgents.entries()) {
      if (!seenVillagers.has(id)) {
        villagersGroup.remove(ag.group);
        ag.dispose();
        villagerAgents.delete(id);
      }
    }
    markSceneListsDirty();

    if (interiorSystem?.isInside?.()) {
      const curRoomId = interiorSystem.getCurrentRoomId();
      if (curRoomId && !seenIds.has(curRoomId)) {
        exitCurrentBuilding();
      }
    }
    if (interiorSystem?.isRiding?.()) {
      const rState = interiorSystem.getRidingState();
      const baseRideId = rState?.rideId ? String(rState.rideId).replace(/#(?:sec|tram)$/, "") : "";
      if (baseRideId && !seenIds.has(baseRideId)) {
        hopOffCurrentVehicle();
      }
    }
    if (!ogMode && !hasWalkedOnce && !fp.active) {
      const [rx, rz] = resolveWalkPosition(fp.x, fp.z);
      fp.x = rx;
      fp.z = rz;
      fp.feetY = getIslandGroundHeight(rx, rz);
      fp.y = fp.feetY + FP_EYE_HEIGHT;
      introSweep.walkX = rx;
      introSweep.walkZ = rz;
      const nextYaw = Math.atan2(-(2.4 - rx), -(-18.5 - rz));
      introSweep.walkYaw = nextYaw;
      fp.yaw = fp.goalYaw = nextYaw;
    }

    if (ogMode) {
      frameActiveWorldForOg();
      ogSettledFrames = 0;
    } else if (world.myCreationId && !highlightedId) {
      highlightedId = world.myCreationId;
    }
  }

  function setSpotPickerState(next) {
    const mode = next?.mode || "hidden";
    if (mode !== "hidden") {
      cancelIntroSweep("pan");
    }
    let nx = typeof next?.x === "number" ? next.x : spotState.x;
    let nz = typeof next?.z === "number" ? next.z : spotState.z;
    if (mode === "picking" && typeof next?.x !== "number") {
      const def = snapToClearMeadowSpot(cam.goalTx + 14, cam.goalTz + 8, previewPlotRadius);
      nx = def[0];
      nz = def[1];
    }
    spotState = { mode, x: nx, z: nz };

    if (mode === "hidden") {
      plotMarker.group.visible = false;
      plotMarker.scaffoldGroup.visible = false;
      canvas.style.cursor = "grab";
    } else if (mode === "picking") {
      plotMarker.group.visible = true;
      plotMarker.scaffoldGroup.visible = false;
      plotMarker.ringMat.color.setHex(0xffffff);
      plotMarker.group.position.set(nx, 0, nz);
      canvas.style.cursor = "crosshair";
    } else if (mode === "staked") {
      plotMarker.group.visible = true;
      plotMarker.scaffoldGroup.visible = false;
      plotMarker.ringMat.color.setHex(0xffe57f);
      plotMarker.group.position.set(nx, 0, nz);
      canvas.style.cursor = "grab";
    } else if (mode === "building") {
      plotMarker.group.visible = true;
      plotMarker.scaffoldGroup.visible = true;
      plotMarker.ringMat.color.setHex(0xffe57f);
      plotMarker.group.position.set(nx, 0, nz);
      canvas.style.cursor = "grab";
    }
  }

  let dragMode = "pan";
  const pressedKeys = new Set();
  const fpJoystick = { right: 0, fwd: 0 };
  let fpTouchLook = null;
  let suppressPointerUnlockExit = false;
  let lastUnlockedFpMouse = null;

  function requestWalkPointerLock() {
    if (!fp.active || ogMode) return;
    if (typeof document !== "undefined" && document.querySelector("dialog[open]")) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches) return;
    if (document.pointerLockElement === canvas) return;
    try {
      const maybePromise = canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => {
          try {
            const fallback = canvas.requestPointerLock?.();
            if (fallback && typeof fallback.catch === "function") {
              fallback.catch(() => {});
            }
          } catch {
            // Unclicked free-mouse look handles non-gesture entry seamlessly
          }
        });
      }
    } catch {
      try {
        const fallback = canvas.requestPointerLock?.();
        if (fallback && typeof fallback.catch === "function") {
          fallback.catch(() => {});
        }
      } catch {
        // Ignore unsupported environments
      }
    }
  }

  function releaseWalkPointerLock() {
    if (document.pointerLockElement === canvas) {
      suppressPointerUnlockExit = true;
      try {
        document.exitPointerLock();
      } catch {
        suppressPointerUnlockExit = false;
      }
      setTimeout(() => {
        suppressPointerUnlockExit = false;
      }, 120);
    }
  }

  function setJoystickInput(right, fwd) {
    const rx = Number.isFinite(right) ? right : 0;
    const fy = Number.isFinite(fwd) ? fwd : 0;
    const mag = Math.hypot(rx, fy);
    if (mag > 1) {
      fpJoystick.right = rx / mag;
      fpJoystick.fwd = fy / mag;
    } else {
      fpJoystick.right = rx;
      fpJoystick.fwd = fy;
    }
  }

  function idleCursor() {
    if (fp.active) return "crosshair";
    if (spotState.mode === "picking" || spotState.mode === "staked") return "crosshair";
    return "grab";
  }

  function isSkateHalfpipeEntity(ent) {
    if (!ent?.data) return false;
    if (ent.id === "c-mvne3zub-216636") return true;
    const name = ent.data.name || "";
    return /\b(half\s*pipe|half-pipe|skate\s*ramp|skatepark\s*halfpipe)\b/i.test(name);
  }

  function getSkateHalfpipeSpec(ent) {
    if (ent._halfpipeSpec) return ent._halfpipeSpec;
    const sc = ent.data?.scaleClass || ent.data?.blueprint?.scaleClass || "medium";
    const voxSize = getWorldVoxelSize(sc);
    const stats = ent.data?.blueprint?.stats || {};
    const halfVoxX = Math.max(6, (Number(stats.footprintX) || 28) * 0.5);
    const halfVoxZ = Math.max(6, (Number(stats.footprintZ) || 20) * 0.5);
    const ops = ent.data?.blueprint?.ops || [];
    const carveCyl = ops.find((op) => op.op === "cylinder" && op.carve);
    const troughAxis = carveCyl?.axis === "x" ? "x" : "z";
    const halfAlongVox = troughAxis === "z" ? halfVoxZ : halfVoxX;
    const halfAcrossVox = troughAxis === "z" ? halfVoxX : halfVoxZ;
    const deckVoxY = Number(carveCyl?.cy) > 2 ? Number(carveCyl.cy) : 9.0;
    const pipeRadiusVox =
      Number(carveCyl?.radius) > 2
        ? Number(carveCyl.radius)
        : Math.max(4.5, halfAcrossVox - 5.0);
    const spec = {
      voxSize,
      troughAxis,
      halfAlongVox,
      halfAcrossVox,
      deckVoxY,
      pipeRadiusVox,
      floorVoxY: 1.0,
    };
    ent._halfpipeSpec = spec;
    return spec;
  }

  function resolveHalfpipeCollision(ent, px, pz, curFeetY) {
    const spec = getSkateHalfpipeSpec(ent);
    const yaw = ent.yaw || 0;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const dx = px - ent.x;
    const dz = pz - ent.z;
    const lx = dx * cosY - dz * sinY;
    const lz = dx * sinY + dz * cosY;

    const voxX = lx / spec.voxSize;
    const voxZ = lz / spec.voxSize;
    let alongVox = spec.troughAxis === "z" ? voxZ : voxX;
    let acrossVox = spec.troughAxis === "z" ? voxX : voxZ;

    const padVox = 0.28 / spec.voxSize;
    const maxAlong = spec.halfAlongVox + padVox;
    const maxAcross = spec.halfAcrossVox + padVox;
    if (Math.abs(alongVox) >= maxAlong || Math.abs(acrossVox) >= maxAcross) {
      return [px, pz];
    }

    const openMouthHalfVox = Math.max(2.5, spec.pipeRadiusVox - 0.65);
    // Open middle U-trough: walk freely in from either open end, right through the middle, and up/down the curved walls!
    if (Math.abs(acrossVox) <= openMouthHalfVox) {
      return [px, pz];
    }
    if (
      Math.abs(alongVox) <= spec.halfAlongVox - 0.55 &&
      Math.abs(acrossVox) <= spec.pipeRadiusVox + 0.15
    ) {
      return [px, pz];
    }

    const deckWorldY = (ent.y || 0) + spec.deckVoxY * spec.voxSize;
    const onElevatedLevel = (curFeetY ?? 0) >= deckWorldY - 0.65;
    if (onElevatedLevel) {
      // Standing on elevated skate deck: allow walking on the deck, bounded by outer safety railings (unless jumping over)
      if ((curFeetY ?? 0) < deckWorldY + 0.55) {
        const railAcross = Math.max(spec.pipeRadiusVox, spec.halfAcrossVox - 1.35);
        const railAlong = Math.max(1.0, spec.halfAlongVox - 1.25);
        acrossVox = Math.max(-railAcross, Math.min(railAcross, acrossVox));
        if (Math.abs(acrossVox) > openMouthHalfVox) {
          alongVox = Math.max(-railAlong, Math.min(railAlong, alongVox));
        }
      }
    } else {
      // Ground-level approach against solid side back-walls or deck end-wings: push/slide along nearest clear face
      const penOuterSide = maxAcross - Math.abs(acrossVox);
      const penOuterEnd = maxAlong - Math.abs(alongVox);
      const penInnerMouth = Math.abs(acrossVox) - openMouthHalfVox;

      if (penInnerMouth <= penOuterSide && penInnerMouth <= penOuterEnd) {
        acrossVox = (acrossVox >= 0 ? 1 : -1) * openMouthHalfVox;
      } else if (penOuterSide <= penOuterEnd) {
        acrossVox = (acrossVox >= 0 ? 1 : -1) * maxAcross;
      } else {
        alongVox = (alongVox >= 0 ? 1 : -1) * maxAlong;
      }
    }

    const outVoxX = spec.troughAxis === "z" ? acrossVox : alongVox;
    const outVoxZ = spec.troughAxis === "z" ? alongVox : acrossVox;
    const outLx = outVoxX * spec.voxSize;
    const outLz = outVoxZ * spec.voxSize;
    return [
      ent.x + outLx * cosY + outLz * sinY,
      ent.z - outLx * sinY + outLz * cosY,
    ];
  }

  function getWalkSurfaceHeight(px, pz, curFeetY) {
    let bestY = getIslandGroundHeight(px, pz);
    for (const ent of creationEntities.values()) {
      if (!isSkateHalfpipeEntity(ent)) continue;
      const spec = getSkateHalfpipeSpec(ent);
      const yaw = ent.yaw || 0;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const dx = px - ent.x;
      const dz = pz - ent.z;
      const lx = dx * cosY - dz * sinY;
      const lz = dx * sinY + dz * cosY;
      const voxX = lx / spec.voxSize;
      const voxZ = lz / spec.voxSize;
      const alongVox = spec.troughAxis === "z" ? voxZ : voxX;
      const acrossVox = spec.troughAxis === "z" ? voxX : voxZ;

      if (
        Math.abs(alongVox) > spec.halfAlongVox + 0.4 ||
        Math.abs(acrossVox) > spec.halfAcrossVox + 0.2
      ) {
        continue;
      }

      const endRampT = Math.max(
        0,
        Math.min(1, (spec.halfAlongVox + 0.4 - Math.abs(alongVox)) / 0.8),
      );
      const endBlend = endRampT * endRampT * (3 - 2 * endRampT);

      if (Math.abs(acrossVox) <= spec.pipeRadiusVox + 0.15) {
        const r = spec.pipeRadiusVox;
        const ax = Math.min(r, Math.abs(acrossVox));
        const rampVoxY = Math.max(
          spec.floorVoxY,
          spec.deckVoxY - Math.sqrt(Math.max(0, r * r - ax * ax)),
        );
        const rawPipeY = Math.max(bestY, (ent.y || 0) + rampVoxY * spec.voxSize);
        const blendedY = bestY + (rawPipeY - bestY) * endBlend;
        if (blendedY > bestY) bestY = blendedY;
      } else {
        const deckY = (ent.y || 0) + spec.deckVoxY * spec.voxSize;
        if ((curFeetY ?? bestY) >= deckY - 0.75 && deckY > bestY) {
          bestY = deckY;
        }
      }
    }
    return bestY;
  }

  function isWalkPointClear(x, z, extraMargin = 0) {
    if (getIslandInlandMargin(x, z) < -5.0 + extraMargin) return false;
    if (Math.hypot(x - CITY_SIGN_POS[0], z - CITY_SIGN_POS[1]) < 1.85 + extraMargin) return false;
    for (const pr of currentWorld?.props || []) {
      if (pr.kind === "pond") {
        if (Math.hypot(x - pr.x, z - pr.z) < (pr.radius || 6.6) + 0.25 + extraMargin) return false;
      } else if (pr.kind === "bus_stop" || pr.kind === "bench" || pr.kind === "lamp_post") {
        if (Math.hypot(x - pr.x, z - pr.z) < 0.48 + extraMargin) return false;
      }
    }
    const baseFeetY = getIslandGroundHeight(x, z);
    for (const ent of creationEntities.values()) {
      if (ent.interactive?.allowWalkOver) continue;
      if (isSkateHalfpipeEntity(ent)) {
        const [hx, hz] = resolveHalfpipeCollision(ent, x, z, baseFeetY);
        if (Math.hypot(hx - x, hz - z) > 0.02) return false;
        continue;
      }
      if (ent.data.category === "building" || ent.data.behavior?.type === "landmark") {
        const box = getBuildingTightBox(ent, 0.8);
        const pushed = pushPointOutOfVehicleOBB(
          x,
          z,
          0.34 + extraMargin,
          ent.x,
          ent.z,
          ent.yaw || 0,
          box.halfX,
          box.halfZ,
        );
        if (pushed) return false;
      }
    }
    return true;
  }

  function resolveWalkPosition(rawX, rawZ, curFeetY = fp.feetY) {
    let x = rawX;
    let z = rawZ;

    const pushOut = (ox, oz, minR) => {
      const dx = x - ox;
      const dz = z - oz;
      const d = Math.hypot(dx, dz);
      if (d < minR) {
        if (d > 1e-4) {
          x = ox + (dx / d) * minR;
          z = oz + (dz / d) * minR;
        } else {
          x = ox + minR;
        }
      }
    };

    for (let pass = 0; pass < 2; pass++) {
      pushOut(CITY_SIGN_POS[0], CITY_SIGN_POS[1], 1.85);
      for (const pr of currentWorld?.props || []) {
        if (pr.kind === "pond") {
          pushOut(pr.x, pr.z, (pr.radius || 6.6) + 0.25);
        } else if (pr.kind === "bus_stop" || pr.kind === "bench" || pr.kind === "lamp_post") {
          pushOut(pr.x, pr.z, 0.48);
        }
      }
      for (const ent of creationEntities.values()) {
        if (ent.interactive?.allowWalkOver) continue;
        if (isSkateHalfpipeEntity(ent)) {
          [x, z] = resolveHalfpipeCollision(ent, x, z, curFeetY);
        } else if (ent.data.category === "building" || ent.data.behavior?.type === "landmark") {
          const box = getBuildingTightBox(ent, 0.8);
          const pushedBld = pushPointOutOfVehicleOBB(
            x,
            z,
            0.34,
            ent.x,
            ent.z,
            ent.yaw || 0,
            box.halfX,
            box.halfZ,
          );
          if (pushedBld) {
            x = pushedBld[0];
            z = pushedBld[1];
          }
        } else if (ent.data.behavior?.type === "vehicle_route") {
          const pushedMain = pushPointOutOfVehicleOBB(
            x,
            z,
            0.38,
            ent.x,
            ent.z,
            ent.yaw || 0,
            ent.phys?.hw || 0.92,
            ent.phys?.hl || 2.1,
          );
          if (pushedMain) {
            x = pushedMain[0];
            z = pushedMain[1];
          }
          if (ent.secondaryVehicle) {
            const sv = ent.secondaryVehicle;
            const pushedSec = pushPointOutOfVehicleOBB(
              x,
              z,
              0.38,
              sv.x,
              sv.z,
              sv.yaw || 0,
              sv.phys?.hw || 0.84,
              sv.phys?.hl || 2.32,
            );
            if (pushedSec) {
              x = pushedSec[0];
              z = pushedSec[1];
            }
          }
        }
      }
      for (const sc of perimeterScenery) {
        if ((sc.isTree || sc.isCoastalRock) && !sc.blocked) {
          pushOut(sc.x, sc.z, sc.isCoastalRock ? 0.85 : 0.52);
        }
      }
      [x, z] = clampPointToIsland(x, z, -5.0);
    }
    return [x, z];
  }

  {
    const [bootX, bootZ] = resolveWalkPosition(fp.x, fp.z, 0);
    fp.x = bootX;
    fp.z = bootZ;
    fp.walkSurfaceY = getWalkSurfaceHeight(bootX, bootZ, 0);
    fp.feetY = fp.walkSurfaceY;
    fp.y = fp.feetY + FP_EYE_HEIGHT;
    introSweep.walkX = bootX;
    introSweep.walkZ = bootZ;
    const bootYaw = Math.atan2(-(2.4 - bootX), -(-18.5 - bootZ));
    introSweep.walkYaw = bootYaw;
    fp.yaw = fp.goalYaw = bootYaw;
  }

  interiorSystem = createInteriorAndTransitSystem({
    scene,
    getCreationEntities: () => creationEntities,
    getWorld: () => currentWorld,
    resolveExteriorWalkPosition: resolveWalkPosition,
  });

  function setLocalAppearance(nextAppearance) {
    localAppearance = sanitizeAppearance(nextAppearance);
    localAvatarRig.setAppearance(localAppearance);
    return { ...localAppearance };
  }

  function getLocalAppearance() {
    return { ...localAppearance };
  }

  function triggerLocalWave() {
    waveTimer = 1.85;
    callbacks.onLocalEmote?.("wave");
    return true;
  }

  function getLocalMultiplayerPose() {
    const room = interiorSystem.getCurrentRoomId();
    const rideState = interiorSystem.getRidingState();
    const seatPose = interiorSystem.isSitting() ? interiorSystem.getSeatPose() : null;
    const mode = fp.active ? "walk" : "aerial";

    if (room) {
      const lx = seatPose ? seatPose.x : fp.localX;
      const ly = seatPose ? seatPose.y : fp.localY;
      const lz = seatPose ? seatPose.z : fp.localZ;
      const anim = seatPose
        ? "sit"
        : fp.jumpY > 0.03
          ? "jump"
          : fp.horizSpeed > 5.8
            ? "run"
            : fp.horizSpeed > 0.35
              ? "walk"
              : waveTimer > 0
                ? "wave"
                : "idle";
      return {
        mode: "walk",
        x: lx,
        y: ly,
        z: lz,
        yaw: fp.yaw,
        pitch: fp.pitch,
        vx: seatPose ? 0 : fp.vx,
        vz: seatPose ? 0 : fp.vz,
        anim,
        ride: null,
        seat: 0,
        room,
      };
    }

    if (fp.active && rideState) {
      return {
        mode: "walk",
        x: fp.x,
        y: fp.feetY,
        z: fp.z,
        yaw: fp.yaw,
        pitch: fp.pitch,
        vx: 0,
        vz: 0,
        anim: "ride",
        ride: rideState.rideId,
        seat: rideState.seat,
        room: null,
      };
    }

    if (fp.active && seatPose) {
      const groundY = getIslandGroundHeight(seatPose.x, seatPose.z);
      return {
        mode: "walk",
        x: seatPose.x,
        y: groundY + seatPose.y,
        z: seatPose.z,
        yaw: fp.yaw,
        pitch: fp.pitch,
        vx: 0,
        vz: 0,
        anim: "sit",
        ride: null,
        seat: 0,
        room: null,
      };
    }

    if (fp.active) {
      const anim =
        fp.jumpY > 0.03
          ? "jump"
          : fp.horizSpeed > 6.4
            ? "run"
            : fp.horizSpeed > 0.35
              ? "walk"
              : waveTimer > 0
                ? "wave"
                : "idle";
      return {
        mode: "walk",
        x: fp.x,
        y: fp.feetY,
        z: fp.z,
        yaw: fp.yaw,
        pitch: fp.pitch,
        vx: fp.vx,
        vz: fp.vz,
        anim,
        ride: null,
        seat: 0,
        room: null,
      };
    }

    return {
      mode,
      x: fp.x,
      y: getWalkSurfaceHeight(fp.x, fp.z, fp.feetY),
      z: fp.z,
      yaw: fp.yaw,
      pitch: 0,
      vx: 0,
      vz: 0,
      anim: waveTimer > 0 ? "wave" : "idle",
      ride: null,
      seat: 0,
      room: null,
    };
  }

  function syncMultiplayerWelcome(playersOrMsg) {
    const list = Array.isArray(playersOrMsg)
      ? playersOrMsg
      : Array.isArray(playersOrMsg?.players)
        ? playersOrMsg.players
        : [];
    remotePlayers.clear();
    for (const p of list) {
      remotePlayers.upsertPeer(p);
    }
  }

  function upsertRemotePlayer(player) {
    return remotePlayers.upsertPeer(player);
  }

  function updateRemotePlayerPose(poseMsg) {
    remotePlayers.updatePeerPose(poseMsg);
  }

  function updateRemotePlayerProfile(idOrMsg, name, appearance) {
    remotePlayers.updatePeerProfile(idOrMsg, name, appearance);
  }

  function triggerRemotePlayerEmote(idOrMsg, kind) {
    remotePlayers.triggerPeerEmote(idOrMsg, kind);
  }

  function removeRemotePlayer(idOrMsg) {
    remotePlayers.removePeer(idOrMsg);
  }

  function getRemotePlayerCount() {
    return remotePlayers.getPeerCount();
  }

  function refreshInteractionTarget() {
    if (ogMode) {
      activeInteractionTarget = null;
      if (lastInteractionPromptKey !== "") {
        lastInteractionPromptKey = "";
        callbacks.onInteractionPromptChange?.(null);
      }
      return null;
    }

    const inside = interiorSystem.isInside();
    const target = interiorSystem.findBestInteractionTarget({
      fpActive: fp.active,
      localX: fp.localX,
      localY: fp.active && inside ? fp.y - INTERIOR_ORIGIN.y : FP_EYE_HEIGHT,
      localZ: fp.localZ,
      worldX: fp.x,
      worldY: fp.y,
      worldZ: fp.z,
      yaw: fp.yaw,
      pitch: fp.pitch,
    });
    activeInteractionTarget = target || null;

    const promptInfo = target
      ? {
          kind: target.kind,
          id: target.id,
          label: target.label,
          keyHint: target.keyHint || "E",
        }
      : null;
    const nextKey = promptInfo
      ? `${promptInfo.kind}|${promptInfo.id}|${promptInfo.label}|${promptInfo.keyHint}`
      : "";
    if (nextKey !== lastInteractionPromptKey) {
      lastInteractionPromptKey = nextKey;
      callbacks.onInteractionPromptChange?.(promptInfo);
    }
    return promptInfo;
  }

  function getActiveInteractionPrompt() {
    if (!activeInteractionTarget) return null;
    return {
      kind: activeInteractionTarget.kind,
      id: activeInteractionTarget.id,
      label: activeInteractionTarget.label,
      keyHint: activeInteractionTarget.keyHint || "E",
    };
  }

  function enterBuildingById(id) {
    if (!id) return false;
    const ent = ensureCreationBuilt(id);
    if (ent?.data && !canEnterCreation(ent.data)) return false;

    cancelIntroSweep("walk");
    if (interiorSystem.isRiding()) {
      hopOffCurrentVehicle();
    } else if (interiorSystem.isSitting() && !interiorSystem.isInside()) {
      const wake = interiorSystem.standUp();
      if (wake?.ok && wake.pose && !wake.pose.isInterior) {
        fp.x = wake.pose.x;
        fp.z = wake.pose.z;
      }
    }

    const res = interiorSystem.enterBuilding(id, {
      x: fp.x,
      z: fp.z,
      yaw: fp.yaw,
      pitch: fp.pitch,
    });
    if (!res?.ok || !res.spawnLocal) return false;

    clearInteractiveHover();
    callbacks.onHoverCreation?.(null, 0, 0, null);
    pointerGesture = null;
    activePointers.clear();
    fpTouchLook = null;

    fp.active = true;
    hasWalkedOnce = true;
    dragMode = "walk";
    fp.settleT = 1;
    fp.localX = res.spawnLocal.x;
    fp.localY = res.spawnLocal.y || 0;
    fp.localZ = res.spawnLocal.z;
    fp.yaw = fp.goalYaw = res.spawnLocal.yaw;
    fp.pitch = fp.goalPitch = res.spawnLocal.pitch;
    fp.vx = 0;
    fp.vz = 0;
    fp.jumpY = 0;
    fp.jumpVy = 0;
    fp.horizSpeed = 0;
    fp.sprinting = false;
    fp.y = INTERIOR_ORIGIN.y + fp.localY + FP_EYE_HEIGHT;

    localAvatarRig.setFirstPersonMode(true);
    skyDome.visible = true;
    skyDome.position.set(INTERIOR_ORIGIN.x, INTERIOR_ORIGIN.y - 12, INTERIOR_ORIGIN.z);
    sun.intensity = 0.28;
    hemi.intensity = 0.68;
    fpCamera.position.set(
      INTERIOR_ORIGIN.x + fp.localX,
      fp.y,
      INTERIOR_ORIGIN.z + fp.localZ,
    );
    fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
    fpCamera.updateMatrixWorld();
    syncComposerCamera(fpCamera);
    canvas.style.cursor = idleCursor();
    lastUnlockedFpMouse = null;
    callbacks.onDragModeChange?.("walk");
    callbacks.onInteriorChange?.({
      roomId: res.roomId,
      name: res.creation?.name || "",
    });
    refreshInteractionTarget();
    requestWalkPointerLock();
    return true;
  }

  function exitCurrentBuilding() {
    if (!interiorSystem.isInside()) return false;
    const res = interiorSystem.exitBuilding();
    if (!res?.ok || !res.exteriorPose) return false;

    clearInteractiveHover();
    fp.x = res.exteriorPose.x;
    fp.z = res.exteriorPose.z;
    fp.yaw = fp.goalYaw = res.exteriorPose.yaw;
    fp.pitch = fp.goalPitch = res.exteriorPose.pitch;
    fp.vx = 0;
    fp.vz = 0;
    fp.jumpY = 0;
    fp.jumpVy = 0;
    fp.horizSpeed = 0;
    fp.sprinting = false;
    fp.settleT = 1;
    const gY = getIslandGroundHeight(fp.x, fp.z);
    fp.feetY = gY;
    fp.y = gY + FP_EYE_HEIGHT;

    sun.intensity = 2.25;
    hemi.intensity = 1.12;
    if (fp.active) {
      skyDome.visible = true;
      skyDome.position.set(fp.x, 0, fp.z);
      fpCamera.position.set(fp.x, fp.y, fp.z);
      fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
      fpCamera.updateMatrixWorld();
    }
    callbacks.onInteriorChange?.(null);
    refreshInteractionTarget();
    return true;
  }

  function boardVehicleById(rideId, preferredSeat = 0) {
    if (!rideId) return false;
    const baseId = String(rideId).replace(/#(?:sec|tram)$/, "");
    ensureCreationBuilt(baseId);
    cancelIntroSweep("walk");

    const wasInside = interiorSystem.isInside();
    const res = interiorSystem.boardVehicle(rideId, preferredSeat);
    if (!res?.ok || !res.pose) return false;

    if (wasInside) {
      callbacks.onInteriorChange?.(null);
    }
    clearInteractiveHover();
    callbacks.onHoverCreation?.(null, 0, 0, null);
    pointerGesture = null;
    activePointers.clear();
    fpTouchLook = null;

    fp.active = true;
    hasWalkedOnce = true;
    dragMode = "walk";
    fp.settleT = 1;
    fp.x = res.pose.x;
    fp.z = res.pose.z;
    fp.feetY = res.pose.y;
    fp.y = res.pose.eyeY;
    fp.yaw = fp.goalYaw = res.pose.yaw;
    fp.pitch = fp.goalPitch = -0.03;
    fp.vx = 0;
    fp.vz = 0;
    fp.jumpY = 0;
    fp.jumpVy = 0;
    fp.horizSpeed = 0;
    fp.sprinting = false;

    localAvatarRig.setFirstPersonMode(true);
    sun.intensity = 2.25;
    hemi.intensity = 1.12;
    skyDome.visible = true;
    skyDome.position.set(fp.x, 0, fp.z);
    fpCamera.position.set(res.pose.eyeX, res.pose.eyeY, res.pose.eyeZ);
    fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
    fpCamera.updateMatrixWorld();
    syncComposerCamera(fpCamera);
    canvas.style.cursor = idleCursor();
    lastUnlockedFpMouse = null;

    callbacks.onDragModeChange?.("walk");
    refreshInteractionTarget();
    requestWalkPointerLock();
    return true;
  }

  function hopOffCurrentVehicle() {
    if (!interiorSystem.isRiding()) return false;
    const res = interiorSystem.hopOffVehicle();
    if (!res?.ok || !res.exteriorPose) return false;

    fp.x = res.exteriorPose.x;
    fp.z = res.exteriorPose.z;
    fp.yaw = fp.goalYaw = res.exteriorPose.yaw;
    fp.pitch = fp.goalPitch = res.exteriorPose.pitch;
    fp.vx = 0;
    fp.vz = 0;
    fp.jumpY = 0;
    fp.jumpVy = 0;
    fp.horizSpeed = 0;
    fp.sprinting = false;
    fp.settleT = 1;
    const gY = getIslandGroundHeight(fp.x, fp.z);
    fp.feetY = gY;
    fp.y = gY + FP_EYE_HEIGHT;

    if (fp.active) {
      fpCamera.position.set(fp.x, fp.y, fp.z);
      fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
      fpCamera.updateMatrixWorld();
    }
    refreshInteractionTarget();
    return true;
  }

  function triggerActiveInteraction() {
    if (!activeInteractionTarget) {
      refreshInteractionTarget();
    }
    const target = activeInteractionTarget;
    if (!target) return false;

    if (target.kind === "enter_building") {
      return enterBuildingById(target.id);
    }
    if (target.kind === "exit_building") {
      return exitCurrentBuilding();
    }
    if (target.kind === "board_vehicle") {
      return boardVehicleById(target.id);
    }
    if (target.kind === "hop_off") {
      return hopOffCurrentVehicle();
    }
    if (target.kind === "sit") {
      const res = target.execute?.();
      if (res?.ok && res.pose) {
        if (res.pose.isInterior) {
          fp.localX = res.pose.x;
          fp.localY = res.pose.y;
          fp.localZ = res.pose.z;
          fp.y = res.pose.worldEyeY;
        } else {
          fp.x = res.pose.x;
          fp.z = res.pose.z;
          const gY = getIslandGroundHeight(res.pose.x, res.pose.z);
          fp.feetY = gY + res.pose.y;
          fp.y = gY + res.pose.eyeY;
        }
        fp.yaw = fp.goalYaw = res.pose.yaw;
        fp.pitch = fp.goalPitch = -0.04;
        fp.vx = 0;
        fp.vz = 0;
        fp.jumpY = 0;
        fp.jumpVy = 0;
        fp.horizSpeed = 0;
      }
      refreshInteractionTarget();
      return Boolean(res?.ok);
    }
    if (target.kind === "stand_up") {
      const res = interiorSystem.standUp();
      if (res?.ok && res.pose) {
        if (res.pose.isInterior) {
          fp.localX = res.pose.x;
          fp.localY = 0;
          fp.localZ = res.pose.z;
          fp.y = INTERIOR_ORIGIN.y + FP_EYE_HEIGHT;
        } else {
          fp.x = res.pose.x;
          fp.z = res.pose.z;
          const gY = getWalkSurfaceHeight(res.pose.x, res.pose.z, fp.feetY);
          fp.walkSurfaceY = gY;
          fp.feetY = gY;
          fp.y = gY + FP_EYE_HEIGHT;
        }
        fp.vx = 0;
        fp.vz = 0;
        fp.jumpY = 0;
        fp.jumpVy = 0;
        fp.horizSpeed = 0;
      }
      refreshInteractionTarget();
      return Boolean(res?.ok);
    }
    if (target.kind === "interactive_creation") {
      const res = target.execute?.();
      if (res?.creation) {
        highlightedId = res.creation.id;
        if (res.message) {
          callbacks.onInteractiveEvent?.(res.creation, res.message);
        }
      }
      refreshInteractionTarget();
      return Boolean(res?.ok);
    }

    const res = target.execute?.();
    refreshInteractionTarget();
    return Boolean(res?.ok ?? true);
  }

  function placeFirstPersonNear(targetX, targetZ, preferredAz = cam.az, standOverride = null, topYHint = null) {
    let focusX = targetX;
    let focusZ = targetZ;
    let standDist = standOverride || 9.5;
    let initialPitch = -0.02;

    if (!standOverride) {
      for (const ent of creationEntities.values()) {
        if (ent.data.category === "building" || ent.data.behavior?.type === "landmark") {
          const fr = ent.footprintRadius || 3.4;
          if (Math.hypot(targetX - ent.x, targetZ - ent.z) < fr + 4.2) {
            focusX = ent.x;
            focusZ = ent.z;
            standDist = Math.max(8.5, fr + 5.4);
            initialPitch = Math.min(
              0.2,
              Math.max(0.01, ((ent.topY || 5) * 0.42 - FP_EYE_HEIGHT) / standDist),
            );
            break;
          }
        }
      }
    } else if (typeof topYHint === "number") {
      initialPitch = Math.min(0.22, Math.max(0.01, (topYHint * 0.42 - FP_EYE_HEIGHT) / standDist));
    }

    const angleOffsets = [0, 0.3, -0.3, 0.62, -0.62, 0.96, -0.96, 1.35, -1.35, 1.85, -1.85, Math.PI];
    const distSteps = [standDist, standDist + 3.6, standDist + 7.2];
    let chosen = null;

    outer: for (const d of distSteps) {
      for (const off of angleOffsets) {
        const a = preferredAz + off;
        const cx = focusX + Math.sin(a) * d;
        const cz = focusZ + Math.cos(a) * d;
        if (isWalkPointClear(cx, cz, 0.35)) {
          chosen = [cx, cz];
          break outer;
        }
      }
    }

    if (!chosen) {
      chosen = resolveWalkPosition(
        focusX + Math.sin(preferredAz) * standDist,
        focusZ + Math.cos(preferredAz) * standDist,
      );
    }

    fp.x = chosen[0];
    fp.z = chosen[1];
    const dx = focusX - fp.x;
    const dz = focusZ - fp.z;
    const lookYaw = Math.hypot(dx, dz) > 0.2 ? Math.atan2(-dx, -dz) : preferredAz;
    fp.yaw = fp.goalYaw = lookYaw;
    fp.pitch = fp.goalPitch = initialPitch;
    fp.vx = 0;
    fp.vz = 0;
    fp.jumpY = 0;
    fp.jumpVy = 0;
    fp.settleT = prefersReducedMotion ? 1 : 0;
    const gY = getWalkSurfaceHeight(fp.x, fp.z, 0);
    fp.walkSurfaceY = gY;
    fp.feetY = gY;
    fp.y = gY + (prefersReducedMotion ? FP_EYE_HEIGHT : FP_EYE_HEIGHT + 1.15);
  }

  function enterFirstPerson() {
    if (fp.active) return;
    cancelIntroSweep();
    pointerGesture = null;
    activePointers.clear();
    multiPrev = null;
    hadMultiTouch = false;
    fpJoystick.right = 0;
    fpJoystick.fwd = 0;
    fpTouchLook = null;

    const stayedAtStandingAvatar =
      (!hasWalkedOnce && Math.hypot(cam.goalTx - HOME_TX, cam.goalTz - HOME_TZ) < 2.5) ||
      (lastExitCamTarget &&
        Math.hypot(cam.goalTx - lastExitCamTarget.x, cam.goalTz - lastExitCamTarget.z) < 2.5);

    if (stayedAtStandingAvatar && isWalkPointClear(fp.x, fp.z, 0.1)) {
      const [rx, rz] = resolveWalkPosition(fp.x, fp.z, fp.feetY);
      fp.x = rx;
      fp.z = rz;
      fp.vx = 0;
      fp.vz = 0;
      fp.jumpY = 0;
      fp.jumpVy = 0;
      fp.pitch = fp.goalPitch = -0.02;
      fp.settleT = prefersReducedMotion ? 1 : 0;
      const gY = getWalkSurfaceHeight(fp.x, fp.z, fp.feetY);
      fp.walkSurfaceY = gY;
      fp.feetY = gY;
      fp.y = gY + (prefersReducedMotion ? FP_EYE_HEIGHT : FP_EYE_HEIGHT + 1.15);
    } else {
      placeFirstPersonNear(cam.tx, cam.tz, cam.az);
    }

    hasWalkedOnce = true;
    fp.active = true;
    localAvatarRig.setFirstPersonMode(true);
    sun.intensity = 2.25;
    hemi.intensity = 1.12;
    skyDome.visible = true;
    skyDome.position.set(fp.x, 0, fp.z);
    fpCamera.position.set(fp.x, fp.y, fp.z);
    fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
    fpCamera.updateMatrixWorld();
    syncComposerCamera(fpCamera);
    canvas.style.cursor = idleCursor();
    lastUnlockedFpMouse = null;
    clearInteractiveHover();
    callbacks.onHoverCreation?.(null, 0, 0, null);
    refreshInteractionTarget();
    requestWalkPointerLock();
  }

  function exitFirstPerson(toHome = false) {
    if (interiorSystem.isInside()) {
      exitCurrentBuilding();
    }
    if (interiorSystem.isRiding()) {
      hopOffCurrentVehicle();
    }
    if (interiorSystem.isSitting()) {
      const wake = interiorSystem.standUp();
      if (wake?.ok && wake.pose && !wake.pose.isInterior) {
        fp.x = wake.pose.x;
        fp.z = wake.pose.z;
      }
    }
    if (!fp.active) return;
    fp.active = false;
    fp.vx = 0;
    fp.vz = 0;
    fp.jumpY = 0;
    fp.jumpVy = 0;
    fp.horizSpeed = 0;
    fp.sprinting = false;
    fpJoystick.right = 0;
    fpJoystick.fwd = 0;
    fpTouchLook = null;
    lastUnlockedFpMouse = null;
    pointerGesture = null;
    activePointers.clear();
    pressedKeys.clear();
    releaseWalkPointerLock();
    localAvatarRig.setFirstPersonMode(false);
    sun.intensity = 2.25;
    hemi.intensity = 1.12;
    skyDome.visible = false;
    syncComposerCamera(camera);

    if (!toHome) {
      const aheadX = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, fp.x - Math.sin(fp.yaw) * 6.5));
      const aheadZ = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, fp.z - Math.cos(fp.yaw) * 6.5));
      lastExitCamTarget = { x: aheadX, z: aheadZ };
      cam.tx = cam.goalTx = aheadX;
      cam.tz = cam.goalTz = aheadZ;
      cam.az = cam.goalAz = fp.yaw;
      cam.el = prefersReducedMotion ? HOME_EL : 0.24;
      cam.goalEl = HOME_EL;
      cam.ty = lowAngleTargetY(cam.el);
      cam.goalTy = 0;
      cam.zoom = prefersReducedMotion ? getHomeZoom() : 1.52;
      cam.goalZoom = getHomeZoom();
    } else {
      lastExitCamTarget = { x: HOME_TX, z: HOME_TZ };
    }
    canvas.style.cursor = idleCursor();
    refreshInteractionTarget();
  }

  let followingHermesAgentId = null;

  function clearFollowIfActive() {
    if (!followingHermesAgentId) return;
    followingHermesAgentId = null;
    callbacks.onHermesFollowChange?.(null);
  }

  function followHermesAgent(agentId) {
    if (!agentId) {
      clearFollowIfActive();
      return false;
    }
    const pos = hermesSwarm.getAgentPosition(agentId);
    if (!pos) return false;
    cancelIntroSweep();
    if (fp.active) {
      exitFirstPerson(false);
      dragMode = "orbit";
      canvas.style.cursor = idleCursor();
      callbacks.onDragModeChange?.("orbit");
    }
    hermesSwarm.setSelectedAgent(agentId);
    followingHermesAgentId = agentId;
    cam.goalTx = pos.x;
    cam.goalTz = pos.z;
    cam.goalZoom = Math.max(2.05, cam.goalZoom);
    clampTarget();
    callbacks.onHermesFollowChange?.(agentId);
    return true;
  }

  function setDragMode(mode) {
    const next = mode === "walk" ? "walk" : mode === "orbit" ? "orbit" : "pan";
    cancelIntroSweep(next);
    if (next === "walk") {
      clearFollowIfActive();
      dragMode = "walk";
      enterFirstPerson();
    } else {
      if (fp.active) {
        exitFirstPerson(false);
      }
      dragMode = next;
      if (!pointerGesture && activePointers.size === 0) {
        canvas.style.cursor = idleCursor();
      }
    }
    callbacks.onDragModeChange?.(dragMode);
  }

  function getDragMode() {
    return dragMode;
  }

  function panByPixels(dxPx, dyPx) {
    clearFollowIfActive();
    const vh = canvas.clientHeight || window.innerHeight;
    const worldPerPx = (2 * BASE_FRUSTUM) / (cam.zoom * vh);
    const right = dxPx * worldPerPx;
    const fwd = (dyPx * worldPerPx) / Math.max(0.28, Math.sin(cam.el));
    const cosA = Math.cos(cam.az);
    const sinA = Math.sin(cam.az);
    cam.goalTx += right * cosA + fwd * sinA;
    cam.goalTz += -right * sinA + fwd * cosA;
    clampTarget();
  }

  function zoomAt(factor, clientX, clientY) {
    const next = Math.min(3.4, Math.max(0.22, cam.goalZoom * factor));
    if (!followingHermesAgentId) {
      const p = screenToGround(clientX, clientY);
      if (p && Math.hypot(p[0] - cam.goalTx, p[1] - cam.goalTz) < 135) {
        const k = 1 - cam.goalZoom / next;
        cam.goalTx += (p[0] - cam.goalTx) * k;
        cam.goalTz += (p[1] - cam.goalTz) * k;
        clampTarget();
      }
    }
    cam.goalZoom = next;
  }

  function applyOrbitDelta(dxPx, dyPx) {
    cam.goalAz -= dxPx * 0.0068;
    cam.goalEl = Math.max(MIN_EL, Math.min(MAX_EL, cam.goalEl + dyPx * 0.0054));
    cam.goalTy = lowAngleTargetY(cam.goalEl);
  }

  function recenterCamera() {
    clearFollowIfActive();
    cancelIntroSweep();
    if (interiorSystem.isInside()) {
      exitCurrentBuilding();
    }
    if (interiorSystem.isRiding()) {
      hopOffCurrentVehicle();
    }
    if (interiorSystem.isSitting()) {
      const wake = interiorSystem.standUp();
      if (wake?.ok && wake.pose && !wake.pose.isInterior) {
        fp.x = wake.pose.x;
        fp.z = wake.pose.z;
      }
    }
    if (fp.active) {
      exitFirstPerson(true);
    }
    cam.az = HOME_AZ + wrapPi(cam.az - HOME_AZ);
    cam.goalTx = HOME_TX;
    cam.goalTy = 0;
    cam.goalTz = HOME_TZ;
    cam.goalZoom = getHomeZoom();
    cam.goalAz = HOME_AZ;
    cam.goalEl = HOME_EL;
  }

  let lastTrackpadAt = 0;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cancelIntroSweep();
      if (fp.active) {
        if (e.ctrlKey || e.metaKey) {
          const baseFov = (canvas.clientWidth || 1280) / Math.max(1, canvas.clientHeight || 800) < 0.8 ? 72 : 62;
          fpCamera.fov = Math.max(42, Math.min(82, fpCamera.fov * Math.exp(e.deltaY * 0.0035)));
          fpCamera.updateProjectionMatrix();
          syncComposerCamera(fpCamera);
          if (Math.abs(fpCamera.fov - baseFov) < 0.4) fpCamera.fov = baseFov;
          return;
        }
        const nowFp = performance.now();
        const notchedFp =
          e.deltaMode !== 0 ||
          (e.deltaX === 0 && Math.abs(e.wheelDeltaY) >= 120 && e.wheelDeltaY % 120 === 0);
        if (notchedFp && nowFp - lastTrackpadAt > 400) {
          if (interiorSystem.isRiding()) return;
          if (interiorSystem.isSitting()) {
            const wake = interiorSystem.standUp();
            if (wake?.ok && wake.pose) {
              if (wake.pose.isInterior) {
                fp.localX = wake.pose.x;
                fp.localZ = wake.pose.z;
              } else {
                fp.x = wake.pose.x;
                fp.z = wake.pose.z;
              }
            }
          }
          const step = -Math.sign(e.deltaY) * 2.2;
          if (interiorSystem.isInside()) {
            const [nlx, nlz] = interiorSystem.resolveInteriorWalkPosition(
              fp.localX - Math.sin(fp.yaw) * step,
              fp.localZ - Math.cos(fp.yaw) * step,
            );
            fp.localX = nlx;
            fp.localZ = nlz;
            return;
          }
          const [nx, nz] = resolveWalkPosition(
            fp.x - Math.sin(fp.yaw) * step,
            fp.z - Math.cos(fp.yaw) * step,
          );
          fp.x = nx;
          fp.z = nz;
          return;
        }
        lastTrackpadAt = nowFp;
        fp.goalYaw -= e.deltaX * 0.0038;
        fp.goalPitch = Math.max(
          FP_MIN_PITCH,
          Math.min(FP_MAX_PITCH, fp.goalPitch - e.deltaY * 0.0032),
        );
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0085), e.clientX, e.clientY);
        return;
      }
      if (e.shiftKey) {
        applyOrbitDelta(e.deltaX, e.deltaY);
        return;
      }
      const now = performance.now();
      const notched =
        e.deltaMode !== 0 ||
        (e.deltaX === 0 && Math.abs(e.wheelDeltaY) >= 120 && e.wheelDeltaY % 120 === 0);
      if (notched && now - lastTrackpadAt > 400) {
        zoomAt(Math.exp(-Math.sign(e.deltaY) * 0.16), e.clientX, e.clientY);
        return;
      }
      lastTrackpadAt = now;
      panByPixels(e.deltaX, e.deltaY);
    },
    { passive: false },
  );

  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      lastUnlockedFpMouse = null;
      clearInteractiveHover();
      callbacks.onHoverCreation?.(null, 0, 0, null);
      return;
    }
    lastUnlockedFpMouse = null;
    if (suppressPointerUnlockExit) {
      suppressPointerUnlockExit = false;
      return;
    }
    if (
      fp.active &&
      !document.querySelector("dialog[open]") &&
      document.visibilityState === "visible" &&
      document.hasFocus()
    ) {
      setDragMode("pan");
    }
  });

  canvas.addEventListener("pointerenter", () => {
    lastUnlockedFpMouse = null;
  });

  canvas.addEventListener("pointerleave", () => {
    lastUnlockedFpMouse = null;
  });

  document.addEventListener("mousemove", (e) => {
    if (!fp.active || document.pointerLockElement !== canvas) return;
    fp.goalYaw -= (e.movementX || 0) * 0.0026;
    fp.goalPitch = Math.max(
      FP_MIN_PITCH,
      Math.min(FP_MAX_PITCH, fp.goalPitch - (e.movementY || 0) * 0.0024),
    );
  });

  let pointerGesture = null;
  const activePointers = new Map();
  let multiPrev = null;
  let hadMultiTouch = false;

  function computeTwoPointerSample() {
    const iter = activePointers.values();
    const p1 = iter.next().value;
    const p2 = iter.next().value;
    if (!p1 || !p2) return null;
    const midX = (p1.x + p2.x) * 0.5;
    const midY = (p1.y + p2.y) * 0.5;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    return { p1, p2, midX, midY, dist, angle };
  }

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("pointerdown", (e) => {
    cancelIntroSweep();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointer events in tests may omit active capture handles
    }

    if (fp.active) {
      if (e.pointerType === "touch") {
        if (!fpTouchLook) {
          fpTouchLook = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            moved: false,
          };
        }
        callbacks.onHoverCreation?.(null, e.clientX, e.clientY, null);
        return;
      }

      if (e.button === 0 && document.pointerLockElement !== canvas) {
        requestWalkPointerLock();
      }
      pointerGesture = {
        id: e.pointerId,
        kind: "fp_look",
        button: e.button,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
      return;
    }

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, vx: 0, vy: 0 });

    if (activePointers.size >= 2) {
      hadMultiTouch = true;
      pointerGesture = null;
      multiPrev = computeTwoPointerSample();
      callbacks.onHoverCreation?.(null, e.clientX, e.clientY, null);
      return;
    }

    hadMultiTouch = false;
    multiPrev = null;
    const isOrbit = dragMode === "orbit" || e.button === 2 || e.button === 1 || e.altKey;
    pointerGesture = {
      id: e.pointerId,
      kind: isOrbit ? "orbit" : "pan",
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  });

  canvas.addEventListener("pointermove", (e) => {
    if (fp.active) {
      if (fpTouchLook && fpTouchLook.id === e.pointerId) {
        const dx = e.clientX - fpTouchLook.lastX;
        const dy = e.clientY - fpTouchLook.lastY;
        fpTouchLook.lastX = e.clientX;
        fpTouchLook.lastY = e.clientY;
        if (Math.hypot(e.clientX - fpTouchLook.startX, e.clientY - fpTouchLook.startY) > 4) {
          fpTouchLook.moved = true;
        }
        if (fpTouchLook.moved) {
          fp.goalYaw -= dx * 0.0092;
          fp.goalPitch = Math.max(
            FP_MIN_PITCH,
            Math.min(FP_MAX_PITCH, fp.goalPitch - dy * 0.0072),
          );
        }
        return;
      }

      // FPS mouse-look: when pointer-locked, document mousemove handles raw movementX/Y;
      // when unlocked (e.g., right after intro sweep before a click), free mouse motion looks around directly!
      if (document.pointerLockElement === canvas) {
        if (pointerGesture && pointerGesture.kind === "fp_look" && pointerGesture.id === e.pointerId) {
          if (Math.hypot(e.movementX || 0, e.movementY || 0) > 4) {
            pointerGesture.moved = true;
          }
        }
        return;
      }

      if (e.pointerType !== "touch" && !document.querySelector("dialog[open]")) {
        const now = performance.now();
        if (lastUnlockedFpMouse && now - lastUnlockedFpMouse.t < 240) {
          const dx = Math.max(-90, Math.min(90, e.clientX - lastUnlockedFpMouse.x));
          const dy = Math.max(-90, Math.min(90, e.clientY - lastUnlockedFpMouse.y));
          if (dx !== 0 || dy !== 0) {
            if (pointerGesture && pointerGesture.kind === "fp_look" && pointerGesture.id === e.pointerId) {
              if (Math.hypot(e.clientX - pointerGesture.startX, e.clientY - pointerGesture.startY) > 4) {
                pointerGesture.moved = true;
              }
            }
            callbacks.onHoverCreation?.(null, e.clientX, e.clientY, null);
            fp.goalYaw -= dx * 0.0034;
            fp.goalPitch = Math.max(
              FP_MIN_PITCH,
              Math.min(FP_MAX_PITCH, fp.goalPitch - dy * 0.0028),
            );
          }
        }
        lastUnlockedFpMouse = { x: e.clientX, y: e.clientY, t: now };
        canvas.style.cursor = idleCursor();
      }
      return;
    }

    if (activePointers.has(e.pointerId)) {
      const prevPtr = activePointers.get(e.pointerId);
      const stepX = e.clientX - prevPtr.x;
      const stepY = e.clientY - prevPtr.y;
      for (const [id, ptr] of activePointers.entries()) {
        if (id === e.pointerId) {
          ptr.x = e.clientX;
          ptr.y = e.clientY;
          ptr.vx = ptr.vx * 0.35 + stepX * 0.65;
          ptr.vy = ptr.vy * 0.35 + stepY * 0.65;
        } else {
          ptr.vx *= 0.88;
          ptr.vy *= 0.88;
        }
      }
    }

    // 2-finger mobile map gesture: pinch-zoom + 2-finger twist (azimuth) + 2-finger vertical drag (tilt) + midpoint pan
    if (activePointers.size >= 2) {
      pendingHover = null;
      const cur = computeTwoPointerSample();
      if (cur && multiPrev) {
        const dMidX = cur.midX - multiPrev.midX;
        const dMidY = cur.midY - multiPrev.midY;
        const { p1, p2 } = cur;

        const isParallelVerticalTilt =
          p1.vy * p2.vy > 0.25 &&
          Math.abs(p1.vy + p2.vy) > Math.abs(p1.vx + p2.vx) * 1.25 &&
          Math.abs(p1.vy - p2.vy) < Math.abs(p1.vy + p2.vy) * 0.65;

        if (isParallelVerticalTilt) {
          cam.goalEl = Math.max(MIN_EL, Math.min(MAX_EL, cam.goalEl + dMidY * 0.0085));
          cam.goalTy = lowAngleTargetY(cam.goalEl);
          panByPixels(-dMidX * 0.4, 0);
        } else {
          if (multiPrev.dist > 14 && cur.dist > 14) {
            const ratio = cur.dist / multiPrev.dist;
            if (Math.abs(ratio - 1) > 0.002) {
              zoomAt(ratio, cur.midX, cur.midY);
            }
          }
          if (multiPrev.dist > 24 && cur.dist > 24) {
            const dAngle = wrapPi(cur.angle - multiPrev.angle);
            cam.goalAz += dAngle;
          }
          panByPixels(-dMidX, -dMidY);
        }
      }
      multiPrev = cur;
      return;
    }

    if (spotState.mode === "picking" && !pointerGesture && activePointers.size === 0) {
      const g = screenToGround(e.clientX, e.clientY);
      if (g) {
        const snapped = snapToClearMeadowSpot(g[0], g[1], previewPlotRadius);
        spotState.x = snapped[0];
        spotState.z = snapped[1];
        plotMarker.group.position.set(snapped[0], 0, snapped[1]);
      }
    }

    if (!pointerGesture) {
      if (spotState.mode === "picking") {
        clearInteractiveHover();
        callbacks.onHoverCreation?.(null, e.clientX, e.clientY, null);
        canvas.style.cursor = "crosshair";
        return;
      }
      pendingHover = { x: e.clientX, y: e.clientY };
      return;
    }

    if (pointerGesture.id !== e.pointerId) return;
    const dx = e.clientX - pointerGesture.lastX;
    const dy = e.clientY - pointerGesture.lastY;
    pointerGesture.lastX = e.clientX;
    pointerGesture.lastY = e.clientY;

    if (Math.hypot(e.clientX - pointerGesture.startX, e.clientY - pointerGesture.startY) > 4.5) {
      pointerGesture.moved = true;
      clearInteractiveHover();
    }

    if (!pointerGesture.moved) return;

    if (pointerGesture.kind === "orbit") {
      applyOrbitDelta(dx, dy);
      canvas.style.cursor = "grabbing";
    } else {
      panByPixels(-dx, -dy);
      canvas.style.cursor = "grabbing";
    }
  });

  function processPendingHover() {
    if (!pendingHover) return;
    const { x, y } = pendingHover;
    pendingHover = null;
    if (pointerGesture?.moved || activePointers.size >= 2) return;
    if (fp.active && document.pointerLockElement === canvas) return;

    const iHit = pickInteractiveAt(x, y);
    if (iHit) {
      if (hoveredInteractiveEnt && hoveredInteractiveEnt !== iHit.ent) {
        hoveredInteractiveEnt.interactive?.setHovered?.(null);
      }
      hoveredInteractiveEnt = iHit.ent;
      hoveredInteractiveEnt.interactive?.setHovered?.(iHit.action);
      const reading = liveFeedsById[iHit.ent.id] || null;
      callbacks.onHoverCreation?.(iHit.ent.data, x, y, reading);
      canvas.style.cursor = "pointer";
      return;
    }

    if (hoveredInteractiveEnt) {
      hoveredInteractiveEnt.interactive?.setHovered?.(null);
      hoveredInteractiveEnt = null;
    }

    const hoveredHermes = pickHermesAgentAt(x, y);
    if (hoveredHermes) {
      callbacks.onHoverHermesAgent?.(hoveredHermes, x, y);
      canvas.style.cursor = "pointer";
      return;
    }
    callbacks.onHoverHermesAgent?.(null, x, y);

    const hovered = pickCreationAt(x, y);
    const reading = hovered && hovered.id !== "__city_sign__" ? liveFeedsById[hovered.id] || null : null;
    callbacks.onHoverCreation?.(hovered ? hovered.data : null, x, y, reading);
    canvas.style.cursor = hovered ? "pointer" : idleCursor();
  }

  const handleFirstPersonTap = (clientX, clientY) => {
    const hermesHit = pickHermesAgentAt(clientX, clientY);
    if (hermesHit) {
      hermesSwarm.setSelectedAgent(hermesHit.id);
      callbacks.onSelectHermesAgent?.(hermesHit);
      return;
    }
    const iHit = pickInteractiveAt(clientX, clientY);
    if (iHit) {
      highlightedId = iHit.ent.id;
      const msg = iHit.ent.interactive?.trigger?.(iHit.action);
      if (msg) {
        callbacks.onInteractiveEvent?.(iHit.ent.data, msg);
      } else {
        callbacks.onSelectCreation?.(iHit.ent.data, liveFeedsById[iHit.ent.id] || null);
      }
      return;
    }
    const picked = pickCreationAt(clientX, clientY);
    if (picked) {
      if (picked.id !== "__city_sign__") {
        highlightedId = picked.id;
      }
      picked.triggerEyeSpinFlourish?.();
      picked.interactive?.onInspectFocus?.();
      callbacks.onSelectCreation?.(picked.data, liveFeedsById[picked.id] || null);
    }
  };

  const endGesture = (e) => {
    if (fp.active) {
      if (fpTouchLook && fpTouchLook.id === e.pointerId) {
        const wasTap = !fpTouchLook.moved && e.type === "pointerup";
        fpTouchLook = null;
        if (wasTap) handleFirstPersonTap(e.clientX, e.clientY);
        return;
      }
      if (pointerGesture && pointerGesture.id === e.pointerId) {
        const wasClickFp = !pointerGesture.moved && pointerGesture.button === 0 && e.type === "pointerup";
        pointerGesture = null;
        canvas.style.cursor = idleCursor();
        if (wasClickFp) {
          const locked = document.pointerLockElement === canvas;
          const tapX = locked ? (canvas.clientWidth || window.innerWidth) * 0.5 : e.clientX;
          const tapY = locked ? (canvas.clientHeight || window.innerHeight) * 0.5 : e.clientY;
          handleFirstPersonTap(tapX, tapY);
        }
      }
      return;
    }

    activePointers.delete(e.pointerId);

    if (activePointers.size >= 2) {
      multiPrev = computeTwoPointerSample();
      return;
    }

    if (activePointers.size === 1) {
      multiPrev = null;
      const [remId, remPos] = activePointers.entries().next().value;
      pointerGesture = {
        id: remId,
        kind: dragMode === "orbit" ? "orbit" : "pan",
        button: 0,
        startX: remPos.x,
        startY: remPos.y,
        lastX: remPos.x,
        lastY: remPos.y,
        moved: true,
      };
      return;
    }

    multiPrev = null;
    const finishedMulti = hadMultiTouch;
    hadMultiTouch = false;

    if (!pointerGesture || pointerGesture.id !== e.pointerId) {
      pointerGesture = null;
      canvas.style.cursor = idleCursor();
      return;
    }

    const wasClick = !finishedMulti && !pointerGesture.moved && pointerGesture.button === 0;
    pointerGesture = null;
    canvas.style.cursor = idleCursor();

    if (wasClick) {
      if (spotState.mode === "picking" || spotState.mode === "staked") {
        const pickedExisting = spotState.mode === "staked" ? pickCreationAt(e.clientX, e.clientY) : null;
        if (!pickedExisting) {
          const g = screenToGround(e.clientX, e.clientY);
          if (g) {
            const [sx, sz] = snapToClearMeadowSpot(g[0], g[1], previewPlotRadius);
            spotState.x = sx;
            spotState.z = sz;
            plotMarker.group.position.set(sx, 0, sz);
            callbacks.onPickGroundSpot?.(sx, sz);
          }
          return;
        }
      }

      if (spotState.mode === "hidden") {
        const hermesHit = pickHermesAgentAt(e.clientX, e.clientY);
        if (hermesHit) {
          hermesSwarm.setSelectedAgent(hermesHit.id);
          const pos = hermesSwarm.getAgentPosition(hermesHit.id);
          if (pos) {
            focusOn(pos.x, pos.z, Math.max(1.85, cam.goalZoom));
          }
          callbacks.onSelectHermesAgent?.(hermesHit);
          return;
        }

        const iHit = pickInteractiveAt(e.clientX, e.clientY);
        if (iHit) {
          highlightedId = iHit.ent.id;
          if (
            Math.hypot(cam.goalTx - iHit.ent.x, cam.goalTz - iHit.ent.z) > 10.5 ||
            cam.goalZoom < 1.38
          ) {
            focusOn(iHit.ent.x, iHit.ent.z, Math.max(1.88, cam.goalZoom));
          }
          const msg = iHit.ent.interactive?.trigger?.(iHit.action);
          if (msg) {
            callbacks.onInteractiveEvent?.(iHit.ent.data, msg);
          } else {
            callbacks.onSelectCreation?.(iHit.ent.data, liveFeedsById[iHit.ent.id] || null);
          }
          return;
        }
      }

      const picked = pickCreationAt(e.clientX, e.clientY);
      if (picked) {
        if (picked.id !== "__city_sign__") {
          highlightedId = picked.id;
        }
        picked.triggerEyeSpinFlourish?.();
        const scaleCls = picked.data?.scaleClass;
        let targetZoom =
          scaleCls === "colossal" ? 0.86 : scaleCls === "large" ? 1.28 : scaleCls === "tiny" ? 2.0 : 1.55;
        if (picked.interactive) {
          targetZoom = Math.max(1.88, targetZoom);
          picked.interactive.onInspectFocus?.();
        }
        focusOn(picked.x, picked.z, targetZoom);
        callbacks.onSelectCreation?.(picked.data, liveFeedsById[picked.id] || null);
      }
    }
  };
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);
  canvas.addEventListener("lostpointercapture", endGesture);
  canvas.addEventListener("pointerleave", clearInteractiveHover);

  const isKeyDown = (...tokens) => tokens.some((tk) => pressedKeys.has(tk));

  window.addEventListener("blur", () => {
    pressedKeys.clear();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      pressedKeys.clear();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code) pressedKeys.delete(e.code);
    if (e.key) pressedKeys.delete(String(e.key).toLowerCase());
  });

  function isEditableOrDialogElement(el) {
    if (!el || typeof el !== "object") return false;
    if (el.isContentEditable) return true;
    const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (typeof el.closest === "function" && el.closest("dialog[open]")) return true;
    return false;
  }

  function isKeyboardBlockedByUi(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return true;
    if (isEditableOrDialogElement(e.target)) return true;
    if (isEditableOrDialogElement(document.activeElement)) return true;
    if (document.querySelector?.("dialog[open]")) return true;
    return false;
  }

  window.addEventListener("keydown", (e) => {
    if (isKeyboardBlockedByUi(e)) return;

    const lowerKey = e.key ? String(e.key).toLowerCase() : "";

    if (!e.repeat && (e.code === "KeyE" || lowerKey === "e")) {
      if (triggerActiveInteraction()) {
        e.preventDefault();
      }
      return;
    }

    if (
      !e.repeat &&
      ((fp.active && (e.code === "KeyQ" || lowerKey === "q")) ||
        e.code === "KeyG" ||
        lowerKey === "g")
    ) {
      e.preventDefault();
      triggerLocalWave();
      return;
    }

    if (fp.active) {
      if (e.code === "Space" && e.target?.matches?.("button, a")) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat && interiorSystem.isRiding()) {
          hopOffCurrentVehicle();
          return;
        }
        if (!e.repeat && interiorSystem.isSitting()) {
          const wake = interiorSystem.standUp();
          if (wake?.ok && wake.pose) {
            if (wake.pose.isInterior) {
              fp.localX = wake.pose.x;
              fp.localY = 0;
              fp.localZ = wake.pose.z;
            } else {
              fp.x = wake.pose.x;
              fp.z = wake.pose.z;
            }
          }
          refreshInteractionTarget();
          return;
        }
        if (fp.jumpY <= 0.002) {
          fp.jumpVy = 5.2;
        }
      }

      if (e.code) pressedKeys.add(e.code);
      if (lowerKey) pressedKeys.add(lowerKey);

      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
      }
      return;
    }

    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      lowerKey === "a" ||
      lowerKey === "d" ||
      lowerKey === "w" ||
      lowerKey === "s" ||
      lowerKey === "q" ||
      lowerKey === "e"
    ) {
      cancelIntroSweep();
    }
    const step = 7 / Math.max(0.5, cam.zoom);
    if (e.key === "ArrowLeft" || lowerKey === "a") {
      clearFollowIfActive();
      cam.goalTx -= step;
    } else if (e.key === "ArrowRight" || lowerKey === "d") {
      clearFollowIfActive();
      cam.goalTx += step;
    } else if (e.key === "ArrowUp" || lowerKey === "w") {
      clearFollowIfActive();
      cam.goalTz -= step;
    } else if (e.key === "ArrowDown" || lowerKey === "s") {
      clearFollowIfActive();
      cam.goalTz += step;
    } else if (lowerKey === "q") cam.goalAz -= 0.14;
    else if (lowerKey === "e") cam.goalAz += 0.14;
    clampTarget();
  });

  function focusOn(x, z, zoom = 1.45) {
    clearFollowIfActive();
    cancelIntroSweep();
    cam.goalTx = x;
    cam.goalTz = z;
    cam.goalZoom = zoom;
    clampTarget();
  }

  function setCameraPose({ tx, tz, zoom, az, el, ty, instant = true } = {}) {
    cancelIntroSweep();
    if (fp.active) exitFirstPerson(false);
    if (typeof tx === "number") cam.goalTx = tx;
    if (typeof tz === "number") cam.goalTz = tz;
    if (typeof zoom === "number") cam.goalZoom = Math.min(3.4, Math.max(0.22, zoom));
    if (typeof az === "number") cam.goalAz = az;
    if (typeof el === "number") cam.goalEl = Math.max(MIN_EL, Math.min(MAX_EL, el));
    cam.goalTy = typeof ty === "number" ? ty : lowAngleTargetY(cam.goalEl);
    clampTarget();
    if (instant) {
      cam.tx = cam.goalTx;
      cam.ty = cam.goalTy;
      cam.tz = cam.goalTz;
      cam.zoom = cam.goalZoom;
      cam.az = cam.goalAz;
      cam.el = cam.goalEl;
    }
  }

  function focusCreationById(id) {
    const ent = ensureCreationBuilt(id);
    if (!ent) return;
    highlightedId = id;
    ent.triggerEyeSpinFlourish?.();
    if (fp.active) {
      if (interiorSystem.isInside()) {
        exitCurrentBuilding();
      }
      if (interiorSystem.isRiding()) {
        hopOffCurrentVehicle();
      }
      if (interiorSystem.isSitting()) {
        interiorSystem.standUp();
      }
      const stand = Math.max(7.5, (ent.footprintRadius || 3.4) + 5.0);
      placeFirstPersonNear(ent.x, ent.z, fp.yaw, stand, ent.topY);
      refreshInteractionTarget();
      return;
    }
    const altOffset = ent.y > 1 ? ent.y / Math.max(0.35, Math.tan(cam.el)) : 0;
    const projX = ent.x - Math.sin(cam.az) * altOffset;
    const projZ = ent.z - Math.cos(cam.az) * altOffset;
    const scaleCls = ent.data?.scaleClass;
    let zoom =
      ent.y > 4
        ? 1.22
        : scaleCls === "colossal"
          ? 0.86
          : scaleCls === "large"
            ? 1.28
            : scaleCls === "tiny"
              ? 2.05
              : 1.62;
    if (ent.interactive) {
      zoom = Math.max(1.88, zoom);
      ent.interactive.onInspectFocus?.();
    }
    focusOn(projX, projZ, zoom);
  }

  function handleResize() {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(240, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, activeMaxDpr));
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.left = -BASE_FRUSTUM * aspect;
    camera.right = BASE_FRUSTUM * aspect;
    camera.top = BASE_FRUSTUM;
    camera.bottom = -BASE_FRUSTUM;
    camera.updateProjectionMatrix();
    fpCamera.aspect = aspect;
    if (!introSweep.usingFpCam) {
      fpCamera.fov = aspect < 0.8 ? 72 : 62;
    }
    fpCamera.updateProjectionMatrix();
    if (composer && usePostProcessing) {
      composer.setSize(w, h);
      gtaoPass?.setSize(w, h);
      bloomPass?.setSize?.(w, h);
      smaaPass?.setSize?.(w, h);
      syncComposerCamera(fp.active || introSweep.usingFpCam ? fpCamera : camera);
    }
    if (ogMode && currentWorld) {
      frameActiveWorldForOg();
    }
  }
  window.addEventListener("resize", handleResize);
  applyQualityState(false);

  const lightUp = new THREE.Vector3(0, 1, 0);
  const lightDir = SUN_OFFSET.clone().normalize();
  const lightRight = new THREE.Vector3().crossVectors(lightUp, lightDir).normalize();
  const lightOrthoUp = new THREE.Vector3().crossVectors(lightDir, lightRight).normalize();
  const tmpSunFocus = new THREE.Vector3();
  const tmpSunSnapped = new THREE.Vector3();

  function updateTexelSnappedSun(tx, tz) {
    const texelSize = (SHADOW_HALF * 2) / activeShadowRes;
    tmpSunFocus.set(tx, 0, tz);
    const projR = Math.round(tmpSunFocus.dot(lightRight) / texelSize) * texelSize;
    const projU = Math.round(tmpSunFocus.dot(lightOrthoUp) / texelSize) * texelSize;
    const projD = tmpSunFocus.dot(lightDir);

    tmpSunSnapped
      .set(0, 0, 0)
      .addScaledVector(lightRight, projR)
      .addScaledVector(lightOrthoUp, projU)
      .addScaledVector(lightDir, projD);

    sun.target.position.copy(tmpSunSnapped);
    sun.position.copy(tmpSunSnapped).add(SUN_OFFSET);
    sun.target.updateMatrixWorld();
  }

  let lastNow = performance.now();
  let bootWaitElapsed = 0;
  let lastReportedAz = NaN;
  let lastReportedHome = null;
  let frameTick = 0;
  let isContextLost = false;
  let animRafId = 0;
  const simCtx = {
    vehicles: cachedVehicles,
    buildings: cachedBuildings,
    focusX: 0,
    focusZ: 0,
    frameTick: 0,
    farLodSq: 92 * 92,
    shadowCullSq: 96 * 96,
    feedLodSq: 84 * 84,
  };
  const hermesLodCtx = {
    focusX: 0,
    focusZ: 0,
    frameTick: 0,
    farLodSq: 85 * 85,
    shadowCullSq: 90 * 90,
    followingAgentId: null,
  };

  function animate(now) {
    if (isContextLost) {
      animRafId = 0;
      return;
    }
    animRafId = requestAnimationFrame(animate);
    if (!ogMode && document.visibilityState === "hidden") {
      lastNow = now;
      return;
    }

    const rawDeltaMs = now - lastNow;
    const dt = Math.min(0.05, Math.max(0.001, rawDeltaMs / 1000));
    lastNow = now;
    const t = now * 0.001;
    frameTick = (frameTick + 1) | 0;

    if (waveTimer > 0) {
      waveTimer = Math.max(0, waveTimer - dt);
    }
    if (pressedKeys.size > 0 && document.querySelector?.("dialog[open]")) {
      pressedKeys.clear();
    }

    // Dynamic Auto quality governor with hysteresis: keeps 60 FPS smooth without oscillation
    if (
      !ogMode &&
      qualityMode === "auto" &&
      !isStreamingCreations &&
      currentWorld &&
      rawDeltaMs > 4 &&
      rawDeltaMs < 240
    ) {
      govFrameCount++;
      govFrameMsAccum += rawDeltaMs;
      if (govFrameCount >= 30) {
        const avgMs = govFrameMsAccum / govFrameCount;
        govFrameCount = 0;
        govFrameMsAccum = 0;
        if (avgMs > 19.5 && autoStepLevel < 3) {
          govGoodWindows = 0;
          let nextLevel = autoStepLevel + 1;
          if (nextLevel === 2 && !activeUsePostProcessing) {
            nextLevel = 3;
          }
          autoStepLevel = nextLevel;
          lastAutoStepChangeMs = now;
          applyQualityState(true);
        } else if (avgMs < 13.5 && autoStepLevel > 0) {
          govGoodWindows++;
          if (govGoodWindows >= 4 && now - lastAutoStepChangeMs > 4500) {
            govGoodWindows = 0;
            let nextLevel = autoStepLevel - 1;
            if (nextLevel === 2 && (isSoftwareGpu || isLowTierGpu)) {
              nextLevel = 1;
            }
            autoStepLevel = nextLevel;
            lastAutoStepChangeMs = now;
            applyQualityState(true);
          }
        } else {
          govGoodWindows = 0;
        }
      }
    }

    grassUniforms.uTime.value = t;
    citySignboard.stepCount(dt, !introSweep.active || introSweep.elapsed >= 0.24);
    if (!ogMode && !prefersReducedMotion) {
      floatingSkyBanner.step(t);
    }

    // 1. Step all world entities (vehicles, contraptions, landmarks) & villagers FIRST
    // so passenger riding poses, doorway beacons, and remote peers lock onto exact frame-t transforms!
    const preInside = interiorSystem.isInside();
    const preFocusX = fp.active ? fp.x : cam.tx;
    const preFocusZ = fp.active ? fp.z : cam.tz;
    const preActiveAz = fp.active ? fp.yaw : cam.az;
    const preViewerPos = fp.active && !preInside ? fp : null;
    const zoomScale = fp.active ? 1.1 : Math.max(0.68, Math.min(1.25, 1.0 / Math.max(0.55, cam.zoom || 1)));
    const effFarLod = activeFarLodDist * zoomScale;
    const effShadowCull = activeShadowCullDist * zoomScale;
    const effFeedLod = activeFeedLodDist * zoomScale;

    rebuildSceneListsIfNeeded();
    simCtx.vehicles = cachedVehicles;
    simCtx.buildings = cachedBuildings;
    simCtx.focusX = preFocusX;
    simCtx.focusZ = preFocusZ;
    simCtx.frameTick = frameTick;
    simCtx.farLodSq = effFarLod * effFarLod;
    simCtx.shadowCullSq = effShadowCull * effShadowCull;
    simCtx.feedLodSq = effFeedLod * effFeedLod;

    for (let i = 0; i < cachedAllEntities.length; i++) {
      const ent = cachedAllEntities[i];
      if (ent.batchedInChunk) continue;
      const bType = ent.data?.behavior?.type;
      const isThrottleEligible =
        (bType === "wander" || bType === "water_float" || bType === "fly_circle") &&
        ent.id !== highlightedId &&
        ent.spawnScale >= 1.0;

      const dxE = ent.x - preFocusX;
      const dzE = ent.z - preFocusZ;
      const dSqE = dxE * dxE + dzE * dzE;
      if (bType !== "landmark" && ent.data?.category !== "building") {
        ent.setShadowEnabled(dSqE <= simCtx.shadowCullSq);
      }

      let stepDt = dt;
      if (isThrottleEligible && dSqE > simCtx.farLodSq) {
        ent.lodAccumDt += dt;
        if ((frameTick + ent.index) % 3 !== 0) {
          continue;
        }
        stepDt = Math.min(0.12, ent.lodAccumDt);
        ent.lodAccumDt = 0;
      } else if (ent.lodAccumDt > 0) {
        stepDt = Math.min(0.12, dt + ent.lodAccumDt);
        ent.lodAccumDt = 0;
      }

      ent.step(
        stepDt,
        t,
        cachedAllEntities,
        cachedPonds,
        preActiveAz,
        preViewerPos,
        simCtx,
      );
    }

    // Global Solid-Body Vehicle Clash Solver & Self-Restoration Pass (before villagers & riding poses!)
    if (cachedVehicles.length > 0) {
      stepWorldVehiclePhysicsPass({
        dt,
        t,
        vehicleEntities: cachedVehicles,
        buildingEntities: cachedBuildings,
        pondProps: cachedPonds,
        allEntities: cachedAllEntities,
        citySignPos: CITY_SIGN_POS,
        clampPointToIslandFn: clampPointToIsland,
        onTrafficIncident: !ogMode ? callbacks.onTrafficIncident : null,
      });
    }

    for (let i = 1; i < cachedVillagerObstacles.length; i++) {
      const obs = cachedVillagerObstacles[i];
      if (obs.ent && !obs.ent.staticRootFrozen && !obs.ent.batchedInChunk) {
        obs.x = obs.ent.x;
        obs.z = obs.ent.z;
      }
    }

    const vShadowSq = simCtx.shadowCullSq * 0.72;
    for (let i = 0; i < cachedVillagers.length; i++) {
      const ag = cachedVillagers[i];
      const dxV = ag.x - preFocusX;
      const dzV = ag.z - preFocusZ;
      const dSqV = dxV * dxV + dzV * dzV;
      ag.setShadowEnabled(dSqV <= vShadowSq);

      let stepDt = dt;
      if (ag.state !== "BOARDING" && ag.state !== "RIDING" && dSqV > simCtx.farLodSq) {
        ag.lodAccumDt += dt;
        if ((frameTick + i) % 3 !== 0) {
          continue;
        }
        stepDt = Math.min(0.12, ag.lodAccumDt);
        ag.lodAccumDt = 0;
      } else if (ag.lodAccumDt > 0) {
        stepDt = Math.min(0.12, dt + ag.lodAccumDt);
        ag.lodAccumDt = 0;
      }

      ag.step(
        stepDt,
        t,
        cachedVehicles,
        cachedPonds,
        cachedVillagers,
        cachedVillagerObstacles,
      );
    }

    hermesSwarm.group.visible = !ogMode;
    if (!ogMode) {
      hermesLodCtx.focusX = preFocusX;
      hermesLodCtx.focusZ = preFocusZ;
      hermesLodCtx.frameTick = frameTick;
      hermesLodCtx.farLodSq = simCtx.farLodSq;
      hermesLodCtx.shadowCullSq = simCtx.shadowCullSq;
      hermesLodCtx.followingAgentId = followingHermesAgentId;
      hermesSwarm.step(dt, t, cachedPonds, hermesLodCtx);
    }

    // 2. Gather first-person movement inputs & step interiors/transit system
    let inFwd = 0;
    let inRight = 0;
    let sprint = false;
    if (fp.active) {
      inFwd = fpJoystick.fwd;
      inRight = fpJoystick.right;
      if (isKeyDown("KeyW", "w", "ArrowUp", "arrowup")) inFwd += 1;
      if (isKeyDown("KeyS", "s", "ArrowDown", "arrowdown")) inFwd -= 1;
      if (isKeyDown("KeyD", "d")) inRight += 1;
      if (isKeyDown("KeyA", "a")) inRight -= 1;
      sprint = isKeyDown("ShiftLeft", "ShiftRight", "shift");

      if (interiorSystem.isSitting()) {
        const wake = interiorSystem.handleMovementWake(
          Math.hypot(inFwd, inRight),
          fp.jumpY > 0.02 || fp.jumpVy > 0,
        );
        if (wake?.ok && wake.pose) {
          if (wake.pose.isInterior) {
            fp.localX = wake.pose.x;
            fp.localY = 0;
            fp.localZ = wake.pose.z;
          } else {
            fp.x = wake.pose.x;
            fp.z = wake.pose.z;
          }
        }
      }
    }

    if (!ogMode) {
      interiorSystem.step(
        dt,
        t,
        fp.active ? { inFwd, inRight, jumping: fp.jumpY > 0.02 } : null,
      );
    }

    const reportFpCameraChange = (txVal, tzVal) => {
      const azDeltaFromHome = wrapPi(fp.yaw - HOME_AZ);
      if (
        callbacks.onCameraChange &&
        (Number.isNaN(lastReportedAz) ||
          Math.abs(fp.yaw - lastReportedAz) > 0.004 ||
          lastReportedHome !== false)
      ) {
        lastReportedAz = fp.yaw;
        lastReportedHome = false;
        callbacks.onCameraChange({
          az: fp.yaw,
          el: fp.pitch,
          zoom: 1,
          tx: txVal,
          tz: tzVal,
          azDeltaFromHome,
          isHome: false,
          fpActive: true,
        });
      }
    };

    // 3. Update active camera (Walk / Ride / Interior / Seated / Aerial) & local embodied character
    if (fp.active) {
      const turnRate = 1.95;
      if (isKeyDown("ArrowLeft", "arrowleft")) {
        fp.goalYaw += turnRate * dt;
      }
      if (isKeyDown("ArrowRight", "arrowright")) {
        fp.goalYaw -= turnRate * dt;
      }
      if (isKeyDown("PageUp", "pageup")) {
        fp.goalPitch = Math.min(FP_MAX_PITCH, fp.goalPitch + 1.15 * dt);
      }
      if (isKeyDown("PageDown", "pagedown")) {
        fp.goalPitch = Math.max(FP_MIN_PITCH, fp.goalPitch - 1.15 * dt);
      }

      const lookDamp = 1 - Math.exp(-dt * 20);
      const rideState = interiorSystem.isRiding() ? interiorSystem.getRidingState() : null;
      const rPose = rideState
        ? interiorSystem.computePassengerPose(rideState.rideId, rideState.seat)
        : null;

      if (rideState && !rPose) {
        hopOffCurrentVehicle();
      }

      if (rPose) {
        if (rPose.deltaYaw) {
          fp.yaw += rPose.deltaYaw;
          fp.goalYaw += rPose.deltaYaw;
        }
        fp.yaw += (fp.goalYaw - fp.yaw) * lookDamp;
        fp.pitch += (fp.goalPitch - fp.pitch) * lookDamp;

        fp.x = rPose.x;
        fp.z = rPose.z;
        fp.feetY = rPose.y;
        fp.y = rPose.eyeY;
        fp.vx = 0;
        fp.vz = 0;
        fp.jumpY = 0;
        fp.jumpVy = 0;
        fp.horizSpeed = 0;
        fp.sprinting = false;

        fpCamera.position.set(rPose.eyeX, rPose.eyeY, rPose.eyeZ);
        fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
        fpCamera.updateMatrixWorld();

        sun.intensity = 2.25;
        hemi.intensity = 1.12;
        skyDome.visible = true;
        skyDome.position.set(rPose.x, 0, rPose.z);
        oceanMesh.position.set(rPose.x, -0.56, rPose.z);
        grassUniforms.uFocusXZ.value.set(rPose.x, rPose.z);
        grassUniforms.uHorizonRange.value.set(96, 238);
        updateTexelSnappedSun(
          rPose.x - Math.sin(fp.yaw) * 18,
          rPose.z - Math.cos(fp.yaw) * 18,
        );
        reportFpCameraChange(rPose.x, rPose.z);

        localAvatarRig.root.visible = !ogMode;
        localAvatarRig.root.position.set(
          rPose.x,
          Math.min(rPose.y, rPose.eyeY - 1.24),
          rPose.z,
        );
        localAvatarRig.applyPose({
          dt,
          t,
          yaw: fp.yaw,
          pitch: fp.pitch,
          speed: 0,
          anim: "ride",
          jumpY: 0,
          waveTimer,
          isFirstPerson: true,
        });
      } else if (interiorSystem.isInside()) {
        fp.yaw += (fp.goalYaw - fp.yaw) * lookDamp;
        fp.pitch += (fp.goalPitch - fp.pitch) * lookDamp;

        sun.intensity = 0.28;
        hemi.intensity = 0.68;
        skyDome.visible = true;
        skyDome.position.set(INTERIOR_ORIGIN.x, INTERIOR_ORIGIN.y - 12, INTERIOR_ORIGIN.z);

        const sPose = interiorSystem.isSitting() ? interiorSystem.getSeatPose() : null;
        if (sPose) {
          fp.localX = sPose.x;
          fp.localY = sPose.y;
          fp.localZ = sPose.z;
          fp.vx = 0;
          fp.vz = 0;
          fp.jumpY = 0;
          fp.jumpVy = 0;
          fp.horizSpeed = 0;
          fp.sprinting = false;
          fp.y = sPose.worldEyeY;

          fpCamera.position.set(sPose.worldX, sPose.worldEyeY, sPose.worldZ);
          fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
          fpCamera.updateMatrixWorld();

          localAvatarRig.root.visible = !ogMode;
          localAvatarRig.root.position.set(
            sPose.worldX,
            Math.min(sPose.worldY, sPose.worldEyeY - 1.24),
            sPose.worldZ,
          );
          localAvatarRig.applyPose({
            dt,
            t,
            yaw: fp.yaw,
            pitch: fp.pitch,
            speed: 0,
            anim: "sit",
            jumpY: 0,
            waveTimer,
            isFirstPerson: true,
          });
        } else {
          const maxSpeed = sprint ? 6.8 : 4.6;
          const fwdX = -Math.sin(fp.yaw);
          const fwdZ = -Math.cos(fp.yaw);
          const rightX = Math.cos(fp.yaw);
          const rightZ = -Math.sin(fp.yaw);

          let wishVx = 0;
          let wishVz = 0;
          const inMag = Math.hypot(inFwd, inRight);
          if (inMag > 0.02) {
            const scale = Math.min(1, inMag) / inMag;
            const nf = inFwd * scale;
            const nr = inRight * scale;
            wishVx = (fwdX * nf + rightX * nr) * maxSpeed;
            wishVz = (fwdZ * nf + rightZ * nr) * maxSpeed;
          }

          const velDamp = 1 - Math.exp(-dt * 14);
          fp.vx += (wishVx - fp.vx) * velDamp;
          fp.vz += (wishVz - fp.vz) * velDamp;

          const prevLX = fp.localX;
          const prevLZ = fp.localZ;
          const [nx, nz] = interiorSystem.resolveInteriorWalkPosition(
            fp.localX + fp.vx * dt,
            fp.localZ + fp.vz * dt,
          );
          fp.localX = nx;
          fp.localZ = nz;

          if (fp.jumpY > 0 || fp.jumpVy > 0) {
            fp.jumpY += fp.jumpVy * dt;
            fp.jumpVy -= 15.5 * dt;
            if (fp.jumpY <= 0) {
              fp.jumpY = 0;
              fp.jumpVy = 0;
            }
          }

          const floorY = interiorSystem.getInteriorFloorHeight?.(fp.localX, fp.localZ) || 0;
          fp.localY = floorY + fp.jumpY;

          const horizSpeed = Math.hypot(fp.localX - prevLX, fp.localZ - prevLZ) / Math.max(0.001, dt);
          fp.horizSpeed = horizSpeed;
          fp.sprinting = sprint && horizSpeed > 5.4;

          const bobBlend = prefersReducedMotion || fp.jumpY > 0.02 ? 0 : Math.min(1, horizSpeed / 4.4);
          if (bobBlend > 0.02) {
            fp.bobPhase += dt * (7.0 + horizSpeed * 0.5);
          }
          const bobY = Math.sin(fp.bobPhase * 2) * 0.032 * bobBlend;
          const swayX = Math.cos(fp.bobPhase) * 0.014 * bobBlend;

          const worldX = INTERIOR_ORIGIN.x + fp.localX;
          const worldZ = INTERIOR_ORIGIN.z + fp.localZ;
          const worldFeetY = INTERIOR_ORIGIN.y + fp.localY;
          fp.y = worldFeetY + FP_EYE_HEIGHT + bobY;

          fpCamera.position.set(worldX + rightX * swayX, fp.y, worldZ + rightZ * swayX);
          fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
          fpCamera.updateMatrixWorld();

          const indoorAnim =
            fp.jumpY > 0.03
              ? "jump"
              : fp.sprinting
                ? "run"
                : horizSpeed > 0.35
                  ? "walk"
                  : waveTimer > 0
                    ? "wave"
                    : "idle";

          localAvatarRig.root.visible = !ogMode;
          localAvatarRig.root.position.set(worldX, worldFeetY, worldZ);
          localAvatarRig.applyPose({
            dt,
            t,
            yaw: fp.yaw,
            pitch: fp.pitch,
            speed: horizSpeed,
            anim: indoorAnim,
            jumpY: fp.jumpY,
            waveTimer,
            isFirstPerson: true,
          });
        }
        reportFpCameraChange(fp.x, fp.z);
      } else if (interiorSystem.isSitting()) {
        fp.yaw += (fp.goalYaw - fp.yaw) * lookDamp;
        fp.pitch += (fp.goalPitch - fp.pitch) * lookDamp;

        const sPose = interiorSystem.getSeatPose();
        const gY = getIslandGroundHeight(sPose.x, sPose.z);
        const seatWorldY = gY + sPose.y;
        const eyeWorldY = gY + sPose.eyeY;

        fp.x = sPose.x;
        fp.z = sPose.z;
        fp.feetY = seatWorldY;
        fp.y = eyeWorldY;
        fp.vx = 0;
        fp.vz = 0;
        fp.jumpY = 0;
        fp.jumpVy = 0;
        fp.horizSpeed = 0;
        fp.sprinting = false;

        fpCamera.position.set(sPose.x, eyeWorldY, sPose.z);
        fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
        fpCamera.updateMatrixWorld();

        sun.intensity = 2.25;
        hemi.intensity = 1.12;
        skyDome.visible = true;
        skyDome.position.set(fp.x, 0, fp.z);
        oceanMesh.position.set(fp.x, -0.56, fp.z);
        grassUniforms.uFocusXZ.value.set(fp.x, fp.z);
        grassUniforms.uHorizonRange.value.set(96, 238);
        updateTexelSnappedSun(
          fp.x - Math.sin(fp.yaw) * 18,
          fp.z - Math.cos(fp.yaw) * 18,
        );
        reportFpCameraChange(fp.x, fp.z);

        localAvatarRig.root.visible = !ogMode;
        localAvatarRig.root.position.set(
          sPose.x,
          Math.min(seatWorldY, eyeWorldY - 1.24),
          sPose.z,
        );
        localAvatarRig.applyPose({
          dt,
          t,
          yaw: fp.yaw,
          pitch: fp.pitch,
          speed: 0,
          anim: "sit",
          jumpY: 0,
          waveTimer,
          isFirstPerson: true,
        });
      } else {
        fp.yaw += (fp.goalYaw - fp.yaw) * lookDamp;
        fp.pitch += (fp.goalPitch - fp.pitch) * lookDamp;

        const maxSpeed = sprint ? 9.6 : 5.8;
        const fwdX = -Math.sin(fp.yaw);
        const fwdZ = -Math.cos(fp.yaw);
        const rightX = Math.cos(fp.yaw);
        const rightZ = -Math.sin(fp.yaw);

        let wishVx = 0;
        let wishVz = 0;
        const inMag = Math.hypot(inFwd, inRight);
        if (inMag > 0.02) {
          const scale = Math.min(1, inMag) / inMag;
          const nf = inFwd * scale;
          const nr = inRight * scale;
          wishVx = (fwdX * nf + rightX * nr) * maxSpeed;
          wishVz = (fwdZ * nf + rightZ * nr) * maxSpeed;
        }

        const velDamp = 1 - Math.exp(-dt * 14);
        fp.vx += (wishVx - fp.vx) * velDamp;
        fp.vz += (wishVz - fp.vz) * velDamp;

        const prevX = fp.x;
        const prevZ = fp.z;
        const [rx, rz] = resolveWalkPosition(fp.x + fp.vx * dt, fp.z + fp.vz * dt, fp.feetY);
        fp.x = rx;
        fp.z = rz;

        if (fp.jumpY > 0 || fp.jumpVy > 0) {
          fp.jumpY += fp.jumpVy * dt;
          fp.jumpVy -= 15.5 * dt;
          if (fp.jumpY <= 0) {
            fp.jumpY = 0;
            fp.jumpVy = 0;
          }
        }

        if (fp.settleT < 1) {
          fp.settleT = Math.min(1, fp.settleT + dt * 3.4);
        }
        const settleEase = 1 - (1 - fp.settleT) ** 3;
        const settleLift = (1 - settleEase) * 1.15;

        const horizSpeed = Math.hypot(fp.x - prevX, fp.z - prevZ) / Math.max(0.001, dt);
        fp.horizSpeed = horizSpeed;
        fp.sprinting = sprint && horizSpeed > 6.4;

        const bobBlend = prefersReducedMotion || fp.jumpY > 0.02 ? 0 : Math.min(1, horizSpeed / 4.8);
        if (bobBlend > 0.02) {
          fp.bobPhase += dt * (7.2 + horizSpeed * 0.52);
        }
        const bobY = Math.sin(fp.bobPhase * 2) * 0.036 * bobBlend;
        const swayX = Math.cos(fp.bobPhase) * 0.016 * bobBlend;

        const targetSurfaceY = getWalkSurfaceHeight(fp.x, fp.z, fp.feetY);
        if (!Number.isFinite(fp.walkSurfaceY)) {
          fp.walkSurfaceY = targetSurfaceY;
        } else {
          fp.walkSurfaceY += (targetSurfaceY - fp.walkSurfaceY) * (1 - Math.exp(-dt * 22));
        }
        const groundY = fp.walkSurfaceY;
        fp.feetY = groundY + fp.jumpY;
        fp.y = groundY + FP_EYE_HEIGHT + settleLift + fp.jumpY + bobY;
        fpCamera.position.set(fp.x + rightX * swayX, fp.y, fp.z + rightZ * swayX);
        fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
        fpCamera.updateMatrixWorld();

        sun.intensity = 2.25;
        hemi.intensity = 1.12;
        skyDome.visible = true;
        skyDome.position.set(fp.x, 0, fp.z);
        oceanMesh.position.set(fp.x, -0.56, fp.z);
        grassUniforms.uFocusXZ.value.set(fp.x, fp.z);
        grassUniforms.uHorizonRange.value.set(96, 238);
        updateTexelSnappedSun(fp.x + fwdX * 18, fp.z + fwdZ * 18);
        reportFpCameraChange(fp.x, fp.z);

        const walkAnim =
          fp.jumpY > 0.03
            ? "jump"
            : fp.sprinting
              ? "run"
              : horizSpeed > 0.35
                ? "walk"
                : waveTimer > 0
                  ? "wave"
                  : "idle";

        localAvatarRig.root.visible = !ogMode;
        localAvatarRig.root.position.set(fp.x, groundY + settleLift + fp.jumpY, fp.z);
        localAvatarRig.applyPose({
          dt,
          t,
          yaw: fp.yaw,
          pitch: fp.pitch,
          speed: horizSpeed,
          anim: walkAnim,
          jumpY: fp.jumpY,
          waveTimer,
          isFirstPerson: true,
        });
      }
    } else {
      sun.intensity = 2.25;
      hemi.intensity = 1.12;
      let handledByFpSwoop = false;
      let swoopHideHead = false;
      if (introSweep.active) {
        if (currentWorld || bootWaitElapsed > 0.45) {
          introSweep.elapsed += dt;
        } else {
          bootWaitElapsed += dt;
        }
        const homeZ = getHomeZoom();
        const overviewZoom = homeZ * 0.88;
        cam.goalZoom = homeZ;

        const panStart = introSweep.holdSec;
        const orbitStart = panStart + introSweep.panDurSec;
        const walkStart = orbitStart + introSweep.orbitDurSec;

        if (introSweep.elapsed < panStart) {
          // Stage 0: Hold close on the GeminIsland Contributions Sign
          cam.tx = introSweep.fromTx;
          cam.ty = introSweep.fromTy;
          cam.tz = introSweep.fromTz;
          cam.zoom = introSweep.fromZoom;
          cam.az = introSweep.fromAz;
          cam.el = introSweep.fromEl;
        } else if (introSweep.elapsed < orbitStart) {
          // Stage 1: Click "Pan" button & pan/zoom out from the Sign to the SimCity aerial overview
          if (!introSweep.firedPan) {
            introSweep.firedPan = true;
            dragMode = "pan";
            callbacks.onIntroDemoStep?.("pan");
          }
          const e = smootherstep01((introSweep.elapsed - panStart) / introSweep.panDurSec);
          cam.tx = introSweep.fromTx + (HOME_TX - introSweep.fromTx) * e;
          cam.ty = introSweep.fromTy + (0 - introSweep.fromTy) * e;
          cam.tz = introSweep.fromTz + (HOME_TZ - introSweep.fromTz) * e;
          cam.zoom = introSweep.fromZoom + (overviewZoom - introSweep.fromZoom) * e;
          cam.az = introSweep.fromAz + (HOME_AZ - introSweep.fromAz) * e;
          cam.el = introSweep.fromEl + (HOME_EL - introSweep.fromEl) * e;
        } else if (introSweep.elapsed < walkStart) {
          // Stage 2: Click "Orbit" button & sweep a full 360° around the town
          if (!introSweep.firedOrbit) {
            introSweep.firedOrbit = true;
            dragMode = "orbit";
            callbacks.onIntroDemoStep?.("orbit");
          }
          const e = smootherstep01((introSweep.elapsed - orbitStart) / introSweep.orbitDurSec);
          cam.tx = HOME_TX;
          cam.ty = 0;
          cam.tz = HOME_TZ;
          cam.zoom = overviewZoom;
          cam.az = HOME_AZ + Math.PI * 2 * e;
          cam.el = HOME_EL - Math.sin(e * Math.PI) * 0.08;
        } else {
          // Stage 3: Click "Walk" button & swoop seamlessly into 1st-person street mode
          if (!introSweep.firedWalk) {
            introSweep.firedWalk = true;
            const [wx, wz] = resolveWalkPosition(introSweep.walkX, introSweep.walkZ);
            introSweep.walkX = wx;
            introSweep.walkZ = wz;
            fp.x = wx;
            fp.z = wz;
            introSweep.walkYaw = Math.atan2(-(2.4 - wx), -(-18.5 - wz));
            fp.yaw = fp.goalYaw = introSweep.walkYaw;
            introSweep.walkPitch = 0.045;
            introSweep.usingFpCam = true;
            dragMode = "walk";
            callbacks.onIntroDemoStep?.("walk");
          }

          const rawW = (introSweep.elapsed - walkStart) / introSweep.walkDurSec;
          if (rawW < 1) {
            handledByFpSwoop = true;
            swoopHideHead = rawW > 0.78;
            const e = smootherstep01(rawW);
            const fov1 = getBaseFpFov();
            const lookDist1 = 14.0;
            const h0 = BASE_FRUSTUM / overviewZoom;
            const tanHalf1 = Math.tan(THREE.MathUtils.degToRad(fov1 * 0.5));
            const h1 = lookDist1 * tanHalf1;
            // Start at 5600m quasi-orthographic distance (<1% foreshortening across the island)
            // so switching from OrthographicCamera (end of Orbit) to PerspectiveCamera (start of Walk) has zero jump!
            const tanHalf0 = h0 / 5600;
            const curH = h0 * Math.pow(h1 / h0, e);
            const curTanHalf = tanHalf0 + (tanHalf1 - tanHalf0) * Math.pow(e, 1.35);
            const curFov = THREE.MathUtils.radToDeg(Math.atan(curTanHalf) * 2);
            const curDist = curH / curTanHalf;

            const wYaw = introSweep.walkYaw;
            const wPitch = introSweep.walkPitch;
            const fwd1X = -Math.sin(wYaw) * Math.cos(wPitch);
            const fwd1Y = Math.sin(wPitch);
            const fwd1Z = -Math.cos(wYaw) * Math.cos(wPitch);
            const walkGroundY = getIslandGroundHeight(introSweep.walkX, introSweep.walkZ);
            const t1X = introSweep.walkX + fwd1X * lookDist1;
            const t1Y = walkGroundY + FP_EYE_HEIGHT + fwd1Y * lookDist1;
            const t1Z = introSweep.walkZ + fwd1Z * lookDist1;

            const orbitEndAz = HOME_AZ + Math.PI * 2;
            const curTx = HOME_TX + (t1X - HOME_TX) * e;
            const curTy = t1Y * e;
            const curTz = HOME_TZ + (t1Z - HOME_TZ) * e;
            const curAz = orbitEndAz + wrapPi(wYaw - orbitEndAz) * e;
            const curEl = HOME_EL + (-wPitch - HOME_EL) * e;

            const px = curTx + Math.sin(curAz) * Math.cos(curEl) * curDist;
            const py = curTy + Math.sin(curEl) * curDist;
            const pz = curTz + Math.cos(curAz) * Math.cos(curEl) * curDist;

            skyDome.visible = true;
            skyDome.position.set(px, py, pz);
            fpCamera.fov = curFov;
            fpCamera.near = Math.max(0.14, Math.min(120, curDist * 0.25));
            fpCamera.far = Math.max(820, curDist + 950);
            fpCamera.position.set(px, py, pz);
            fpCamera.rotation.set(-curEl, curAz, 0);
            fpCamera.updateProjectionMatrix();
            fpCamera.updateMatrixWorld();
            syncComposerCamera(fpCamera);

            const groundFocusX = HOME_TX + (introSweep.walkX - HOME_TX) * e;
            const groundFocusZ = HOME_TZ + (introSweep.walkZ - HOME_TZ) * e;

            const azDeltaFromHome = wrapPi(curAz - HOME_AZ);
            if (
              callbacks.onCameraChange &&
              (Number.isNaN(lastReportedAz) || Math.abs(curAz - lastReportedAz) > 0.004)
            ) {
              lastReportedAz = curAz;
              lastReportedHome = false;
              callbacks.onCameraChange({
                az: curAz,
                el: -curEl,
                zoom: 1,
                tx: groundFocusX,
                tz: groundFocusZ,
                azDeltaFromHome,
                isHome: false,
                fpActive: false,
              });
            }

            oceanMesh.position.set(groundFocusX, -0.56, groundFocusZ);
            grassUniforms.uFocusXZ.value.set(groundFocusX, groundFocusZ);
            grassUniforms.uHorizonRange.value.set(
              145 + (96 - 145) * e,
              295 + (238 - 295) * e,
            );
            const sunGoalX = introSweep.walkX - Math.sin(wYaw) * 18;
            const sunGoalZ = introSweep.walkZ - Math.cos(wYaw) * 18;
            updateTexelSnappedSun(
              HOME_TX + (sunGoalX - HOME_TX) * e,
              HOME_TZ + (sunGoalZ - HOME_TZ) * e,
            );
          } else {
            handledByFpSwoop = true;
            introSweep.active = false;
            introSweep.usingFpCam = false;
            const [rx, rz] = resolveWalkPosition(introSweep.walkX, introSweep.walkZ);
            fp.x = rx;
            fp.z = rz;
            const gY = getIslandGroundHeight(rx, rz);
            fp.feetY = gY;
            fp.y = gY + FP_EYE_HEIGHT;
            fp.yaw = fp.goalYaw = introSweep.walkYaw;
            fp.pitch = fp.goalPitch = introSweep.walkPitch;
            fp.vx = 0;
            fp.vz = 0;
            fp.jumpY = 0;
            fp.jumpVy = 0;
            fp.horizSpeed = 0;
            fp.sprinting = false;
            fp.settleT = 1;
            fp.active = true;
            hasWalkedOnce = true;
            dragMode = "walk";

            cam.tx = cam.goalTx = HOME_TX;
            cam.ty = cam.goalTy = 0;
            cam.tz = cam.goalTz = HOME_TZ;
            cam.zoom = cam.goalZoom = homeZ;
            cam.az = cam.goalAz = HOME_AZ;
            cam.el = cam.goalEl = HOME_EL;

            skyDome.visible = true;
            skyDome.position.set(fp.x, 0, fp.z);
            fpCamera.fov = getBaseFpFov();
            fpCamera.near = 0.14;
            fpCamera.far = 820;
            fpCamera.position.set(fp.x, fp.y, fp.z);
            fpCamera.rotation.set(fp.pitch, fp.yaw, 0);
            fpCamera.updateProjectionMatrix();
            fpCamera.updateMatrixWorld();
            syncComposerCamera(fpCamera);
            canvas.style.cursor = idleCursor();
            callbacks.onDragModeChange?.("walk");

            oceanMesh.position.set(fp.x, -0.56, fp.z);
            grassUniforms.uFocusXZ.value.set(fp.x, fp.z);
            grassUniforms.uHorizonRange.value.set(96, 238);
            updateTexelSnappedSun(
              fp.x - Math.sin(fp.yaw) * 18,
              fp.z - Math.cos(fp.yaw) * 18,
            );

            localAvatarRig.root.visible = !ogMode;
            localAvatarRig.root.position.set(fp.x, gY, fp.z);
            localAvatarRig.applyPose({
              dt,
              t,
              yaw: fp.yaw,
              pitch: fp.pitch,
              speed: 0,
              anim: waveTimer > 0 ? "wave" : "idle",
              jumpY: 0,
              waveTimer,
              isFirstPerson: true,
            });
          }
        }
      } else {
        if (followingHermesAgentId) {
          const fPos = hermesSwarm.getAgentPosition(followingHermesAgentId);
          if (fPos) {
            cam.goalTx = fPos.x;
            cam.goalTz = fPos.z;
            clampTarget();
          } else {
            clearFollowIfActive();
          }
        }
        const damp = 1 - Math.exp(-dt * 11);
        cam.tx += (cam.goalTx - cam.tx) * damp;
        cam.ty += (cam.goalTy - cam.ty) * damp;
        cam.tz += (cam.goalTz - cam.tz) * damp;
        cam.zoom += (cam.goalZoom - cam.zoom) * damp;
        cam.az += (cam.goalAz - cam.az) * damp;
        cam.el += (cam.goalEl - cam.el) * damp;
      }

      if (!handledByFpSwoop) {
        skyDome.visible = false;
        const camDist = 240;
        const horiz = Math.cos(cam.el) * camDist;
        camera.position.set(
          cam.tx + Math.sin(cam.az) * horiz,
          cam.ty + Math.sin(cam.el) * camDist,
          cam.tz + Math.cos(cam.az) * horiz,
        );
        camera.lookAt(cam.tx, cam.ty, cam.tz);
        camera.zoom = cam.zoom;
        camera.updateProjectionMatrix();

        const azDeltaFromHome = wrapPi(cam.az - HOME_AZ);
        const isHome =
          !introSweep.active &&
          Math.abs(azDeltaFromHome) < 0.03 &&
          Math.abs(cam.el - HOME_EL) < 0.03 &&
          Math.abs(cam.zoom - getHomeZoom()) < 0.04 &&
          Math.hypot(cam.tx - HOME_TX, cam.tz - HOME_TZ) < 1.2;

        if (
          callbacks.onCameraChange &&
          (Number.isNaN(lastReportedAz) ||
            Math.abs(cam.az - lastReportedAz) > 0.004 ||
            isHome !== lastReportedHome)
        ) {
          lastReportedAz = cam.az;
          lastReportedHome = isHome;
          callbacks.onCameraChange({
            az: cam.az,
            el: cam.el,
            zoom: cam.zoom,
            tx: cam.tx,
            tz: cam.tz,
            azDeltaFromHome,
            isHome,
            fpActive: false,
          });
        }

        oceanMesh.position.set(cam.tx, -0.56, cam.tz);
        grassUniforms.uFocusXZ.value.set(cam.tx, cam.tz);
        const lowHorizonT = Math.max(0, Math.min(1, (cam.el - 0.14) / 0.24));
        const lowHorizonSmooth = lowHorizonT * lowHorizonT * (3 - 2 * lowHorizonT);
        grassUniforms.uHorizonRange.value.set(
          72 + (145 - 72) * lowHorizonSmooth,
          142 + (295 - 142) * lowHorizonSmooth,
        );
        updateTexelSnappedSun(cam.tx, cam.tz);
      }

      if (!fp.active) {
        const avatarGroundY = getIslandGroundHeight(fp.x, fp.z);
        fp.feetY = avatarGroundY;
        fp.horizSpeed = 0;
        fp.sprinting = false;
        localAvatarRig.root.visible = !ogMode;
        localAvatarRig.root.position.set(fp.x, avatarGroundY, fp.z);
        localAvatarRig.applyPose({
          dt,
          t,
          yaw: fp.yaw,
          pitch: 0,
          speed: 0,
          anim: waveTimer > 0 ? "wave" : "idle",
          jumpY: 0,
          waveTimer,
          isFirstPerson: swoopHideHead,
        });
      }
    }

    // 4. Step remote multiplayer peers & contextual [E] interaction scanner
    remotePlayers.group.visible = !ogMode;
    if (!ogMode) {
      remotePlayers.step(dt, t, {
        localRoomId: interiorSystem.getCurrentRoomId(),
        interiorOrigin: INTERIOR_ORIGIN,
        resolveRidePose: (rideId, seat) => interiorSystem.computePassengerPose(rideId, seat),
        getGroundHeight: getIslandGroundHeight,
      });
    }

    refreshInteractionTarget();

    processPendingHover();

    if (!ogMode && !interiorSystem.isInside() && highlightedId && creationEntities.has(highlightedId)) {
      const myEnt = creationEntities.get(highlightedId);
      if (myEnt.y <= 2.5) {
        selectionHalo.visible = true;
        selectionHalo.position.set(myEnt.x, 0.122, myEnt.z);
        const haloBase = Math.max(1.8, (myEnt.footprintRadius || 2.8) + 0.6);
        selectionHalo.scale.setScalar(haloBase * (1 + Math.sin(t * 2.5) * 0.035));
      } else {
        selectionHalo.visible = false;
      }
    } else {
      selectionHalo.visible = false;
    }

    if (plotMarker.group.visible) {
      const baseR = plotMarker.getPlotRadius();
      plotMarker.ring.scale.setScalar(baseR * (1 + Math.sin(t * 3.2) * 0.035));
      if (plotMarker.scaffoldGroup.visible) {
        const orbitR = Math.max(0.75, Math.min(3.4, baseR * 0.36));
        const orbitY = Math.max(1.0, Math.min(3.6, 0.9 + baseR * 0.22));
        plotMarker.floatingCubes.forEach((cube, idx) => {
          const ang = t * 2.2 + (idx * Math.PI * 2) / 3;
          cube.position.set(
            Math.cos(ang) * orbitR,
            orbitY + Math.sin(t * 3.8 + idx * 1.4) * 0.38,
            Math.sin(ang) * orbitR,
          );
          cube.rotation.y = t * 1.8 + idx;
          cube.rotation.x = Math.sin(t * 2.1 + idx) * 0.35;
        });
      }
    }

    if (usePostProcessing && composer) composer.render();
    else renderer.render(scene, fp.active || introSweep.usingFpCam ? fpCamera : camera);

    if (ogMode && currentWorld) {
      ogSettledFrames++;
      if (ogSettledFrames >= 6 && !window.__geminIslandOgReady) {
        window.__geminIslandOgReady = true;
      }
    }
  }

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    isContextLost = true;
    if (animRafId) {
      cancelAnimationFrame(animRafId);
      animRafId = 0;
    }
  });
  canvas.addEventListener("webglcontextrestored", () => {
    isContextLost = false;
    lastNow = performance.now();
    applyQualityState(true);
    handleResize();
    if (!animRafId) {
      animRafId = requestAnimationFrame(animate);
    }
  });

  // Pre-warm WebGL shaders for both perspective (walk/swoop) and orthographic cameras + GTAO variants once scene is populated
  try {
    const prevSkyVis = skyDome.visible;
    skyDome.visible = true;
    renderer.compile(scene, fpCamera);
    skyDome.visible = prevSkyVis;
    renderer.compile(scene, camera);
    if (gtaoPass && gtaoPass._fsQuad?._mesh) {
      const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      gtaoPass._fsQuad.material = gtaoPass.gtaoMaterial;
      syncComposerCamera(fpCamera);
      renderer.compile(gtaoPass._fsQuad._mesh, quadCam);
      syncComposerCamera(camera);
      renderer.compile(gtaoPass._fsQuad._mesh, quadCam);
    }
  } catch {
    // ignore shader pre-warm warnings on software WebGL contexts
  }

  animRafId = requestAnimationFrame(animate);

  return {
    applyWorldSnapshot,
    applyHermesState(snapshot) {
      hermesSwarm.applyState(snapshot);
    },
    focusHermesAgent(agentId) {
      hermesSwarm.setSelectedAgent(agentId);
      const pos = hermesSwarm.getAgentPosition(agentId);
      if (pos) {
        if (fp.active) {
          exitFirstPerson(true);
        }
        focusOn(pos.x, pos.z, Math.max(1.85, cam.goalZoom));
        return true;
      }
      return false;
    },
    followHermesAgent,
    stopFollowingHermesAgent: () => clearFollowIfActive(),
    getFollowingHermesAgentId: () => followingHermesAgentId,
    setQualityMode,
    getQualityMode: () => qualityMode,
    getEffectiveQualityTier,
    getQualityInfo,
    applyLiveFeeds,
    setSpotPickerState,
    setPreviewPrompt,
    focusCreationById,
    focusOn,
    setCameraPose,
    recenterCamera,
    setDragMode,
    getDragMode,
    setJoystickInput,
    enterFirstPerson: () => setDragMode("walk"),
    exitFirstPerson: () => setDragMode("pan"),
    isFirstPerson: () => fp.active,
    releaseWalkPointerLock,
    setLocalAppearance,
    getLocalAppearance,
    triggerLocalWave,
    getLocalMultiplayerPose,
    syncMultiplayerWelcome,
    upsertRemotePlayer,
    updateRemotePlayerPose,
    updateRemotePlayerProfile,
    triggerRemotePlayerEmote,
    removeRemotePlayer,
    getRemotePlayerCount,
    triggerActiveInteraction,
    getActiveInteractionPrompt,
    enterBuildingById,
    exitCurrentBuilding,
    isInsideBuilding: () => interiorSystem.isInside(),
    getCurrentRoomId: () => interiorSystem.getCurrentRoomId(),
    boardVehicleById,
    hopOffCurrentVehicle,
    getRidingState: () => interiorSystem.getRidingState(),
    getCameraTarget: () =>
      fp.active ? { x: fp.x, z: fp.z, zoom: 1 } : { x: cam.tx, z: cam.tz, zoom: cam.zoom },
    getCameraState: () => ({
      tx: cam.tx,
      ty: cam.ty,
      tz: cam.tz,
      zoom: cam.zoom,
      az: cam.az,
      el: cam.el,
      dragMode,
      introActive: introSweep.active,
      fpActive: fp.active,
      fpX: fp.x,
      fpY: fp.y,
      fpZ: fp.z,
      fpYaw: fp.yaw,
      fpPitch: fp.pitch,
      joyRight: fpJoystick.right,
      joyFwd: fpJoystick.fwd,
      insideRoom: interiorSystem.getCurrentRoomId(),
      riding: interiorSystem.getRidingState(),
    }),
    getPlotRadius: () => plotMarker.getPlotRadius(),
    isPointerActive: () =>
      Boolean(pointerGesture) ||
      Boolean(fpTouchLook) ||
      Math.hypot(fpJoystick.right, fpJoystick.fwd) > 0.01 ||
      activePointers.size > 0,
    getCreationEntity: (id) => ensureCreationBuilt(id),
    getPerfStats: () => {
      const summarize = (root) => {
        let meshes = 0;
        let shadowCasters = 0;
        let triangles = 0;
        let frozenMeshes = 0;
        root.traverse((o) => {
          if (!o.isMesh) return;
          meshes++;
          if (o.castShadow) shadowCasters++;
          if (o.matrixAutoUpdate === false) frozenMeshes++;
          const g = o.geometry;
          if (g) {
            const tri = g.index
              ? g.index.count / 3
              : (g.attributes.position?.count || 0) / 3;
            triangles += o.isInstancedMesh ? tri * (o.count || 1) : tri;
          }
        });
        return { meshes, shadowCasters, triangles: Math.round(triangles), frozenMeshes };
      };
      return {
        entityCount: creationEntities.size,
        pendingCreations: pendingCreationSpecs.size,
        isStreamingCreations,
        qualityMode,
        effectiveQualityTier: getEffectiveQualityTier(),
        autoStepLevel,
        usePostProcessing,
        isLowTierGpu,
        isTouchDevice,
        activeMaxDpr,
        pixelRatio: renderer.getPixelRatio(),
        shadowRes: activeShadowRes,
        render: { ...renderer.info.render },
        memory: { ...renderer.info.memory },
        sceneTotal: summarize(scene),
        ground: summarize(groundMesh),
        perimeterTrees: summarize(perimeterTreesGroup),
        paths: summarize(pathsGroup),
        props: summarize(propsGroup),
        staticLandmarks: summarize(staticLandmarksGroup),
        creations: summarize(creationsGroup),
        villagers: summarize(villagersGroup),
        remotePlayers: summarize(remotePlayers.group),
      };
    },
  };
}

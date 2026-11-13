// GeminIsland — Procedural Voxel Building Interiors, Rideable Transit & Contextual Seating/Interactions.
// Pure micro-voxel rooms cached high above the island at INTERIOR_ORIGIN (y = 520) so multiplayer peers
// inside the same creation ID share the exact same physical room with zero exterior light/shadow cost.

import * as THREE from "three";
import {
  INTERACTIVE_HIT_LAYER,
} from "./interactive_games.js";
import {
  PALETTE,
  Vox,
  buildVoxelMesh,
  getCreationFootprintRadius,
  getVoxelMaterialForLayer,
} from "./vox.js";

/**
 * Shared pocket-sanctuary world origin high above GeminIsland (`y = 520`).
 * Local interior coordinates `(localX, localY, localZ)` map to
 * `(INTERIOR_ORIGIN.x + localX, INTERIOR_ORIGIN.y + localY, INTERIOR_ORIGIN.z + localZ)`
 * with floor height `localY = 0` (`worldY = 520`) and walkable `localX, localZ` in `[-4.75, 4.75]`.
 */
export const INTERIOR_ORIGIN = Object.freeze({ x: 0, y: 520, z: 0 });

const ROOM_VOX_SCALE = 0.16;
const FINE_VOX_SCALE = 0.08;
const ROOM_HALF_WALK = 4.75;
const PLAYER_INTERIOR_RADIUS = 0.42;
const FP_DEFAULT_EYE_HEIGHT = 1.65;
const SEAT_EYE_OFFSET = 1.24;
const MAX_CACHED_ROOMS = 6;

const ARCHITECTURAL_BUILDING_RE =
  /\b(bakery|patisserie|cafe|coffee|tea\s*room|pub|tavern|inn|cantina|saloon|bar|brewery|restaurant|diner|bistro|burger|pizzeria|gelateria|shop|bookshop|bookstore|store|market|emporium|boutique|florist|pharmacy|apothecary|cottage|house|home|cabin|chalet|bungalow|manor|mansion|villa|resort|hotel|motel|station|terminal|depot|parliament|city\s*hall|town\s*hall|hall|courthouse|bank|post\s*office|firehouse|fire\s*station|police|hospital|clinic|school|academy|tower|clocktower|lighthouse|castle|palace|citadel|fortress|temple|shrine|church|cathedral|chapel|pagoda|library|museum|gallery|conservatory|greenhouse|aquarium|planetarium|observatory|datacentre|datacenter|server|lab|laboratory|factory|foundry|mill|power\s*plant|reactor|sphere|pc|computer|cinema|theatre|theater|arena|stadium|pavilion|arcade|casino|barn|farmhouse|windmill|hangar|warehouse|workshop|studio)\b/i;

const NON_ENTERABLE_PRIMARY_RE =
  /\b(waterfall|cataract|cascade|volcano|stratovolcano|caldera|mountain|glacier|canyon|mesa|pond|lake|lagoon|ocean|river|stream|fountain|statue|monument|memorial|obelisk|totem|sign|signboard|billboard|bench|chair|table|lamp|streetlight|lantern|postbox|mailbox|hydrant|trash|bin|fence|wall|hedge|gate|bridge|overpass|viaduct|pier|dock|jetty|fog\s*cloud|rain\s*cloud|rainbow|balloon|tree|oak|pine|cherry\s*blossom|grove|forest|bush|shrub|flower|garden|bonsai|mushroom|rock|boulder|cliff|archway|halfpipe|skate|skatepark|quarry|open-pit|amphitheat\w*|launchpad|turbine|drilling\s*rig|surfboard|gazebo|half-court|streetball|basketball|tennis|pickleball|padel|rink|court|pitch|field|pool|aqueduct|ski\s*hill|ski\s*slope|parachute|drop\s*tower|eiffel\s*tower|coaster|ferris|carousel|alpr|camera|reef|drum\s*circle|campfire|bonfire|well|cart|barrow|stall|yatai|apiary|beehive|virtual\s*island|sky-shrine\s*island)\b/i;

const OPEN_AIR_DESC_EXCLUSION_RE =
  /\b(open-pit|amphitheat\w*|skateboard\s+halfpipe|outdoor\s+tasting\s+pavilion|outdoor\s+festival\s+arena|street-corner\s+ramen\s+stall|floating\s+sanctuary)\b/i;

const PURE_TABLETOP_GAME_KINDS = new Set([
  "tic_tac_toe",
  "connect_four",
  "whack_a_mole",
  "floor_piano",
  "simon_synth",
  "lights_out",
  "step_sequencer",
  "basketball_hoop",
  "slot_machine",
  "fireworks_mortar",
  "tesla_coil",
  "gravity_inverter",
  "marble_run",
]);

const LEADING_FLAVOR_PREFIX_RE =
  /^(?:the|a|an|sunnyvale|hearthstone|borealis|emerald|geminisland|meadow|clover|sunny|downtown|village|neighborhood|old|grand|royal|golden|little|cozy|misty)\s+/i;

const MINI_GAME_PLAY_KINDS = new Set([
  "tic_tac_toe",
  "connect_four",
  "whack_a_mole",
  "floor_piano",
  "simon_synth",
  "lights_out",
  "step_sequencer",
  "basketball_hoop",
  "slot_machine",
]);

// ─── WebAudio Micro-Synth for Interior Props & Transit Chimes ────────────────
let interiorAudioCtx = null;

function ensureAudio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!interiorAudioCtx) {
    try {
      interiorAudioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (interiorAudioCtx.state === "suspended") {
    interiorAudioCtx.resume().catch(() => {});
  }
  return interiorAudioCtx;
}

function playChime(freqs, stepSec = 0.065, dur = 0.16, type = "triangle", peak = 0.055) {
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== "running") return;
  try {
    freqs.forEach((freq, idx) => {
      const t0 = ctx.currentTime + idx * stepSec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(50, freq), t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  } catch {
    // Ignore audio context edge errors
  }
}

function playSoftNoise(dur = 0.18, peak = 0.035) {
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== "running") return;
  try {
    const sr = ctx.sampleRate;
    const len = Math.max(256, Math.floor(sr * dur));
    const buf = ctx.createBuffer(1, len, sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 3.4);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(t0);
  } catch {
    // Ignore
  }
}

// ─── Math & Naming Helpers ───────────────────────────────────────────────────
function wrapPi(rad) {
  let a = Number(rad) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function hashString(str) {
  const s = String(str || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function shortenActionNoun(rawName, fallback = "Structure", maxWords = 2) {
  let s = String(rawName || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return fallback;

  let words = s.split(" ");
  while (words.length > maxWords && LEADING_FLAVOR_PREFIX_RE.test(words.join(" "))) {
    words.shift();
  }
  if (words.length > 3) {
    // Strip middle filler adjectives like "Village" in "Clocktower Village Station"
    const filtered = words.filter((w, i) => i === 0 || i === words.length - 1 || !/^(?:village|corner|central|heavy|haul|sweet|swirl)$/i.test(w));
    if (filtered.length >= 2) words = filtered;
  }
  if (words.length > maxWords) {
    // Keep last `maxWords` words when noun phrase ends with the core building/vehicle noun
    words = words.slice(words.length - maxWords);
  }
  const joined = words.join(" ").trim();
  return joined || fallback;
}

function resolveVehicleDisplayName(ent, isSecondary = false) {
  const creation = ent?.data || {};
  const rawName = String(creation.name || creation.blueprint?.name || "").trim();
  const isDual =
    Boolean(ent?.isDualTransit) ||
    Boolean(ent?.secondaryVehicle) ||
    creation.id === "c-mvpvsf0l-5d0a39";

  if (isDual) {
    const splitParts = rawName
      .split(/\s*(?:&|\+|\band\b|\/|,)\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
    if (isSecondary) {
      const tramPart = splitParts.find((p) => /tram|trolley|streetcar/i.test(p)) || splitParts[1];
      if (tramPart) return shortenActionNoun(tramPart, "Melbourne Tram", 2);
      return "Melbourne Tram";
    }
    const trainPart = splitParts.find((p) => /waratah|train|express|rail/i.test(p)) || splitParts[0];
    if (trainPart) return shortenActionNoun(trainPart, "Waratah Train", 2);
    return "Waratah Train";
  }

  return shortenActionNoun(rawName, "Shuttle", 2);
}

// ─── Export 2: Enterable Creation Classifier ─────────────────────────────────
/**
 * Returns `true` only for enclosed architectural structures suitable for walking inside.
 * Excludes moving vehicles, creatures, aircraft, watercraft, flora, natural landforms,
 * open courts/rinks/pools, benches, signs, bridges, fountains, statues, clouds, and tiny street props.
 */
export function canEnterCreation(creation) {
  if (!creation || typeof creation !== "object") return false;
  if (creation.id === "__city_sign__") return false;

  const bType = creation.behavior?.type || "";
  if (
    bType === "vehicle_route" ||
    bType === "wander" ||
    bType === "fly_circle" ||
    bType === "water_float"
  ) {
    return false;
  }

  const cat = String(creation.category || creation.blueprint?.category || "").toLowerCase();
  if (
    cat === "prop" ||
    cat === "vehicle" ||
    cat === "creature" ||
    cat === "aircraft" ||
    cat === "watercraft" ||
    cat === "flora"
  ) {
    return false;
  }

  const scaleClass = String(creation.scaleClass || creation.blueprint?.scaleClass || "medium");
  if (scaleClass === "tiny") return false;

  const stats = creation.blueprint?.stats || {};
  const footprintX = Number(stats.footprintX ?? 14);
  const footprintZ = Number(stats.footprintZ ?? 14);
  const heightVoxels = Number(stats.heightVoxels ?? stats.maxY ?? 14);

  const name = String(creation.name || creation.blueprint?.name || "");
  const desc = String(creation.description || creation.blueprint?.description || "");
  const activity = String(creation.behavior?.activity || "");
  const fullText = `${name} ${desc} ${activity} ${cat}`;

  const isBakery = /\bbakery\b/i.test(name);
  if (!isBakery && (NON_ENTERABLE_PRIMARY_RE.test(name) || OPEN_AIR_DESC_EXCLUSION_RE.test(desc))) {
    return false;
  }

  const interactionKind = creation.blueprint?.interaction?.kind || "";
  if (interactionKind && PURE_TABLETOP_GAME_KINDS.has(interactionKind)) {
    return false;
  }

  const hasArchKeywordInName = ARCHITECTURAL_BUILDING_RE.test(name);
  const hasArchKeywordAnywhere = hasArchKeywordInName || ARCHITECTURAL_BUILDING_RE.test(fullText);

  if (cat === "building") {
    if (scaleClass === "small" && (footprintX < 9 || footprintZ < 9 || heightVoxels < 9)) {
      return false;
    }
    return footprintX >= 8 && footprintZ >= 8 && heightVoxels >= 8;
  }

  if (bType === "landmark") {
    if (footprintX < 10 || footprintZ < 10 || heightVoxels < 10) return false;
    return hasArchKeywordAnywhere;
  }

  return false;
}

// ─── Export 3: Building Doorway World Trigger ────────────────────────────────
/**
 * Computes exterior doorway & exit pose right outside a building's front (`+Z`) collision circle.
 * `exitYaw` uses Three.js `fpCamera` convention (`fwd = (-sin(yaw), -cos(yaw))`), facing outward away from the building.
 */
export function getBuildingDoorwayTrigger(ent) {
  if (!ent) return null;
  const creation = ent.data || ent;
  const ex = Number(ent.x ?? creation?.x ?? 0);
  const ez = Number(ent.z ?? creation?.z ?? 0);
  const eyaw =
    typeof ent.yaw === "number"
      ? ent.yaw
      : typeof creation?.behavior?.facingYaw === "number"
        ? creation.behavior.facingYaw
        : Number(creation?.yaw || 0);

  const footprintR =
    Number(ent.footprintRadius) ||
    getCreationFootprintRadius(
      creation?.scaleClass || creation?.blueprint?.scaleClass || "medium",
      creation?.blueprint?.stats?.footprintX ?? 14,
      creation?.blueprint?.stats?.footprintZ ?? 14,
    ) ||
    3.4;

  // Blueprints face local +Z -> world (+sin(eyaw), +cos(eyaw))
  const frontX = Math.sin(eyaw);
  const frontZ = Math.cos(eyaw);

  const doorDist = footprintR + 0.62;
  const exitDist = footprintR + 1.18;
  const doorX = ex + frontX * doorDist;
  const doorZ = ez + frontZ * doorDist;
  const exitX = ex + frontX * exitDist;
  const exitZ = ez + frontZ * exitDist;
  const exitYaw = Math.atan2(-(exitX - ex), -(exitZ - ez));

  return {
    creationId: ent.id || creation?.id || "",
    name: creation?.name || creation?.blueprint?.name || "Building",
    doorX,
    doorZ,
    exitX,
    exitZ,
    exitYaw,
    buildingYaw: eyaw,
    footprintRadius: footprintR,
    triggerRadius: 3.6,
  };
}

// ─── Interior Theme & Palette Extraction ─────────────────────────────────────
function classifyInteriorTheme(creation) {
  const name = String(creation?.name || creation?.blueprint?.name || "");
  const desc = String(creation?.description || creation?.blueprint?.description || "");
  const act = String(creation?.behavior?.activity || "");
  const text = `${name} ${act} ${desc}`;

  // Prioritize primary name first so "Matcha Corner Bookshop" -> shop_book, "Windmill Bakery" -> cafe_bakery
  if (/\b(bookshop|bookstore|library|boutique|florist|apothecary|pharmacy|emporium|post\s*office|market|general\s*store|shop|store)\b/i.test(name)) {
    return "shop_book";
  }
  if (/\b(bakery|patisserie|windmill|cafe|coffee|espresso|diner|bistro|burger|pizzeria|gelateria|restaurant|tea\s*house)\b/i.test(name)) {
    return "cafe_bakery";
  }
  if (/\b(pub|tavern|inn|cantina|saloon|bar|brewery|lounge|club|jukebox|casino|arcade)\b/i.test(name)) {
    return "pub_cantina";
  }
  if (/\b(datacentre|datacenter|server|pc|computer|cyber|lab|laboratory|observatory|factory|foundry|power\s*plant|reactor|quantum|tech|robotics|hangar)\b/i.test(name)) {
    return "tech_lab";
  }
  if (/\b(station|clocktower|terminal|depot|parliament|hall|courthouse|bank|firehouse|fire\s*station|police|hospital|clinic|school|academy|temple|church|cathedral|chapel|shrine)\b/i.test(name)) {
    return "civic_station";
  }
  if (/\b(sphere|dome|museum|gallery|cinema|theatre|theater|planetarium|aquarium|conservatory|greenhouse|pavilion|stadium|arena)\b/i.test(name)) {
    return "gallery_dome";
  }
  if (/\b(cottage|house|home|cabin|chalet|bungalow|manor|mansion|villa|resort|hotel|castle|palace|fortress|lighthouse|tower|barn|farmhouse)\b/i.test(name)) {
    return "cottage_manor";
  }

  // Fallback scan across full description + activity
  if (/\b(bakery|pastry|bread|espresso|cafe|restaurant|burger|gelato)\b/i.test(text)) return "cafe_bakery";
  if (/\b(pub|tavern|cantina|bar|brew|jukebox)\b/i.test(text)) return "pub_cantina";
  if (/\b(datacentre|datacenter|server|lab|reactor|computer|cyber|observatory|factory)\b/i.test(text)) return "tech_lab";
  if (/\b(book|shop|store|market|library)\b/i.test(text)) return "shop_book";
  if (/\b(station|transit|parliament|civic|hall|clocktower|firehouse|temple|church)\b/i.test(text)) return "civic_station";
  if (/\b(museum|gallery|exhibit|sculpture|sphere|cinema|theatre)\b/i.test(text)) return "gallery_dome";
  return "cottage_manor";
}

const THEME_DEFAULTS = {
  cafe_bakery: {
    wall: "#f8efe0",
    wainscot: "#8b5a36",
    floorA: "#e6d7be",
    floorB: "#cc7a57",
    accent: "#df5246",
    accent2: "#f0c24c",
    rafter: "#754a2b",
    lightHex: 0xffd596,
  },
  pub_cantina: {
    wall: "#e8dcc8",
    wainscot: "#5e3920",
    floorA: "#7d5130",
    floorB: "#694225",
    accent: "#be3438",
    accent2: "#ffb642",
    rafter: "#4f301a",
    lightHex: 0xffc67a,
  },
  tech_lab: {
    wall: "#dfe5ec",
    wainscot: "#38404d",
    floorA: "#464d59",
    floorB: "#383e49",
    accent: "#4ce8e0",
    accent2: "#5ef28c",
    rafter: "#2b303a",
    lightHex: 0xd8f4ff,
  },
  shop_book: {
    wall: "#f7f0e0",
    wainscot: "#8c5f37",
    floorA: "#c7925b",
    floorB: "#b37f4a",
    accent: "#6e9e6d",
    accent2: "#d9a74a",
    rafter: "#6e4727",
    lightHex: 0xffd99e,
  },
  cottage_manor: {
    wall: "#f5ecdc",
    wainscot: "#825534",
    floorA: "#c28c55",
    floorB: "#ad7944",
    accent: "#b85548",
    accent2: "#6da862",
    rafter: "#694226",
    lightHex: 0xffcf8c,
  },
  civic_station: {
    wall: "#f2ece0",
    wainscot: "#8d6340",
    floorA: "#eae2d0",
    floorB: "#d4cab6",
    accent: "#479c8b",
    accent2: "#e8b948",
    rafter: "#62432b",
    lightHex: 0xffe4b5,
  },
  gallery_dome: {
    wall: "#f8f6f0",
    wainscot: "#d8d2c5",
    floorA: "#d8b080",
    floorB: "#caa070",
    accent: "#5b63b8",
    accent2: "#f2be38",
    rafter: "#c8c2b6",
    lightHex: 0xfff0d6,
  },
};

function extractRoomPalette(creation, theme) {
  const base = { ...(THEME_DEFAULTS[theme] || THEME_DEFAULTS.cottage_manor) };
  const rawPal = creation?.blueprint?.palette;
  if (!rawPal || typeof rawPal !== "object") return base;

  const hsl = { h: 0, s: 0, l: 0 };
  const cTmp = new THREE.Color();
  let bestAccent = null;
  let bestAccentScore = 0.22;
  let bestWall = null;
  let bestWallScore = 0;
  let bestTrim = null;
  let bestTrimScore = 0;

  for (const [k, rawVal] of Object.entries(rawPal)) {
    if (typeof rawVal !== "string") continue;
    const hex = PALETTE[rawVal] || rawVal;
    try {
      cTmp.set(hex);
    } catch {
      continue;
    }
    cTmp.getHSL(hsl);
    const keyLower = k.toLowerCase();
    if (/glass|glow|fire|lava|eye|tire|black|rubber/.test(keyLower)) continue;

    if (hsl.s > bestAccentScore && hsl.l > 0.24 && hsl.l < 0.76) {
      bestAccentScore = hsl.s;
      bestAccent = `#${cTmp.getHexString()}`;
    }
    if (
      (/plaster|cream|wall|lime|marble|stone|sage/.test(keyLower) || (hsl.l > 0.68 && hsl.s < 0.36)) &&
      hsl.l > bestWallScore
    ) {
      bestWallScore = hsl.l;
      // Blend gently with warm cream so interior walls stay bright and airy
      cTmp.lerp(new THREE.Color(base.wall), 0.45);
      bestWall = `#${cTmp.getHexString()}`;
    }
    if (
      (/timber|wood|oak|brick|copper|slate|trim/.test(keyLower) || (hsl.l >= 0.16 && hsl.l <= 0.45 && hsl.s < 0.55)) &&
      hsl.l > bestTrimScore
    ) {
      bestTrimScore = hsl.l;
      bestTrim = `#${cTmp.getHexString()}`;
    }
  }

  if (bestAccent) base.accent = bestAccent;
  if (bestWall && theme !== "tech_lab") base.wall = bestWall;
  if (bestTrim && theme !== "gallery_dome") base.wainscot = bestTrim;
  return base;
}

// ─── Procedural Voxel Room Builder ───────────────────────────────────────────
function buildDoorstepMatPrototype() {
  const v = new Vox(1409);
  // Subtle low-profile coir & timber doorstep mat + glowing brass threshold corners
  v.box(-6, 0, -3, 6, 1, 3, "woodDark");
  v.box(-5, 0, -2, 5, 1, 2, "#c89b62");
  for (const [cx, cz] of [[-6, -3], [5, -3], [-6, 2], [5, 2]]) {
    v.put(cx, 0, cz, "warmGlow", 0.95);
  }
  const mesh = buildVoxelMesh(v, {
    scale: 0.105,
    castShadow: false,
    receiveShadow: true,
    depthLayer: 3,
  });
  return mesh.geometry;
}

function addVoxelChair(vox, fineVox, gx, gz, dir, woodCol, cushionCol) {
  // Chair centered at (gx, gz) in ROOM_VOX_SCALE (0.16m): 3x3 seat (~0.48m)
  const x0 = gx - 1;
  const x1 = gx + 2;
  const z0 = gz - 1;
  const z1 = gz + 2;
  for (const lx of [x0, x1 - 1]) {
    for (const lz of [z0, z1 - 1]) {
      vox.box(lx, 0, lz, lx + 1, 3, lz + 1, woodCol);
    }
  }
  vox.box(x0, 2, z0, x1, 3, z1, cushionCol || woodCol);
  if (dir === "-z") vox.box(x0, 3, z1 - 1, x1, 7, z1, woodCol);
  else if (dir === "+z") vox.box(x0, 3, z0, x1, 7, z0 + 1, woodCol);
  else if (dir === "+x") vox.box(x0, 3, z0, x0 + 1, 7, z1, woodCol);
  else if (dir === "-x") vox.box(x1 - 1, 3, z0, x1, 7, z1, woodCol);
  void fineVox;
}

function addVoxelStool(vox, gx, gz, legCol, topCol) {
  vox.box(gx, 0, gz, gx + 1, 3, gz + 1, legCol);
  vox.box(gx - 1, 3, gz - 1, gx + 2, 4, gz + 2, topCol);
}

function addPottedPlant(vox, gx, gz, potCol = "terracotta") {
  vox.box(gx - 2, 0, gz - 2, gx + 2, 3, gz + 2, potCol);
  vox.box(gx - 1, 3, gz - 1, gx + 1, 4, gz + 1, "soilDark");
  vox.box(gx, 4, gz, gx + 1, 7, gz + 1, "woodDark");
  vox.sphere(gx + 0.5, 8.2, gz + 0.5, 2.8, 2.4, 2.8, "leaf");
  vox.sphere(gx + 1.6, 7.4, gz + 1.2, 1.8, 1.6, 1.8, "leafLight");
}

function buildProceduralRoom(creation) {
  const seed = hashString(creation?.id || creation?.name || "room");
  const theme = classifyInteriorTheme(creation);
  const pal = extractRoomPalette(creation, theme);
  const s = ROOM_VOX_SCALE; // 0.16m
  const sf = FINE_VOX_SCALE; // 0.08m

  const group = new THREE.Group();
  group.name = `interior-room-${creation?.id || "default"}`;

  const vox = new Vox(seed & 1023);
  const fineVox = new Vox((seed + 37) & 1023);

  const boxObstacles = []; // { minX, maxX, minZ, maxZ }
  const circleObstacles = []; // { x, z, r }
  const hotspots = []; // { id, kind, label, x, y, z, seatTarget?, onTrigger? }
  const animHooks = [];
  const disposableGeos = [];
  const disposableMats = [];

  const registerMesh = (m, ownsMat = false) => {
    if (m?.geometry) disposableGeos.push(m.geometry);
    if (ownsMat && m?.material) disposableMats.push(m.material);
    return m;
  };

  // ── 1. Floor Slab (gy = -2..0 -> top surface strictly at localY = 0.00m) ────
  vox.box(-35, -2, -35, 35, -1, 35, "charcoal");
  vox.box(-35, -1, -35, 35, 0, 35, (x, _y, z) => {
    if (theme === "cafe_bakery") {
      const tile = ((x >> 2) + (z >> 2)) & 1;
      return tile ? pal.floorA : pal.floorB;
    }
    if (theme === "tech_lab") {
      if ((x & 7) === 0 || (z & 7) === 0) return "#2d333d";
      return ((x >> 3) + (z >> 3)) & 1 ? pal.floorA : pal.floorB;
    }
    if (theme === "civic_station") {
      const border = Math.abs(x) >= 28 || Math.abs(z) >= 28;
      if (border) return "#c7bba2";
      if (Math.abs(x) === 27 || Math.abs(z) === 27) return pal.accent2;
      return ((x >> 2) + (z >> 2)) & 1 ? pal.floorA : pal.floorB;
    }
    if (theme === "gallery_dome") {
      const r = Math.hypot(x + 0.5, z + 6.5);
      if (r < 9.5) return r > 8.2 ? pal.accent2 : "#f2eee4";
      return ((x >> 1) + ((z >> 3) & 1)) & 1 ? pal.floorA : pal.floorB;
    }
    // Cottage / Bookshop / Pub plank floor + inlaid woven rug
    if (theme === "shop_book" && x >= -14 && x < 6 && z >= -2 && z < 14) {
      const edge = x === -14 || x === 5 || z === -2 || z === 13;
      return edge ? pal.accent2 : pal.accent;
    }
    if (theme === "cottage_manor" && x >= -12 && x < 12 && z >= -18 && z < -2) {
      const edge = x === -12 || x === 11 || z === -18 || z === -3;
      return edge ? "#ead7b0" : pal.accent;
    }
    return ((x + ((z >> 2) & 1)) & 1) === 0 ? pal.floorA : pal.floorB;
  });

  // Flush front Welcome Mat inside Exit Door (gx = -7..7, gz = 26..33 => localZ = +4.16..+5.28)
  vox.box(-7, -1, 26, 7, 0, 33, "#6e4628");
  vox.box(-6, -1, 27, 6, 0, 32, "#c89658");

  // ── 2. Walls, Wainscoting, Corner Pilasters & Sunlit Windows (gy = 0..28) ──
  const buildWallShell = () => {
    // Lower wainscoting (gy = 0..8) + chair rail (gy = 8..9) + upper wall (gy = 9..26) + cornice (gy = 26..28)
    for (const [x0, z0, x1, z1] of [
      [-35, -35, 35, -33], // Rear (-Z)
      [-35, 33, 35, 35],   // Front (+Z, has Exit Door)
      [-35, -33, -33, 33], // Left (-X)
      [33, -33, 35, 33],   // Right (+X)
    ]) {
      vox.box(x0, 0, z0, x1, 8, z1, pal.wainscot);
      vox.box(x0, 8, z0, x1, 9, z1, theme === "tech_lab" ? "steel" : "woodDark");
      vox.box(x0, 9, z0, x1, 26, z1, pal.wall);
      vox.box(x0, 26, z0, x1, 28, z1, pal.rafter);
    }

    // 4 Corner pilasters for rich baked AO framing
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px0 = sx < 0 ? -33 : 31;
        const pz0 = sz < 0 ? -33 : 31;
        vox.box(px0, 0, pz0, px0 + 2, 27, pz0 + 2, pal.rafter);
      }
    }

    // Sunlit Paned Windows on Left (-X) & Right (+X) walls with sky glow & golden sun-sill!
    const winRanges =
      theme === "gallery_dome" || theme === "tech_lab"
        ? [[-18, -6]]
        : [
            [-21, -9],
            [5, 17],
          ];
    for (const [wz0, wz1] of winRanges) {
      const wMid = Math.floor((wz0 + wz1) * 0.5);
      // Left wall window (-X)
      if (!(theme === "shop_book" && wz0 < 0)) {
        vox.clear(-35, 9, wz0, -32, 21, wz1);
        vox.box(-35, 9, wz0, -34, 21, wz1, "#bce6fa", 1.15);
        vox.box(-35, 9, wz0, -34, 12, wz1, "#fff1c4", 0.95);
        // Frame & mullions
        vox.box(-34, 8, wz0 - 1, -32, 9, wz1 + 1, pal.rafter);
        vox.box(-34, 21, wz0 - 1, -32, 22, wz1 + 1, pal.rafter);
        vox.box(-34, 9, wMid, -33, 21, wMid + 1, pal.rafter);
        vox.box(-34, 15, wz0, -33, 16, wz1, pal.rafter);
      }
      // Right wall window (+X)
      if (!(theme === "cottage_manor" && wz0 < 0)) {
        vox.clear(32, 9, wz0, 35, 21, wz1);
        vox.box(34, 9, wz0, 35, 21, wz1, "#bce6fa", 1.15);
        vox.box(34, 9, wz0, 35, 12, wz1, "#fff1c4", 0.95);
        vox.box(32, 8, wz0 - 1, 34, 9, wz1 + 1, pal.rafter);
        vox.box(32, 21, wz0 - 1, 34, 22, wz1 + 1, pal.rafter);
        vox.box(33, 9, wMid, 34, 21, wMid + 1, pal.rafter);
        vox.box(33, 15, wz0, 34, 16, wz1, pal.rafter);
      }
    }

    // Ceiling & Exposed Rafters (gy = 26..30)
    vox.box(-35, 28, -35, 35, 30, 35, theme === "gallery_dome" ? "#f0ece2" : pal.wall);
    for (let rz = -24; rz <= 24; rz += 12) {
      vox.box(-33, 26, rz - 1, 33, 28, rz + 1, pal.rafter);
    }
    if (theme === "gallery_dome" || theme === "civic_station") {
      // Luminous Skylight Coffer overhead
      vox.box(-11, 27, -11, 11, 29, 11, pal.rafter);
      vox.box(-9, 28, -9, 9, 30, 9, "#d8f2ff", 1.1);
    }

    // Warm Front Exit Door at +Z (gz = 32..35, localZ = +5.12m, mat at +4.65m)
    vox.box(-7, 0, 32, 7, 19, 35, pal.rafter);
    vox.box(-5, 0, 33, 5, 15, 35, theme === "tech_lab" ? "steelDark" : "oak");
    vox.box(-1, 0, 32, 1, 15, 34, "woodDark");
    // Brass handles & glowing transom window above exit door
    vox.put(-2, 7, 32, "brass", 0.6);
    vox.put(1, 7, 32, "brass", 0.6);
    vox.box(-5, 16, 33, 5, 18, 35, "warmGlow", 1.2);
    vox.box(-2, 19, 31, 2, 21, 33, "#5ef28c", 1.1);
  };
  buildWallShell();

  // ── 3. Overhead Pendant Lamps + Interactive Lamp Toggle ─────────────────────
  const pendantPositions = [
    [-12, -8],
    [12, 8],
  ];
  const pendantBulbs = [];
  for (const [px, pz] of pendantPositions) {
    vox.box(px, 23, pz, px + 1, 28, pz + 1, "iron");
    vox.cone(px + 0.5, 21, 23, pz + 0.5, 3.2, 1.0, theme === "tech_lab" ? "steel" : "brass");
    const bv = new Vox(1511);
    bv.box(-1, 0, -1, 2, 2, 2, theme === "tech_lab" ? "#b8f5ff" : "warmGlow", 1.55);
    const bulbMesh = registerMesh(
      buildVoxelMesh(bv, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    bulbMesh.position.set((px + 0.5) * s, 20.6 * s, (pz + 0.5) * s);
    group.add(bulbMesh);
    pendantBulbs.push(bulbMesh);
  }

  const mainLight = new THREE.PointLight(pal.lightHex, 2.35, 14.5, 1.5);
  mainLight.position.set(0, 3.25, -0.4);
  mainLight.castShadow = false;
  group.add(mainLight);

  const accentLight = new THREE.PointLight(0xffb86c, 1.55, 9.5, 1.6);
  accentLight.position.set(0, 1.6, -3.2);
  accentLight.castShadow = false;
  group.add(accentLight);

  let lampsLit = true;
  let lampSwitchX = 3.6;
  let lampSwitchZ = 2.7;

  const registerSeatHotspot = (id, seatX, seatZ, yaw, standX, standZ) => {
    hotspots.push({
      id,
      kind: "sit",
      label: "Sit",
      x: seatX,
      y: 0.65,
      z: seatZ,
      seatTarget: {
        id: `${creation.id}:${id}`,
        x: seatX,
        y: 0.06,
        z: seatZ,
        eyeY: 0.06 + SEAT_EYE_OFFSET,
        yaw,
        isInterior: true,
        standX,
        standZ,
      },
    });
  };

  // ── 4. Theme-Specific Rich Micro-Voxel Furniture & Animated Props ───────────
  if (theme === "cafe_bakery") {
    // A. Domed Brick Bread Oven at rear-left (gx = -27..-13, gz = -31..-18 => x: -4.32..-2.08, z: -4.96..-2.88)
    vox.box(-27, 0, -32, -13, 6, -18, "stone");
    vox.roundedBox(-27, 6, -32, -13, 15, -19, 2.5, "brick");
    vox.box(-23, 15, -31, -17, 28, -25, "brickDark");
    vox.clear(-23, 7, -23, -17, 12, -18); // Oven mouth
    vox.box(-23, 6, -24, -17, 7, -18, "charcoal");
    boxObstacles.push({ minX: -4.4, maxX: -2.0, minZ: -5.1, maxZ: -2.8 });

    // Animated glowing oven fire mesh
    const fireVox = new Vox(1601);
    fireVox.box(-4, 0, -3, 4, 3, 3, "fire", 1.5);
    fireVox.box(-2, 2, -2, 2, 5, 2, "amber", 1.65);
    const ovenFireMesh = registerMesh(
      buildVoxelMesh(fireVox, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    ovenFireMesh.position.set(-20 * s, 7 * s, -21 * s);
    group.add(ovenFireMesh);
    accentLight.color.setHex(0xff8e3c);
    accentLight.position.set(-3.1, 1.35, -2.9);

    let ovenStokeBoost = 0;
    hotspots.push({
      id: "stoke_oven",
      kind: "interior_prop",
      label: "Stoke Oven",
      x: -3.2,
      y: 1.25,
      z: -2.75,
      onTrigger: () => {
        ovenStokeBoost = 1.0;
        playSoftNoise(0.22, 0.045);
        playChime([330, 440, 554.37], 0.06, 0.16, "triangle", 0.05);
      },
    });
    animHooks.push((dt, t) => {
      ovenStokeBoost = Math.max(0, ovenStokeBoost - dt * 0.45);
      const flick = 1 + Math.sin(t * 11.5) * 0.14 + ovenStokeBoost * 0.48;
      ovenFireMesh.scale.set(1 + ovenStokeBoost * 0.15, flick, 1);
      accentLight.intensity = (lampsLit ? 1.5 : 1.9) + Math.sin(t * 9.3) * 0.22 + ovenStokeBoost * 1.4;
    });

    // B. Pastry Display Counter + Espresso Machine (gx = -3..24, gz = -22..-14 => x: -0.48..3.84, z: -3.52..-2.24)
    vox.box(-3, 0, -22, 24, 6, -14, pal.wainscot);
    vox.box(-4, 6, -23, 25, 7, -13, "marble");
    // Glass pastry display case + golden croissants & berry tarts (fineVox at 0.08m = 2x vox coords)
    vox.box(-2, 7, -21, 12, 11, -15, "glass", 0.35);
    fineVox.box(-2, 15, -38, 4, 17, -34, "gold");
    fineVox.box(6, 15, -38, 12, 17, -34, "#e89249");
    fineVox.box(14, 15, -38, 20, 17, -34, "pink");
    // Chrome & copper Espresso Machine on right end of counter (gx = 16..22, gz = -20..-16)
    fineVox.box(32, 14, -40, 44, 22, -32, "chrome");
    fineVox.box(33, 18, -32, 43, 21, -30, "copper");
    fineVox.box(35, 14, -31, 37, 16, -29, "charcoal");
    fineVox.box(39, 14, -31, 41, 16, -29, "cream");
    boxObstacles.push({ minX: -0.68, maxX: 4.05, minZ: -3.72, maxZ: -2.05 });

    // Espresso Steam Puff mesh
    const steamVox = new Vox(1607);
    steamVox.sphere(0, 0, 0, 1.6, 2.0, 1.6, "white", 0.95);
    const steamMesh = registerMesh(
      buildVoxelMesh(steamVox, { scale: sf, castShadow: false, depthLayer: 4 }),
    );
    steamMesh.visible = false;
    group.add(steamMesh);
    let brewTimer = 0;

    hotspots.push({
      id: "brew_coffee",
      kind: "interior_prop",
      label: "Brew Coffee",
      x: 3.0,
      y: 1.25,
      z: -2.2,
      onTrigger: () => {
        brewTimer = 2.8;
        playSoftNoise(0.28, 0.04);
        playChime([523.25, 659.25, 783.99], 0.07, 0.18, "sine", 0.055);
      },
    });
    animHooks.push((dt, t) => {
      if (brewTimer > 0) {
        brewTimer = Math.max(0, brewTimer - dt);
        steamMesh.visible = true;
        const u = 1 - (brewTimer % 0.9) / 0.9;
        steamMesh.position.set(3.04 + Math.sin(t * 8) * 0.04, 1.38 + u * 0.55, -2.42);
        steamMesh.scale.setScalar(0.55 + u * 0.75);
      } else {
        steamMesh.visible = false;
      }
    });

    // C. Two Cafe Bistro Tables & Stools
    for (const [tx, tz] of [[-14, 5], [14, 6]]) {
      vox.box(tx, 0, tz, tx + 1, 5, tz + 1, "iron");
      vox.cylinderAxis("y", tx + 0.5, tz + 0.5, 5, 6, 3.6, "marble");
      circleObstacles.push({ x: (tx + 0.5) * s, z: (tz + 0.5) * s, r: 0.6 });
    }
    addVoxelStool(vox, -14, 11, "woodDark", pal.accent);
    addVoxelStool(vox, -8, 5, "woodDark", pal.accent);
    addVoxelStool(vox, 14, 12, "woodDark", pal.accent);
    circleObstacles.push({ x: -13.5 * s, z: 11.5 * s, r: 0.28 });
    circleObstacles.push({ x: -7.5 * s, z: 5.5 * s, r: 0.28 });
    circleObstacles.push({ x: 14.5 * s, z: 12.5 * s, r: 0.28 });

    registerSeatHotspot("stool_l1", -13.5 * s, 11.5 * s, 0, -13.5 * s, 15.8 * s);
    registerSeatHotspot("stool_l2", -7.5 * s, 5.5 * s, Math.PI / 2, -3.2 * s, 5.5 * s);
    registerSeatHotspot("stool_r1", 14.5 * s, 12.5 * s, 0, 14.5 * s, 16.8 * s);
    addPottedPlant(vox, -28, 24);
  } else if (theme === "pub_cantina") {
    // A. Long Mahogany Bar Counter & Illuminated Bottle Shelf
    vox.box(-26, 0, -32, 8, 18, -30, "woodDark");
    for (let bx = -24; bx <= 5; bx += 3) {
      const bCol = bx % 2 === 0 ? "#4ce8e0" : bx % 3 === 0 ? "#ffb642" : "#5ef28c";
      fineVox.box(bx * 2, 18, -60, bx * 2 + 2, 23, -58, bCol, 0.95);
      fineVox.box(bx * 2 + 1, 26, -60, bx * 2 + 3, 31, -58, "#ec8db0", 0.85);
    }
    vox.box(-25, 0, -21, 9, 6, -15, pal.wainscot);
    vox.box(-26, 6, -22, 10, 7, -14, "oak");
    vox.box(-25, 1, -14, 9, 2, -13, "brass");
    // Brass draft taps
    fineVox.box(-16, 14, -34, -10, 19, -32, "brass");
    boxObstacles.push({ minX: -4.2, maxX: 1.65, minZ: -3.6, maxZ: -2.05 });
    boxObstacles.push({ minX: -4.2, maxX: 1.4, minZ: -5.2, maxZ: -4.7 });

    // 3 Barstools
    for (const [idx, sx] of [[-18, -8, 2]].flat().map((v, i) => [i, v])) {
      addVoxelStool(vox, sx, -9, "iron", pal.accent);
      circleObstacles.push({ x: (sx + 0.5) * s, z: -8.5 * s, r: 0.28 });
      registerSeatHotspot(`barstool_${idx}`, (sx + 0.5) * s, -8.5 * s, 0, (sx + 0.5) * s, -3.5 * s);
    }

    // B. Retro Glowing Voxel Jukebox at rear-right (gx = 16..26, gz = -29..-21)
    vox.roundedBox(16, 0, -29, 26, 15, -21, 2.2, "woodDark");
    vox.box(17, 2, -21, 25, 9, -20, "charcoal");
    const jukeGlowVox = new Vox(1613);
    jukeGlowVox.box(-8, 0, 0, 8, 2, 2, "#ff5ca8", 1.6);
    jukeGlowVox.box(-8, 12, 0, 8, 14, 2, "#4ce8e0", 1.6);
    jukeGlowVox.box(-8, 2, 0, -6, 12, 2, "#ffb642", 1.5);
    jukeGlowVox.box(6, 2, 0, 8, 12, 2, "#ffb642", 1.5);
    const jukeGlowMesh = registerMesh(
      buildVoxelMesh(jukeGlowVox, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    jukeGlowMesh.position.set(21 * s, 6 * s, -20.5 * s);
    group.add(jukeGlowMesh);
    boxObstacles.push({ minX: 2.5, maxX: 4.2, minZ: -4.7, maxZ: -3.25 });

    accentLight.color.setHex(0xff7ec8);
    accentLight.position.set(3.35, 1.5, -2.9);
    let jukePartySec = 0;

    hotspots.push({
      id: "play_jukebox",
      kind: "interior_prop",
      label: "Play Jukebox",
      x: 3.35,
      y: 1.2,
      z: -3.15,
      onTrigger: () => {
        jukePartySec = 5.5;
        playChime([392, 493.88, 587.33, 783.99, 659.25], 0.085, 0.2, "square", 0.045);
      },
    });
    animHooks.push((dt, t) => {
      if (jukePartySec > 0) {
        jukePartySec = Math.max(0, jukePartySec - dt);
        jukeGlowMesh.scale.setScalar(1 + Math.sin(t * 14) * 0.06);
        accentLight.intensity = 2.4 + Math.sin(t * 12) * 0.65;
        accentLight.color.setHSL((t * 0.35) % 1, 0.82, 0.62);
      } else {
        jukeGlowMesh.scale.setScalar(1);
        accentLight.intensity = lampsLit ? 1.35 : 1.75;
        accentLight.color.setHex(0xff9d5c);
      }
    });

    // C. Cozy Side Booth on right wall (gx = 17..31, gz = 1..13)
    vox.box(18, 0, 4, 31, 5, 9, "oak");
    vox.box(17, 0, 12, 31, 3, 16, pal.accent);
    vox.box(17, 3, 15, 31, 8, 17, pal.accent);
    boxObstacles.push({ minX: 2.75, maxX: 5.0, minZ: 0.55, maxZ: 1.55 });
    boxObstacles.push({ minX: 2.75, maxX: 5.0, minZ: 1.9, maxZ: 2.75 });
    registerSeatHotspot("booth_seat", 23 * s, 13.5 * s, 0, 13.5 * s, 11 * s);
    lampSwitchX = -3.6;
    lampSwitchZ = 2.6;
  } else if (theme === "tech_lab") {
    // A. Twin Blinking Server Racks (rear-left & rear-right)
    for (const sx of [-24, 15]) {
      vox.box(sx, 0, -31, sx + 9, 22, -22, "charcoal");
      vox.box(sx + 1, 1, -22, sx + 8, 21, -21, "slate");
      for (let ry = 3; ry <= 19; ry += 3) {
        fineVox.box((sx + 2) * 2, ry * 2, -42, (sx + 5) * 2, ry * 2 + 1, -41, "screenCyan", 1.45);
        fineVox.box((sx + 6) * 2, ry * 2, -42, (sx + 7) * 2, ry * 2 + 1, -41, "screenGreen", 1.45);
      }
      boxObstacles.push({
        minX: sx * s - 0.08,
        maxX: (sx + 9) * s + 0.08,
        minZ: -5.0,
        maxZ: -3.3,
      });
    }

    // B. Central Quantum Status Core Pedestal at (0, -3.5)
    vox.cylinderAxis("y", 0, -22, 0, 4, 4.5, "steelDark");
    vox.ringAxis("y", 0, -22, 16, 18, 4.5, 2.8, "steel");
    circleObstacles.push({ x: 0, z: -22 * s, r: 0.8 });

    const coreVox = new Vox(1621);
    coreVox.sphere(0, 0, 0, 2.8, 3.8, 2.8, "#4ce8e0", 1.65);
    coreVox.ringAxis("y", 0, 0, -1, 1, 4.4, 3.3, "#5ef28c", 1.4);
    const coreMesh = registerMesh(
      buildVoxelMesh(coreVox, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    coreMesh.position.set(0, 10.5 * s, -22 * s);
    group.add(coreMesh);
    accentLight.color.setHex(0x4ce8e0);
    accentLight.position.set(0, 1.75, -3.4);

    // C. Curved Multi-Monitor Command Desk at (0, -0.35)
    vox.box(-12, 0, -6, -10, 5, -1, "steelDark");
    vox.box(10, 0, -6, 12, 5, -1, "steelDark");
    vox.box(-13, 5, -7, 13, 6, 1, "slateLight");
    // Triple glowing monitors + keyboard
    fineVox.box(-18, 13, -11, -7, 20, -9, "charcoal");
    fineVox.box(-17, 14, -9, -8, 19, -8, "screenCyan", 1.3);
    fineVox.box(-6, 13, -12, 6, 21, -10, "charcoal");
    fineVox.box(-5, 14, -10, 5, 20, -9, "screenGreen", 1.35);
    fineVox.box(7, 13, -11, 18, 20, -9, "charcoal");
    fineVox.box(8, 14, -9, 17, 19, -8, "screenCyan", 1.3);
    fineVox.box(-5, 12, -4, 5, 13, -1, "charcoal");
    boxObstacles.push({ minX: -2.12, maxX: 2.12, minZ: -1.16, maxZ: 0.2 });

    let pulseBoost = 0;
    hotspots.push({
      id: "pulse_console",
      kind: "interior_prop",
      label: "Pulse Console",
      x: 0,
      y: 1.15,
      z: -0.35,
      onTrigger: () => {
        pulseBoost = 1.0;
        playChime([523.25, 783.99, 1046.5, 1318.5], 0.055, 0.16, "sine", 0.055);
      },
    });
    animHooks.push((dt, t) => {
      pulseBoost = Math.max(0, pulseBoost - dt * 0.42);
      coreMesh.rotation.y += dt * (1.5 + pulseBoost * 7.5);
      coreMesh.position.y = 10.5 * s + Math.sin(t * 3.2) * 0.08;
      coreMesh.scale.setScalar(1 + pulseBoost * 0.22);
      accentLight.intensity = 1.65 + Math.sin(t * 4.5) * 0.25 + pulseBoost * 1.65;
    });

    // Swivel operator chair at (0, +0.92)
    addVoxelChair(vox, fineVox, 0, 6, "-z", "steelDark", pal.accent);
    circleObstacles.push({ x: 0.5 * s, z: 6.5 * s, r: 0.36 });
    registerSeatHotspot("console_chair", 0.5 * s, 6.5 * s, 0, 0, 12.5 * s);

    addVoxelChair(vox, fineVox, -16, 6, "+x", "steelDark", "#5b63b8");
    circleObstacles.push({ x: -15.5 * s, z: 6.5 * s, r: 0.36 });
    registerSeatHotspot("side_chair", -15.5 * s, 6.5 * s, -Math.PI / 2, -11 * s, 6.5 * s);
  } else if (theme === "shop_book") {
    // A. Tall Stocked Bookshelves along rear & left walls
    const buildBookshelf = (bx0, bz0, bx1, bz1, alongX) => {
      vox.box(bx0, 0, bz0, bx1, 19, bz1, "woodDark");
      const bookCols = ["crimson", "gold", "teal", "cream", "indigo", "terracotta", "leaf"];
      for (let sy = 2; sy <= 15; sy += 4) {
        if (alongX) {
          vox.box(bx0 + 1, sy, bz0 + 1, bx1 - 1, sy + 3, bz1, (x, _y, _z) => bookCols[Math.abs(x + sy) % bookCols.length]);
        } else {
          vox.box(bx0 + 1, sy, bz0 + 1, bx1, sy + 3, bz1 - 1, (_x, _y, z) => bookCols[Math.abs(z + sy) % bookCols.length]);
        }
      }
      boxObstacles.push({
        minX: bx0 * s - 0.06,
        maxX: bx1 * s + 0.06,
        minZ: bz0 * s - 0.06,
        maxZ: bz1 * s + 0.06,
      });
    };
    buildBookshelf(-27, -33, 4, -27, true);
    buildBookshelf(-33, -25, -27, 4, false);

    // B. Oak Checkout Counter + Brass Service Bell at right-rear (gx = 10..26, gz = -20..-13)
    vox.box(10, 0, -20, 26, 6, -13, pal.wainscot);
    vox.box(9, 6, -21, 27, 7, -12, "oak");
    // Stack of books & register
    fineVox.box(38, 14, -36, 46, 19, -30, "brass");
    fineVox.box(22, 14, -34, 28, 17, -28, "teal");
    boxObstacles.push({ minX: 1.44, maxX: 4.35, minZ: -3.4, maxZ: -1.9 });

    const bellVox = new Vox(1627);
    bellVox.box(-2, 0, -2, 2, 1, 2, "woodDark");
    bellVox.cone(0, 1, 3, 0, 1.8, 0.6, "gold", 0.55);
    const bellMesh = registerMesh(
      buildVoxelMesh(bellVox, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    bellMesh.position.set(16 * s, 7 * s, -15 * s);
    group.add(bellMesh);
    let bellBounce = 0;

    hotspots.push({
      id: "ring_bell",
      kind: "interior_prop",
      label: "Ring Bell",
      x: 16 * s,
      y: 1.2,
      z: -15 * s,
      onTrigger: () => {
        bellBounce = 1.0;
        playChime([1046.5, 1318.5], 0.07, 0.28, "sine", 0.065);
      },
    });
    animHooks.push((dt, t) => {
      if (bellBounce > 0) {
        bellBounce = Math.max(0, bellBounce - dt * 2.6);
        bellMesh.position.y = 7 * s + Math.abs(Math.sin(t * 24)) * 0.09 * bellBounce;
        bellMesh.rotation.z = Math.sin(t * 32) * 0.22 * bellBounce;
      } else {
        bellMesh.position.y = 7 * s;
        bellMesh.rotation.z = 0;
      }
    });

    // C. Reading Nook Tea Table & Plush Armchairs on the rug
    vox.box(-6, 0, 4, -2, 3, 8, "oak");
    fineVox.box(-10, 6, 10, -6, 8, 14, "cream");
    circleObstacles.push({ x: -4 * s, z: 6 * s, r: 0.48 });

    // Left armchair facing +X (yaw = -Math.PI/2) & Right armchair facing -X (yaw = +Math.PI/2)
    vox.roundedBox(-14, 0, 3, -9, 4, 9, 1.0, pal.accent);
    vox.box(-14, 4, 3, -12, 8, 9, pal.accent);
    circleObstacles.push({ x: -11.5 * s, z: 6 * s, r: 0.48 });
    registerSeatHotspot("armchair_l", -11 * s, 6 * s, -Math.PI / 2, -11 * s, 13 * s);

    vox.roundedBox(1, 0, 3, 6, 4, 9, 1.0, "#cc7a57");
    vox.box(4, 4, 3, 6, 8, 9, "#cc7a57");
    circleObstacles.push({ x: 3.5 * s, z: 6 * s, r: 0.48 });
    registerSeatHotspot("armchair_r", 3 * s, 6 * s, Math.PI / 2, 3 * s, 13 * s);

    addPottedPlant(vox, 27, 23);
  } else if (theme === "civic_station") {
    // A. 4 Fluted Marble Columns
    for (const [cx, cz] of [
      [-20, -16],
      [20, -16],
      [-20, 10],
      [20, 10],
    ]) {
      vox.box(cx - 2, 0, cz - 2, cx + 3, 2, cz + 3, "stone");
      vox.cylinderAxis("y", cx + 0.5, cz + 0.5, 2, 26, 2.1, "marble");
      vox.box(cx - 2, 25, cz - 2, cx + 3, 27, cz + 3, "limestone");
      circleObstacles.push({ x: (cx + 0.5) * s, z: (cz + 0.5) * s, r: 0.48 });
    }

    // B. Rear Departure Board & Ticket Counter (gx = -14..14, gz = -29..-21)
    vox.box(-15, 11, -33, 15, 22, -31, "charcoal");
    for (let row = 13; row <= 19; row += 2) {
      fineVox.box(-24, row * 2, -62, -6, row * 2 + 1, -61, "amber", 1.25);
      fineVox.box(2, row * 2, -62, 18, row * 2 + 1, -61, "screenGreen", 1.25);
    }
    vox.box(-14, 0, -26, 14, 6, -20, pal.wainscot);
    vox.box(-15, 6, -27, 15, 7, -19, "marble");
    boxObstacles.push({ minX: -2.45, maxX: 2.45, minZ: -4.4, maxZ: -3.0 });

    // Station Brass Bell on ticket counter
    const stBellVox = new Vox(1633);
    stBellVox.cone(0, 0, 3, 0, 2.0, 0.6, "gold", 0.65);
    const stBellMesh = registerMesh(
      buildVoxelMesh(stBellVox, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    stBellMesh.position.set(8 * s, 7 * s, -21 * s);
    group.add(stBellMesh);
    let stBellRing = 0;

    hotspots.push({
      id: "station_bell",
      kind: "interior_prop",
      label: "Ring Bell",
      x: 8 * s,
      y: 1.2,
      z: -20 * s,
      onTrigger: () => {
        stBellRing = 1.0;
        playChime([783.99, 987.77, 1174.66], 0.08, 0.25, "triangle", 0.06);
      },
    });
    animHooks.push((dt, t) => {
      if (stBellRing > 0) {
        stBellRing = Math.max(0, stBellRing - dt * 2.5);
        stBellMesh.rotation.z = Math.sin(t * 28) * 0.28 * stBellRing;
      } else {
        stBellMesh.rotation.z = 0;
      }
    });

    // C. Central Emblem Pedestal + Two Wooden Waiting Benches
    vox.cylinderAxis("y", 0, -4, 0, 5, 3.2, "limestone");
    vox.sphere(0, 7, -4, 1.8, 1.8, 1.8, "gold", 0.6);
    circleObstacles.push({ x: 0, z: -4 * s, r: 0.6 });

    // Left & Right wooden benches
    vox.box(-16, 0, -6, -12, 3, 4, "oak");
    vox.box(-16, 3, -6, -15, 7, 4, "woodDark");
    boxObstacles.push({ minX: -2.62, maxX: -1.88, minZ: -1.0, maxZ: 0.68 });
    registerSeatHotspot("bench_west", -13.5 * s, -1 * s, -Math.PI / 2, -8.5 * s, -1 * s);

    vox.box(12, 0, -6, 16, 3, 4, "oak");
    vox.box(15, 3, -6, 16, 7, 4, "woodDark");
    boxObstacles.push({ minX: 1.88, maxX: 2.62, minZ: -1.0, maxZ: 0.68 });
    registerSeatHotspot("bench_east", 13.5 * s, -1 * s, Math.PI / 2, 8.5 * s, -1 * s);
  } else if (theme === "gallery_dome") {
    // A. Framed Voxel Mural Canvases on Rear & Side Walls
    vox.box(-12, 10, -33, 12, 22, -32, "woodDark");
    vox.box(-11, 11, -32, 11, 21, -31, (x, y) => {
      if (y < 14) return "teal";
      if (Math.hypot(x - 4, y - 18) < 2.6) return "gold";
      return y < 17 ? "sky" : "indigo";
    });

    // B. Three Gallery Plinths + Kinetic Central Sculpture
    for (const [px, pz, col] of [
      [-18, -12, "#df5246"],
      [18, -12, "#5ef28c"],
    ]) {
      vox.box(px - 3, 0, pz - 3, px + 3, 6, pz + 3, "marble");
      vox.ringAxis("z", px, 9, pz - 1, pz + 1, 2.8, 1.3, col, 0.55);
      circleObstacles.push({ x: px * s, z: pz * s, r: 0.65 });
    }

    vox.cylinderAxis("y", 0, -10, 0, 6, 4.2, "marble");
    circleObstacles.push({ x: 0, z: -10 * s, r: 0.78 });

    const sculpVox = new Vox(1641);
    sculpVox.ringAxis("x", 0, 0, -2, 2, 4.2, 2.6, "gold", 0.95);
    sculpVox.ringAxis("z", 0, 0, -2, 2, 3.0, 1.6, "#4ce8e0", 1.25);
    const sculpMesh = registerMesh(
      buildVoxelMesh(sculpVox, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    sculpMesh.position.set(0, 9.8 * s, -10 * s);
    group.add(sculpMesh);
    let spinBoost = 0;

    hotspots.push({
      id: "spin_sculpture",
      kind: "interior_prop",
      label: "Spin Sculpture",
      x: 0,
      y: 1.35,
      z: -10 * s,
      onTrigger: () => {
        spinBoost = 1.0;
        playChime([587.33, 880, 1174.66], 0.065, 0.22, "sine", 0.055);
      },
    });
    animHooks.push((dt, t) => {
      spinBoost = Math.max(0, spinBoost - dt * 0.4);
      sculpMesh.rotation.y += dt * (0.9 + spinBoost * 5.8);
      sculpMesh.rotation.x = Math.sin(t * 1.4) * 0.25;
      sculpMesh.position.y = 9.8 * s + Math.sin(t * 2.4) * 0.06;
    });

    // C. Gallery Viewing Bench at (0, +1.35m) facing -Z
    vox.box(-9, 0, 7, 9, 3, 11, "oak");
    boxObstacles.push({ minX: -1.48, maxX: 1.48, minZ: 1.08, maxZ: 1.8 });
    registerSeatHotspot("gallery_bench", 0, 8.8 * s, 0, 0, 15.5 * s);
  } else {
    // Default `cottage_manor`: Stone Fireplace w/ Hearth, Plush Sofa, Coffee Table, Bookcase, Plant
    // A. Stone Fireplace on Rear Wall (gx = -10..10, gz = -33..-22)
    vox.box(-10, 0, -33, 10, 12, -22, "stone");
    vox.box(-11, 12, -33, 11, 13, -21, "oak"); // Mantelpiece
    vox.box(-7, 13, -33, 7, 28, -25, "stone");
    vox.clear(-6, 1, -28, 6, 9, -21);
    vox.box(-5, 1, -27, 5, 2, -23, "woodDark");
    boxObstacles.push({ minX: -1.72, maxX: 1.72, minZ: -5.2, maxZ: -3.42 });

    const hearthVox = new Vox(1651);
    hearthVox.box(-5, 0, -3, 5, 3, 3, "fire", 1.55);
    hearthVox.box(-3, 2, -2, 3, 6, 2, "amber", 1.7);
    const hearthMesh = registerMesh(
      buildVoxelMesh(hearthVox, { scale: sf, castShadow: false, depthLayer: 3 }),
    );
    hearthMesh.position.set(0, 2.1 * s, -24.5 * s);
    group.add(hearthMesh);
    accentLight.color.setHex(0xff8c3b);
    accentLight.position.set(0, 1.15, -3.5);

    let hearthStoke = 0;
    hotspots.push({
      id: "stoke_hearth",
      kind: "interior_prop",
      label: "Stoke Hearth",
      x: 0,
      y: 0.95,
      z: -3.5,
      onTrigger: () => {
        hearthStoke = 1.0;
        playSoftNoise(0.24, 0.045);
        playChime([329.63, 440, 523.25], 0.07, 0.18, "triangle", 0.05);
      },
    });
    animHooks.push((dt, t) => {
      hearthStoke = Math.max(0, hearthStoke - dt * 0.42);
      const fl = 1 + Math.sin(t * 10.5) * 0.15 + Math.cos(t * 16.3) * 0.08 + hearthStoke * 0.45;
      hearthMesh.scale.set(1 + hearthStoke * 0.14, fl, 1);
      accentLight.intensity = (lampsLit ? 1.55 : 2.05) + Math.sin(t * 9.8) * 0.25 + hearthStoke * 1.4;
    });

    // B. Low Oak Coffee Table at (0, -2.0m) + Plush Sofa at (0, -0.45m) facing -Z
    vox.box(-6, 0, -14, 6, 3, -10, "oak");
    fineVox.box(-4, 6, -25, 0, 8, -21, "cream");
    fineVox.box(3, 6, -25, 6, 9, -22, "terracotta");
    boxObstacles.push({ minX: -1.0, maxX: 1.0, minZ: -2.28, maxZ: -1.56 });

    vox.roundedBox(-10, 0, -5, 10, 4, 1, 1.0, pal.accent);
    vox.box(-10, 4, -1, 10, 8, 1, pal.accent);
    vox.box(-10, 3, -5, -8, 6, 1, pal.accent);
    vox.box(8, 3, -5, 10, 6, 1, pal.accent);
    boxObstacles.push({ minX: -1.64, maxX: 1.64, minZ: -0.82, maxZ: 0.2 });
    registerSeatHotspot("cottage_sofa", 0, -2.5 * s, 0, 0, 6.5 * s);

    // Wingback armchair on left facing fireplace
    vox.roundedBox(-18, 0, -14, -13, 4, -8, 1.0, "#d9a74a");
    vox.box(-18, 4, -14, -16, 8, -8, "#d9a74a");
    circleObstacles.push({ x: -15.5 * s, z: -11 * s, r: 0.48 });
    registerSeatHotspot("cottage_chair", -15 * s, -11 * s, -1.05, -14 * s, -4 * s);

    // Right-wall Bookcase + Potted Plant
    vox.box(27, 0, -20, 33, 18, -4, "woodDark");
    for (let sy = 2; sy <= 14; sy += 4) {
      vox.box(27, sy, -19, 32, sy + 3, -5, (_x, _y, z) => (z % 2 === 0 ? "teal" : "gold"));
    }
    boxObstacles.push({ minX: 4.25, maxX: 5.2, minZ: -3.25, maxZ: -0.6 });
    addPottedPlant(vox, -27, 23);
  }

  // ── 5. Interactive Floor Lamp Stand (`Toggle Lamp`) ─────────────────────────
  const lxG = Math.round(lampSwitchX / s);
  const lzG = Math.round(lampSwitchZ / s);
  vox.box(lxG - 1, 0, lzG - 1, lxG + 2, 1, lzG + 2, "brass");
  vox.box(lxG, 1, lzG, lxG + 1, 10, lzG + 1, "iron");
  circleObstacles.push({ x: (lxG + 0.5) * s, z: (lzG + 0.5) * s, r: 0.3 });

  const lampShadeVox = new Vox(1663);
  lampShadeVox.cone(0, 0, 4, 0, 2.8, 1.4, "warmGlow", 1.55);
  const lampShadeMesh = registerMesh(
    buildVoxelMesh(lampShadeVox, { scale: sf, castShadow: false, depthLayer: 3 }),
  );
  lampShadeMesh.position.set((lxG + 0.5) * s, 9.8 * s, (lzG + 0.5) * s);
  group.add(lampShadeMesh);

  hotspots.push({
    id: "toggle_lamp",
    kind: "interior_prop",
    label: "Toggle Lamp",
    x: (lxG + 0.5) * s,
    y: 1.25,
    z: (lzG + 0.5) * s,
    onTrigger: () => {
      lampsLit = !lampsLit;
      mainLight.intensity = lampsLit ? 2.35 : 0.42;
      lampShadeMesh.scale.setScalar(lampsLit ? 1.0 : 0.86);
      for (const b of pendantBulbs) b.visible = lampsLit;
      playChime(lampsLit ? [523.25, 659.25] : [659.25, 440], 0.055, 0.12, "triangle", 0.05);
    },
  });

  // Compile structural shell + fine props into 2 static voxel draw calls
  if (vox.size > 0) {
    const shellMesh = registerMesh(
      buildVoxelMesh(vox, {
        scale: s,
        castShadow: false,
        receiveShadow: false,
        depthLayer: 0,
      }),
    );
    shellMesh.matrixAutoUpdate = false;
    shellMesh.updateMatrix();
    group.add(shellMesh);
  }
  if (fineVox.size > 0) {
    const fineMesh = registerMesh(
      buildVoxelMesh(fineVox, {
        scale: sf,
        castShadow: false,
        receiveShadow: false,
        depthLayer: 2,
      }),
    );
    fineMesh.matrixAutoUpdate = false;
    fineMesh.updateMatrix();
    group.add(fineMesh);
  }

  return {
    roomId: creation.id,
    theme,
    sig: `${creation.id}:${creation.name || ""}:${Object.values(creation.blueprint?.palette || {}).join(",")}`,
    group,
    boxObstacles,
    circleObstacles,
    hotspots,
    step(dt, t) {
      for (let i = 0; i < animHooks.length; i++) {
        animHooks[i](dt, t);
      }
    },
    dispose() {
      for (const geo of disposableGeos) geo.dispose();
      for (const mat of disposableMats) mat.dispose();
    },
  };
}

// ─── Export 4: Main Interiors, Transit & Contextual Interaction System ───────
export function createInteriorAndTransitSystem({
  scene,
  getCreationEntities,
  getWorld,
  resolveExteriorWalkPosition,
} = {}) {
  const safeResolveExterior =
    typeof resolveExteriorWalkPosition === "function"
      ? resolveExteriorWalkPosition
      : (x, z) => [x, z];

  // Root container at (0, 520, 0) — strictly hidden when outdoors so 0 lights/meshes run outside!
  const interiorGroup = new THREE.Group();
  interiorGroup.name = "pocket-interior-sanctuary";
  interiorGroup.position.set(INTERIOR_ORIGIN.x, INTERIOR_ORIGIN.y, INTERIOR_ORIGIN.z);
  interiorGroup.visible = false;
  scene?.add?.(interiorGroup);

  // Subtle physical 3D Doorstep Mats outside enterable buildings (1 shared geometry, 0 shadow cost)
  const doorwayBeaconsGroup = new THREE.Group();
  doorwayBeaconsGroup.name = "building-doorway-mats";
  scene?.add?.(doorwayBeaconsGroup);
  const doorMatGeo = buildDoorstepMatPrototype();
  let lastDoorBeaconSig = "";
  let doorSyncCooldown = 0;

  // LRU cache of up to 6 compiled rooms
  const roomCache = new Map(); // roomId -> compiledRoom
  let activeRoom = null;
  let activeCreation = null;
  let savedExteriorPose = null;

  // Active transit riding state & seating state
  let ridingState = null; // { rideId, seat, vehicleName, prevHeadingYaw, deltaYaw }
  let seatState = null; // { id, x, y, z, eyeY, yaw, isInterior, standX, standZ }
  let lastSimTime = 0;

  const interactiveRaycaster = new THREE.Raycaster();
  interactiveRaycaster.layers.set(INTERACTIVE_HIT_LAYER);
  const tmpRayOrigin = new THREE.Vector3();
  const tmpRayDir = new THREE.Vector3();

  function iterEntities() {
    const src = getCreationEntities?.();
    if (!src) return [];
    if (src instanceof Map) return src.values();
    if (Array.isArray(src)) return src;
    if (typeof src[Symbol.iterator] === "function") return src;
    return Object.values(src);
  }

  function findEntityById(id) {
    if (!id) return null;
    const src = getCreationEntities?.();
    if (!src) return null;
    if (src instanceof Map) return src.get(id) || null;
    if (Array.isArray(src)) return src.find((e) => e?.id === id) || null;
    return src[id] || null;
  }

  function parseRideId(rawRideId) {
    const str = String(rawRideId || "").trim();
    if (!str) return null;
    const isSecondary = str.endsWith("#sec") || str.endsWith("#tram");
    const baseId = isSecondary ? str.replace(/#(?:sec|tram)$/, "") : str;
    const canonicalRideId = isSecondary ? `${baseId}#sec` : baseId;
    const ent = findEntityById(baseId);
    if (!ent || ent.data?.behavior?.type !== "vehicle_route") return null;
    if (isSecondary && !ent.secondaryVehicle) return null;
    return {
      canonicalRideId,
      baseId,
      isSecondary,
      ent,
      veh: isSecondary ? ent.secondaryVehicle : ent,
    };
  }

  function syncDoorstepBeacons() {
    if (activeRoom) {
      doorwayBeaconsGroup.visible = false;
      return;
    }
    doorwayBeaconsGroup.visible = true;
    const enterable = [];
    let sig = "";
    for (const ent of iterEntities()) {
      if (!ent?.data || !canEnterCreation(ent.data)) continue;
      enterable.push(ent);
      sig += `${ent.id}:${Math.round((ent.x || 0) * 10)}:${Math.round((ent.z || 0) * 10)}:${Math.round((ent.yaw || 0) * 20)}|`;
    }
    if (sig === lastDoorBeaconSig) return;
    lastDoorBeaconSig = sig;

    while (doorwayBeaconsGroup.children.length) {
      doorwayBeaconsGroup.remove(doorwayBeaconsGroup.children[0]);
    }
    const sharedLayer3Mat = getVoxelMaterialForLayer(3);

    for (const ent of enterable) {
      const trig = getBuildingDoorwayTrigger(ent);
      if (!trig) continue;
      const m = new THREE.Mesh(doorMatGeo, sharedLayer3Mat);
      m.castShadow = false;
      m.receiveShadow = true;
      const frontX = Math.sin(trig.buildingYaw);
      const frontZ = Math.cos(trig.buildingYaw);
      const matDist = trig.footprintRadius + 0.42;
      m.position.set(ent.x + frontX * matDist, 0.014, ent.z + frontZ * matDist);
      m.rotation.y = trig.buildingYaw;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      doorwayBeaconsGroup.add(m);
    }
  }

  function getOrBuildRoom(creation) {
    const id = creation.id;
    const nextSig = `${id}:${creation.name || ""}:${Object.values(creation.blueprint?.palette || {}).join(",")}`;
    let existing = roomCache.get(id);
    if (existing && existing.sig === nextSig) {
      // Refresh LRU position
      roomCache.delete(id);
      roomCache.set(id, existing);
      return existing;
    }
    if (existing) {
      interiorGroup.remove(existing.group);
      existing.dispose();
      roomCache.delete(id);
    }

    const built = buildProceduralRoom(creation);
    built.group.visible = false;
    interiorGroup.add(built.group);
    roomCache.set(id, built);

    while (roomCache.size > MAX_CACHED_ROOMS) {
      let evictedId = null;
      for (const candidateId of roomCache.keys()) {
        if (candidateId !== activeRoom?.roomId) {
          evictedId = candidateId;
          break;
        }
      }
      if (!evictedId) break;
      const stale = roomCache.get(evictedId);
      roomCache.delete(evictedId);
      if (stale) {
        interiorGroup.remove(stale.group);
        stale.dispose();
      }
    }
    return built;
  }

  // ── A. Procedural Voxel Building Interiors API ─────────────────────────────
  function enterBuilding(creationId, fallbackExteriorPose = null) {
    const ent = findEntityById(creationId);
    const creation =
      ent?.data ||
      (getWorld?.()?.creations || []).find((c) => c.id === creationId) ||
      null;
    if (!creation || !canEnterCreation(creation)) {
      return { ok: false, roomId: null, spawnLocal: null, creation: null };
    }

    // Clear riding or sitting before entering
    ridingState = null;
    seatState = null;

    const trig = getBuildingDoorwayTrigger(ent || creation);
    if (trig) {
      const [ex, ez] = safeResolveExterior(trig.exitX, trig.exitZ);
      savedExteriorPose = {
        x: ex,
        z: ez,
        yaw: trig.exitYaw,
        pitch: -0.02,
      };
    } else if (fallbackExteriorPose && Number.isFinite(fallbackExteriorPose.x)) {
      savedExteriorPose = {
        x: fallbackExteriorPose.x,
        z: fallbackExteriorPose.z,
        yaw: fallbackExteriorPose.yaw || 0,
        pitch: -0.02,
      };
    }

    if (activeRoom) {
      activeRoom.group.visible = false;
    }
    const room = getOrBuildRoom(creation);
    activeRoom = room;
    activeCreation = creation;
    room.group.visible = true;
    interiorGroup.visible = true;
    doorwayBeaconsGroup.visible = false;

    playChime([440, 554.37, 659.25], 0.055, 0.14, "triangle", 0.05);

    const spawnLocal = {
      x: 0,
      y: 0,
      z: 3.85,
      yaw: 0,
      pitch: -0.03,
    };
    return {
      ok: true,
      roomId: creation.id,
      spawnLocal,
      creation,
    };
  }

  function exitBuilding() {
    if (!activeRoom) {
      return { ok: false, exteriorPose: null };
    }
    const exitingId = activeRoom.roomId;
    activeRoom.group.visible = false;
    activeRoom = null;
    activeCreation = null;
    interiorGroup.visible = false;
    doorwayBeaconsGroup.visible = true;
    if (seatState?.isInterior) {
      seatState = null;
    }

    let exteriorPose = savedExteriorPose || { x: 0, z: 8, yaw: 0, pitch: -0.02 };
    const liveEnt = findEntityById(exitingId);
    if (liveEnt) {
      const trig = getBuildingDoorwayTrigger(liveEnt);
      if (trig) {
        const [ex, ez] = safeResolveExterior(trig.exitX, trig.exitZ);
        exteriorPose = {
          x: ex,
          z: ez,
          yaw: trig.exitYaw,
          pitch: -0.02,
        };
      }
    }

    playChime([659.25, 523.25], 0.055, 0.14, "triangle", 0.05);
    return { ok: true, exteriorPose };
  }

  function isInside() {
    return Boolean(activeRoom);
  }

  function getCurrentRoomId() {
    return activeRoom ? activeRoom.roomId : null;
  }

  function getCurrentCreation() {
    return activeCreation || null;
  }

  /**
   * Local floor height inside active rooms (`localY = 0` relative to `INTERIOR_ORIGIN.y = 520`).
   * World Y of the interior floor is `INTERIOR_ORIGIN.y + getInteriorFloorHeight(localX, localZ)`.
   */
  function getInteriorFloorHeight(_localX = 0, _localZ = 0) {
    return 0;
  }

  function resolveInteriorWalkPosition(localX, localZ) {
    let x = Math.max(-ROOM_HALF_WALK, Math.min(ROOM_HALF_WALK, Number(localX) || 0));
    let z = Math.max(-ROOM_HALF_WALK, Math.min(ROOM_HALF_WALK, Number(localZ) || 0));
    if (!activeRoom) return [x, z];

    const pr = PLAYER_INTERIOR_RADIUS;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of activeRoom.circleObstacles) {
        const minR = c.r + pr;
        const dx = x - c.x;
        const dz = z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < minR) {
          if (d > 1e-4) {
            x = c.x + (dx / d) * minR;
            z = c.z + (dz / d) * minR;
          } else {
            z = c.z + minR;
          }
        }
      }

      for (const b of activeRoom.boxObstacles) {
        const cx = Math.max(b.minX, Math.min(b.maxX, x));
        const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
        const dx = x - cx;
        const dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d < pr) {
          if (d > 1e-4) {
            x = cx + (dx / d) * pr;
            z = cz + (dz / d) * pr;
          } else {
            // Inside AABB: push smoothly out the nearest face
            const leftPen = x - (b.minX - pr);
            const rightPen = b.maxX + pr - x;
            const backPen = z - (b.minZ - pr);
            const frontPen = b.maxZ + pr - z;
            const minPen = Math.min(leftPen, rightPen, backPen, frontPen);
            if (minPen === frontPen) z = b.maxZ + pr;
            else if (minPen === backPen) z = b.minZ - pr;
            else if (minPen === leftPen) x = b.minX - pr;
            else x = b.maxX + pr;
          }
        }
      }

      x = Math.max(-ROOM_HALF_WALK, Math.min(ROOM_HALF_WALK, x));
      z = Math.max(-ROOM_HALF_WALK, Math.min(ROOM_HALF_WALK, z));
    }

    return [x, z];
  }

  // ── B. Rideable Transit & Vehicles (`vehicle_route`) API ───────────────────
  const vehicleRoofLocalYCache = new WeakMap();
  const tmpLocalBox = new THREE.Box3();
  const tmpMeshBox = new THREE.Box3();
  const tmpRelMat = new THREE.Matrix4();

  function getVehicleRoofLocalY(veh, ent) {
    const vehGroup = veh?.group || null;
    if (vehGroup?.isObject3D) {
      let cachedUnscaledY = vehicleRoofLocalYCache.get(vehGroup);
      if (cachedUnscaledY === undefined) {
        tmpLocalBox.makeEmpty();
        vehGroup.traverse((obj) => {
          if (!obj.isMesh || obj === ent?.feedMesh || !obj.geometry?.attributes?.position) return;
          if (!obj.geometry.boundingBox) {
            obj.geometry.computeBoundingBox();
          }
          if (!obj.geometry.boundingBox || obj.geometry.boundingBox.isEmpty()) return;
          tmpRelMat.identity();
          let cur = obj;
          while (cur && cur !== vehGroup) {
            cur.updateMatrix();
            tmpRelMat.premultiply(cur.matrix);
            cur = cur.parent;
          }
          tmpMeshBox.copy(obj.geometry.boundingBox).applyMatrix4(tmpRelMat);
          tmpLocalBox.union(tmpMeshBox);
        });
        cachedUnscaledY = !tmpLocalBox.isEmpty()
          ? Math.max(0.8, tmpLocalBox.max.y)
          : Math.max(0.8, Number(vehGroup.userData?.topY || ent?.topY || 2.8));
        vehicleRoofLocalYCache.set(vehGroup, cachedUnscaledY);
      }
      const scaleY = Number(vehGroup.scale?.y) > 0.01 ? Number(vehGroup.scale.y) : 1;
      return cachedUnscaledY * scaleY;
    }
    return Math.max(0.8, Number(vehGroup?.userData?.topY || ent?.topY || 2.8));
  }

  function computeVehicleHeadingFpYaw(vehYaw) {
    // Vehicle faces +Z: fwd = (+sin(vehYaw), +cos(vehYaw)).
    // fpCamera faces -Z: fwd = (-sin(camYaw), -cos(camYaw)) => camYaw = wrapPi(vehYaw + Math.PI).
    return wrapPi((Number(vehYaw) || 0) + Math.PI);
  }

  function computePassengerPose(rideId, seat = 0) {
    const resolved = parseRideId(rideId);
    if (!resolved) return null;
    const { canonicalRideId, isSecondary, ent, veh } = resolved;

    const vx = Number(veh.x) || 0;
    const vy = Number(veh.y ?? 0.092);
    const vz = Number(veh.z) || 0;
    const vYaw = Number(veh.yaw) || 0;
    const moveFactor = Number(veh.moveFactor ?? 0);
    const roofLocalY = getVehicleRoofLocalY(veh, ent);

    const fwdX = Math.sin(vYaw);
    const fwdZ = Math.cos(vYaw);
    const rightX = -Math.cos(vYaw);
    const rightZ = Math.sin(vYaw);

    // Open-air roof-deck seating: unobstructed panoramic view in FP & 100% visible in 3P multiplayer
    const sIdx = Math.max(0, Math.min(3, seat | 0));
    const fwdOff = 0.32 - (sIdx % 2) * 0.72;
    const rightOff = sIdx === 0 ? 0 : sIdx === 1 ? -0.26 : sIdx === 2 ? 0.28 : 0.26;

    const px = vx + fwdX * fwdOff + rightX * rightOff;
    const pz = vz + fwdZ * fwdOff + rightZ * rightOff;
    const bob =
      moveFactor > 0.02 ? Math.sin(lastSimTime * 13.0 + sIdx * 0.9) * 0.008 * moveFactor : 0;
    const seatY = vy + roofLocalY + 0.02 + bob;
    const eyeY = seatY + 1.12;
    const headingYaw = computeVehicleHeadingFpYaw(vYaw);
    const vehicleName = resolveVehicleDisplayName(ent, isSecondary);

    const isActiveLocalRide = Boolean(ridingState && ridingState.rideId === canonicalRideId);
    const deltaYaw = isActiveLocalRide ? ridingState.deltaYaw : 0;

    return {
      x: px,
      y: seatY,
      z: pz,
      eyeX: px,
      eyeY,
      eyeZ: pz,
      yaw: headingYaw,
      deltaYaw,
      vehicleName,
    };
  }

  function boardVehicle(rideId, preferredSeat = 0) {
    const resolved = parseRideId(rideId);
    if (!resolved) {
      return { ok: false, rideId: null, seat: 0, vehicleName: null, pose: null };
    }
    if (activeRoom) {
      exitBuilding();
    }
    seatState = null;

    const seat = Math.max(0, Math.min(3, preferredSeat | 0));
    const vehicleName = resolveVehicleDisplayName(resolved.ent, resolved.isSecondary);
    const initialHeading = computeVehicleHeadingFpYaw(resolved.veh.yaw || 0);

    ridingState = {
      rideId: resolved.canonicalRideId,
      seat,
      vehicleName,
      prevHeadingYaw: initialHeading,
      deltaYaw: 0,
    };

    const pose = computePassengerPose(resolved.canonicalRideId, seat);
    playChime([392, 523.25, 659.25], 0.055, 0.14, "triangle", 0.05);
    return {
      ok: true,
      rideId: resolved.canonicalRideId,
      seat,
      vehicleName,
      pose,
    };
  }

  function hopOffVehicle() {
    if (!ridingState) {
      return { ok: false, exteriorPose: null };
    }
    const prevRide = ridingState;
    ridingState = null;
    seatState = null;

    const resolved = parseRideId(prevRide.rideId);
    if (!resolved) {
      const [fx, fz] = safeResolveExterior(0, 8);
      return { ok: true, exteriorPose: { x: fx, y: 0, z: fz, yaw: 0, pitch: -0.02 } };
    }

    const { veh } = resolved;
    const vx = Number(veh.x) || 0;
    const vz = Number(veh.z) || 0;
    const vYaw = Number(veh.yaw) || 0;
    const rightX = -Math.cos(vYaw);
    const rightZ = Math.sin(vYaw);
    const fwdX = Math.sin(vYaw);
    const fwdZ = Math.cos(vYaw);

    // Test curb-side and opposite-side candidates; pick cleanest sidewalk spot clear of traffic & obstacles
    let bestSpot = null;
    let bestPenalty = Infinity;
    for (const side of [1, -1]) {
      for (const dist of [2.85, 3.45, 4.1]) {
        const rawX = vx + rightX * side * dist + fwdX * 0.35;
        const rawZ = vz + rightZ * side * dist + fwdZ * 0.35;
        const [rx, rz] = safeResolveExterior(rawX, rawZ);
        const pushPenalty = Math.hypot(rx - rawX, rz - rawZ);
        const vehClear = Math.hypot(rx - vx, rz - vz);
        const penalty = pushPenalty * 3.0 + (vehClear < 2.4 ? (2.4 - vehClear) * 8.0 : 0) + (side < 0 ? 0.35 : 0);
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          bestSpot = [rx, rz];
        }
      }
    }

    const [outX, outZ] = bestSpot || safeResolveExterior(vx + rightX * 3.0, vz + rightZ * 3.0);
    const lookYaw = computeVehicleHeadingFpYaw(vYaw);
    playChime([587.33, 440], 0.055, 0.13, "triangle", 0.045);

    return {
      ok: true,
      exteriorPose: {
        x: outX,
        y: 0,
        z: outZ,
        yaw: lookYaw,
        pitch: -0.02,
      },
    };
  }

  function isRiding() {
    if (ridingState && !parseRideId(ridingState.rideId)) {
      ridingState = null;
      return false;
    }
    return Boolean(ridingState);
  }

  function getRidingState() {
    if (!isRiding()) return null;
    return {
      rideId: ridingState.rideId,
      seat: ridingState.seat,
      vehicleName: ridingState.vehicleName,
    };
  }

  // ── C. Seating State (Interior Chairs + Outdoor Benches) API ───────────────
  function sitAt(seatTarget) {
    if (!seatTarget || !Number.isFinite(seatTarget.x) || !Number.isFinite(seatTarget.z)) {
      return { ok: false, pose: null };
    }
    ridingState = null;
    const isInterior = Boolean(seatTarget.isInterior);
    const sx = Number(seatTarget.x);
    const sy = Number(seatTarget.y) || 0;
    const sz = Number(seatTarget.z);
    const eyeY = Number.isFinite(seatTarget.eyeY) ? Number(seatTarget.eyeY) : sy + SEAT_EYE_OFFSET;
    const yaw = Number(seatTarget.yaw) || 0;

    seatState = {
      id: seatTarget.id || "seat",
      x: sx,
      y: sy,
      z: sz,
      eyeY,
      yaw,
      isInterior,
      standX: Number.isFinite(seatTarget.standX) ? seatTarget.standX : sx - Math.sin(yaw) * 0.85,
      standZ: Number.isFinite(seatTarget.standZ) ? seatTarget.standZ : sz - Math.cos(yaw) * 0.85,
    };
    playChime([440, 523.25], 0.05, 0.11, "sine", 0.04);
    return { ok: true, pose: getSeatPose() };
  }

  function standUp() {
    if (!seatState) return { ok: false, pose: null };
    const prev = seatState;
    seatState = null;

    let sx = prev.standX;
    let sz = prev.standZ;
    if (prev.isInterior) {
      [sx, sz] = resolveInteriorWalkPosition(sx, sz);
    } else {
      [sx, sz] = safeResolveExterior(sx, sz);
    }
    return {
      ok: true,
      pose: {
        x: sx,
        y: 0,
        z: sz,
        eyeY: FP_DEFAULT_EYE_HEIGHT,
        yaw: prev.yaw,
        isInterior: prev.isInterior,
      },
    };
  }

  function isSitting() {
    return Boolean(seatState);
  }

  function getSeatPose() {
    if (!seatState) return null;
    const { x, y, z, eyeY, yaw, isInterior } = seatState;
    return {
      x,
      y,
      z,
      eyeY,
      yaw,
      isInterior,
      worldX: isInterior ? INTERIOR_ORIGIN.x + x : x,
      worldY: isInterior ? INTERIOR_ORIGIN.y + y : y,
      worldZ: isInterior ? INTERIOR_ORIGIN.z + z : z,
      worldEyeY: isInterior ? INTERIOR_ORIGIN.y + eyeY : eyeY,
    };
  }

  function handleMovementWake(moveInputMag = 0, isJumping = false) {
    if (seatState && (Math.abs(moveInputMag) > 0.08 || isJumping)) {
      return standUp();
    }
    return null;
  }

  // ── Outdoor Prop Seat & Interactive Contraption Helpers ────────────────────
  function buildOutdoorPropSeatTarget(prop) {
    const px = Number(prop.x) || 0;
    const pz = Number(prop.z) || 0;
    const pyaw = Number(prop.yaw) || 0;
    // In villagers.js, both `bench` and `bus_stop` have backrests on -Z and face local +Z
    const frontX = Math.sin(pyaw);
    const frontZ = Math.cos(pyaw);
    const seatForward = prop.kind === "bus_stop" ? 0.06 : 0.1;
    const sx = px + frontX * seatForward;
    const sz = pz + frontZ * seatForward;
    const seatYaw = wrapPi(pyaw + Math.PI);
    const [standX, standZ] = safeResolveExterior(px + frontX * 1.05, pz + frontZ * 1.05);
    return {
      id: prop.id || `prop-${prop.kind}`,
      x: sx,
      y: 0.16,
      z: sz,
      eyeY: 0.16 + SEAT_EYE_OFFSET,
      yaw: seatYaw,
      isInterior: false,
      standX,
      standZ,
    };
  }

  function triggerOutdoorInteractiveEntity(ent, wx, wy, wz, yaw, pitch) {
    if (!ent?.interactive?.trigger) return null;
    // 1. Try precision crosshair raycast against `ent.interactive.hitMeshes` first
    if (ent.interactive.hitMeshes?.length) {
      const cp = Math.cos(pitch);
      tmpRayOrigin.set(wx, wy, wz);
      tmpRayDir.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize();
      interactiveRaycaster.set(tmpRayOrigin, tmpRayDir);
      interactiveRaycaster.far = 9.0;
      const hits = interactiveRaycaster.intersectObjects(ent.interactive.hitMeshes, false);
      if (hits.length > 0 && hits[0].object?.userData?.interactiveAction) {
        const res = ent.interactive.trigger(hits[0].object.userData.interactiveAction);
        if (res !== undefined) return res;
      }
    }

    // 2. Smart walk-up fallback per mini-game / contraption kind
    const kind = ent.interactive.kind;
    if (kind === "tic_tac_toe") {
      for (const cell of [4, 0, 2, 6, 8, 1, 3, 5, 7]) {
        const msg = ent.interactive.trigger({ cell });
        if (msg !== null) return msg;
      }
      return null;
    }
    if (kind === "connect_four") {
      for (const col of [3, 2, 4, 1, 5, 0, 6]) {
        const msg = ent.interactive.trigger({ col });
        if (msg !== null) return msg;
      }
      return null;
    }
    if (kind === "whack_a_mole") {
      return ent.interactive.trigger({ hole: Math.floor(Math.random() * 9) });
    }
    if (kind === "floor_piano") {
      return ent.interactive.trigger({ riff: true });
    }
    if (kind === "simon_synth") {
      return ent.interactive.trigger({ pad: 0 });
    }
    if (kind === "lights_out") {
      return ent.interactive.trigger({ rune: 4 });
    }
    if (kind === "basketball_hoop") {
      return ent.interactive.trigger({ spot: 1 });
    }
    return ent.interactive.trigger({});
  }

  // ── D. Contextual Interaction Target Scanner ───────────────────────────────
  function findBestInteractionTarget({
    fpActive = false,
    localX,
    localY,
    localZ,
    worldX = 0,
    worldY = FP_DEFAULT_EYE_HEIGHT,
    worldZ = 0,
    yaw = 0,
    pitch = 0,
  } = {}) {
    // Priority 1: Currently riding a vehicle
    if (isRiding()) {
      const activeRideId = ridingState.rideId;
      return {
        kind: "hop_off",
        id: activeRideId,
        label: "Hop off",
        keyHint: "E",
        execute: () => hopOffVehicle(),
      };
    }

    // Priority 2: Currently sitting
    if (isSitting()) {
      return {
        kind: "stand_up",
        id: seatState.id || "seat",
        label: "Stand up",
        keyHint: "E",
        execute: () => standUp(),
      };
    }

    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const cosP = Math.cos(pitch);
    const look3X = fwdX * cosP;
    const look3Y = Math.sin(pitch);
    const look3Z = fwdZ * cosP;

    // Priority 3: Inside a procedural building interior
    if (activeRoom) {
      const lx = Number.isFinite(localX) ? localX : worldX - INTERIOR_ORIGIN.x;
      const ly = Number.isFinite(localY) ? localY : worldY - INTERIOR_ORIGIN.y;
      const lz = Number.isFinite(localZ) ? localZ : worldZ - INTERIOR_ORIGIN.z;
      const eyeLocalY = ly > 0.4 ? ly : FP_DEFAULT_EYE_HEIGHT;

      let best = null;
      let bestScore = Infinity;

      // Check Front Exit Door at (0, 1.35, 5.05), welcome mat centered around z = 4.65
      {
        const dx = 0 - lx;
        const dz = 5.05 - lz;
        const d2 = Math.hypot(dx, dz);
        const dot2 = d2 > 1e-4 ? (dx * fwdX + dz * fwdZ) / d2 : 1;
        if ((d2 < 1.55 && dot2 > -0.25) || (d2 < 3.0 && dot2 > 0.45) || d2 < 0.95) {
          const score = d2 * (1.25 - 0.5 * Math.max(0, dot2));
          bestScore = score;
          best = {
            kind: "exit_building",
            id: activeRoom.roomId,
            label: "Exit",
            keyHint: "E",
            execute: () => exitBuilding(),
          };
        }
      }

      // Check interactive room hotspots (seats + animated theme props + lamp toggle)
      for (const hs of activeRoom.hotspots) {
        const dx = hs.x - lx;
        const dy = (hs.y ?? 1.0) - eyeLocalY;
        const dz = hs.z - lz;
        const d2 = Math.hypot(dx, dz);
        if (d2 > 2.75) continue;
        const dot2 = d2 > 1e-4 ? (dx * fwdX + dz * fwdZ) / d2 : 1;
        const d3 = Math.hypot(dx, dy, dz) || 1;
        const dot3 = (dx * look3X + dy * look3Y + dz * look3Z) / d3;

        if (dot2 < 0.28 && !(d2 < 1.15 && dot2 > -0.1)) continue;
        const score = d2 * (1.35 - 0.58 * Math.max(0, dot3));
        if (score < bestScore) {
          bestScore = score;
          best = {
            kind: hs.kind,
            id: `${activeRoom.roomId}:${hs.id}`,
            label: hs.label,
            keyHint: "E",
            execute: () => {
              if (hs.kind === "sit" && hs.seatTarget) {
                return sitAt(hs.seatTarget);
              }
              hs.onTrigger?.();
              return { ok: true, id: hs.id, label: hs.label };
            },
          };
        }
      }

      return best;
    }

    // Priority 4: Outdoors in 1st-person Walk mode
    if (!fpActive) return null;

    const wx = Number(worldX) || 0;
    const wy = Number(worldY) || FP_DEFAULT_EYE_HEIGHT;
    const wz = Number(worldZ) || 0;

    // 4a. Nearby boardable `vehicle_route` vehicles (both primary & `#sec` split transit!)
    let bestVehicle = null;
    let bestVehScore = Infinity;
    for (const ent of iterEntities()) {
      if (ent?.data?.behavior?.type !== "vehicle_route") continue;
      const candidates = [{ rideId: ent.id, veh: ent, isSec: false }];
      if (ent.secondaryVehicle) {
        candidates.push({
          rideId: `${ent.id}#sec`,
          veh: ent.secondaryVehicle,
          isSec: true,
        });
      }

      for (const c of candidates) {
        const dx = c.veh.x - wx;
        const dz = c.veh.z - wz;
        const d = Math.hypot(dx, dz);
        if (d >= 7.2) continue;
        const dot = d > 1e-4 ? (dx * fwdX + dz * fwdZ) / d : 1;
        if (dot < 0.12 && d > 3.7) continue;

        const stoppedBoost = c.veh.dwellingStop || (c.veh.moveFactor ?? 1) < 0.25 ? 0.72 : 1.0;
        const lookBoost = 1.25 - 0.52 * Math.max(0, dot);
        const score = d * stoppedBoost * lookBoost;
        if (score < bestVehScore) {
          bestVehScore = score;
          const vName = resolveVehicleDisplayName(ent, c.isSec);
          bestVehicle = {
            kind: "board_vehicle",
            id: c.rideId,
            label: `Board ${vName}`,
            keyHint: "E",
            execute: () => boardVehicle(c.rideId, 0),
          };
        }
      }
    }
    if (bestVehicle) return bestVehicle;

    // 4b. Nearby enterable building (doorway proximity `< 3.6m` OR facade look-cone `< footprintRadius + 3.4m`)
    let bestBuilding = null;
    let bestBldScore = Infinity;
    for (const ent of iterEntities()) {
      if (!ent?.data || !canEnterCreation(ent.data)) continue;
      const trig = getBuildingDoorwayTrigger(ent);
      if (!trig) continue;

      const doorDx = trig.doorX - wx;
      const doorDz = trig.doorZ - wz;
      const doorDist = Math.hypot(doorDx, doorDz);
      const centerDx = ent.x - wx;
      const centerDz = ent.z - wz;
      const centerDist = Math.hypot(centerDx, centerDz);
      const maxConeDist = (trig.footprintRadius || 3.4) + 3.4;

      if (doorDist >= trig.triggerRadius && centerDist >= maxConeDist) continue;

      const dotDoor = doorDist > 1e-4 ? (doorDx * fwdX + doorDz * fwdZ) / doorDist : 1;
      const dotCenter = centerDist > 1e-4 ? (centerDx * fwdX + centerDz * fwdZ) / centerDist : 1;

      const nearDoor =
        doorDist < trig.triggerRadius && (dotDoor > -0.15 || dotCenter > 0.05 || doorDist < 2.15);
      const inFacadeCone = centerDist < maxConeDist && dotCenter > 0.36;
      if (!nearDoor && !inFacadeCone) continue;

      const effDist = nearDoor ? doorDist * 0.85 : centerDist - trig.footprintRadius * 0.65;
      const score = Math.max(0.2, effDist) * (1.28 - 0.45 * Math.max(dotDoor, dotCenter, 0));
      if (score < bestBldScore) {
        bestBldScore = score;
        const shortBld = shortenActionNoun(ent.data.name, "Building", 2);
        bestBuilding = {
          kind: "enter_building",
          id: ent.id,
          label: `Enter ${shortBld}`,
          keyHint: "E",
          execute: () => enterBuilding(ent.id, { x: wx, z: wz, yaw, pitch }),
        };
      }
    }
    if (bestBuilding) return bestBuilding;

    // 4c. Nearby interactive creation (`ent.interactive` within `< 5.0m` in view)
    let bestInteractive = null;
    let bestIntScore = Infinity;
    for (const ent of iterEntities()) {
      if (!ent?.interactive) continue;
      const dx = ent.x - wx;
      const dz = ent.z - wz;
      const rawDist = Math.hypot(dx, dz);
      const edgeAllowance = Math.max(0, Math.min(2.2, (ent.footprintRadius || 1.8) - 1.5));
      const effDist = Math.max(0, rawDist - edgeAllowance);
      if (effDist >= 5.0) continue;

      const dot = rawDist > 1e-4 ? (dx * fwdX + dz * fwdZ) / rawDist : 1;
      if (dot < 0.28 && rawDist > 2.2) continue;

      const score = effDist * (1.3 - 0.5 * Math.max(0, dot));
      if (score < bestIntScore) {
        bestIntScore = score;
        const verb = MINI_GAME_PLAY_KINDS.has(ent.interactive.kind) ? "Play" : "Trigger";
        const shortTitle = shortenActionNoun(ent.data?.name, "Contraption", 2);
        bestInteractive = {
          kind: "interactive_creation",
          id: ent.id,
          label: `${verb} ${shortTitle}`,
          keyHint: "E",
          execute: () => ({
            ok: true,
            creation: ent.data,
            message: triggerOutdoorInteractiveEntity(ent, wx, wy, wz, yaw, pitch),
          }),
        };
      }
    }
    if (bestInteractive) return bestInteractive;

    // 4d. Nearby outdoor bench or bus-stop bench (`world.props` within `< 2.6m` in view)
    const props = getWorld?.()?.props || [];
    let bestBench = null;
    let bestBenchScore = Infinity;
    for (const pr of props) {
      if (pr.kind !== "bench" && pr.kind !== "bus_stop") continue;
      const dx = pr.x - wx;
      const dz = pr.z - wz;
      const d = Math.hypot(dx, dz);
      if (d >= 2.6) continue;
      const dot = d > 1e-4 ? (dx * fwdX + dz * fwdZ) / d : 1;
      if (dot < 0.22 && !(d < 1.35 && dot > -0.15)) continue;

      const score = d * (1.3 - 0.45 * Math.max(0, dot));
      if (score < bestBenchScore) {
        bestBenchScore = score;
        bestBench = {
          kind: "sit",
          id: pr.id || `prop-${pr.kind}`,
          label: "Sit",
          keyHint: "E",
          execute: () => sitAt(buildOutdoorPropSeatTarget(pr)),
        };
      }
    }
    return bestBench;
  }

  // ── Simulation Step & Cleanup ──────────────────────────────────────────────
  function step(dt, t, inputState = null) {
    lastSimTime = Number(t) || 0;

    // Auto-stand if caller passes WASD/joystick movement beyond deadzone or jump
    if (seatState && inputState) {
      const moveMag = Math.hypot(inputState.inFwd || 0, inputState.inRight || 0);
      if (moveMag > 0.08 || Boolean(inputState.jumping)) {
        standUp();
      }
    }

    // Track vehicle `deltaYaw` smoothly while riding
    if (ridingState) {
      const resolved = parseRideId(ridingState.rideId);
      if (!resolved) {
        ridingState = null;
      } else {
        const curHeading = computeVehicleHeadingFpYaw(resolved.veh.yaw || 0);
        ridingState.deltaYaw = wrapPi(curHeading - ridingState.prevHeadingYaw);
        ridingState.prevHeadingYaw = curHeading;
      }
    }

    // Animate active interior room props only when inside
    if (activeRoom) {
      activeRoom.step(dt, lastSimTime);
    } else {
      doorSyncCooldown -= dt;
      if (doorSyncCooldown <= 0) {
        doorSyncCooldown = 0.5;
        syncDoorstepBeacons();
      }
    }
  }

  function dispose() {
    ridingState = null;
    seatState = null;
    activeRoom = null;
    activeCreation = null;
    for (const room of roomCache.values()) {
      interiorGroup.remove(room.group);
      room.dispose();
    }
    roomCache.clear();
    scene?.remove?.(interiorGroup);
    scene?.remove?.(doorwayBeaconsGroup);
    doorMatGeo.dispose();
  }

  return {
    // A. Building Interiors
    enterBuilding,
    exitBuilding,
    isInside,
    getCurrentRoomId,
    getCurrentCreation,
    resolveInteriorWalkPosition,
    getInteriorFloorHeight,

    // B. Rideable Transit & Vehicles
    boardVehicle,
    hopOffVehicle,
    isRiding,
    getRidingState,
    computePassengerPose,

    // C. Seating
    sitAt,
    standUp,
    isSitting,
    getSeatPose,
    handleMovementWake,

    // D. Contextual Interaction Scanner + Lifecycle
    findBestInteractionTarget,
    step,
    dispose,
  };
}

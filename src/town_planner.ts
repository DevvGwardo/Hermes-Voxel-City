import type {
  CreationCategory,
  PathKind,
  RouteStop,
  ScaleClass,
  TrafficIncidentRecord,
  WorldCreation,
  WorldPath,
  WorldProp,
  WorldStateSnapshot,
} from "./types";
import { distPointToPolyline2D, OUTER_RING_ROAD_POINTS, sampleCatmullRom2D } from "./voxel_audit";
import { detectBlueprintFrontAngle, getCreationFootprintRadius } from "./voxel_dsl";

export function ensureOuterRingRoad(paths: WorldPath[]): boolean {
  if (paths.some((p) => p.id === "path-outer-ring")) return false;
  const insertIdx = paths.findIndex((p) => p.id === "path-main-loop");
  const outerRing: WorldPath = {
    id: "path-outer-ring",
    kind: "road",
    points: OUTER_RING_ROAD_POINTS.map(([x, z]) => [x, z] as [number, number]),
    closed: true,
  };
  if (insertIdx >= 0) {
    paths.splice(insertIdx + 1, 0, outerRing);
  } else {
    paths.unshift(outerRing);
  }
  return true;
}

function rotateClosedWaypointsNear(
  pts: [number, number][],
  refX: number,
  refZ: number,
): [number, number][] {
  if (pts.length < 3) return pts;
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - refX, pts[i][1] - refZ);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx === 0) return pts.map(([x, z]) => [x, z]);
  return pts.map((_, i) => {
    const p = pts[(bestIdx + i) % pts.length];
    return [p[0], p[1]];
  });
}

export const ISLAND_HALF_EXTENT = 163.5;
export const ISLAND_SUPERELLIPSE_EXP = 3.1;

export function getIslandCoastWarp(theta: number): number {
  return (
    9.2 * Math.cos(2 * theta + 1.55) +
    7.8 * Math.sin(3 * theta + 0.75) +
    5.6 * Math.cos(4 * theta + 3.08) +
    4.1 * Math.sin(5 * theta - 0.85) +
    2.6 * Math.cos(7 * theta + 0.4)
  );
}

/**
 * Signed distance (in meters) inward from the flat buildable GeminIsland plateau rim.
 * `> 0` is on the flat buildable island plateau; `0` is the coastal bluff/beach crest;
 * `< 0` slopes down through sandy beach / rocky cliffs into the ocean.
 */
export function getIslandInlandMargin(x: number, z: number): number {
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

export function clampPointToIsland(x: number, z: number, minInlandMargin = 3.0): [number, number] {
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

export type TownPlanningRole =
  | "mobile"
  | "natural_scenic"
  | "remote_industrial"
  | "downtown_civic"
  | "neighborhood_cottage";

const NATURAL_SCENIC_RE =
  /\b(waterfall|cascade|cataract|cliff|gorge|canyon|volcano|stratovolcano|caldera|mountain|peak|glacier|island|atoll|coast|coastline|vista|beach|shore|cove|reef|lagoon|oasis|forest|woods|grove|world\s*tree|cave|cavern|geyser|hot\s*spring|hammock|lounger)\b/i;

const REMOTE_INDUSTRIAL_RE =
  /\b(quarry|mine|mining|coal\s*pit|ore\s*pit|excavat|launchpad|launch\s*pad|spaceport|rocket\s*pad|oil\s*rig|refinery|smelter|power\s*plant|reactor|wind\s*farm|solar\s*farm)\b/i;

const GEOLOGICAL_EXCAVATION_RE =
  /\b(quarry|mine|mining|pit|crater|excavat|oil\s*rig)\b/i;

const DOWNTOWN_CIVIC_RE =
  /\b(tower|skyscraper|high-?rise|office|datacentre|datacenter|server|cloud|parliament|capitol|city\s*hall|courthouse|firehouse|fire\s*station|police|hospital|station|clocktower|museum|library|archive|wikipedia|university|arena|stadium|amphitheater|amphitheatre|colosseum|cathedral|palace|pavilion|retail|mall|store|bank|hotel|ihop|ziggurat|diner|cinema|theater|theatre)\b/i;

/**
 * Classifies any creation into an intelligent SimCity town-planning role so the orchestrator
 * knows whether it belongs on an orthogonal downtown block, a neighborhood cottage lane,
 * a distant industrial highway, or a natural perimeter vista.
 */
export function classifyTownPlanningRole(
  text: string,
  category: CreationCategory,
  scaleClass: ScaleClass,
): TownPlanningRole {
  if (
    category === "vehicle" ||
    category === "aircraft" ||
    category === "watercraft" ||
    category === "creature"
  ) {
    return "mobile";
  }
  if (NATURAL_SCENIC_RE.test(text)) {
    return "natural_scenic";
  }
  if (REMOTE_INDUSTRIAL_RE.test(text)) {
    return "remote_industrial";
  }
  if (DOWNTOWN_CIVIC_RE.test(text) || scaleClass === "colossal") {
    return "downtown_civic";
  }
  return "neighborhood_cottage";
}

/**
 * Determines whether a stationary creation should rotate to face its fronting street.
 * Architectural buildings, shops, cottages, courts, and towers face the street;
 * quarries, mines, waterfalls, cliffs, volcanoes, islands, and beach hammocks do NOT.
 */
export function shouldCreationFaceRoad(creation: WorldCreation): boolean {
  if (creation.isSeed || creation.isCompanion) return false;
  if (creation.behavior && creation.behavior.type !== "landmark") return false;
  if (
    creation.category === "vehicle" ||
    creation.category === "aircraft" ||
    creation.category === "watercraft" ||
    creation.category === "creature"
  ) {
    return false;
  }
  const text = `${creation.name} ${creation.creatorPrompt ?? ""} ${creation.description ?? ""}`;
  if (NATURAL_SCENIC_RE.test(text)) return false;
  if (GEOLOGICAL_EXCAVATION_RE.test(text)) return false;
  return true;
}

function wrapAnglePi(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Snaps a world-space facing angle (where `0` = `+Z` South, `Math.PI/2` = `+X` East,
 * `Math.PI` = `-Z` North, `-Math.PI/2` = `-X` West) to crisp SimCity urban angles:
 * - Cardinal `90°` increments (`0`, `±π/2`, `π`) whenever within `24°` of a cardinal axis
 * - Clean `45°` diagonal (`±π/4`, `±3π/4`) when fronting a diagonal boulevard!
 */
export function snapAngleToSimCityGrid(rawWorldYaw: number): number {
  const wrapped = wrapAnglePi(rawWorldYaw);
  const nearestCardinal = Math.round(wrapped / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(wrapAnglePi(wrapped - nearestCardinal)) <= 0.42) {
    return Number(wrapAnglePi(nearestCardinal).toFixed(4));
  }
  const nearestOctant = Math.round(wrapped / (Math.PI / 4)) * (Math.PI / 4);
  return Number(wrapAnglePi(nearestOctant).toFixed(4));
}

/**
 * Computes a clean, uniform SimCity street-facing `yaw` for architectural buildings,
 * or returns `null` for quarries, waterfalls, cliffs, islands, and mobile creations.
 */
export function computeIntelligentBuildingYaw(
  creation: WorldCreation,
  paths: WorldPath[],
): number | null {
  if (!shouldCreationFaceRoad(creation)) return null;

  // Prefer primary streets (`road`, `cottage_road`, `cobblestone`) within 26m over tiny footpaths
  const streetKinds = new Set(["road", "cottage_road", "cobblestone"]);
  let bestStreetDist = Infinity;
  let bestStreetTarget: [number, number] | null = null;
  let bestAnyDist = Infinity;
  let bestAnyTarget: [number, number] | null = null;

  for (const p of paths) {
    if (!p.points || p.points.length < 2) continue;
    // Ignore creation's own tiny doorway spur if a real avenue/lane is nearby so buildings align to the street block, not a diagonal stub
    const isOwnSpur = p.id === `spur-${creation.id}` || p.id === `initpath-${creation.id}`;
    const curve = sampleCatmullRom2D(p.points, Boolean(p.closed), 1.0);
    const hit = distPointToPolyline2D(creation.x, creation.z, curve);

    if (!isOwnSpur && streetKinds.has(p.kind) && hit.dist < bestStreetDist) {
      bestStreetDist = hit.dist;
      bestStreetTarget = [hit.closestX, hit.closestZ];
    }
    if (!isOwnSpur && hit.dist < bestAnyDist) {
      bestAnyDist = hit.dist;
      bestAnyTarget = [hit.closestX, hit.closestZ];
    }
  }

  const chosenTarget =
    bestStreetTarget && bestStreetDist <= 28.0 ? bestStreetTarget : bestAnyTarget;
  if (!chosenTarget) return null;

  const dx = chosenTarget[0] - creation.x;
  const dz = chosenTarget[1] - creation.z;
  if (Math.hypot(dx, dz) < 0.4) return null;

  const worldDirToStreet = Math.atan2(dx, dz);
  const snappedStreetDir = snapAngleToSimCityGrid(worldDirToStreet);
  const localFront = detectBlueprintFrontAngle(creation.blueprint);
  return Number(wrapAnglePi(snappedStreetDir - localFront).toFixed(3));
}

/**
 * Chooses a SimCity-aligned plot for newly placed creations when no manual spot is forced
 * (or nudges cleanly around an occupied spot).
 */
export function chooseSimCityPlot(opts: {
  reqX: number | null | undefined;
  reqZ: number | null | undefined;
  category: CreationCategory;
  scaleClass: ScaleClass;
  newRadius: number;
  contextText: string;
  world: Omit<WorldStateSnapshot, "myCreationId">;
  isSpotClear: (x: number, z: number) => boolean;
}): [number, number] {
  const { reqX, reqZ, category, scaleClass, newRadius, contextText, world, isSpotClear } = opts;
  const snapGrid = (v: number) => Math.round(v / 2) * 2;

  if (
    typeof reqX === "number" &&
    Number.isFinite(reqX) &&
    typeof reqZ === "number" &&
    Number.isFinite(reqZ)
  ) {
    const [cx, cz] = clampPointToIsland(reqX, reqZ, newRadius + 2.8);
    if (isSpotClear(cx, cz)) {
      return [Number(cx.toFixed(1)), Number(cz.toFixed(1))];
    }
    // Fine-grained spiral search around user-requested spot so inner-park & next-door infill stays right where requested
    for (let rad = 1.6; rad <= 22; rad += 1.6) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const tx = Number((cx + Math.cos(ang) * rad).toFixed(1));
        const tz = Number((cz + Math.sin(ang) * rad).toFixed(1));
        if (isSpotClear(tx, tz)) {
          return [tx, tz];
        }
      }
    }
    for (let step = 4; step <= 88; step += 4) {
      const offsets: [number, number][] = [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
        [step, step],
        [-step, step],
        [step, -step],
        [-step, -step],
      ];
      for (const [ox, oz] of offsets) {
        const tx = snapGrid(cx + ox);
        const tz = snapGrid(cz + oz);
        if (isSpotClear(tx, tz)) {
          return [tx, tz];
        }
      }
    }
  }

  const role = classifyTownPlanningRole(contextText, category, scaleClass);

  // 1. Remote industrial (quarries, mines, launchpads) -> outer frontier zones (r = 96..134m)
  if (role === "remote_industrial") {
    const frontierCandidates: [number, number][] = [
      [126, -116],
      [-18, -126],
      [118, -82],
      [-96, -104],
      [112, 88],
      [-108, 86],
    ];
    for (const [fx, fz] of frontierCandidates) {
      if (isSpotClear(fx, fz)) return [fx, fz];
    }
  }

  // 2. Natural scenic (waterfalls, cliffs, volcanoes, islands, beaches) -> scenic perimeter rim
  if (role === "natural_scenic") {
    const scenicCandidates: [number, number][] = [
      [-16, 88],
      [82, 34],
      [58, 26],
      [-86, 68],
      [26, 92],
      [92, -38],
      [-92, -48],
    ];
    for (const [sx, sz] of scenicCandidates) {
      if (isSpotClear(sx, sz)) return [sx, sz];
    }
  }

  // 3. City & village buildings -> orthogonal street-block frontage along roads & cottage lanes
  if (role === "downtown_civic" || role === "neighborhood_cottage") {
    const preferredKind =
      role === "downtown_civic"
        ? new Set(["road", "cobblestone"])
        : new Set(["cottage_road", "cobblestone", "road"]);
    const streets = world.paths.filter(
      (p) => preferredKind.has(p.kind) && p.points && p.points.length >= 2,
    );
    for (const st of streets) {
      const curve = sampleCatmullRom2D(st.points, Boolean(st.closed), 6.0);
      const halfW = st.kind === "road" ? 3.2 : 2.0;
      const setback = Math.ceil((halfW + newRadius + 2.8) / 2) * 2;
      for (let i = 1; i < curve.length - 1; i++) {
        const pt = curve[i];
        const prev = curve[i - 1];
        const next = curve[i + 1];
        const dx = next[0] - prev[0];
        const dz = next[1] - prev[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.1) continue;
        // Snap perpendicular to exact SimCity grid normal
        const rawPerp = Math.atan2(-dz / len, dx / len);
        const gridNorm = snapAngleToSimCityGrid(rawPerp);
        const nx = Math.sin(gridNorm);
        const nz = Math.cos(gridNorm);
        for (const side of [1, -1]) {
          const tx = snapGrid(pt[0] + nx * setback * side);
          const tz = snapGrid(pt[1] + nz * setback * side);
          // Never place inside Central Park [-22..22, -18..18]
          if (Math.abs(tx) < 23 && Math.abs(tz) < 19) continue;
          const r = Math.hypot(tx, tz);
          if (r < 26 || r > 116) continue;
          if (isSpotClear(tx, tz)) {
            return [tx, tz];
          }
        }
      }
    }
  }

  // 4. Structured orthogonal ring fallback on 8m grid steps
  const minRing = newRadius >= 8.5 ? 48 : 32;
  for (let ring = minRing; ring <= 128; ring += 12) {
    for (let u = -ring; u <= ring; u += 8) {
      const candidates: [number, number][] = [
        [u, -ring],
        [u, ring],
        [-ring, u],
        [ring, u],
      ];
      for (const [tx, tz] of candidates) {
        if (isSpotClear(tx, tz)) return [tx, tz];
      }
    }
  }
  return [56, -48];
}

/**
 * Identity + purpose descriptions ("what it is, and what its role or intention is")
 * for all seed and established creations on GeminIsland — avoiding redundant visual
 * geometry/material inventories since viewers can already see the 3D model.
 */
export const FACTUAL_CREATION_DESCRIPTIONS: Record<string, { description: string; statusLine: string }> = {
  "seed-school-bus": {
    description: "Town school bus picking up and dropping off commuters around the central loop.",
    statusLine: "Town bus circling the central commuter loop",
  },
  "seed-windmill-bakery": {
    description: "Neighborhood windmill bakery grinding grain and baking fresh bread for the west village.",
    statusLine: "Neighborhood bakery grinding grain and baking bread",
  },
  "seed-clocktower-station": {
    description: "Central transit station and town clock where neighborhood bus and shuttle routes meet.",
    statusLine: "Central transit hub where town bus and shuttle lines meet",
  },
  "seed-matcha-bookshop": {
    description: "Corner bookshop and cafe where townsfolk stop to browse books over tea.",
    statusLine: "Corner bookshop and tea room for neighborhood readers",
  },
  "seed-meadow-pup": {
    description: "Town dog trotting around the central green to greet passersby.",
    statusLine: "Town dog trotting around the central green",
  },
  "seed-pond-duck": {
    description: "Resident mallard swimming laps around Clover Pond in the center of town.",
    statusLine: "Resident mallard swimming laps on Clover Pond",
  },
  "c-mvm7qli8-4h2k": {
    description: "Cloud computing facility running server workloads for the northern tech district.",
    statusLine: "Cloud datacentre running regional compute workloads",
  },
  "c-mvmvo1vh-47fbad": {
    description: "Meadow dragon soaring overhead between the mountain waterfall and town landmarks.",
    statusLine: "Meadow dragon patrolling the skies above the island",
  },
  "c-mvn0lbb4-74136e": {
    description: "Northwest coastal waterfall cascading beside the ocean shore and feeding fresh mountain water into the island's streams.",
    statusLine: "Coastal waterfall cascading beside the northwest ocean shore",
  },
  "c-mvn8g9cn-a857de": {
    description: "Giant boot turned into a family home, inspired by the old woman who lived in a shoe.",
    statusLine: "Boot-shaped family home on the western lane",
  },
  "c-mvn9yxeh-1d5644": {
    description: "Downtown appliance showroom displaying kitchen machines and home goods.",
    statusLine: "Downtown kitchen appliance showroom",
  },
  "c-mvnbcub6-d06441": {
    description: "Roadside burrito shop serving Mexican food and spare parts to local robots.",
    statusLine: "Burrito cantina built for local robots",
  },
  "c-mvnbmbqg-48aa8f": {
    description: "Neighborhood court for pickup pickleball matches along the western cottage lane.",
    statusLine: "Community court for pickup pickleball games",
  },
  "c-mvnc3mga-c6ea36": {
    description: "Country pub on South Avenue serving cold drinks to locals and travelers.",
    statusLine: "Australian country pub on South Avenue",
  },
  "c-mvnc7tlr-6784e6": {
    description: "Open-pit mine in the northeast hills extracting rare-earth minerals for the city.",
    statusLine: "Rare-earth mineral quarry supplying the city",
  },
  "c-mvnd5i04-14bfd5": {
    description: "Enclosed neighborhood court built for doubles padel matches.",
    statusLine: "Neighborhood court for doubles padel matches",
  },
  "c-mvne3zub-216636": {
    description: "Public skateboard halfpipe on the central green for practicing vert tricks.",
    statusLine: "Public skate ramp on the central green",
  },
  "c-mvne5cm4-375d1d": {
    description: "Private country estate overlooking the western neighborhood lanes.",
    statusLine: "Private residence in the western district",
  },
  "c-mvnengyt-a5d341": {
    description: "Pikachu-themed passenger jet flying sightseeing circuits above the island.",
    statusLine: "Passenger jet flying scenic circuits overhead",
  },
  "c-mvnepky4-e46ba2": {
    description: "High-capacity regional datacentre powering heavy compute and AI workloads.",
    statusLine: "Hyperscale datacentre powering regional compute",
  },
  "c-mvnf2juk-326f62": {
    description: "Downtown office tower anchoring the city's commercial district.",
    statusLine: "Commercial office tower in the downtown core",
  },
  "c-mvng01tx-c070df": {
    description: "Rhinoceros taking its bubble bath on a stroll through the southern neighborhoods.",
    statusLine: "Rhinoceros roaming town in its bubble bath",
  },
  "c-mvnlor0y-0ebcf9": {
    description: "Supersonic fighter jet flying high-speed patrol passes over the island.",
    statusLine: "Fighter jet flying patrol passes overhead",
  },
  "c-mvnlu09c-0cd9f7": {
    description: "Quiet country cottage tucked along the western residential lane.",
    statusLine: "Country home on the western cottage lane",
  },
  "c-mvnmyyq6-bc000b": {
    description: "Offshore public-broadcaster island recreated as a throwback to 2007 virtual worlds.",
    statusLine: "Public-broadcaster island outpost offshore",
  },
  "c-mvns4thf-81f7de": {
    description: "Municipal fire station housing the town's emergency response crew and pumper truck.",
    statusLine: "Town fire station serving the southern district",
  },
  "c-mvo96y3f-96e304": {
    description: "Rocky eastern headland overlooking tide pools and the open sea.",
    statusLine: "Eastern coastal lookout and tide pools",
  },
  "c-mvoab00r-9b0864": {
    description: "Haunted Victorian house keeping watch over the far western lane.",
    statusLine: "Haunted house on the western edge of town",
  },
  "c-mvobfiiw-3fb48e": {
    description: "Neighborhood ice cream truck circling town to serve cold treats at park stops.",
    statusLine: "Ice cream van serving treats around the central green",
  },
  "c-mvocr3dc-a475ca": {
    description: "Giant communal beehive producing honey at the western edge of the meadow.",
    statusLine: "Meadow apiary producing honey for the bakery",
  },
  "c-mvocxa72-f718f5": {
    description: "Immersive egg-shaped concert venue hosting panoramic shows on South Avenue.",
    statusLine: "Panoramic concert arena on South Avenue",
  },
  "c-mvod5t0a-226189": {
    description: "Roadside burger stand serving grilled burgers on the southwest lane.",
    statusLine: "Neighborhood roadside burger stand",
  },
  "c-mvodkwqc-c9e4a4": {
    description: "Civic assembly hall where representatives meet to debate town affairs.",
    statusLine: "Civic parliament hall for town government",
  },
  "c-mvodns66-ce9982": {
    description: "Open-air concert amphitheatre hosting live rock shows beside the northern datacentre campus.",
    statusLine: "Outdoor rock concert venue in the north district",
  },
  "c-mvoehstp-db1cae": {
    description: "Monumental pancake house serving breakfast stacks to the eastern district.",
    statusLine: "Ziggurat diner serving breakfast all day",
  },
  "c-mvofq9cw-f479a6": {
    description: "Giant bare foot hopping around the town streets on its own.",
    statusLine: "Giant foot hopping through the neighborhood",
  },
  "c-mvofu6xi-9656b7": {
    description: "Person in a banana suit relaxing in a beachside hammock.",
    statusLine: "Beachside hammock for afternoon lounging",
  },
  "c-mvogm9ja-6cd891": {
    description: "Giant defense mecha circling the outer perimeter to protect everyone inside the town.",
    statusLine: "Perimeter defense robot guarding the town",
  },
  "c-mvoi4jxh-b16cfb": {
    description: "Northern spaceport complex preparing heavy-lift rockets for orbital launch.",
    statusLine: "Orbital rocket launch complex in the far north",
  },
  "c-mvoivyhf-8fdd46": {
    description: "Outdoor tasting pavilion hosting tequila flights and neighborhood gatherings.",
    statusLine: "Outdoor tequila tasting bar on South Avenue",
  },
  "c-mvoiz95f-8d5336": {
    description: "Public library storing printed volumes of Wikipedia as an offline backup of human knowledge.",
    statusLine: "Offline print archive of human knowledge",
  },
  "c-mvojw3k4-4ee278": {
    description: "Corner bar where regulars queue up so everyone gets to feel like the smartest guy in the room.",
    statusLine: "Neighborhood pub celebrating everyday regulars",
  },
  "comp-4bcf04f9": {
    description: "Delivery van running fresh honey and bread between the western apiary and bakery.",
    statusLine: "West lane honey and bread delivery run",
  },
  "c-mvolsq8o-c1a835": {
    description: "Electric guitar monument broadcasting music across the southwest meadow.",
    statusLine: "Musical guitar monument in the southwest meadow",
  },
  "c-mvom998k-8e5580": {
    description: "Drive-thru Mexican restaurant feeding quarry crews and highway drivers in the northeast.",
    statusLine: "Drive-thru taqueria on the northeast quarry highway",
  },
  "comp-f2ce5ebd": {
    description: "Catering delivery van shuttling burritos between the northeast taquerias and east town.",
    statusLine: "Northeast highway burrito delivery run",
  },
  "c-mvomg46x-e654f2": {
    description: "Isolated cabin on the western frontier where a lone philosopher retreats to ponder reality.",
    statusLine: "Solitary philosopher's study cabin in the far west",
  },
  "comp-quarry-dump-truck": {
    description: "Heavy mining truck hauling raw mineral ore from the northeast quarry toward town.",
    statusLine: "Hauling mineral ore down the northeast quarry highway",
  },
  "comp-firehouse-pumper": {
    description: "Municipal fire engine patrolling South Avenue from Beacon Hill Firehouse.",
    statusLine: "Patrolling South Avenue from the firehouse",
  },
  "c-mvoo26uh-4e0810": {
    description: "Spherical entertainment venue broadcasting giant animated expressions across the northeast skyline.",
    statusLine: "Immersive sphere arena overlooking the northeast",
  },
  "c-mvoobup6-14b5ed": {
    description: "Specialty hardware shop supplying shovels and digging gear on the quarry highway.",
    statusLine: "Hardware shop supplying shovels and digging tools",
  },
  "c-mvoogwn8-0f4801": {
    description: "Giant letter L monument standing as a landmark in the southwest meadow.",
    statusLine: "Southwest meadow letter L landmark",
  },
  "c-mvopczh6-c9c3cb": {
    description: "Vertical-axis wind turbine generating renewable power on the southeastern ridge.",
    statusLine: "Southeastern wind turbine generating clean power",
  },
  "comp-6c0884bc": {
    description: "Utility tractor hauling maintenance gear between the southeast wind turbine and South Avenue.",
    statusLine: "Wind farm maintenance run in the southeast",
  },
  "c-mvopnujw-13af09": {
    description: "Highway taqueria serving burritos and tacos along the northeast quarry road.",
    statusLine: "Mexican taqueria serving highway travelers",
  },
  "comp-3227ab04": {
    description: "Crew shuttle ferrying engineers between the northern rocket launchpad and datacentre campus.",
    statusLine: "Shuttle linking the rocket launchpad and north tech campus",
  },
  "c-mvoq55fb-008e1b": {
    description: "Sprawling puzzle-box facility inspired by the film Cube, filled with shifting interconnected rooms.",
    statusLine: "Sci-fi puzzle labyrinth on the northern frontier",
  },
  "c-mvoqwq7n-086aec": {
    description: "Electric pickup truck cruising the island's outer neighborhood lanes.",
    statusLine: "Cruising the western neighborhood lanes",
  },
  "c-mvormrg7-af85ff": {
    description: "Coastal reef lagoon and lighthouse cove guiding boats along the southern shore.",
    statusLine: "Lighthouse cove guiding boats along the southern reef",
  },
};

/**
 * Strips flowery/whimsical adjectives from LLM-generated descriptions so any newly added
 * creation also reads as a clean, matter-of-fact description of the object.
 */
export function normalizeFactualDescription(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return s;
  s = s.replace(
    /^(a|an)\s+(whimsical|charming|delightful|mouth-watering|sun-drenched|sun-warmed|nostalgic|cheerful|contented|playful|cozy|adorable|striking|monumental|mythical|decrepit)\s+/i,
    (_, art: string) => `${art.toUpperCase()} `,
  );
  // Capitalize first letter cleanly
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Clean outer-meadow patrol anchors for Aegis Perimeter Titan (`c-mvogm9ja-6cd891`),
 * circling the town while staying well clear of Borealis Mineral Quarry (`[118, -114]`),
 * Interstellar Rocket Launchpad (`[0, -126]`), Emerald Cliff Waterfall (`[-14, 91]`),
 * and outer neighborhood landmarks.
 */
export const PERIMETER_TITAN_SEED_LOOP: [number, number][] = [
  [52, 118],
  [-58, 76],
  [-116, -8],
  [-56, -112],
  [44, -108],
  [98, -92],
  [116, -36],
  [122, 24],
];

interface WanderObstacleCircle {
  id: string;
  x: number;
  z: number;
  clearR: number;
}

function clampCoord(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function closestOnSegment2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 1e-6 ? clampCoord(((cx - ax) * dx + (cz - az) * dz) / len2, 0, 1) : 0;
  const px = ax + dx * t;
  const pz = az + dz * t;
  return { dist: Math.hypot(cx - px, cz - pz), t };
}

function buildWanderObstacles(
  walker: Pick<WorldCreation, "id" | "scaleClass" | "blueprint">,
  style: string | undefined,
  creations: WorldCreation[],
  props: WorldProp[],
): WanderObstacleCircle[] {
  const selfR = getCreationFootprintRadius(
    walker.scaleClass,
    walker.blueprint?.stats?.footprintX ?? 14,
    walker.blueprint?.stats?.footprintZ ?? 14,
  );
  const selfPad = Math.min(3.8, Math.max(0.85, selfR * 0.48));
  const isGlide = style === "glide";
  const obs: WanderObstacleCircle[] = [];

  for (const c of creations) {
    if (c.id === walker.id) continue;
    if (c.category !== "building" && c.behavior?.type !== "landmark") continue;
    const r = getCreationFootprintRadius(
      c.scaleClass,
      c.blueprint?.stats?.footprintX ?? 14,
      c.blueprint?.stats?.footprintZ ?? 14,
    );
    obs.push({ id: c.id, x: c.x, z: c.z, clearR: r + selfPad + 2.2 });
  }
  if (!isGlide) {
    for (const p of props) {
      if (p.kind !== "pond") continue;
      const r = p.radius ?? 6.4;
      obs.push({ id: p.id, x: p.x, z: p.z, clearR: r + selfPad * 0.6 + 1.6 });
    }
  }
  obs.push({ id: "city-sign", x: 10.5, z: 4.5, clearR: 2.8 + selfPad * 0.4 });
  return obs;
}

export function nudgeWanderPointClearOfWorld(
  px: number,
  pz: number,
  walker: Pick<WorldCreation, "id" | "scaleClass" | "blueprint">,
  style: string | undefined,
  creations: WorldCreation[],
  props: WorldProp[],
  bound = 136,
): [number, number] {
  const obs = buildWanderObstacles(walker, style, creations, props);
  return nudgePointClearInternal(px, pz, obs, bound);
}

function nudgePointClearInternal(
  px: number,
  pz: number,
  obs: WanderObstacleCircle[],
  bound = 136,
): [number, number] {
  let x = clampCoord(px, -bound, bound);
  let z = clampCoord(pz, -bound, bound);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const o of obs) {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < o.clearR - 0.05) {
        let ux = d > 0.05 ? dx / d : o.x > 0 ? -1 : 1;
        let uz = d > 0.05 ? dz / d : o.z > 0 ? -1 : 1;
        let nx = o.x + ux * (o.clearR + 0.45);
        let nz = o.z + uz * (o.clearR + 0.45);
        if (Math.abs(nx) > bound - 1 || Math.abs(nz) > bound - 1) {
          const toCenterLen = Math.hypot(-o.x, -o.z) || 1;
          ux = -o.x / toCenterLen;
          uz = -o.z / toCenterLen;
          nx = o.x + ux * (o.clearR + 0.8);
          nz = o.z + uz * (o.clearR + 0.8);
        }
        x = clampCoord(nx, -bound, bound);
        z = clampCoord(nz, -bound, bound);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [Number(x.toFixed(1)), Number(z.toFixed(1))];
}

/**
 * Ensures every wander waypoint AND every straight-line walk segment between consecutive
 * waypoints clears stationary buildings, quarries, waterfalls, and ponds (taking the walker's
 * own scaleClass footprint into account), inserting clean detour waypoints around obstacles.
 */
export function sanitizeWanderTargetsForWorld(
  walker: Pick<WorldCreation, "id" | "scaleClass" | "blueprint" | "x" | "z">,
  style: string | undefined,
  rawTargets: [number, number][],
  creations: WorldCreation[],
  props: WorldProp[],
): [number, number][] {
  const obs = buildWanderObstacles(walker, style, creations, props);
  const seed =
    rawTargets.length >= 2
      ? rawTargets
      : ([
          [walker.x + 12, walker.z + 8],
          [walker.x - 11, walker.z + 9],
          [walker.x + 4, walker.z - 14],
        ] as [number, number][]);

  let pts = seed.map(([tx, tz]) => nudgePointClearInternal(tx, tz, obs));

  for (let pass = 0; pass < 4 && pts.length < 18; pass++) {
    const nextPts: [number, number][] = [];
    let inserted = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      nextPts.push(a);
      if (nextPts.length >= 18) continue;

      let worst: WanderObstacleCircle | null = null;
      let worstPen = 0;
      for (const o of obs) {
        const hit = closestOnSegment2D(a[0], a[1], b[0], b[1], o.x, o.z);
        const req = o.clearR - 0.7;
        if (hit.t > 0.03 && hit.t < 0.97 && hit.dist < req) {
          const pen = req - hit.dist;
          if (pen > worstPen) {
            worstPen = pen;
            worst = o;
          }
        }
      }

      if (worst) {
        const sdx = b[0] - a[0];
        const sdz = b[1] - a[1];
        const slen = Math.hypot(sdx, sdz) || 1;
        const px1 = -sdz / slen;
        const pz1 = sdx / slen;
        const cand1 = nudgePointClearInternal(
          worst.x + px1 * (worst.clearR + 1.9),
          worst.z + pz1 * (worst.clearR + 1.9),
          obs,
        );
        const cand2 = nudgePointClearInternal(
          worst.x - px1 * (worst.clearR + 1.9),
          worst.z - pz1 * (worst.clearR + 1.9),
          obs,
        );
        const score = (c: [number, number]): number => {
          const dPath = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]);
          let penalty = 0;
          for (const other of obs) {
            const h1 = closestOnSegment2D(a[0], a[1], c[0], c[1], other.x, other.z);
            const h2 = closestOnSegment2D(c[0], c[1], b[0], b[1], other.x, other.z);
            if (h1.dist < other.clearR - 0.7) penalty += 500;
            if (h2.dist < other.clearR - 0.7) penalty += 500;
          }
          return dPath + penalty;
        };
        const chosen = score(cand1) <= score(cand2) ? cand1 : cand2;
        nextPts.push(chosen);
        inserted = true;
      }
    }
    pts = nextPts;
    if (!inserted) break;
  }

  return pts;
}

export interface CorridorLoadSummary {
  pathId: string;
  kind: PathKind;
  closed: boolean;
  lengthM: number;
  capacity: number;
  vehicleIds: string[];
  overloaded: boolean;
}

export interface WorldTrafficCongestionReport {
  congested: boolean;
  corridors: CorridorLoadSummary[];
  overloadedCorridors: CorridorLoadSummary[];
  pingPongLoopIntrusionIds: string[];
  longDwellVehicleIds: string[];
  roadBlockedVehicleIds: string[];
  crampedTurnaroundVehicleIds: string[];
  activeIncidents: TrafficIncidentRecord[];
  summaryText: string;
}

function polylineLength2D(pts: [number, number][], closed: boolean): number {
  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  if (closed && pts.length >= 3) {
    total += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  }
  return total;
}

function dedupeConsecutiveWaypoints(pts: [number, number][], minStep = 1.2): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, z] of pts) {
    const rounded: [number, number] = [Number(x.toFixed(2)), Number(z.toFixed(2))];
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(rounded[0] - prev[0], rounded[1] - prev[1]) >= minStep) {
      out.push(rounded);
    }
  }
  return out;
}

function sanitizeStopsAlongWaypoints(
  rawStops: RouteStop[] | undefined,
  waypoints: [number, number][],
  closed: boolean,
  vehicleId: string,
): RouteStop[] {
  const curve = sampleCatmullRom2D(waypoints, closed, 0.75);
  const kept: RouteStop[] = [];
  for (const st of rawStops ?? []) {
    const hit = distPointToPolyline2D(st.x, st.z, curve);
    if (hit.dist > 8.5) continue;
    const sx = Number(hit.closestX.toFixed(1));
    const sz = Number(hit.closestZ.toFixed(1));
    if (kept.some((o) => Math.hypot(o.x - sx, o.z - sz) < 14.0)) continue;
    kept.push({
      ...st,
      x: sx,
      z: sz,
      dwellSec: Number(Math.min(2.2, Math.max(1.4, st.dwellSec || 1.8)).toFixed(1)),
    });
    if (kept.length >= 3) break;
  }
  if (kept.length >= 2) return kept;

  const startPt = waypoints[0];
  const endPt = closed
    ? waypoints[Math.floor(waypoints.length / 2)]
    : waypoints[waypoints.length - 1];
  return [
    {
      id: `stop-${vehicleId}-a`,
      name: kept[0]?.name || "Route Terminal A",
      x: Number(startPt[0].toFixed(1)),
      z: Number(startPt[1].toFixed(1)),
      dwellSec: 1.8,
      ...(kept[0]?.nearCreationId ? { nearCreationId: kept[0].nearCreationId } : {}),
    },
    {
      id: `stop-${vehicleId}-b`,
      name: kept[1]?.name || "Route Terminal B",
      x: Number(endPt[0].toFixed(1)),
      z: Number(endPt[1].toFixed(1)),
      dwellSec: 1.8,
      ...(kept[1]?.nearCreationId ? { nearCreationId: kept[1].nearCreationId } : {}),
    },
  ];
}

/**
 * Inspects every drivable road/lane corridor and every `vehicle_route` creation to detect
 * downtown ring-road bottlenecks, regional ping-pong overlap on `path-main-loop`, and
 * excessive stop dwell times so the orchestrator can continuously rebalance traffic.
 */
export function analyzeWorldTrafficCongestion(
  creations: WorldCreation[],
  paths: WorldPath[],
  incidents: TrafficIncidentRecord[] = [],
): WorldTrafficCongestionReport {
  const drivablePaths = paths
    .filter((p) => (p.kind === "road" || p.kind === "cottage_road") && p.points.length >= 2)
    .map((p) => {
      const curve = sampleCatmullRom2D(p.points, Boolean(p.closed), 0.75);
      const lengthM = Number(polylineLength2D(curve, Boolean(p.closed)).toFixed(1));
      return { path: p, curve, lengthM };
    })
    .filter((rc) => rc.lengthM >= 26 || rc.path.id === "path-main-loop");

  const mainLoop = drivablePaths.find((rc) => rc.path.id === "path-main-loop");
  const vehicles = creations.filter((c) => c.behavior?.type === "vehicle_route");
  const solidStructures = creations.filter(
    (c) =>
      c.behavior?.type !== "vehicle_route" &&
      (c.category === "building" || c.behavior?.type === "landmark"),
  );

  const corridorLoads = new Map<string, string[]>();
  for (const rc of drivablePaths) corridorLoads.set(rc.path.id, []);

  const pingPongLoopIntrusionIds: string[] = [];
  const longDwellVehicleIds: string[] = [];
  const roadBlockedVehicleIds: string[] = [];
  const crampedTurnaroundVehicleIds: string[] = [];

  for (const v of vehicles) {
    if (v.behavior.type !== "vehicle_route") continue;
    const wps = v.behavior.waypoints ?? [];
    if (wps.length < 2) continue;

    if (
      (v.behavior.stops ?? []).some((s) => (s.dwellSec ?? 0) > 2.6) ||
      (v.behavior.stops ?? []).length > 3
    ) {
      longDwellVehicleIds.push(v.id);
    }

    const closed = v.behavior.loopMode !== "pingpong";
    const sampledRoute = sampleCatmullRom2D(wps, closed, 1.5);
    let routeObstructed = false;
    for (const pt of sampledRoute) {
      for (const bld of solidStructures) {
        const bldR = getCreationFootprintRadius(
          bld.scaleClass,
          bld.blueprint?.stats?.footprintX ?? 14,
          bld.blueprint?.stats?.footprintZ ?? 14,
        );
        if (Math.hypot(pt[0] - bld.x, pt[1] - bld.z) < bldR * 0.72) {
          routeObstructed = true;
          break;
        }
      }
      if (routeObstructed) break;
    }
    if (routeObstructed) {
      roadBlockedVehicleIds.push(v.id);
    }

    if (!closed) {
      const endpoints = [wps[0], wps[wps.length - 1]];
      let crampedEnd = false;
      for (const ep of endpoints) {
        if (getIslandInlandMargin(ep[0], ep[1]) < 3.5) {
          crampedEnd = true;
          break;
        }
        for (const bld of solidStructures) {
          const bldR = getCreationFootprintRadius(
            bld.scaleClass,
            bld.blueprint?.stats?.footprintX ?? 14,
            bld.blueprint?.stats?.footprintZ ?? 14,
          );
          if (Math.hypot(ep[0] - bld.x, ep[1] - bld.z) < bldR * 0.8 + 1.0) {
            crampedEnd = true;
            break;
          }
        }
        if (crampedEnd) break;
      }
      if (crampedEnd) {
        crampedTurnaroundVehicleIds.push(v.id);
      }

      if (mainLoop) {
        const ringHits = wps.filter(
          ([wx, wz]) => distPointToPolyline2D(wx, wz, mainLoop.curve).dist <= 2.2,
        ).length;
        if (ringHits >= 2) {
          pingPongLoopIntrusionIds.push(v.id);
        }
      }
    }

    // Assign vehicle load to each corridor where >= 30% (or >= 3) of its waypoints run
    for (const rc of drivablePaths) {
      const onCorridor = wps.filter(
        ([wx, wz]) => distPointToPolyline2D(wx, wz, rc.curve).dist <= 3.5,
      ).length;
      if (onCorridor >= 3 || onCorridor / wps.length >= 0.35) {
        corridorLoads.get(rc.path.id)!.push(v.id);
      }
    }
  }

  const corridors: CorridorLoadSummary[] = drivablePaths.map((rc) => {
    const vehicleIds = corridorLoads.get(rc.path.id) ?? [];
    const capacity =
      rc.path.id === "path-outer-ring"
        ? 4
        : Boolean(rc.path.closed) || rc.lengthM >= 55
          ? 2
          : 1;
    return {
      pathId: rc.path.id,
      kind: rc.path.kind,
      closed: Boolean(rc.path.closed),
      lengthM: rc.lengthM,
      capacity,
      vehicleIds,
      overloaded: vehicleIds.length > capacity,
    };
  });

  const activeIncidents = incidents.filter((inc) =>
    vehicles.some((v) => v.id === inc.vehicleId),
  );
  const overloadedCorridors = corridors.filter((c) => c.overloaded);
  const congested =
    overloadedCorridors.length > 0 ||
    pingPongLoopIntrusionIds.length > 0 ||
    longDwellVehicleIds.length > 0 ||
    roadBlockedVehicleIds.length > 0 ||
    crampedTurnaroundVehicleIds.length > 0 ||
    activeIncidents.length > 0;

  const summaryParts: string[] = [];
  if (overloadedCorridors.length > 0) {
    summaryParts.push(
      `Overloaded corridors: ${overloadedCorridors.map((c) => `${c.pathId} (${c.vehicleIds.length}/${c.capacity})`).join(", ")}`,
    );
  }
  if (pingPongLoopIntrusionIds.length > 0) {
    summaryParts.push(
      `Regional ping-pong vehicles intruding onto path-main-loop: ${pingPongLoopIntrusionIds.join(", ")}`,
    );
  }
  if (roadBlockedVehicleIds.length > 0) {
    summaryParts.push(`Vehicles with building-obstructed waypoints: ${roadBlockedVehicleIds.join(", ")}`);
  }
  if (crampedTurnaroundVehicleIds.length > 0) {
    summaryParts.push(`Open-route vehicles needing clear turnaround space: ${crampedTurnaroundVehicleIds.join(", ")}`);
  }
  if (activeIncidents.length > 0) {
    summaryParts.push(
      `Live vehicle clash/stuck incidents reported: ${activeIncidents.map((inc) => `${inc.vehicleId} (${inc.reason} x${inc.count} at [${inc.x}, ${inc.z}])`).join(", ")}`,
    );
  }
  if (longDwellVehicleIds.length > 0) {
    summaryParts.push(`Vehicles with excessive stop dwell/count: ${longDwellVehicleIds.join(", ")}`);
  }

  return {
    congested,
    corridors,
    overloadedCorridors,
    pingPongLoopIntrusionIds,
    longDwellVehicleIds,
    roadBlockedVehicleIds,
    crampedTurnaroundVehicleIds,
    activeIncidents,
    summaryText: summaryParts.length > 0 ? summaryParts.join(" | ") : "All corridors within traffic capacity",
  };
}

/**
 * Picks the best under-capacity drivable corridor near `(targetX, targetZ)` when assigning
 * a newly placed or re-routed vehicle so new cars don't all pile onto `path-main-loop`.
 */
export function chooseLeastCongestedRoad(
  targetX: number,
  targetZ: number,
  preferredKind: PathKind,
  creations: WorldCreation[],
  paths: WorldPath[],
  excludeVehicleId?: string,
  maxDistanceM?: number,
): WorldPath | null {
  const filteredCreations = excludeVehicleId
    ? creations.filter((c) => c.id !== excludeVehicleId)
    : creations;
  const report = analyzeWorldTrafficCongestion(filteredCreations, paths);
  const loadById = new Map(report.corridors.map((c) => [c.pathId, c]));

  const candidates = paths.filter((p) => {
    const info = loadById.get(p.id);
    return Boolean(info);
  });
  if (candidates.length === 0) return null;

  let best: WorldPath | null = null;
  let bestScore = Infinity;
  for (const p of candidates) {
    const info = loadById.get(p.id)!;
    const curve = sampleCatmullRom2D(p.points, Boolean(p.closed), 0.75);
    const d = distPointToPolyline2D(targetX, targetZ, curve).dist;
    if (typeof maxDistanceM === "number" && d > maxDistanceM) continue;
    const loadRatio = info.vehicleIds.length / Math.max(1, info.capacity);
    const overloadPenalty = info.vehicleIds.length >= info.capacity ? 240 + info.vehicleIds.length * 90 : loadRatio * 55;
    const closedBonus = p.closed ? -28 : 0;
    const kindPenalty = p.kind === preferredKind ? 0 : 18;
    const score = d * 1.15 + overloadPenalty + kindPenalty + closedBonus;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/**
 * Deterministic SimCity Traffic Orchestrator pass:
 * 1. Trims regional `pingpong` haul/shuttle routes so they terminate cleanly at their outer
 *    district ring junction instead of driving around `path-main-loop`.
 * 2. Rebalances any corridor exceeding capacity (`> 2` vehicles) by moving excess non-seed
 *    vehicles onto underutilized district avenues/boulevards.
 * 3. Deduplicates waypoints, spaces stops >= 14m apart, caps `dwellSec <= 2.2s`, and staggers
 *    speeds on shared roads so vehicles flow continuously without bunching.
 */
export function decongestWorldTraffic(
  creations: WorldCreation[],
  paths: WorldPath[],
): { changedIds: string[]; notes: string[] } {
  const changedIds = new Set<string>();
  const notes: string[] = [];

  const drivable = paths
    .filter((p) => (p.kind === "road" || p.kind === "cottage_road") && p.points.length >= 2)
    .map((p) => {
      const curve = sampleCatmullRom2D(p.points, Boolean(p.closed), 0.75);
      const lengthM = polylineLength2D(curve, Boolean(p.closed));
      return { path: p, curve, lengthM };
    })
    .filter((rc) => rc.lengthM >= 26 || rc.path.id === "path-main-loop");

  const mainLoop = drivable.find((rc) => rc.path.id === "path-main-loop");
  if (!mainLoop) return { changedIds: [], notes: [] };

  // Step 1: Trim regional/cross-town ping-pong routes off `path-main-loop`
  for (const c of creations) {
    if (c.behavior?.type !== "vehicle_route") continue;
    let wps = dedupeConsecutiveWaypoints(c.behavior.waypoints ?? []);
    if (wps.length < 2) continue;

    const origJson = JSON.stringify({
      loopMode: c.behavior.loopMode,
      speed: c.behavior.speed,
      waypoints: c.behavior.waypoints,
      stops: c.behavior.stops,
    });

    if (c.behavior.loopMode === "pingpong") {
      const onRingFlags = wps.map(
        ([wx, wz]) => distPointToPolyline2D(wx, wz, mainLoop.curve).dist <= 2.2,
      );
      const ringCount = onRingFlags.filter(Boolean).length;

      if (ringCount >= 1) {
        const startsOffRing = !onRingFlags[0];
        const endsOffRing = !onRingFlags[onRingFlags.length - 1];
        const firstRingIdx = onRingFlags.findIndex(Boolean);

        if (startsOffRing && !endsOffRing) {
          // Regional haul/patrol entering town: stop cleanly at the T-junction curb just outside `path-main-loop`
          const offRingPrefix = wps.slice(0, firstRingIdx);
          if (offRingPrefix.length >= 2 && polylineLength2D(offRingPrefix, false) >= 16) {
            wps = offRingPrefix;
          } else if (firstRingIdx >= 1) {
            wps = wps.slice(0, firstRingIdx + 1);
          }
        } else if (!startsOffRing && endsOffRing) {
          let lastRingIdx = 0;
          for (let i = 0; i < onRingFlags.length; i++) {
            if (onRingFlags[i]) lastRingIdx = i;
            else break;
          }
          const offRingSuffix = wps.slice(lastRingIdx + 1);
          if (offRingSuffix.length >= 2 && polylineLength2D(offRingSuffix, false) >= 16) {
            wps = offRingSuffix;
          } else {
            wps = wps.slice(lastRingIdx);
          }
        } else if (startsOffRing && endsOffRing && ringCount >= 2) {
          const offRingPrefix = wps.slice(0, firstRingIdx);
          if (c.isCompanion && offRingPrefix.length >= 2 && polylineLength2D(offRingPrefix, false) >= 55) {
            wps = offRingPrefix;
          } else {
            const alt = chooseLeastCongestedRoad(
              c.x,
              c.z,
              "road",
              creations,
              paths.filter((p) => p.id !== "path-main-loop"),
              c.id,
              24,
            );
            if (alt && alt.points.length >= 3) {
              wps = dedupeConsecutiveWaypoints(alt.points);
            } else if (offRingPrefix.length >= 2) {
              wps = offRingPrefix;
            }
          }
        }
      }
    }

    const closed = c.behavior.loopMode !== "pingpong";
    const cleanStops = sanitizeStopsAlongWaypoints(c.behavior.stops, wps, closed, c.id);

    const nextBehavior = {
      ...c.behavior,
      waypoints: wps,
      stops: cleanStops,
    };
    const nextJson = JSON.stringify({
      loopMode: nextBehavior.loopMode,
      speed: nextBehavior.speed,
      waypoints: nextBehavior.waypoints,
      stops: nextBehavior.stops,
    });
    if (origJson !== nextJson) {
      c.behavior = nextBehavior;
      c.x = wps[0][0];
      c.z = wps[0][1];
      changedIds.add(c.id);
      notes.push(`trimmed "${c.name}" (${c.id}) route & stops for smooth traffic flow`);
    }
  }

  // Step 2: Enforce corridor capacity (max 2 vehicles per corridor) on nearby roads only
  const report = analyzeWorldTrafficCongestion(creations, paths);
  for (const overloaded of report.overloadedCorridors) {
    const movableIds = overloaded.vehicleIds.filter((vid) => {
      const vc = creations.find((x) => x.id === vid);
      return vc && !vc.isSeed;
    });
    const excessCount = overloaded.vehicleIds.length - overloaded.capacity;
    for (let i = 0; i < excessCount && i < movableIds.length; i++) {
      const vid = movableIds[movableIds.length - 1 - i];
      const vc = creations.find((x) => x.id === vid);
      if (!vc || vc.behavior?.type !== "vehicle_route") continue;

      // Only transition onto a nearby / intersecting road (such as path-outer-ring <= 24m away) — NEVER jump across the island!
      const refPts: [number, number][] =
        vc.behavior.waypoints.length >= 2
          ? [
              [vc.x, vc.z],
              vc.behavior.waypoints[0],
              vc.behavior.waypoints[vc.behavior.waypoints.length - 1],
            ]
          : [[vc.x, vc.z]];
      let altRoad: WorldPath | null = null;
      for (const [rx, rz] of refPts) {
        altRoad = chooseLeastCongestedRoad(
          rx,
          rz,
          overloaded.kind,
          creations,
          paths.filter((p) => p.id !== overloaded.pathId),
          vc.id,
          24,
        );
        if (altRoad) break;
      }
      if (!altRoad || altRoad.points.length < 2) continue;

      const isClosed = Boolean(altRoad.closed) && altRoad.points.length >= 4;
      const rawWps = dedupeConsecutiveWaypoints(altRoad.points);
      const newWps = isClosed ? rotateClosedWaypointsNear(rawWps, vc.x, vc.z) : rawWps;
      const newStops = sanitizeStopsAlongWaypoints(vc.behavior.stops, newWps, isClosed, vc.id);
      vc.behavior = {
        ...vc.behavior,
        loopMode: isClosed ? "loop" : "pingpong",
        waypoints: newWps,
        stops: newStops,
      };
      const nearCurve = sampleCatmullRom2D(newWps, isClosed, 1.0);
      const proj = distPointToPolyline2D(vc.x, vc.z, nearCurve);
      vc.x = Number(proj.closestX.toFixed(1));
      vc.z = Number(proj.closestZ.toFixed(1));
      changedIds.add(vc.id);
      notes.push(`rerouted "${vc.name}" (${vc.id}) from congested ${overloaded.pathId} onto ${altRoad.id}`);
    }
  }

  // Step 3: Stagger speeds gently downward (NEVER speeding up above authored speed!) when sharing a corridor
  const postReport = analyzeWorldTrafficCongestion(creations, paths);
  const corridorFactors = [1.0, 0.86, 0.93];
  for (const corr of postReport.corridors) {
    if (corr.vehicleIds.length < 2) continue;
    corr.vehicleIds.forEach((vid, slotIdx) => {
      if (slotIdx === 0) return;
      const vc = creations.find((x) => x.id === vid);
      if (!vc || vc.behavior?.type !== "vehicle_route" || vc.isSeed) return;
      const curSpd = vc.behavior.speed || 5.4;
      const factor = corridorFactors[slotIdx % corridorFactors.length];
      const desiredSpeed = Number(Math.max(3.6, Math.min(curSpd, curSpd * factor)).toFixed(2));
      if (curSpd - desiredSpeed > 0.2) {
        vc.behavior = { ...vc.behavior, speed: desiredSpeed };
        changedIds.add(vc.id);
      }
    });
  }

  return { changedIds: [...changedIds], notes };
}

/**
 * Observer Agent deterministic resolution pass for vehicle clearance:
 * - Clears route waypoints that genuinely clip inside newly placed solid buildings/landmarks.
 * - Never swaps active driving vehicles onto distant roads mid-session so live vehicles never jump or fly.
 */
export function resolveTrafficIncidentsWithObserver(
  creations: WorldCreation[],
  _paths: WorldPath[],
  incidents: TrafficIncidentRecord[],
): {
  changedIds: string[];
  resolvedIncidentIds: string[];
  notes: string[];
} {
  const changedIds = new Set<string>();
  const resolvedIncidentIds: string[] = incidents.map((inc) => inc.id);
  const notes: string[] = [];

  const solidStructures = creations.filter(
    (c) =>
      c.behavior?.type !== "vehicle_route" &&
      (c.category === "building" || c.behavior?.type === "landmark"),
  );

  const nudgeWaypointClearOfStructures = (
    wx: number,
    wz: number,
    extraPad: number,
  ): [number, number] => {
    let [nx, nz] = clampPointToIsland(wx, wz, 5.5);
    for (let pass = 0; pass < 2; pass++) {
      for (const bld of solidStructures) {
        const bldR =
          getCreationFootprintRadius(
            bld.scaleClass,
            bld.blueprint?.stats?.footprintX ?? 14,
            bld.blueprint?.stats?.footprintZ ?? 14,
          ) *
            0.76 +
          extraPad;
        const dx = nx - bld.x;
        const dz = nz - bld.z;
        const d = Math.hypot(dx, dz);
        if (d < bldR) {
          const ang = d > 0.01 ? Math.atan2(dz, dx) : 0.7;
          nx = bld.x + Math.cos(ang) * bldR;
          nz = bld.z + Math.sin(ang) * bldR;
        }
      }
      [nx, nz] = clampPointToIsland(nx, nz, 4.8);
    }
    return [Number(nx.toFixed(2)), Number(nz.toFixed(2))];
  };

  for (const vc of creations) {
    if (vc.behavior?.type !== "vehicle_route" || vc.isSeed) continue;
    const wps = vc.behavior.waypoints ?? [];
    if (wps.length < 2) continue;

    const isPingPong = vc.behavior.loopMode === "pingpong";
    let modified = false;
    const adjustedWps: [number, number][] = wps.map(([wx, wz], idx) => {
      const isEndpoint = isPingPong && (idx === 0 || idx === wps.length - 1);
      const reqPad = isEndpoint ? 1.2 : 0.45;
      const [cx, cz] = nudgeWaypointClearOfStructures(wx, wz, reqPad);
      const shift = Math.hypot(cx - wx, cz - wz);
      if (shift > 0.45 && shift <= 3.5) {
        modified = true;
        return [cx, cz];
      }
      return [wx, wz];
    });

    if (modified) {
      const cleanWps = dedupeConsecutiveWaypoints(adjustedWps);
      if (cleanWps.length >= (isPingPong ? 2 : 3)) {
        const cleanStops = sanitizeStopsAlongWaypoints(
          vc.behavior.stops,
          cleanWps,
          !isPingPong,
          vc.id,
        );
        vc.behavior = {
          ...vc.behavior,
          waypoints: cleanWps,
          stops: cleanStops,
        };
        changedIds.add(vc.id);
      }
    }
  }

  return {
    changedIds: [...changedIds],
    resolvedIncidentIds,
    notes,
  };
}


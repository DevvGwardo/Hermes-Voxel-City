import type { VoxelBlueprint } from "./types";
import { normalizeAndGroundBlueprint } from "./voxel_dsl";

export type CompanionVehicleArchetype =
  | "mining_dump_truck"
  | "fire_engine"
  | "cargo_delivery_van"
  | "farm_tractor"
  | "service_shuttle";

/**
 * Monumental `"colossal"` (~22.4m wide × 25.0m tall) multi-tiered alpine canyon waterfall
 * sculpted directly from Y = 0 with zero raised platform slab, twin roaring cataracts,
 * mossy granite crags, cliffside spruce pines, flush emerald plunge lagoon on +Z, and rising mist parts.
 */
export function buildColossalWaterfallBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Emerald Cliff Waterfall",
      description:
        "Northwest coastal waterfall cascading beside the ocean shore and feeding fresh mountain water into the island's streams.",
      category: "prop",
      scaleClass: "colossal",
      liveFeed: { kind: "weather", place: "GeminIsland", lat: -33.87, lon: 151.21 },
      palette: {
        graniteDark: "#656d76",
        granite: "#818a93",
        graniteWarm: "#9aa1a4",
        graniteLight: "#b4bab9",
        slate: "#515861",
        mossDark: "#43843d",
        moss: "#5fae50",
        mossBright: "#81cb68",
        pineTrunk: "#6e492b",
        pineDark: "#2d693a",
        pineLight: "#459150",
        deepPool: "#1e7482",
        lagoon: "#2ea9b8",
        aqua: "#53d3dc",
        waterBright: "#87f2f6",
        foam: "#f5fcfe",
        mist: "#e3f9fc",
        fern: "#6bc05b",
        pebble: "#a4aba8",
        blossom: "#f7d76e",
        timber: "#8c613b",
      },
      ops: [
        // 1. Asymmetric sunlit granite mountain massif rising organically from Y = 0 (zero rectangular plinth!)
        { op: "cone", cx: -3, y0: 0, y1: 54, cz: -13, rBottom: 23.0, rTop: 11.0, color: "granite" },
        { op: "cone", cx: -15, y0: 0, y1: 58, cz: -10, rBottom: 13.5, rTop: 5.5, color: "graniteWarm" },
        { op: "cone", cx: 13, y0: 0, y1: 49, cz: -9, rBottom: 14.0, rTop: 6.2, color: "graniteDark" },
        { op: "cone", cx: -20, y0: 0, y1: 31, cz: 0, rBottom: 9.8, rTop: 4.5, color: "granite" },
        { op: "cone", cx: 19, y0: 0, y1: 27, cz: 1, rBottom: 9.6, rTop: 4.4, color: "graniteWarm" },

        // Stepped limestone-granite strata & sunlit cliff shoulders
        { op: "roundedBox", x0: -23, y0: 0, z0: -20, x1: -9, y1: 28, z1: 1, radius: 3.0, color: "graniteWarm" },
        { op: "roundedBox", x0: 8, y0: 0, z0: -20, x1: 22, y1: 24, z1: 1, radius: 3.0, color: "granite" },
        { op: "roundedBox", x0: -15, y0: 25, z0: -21, x1: 14, y1: 47, z1: -5, radius: 2.8, color: "graniteLight" },
        { op: "roundedBox", x0: -22, y0: 0, z0: -2, x1: -12, y1: 14, z1: 9, radius: 2.5, color: "graniteDark" },
        { op: "roundedBox", x0: 11, y0: 0, z0: -2, x1: 21, y1: 12, z1: 9, radius: 2.5, color: "slate" },

        // Carve natural stepped canyon amphitheatre so cascades pour down open sunlit rock ledges
        { op: "cylinder", axis: "y", cx: -1, y0: 26, y1: 50, cz: -4, radius: 8.2, carve: true },
        { op: "cylinder", axis: "y", cx: 0, y0: 2, y1: 28, cz: 2, radius: 10.6, carve: true },

        // Lush emerald moss blankets capping every cliff terrace and summit shoulder
        { op: "roundedBox", x0: -23, y0: 27, z0: -18, x1: -9, y1: 30, z1: 0, radius: 1.4, color: "moss" },
        { op: "roundedBox", x0: 8, y0: 23, z0: -18, x1: 22, y1: 26, z1: 0, radius: 1.4, color: "moss" },
        { op: "roundedBox", x0: -22, y0: 13, z0: -1, x1: -12, y1: 16, z1: 8, radius: 1.2, color: "mossBright" },
        { op: "roundedBox", x0: 11, y0: 11, z0: -1, x1: 21, y1: 14, z1: 8, radius: 1.2, color: "moss" },
        { op: "sphere", cx: -15, cy: 57, cz: -10, rx: 6.2, ry: 2.2, rz: 5.5, color: "mossBright" },
        { op: "sphere", cx: 13, cy: 48, cz: -9, rx: 6.4, ry: 2.2, rz: 5.5, color: "moss" },
        { op: "sphere", cx: -4, cy: 47, cz: -15, rx: 8.5, ry: 2.0, rz: 5.2, color: "mossDark" },

        // 2. High alpine emerald tarn & wide upper curtain waterfall (Y = 27..46)
        { op: "roundedBox", x0: -8, y0: 43, z0: -16, x1: 6, y1: 46, z1: -4, radius: 1.4, color: "lagoon" },
        { op: "box", x0: -7, y0: 45, z0: -14, x1: 5, y1: 46, z1: -3, color: "aqua", emit: 0.35 },
        { op: "box", x0: -7, y0: 27, z0: -6, x1: 5, y1: 45, z1: -3, color: "lagoon", emit: 0.38 },
        { op: "box", x0: -6, y0: 27, z0: -4, x1: 4, y1: 45, z1: -2, color: "aqua", emit: 0.52 },
        { op: "box", x0: -4, y0: 28, z0: -3, x1: 2, y1: 45, z1: -1, color: "waterBright", emit: 0.64 },
        { op: "box", x0: -6, y0: 44, z0: -4, x1: 4, y1: 46, z1: -1, color: "foam", emit: 0.72 },

        // 3. Mid-cliff cascading rapids terrace (Y = 18..28) stepping forward organically
        { op: "roundedBox", x0: -11, y0: 19, z0: -6, x1: 11, y1: 26, z1: 3, radius: 2.0, color: "graniteDark" },
        { op: "box", x0: -9, y0: 25, z0: -4, x1: 9, y1: 27, z1: 2, color: "lagoon", emit: 0.38 },
        { op: "box", x0: -8, y0: 26, z0: -2, x1: 8, y1: 27, z1: 3, color: "aqua", emit: 0.54 },
        // Asymmetric mossy rock outcrop dividing main thunderous cataract (-X/center) from slender bridal-veil (+X)
        { op: "roundedBox", x0: 2, y0: 12, z0: -1, x1: 6, y1: 28, z1: 4, radius: 1.5, color: "graniteWarm" },
        { op: "sphere", cx: 4, cy: 28, cz: 1.5, rx: 2.5, ry: 1.5, rz: 2.2, color: "mossBright" },

        // 4. Sweeping main lower cataract + asymmetric eastern bridal-veil fall (Y = 2..26)
        // Wide main cataract (-9..+2) with stepped whitewater ribs
        { op: "box", x0: -9, y0: 2, z0: 0, x1: 2, y1: 26, z1: 3, color: "lagoon", emit: 0.4 },
        { op: "box", x0: -8, y0: 2, z0: 2, x1: 1, y1: 26, z1: 4, color: "aqua", emit: 0.56 },
        { op: "box", x0: -6, y0: 2, z0: 3, x1: 0, y1: 25, z1: 5, color: "waterBright", emit: 0.66 },
        { op: "box", x0: -5, y0: 3, z0: 4, x1: -1, y1: 24, z1: 6, color: "foam", emit: 0.76 },
        { op: "box", x0: -8, y0: 24, z0: 2, x1: 1, y1: 27, z1: 5, color: "foam", emit: 0.74 },
        // Slender eastern bridal-veil cascade (+6..+10)
        { op: "box", x0: 6, y0: 2, z0: 0, x1: 10, y1: 25, z1: 3, color: "aqua", emit: 0.5 },
        { op: "box", x0: 7, y0: 2, z0: 2, x1: 9, y1: 25, z1: 4, color: "foam", emit: 0.72 },

        // 5. Crystal turquoise plunge lagoon flush at Y = 0..2 on +Z + rustic timber overlook foot-stones
        { op: "cylinder", axis: "y", cx: 0, y0: 0, y1: 1, cz: 11, radius: 15.2, color: "deepPool" },
        { op: "cylinder", axis: "y", cx: 0, y0: 1, y1: 2, cz: 11, radius: 13.8, color: "lagoon", emit: 0.3 },
        { op: "cylinder", axis: "y", cx: -3.5, y0: 1, y1: 2, cz: 6.5, radius: 5.8, color: "aqua", emit: 0.52 },
        { op: "cylinder", axis: "y", cx: 7.5, y0: 1, y1: 2, cz: 5.5, radius: 3.6, color: "aqua", emit: 0.48 },
        // Foaming whitewater boil rings at cataract impact zones
        { op: "ring", axis: "y", cx: -3.5, y0: 2, y1: 3, cz: 6.0, outerR: 5.2, innerR: 2.4, color: "foam", emit: 0.8 },
        { op: "ring", axis: "y", cx: 7.5, y0: 2, y1: 3, cz: 5.0, outerR: 3.2, innerR: 1.5, color: "foam", emit: 0.76 },
        { op: "ring", axis: "y", cx: 0, y0: 1, y1: 2, cz: 13, outerR: 10.4, innerR: 8.6, color: "waterBright", emit: 0.42 },

        // Natural shoreline boulders, mossy rocks & stepping stones framing the +Z lagoon bank
        { op: "sphere", cx: -15, cy: 2.2, cz: 12, rx: 3.8, ry: 2.4, rz: 3.8, color: "graniteWarm" },
        { op: "sphere", cx: 15, cy: 2.0, cz: 12, rx: 3.8, ry: 2.4, rz: 3.6, color: "granite" },
        { op: "sphere", cx: -11, cy: 1.5, cz: 20, rx: 3.4, ry: 1.8, rz: 2.8, color: "pebble" },
        { op: "sphere", cx: 11, cy: 1.5, cz: 20, rx: 3.2, ry: 1.8, rz: 2.8, color: "pebble" },
        { op: "sphere", cx: -15, cy: 3.8, cz: 12, rx: 2.8, ry: 1.2, rz: 2.6, color: "mossBright" },
        { op: "sphere", cx: 15, cy: 3.6, cz: 12, rx: 2.6, ry: 1.2, rz: 2.6, color: "moss" },
        { op: "sphere", cx: -4, cy: 1.0, cz: 24, rx: 2.5, ry: 1.2, rz: 2.0, color: "graniteLight" },
        { op: "sphere", cx: 4, cy: 1.0, cz: 24, rx: 2.3, ry: 1.1, rz: 1.9, color: "graniteLight" },

        // 6. Visible alpine spruce pines standing proudly on open exterior mossy cliff terraces!
        // West upper terrace spruce (z = -3, completely clear of rear granite cone)
        { op: "cylinder", axis: "y", cx: -18, y0: 30, y1: 36, cz: -3, radius: 1.3, color: "pineTrunk" },
        { op: "cone", cx: -18, y0: 34, y1: 45, cz: -3, rBottom: 5.0, rTop: 0.8, color: "pineDark" },
        { op: "cone", cx: -18, y0: 40, y1: 49, cz: -3, rBottom: 3.8, rTop: 0.5, color: "pineLight" },
        // East mid terrace spruce (z = -2, completely clear of rear granite cone)
        { op: "cylinder", axis: "y", cx: 17, y0: 26, y1: 32, cz: -2, radius: 1.3, color: "pineTrunk" },
        { op: "cone", cx: 17, y0: 30, y1: 40, cz: -2, rBottom: 4.8, rTop: 0.8, color: "pineDark" },
        { op: "cone", cx: 17, y0: 36, y1: 44, cz: -2, rBottom: 3.5, rTop: 0.5, color: "pineLight" },
        // Lower west gorge bluff spruce (z = 5)
        { op: "cylinder", axis: "y", cx: -17, y0: 16, y1: 21, cz: 5, radius: 1.2, color: "pineTrunk" },
        { op: "cone", cx: -17, y0: 19, y1: 29, cz: 5, rBottom: 4.2, rTop: 0.6, color: "pineLight" },
        // Lower east lagoon bank pine (z = 6)
        { op: "cylinder", axis: "y", cx: 17, y0: 14, y1: 19, cz: 6, radius: 1.1, color: "pineTrunk" },
        { op: "cone", cx: 17, y0: 17, y1: 25, cz: 6, rBottom: 3.8, rTop: 0.6, color: "pineDark" },

        // Wildflowers & fern tufts along mossy banks
        {
          op: "voxels",
          list: [
            [-12, 4, 16, "fern"],
            [-11, 4, 17, "blossom", 0.5],
            [12, 4, 16, "fern"],
            [11, 4, 17, "blossom", 0.5],
            [4, 29, 2, "blossom", 0.45],
          ],
        },
      ],
      parts: [
        {
          name: "main-plunge-mist",
          kind: "bob",
          speed: 1.75,
          amp: 0.36,
          phase: 0.4,
          pivot: [-3.5, 5.2, 9.5],
          ops: [
            { op: "sphere", cx: 0, cy: 0, cz: 0, rx: 3.4, ry: 1.4, rz: 2.4, color: "mist", emit: 0.58 },
            { op: "sphere", cx: 2.4, cy: 0.8, cz: 0.8, rx: 2.0, ry: 1.1, rz: 1.6, color: "foam", emit: 0.68 },
          ],
        },
        {
          name: "bridal-veil-mist",
          kind: "bob",
          speed: 1.9,
          amp: 0.32,
          phase: 3.4,
          pivot: [7.5, 4.8, 8.2],
          ops: [
            { op: "sphere", cx: 0, cy: 0, cz: 0, rx: 2.2, ry: 1.2, rz: 1.8, color: "mist", emit: 0.55 },
          ],
        },
      ],
    },
    "Emerald Cliff Waterfall",
  );
}

/**
 * Builds high-craft micro-voxel supply-chain & civic companion vehicles (+Z forward, zero Z-fighting)
 * that connect industrial/civic buildings (mines, firehouses, farms, bakeries) to the city road network.
 */
export function buildCompanionVehicleBlueprint(
  archetype: CompanionVehicleArchetype,
  customName?: string,
  customDescription?: string,
): VoxelBlueprint {
  switch (archetype) {
    case "mining_dump_truck":
      return normalizeAndGroundBlueprint(
        {
          name: customName || "Borealis Heavy Haul Dump Truck",
          description:
            customDescription ||
            "Mining dump truck hauling extracted mineral ore from the quarry toward town.",
          category: "vehicle",
          scaleClass: "medium",
          palette: {
            catYellow: "#f2b629",
            catShade: "#c78d12",
            steelDark: "#353a43",
            steel: "#6e7885",
            chrome: "#d8e2ec",
            tire: "#1e2026",
            hub: "#d99b1e",
            glass: "#b7e6f5",
            oreRock: "#494e59",
            oreCyan: "#5ce6db",
            oreGold: "#ffd24c",
            orePink: "#e66cb8",
            headlight: "#fff2b8",
            taillight: "#ff473d",
            amber: "#ffb32b",
          },
          ops: [
            // Heavy articulated steel chassis & undercarriage (+Z forward)
            { op: "box", x0: -6, y0: 3, z0: -13, x1: 6, y1: 6, z1: 13, color: "steelDark" },
            // Forward radiator grille, heavy steel bumper & lower engine hood
            { op: "roundedBox", x0: -6, y0: 4, z0: 6, x1: 6, y1: 10, z1: 14, radius: 1.4, color: "catYellow" },
            { op: "box", x0: -4, y0: 5, z0: 13, x1: 4, y1: 9, z1: 14, color: "steelDark" },
            { op: "box", x0: -3, y0: 6, z0: 13, x1: 3, y1: 8, z1: 14, color: "chrome" },
            { op: "box", x0: -7, y0: 3, z0: 13, x1: 7, y1: 5, z1: 15, color: "steel" },
            // Offset operator cab & panoramic windshield (+Z) + asymmetric vertical exhaust stack on -X
            { op: "roundedBox", x0: -5, y0: 9, z0: 4, x1: 5, y1: 14, z1: 11, radius: 1.2, color: "catYellow" },
            { op: "box", x0: -4, y0: 10, z0: 10, x1: 4, y1: 13, z1: 11, color: "glass" },
            { op: "box", x0: -5, y0: 10, z0: 6, x1: 5, y1: 13, z1: 9, color: "glass" },
            { op: "cylinder", axis: "y", cx: -6, y0: 6, y1: 16, cz: 4, radius: 0.9, color: "steel" },
            // Access boarding ladder on +X side
            { op: "box", x0: 6, y0: 4, z0: 11, x1: 7, y1: 10, z1: 12, color: "chrome" },
            // Ribbed dump-bed rock-shield visor overhanging the cab roof
            { op: "box", x0: -7, y0: 14, z0: 3, x1: 7, y1: 15, z1: 11, color: "catYellow" },
            // Massive V-ribbed quarry dump body (-Z..+4)
            { op: "box", x0: -7, y0: 6, z0: -14, x1: 7, y1: 13, z1: 5, color: "catYellow" },
            { op: "box", x0: -8, y0: 8, z0: -12, x1: -7, y1: 12, z1: 3, color: "catShade", mirrorX: true },
            { op: "clear", x0: -5, y0: 8, z0: -12, x1: 5, y1: 13, z1: 3 },
            // Twin hydraulic lift cylinders between cab and dump bed
            { op: "cylinder", axis: "y", cx: 3, y0: 6, y1: 13, cz: 4, radius: 0.9, color: "chrome", mirrorX: true },
            // Heaped rare-earth mineral ore & glowing crystals inside the dump bed
            { op: "sphere", cx: 0, cy: 11, cz: -5, rx: 4.8, ry: 3.4, rz: 6.5, color: "oreRock" },
            { op: "sphere", cx: -2, cy: 13, cz: -2, rx: 2.4, ry: 2.0, rz: 2.4, color: "oreCyan", emit: 1.25 },
            { op: "sphere", cx: 2.2, cy: 13, cz: -7, rx: 2.2, ry: 1.9, rz: 2.2, color: "oreGold", emit: 1.15 },
            { op: "sphere", cx: -1.2, cy: 12.5, cz: -9, rx: 1.9, ry: 1.8, rz: 1.9, color: "orePink", emit: 1.15 },
            // Carve wide off-highway wheel arches so giant tires spin with zero contact
            { op: "clear", x0: 4, y0: 0, z0: 5, x1: 9, y1: 8, z1: 13, mirrorX: true },
            { op: "clear", x0: 4, y0: 0, z0: -12, x1: 9, y1: 8, z1: -4, mirrorX: true },
            // Headlights, rear hazard lights & rooftop amber strobe
            { op: "box", x0: 4, y0: 6, z0: 13, x1: 6, y1: 8, z1: 14, color: "headlight", emit: 1.4, mirrorX: true },
            { op: "box", x0: 4, y0: 6, z0: -14, x1: 6, y1: 8, z1: -13, color: "taillight", emit: 1.2, mirrorX: true },
            { op: "box", x0: -1, y0: 15, z0: 8, x1: 1, y1: 16, z1: 10, color: "amber", emit: 1.35 },
          ],
          parts: [
            {
              name: "front-quarry-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 3.5, 9],
              ops: [
                { op: "cylinder", axis: "x", x0: 5, x1: 8, cy: 0, cz: 0, radius: 3.2, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 7, x1: 8, cy: 0, cz: 0, radius: 1.5, color: "hub", mirrorX: true },
              ],
            },
            {
              name: "rear-quarry-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 3.5, -8],
              ops: [
                { op: "cylinder", axis: "x", x0: 5, x1: 8, cy: 0, cz: 0, radius: 3.2, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 7, x1: 8, cy: 0, cz: 0, radius: 1.5, color: "hub", mirrorX: true },
              ],
            },
          ],
        },
        customName || "Borealis Heavy Haul Dump Truck",
      );

    case "fire_engine":
      return normalizeAndGroundBlueprint(
        {
          name: customName || "Beacon Hill Pumper Engine",
          description:
            customDescription ||
            "Municipal fire engine patrolling neighborhood avenues from the firehouse.",
          category: "vehicle",
          scaleClass: "medium",
          palette: {
            fireRed: "#dc3b32",
            fireDark: "#a6241d",
            stripeWhite: "#faf8f2",
            chrome: "#dde6f0",
            shutter: "#b5c0cc",
            brass: "#eebc44",
            tire: "#1f2127",
            glass: "#b8e6f5",
            sirenRed: "#ff3b30",
            sirenBlue: "#4da6ff",
            headlight: "#fff3bd",
          },
          ops: [
            { op: "box", x0: -6, y0: 2, z0: -13, x1: 6, y1: 5, z1: 13, color: "fireDark" },
            // Forward crew cab (+Z)
            { op: "roundedBox", x0: -6, y0: 4, z0: 3, x1: 6, y1: 12, z1: 13, radius: 1.5, color: "fireRed" },
            { op: "box", x0: -6, y0: 6, z0: -13, x1: 6, y1: 8, z1: 13, color: "stripeWhite" },
            // Rear pump body & silver rollup equipment lockers
            { op: "roundedBox", x0: -6, y0: 4, z0: -13, x1: 6, y1: 11, z1: 3, radius: 1.2, color: "fireRed" },
            { op: "box", x0: 5, y0: 5, z0: -10, x1: 6, y1: 10, z1: -6, color: "shutter", mirrorX: true },
            { op: "box", x0: 5, y0: 5, z0: -4, x1: 6, y1: 10, z1: 0, color: "shutter", mirrorX: true },
            // Chrome front bumper, grille & brass hose reel
            { op: "box", x0: -6, y0: 2, z0: 13, x1: 6, y1: 4, z1: 15, color: "chrome" },
            { op: "box", x0: -4, y0: 4, z0: 12, x1: 4, y1: 7, z1: 14, color: "chrome" },
            { op: "cylinder", axis: "x", x0: -4, x1: 4, cy: 11, cz: 0, radius: 1.4, color: "brass" },
            // Rooftop aluminum extension ladder
            { op: "box", x0: -3, y0: 11, z0: -12, x1: -2, y1: 13, z1: 5, color: "chrome", mirrorX: true },
            { op: "box", x0: -3, y0: 12, z0: -10, x1: 3, y1: 13, z1: -9, color: "chrome" },
            { op: "box", x0: -3, y0: 12, z0: -6, x1: 3, y1: 13, z1: -5, color: "chrome" },
            { op: "box", x0: -3, y0: 12, z0: -2, x1: 3, y1: 13, z1: -1, color: "chrome" },
            { op: "box", x0: -3, y0: 12, z0: 2, x1: 3, y1: 13, z1: 3, color: "chrome" },
            // Cab windshield & side windows
            { op: "box", x0: -5, y0: 8, z0: 12, x1: 5, y1: 11, z1: 13, color: "glass" },
            { op: "box", x0: -6, y0: 8, z0: 5, x1: 6, y1: 11, z1: 10, color: "glass" },
            // Wheel wells
            { op: "clear", x0: 4, y0: 0, z0: 5, x1: 8, y1: 6, z1: 12, mirrorX: true },
            { op: "clear", x0: 4, y0: 0, z0: -11, x1: 8, y1: 6, z1: -4, mirrorX: true },
            // Emergency lightbar & headlights
            { op: "box", x0: -5, y0: 12, z0: 9, x1: -1, y1: 13, z1: 11, color: "sirenRed", emit: 1.5 },
            { op: "box", x0: 1, y0: 12, z0: 9, x1: 5, y1: 13, z1: 11, color: "sirenBlue", emit: 1.5 },
            { op: "box", x0: 4, y0: 4, z0: 13, x1: 5, y1: 6, z1: 14, color: "headlight", emit: 1.4, mirrorX: true },
            { op: "box", x0: 4, y0: 4, z0: -14, x1: 5, y1: 6, z1: -13, color: "sirenRed", emit: 1.2, mirrorX: true },
          ],
          parts: [
            {
              name: "front-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 3, 8.5],
              ops: [
                { op: "cylinder", axis: "x", x0: 5, x1: 7, cy: 0, cz: 0, radius: 2.6, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 6, x1: 7, cy: 0, cz: 0, radius: 1.3, color: "chrome", mirrorX: true },
              ],
            },
            {
              name: "rear-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 3, -7.5],
              ops: [
                { op: "cylinder", axis: "x", x0: 5, x1: 7, cy: 0, cz: 0, radius: 2.6, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 6, x1: 7, cy: 0, cz: 0, radius: 1.3, color: "chrome", mirrorX: true },
              ],
            },
          ],
        },
        customName || "Beacon Hill Pumper Engine",
      );

    case "farm_tractor":
      return normalizeAndGroundBlueprint(
        {
          name: customName || "Cloverfield Harvest Tractor",
          description:
            customDescription ||
            "Utility tractor hauling farm supplies and gear along the outer country lanes.",
          category: "vehicle",
          scaleClass: "small",
          palette: {
            tractorGreen: "#3c994c",
            greenDark: "#296e35",
            goldWheel: "#f2c138",
            wood: "#c99256",
            woodDark: "#8c5c32",
            tire: "#202229",
            steel: "#7a8594",
            headlight: "#fff1b5",
          },
          ops: [
            { op: "roundedBox", x0: -4, y0: 3, z0: 0, x1: 4, y1: 9, z1: 11, radius: 1.3, color: "tractorGreen" },
            { op: "box", x0: -4, y0: 3, z0: -11, x1: 4, y1: 6, z1: 1, color: "woodDark" },
            { op: "box", x0: -5, y0: 5, z0: -11, x1: 5, y1: 9, z1: -2, color: "wood" },
            { op: "pillars", x0: -4, y0: 8, z0: -2, x1: 4, y1: 14, z1: 4, color: "greenDark" },
            { op: "box", x0: -5, y0: 14, z0: -3, x1: 5, y1: 15, z1: 5, color: "tractorGreen" },
            { op: "cylinder", axis: "y", cx: -3, y0: 8, y1: 15, cz: 8, radius: 0.8, color: "steel" },
            { op: "clear", x0: 3, y0: 0, z0: 5, x1: 7, y1: 6, z1: 11, mirrorX: true },
            { op: "clear", x0: 3, y0: 0, z0: -7, x1: 8, y1: 8, z1: 2, mirrorX: true },
            { op: "box", x0: 3, y0: 6, z0: 10, x1: 4, y1: 8, z1: 12, color: "headlight", emit: 1.3, mirrorX: true },
          ],
          parts: [
            {
              name: "front-wheels",
              kind: "wheel",
              speed: 1.2,
              pivot: [0, 2.5, 8],
              ops: [
                { op: "cylinder", axis: "x", x0: 4, x1: 6, cy: 0, cz: 0, radius: 2.2, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 5, x1: 6, cy: 0, cz: 0, radius: 1.1, color: "goldWheel", mirrorX: true },
              ],
            },
            {
              name: "rear-drive-wheels",
              kind: "wheel",
              speed: 0.9,
              pivot: [0, 3.5, -2.5],
              ops: [
                { op: "cylinder", axis: "x", x0: 4, x1: 7, cy: 0, cz: 0, radius: 3.3, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 6, x1: 7, cy: 0, cz: 0, radius: 1.6, color: "goldWheel", mirrorX: true },
              ],
            },
          ],
        },
        customName || "Cloverfield Harvest Tractor",
      );

    case "service_shuttle":
      return normalizeAndGroundBlueprint(
        {
          name: customName || "Meadow Electric Shuttle",
          description:
            customDescription ||
            "Electric passenger shuttle linking outer district landmarks with town transit.",
          category: "vehicle",
          scaleClass: "medium",
          palette: {
            skyBody: "#54a2de",
            creamTop: "#faf4e6",
            trimDark: "#262b34",
            glass: "#bfe9f7",
            solar: "#2b4d7e",
            tire: "#20232a",
            chrome: "#dce5ef",
            headlight: "#fff2ba",
            taillight: "#ff4d42",
          },
          ops: [
            { op: "roundedBox", x0: -5, y0: 2, z0: -10, x1: 5, y1: 11, z1: 10, radius: 2.0, color: "skyBody" },
            { op: "roundedBox", x0: -5, y0: 7, z0: -9, x1: 5, y1: 12, z1: 9, radius: 1.6, color: "creamTop" },
            { op: "box", x0: -3, y0: 12, z0: -6, x1: 3, y1: 13, z1: 6, color: "solar" },
            { op: "box", x0: -4, y0: 6, z0: 9, x1: 4, y1: 10, z1: 10, color: "glass" },
            { op: "box", x0: -5, y0: 6, z0: -7, x1: 5, y1: 10, z1: 7, color: "glass" },
            { op: "clear", x0: 3, y0: 0, z0: 4, x1: 7, y1: 6, z1: 10, mirrorX: true },
            { op: "clear", x0: 3, y0: 0, z0: -10, x1: 7, y1: 6, z1: -4, mirrorX: true },
            { op: "box", x0: 3, y0: 4, z0: 9, x1: 4, y1: 6, z1: 11, color: "headlight", emit: 1.3, mirrorX: true },
            { op: "box", x0: 3, y0: 4, z0: -11, x1: 4, y1: 6, z1: -9, color: "taillight", emit: 1.1, mirrorX: true },
          ],
          parts: [
            {
              name: "front-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 2.5, 7],
              ops: [
                { op: "cylinder", axis: "x", x0: 4, x1: 6, cy: 0, cz: 0, radius: 2.3, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 5, x1: 6, cy: 0, cz: 0, radius: 1.1, color: "chrome", mirrorX: true },
              ],
            },
            {
              name: "rear-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 2.5, -7],
              ops: [
                { op: "cylinder", axis: "x", x0: 4, x1: 6, cy: 0, cz: 0, radius: 2.3, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 5, x1: 6, cy: 0, cz: 0, radius: 1.1, color: "chrome", mirrorX: true },
              ],
            },
          ],
        },
        customName || "Meadow Electric Shuttle",
      );

    case "cargo_delivery_van":
    default:
      return normalizeAndGroundBlueprint(
        {
          name: customName || "Island Provision Delivery Van",
          description:
            customDescription ||
            "Neighborhood delivery van ferrying local goods and food between shops and homes.",
          category: "vehicle",
          scaleClass: "medium",
          palette: {
            cream: "#faf3e3",
            tealBand: "#3c9d92",
            woodRack: "#b8824c",
            crate: "#deb071",
            glass: "#bce7f5",
            tire: "#20232a",
            chrome: "#dae3ed",
            headlight: "#fff1b8",
            taillight: "#ff4a3f",
          },
          ops: [
            { op: "roundedBox", x0: -5, y0: 2, z0: -11, x1: 5, y1: 11, z1: 7, radius: 1.5, color: "cream" },
            { op: "roundedBox", x0: -5, y0: 2, z0: 5, x1: 5, y1: 9, z1: 12, radius: 1.5, color: "cream" },
            { op: "box", x0: -5, y0: 4, z0: -11, x1: 5, y1: 6, z1: 12, color: "tealBand" },
            { op: "box", x0: -4, y0: 6, z0: 7, x1: 4, y1: 10, z1: 9, color: "glass" },
            { op: "box", x0: -4, y0: 11, z0: -8, x1: 4, y1: 12, z1: 2, color: "woodRack" },
            { op: "box", x0: -3, y0: 12, z0: -6, x1: 2, y1: 14, z1: 0, color: "crate" },
            { op: "clear", x0: 3, y0: 0, z0: 5, x1: 7, y1: 6, z1: 11, mirrorX: true },
            { op: "clear", x0: 3, y0: 0, z0: -10, x1: 7, y1: 6, z1: -4, mirrorX: true },
            { op: "box", x0: 3, y0: 4, z0: 11, x1: 4, y1: 6, z1: 13, color: "headlight", emit: 1.3, mirrorX: true },
            { op: "box", x0: 3, y0: 4, z0: -12, x1: 4, y1: 6, z1: -10, color: "taillight", emit: 1.1, mirrorX: true },
          ],
          parts: [
            {
              name: "front-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 2.5, 8],
              ops: [
                { op: "cylinder", axis: "x", x0: 4, x1: 6, cy: 0, cz: 0, radius: 2.3, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 5, x1: 6, cy: 0, cz: 0, radius: 1.1, color: "chrome", mirrorX: true },
              ],
            },
            {
              name: "rear-axle",
              kind: "wheel",
              speed: 1.0,
              pivot: [0, 2.5, -7],
              ops: [
                { op: "cylinder", axis: "x", x0: 4, x1: 6, cy: 0, cz: 0, radius: 2.3, color: "tire", mirrorX: true },
                { op: "cylinder", axis: "x", x0: 5, x1: 6, cy: 0, cz: 0, radius: 1.1, color: "chrome", mirrorX: true },
              ],
            },
          ],
        },
        customName || "Island Provision Delivery Van",
      );
  }
}

/**
 * Sleek architectural single high-rise tower (`"Modernist Glass Tower"`) sitting flush at Y = 0
 * with a double-height recessed glass lobby colonnade facing `+Z`, curtain-wall steel mullions,
 * architectural upper setback, rooftop mechanical penthouse, and rotating radar/beacon mast.
 */
export function buildSingleModernistTowerBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Modernist Glass Tower",
      description:
        "Downtown office tower anchoring the city's commercial district.",
      category: "building",
      scaleClass: "large",
      palette: {
        steelDark: "#2d343d",
        steel: "#56616e",
        steelBright: "#9aa6b4",
        glassDeep: "#397296",
        glassCyan: "#6cb8db",
        glassWarm: "#ffe4a3",
        lobbyStone: "#cfd5d9",
        lobbyGold: "#f7ce68",
        trimWhite: "#eef3f7",
        beaconRed: "#ff4f45",
      },
      ops: [
        // 1. Flush ground-floor structural core & recessed +Z street-front colonnade (Y = 0..8, zero plinth!)
        { op: "box", x0: -9, y0: 0, z0: -8, x1: 9, y1: 8, z1: 5, color: "steelDark" },
        { op: "box", x0: -8, y0: 0, z0: 4, x1: 8, y1: 7, z1: 7, color: "glassWarm", emit: 0.72 },
        // Structural perimeter columns along the street colonnade (+Z = z=8)
        { op: "pillars", x0: -9, y0: 0, z0: -8, x1: 9, y1: 8, z1: 8, color: "steelBright" },
        { op: "box", x0: -5, y0: 0, z0: 6, x1: -4, y1: 8, z1: 8, color: "steelBright", mirrorX: true },
        // Revolving/glass entrance canopy overhang facing +Z
        { op: "box", x0: -6, y0: 7, z0: 6, x1: 6, y1: 8, z1: 10, color: "trimWhite" },
        { op: "arch", cx: 0, y0: 0, cz: 7, halfSpan: 3, height: 6, depth: 1, axis: "z", color: "lobbyStone" },

        // 2. Main curtain-wall office shaft (Y = 8..38)
        { op: "box", x0: -9, y0: 8, z0: -8, x1: 9, y1: 38, z1: 8, color: "glassDeep" },
        { op: "pillars", x0: -9, y0: 8, z0: -8, x1: 9, y1: 38, z1: 8, color: "steelBright" },
        // Vertical steel mullions on front/back and side facades
        { op: "box", x0: 3, y0: 8, z0: -8, x1: 4, y1: 38, z1: 8, color: "steel", mirrorX: true },
        { op: "box", x0: -9, y0: 8, z0: 2, x1: 9, y1: 38, z1: 3, color: "steel" },
        { op: "box", x0: -9, y0: 8, z0: -3, x1: 9, y1: 38, z1: -2, color: "steel" },
        // Horizontal spandrel floor bands + sunlit cyan/warm lit office windows
        { op: "box", x0: -9, y0: 14, z0: -8, x1: 9, y1: 15, z1: 8, color: "steelDark" },
        { op: "box", x0: -9, y0: 20, z0: -8, x1: 9, y1: 21, z1: 8, color: "steelDark" },
        { op: "box", x0: -9, y0: 26, z0: -8, x1: 9, y1: 27, z1: 8, color: "steelDark" },
        { op: "box", x0: -9, y0: 32, z0: -8, x1: 9, y1: 33, z1: 8, color: "steelDark" },
        { op: "box", x0: -9, y0: 37, z0: -8, x1: 9, y1: 39, z1: 8, color: "trimWhite" },
        // Warm illuminated sky-floor bands
        { op: "box", x0: -8, y0: 16, z0: -7, x1: 8, y1: 18, z1: 8, color: "glassCyan", emit: 0.35 },
        { op: "box", x0: -8, y0: 28, z0: -7, x1: 8, y1: 30, z1: 8, color: "glassWarm", emit: 0.55 },

        // 3. Upper architectural setback crown (Y = 39..49)
        { op: "box", x0: -7, y0: 39, z0: -6, x1: 7, y1: 48, z1: 6, color: "glassCyan", emit: 0.32 },
        { op: "pillars", x0: -7, y0: 39, z0: -6, x1: 7, y1: 48, z1: 6, color: "steelBright" },
        { op: "box", x0: -7, y0: 43, z0: -6, x1: 7, y1: 44, z1: 6, color: "steelDark" },
        { op: "box", x0: -7, y0: 48, z0: -6, x1: 7, y1: 50, z1: 6, color: "trimWhite" },

        // 4. Rooftop mechanical penthouse & spire base (Y = 50..56)
        { op: "roundedBox", x0: -4, y0: 50, z0: -4, x1: 4, y1: 54, z1: 4, radius: 1.2, color: "steelDark" },
        { op: "cylinder", axis: "y", cx: 0, y0: 54, y1: 58, cz: 0, radius: 1.1, color: "steelBright" },
      ],
      parts: [
        {
          name: "rooftop-comms-array",
          kind: "spinY",
          speed: 1.1,
          pivot: [0, 59, 0],
          ops: [
            { op: "box", x0: -3, y0: 0, z0: -0.5, x1: 3, y1: 1, z1: 0.5, color: "trimWhite" },
            { op: "sphere", cx: 0, cy: 1.5, cz: 0, rx: 1.1, ry: 1.1, rz: 1.1, color: "beaconRed", emit: 1.4 },
          ],
        },
      ],
    },
    "Modernist Glass Tower",
  );
}

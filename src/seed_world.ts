import type {
  WorldCreation,
  WorldPath,
  WorldProp,
  WorldStateSnapshot,
  WorldTerrainZone,
  WorldVillager,
} from "./types";
import { OUTER_RING_ROAD_POINTS } from "./voxel_audit";
import { normalizeAndGroundBlueprint } from "./voxel_dsl";

export function buildSeedWorld(): Omit<WorldStateSnapshot, "myCreationId"> {
  const now = Date.now();

  // 1. Sunnyvale School Bus — iconic yellow micro-voxel bus with curved roof, recessed windows,
  // chrome bumpers, headlights/taillights, stop sign arm, and 2 rolling wheel axles.
  const busBlueprint = normalizeAndGroundBlueprint({
    name: "Sunnyvale School Bus",
    description: "Town school bus picking up and dropping off commuters around the central loop.",
    category: "vehicle",
    scaleClass: "medium",
    palette: {
      busYellow: "#f5b82e",
      busShade: "#dc9e1d",
      roofCream: "#fcf7e8",
      trimBlack: "#22252b",
      bumper: "#d6e0ea",
      glass: "#b8e6f5",
      glassDark: "#7ab5cc",
      tire: "#1f2127",
      stopRed: "#e0483e",
      headlight: "#fff0b3",
      taillight: "#ff473d",
      amber: "#ffb838",
    },
    ops: [
      // Chassis & lower skirt
      { op: "box", x0: -6, y0: 2, z0: -13, x1: 6, y1: 5, z1: 13, color: "busShade" },
      // Main passenger cabin + rounded roof
      { op: "roundedBox", x0: -6, y0: 4, z0: -13, x1: 6, y1: 12, z1: 9, radius: 1.8, color: "busYellow" },
      { op: "roundedBox", x0: -5, y0: 11, z0: -12, x1: 5, y1: 13, z1: 8, radius: 1.4, color: "roofCream" },
      // Front engine hood (+Z is front)
      { op: "roundedBox", x0: -5, y0: 3, z0: 8, x1: 5, y1: 8, z1: 14, radius: 1.5, color: "busYellow" },
      //Front grille & chrome bumpers
      { op: "box", x0: -4, y0: 4, z0: 13, x1: 4, y1: 7, z1: 14, color: "trimBlack" },
      { op: "box", x0: -3, y0: 5, z0: 13, x1: 3, y1: 6, z1: 14, color: "bumper" },
      { op: "box", x0: -6, y0: 2, z0: 13, x1: 6, y1: 3, z1: 15, color: "bumper" },
      { op: "box", x0: -6, y0: 2, z0: -14, x1: 6, y1: 3, z1: -13, color: "bumper" },
      // Black rub-rails along sides (above wheel arches)
      { op: "box", x0: 6, y0: 6, z0: -13, x1: 7, y1: 7, z1: 8, color: "trimBlack", mirrorX: true },
      // Panoramic windshield & rear window
      { op: "box", x0: -5, y0: 7, z0: 8, x1: 5, y1: 11, z1: 9, color: "glass" },
      { op: "box", x0: 0, y0: 7, z0: 8, x1: 1, y1: 11, z1: 9, color: "trimBlack" },
      { op: "box", x0: -4, y0: 7, z0: -13, x1: 4, y1: 10, z1: -12, color: "glassDark" },
      // 5 Side window bays separated by mullions
      { op: "box", x0: -6, y0: 7, z0: -10, x1: 6, y1: 10, z1: -8, color: "glass" },
      { op: "box", x0: -6, y0: 7, z0: -6, x1: 6, y1: 10, z1: -4, color: "glass" },
      { op: "box", x0: -6, y0: 7, z0: -2, x1: 6, y1: 10, z1: 0, color: "glass" },
      { op: "box", x0: -6, y0: 7, z0: 2, x1: 6, y1: 10, z1: 4, color: "glass" },
      { op: "box", x0: -6, y0: 7, z0: 5, x1: 6, y1: 10, z1: 7, color: "glass" },
      // Folding passenger boarding door on starboard side (-X / +X curb side)
      { op: "box", x0: 5, y0: 3, z0: 5, x1: 6, y1: 10, z1: 8, color: "trimBlack" },
      { op: "box", x0: 5, y0: 4, z0: 6, x1: 6, y1: 9, z1: 7, color: "glass" },
      // Carve clean wheel arches after side details so rolling tires have full clearance
      { op: "clear", x0: 4, y0: 0, z0: 6, x1: 8, y1: 6, z1: 13, mirrorX: true },
      { op: "clear", x0: 4, y0: 0, z0: -12, x1: 8, y1: 6, z1: -5, mirrorX: true },
      // Side mirrors & red octagon stop sign on driver side
      { op: "box", x0: 6, y0: 8, z0: 9, x1: 8, y1: 10, z1: 10, color: "trimBlack", mirrorX: true },
      { op: "box", x0: -7, y0: 6, z0: 4, x1: -6, y1: 8, z1: 6, color: "stopRed" },
      // Headlights, taillights & roof safety flashers
      { op: "box", x0: 4, y0: 4, z0: 13, x1: 5, y1: 6, z1: 14, color: "headlight", emit: 1.4, mirrorX: true },
      { op: "box", x0: 4, y0: 4, z0: -13, x1: 5, y1: 6, z1: -12, color: "taillight", emit: 1.2, mirrorX: true },
      { op: "box", x0: 3, y0: 12, z0: 7, x1: 4, y1: 13, z1: 8, color: "amber", emit: 1.1, mirrorX: true },
      { op: "box", x0: 3, y0: 12, z0: -12, x1: 4, y1: 13, z1: -11, color: "amber", emit: 1.0, mirrorX: true },
      // Roof escape hatch
      { op: "box", x0: -2, y0: 13, z0: -3, x1: 2, y1: 14, z1: 1, color: "roofCream" },
    ],
    parts: [
      {
        name: "front-axle",
        kind: "wheel",
        speed: 1.0,
        pivot: [0, 3, 9.5],
        ops: [
          { op: "cylinder", axis: "x", x0: 5, x1: 7, cy: 0, cz: 0, radius: 2.6, color: "tire", mirrorX: true },
          { op: "cylinder", axis: "x", x0: 6, x1: 7, cy: 0, cz: 0, radius: 1.3, color: "bumper", mirrorX: true },
        ],
      },
      {
        name: "rear-axle",
        kind: "wheel",
        speed: 1.0,
        pivot: [0, 3, -8.5],
        ops: [
          { op: "cylinder", axis: "x", x0: 5, x1: 7, cy: 0, cz: 0, radius: 2.6, color: "tire", mirrorX: true },
          { op: "cylinder", axis: "x", x0: 6, x1: 7, cy: 0, cz: 0, radius: 1.3, color: "bumper", mirrorX: true },
        ],
      },
    ],
  });

  // 2. Hearthstone Windmill Bakery
  const bakeryBlueprint = normalizeAndGroundBlueprint({
    name: "Hearthstone Windmill Bakery",
    description: "Neighborhood windmill bakery grinding grain and baking fresh bread for the west village.",
    category: "building",
    scaleClass: "large",
    palette: {
      stone: "#dcd4c4",
      stoneDark: "#b5ad9e",
      plaster: "#f7efe0",
      timber: "#7d5130",
      sailCloth: "#fcf8ee",
      terracotta: "#cc6c47",
      brick: "#b85c40",
      awningRed: "#df5246",
      hearth: "#ff9b3d",
      windowGlow: "#ffe49e",
      gold: "#f0c24c",
      leaf: "#62b558",
    },
    ops: [
      // Main bakery cottage body grounded directly at Y=0 (set slightly back so overhead windmill sails spin cleanly)
      { op: "hollowBox", x0: -9, y0: 2, z0: -8, x1: 9, y1: 12, z1: 6, wall: 1, color: "plaster", trim: "timber" },
      { op: "roofGable", x0: -10, yBase: 12, z0: -9, x1: 10, z1: 7, rise: 4, axis: "x", color: "terracotta", trim: "timber" },
      // Cylindrical windmill tower rising cleanly above cottage + timber sail drive-shaft stub
      { op: "cylinder", axis: "y", cx: 0, y0: 12, y1: 28, cz: 0, radius: 5.0, color: "plaster" },
      { op: "ring", axis: "y", cx: 0, y0: 20, y1: 21, cz: 0, outerR: 5.4, innerR: 4.0, color: "timber" },
      { op: "dome", cx: 0, yBase: 28, cz: 0, radius: 5.2, color: "terracotta" },
      { op: "sphere", cx: 0, cy: 34, cz: 0, rx: 1.2, ry: 1.2, rz: 1.2, color: "gold" },
      { op: "cylinder", axis: "z", cx: 0, cy: 25, z0: 3, z1: 7, radius: 1.2, color: "timber" },
      // Brick bread oven + chimney on left (-X)
      { op: "box", x0: -11, y0: 2, z0: -5, x1: -8, y1: 10, z1: 2, color: "brick" },
      { op: "box", x0: -10, y0: 10, z0: -3, x1: -8, y1: 21, z1: 0, color: "brick" },
      { op: "box", x0: -11, y0: 3, z0: -2, x1: -10, y1: 6, z1: 0, color: "hearth", emit: 1.45 },
      // Front door arch & glowing bakery windows
      { op: "arch", cx: 0, y0: 2, cz: 5, halfSpan: 2, height: 6, depth: 2, axis: "z", color: "timber" },
      { op: "box", x0: -1, y0: 2, z0: 5, x1: 1, y1: 7, z1: 6, color: "timber" },
      { op: "box", x0: 4, y0: 5, z0: 5, x1: 7, y1: 9, z1: 6, color: "windowGlow", emit: 1.05, mirrorX: true },
      // Flowerboxes under front windows
      { op: "box", x0: 4, y0: 4, z0: 6, x1: 7, y1: 5, z1: 7, color: "timber", mirrorX: true },
      { op: "box", x0: 4, y0: 5, z0: 6, x1: 7, y1: 6, z1: 7, color: "leaf", mirrorX: true },
      // Striped red & cream bakery awning over front entrance
      { op: "box", x0: -8, y0: 9, z0: 6, x1: 8, y1: 10, z1: 9, color: "awningRed" },
      { op: "box", x0: -6, y0: 9, z0: 6, x1: -4, y1: 10, z1: 9, color: "sailCloth", mirrorX: true },
      { op: "box", x0: -1, y0: 9, z0: 6, x1: 1, y1: 10, z1: 9, color: "sailCloth" },
    ],
    parts: [
      {
        name: "windmill-sails",
        kind: "spinZ",
        speed: 0.65,
        pivot: [0, 25, 8],
        ops: [
          { op: "cylinder", axis: "z", cx: 0, cy: 0, z0: 0, z1: 2, radius: 1.5, color: "timber" },
          // Vertical & horizontal sail spars (100% clear of cottage roof, awning, and tower)
          { op: "box", x0: -1, y0: -11, z0: 0, x1: 1, y1: 11, z1: 1, color: "timber" },
          { op: "box", x0: -11, y0: -1, z0: 0, x1: 11, y1: 1, z1: 1, color: "timber" },
          // Four woven canvas sails
          { op: "box", x0: 1, y0: 3, z0: 1, x1: 4, y1: 10, z1: 2, color: "sailCloth" },
          { op: "box", x0: -4, y0: -10, z0: 1, x1: -1, y1: -3, z1: 2, color: "sailCloth" },
          { op: "box", x0: 3, y0: -4, z0: 1, x1: 10, y1: -1, z1: 2, color: "sailCloth" },
          { op: "box", x0: -10, y0: 1, z0: 1, x1: -3, y1: 4, z1: 2, color: "sailCloth" },
        ],
      },
    ],
  });

  // 3. Clocktower Village Station
  const clocktowerBlueprint = normalizeAndGroundBlueprint({
    name: "Clocktower Village Station",
    description: "Central transit station and town clock where neighborhood bus and shuttle routes meet.",
    category: "building",
    scaleClass: "large",
    palette: {
      limestone: "#ece3cf",
      stoneShade: "#cbbfa8",
      brick: "#c46d4e",
      copper: "#58b09c",
      copperDark: "#388070",
      slate: "#454c59",
      timber: "#7a4e2d",
      gold: "#f5c84c",
      dialGlow: "#fff4c2",
      iron: "#2b2f36",
    },
    ops: [
      // Station hall grounded flush on the meadow
      { op: "hollowBox", x0: -9, y0: 2, z0: -6, x1: 9, y1: 12, z1: 6, wall: 1, color: "limestone", trim: "brick" },
      { op: "roofGable", x0: -10, yBase: 12, z0: -7, x1: 10, z1: 7, rise: 4, axis: "x", color: "slate", trim: "limestone" },
      // Front timber colonnade porch
      { op: "pillars", x0: -8, y0: 2, z0: 6, x1: 8, y1: 9, z1: 9, color: "timber" },
      { op: "box", x0: -9, y0: 9, z0: 5, x1: 9, y1: 10, z1: 10, color: "copperDark" },
      // Central clocktower shaft
      { op: "hollowBox", x0: -4, y0: 12, z0: -4, x1: 4, y1: 27, z1: 4, wall: 1, color: "brick", trim: "limestone" },
      // Open belfry arches
      { op: "clear", x0: -2, y0: 22, z0: -4, x1: 2, y1: 26, z1: 4 },
      { op: "clear", x0: -4, y0: 22, z0: -2, x1: 4, y1: 26, z1: 2 },
      // Glowing clock faces (front & back)
      { op: "cylinder", axis: "z", cx: 0, cy: 19, z0: -5, z1: 5, radius: 2.5, color: "dialGlow", emit: 1.2 },
      { op: "box", x0: 0, y0: 19, z0: 4, x1: 1, y1: 21, z1: 6, color: "iron" },
      { op: "box", x0: 0, y0: 19, z0: 4, x1: 2, y1: 20, z1: 6, color: "iron" },
      // Patina copper spire roof
      { op: "roofPyramid", x0: -5, yBase: 27, z0: -5, x1: 5, z1: 5, color: "copper", trim: "gold" },
      { op: "cone", cx: 0, y0: 31, y1: 36, cz: 0, rBottom: 2.2, rTop: 0.5, color: "copper" },
      // Glowing station windows
      { op: "box", x0: 4, y0: 4, z0: 5, x1: 7, y1: 9, z1: 6, color: "dialGlow", emit: 0.95, mirrorX: true },
    ],
    parts: [
      {
        name: "weathervane",
        kind: "spinY",
        speed: 0.8,
        pivot: [0, 37, 0],
        ops: [
          { op: "box", x0: 0, y0: 0, z0: 0, x1: 1, y1: 3, z1: 1, color: "gold" },
          { op: "box", x0: -3, y0: 2, z0: 0, x1: 3, y1: 3, z1: 1, color: "gold" },
        ],
      },
      {
        name: "belfry-bell",
        kind: "swingZ",
        speed: 1.8,
        amp: 0.35,
        pivot: [0, 25, 0],
        ops: [
          { op: "cone", cx: 0, y0: -3, y1: 0, cz: 0, rBottom: 1.6, rTop: 0.6, color: "gold", emit: 0.4 },
        ],
      },
    ],
  });

  // 4. Matcha Corner Bookshop
  const bookshopBlueprint = normalizeAndGroundBlueprint({
    name: "Matcha Corner Bookshop",
    description: "Corner bookshop and cafe where townsfolk stop to browse books over tea.",
    category: "building",
    scaleClass: "medium",
    palette: {
      sage: "#84b082",
      sageDark: "#5e875d",
      cream: "#f8f1e1",
      oak: "#9c6b3e",
      woodDark: "#694324",
      slate: "#4d5666",
      warmGlass: "#ffe59e",
      terracotta: "#cf704c",
      gold: "#f2c14e",
      blossom: "#f095b4",
    },
    ops: [
      { op: "hollowBox", x0: -8, y0: 2, z0: -6, x1: 8, y1: 15, z1: 6, wall: 1, color: "sage", trim: "oak" },
      // Second floor cornice band
      { op: "box", x0: -9, y0: 8, z0: -7, x1: 9, y1: 9, z1: 7, color: "oak" },
      // Mansard/gable roof + rooftop flower terrace
      { op: "roofGable", x0: -9, yBase: 15, z0: -7, x1: 3, z1: 7, rise: 5, axis: "z", color: "slate", trim: "cream" },
      { op: "box", x0: 3, y0: 15, z0: -5, x1: 8, y1: 16, z1: 5, color: "terracotta" },
      { op: "sphere", cx: 5.5, cy: 17, cz: 0, rx: 2.2, ry: 1.8, rz: 3.2, color: "blossom" },
      // Glowing bay windows + oak door
      { op: "roundedBox", x0: -7, y0: 3, z0: 5, x1: -2, y1: 8, z1: 8, radius: 1.0, color: "warmGlass", emit: 1.1 },
      { op: "box", x0: 0, y0: 2, z0: 5, x1: 3, y1: 8, z1: 6, color: "woodDark" },
      { op: "box", x0: 4, y0: 4, z0: 5, x1: 7, y1: 7, z1: 6, color: "warmGlass", emit: 1.0 },
      { op: "box", x0: -6, y0: 10, z0: 5, x1: -2, y1: 13, z1: 6, color: "warmGlass", emit: 0.9, mirrorX: true },
      // Outdoor book display cart
      { op: "box", x0: 4, y0: 2, z0: 7, x1: 8, y1: 4, z1: 9, color: "oak" },
      { op: "box", x0: 4, y0: 4, z0: 7, x1: 8, y1: 5, z1: 9, color: "gold" },
    ],
    parts: [
      {
        name: "book-sign",
        kind: "swingZ",
        speed: 1.4,
        amp: 0.25,
        pivot: [2, 11.5, 7.5],
        ops: [
          { op: "box", x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 3, color: "woodDark" },
          { op: "box", x0: -1, y0: -3, z0: 1, x1: 2, y1: 0, z1: 3, color: "gold" },
        ],
      },
    ],
  });

  // 5. Meadow Golden Retriever Puppy
  const puppyBlueprint = normalizeAndGroundBlueprint({
    name: "Clover the Golden Pup",
    description: "Town dog trotting around the central green to greet passersby.",
    category: "creature",
    scaleClass: "small",
    palette: {
      coat: "#eab057",
      coatLight: "#f7ce7c",
      coatDark: "#c78936",
      collarRed: "#e0483e",
      brass: "#ffd257",
      nose: "#22242a",
      eye: "#181a20",
      tongue: "#f0788c",
    },
    ops: [
      // Plump torso & fluffy chest (raised 1 voxel above hip joints so trotting legs swing freely)
      { op: "roundedBox", x0: -3, y0: 5, z0: -5, x1: 3, y1: 9, z1: 4, radius: 1.5, color: "coat" },
      { op: "sphere", cx: 0, cy: 7.0, cz: 3.5, rx: 3.0, ry: 2.1, rz: 2.3, color: "coatLight" },
      // Red collar + brass bell tag
      { op: "ring", axis: "z", cx: 0, cy: 7.5, z0: 3, z1: 5, outerR: 3.1, innerR: 2.0, color: "collarRed" },
      { op: "box", x0: -1, y0: 5, z0: 5, x1: 1, y1: 6, z1: 6, color: "brass", emit: 0.5 },
      // Head, snout, floppy ears & happy tongue
      { op: "roundedBox", x0: -3, y0: 7, z0: 2, x1: 3, y1: 13, z1: 8, radius: 1.6, color: "coat" },
      { op: "roundedBox", x0: -2, y0: 7, z0: 7, x1: 2, y1: 10, z1: 10, radius: 1.0, color: "coatLight" },
      { op: "box", x0: -1, y0: 9, z0: 9, x1: 1, y1: 10, z1: 11, color: "nose" },
      { op: "box", x0: 0, y0: 7, z0: 9, x1: 1, y1: 8, z1: 10, color: "tongue" },
      { op: "box", x0: 3, y0: 8, z0: 3, x1: 4, y1: 12, z1: 6, color: "coatDark", mirrorX: true },
      { op: "voxels", list: [[2, 10, 8, "eye"], [2, 11, 8, "coatLight"]], mirrorX: true },
    ],
    parts: [
      {
        name: "front-left-leg",
        kind: "swingX",
        speed: 2.6,
        amp: 0.45,
        phase: 0,
        pivot: [2.2, 4, 2.5],
        ops: [
          { op: "box", x0: -1, y0: -4, z0: -1, x1: 1, y1: 0, z1: 1, color: "coat" },
          { op: "box", x0: -1, y0: -4, z0: 0, x1: 1, y1: -3, z1: 2, color: "coatLight" },
        ],
      },
      {
        name: "front-right-leg",
        kind: "swingX",
        speed: 2.6,
        amp: 0.45,
        phase: 3.14,
        pivot: [-2.2, 4, 2.5],
        ops: [
          { op: "box", x0: -1, y0: -4, z0: -1, x1: 1, y1: 0, z1: 1, color: "coat" },
          { op: "box", x0: -1, y0: -4, z0: 0, x1: 1, y1: -3, z1: 2, color: "coatLight" },
        ],
      },
      {
        name: "back-left-leg",
        kind: "swingX",
        speed: 2.6,
        amp: 0.45,
        phase: 3.14,
        pivot: [2.2, 4, -3.5],
        ops: [{ op: "box", x0: -1, y0: -4, z0: -1, x1: 1, y1: 0, z1: 1, color: "coatDark" }],
      },
      {
        name: "back-right-leg",
        kind: "swingX",
        speed: 2.6,
        amp: 0.45,
        phase: 0,
        pivot: [-2.2, 4, -3.5],
        ops: [{ op: "box", x0: -1, y0: -4, z0: -1, x1: 1, y1: 0, z1: 1, color: "coatDark" }],
      },
      {
        name: "wagging-tail",
        kind: "swingY",
        speed: 3.4,
        amp: 0.5,
        pivot: [0, 7.5, -6.5],
        ops: [{ op: "line", x0: 0, y0: 0, z0: 0, x1: 0, y1: 3, z1: -3, radius: 1.0, color: "coatLight" }],
      },
    ],
  });

  // 6. Lilypad Mallard Duckling on Clover Pond
  const duckBlueprint = normalizeAndGroundBlueprint({
    name: "Sunny Pond Mallard",
    description: "Resident mallard swimming laps around Clover Pond in the center of town.",
    category: "watercraft",
    scaleClass: "small",
    palette: {
      feather: "#e5ded2",
      wing: "#a8825c",
      emerald: "#2d8f6f",
      collarWhite: "#fcfaf5",
      bill: "#f59b32",
      eye: "#181a20",
    },
    ops: [
      { op: "sphere", cx: 0, cy: 3.5, cz: -0.5, rx: 3.4, ry: 2.8, rz: 5.0, color: "feather" },
      { op: "cone", cx: 0, y0: 3, y1: 6, cz: -5, rBottom: 2.0, rTop: 0.6, color: "feather" },
      { op: "cylinder", axis: "y", cx: 0, y0: 5, y1: 8, cz: 3, radius: 1.8, color: "collarWhite" },
      { op: "sphere", cx: 0, cy: 9, cz: 3.2, rx: 2.4, ry: 2.3, rz: 2.5, color: "emerald" },
      { op: "roundedBox", x0: -1.5, y0: 8, z0: 5, x1: 1.5, y1: 9.5, z1: 8, radius: 0.7, color: "bill" },
      { op: "voxels", list: [[2, 9, 4, "eye"]], mirrorX: true },
    ],
    parts: [
      {
        name: "left-wing",
        kind: "swingZ",
        speed: 1.6,
        amp: 0.14,
        pivot: [4.2, 4.5, -0.5],
        ops: [{ op: "box", x0: 0, y0: -1, z0: -2, x1: 1, y1: 1, z1: 2, color: "wing" }],
      },
      {
        name: "right-wing",
        kind: "swingZ",
        speed: 1.6,
        amp: 0.14,
        phase: 3.14,
        pivot: [-4.2, 4.5, -0.5],
        ops: [{ op: "box", x0: -1, y0: -1, z0: -2, x1: 0, y1: 1, z1: 2, color: "wing" }],
      },
    ],
  });

  const mainLoopPoints: [number, number][] = [
    [-18, -20],
    [0, -20],
    [18, -20],
    [24, -14],
    [24, 0],
    [24, 14],
    [18, 20],
    [0, 20],
    [-18, 20],
    [-24, 14],
    [-24, 0],
    [-24, -14],
  ];

  const creations: WorldCreation[] = [
    {
      id: "seed-school-bus",
      name: busBlueprint.name,
      description: busBlueprint.description,
      category: "vehicle",
      scaleClass: "medium",
      x: 0,
      z: -20,
      yaw: Math.PI / 2,
      blueprint: busBlueprint,
      behavior: {
        type: "vehicle_route",
        speed: 6.2,
        waypoints: mainLoopPoints,
        stops: [
          {
            id: "stop-clocktower",
            name: "Clocktower Station",
            x: 0,
            z: -20,
            dwellSec: 2.0,
            nearCreationId: "seed-clocktower-station",
          },
          {
            id: "stop-bookshop",
            name: "Bookshop Corner",
            x: 24,
            z: 8,
            dwellSec: 2.0,
            nearCreationId: "seed-matcha-bookshop",
          },
          {
            id: "stop-bakery",
            name: "Windmill Bakery",
            x: -24,
            z: -2,
            dwellSec: 2.0,
            nearCreationId: "seed-windmill-bakery",
          },
        ],
        statusLine: "Town bus circling the central commuter loop",
      },
      integratedLevel: 2,
      createdAt: now - 300_000,
      isSeed: true,
    },
    {
      id: "seed-windmill-bakery",
      name: bakeryBlueprint.name,
      description: bakeryBlueprint.description,
      category: "building",
      scaleClass: "large",
      x: -38,
      z: -2,
      yaw: Math.PI / 2,
      blueprint: bakeryBlueprint,
      liveFeed: { kind: "wind", place: "Meadow", lat: -33.87, lon: 151.21 },
      behavior: {
        type: "landmark",
        facingYaw: Math.PI / 2,
        activity: "windmill bakery",
        statusLine: "Neighborhood bakery grinding grain and baking fresh bread",
      },
      integratedLevel: 2,
      createdAt: now - 280_000,
      isSeed: true,
    },
    {
      id: "seed-clocktower-station",
      name: clocktowerBlueprint.name,
      description: clocktowerBlueprint.description,
      category: "building",
      scaleClass: "large",
      x: 0,
      z: -33,
      yaw: 0,
      blueprint: clocktowerBlueprint,
      liveFeed: { kind: "time", place: "Meadow", timezone: "Australia/Sydney" },
      behavior: {
        type: "landmark",
        facingYaw: 0,
        activity: "transit clocktower",
        statusLine: "Central transit hub where town bus and shuttle lines meet",
      },
      integratedLevel: 2,
      createdAt: now - 260_000,
      isSeed: true,
    },
    {
      id: "seed-matcha-bookshop",
      name: bookshopBlueprint.name,
      description: bookshopBlueprint.description,
      category: "building",
      scaleClass: "medium",
      x: 34.5,
      z: 8,
      yaw: -Math.PI / 2,
      blueprint: bookshopBlueprint,
      behavior: {
        type: "landmark",
        facingYaw: -Math.PI / 2,
        activity: "bookshop and cafe",
        statusLine: "Corner bookshop and tea room for neighborhood readers",
      },
      integratedLevel: 2,
      createdAt: now - 240_000,
      isSeed: true,
    },
    {
      id: "seed-meadow-pup",
      name: puppyBlueprint.name,
      description: puppyBlueprint.description,
      category: "creature",
      scaleClass: "small",
      x: 8,
      z: 2,
      yaw: 0.4,
      blueprint: puppyBlueprint,
      behavior: {
        type: "wander",
        style: "trot",
        speed: 2.8,
        homeX: 8,
        homeZ: 2,
        radius: 8,
        targets: [
          [11, 5],
          [5, 11],
          [13, -5],
          [4, -8],
        ],
        statusLine: "Town dog trotting around the central green",
      },
      integratedLevel: 2,
      createdAt: now - 220_000,
      isSeed: true,
    },
    {
      id: "seed-pond-duck",
      name: duckBlueprint.name,
      description: duckBlueprint.description,
      category: "watercraft",
      scaleClass: "small",
      x: -7,
      z: 3,
      yaw: 1.1,
      blueprint: duckBlueprint,
      behavior: {
        type: "water_float",
        speed: 1.35,
        pondX: -7,
        pondZ: 3,
        radius: 4.2,
        statusLine: "Resident mallard swimming laps on Clover Pond",
      },
      integratedLevel: 2,
      createdAt: now - 200_000,
      isSeed: true,
    },
  ];

  const paths: WorldPath[] = [
    {
      id: "path-main-loop",
      kind: "road",
      points: mainLoopPoints,
      closed: true,
    },
    {
      id: "path-outer-ring",
      kind: "road",
      points: OUTER_RING_ROAD_POINTS.map(([x, z]) => [x, z] as [number, number]),
      closed: true,
    },
    {
      id: "path-clocktower-spur",
      kind: "cobblestone",
      points: [
        [0, -27.5],
        [0, -22.55],
      ],
    },
    {
      id: "path-bakery-spur",
      kind: "cottage_road",
      points: [
        [-31.6, -2],
        [-26.55, -2],
      ],
    },
    {
      id: "path-bookshop-spur",
      kind: "cottage_road",
      points: [
        [30.6, 8],
        [26.55, 8],
      ],
    },
    {
      id: "path-green-walk",
      kind: "footpath",
      points: [
        [0, -16.8],
        [0, 0],
        [0, 16.8],
      ],
    },
  ];

  const props: WorldProp[] = [
    {
      id: "prop-central-pond",
      kind: "pond",
      x: -7,
      z: 3,
      yaw: 0,
      radius: 6.6,
      label: "Clover Pond",
    },
    {
      id: "prop-stop-clocktower",
      kind: "bus_stop",
      x: 3.5,
      z: -22.8,
      yaw: 0,
      label: "Clocktower Stop",
    },
    {
      id: "prop-stop-bookshop",
      kind: "bus_stop",
      x: 26.8,
      z: 4.2,
      yaw: -Math.PI / 2,
      label: "Bookshop Stop",
    },
    {
      id: "prop-stop-bakery",
      kind: "bus_stop",
      x: -26.8,
      z: 2.0,
      yaw: Math.PI / 2,
      label: "Bakery Stop",
    },
    {
      id: "prop-lamp-1",
      kind: "lamp_post",
      x: -3.2,
      z: -22.8,
      yaw: 0,
    },
    {
      id: "prop-lamp-2",
      kind: "lamp_post",
      x: -26.8,
      z: -5.4,
      yaw: Math.PI / 2,
    },
    {
      id: "prop-lamp-3",
      kind: "lamp_post",
      x: 26.8,
      z: 11.4,
      yaw: -Math.PI / 2,
    },
    {
      id: "prop-bench-pond",
      kind: "bench",
      x: -1,
      z: 4,
      yaw: -1.57,
    },
    {
      id: "prop-flowers-1",
      kind: "flower_patch",
      x: 8.5,
      z: -7,
      yaw: 0,
    },
    {
      id: "prop-flowers-2",
      kind: "flower_patch",
      x: -13,
      z: -8,
      yaw: 0,
    },
  ];

  const villagers: WorldVillager[] = [
    {
      id: "villager-milo",
      name: "Milo",
      role: "student",
      hatColor: "#f5b82e",
      shirtColor: "#4c82d4",
      homeX: 3.5,
      homeZ: -23.2,
      stops: [
        [3.5, -22.8],
        [26.8, 4.2],
        [30.5, 8],
      ],
      usesTransit: true,
    },
    {
      id: "villager-clara",
      name: "Clara",
      role: "baker",
      hatColor: "#fcfaf5",
      shirtColor: "#df5246",
      homeX: -32,
      homeZ: -2,
      stops: [
        [-26.8, 2.0],
        [3.5, -22.8],
        [-31.6, -2],
      ],
      usesTransit: true,
    },
    {
      id: "villager-theo",
      name: "Theo",
      role: "commuter",
      hatColor: "#58ad52",
      shirtColor: "#f2be38",
      homeX: 27.0,
      homeZ: 4.5,
      stops: [
        [26.8, 4.2],
        [-26.8, 2.0],
        [30.6, 8],
      ],
      usesTransit: true,
    },
    {
      id: "villager-hana",
      name: "Hana",
      role: "artist",
      hatColor: "#ec8db0",
      shirtColor: "#9370cf",
      homeX: -26.8,
      homeZ: 2.4,
      stops: [
        [-26.8, 2.0],
        [26.8, 4.2],
        [-1.5, 4.2],
      ],
      usesTransit: true,
    },
    {
      id: "villager-pip",
      name: "Pip",
      role: "student",
      hatColor: "#4fa8de",
      shirtColor: "#ec8438",
      homeX: 2.8,
      homeZ: -23.0,
      stops: [
        [3.5, -22.8],
        [-26.8, 2.0],
        [0, -27.5],
      ],
      usesTransit: true,
    },
    {
      id: "villager-iris",
      name: "Iris",
      role: "gardener",
      hatColor: "#d9a74a",
      shirtColor: "#47b0a3",
      homeX: -1,
      homeZ: 5,
      stops: [
        [-1, 4.5],
        [8.5, -6],
        [0, -14],
        [-12, -7],
      ],
      usesTransit: false,
    },
  ];

  const terrainZones: WorldTerrainZone[] = [
    {
      id: "zone-clover-pond-moss",
      biome: "misty_moss",
      x: -7,
      z: 3,
      radius: 12.5,
      intensity: 0.9,
    },
    {
      id: "zone-clocktower-plaza",
      biome: "stone_plaza",
      x: 0,
      z: -33,
      radius: 9.2,
      intensity: 0.85,
    },
    {
      id: "zone-bakery-autumn",
      biome: "autumn_grove",
      x: -38,
      z: -2,
      radius: 10.5,
      intensity: 0.8,
    },
  ];

  return {
    version: 1,
    creations,
    paths,
    props,
    terrainZones,
    villagers,
    contributorCount: 0,
    contributionCount: 0,
    lastWeaveNote: "Sunnyvale School Bus operating on the Downtown Avenue loop.",
  };
}

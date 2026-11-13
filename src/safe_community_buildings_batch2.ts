import type { SafeBuildingPlacementSpec } from "./safe_community_buildings";
import type { VoxelBlueprint, WorldCreation, WorldPath } from "./types";
import { normalizeAndGroundBlueprint } from "./voxel_dsl";

function buildNaturalHistoryMuseumBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Meadowland Natural History Museum",
      description:
        "Neoclassical sandstone museum exhibiting island geology, ancient fossils, and botanical specimens.",
      category: "building",
      scaleClass: "large",
      palette: {
        sandstoneBase: "#bfb29c",
        sandstone: "#e3d6c1",
        sandstoneLight: "#f5efe2",
        copperRoof: "#3f8c7a",
        skylight: "#b5e6f5",
        warmHall: "#ffe49c",
        bronze: "#9c7440",
      },
      ops: [
        { op: "box", x0: -16, y0: 0, z0: -10, x1: 16, y1: 3, z1: 9, color: "sandstoneBase" },
        { op: "roundedBox", x0: -15, y0: 3, z0: -9, x1: 15, y1: 16, z1: 8, radius: 1.0, color: "sandstone" },
        { op: "pillars", x0: -15, y0: 3, z0: -9, x1: 15, y1: 16, z1: 8, color: "sandstoneLight" },
        { op: "box", x0: -16, y0: 16, z0: -10, x1: 16, y1: 18, z1: 9, color: "sandstoneLight" },
        { op: "roofGable", x0: -16, yBase: 18, z0: -10, x1: 16, z1: 9, rise: 6, axis: "x", color: "copperRoof", trim: "sandstoneLight" },
        { op: "box", x0: -8, y0: 22, z0: -4, x1: 8, y1: 24, z1: 3, color: "skylight", emit: 0.5 },
        // Classical +Z Ionic portico & wide safe entrance steps
        { op: "box", x0: -8, y0: 0, z0: 9, x1: 8, y1: 3, z1: 13, color: "sandstoneBase" },
        { op: "pillars", x0: -7, y0: 3, z0: 9, x1: 7, y1: 15, z1: 12, color: "sandstoneLight" },
        { op: "roofGable", x0: -8, yBase: 15, z0: 8, x1: 8, z1: 13, rise: 5, axis: "z", color: "copperRoof", trim: "sandstoneLight" },
        { op: "arch", cx: 0, y0: 3, cz: 8, halfSpan: 3, height: 7, depth: 2, axis: "z", color: "warmHall" },
        { op: "sphere", cx: 0, cy: 17, cz: 12.5, rx: 1.6, ry: 1.2, rz: 0.8, color: "bronze" },
        { op: "windowRow", wall: "+z", y: 6, start: -13, end: -9, every: 4, width: 2, height: 6, bounds: { x0: -15, z0: -9, x1: 15, z1: 8 }, color: "warmHall", emit: 0.6 },
        { op: "windowRow", wall: "+z", y: 6, start: 9, end: 13, every: 4, width: 2, height: 6, bounds: { x0: -15, z0: -9, x1: 15, z1: 8 }, color: "warmHall", emit: 0.6 },
        { op: "windowRow", wall: "-z", y: 6, start: -12, end: 12, every: 4, width: 2, height: 6, bounds: { x0: -15, z0: -9, x1: 15, z1: 8 }, color: "warmHall", emit: 0.55 },
      ],
      parts: [],
    },
    "Meadowland Natural History Museum",
  );
}

function buildMarineAquariumBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Coral Reef Marine Aquarium",
      description:
        "Living reef aquarium showcasing glowing kelp forests, tropical fish habitats, and coastal conservation.",
      category: "building",
      scaleClass: "large",
      palette: {
        limestone: "#dfe6ea",
        slateBase: "#687885",
        oceanDeep: "#1e6f8c",
        aquaTank: "#42c6d9",
        coralPink: "#f06d85",
        kelpGreen: "#43ad67",
        waveRoof: "#2c8da8",
        pearlTrim: "#f7fbfc",
      },
      ops: [
        { op: "cylinder", axis: "y", cx: 0, y0: 0, y1: 3, cz: 0, radius: 14.2, color: "slateBase" },
        { op: "cylinder", axis: "y", cx: 0, y0: 3, y1: 14, cz: 0, radius: 13.0, color: "limestone" },
        // Panoramic illuminated reef tank band wrapping the rotunda
        { op: "cylinder", axis: "y", cx: 0, y0: 5, y1: 11, cz: 0, radius: 13.1, color: "aquaTank", emit: 0.68 },
        { op: "ring", axis: "y", cx: 0, y0: 13, y1: 15, cz: 0, outerR: 14.0, innerR: 12.0, color: "pearlTrim" },
        { op: "dome", cx: 0, yBase: 14, cz: 0, radius: 11.5, color: "waveRoof" },
        // Shell-arch +Z entrance canopy & coral accents
        { op: "box", x0: -6, y0: 0, z0: 11, x1: 6, y1: 2, z1: 15, color: "slateBase" },
        { op: "arch", cx: 0, y0: 2, cz: 13, halfSpan: 4, height: 7, depth: 3, axis: "z", color: "pearlTrim" },
        { op: "sphere", cx: 5, cy: 4, cz: 13, rx: 1.5, ry: 1.5, rz: 1.5, color: "coralPink", mirrorX: true },
        { op: "sphere", cx: 7, cy: 4, cz: 12, rx: 1.3, ry: 2.0, rz: 1.3, color: "kelpGreen", mirrorX: true },
      ],
      parts: [],
    },
    "Coral Reef Marine Aquarium",
  );
}

function buildCulinaryMarketHallBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Westmeadow Culinary Market Hall",
      description:
        "Covered red-brick and wrought-iron farmers market hall offering fresh orchard fruit, cheeses, and flowers.",
      category: "building",
      scaleClass: "large",
      palette: {
        stone: "#9a948c",
        brickRed: "#b54e38",
        ironGreen: "#2f5e4e",
        creamTrim: "#f7f1e3",
        clerestory: "#bfe8f5",
        warmStall: "#ffe396",
        awningGold: "#f0b63a",
        awningBerry: "#d44d5c",
      },
      ops: [
        { op: "box", x0: -16, y0: 0, z0: -10, x1: 16, y1: 2, z1: 10, color: "stone" },
        { op: "roundedBox", x0: -15, y0: 2, z0: -9, x1: 15, y1: 13, z1: 9, radius: 1.0, color: "brickRed" },
        { op: "pillars", x0: -15, y0: 2, z0: -9, x1: 15, y1: 13, z1: 9, color: "ironGreen" },
        // Barrel-vaulted market roof + glass clerestory monitor
        { op: "cylinder", axis: "x", x0: -15, x1: 15, cy: 13, cz: 0, radius: 7.5, color: "ironGreen" },
        { op: "box", x0: -12, y0: 19, z0: -3, x1: 12, y1: 21, z1: 3, color: "clerestory", emit: 0.55 },
        // Festive +Z market archways & striped produce awnings
        { op: "arch", cx: 0, y0: 2, cz: 9, halfSpan: 3, height: 7, depth: 2, axis: "z", color: "creamTrim" },
        { op: "box", x0: -13, y0: 7, z0: 9, x1: -5, y1: 9, z1: 12, color: "awningGold" },
        { op: "box", x0: 5, y0: 7, z0: 9, x1: 13, y1: 9, z1: 12, color: "awningBerry" },
        { op: "box", x0: -12, y0: 3, z0: 8, x1: -6, y1: 7, z1: 10, color: "warmStall", emit: 0.7, mirrorX: true },
      ],
      parts: [],
    },
    "Westmeadow Culinary Market Hall",
  );
}

function buildAquaticSwimCenterBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Suncrest Community Aquatic Center",
      description:
        "Skylit timber-arch indoor swimming and water-safety pavilion with heated lap lanes and lifeguard deck.",
      category: "building",
      scaleClass: "large",
      palette: {
        sandstone: "#d8ccb8",
        cedarArch: "#b07444",
        slateRoof: "#3c586e",
        poolAqua: "#3dc7db",
        glassClear: "#c4eef7",
        trimWhite: "#f7f9fa",
        lifeRing: "#eb6334",
      },
      ops: [
        { op: "box", x0: -16, y0: 0, z0: -10, x1: 16, y1: 2, z1: 10, color: "sandstone" },
        { op: "roundedBox", x0: -15, y0: 2, z0: -9, x1: 15, y1: 12, z1: 9, radius: 1.2, color: "glassClear", emit: 0.45 },
        { op: "pillars", x0: -15, y0: 2, z0: -9, x1: 15, y1: 12, z1: 9, color: "cedarArch" },
        // Glowing indoor lap pool visible inside base
        { op: "box", x0: -11, y0: 2, z0: -5, x1: 11, y1: 4, z1: 5, color: "poolAqua", emit: 0.65 },
        // Arched glulam-timber & skylight roof
        { op: "roofGable", x0: -16, yBase: 12, z0: -10, x1: 16, z1: 10, rise: 6, axis: "x", color: "slateRoof", trim: "cedarArch" },
        { op: "box", x0: -12, y0: 15, z0: -4, x1: 12, y1: 18, z1: 4, color: "glassClear", emit: 0.55 },
        // +Z Entrance canopy & safety life-ring
        { op: "box", x0: -6, y0: 0, z0: 9, x1: 6, y1: 2, z1: 13, color: "sandstone" },
        { op: "box", x0: -6, y0: 8, z0: 9, x1: 6, y1: 10, z1: 13, color: "trimWhite" },
        { op: "pillars", x0: -5, y0: 2, z0: 9, x1: 5, y1: 8, z1: 12, color: "cedarArch" },
        { op: "ring", axis: "z", cx: 0, cy: 11, z0: 10, z1: 11, outerR: 1.6, innerR: 0.8, color: "lifeRing" },
      ],
      parts: [],
    },
    "Suncrest Community Aquatic Center",
  );
}

function buildAerospaceWeatherHallBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Starfall Weather & Aviation Hall",
      description:
        "Meteorological observatory and flight-safety museum tracking island winds, clouds, and barometric pressure.",
      category: "building",
      scaleClass: "large",
      palette: {
        stoneBase: "#8e969e",
        titanium: "#e6ecf0",
        cobaltTrim: "#356896",
        domeWhite: "#f8fbfd",
        brass: "#e3b342",
        glassSky: "#9fdcf0",
        warmGlow: "#ffe6a1",
      },
      ops: [
        { op: "box", x0: -15, y0: 0, z0: -10, x1: 15, y1: 2, z1: 10, color: "stoneBase" },
        { op: "roundedBox", x0: -14, y0: 2, z0: -9, x1: 14, y1: 14, z1: 8, radius: 1.6, color: "titanium" },
        { op: "box", x0: -15, y0: 13, z0: -10, x1: 15, y1: 15, z1: 9, color: "cobaltTrim" },
        // Central meteorological radar radome & brass weather mast
        { op: "cylinder", axis: "y", cx: 0, y0: 15, y1: 18, cz: -1, radius: 7.2, color: "stoneBase" },
        { op: "dome", cx: 0, yBase: 18, cz: -1, radius: 6.8, color: "domeWhite" },
        { op: "cylinder", axis: "y", cx: 0, y0: 24, y1: 28, cz: -1, radius: 0.8, color: "brass" },
        // +Z Portico & panoramic gallery windows
        { op: "arch", cx: 0, y0: 2, cz: 8, halfSpan: 3, height: 7, depth: 2, axis: "z", color: "warmGlow" },
        { op: "box", x0: -6, y0: 9, z0: 8, x1: 6, y1: 10, z1: 12, color: "cobaltTrim" },
        { op: "windowRow", wall: "+z", y: 5, start: -12, end: -6, every: 3, width: 2, height: 5, bounds: { x0: -14, z0: -9, x1: 14, z1: 8 }, color: "glassSky", emit: 0.5 },
        { op: "windowRow", wall: "+z", y: 5, start: 6, end: 12, every: 3, width: 2, height: 5, bounds: { x0: -14, z0: -9, x1: 14, z1: 8 }, color: "glassSky", emit: 0.5 },
      ],
      parts: [
        {
          name: "weather-wind-vane",
          kind: "spinY",
          speed: 1.15,
          pivot: [0, 30.2, -1],
          ops: [
            { op: "box", x0: -2.5, y0: 0, z0: -0.4, x1: 2.5, y1: 0.7, z1: 0.4, color: "brass" },
            { op: "sphere", cx: 2.2, cy: 0.35, cz: 0, rx: 0.8, ry: 0.8, rz: 0.8, color: "warmGlow", emit: 1.0 },
          ],
        },
      ],
    },
    "Starfall Weather & Aviation Hall",
  );
}

function buildCamelliaTeaConservatoryBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Rosewood Camellia Tea Conservatory",
      description:
        "Tiered emerald wrought-iron glasshouse serving botanical herbal infusions amid blooming camellia trees.",
      category: "building",
      scaleClass: "large",
      palette: {
        limestone: "#dfd7c8",
        emeraldIron: "#2c6b56",
        glassDew: "#c4f0f5",
        camelliaPink: "#ee6b92",
        foliage: "#439948",
        lanternWarm: "#ffe498",
      },
      ops: [
        { op: "roundedBox", x0: -15, y0: 0, z0: -10, x1: 15, y1: 2, z1: 10, radius: 1.2, color: "limestone" },
        { op: "roundedBox", x0: -14, y0: 2, z0: -9, x1: 14, y1: 12, z1: 8, radius: 1.2, color: "glassDew", emit: 0.38 },
        { op: "pillars", x0: -14, y0: 2, z0: -9, x1: 14, y1: 12, z1: 8, color: "emeraldIron" },
        { op: "roundedBox", x0: -9, y0: 12, z0: -6, x1: 9, y1: 18, z1: 5, radius: 1.0, color: "glassDew", emit: 0.42 },
        { op: "pillars", x0: -9, y0: 12, z0: -6, x1: 9, y1: 18, z1: 5, color: "emeraldIron" },
        { op: "dome", cx: 0, yBase: 18, cz: -0.5, radius: 6.5, color: "glassDew", emit: 0.45 },
        // Blooming camellia planters & +Z arched conservatory porch
        { op: "arch", cx: 0, y0: 2, cz: 8, halfSpan: 3, height: 7, depth: 2, axis: "z", color: "emeraldIron" },
        { op: "sphere", cx: 8, cy: 5, cz: 9, rx: 2.2, ry: 1.8, rz: 1.6, color: "foliage", mirrorX: true },
        { op: "sphere", cx: 8, cy: 6.2, cz: 9.5, rx: 1.4, ry: 1.0, rz: 1.0, color: "camelliaPink", mirrorX: true },
        { op: "box", x0: 4, y0: 5, z0: 8, x1: 5, y1: 7, z1: 9, color: "lanternWarm", emit: 1.0, mirrorX: true },
      ],
      parts: [],
    },
    "Rosewood Camellia Tea Conservatory",
  );
}

function buildHeritageGranaryMillBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Ambergrain Heritage Flour Mill",
      description:
        "Fieldstone-and-timber flour mill and twin copper-domed grain silos supplying fresh flour to local bakeries.",
      category: "building",
      scaleClass: "large",
      palette: {
        fieldstone: "#8f8980",
        barnTimber: "#a86438",
        creamTrim: "#f5eedc",
        siloSteel: "#cfd6dc",
        copperCap: "#499683",
        wheatGold: "#f0be46",
        warmWindow: "#ffe396",
      },
      ops: [
        { op: "box", x0: -16, y0: 0, z0: -10, x1: 16, y1: 3, z1: 9, color: "fieldstone" },
        // Main timber millhouse (-X..+5)
        { op: "roundedBox", x0: -15, y0: 3, z0: -9, x1: 5, y1: 16, z1: 8, radius: 1.0, color: "barnTimber" },
        { op: "roofGable", x0: -16, yBase: 16, z0: -10, x1: 6, z1: 9, rise: 7, axis: "z", color: "fieldstone", trim: "creamTrim" },
        // Twin cylindrical grain silos on +X (Y = 3..22) capped with copper domes
        { op: "cylinder", axis: "y", cx: 11, y0: 3, y1: 21, cz: -4, radius: 4.0, color: "siloSteel" },
        { op: "dome", cx: 11, yBase: 21, cz: -4, radius: 4.0, color: "copperCap" },
        { op: "cylinder", axis: "y", cx: 11, y0: 3, y1: 21, cz: 4, radius: 4.0, color: "siloSteel" },
        { op: "dome", cx: 11, yBase: 21, cz: 4, radius: 4.0, color: "copperCap" },
        // +Z Loading porch & golden wheat-sheaf emblem
        { op: "box", x0: -10, y0: 7, z0: 8, x1: 0, y1: 9, z1: 11, color: "creamTrim" },
        { op: "arch", cx: -5, y0: 3, cz: 8, halfSpan: 3, height: 5, depth: 1, axis: "z", color: "warmWindow" },
        { op: "sphere", cx: -5, cy: 18, cz: 8.5, rx: 1.6, ry: 2.0, rz: 0.8, color: "wheatGold", emit: 0.45 },
      ],
      parts: [],
    },
    "Ambergrain Heritage Flour Mill",
  );
}

function buildLanternRamenHouseBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Lanternlight Ramen & Noodle House",
      description:
        "Cozy cedar-and-plaster noodle shop ladling steaming bowls of miso ramen beneath warm paper lanterns.",
      category: "building",
      scaleClass: "medium",
      palette: {
        stone: "#85898f",
        cedar: "#87532f",
        plaster: "#f7efe0",
        tileSlate: "#333d4a",
        norenIndigo: "#2e4d82",
        lanternRed: "#e35244",
        lanternGold: "#ffe08a",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 8, color: "stone" },
        { op: "box", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, color: "plaster" },
        { op: "pillars", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, color: "cedar" },
        // Tiered tiled eaves
        { op: "box", x0: -11, y0: 7, z0: 6, x1: 11, y1: 8, z1: 10, color: "tileSlate" },
        { op: "roofGable", x0: -11, yBase: 11, z0: -9, x1: 11, z1: 9, rise: 5, axis: "x", color: "tileSlate", trim: "cedar" },
        // Indigo noren doorway curtain & glowing lanterns on +Z
        { op: "box", x0: -4, y0: 5, z0: 7, x1: 4, y1: 7, z1: 8, color: "norenIndigo" },
        { op: "box", x0: -3, y0: 2, z0: 6, x1: 3, y1: 6, z1: 7, color: "lanternGold", emit: 0.8 },
        { op: "sphere", cx: 6, cy: 6, cz: 9, rx: 1.0, ry: 1.3, rz: 1.0, color: "lanternRed", emit: 1.1, mirrorX: true },
      ],
      parts: [],
    },
    "Lanternlight Ramen & Noodle House",
  );
}

function buildEspressoRoasteryBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Velvet Roast Espresso Cafe",
      description:
        "Corner brick coffee roastery with a copper roaster stack, shaded patio awning, and fresh croissants.",
      category: "building",
      scaleClass: "medium",
      palette: {
        stone: "#9a948c",
        brickWarm: "#9e4736",
        brass: "#deb043",
        forestAwning: "#2b6b4f",
        cream: "#fbf4e4",
        copperStack: "#c9743e",
        cafeGlow: "#ffe296",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 9, color: "stone" },
        { op: "roundedBox", x0: -9, y0: 2, z0: -7, x1: 9, y1: 12, z1: 7, radius: 1.0, color: "brickWarm" },
        { op: "box", x0: -10, y0: 12, z0: -8, x1: 10, y1: 14, z1: 8, color: "cream" },
        { op: "cylinder", axis: "y", cx: -6, y0: 14, y1: 20, cz: -3, radius: 1.2, color: "copperStack" },
        // Forest-green & cream +Z cafe awning & glowing espresso bar window
        { op: "box", x0: -8, y0: 7, z0: 7, x1: 8, y1: 9, z1: 10, color: "forestAwning" },
        { op: "box", x0: -6, y0: 3, z0: 6, x1: 6, y1: 7, z1: 8, color: "cafeGlow", emit: 0.75 },
        { op: "arch", cx: 0, y0: 2, cz: 7, halfSpan: 2, height: 5, depth: 1, axis: "z", color: "brass" },
      ],
      parts: [],
    },
    "Velvet Roast Espresso Cafe",
  );
}

function buildBicycleWorkshopBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Breezeway Bicycle & Skate Shop",
      description:
        "Neighborhood cycle and roller-skate workshop tuning Cruisers, pumping tires, and fitting safety helmets.",
      category: "building",
      scaleClass: "medium",
      palette: {
        stone: "#9ea4aa",
        skyClapboard: "#6eb5db",
        whiteTrim: "#f7fafc",
        slateRoof: "#3c4b5c",
        wheelGold: "#f2be3d",
        warmShop: "#ffe69e",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 9, color: "stone" },
        { op: "roundedBox", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, radius: 1.0, color: "skyClapboard" },
        { op: "roofGable", x0: -10, yBase: 11, z0: -8, x1: 10, z1: 8, rise: 6, axis: "z", color: "slateRoof", trim: "whiteTrim" },
        // Decorative golden bicycle wheel emblem on +Z gable
        { op: "ring", axis: "z", cx: 0, cy: 13.5, z0: 7, z1: 8, outerR: 2.2, innerR: 1.2, color: "wheelGold", emit: 0.5 },
        { op: "arch", cx: 0, y0: 2, cz: 7, halfSpan: 3, height: 6, depth: 1, axis: "z", color: "warmShop" },
        { op: "box", x0: 5, y0: 2, z0: 7, x1: 8, y1: 4, z1: 9, color: "whiteTrim", mirrorX: true },
      ],
      parts: [],
    },
    "Breezeway Bicycle & Skate Shop",
  );
}

function buildGemLapidaryGalleryBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Quarryside Gem & Mineral Gallery",
      description:
        "Artisan lapidary showroom displaying polished amethyst geodes and emerald crystals from the nearby quarry.",
      category: "building",
      scaleClass: "medium",
      palette: {
        graniteDark: "#5d646e",
        limestone: "#e5dfd3",
        copperRoof: "#439481",
        amethyst: "#a864e0",
        emeraldGem: "#42cc8c",
        citrine: "#ffd24d",
        glassWarm: "#ffe8a3",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 9, color: "graniteDark" },
        { op: "roundedBox", x0: -9, y0: 2, z0: -7, x1: 9, y1: 12, z1: 7, radius: 1.2, color: "limestone" },
        { op: "roofPyramid", x0: -10, yBase: 12, z0: -8, x1: 10, z1: 8, color: "copperRoof", trim: "limestone" },
        // Glowing crystal geode spire crowning the pyramid roof & +Z display bays
        { op: "cone", cx: 0, y0: 17, y1: 22, cz: 0, rBottom: 1.8, rTop: 0.3, color: "amethyst", emit: 0.85 },
        { op: "arch", cx: 0, y0: 2, cz: 7, halfSpan: 2, height: 6, depth: 1, axis: "z", color: "glassWarm" },
        { op: "sphere", cx: -5, cy: 5, cz: 7.5, rx: 1.4, ry: 1.4, rz: 1.0, color: "emeraldGem", emit: 0.8 },
        { op: "sphere", cx: 5, cy: 5, cz: 7.5, rx: 1.4, ry: 1.4, rz: 1.0, color: "citrine", emit: 0.8 },
      ],
      parts: [],
    },
    "Quarryside Gem & Mineral Gallery",
  );
}

function buildWatercolorArtStudioBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Paperbark Art & Watercolor Studio",
      description:
        "Sunlit whitewashed painting studio with north-light glass skylights and easel classes for villagers.",
      category: "building",
      scaleClass: "medium",
      palette: {
        stone: "#aba396",
        whitewash: "#faf7f0",
        terracotta: "#cc6c47",
        skylight: "#bceaf7",
        paletteCoral: "#ec6578",
        paletteGold: "#f5c242",
        paletteCobalt: "#4689db",
        timber: "#855634",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 9, color: "stone" },
        { op: "roundedBox", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, radius: 1.0, color: "whitewash" },
        { op: "roofGable", x0: -10, yBase: 11, z0: -8, x1: 10, z1: 8, rise: 5, axis: "x", color: "terracotta", trim: "timber" },
        { op: "box", x0: -7, y0: 13, z0: -5, x1: 7, y1: 16, z1: 2, color: "skylight", emit: 0.55 },
        // Artist color-dots above +Z studio porch
        { op: "arch", cx: 0, y0: 2, cz: 7, halfSpan: 3, height: 6, depth: 1, axis: "z", color: "timber" },
        { op: "sphere", cx: -2.5, cy: 9.5, cz: 7.5, rx: 0.9, ry: 0.9, rz: 0.6, color: "paletteCoral", emit: 0.5 },
        { op: "sphere", cx: 0, cy: 9.8, cz: 7.5, rx: 0.9, ry: 0.9, rz: 0.6, color: "paletteGold", emit: 0.5 },
        { op: "sphere", cx: 2.5, cy: 9.5, cz: 7.5, rx: 0.9, ry: 0.9, rz: 0.6, color: "paletteCobalt", emit: 0.5 },
      ],
      parts: [],
    },
    "Paperbark Art & Watercolor Studio",
  );
}

function buildGelatoWaffleParlorBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Hearthside Gelato & Waffle Parlor",
      description:
        "Pastel neighborhood dessert parlor scooping pistachio, strawberry, and vanilla bean gelato on warm waffles.",
      category: "building",
      scaleClass: "medium",
      palette: {
        stone: "#bfb6a8",
        peachWall: "#fad6c3",
        pistachioTrim: "#6eb886",
        creamSwirl: "#fff8eb",
        berrySwirl: "#eb6b8a",
        waffleCone: "#cf934c",
        warmGlow: "#ffe69c",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 9, color: "stone" },
        { op: "roundedBox", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, radius: 1.2, color: "peachWall" },
        { op: "box", x0: -10, y0: 11, z0: -8, x1: 10, y1: 13, z1: 8, color: "pistachioTrim" },
        // Rooftop sculpted gelato cup & berry swirl finial
        { op: "cylinder", axis: "y", cx: 0, y0: 13, y1: 16, cz: 0, radius: 2.8, color: "waffleCone" },
        { op: "sphere", cx: 0, cy: 17.2, cz: 0, rx: 2.6, ry: 2.0, rz: 2.6, color: "berrySwirl" },
        // +Z Serving counter arch & pistachio awning
        { op: "box", x0: -7, y0: 7, z0: 7, x1: 7, y1: 8, z1: 10, color: "pistachioTrim" },
        { op: "arch", cx: 0, y0: 2, cz: 7, halfSpan: 3, height: 5, depth: 1, axis: "z", color: "warmGlow" },
      ],
      parts: [],
    },
    "Hearthside Gelato & Waffle Parlor",
  );
}

function buildCompassMapmakerBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Brass Compass Mapmaker & Bindery",
      description:
        "Stone-and-mahogany cartography shop charting island trails, coastal coves, and hand-stitched journals.",
      category: "building",
      scaleClass: "medium",
      palette: {
        stone: "#8d8880",
        mahogany: "#6e3f28",
        parchment: "#f2e6cc",
        brass: "#e3b23c",
        verdigris: "#428f7d",
        globeBlue: "#4aa6d4",
        warmLamp: "#ffe396",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 8, color: "stone" },
        { op: "roundedBox", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, radius: 1.0, color: "parchment" },
        { op: "pillars", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, color: "mahogany" },
        { op: "roofPyramid", x0: -10, yBase: 11, z0: -8, x1: 10, z1: 8, color: "verdigris", trim: "mahogany" },
        { op: "cylinder", axis: "y", cx: 0, y0: 16, y1: 19, cz: 0, radius: 0.9, color: "brass" },
        // Illuminated globe in +Z bay window & arched mahogany door
        { op: "arch", cx: -2, y0: 2, cz: 7, halfSpan: 2, height: 5, depth: 1, axis: "z", color: "warmLamp" },
        { op: "sphere", cx: 4.5, cy: 5, cz: 7.8, rx: 1.6, ry: 1.6, rz: 1.6, color: "globeBlue", emit: 0.65 },
      ],
      parts: [
        {
          name: "compass-rose-vane",
          kind: "spinY",
          speed: 0.9,
          pivot: [0, 21.2, 0],
          ops: [
            { op: "box", x0: -2.0, y0: 0, z0: -0.4, x1: 2.0, y1: 0.5, z1: 0.4, color: "brass" },
            { op: "box", x0: -0.4, y0: 0, z0: -2.0, x1: 0.4, y1: 0.5, z1: 2.0, color: "brass" },
          ],
        },
      ],
    },
    "Brass Compass Mapmaker & Bindery",
  );
}

function buildSurfKayakBoathouseBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Seafoam Kayak & Paddle Boathouse",
      description:
        "Weathered cedar coastal outfitter lending sea kayaks, wooden paddles, and lifejackets.",
      category: "building",
      scaleClass: "medium",
      palette: {
        stone: "#9199a1",
        driftwood: "#b59b7d",
        seafoamRoof: "#3d9c96",
        whiteTrim: "#f7fafc",
        boardCoral: "#f06854",
        boardSunny: "#f7c844",
        warmLantern: "#ffe69e",
      },
      ops: [
        { op: "box", x0: -10, y0: 0, z0: -8, x1: 10, y1: 2, z1: 9, color: "stone" },
        { op: "roundedBox", x0: -9, y0: 2, z0: -7, x1: 9, y1: 11, z1: 7, radius: 1.0, color: "driftwood" },
        { op: "roofGable", x0: -10, yBase: 11, z0: -8, x1: 10, z1: 8, rise: 6, axis: "z", color: "seafoamRoof", trim: "whiteTrim" },
        // Upright surfboards/kayaks flanking the +Z veranda entrance
        { op: "arch", cx: 0, y0: 2, cz: 7, halfSpan: 3, height: 6, depth: 1, axis: "z", color: "warmLantern" },
        { op: "box", x0: -7, y0: 2, z0: 7, x1: -5, y1: 9, z1: 8, color: "boardCoral" },
        { op: "box", x0: 5, y0: 2, z0: 7, x1: 7, y1: 9, z1: 8, color: "boardSunny" },
      ],
      parts: [],
    },
    "Seafoam Kayak & Paddle Boathouse",
  );
}

export const SAFE_COMMUNITY_BUILDING_BATCH2_SPECS: SafeBuildingPlacementSpec[] = [
  // 7 Large Civic & Cultural Landmarks (#16–#22)
  {
    id: "c-safe-bld-16",
    x: 66.0,
    z: 6.0,
    yaw: 1.571,
    spurKind: "cobblestone",
    spurPoints: [
      [72.8, 6.0],
      [76.2, 6.1],
    ],
    creatorPrompt: "A neoclassical sandstone natural history museum with skylight galleries",
    activity: "exhibiting ancient island fossils and geological treasures",
    statusLine: "Natural history museum along the eastern beltway",
    buildBlueprint: buildNaturalHistoryMuseumBlueprint,
  },
  {
    id: "c-safe-bld-17",
    x: -23.0,
    z: 59.0,
    yaw: 0.785,
    spurKind: "cobblestone",
    spurPoints: [
      [-18.0, 64.0],
      [-15.5, 66.5],
    ],
    creatorPrompt: "A domed marine reef aquarium with glowing kelp and coral windows",
    activity: "illuminating tropical reef fish and swaying kelp habitats",
    statusLine: "Living coral reef aquarium along the southern beltway",
    buildBlueprint: buildMarineAquariumBlueprint,
  },
  {
    id: "c-safe-bld-18",
    x: -114.5,
    z: 11.5,
    yaw: 1.571,
    spurKind: "cottage_road",
    spurPoints: [
      [-107.6, 11.5],
      [-104.0, 11.4],
    ],
    creatorPrompt: "A Victorian red-brick and wrought-iron covered farmers market hall",
    activity: "hosting orchard fruit, cheese, and fresh flower stalls",
    statusLine: "Covered culinary farmers market hall in the far west",
    buildBlueprint: buildCulinaryMarketHallBlueprint,
  },
  {
    id: "c-safe-bld-19",
    x: 119.0,
    z: -16.5,
    yaw: 3.142,
    spurKind: "cobblestone",
    spurPoints: [
      [119.0, -23.4],
      [119.0, -27.4],
    ],
    creatorPrompt: "A skylit timber-arch community indoor swimming and aquatic safety center",
    activity: "hosting heated lap swimming and water-safety lessons",
    statusLine: "Community indoor aquatic and swim safety pavilion in the east",
    buildBlueprint: buildAquaticSwimCenterBlueprint,
  },
  {
    id: "c-safe-bld-20",
    x: -15.0,
    z: -111.0,
    yaw: 1.571,
    spurKind: "cobblestone",
    spurPoints: [
      [-8.0, -111.0],
      [-2.8, -111.0],
    ],
    creatorPrompt: "A meteorological observatory and aviation safety hall with radar dome",
    activity: "charting sea breezes and clear skies from its weather dome",
    statusLine: "Weather observatory and aviation safety hall on Spaceport Avenue",
    buildBlueprint: buildAerospaceWeatherHallBlueprint,
  },
  {
    id: "c-safe-bld-21",
    x: -74.0,
    z: 69.5,
    yaw: 2.356,
    spurKind: "cobblestone",
    spurPoints: [
      [-68.5, 64.0],
      [-60.2, 55.8],
    ],
    creatorPrompt: "A tiered emerald wrought-iron camellia tea conservatory",
    activity: "pouring fragrant botanical teas amid blooming camellia trees",
    statusLine: "Emerald glasshouse camellia tea hall in the southwest",
    buildBlueprint: buildCamelliaTeaConservatoryBlueprint,
  },
  {
    id: "c-safe-bld-22",
    x: 136.5,
    z: -78.5,
    yaw: -1.571,
    spurKind: "cobblestone",
    spurPoints: [
      [129.0, -78.5],
      [117.2, -78.4],
    ],
    creatorPrompt: "A heritage timber-and-stone flour mill with twin copper-capped grain silos",
    activity: "milling golden meadow wheat into fine flour for island bakeries",
    statusLine: "Heritage flour mill and copper-domed granary on the northeast road",
    buildBlueprint: buildHeritageGranaryMillBlueprint,
  },

  // 8 Medium Neighborhood Craft, Dining & Outfitter Shops (#23–#30)
  {
    id: "c-safe-bld-23",
    x: 92.0,
    z: -60.5,
    yaw: 3.142,
    spurKind: "cobblestone",
    spurPoints: [
      [92.0, -65.6],
      [92.1, -69.4],
    ],
    creatorPrompt: "A cozy cedar and tiled-roof ramen noodle house with warm lanterns",
    activity: "simmering rich miso broth beneath glowing red lanterns",
    statusLine: "Cedar ramen and noodle house in the northeast neighborhood",
    buildBlueprint: buildLanternRamenHouseBlueprint,
  },
  {
    id: "c-safe-bld-24",
    x: -68.0,
    z: 26.0,
    yaw: -0.785,
    spurKind: "cobblestone",
    spurPoints: [
      [-71.8, 29.8],
      [-73.8, 31.8],
    ],
    creatorPrompt: "A warm brick corner espresso roastery and croissant cafe",
    activity: "roasting small-batch coffee beans and steaming morning lattes",
    statusLine: "Corner brick espresso roastery along the southwest ring",
    buildBlueprint: buildEspressoRoasteryBlueprint,
  },
  {
    id: "c-safe-bld-25",
    x: 7.0,
    z: 73.5,
    yaw: 3.142,
    spurKind: "cobblestone",
    spurPoints: [
      [7.1, 68.2],
      [7.2, 63.4],
    ],
    creatorPrompt: "A cheerful sky-blue neighborhood bicycle and roller-skate workshop",
    activity: "tuning cruiser bicycles and fitting neighborhood safety helmets",
    statusLine: "Neighborhood bicycle and skate workshop on the south ring",
    buildBlueprint: buildBicycleWorkshopBlueprint,
  },
  {
    id: "c-safe-bld-26",
    x: 104.0,
    z: -81.0,
    yaw: 1.571,
    spurKind: "cobblestone",
    spurPoints: [
      [109.2, -81.1],
      [112.2, -81.2],
    ],
    creatorPrompt: "A polished stone and copper lapidary gallery displaying amethyst and emerald gems",
    activity: "polishing glowing amethyst geodes beside the botanical garden",
    statusLine: "Artisan gem and mineral gallery beside the quarry gardens",
    buildBlueprint: buildGemLapidaryGalleryBlueprint,
  },
  {
    id: "c-safe-bld-27",
    x: -91.0,
    z: 30.5,
    yaw: 2.356,
    spurKind: "cobblestone",
    spurPoints: [
      [-87.2, 26.8],
      [-85.0, 24.7],
    ],
    creatorPrompt: "A sunlit whitewashed watercolor painting and art studio",
    activity: "teaching landscape watercolor classes beneath north-light skylights",
    statusLine: "Whitewashed watercolor and art studio in the west meadow",
    buildBlueprint: buildWatercolorArtStudioBlueprint,
  },
  {
    id: "c-safe-bld-28",
    x: 42.0,
    z: -40.0,
    yaw: 2.356,
    spurKind: "cobblestone",
    spurPoints: [
      [47.5, -45.5],
      [56.8, -54.7],
    ],
    creatorPrompt: "A pastel peach and pistachio gelato and warm waffle parlor",
    activity: "scooping pistachio and berry gelato onto crisp Belgian waffles",
    statusLine: "Neighborhood gelato and waffle parlor in the northeast",
    buildBlueprint: buildGelatoWaffleParlorBlueprint,
  },
  {
    id: "c-safe-bld-29",
    x: 99.5,
    z: -19.0,
    yaw: -2.356,
    spurKind: "cobblestone",
    spurPoints: [
      [95.6, -22.9],
      [93.5, -25.0],
    ],
    creatorPrompt: "An old-world stone and mahogany mapmaker and bookbindery with a brass compass vane",
    activity: "hand-binding island trail atlases beneath a spinning brass compass",
    statusLine: "Cartography shop and bookbindery along the east avenue",
    buildBlueprint: buildCompassMapmakerBlueprint,
  },
  {
    id: "c-safe-bld-30",
    x: -10.0,
    z: 78.0,
    yaw: -2.356,
    spurKind: "cobblestone",
    spurPoints: [
      [-13.8, 74.2],
      [-15.9, 72.1],
    ],
    creatorPrompt: "A weathered cedar sea-kayak and paddleboard coastal boathouse",
    activity: "outfitting calm coastal kayak paddles with wooden oars and vests",
    statusLine: "Cedar kayak and paddleboard outfitter near the south shore",
    buildBlueprint: buildSurfKayakBoathouseBlueprint,
  },
];

export function ensureSafeCommunityBuildingsBatch2(state: {
  creations: WorldCreation[];
  paths: WorldPath[];
}): boolean {
  let changed = false;

  for (let i = 0; i < SAFE_COMMUNITY_BUILDING_BATCH2_SPECS.length; i++) {
    const spec = SAFE_COMMUNITY_BUILDING_BATCH2_SPECS[i];
    const existing = state.creations.find((c) => c.id === spec.id);
    if (!existing) {
      const bp = spec.buildBlueprint();
      state.creations.push({
        id: spec.id,
        name: bp.name,
        description: bp.description,
        creatorPrompt: spec.creatorPrompt,
        category: "building",
        scaleClass: bp.scaleClass,
        x: spec.x,
        z: spec.z,
        yaw: spec.yaw,
        blueprint: bp,
        behavior: {
          type: "landmark",
          facingYaw: spec.yaw,
          activity: spec.activity,
          statusLine: spec.statusLine,
        },
        integratedLevel: 2,
        createdAt: 1794435000000 + i * 1000,
        isSeed: false,
      });
      changed = true;
    }

    const spurId = `spur-${spec.id}`;
    if (!state.paths.some((p) => p.id === spurId)) {
      state.paths.push({
        id: spurId,
        kind: spec.spurKind,
        points: spec.spurPoints.map(([px, pz]) => [px, pz]),
      });
      changed = true;
    }
  }

  return changed;
}

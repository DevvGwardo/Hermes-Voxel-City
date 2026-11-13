import type {
  VoxelBlueprint,
  WorldCreation,
  WorldPath,
  WorldProp,
  WorldTerrainZone,
  WorldVillager,
} from "./types";
import { ensureSafeCommunityBuildings } from "./safe_community_buildings";
import { ensureSafeCommunityBuildingsBatch2 } from "./safe_community_buildings_batch2";
import { normalizeAndGroundBlueprint } from "./voxel_dsl";

export const QUARRY_BOTANICAL_GARDEN_ID = "c-quarry-botanical-garden";

/**
 * Lush `"large"` landscaped botanical rose, waterlily, and cherry-blossom garden pavilion
 * grounded flush at Y = 0 with a central Victorian wrought-iron glasshouse gazebo,
 * tiered turquoise marble fountain, four symmetrical floral parterre beds, arched rose
 * trellises on all four approaches, sculpted topiaries, and blooming cherry trees.
 */
export function buildQuarryBotanicalGardenBlueprint(): VoxelBlueprint {
  return normalizeAndGroundBlueprint(
    {
      name: "Quarryside Botanical Garden",
      description:
        "Landscaped botanical rose, waterlily, and cherry-blossom garden oasis beside the northeast quarry and power plant.",
      category: "building",
      scaleClass: "large",
      palette: {
        gravelCream: "#ece3cf",
        stoneTrim: "#d6ccb8",
        stoneWarm: "#bcae97",
        turfRich: "#4ba347",
        hedgeDark: "#2d6f32",
        hedgeBright: "#3f8d42",
        soilDark: "#5e432c",
        ironWhite: "#f5f7f8",
        glassAqua: "#bcecf5",
        marblePool: "#2a9dad",
        waterBright: "#6ce3ec",
        foam: "#f2fdff",
        rosePink: "#ec658e",
        roseCrimson: "#d13b5c",
        lavender: "#9b72dc",
        sunGold: "#f6c844",
        hydrangea: "#63b4f2",
        blossomPale: "#ffd4e5",
        blossomMid: "#f598bc",
        woodWarm: "#8b5a34",
        lanternGold: "#ffe38e",
        brass: "#d4a438",
      },
      ops: [
        // 1. Flush garden terrace lawn & limestone perimeter curb at Y = 0..1 (zero floating slab!)
        { op: "roundedBox", x0: -18, y0: 0, z0: -18, x1: 18, y1: 1, z1: 18, radius: 3.0, color: "turfRich" },
        // Cruciform gravel garden promenades along X = 0 and Z = 0
        { op: "box", x0: -3, y0: 0, z0: -18, x1: 3, y1: 1, z1: 18, color: "gravelCream" },
        { op: "box", x0: -18, y0: 0, z0: -3, x1: 18, y1: 1, z1: 3, color: "gravelCream" },
        { op: "cylinder", axis: "y", cx: 0, y0: 0, y1: 1, cz: 0, radius: 8.4, color: "gravelCream" },

        // Low sculpted perimeter hedge walls with four wide gateway openings
        { op: "box", x0: -17, y0: 1, z0: -18, x1: -5, y1: 3, z1: -16, color: "hedgeDark", mirrorX: true },
        { op: "box", x0: -17, y0: 1, z0: 16, x1: -5, y1: 3, z1: 18, color: "hedgeDark", mirrorX: true },
        { op: "box", x0: -18, y0: 1, z0: -16, x1: -16, y1: 3, z1: -5, color: "hedgeDark", mirrorX: true },
        { op: "box", x0: -18, y0: 1, z0: 5, x1: -16, y1: 3, z1: 16, color: "hedgeDark", mirrorX: true },

        // 2. Four limestone-edged parterre flowerbeds brimming with roses, lavender, sunflowers & hydrangeas
        // NW & NE parterres (z = -14..-6)
        { op: "roundedBox", x0: 6, y0: 1, z0: -14, x1: 14, y1: 2, z1: -6, radius: 1.2, color: "stoneTrim", mirrorX: true },
        { op: "box", x0: 7, y0: 2, z0: -13, x1: 13, y1: 3, z1: -7, color: "soilDark", mirrorX: true },
        { op: "box", x0: 7, y0: 3, z0: -13, x1: 10, y1: 4, z1: -10, color: "rosePink", mirrorX: true },
        { op: "box", x0: 10, y0: 3, z0: -13, x1: 13, y1: 4, z1: -10, color: "sunGold", mirrorX: true },
        { op: "box", x0: 7, y0: 3, z0: -10, x1: 10, y1: 4, z1: -7, color: "lavender", mirrorX: true },
        { op: "box", x0: 10, y0: 3, z0: -10, x1: 13, y1: 4, z1: -7, color: "hydrangea", mirrorX: true },

        // SW & SE parterres (z = +6..+14)
        { op: "roundedBox", x0: 6, y0: 1, z0: 6, x1: 14, y1: 2, z1: 14, radius: 1.2, color: "stoneTrim", mirrorX: true },
        { op: "box", x0: 7, y0: 2, z0: 7, x1: 13, y1: 3, z1: 13, color: "soilDark", mirrorX: true },
        { op: "box", x0: 7, y0: 3, z0: 7, x1: 10, y1: 4, z1: 10, color: "roseCrimson", mirrorX: true },
        { op: "box", x0: 10, y0: 3, z0: 7, x1: 13, y1: 4, z1: 10, color: "lavender", mirrorX: true },
        { op: "box", x0: 7, y0: 3, z0: 10, x1: 10, y1: 4, z1: 13, color: "sunGold", mirrorX: true },
        { op: "box", x0: 10, y0: 3, z0: 10, x1: 13, y1: 4, z1: 13, color: "rosePink", mirrorX: true },

        // Sculpted emerald topiary spheres anchoring parterre inner corners
        { op: "cylinder", axis: "y", cx: 6, y0: 1, y1: 3, cz: 6, radius: 0.9, color: "woodWarm", mirrorX: true },
        { op: "sphere", cx: 6, cy: 4.5, cz: 6, rx: 1.8, ry: 2.0, rz: 1.8, color: "hedgeBright", mirrorX: true },
        { op: "cylinder", axis: "y", cx: 6, y0: 1, y1: 3, cz: -6, radius: 0.9, color: "woodWarm", mirrorX: true },
        { op: "sphere", cx: 6, cy: 4.5, cz: -6, rx: 1.8, ry: 2.0, rz: 1.8, color: "hedgeBright", mirrorX: true },

        // 3. Central Victorian Glasshouse Gazebo & Tiered Waterlily Fountain
        // Outer white-iron pavilion columns (8 octagonal-feel posts around radius ~6.2)
        { op: "cylinder", axis: "y", cx: 4.5, y0: 1, y1: 11, cz: 4.5, radius: 0.8, color: "ironWhite", mirrorX: true },
        { op: "cylinder", axis: "y", cx: 4.5, y0: 1, y1: 11, cz: -4.5, radius: 0.8, color: "ironWhite", mirrorX: true },
        { op: "cylinder", axis: "y", cx: 6.2, y0: 1, y1: 11, cz: 0, radius: 0.8, color: "ironWhite", mirrorX: true },
        { op: "cylinder", axis: "y", cx: 0, y0: 1, y1: 11, cz: 6.2, radius: 0.8, color: "ironWhite" },
        { op: "cylinder", axis: "y", cx: 0, y0: 1, y1: 11, cz: -6.2, radius: 0.8, color: "ironWhite" },
        // Ornate ring cornice & translucent botanical glass dome overhead (Y = 11..19)
        { op: "ring", axis: "y", cx: 0, y0: 11, y1: 13, cz: 0, outerR: 6.8, innerR: 5.4, color: "ironWhite" },
        { op: "dome", cx: 0, yBase: 12, cz: 0, radius: 6.0, color: "glassAqua", emit: 0.25 },
        { op: "ring", axis: "y", cx: 0, y0: 15, y1: 16, cz: 0, outerR: 4.9, innerR: 4.0, color: "ironWhite" },
        { op: "cylinder", axis: "y", cx: 0, y0: 18, y1: 21, cz: 0, radius: 0.9, color: "brass" },

        // Central turquoise waterlily fountain basin at Y = 1..5
        { op: "ring", axis: "y", cx: 0, y0: 1, y1: 3, cz: 0, outerR: 3.8, innerR: 2.8, color: "stoneTrim" },
        { op: "cylinder", axis: "y", cx: 0, y0: 1, y1: 2, cz: 0, radius: 2.9, color: "marblePool", emit: 0.35 },
        { op: "cylinder", axis: "y", cx: 0, y0: 2, y1: 5, cz: 0, radius: 0.9, color: "stoneTrim" },
        { op: "cylinder", axis: "y", cx: 0, y0: 5, y1: 6, cz: 0, radius: 1.8, color: "waterBright", emit: 0.55 },

        // 4. Four Arched Rose Trellises framing the N/S/E/W entrances (+Z main entrance arch)
        { op: "arch", cx: 0, y0: 1, cz: 16, halfSpan: 3, height: 7, depth: 2, axis: "z", color: "ironWhite" },
        { op: "arch", cx: 0, y0: 1, cz: -16, halfSpan: 3, height: 7, depth: 2, axis: "z", color: "ironWhite" },
        { op: "arch", cx: 16, y0: 1, cz: 0, halfSpan: 3, height: 7, depth: 2, axis: "x", color: "ironWhite" },
        { op: "arch", cx: -16, y0: 1, cz: 0, halfSpan: 3, height: 7, depth: 2, axis: "x", color: "ironWhite" },
        // Climbing rose garlands crowning each archway
        { op: "sphere", cx: 0, cy: 8.5, cz: 16, rx: 3.2, ry: 1.3, rz: 1.5, color: "rosePink" },
        { op: "sphere", cx: 0, cy: 8.5, cz: -16, rx: 3.2, ry: 1.3, rz: 1.5, color: "rosePink" },
        { op: "sphere", cx: 16, cy: 8.5, cz: 0, rx: 1.5, ry: 1.3, rz: 3.2, color: "blossomMid" },
        { op: "sphere", cx: -16, cy: 8.5, cz: 0, rx: 1.5, ry: 1.3, rz: 3.2, color: "blossomMid" },

        // 5. Four Flowering Cherry-Blossom Trees at the outer corners
        { op: "cylinder", axis: "y", cx: 14, y0: 1, y1: 7, cz: 14, radius: 1.0, color: "woodWarm", mirrorX: true },
        { op: "sphere", cx: 14, cy: 9, cz: 14, rx: 3.6, ry: 2.8, rz: 3.6, color: "blossomPale", mirrorX: true },
        { op: "sphere", cx: 13, cy: 10.5, cz: 13, rx: 2.4, ry: 1.8, rz: 2.4, color: "blossomMid", mirrorX: true },

        { op: "cylinder", axis: "y", cx: 14, y0: 1, y1: 7, cz: -14, radius: 1.0, color: "woodWarm", mirrorX: true },
        { op: "sphere", cx: 14, cy: 9, cz: -14, rx: 3.6, ry: 2.8, rz: 3.6, color: "blossomPale", mirrorX: true },
        { op: "sphere", cx: 13, cy: 10.5, cz: -13, rx: 2.4, ry: 1.8, rz: 2.4, color: "blossomMid", mirrorX: true },

        // 6. Warm Brass Garden Lanterns & Cedar Benches along the central plaza
        { op: "box", x0: 4, y0: 1, z0: 9, x1: 5, y1: 5, z1: 10, color: "brass", mirrorX: true },
        { op: "box", x0: 4, y0: 5, z0: 9, x1: 5, y1: 6, z1: 10, color: "lanternGold", emit: 1.15, mirrorX: true },
        { op: "box", x0: 4, y0: 1, z0: -10, x1: 5, y1: 5, z1: -9, color: "brass", mirrorX: true },
        { op: "box", x0: 4, y0: 5, z0: -10, x1: 5, y1: 6, z1: -9, color: "lanternGold", emit: 1.15, mirrorX: true },
        { op: "box", x0: 9, y0: 1, z0: 4, x1: 12, y1: 2, z1: 5, color: "woodWarm", mirrorX: true },
        { op: "box", x0: 9, y0: 1, z0: -5, x1: 12, y1: 2, z1: -4, color: "woodWarm", mirrorX: true },
      ],
      parts: [
        {
          // Suspended cleanly in open air between fountain tier (y=6) and dome ceiling (y=12) with zero contact!
          name: "fountain-crystal-spray",
          kind: "bob",
          speed: 2.1,
          amp: 0.35,
          phase: 0,
          pivot: [0, 8.2, 0],
          ops: [
            { op: "sphere", cx: 0, cy: 0, cz: 0, rx: 1.1, ry: 1.4, rz: 1.1, color: "foam", emit: 0.85 },
          ],
        },
      ],
    },
    "Quarryside Botanical Garden",
  );
}

/**
 * Applies the user-curated landmark relocations and Quarryside Botanical Garden area
 * idempotently across seed & persisted world snapshots:
 * 1. Moves Sydney Terrace Row (`c-mvssze4o-1191dc`) next to Animorphosis Transformation Shop (`c-mvr5pfn3-74d357`).
 * 2. Moves Springfield Nuclear Power Plant (`c-mvqyc53g-60ace9`) near Borealis Mineral Quarry (`c-mvnc7tlr-6784e6`)
 *    and creates a lush landscaped botanical garden area beside them.
 * 3. Moves Emerald Cliff Waterfall (`c-mvn0lbb4-74136e`) to where the Nuclear Power Plant was previously,
 *    pushed out to the northwest ocean shoreline (`[-114, -114]`).
 */
export function applyCuratedDistrictRelocations(state: {
  creations: WorldCreation[];
  paths: WorldPath[];
  props: WorldProp[];
  terrainZones: WorldTerrainZone[];
  villagers: WorldVillager[];
}): boolean {
  let changed = false;

  const upsertPath = (nextPath: WorldPath) => {
    const idx = state.paths.findIndex((p) => p.id === nextPath.id);
    if (idx >= 0) {
      if (JSON.stringify(state.paths[idx]) !== JSON.stringify(nextPath)) {
        state.paths[idx] = nextPath;
        changed = true;
      }
    } else {
      state.paths.push(nextPath);
      changed = true;
    }
  };

  const upsertProp = (nextProp: WorldProp) => {
    const idx = state.props.findIndex((pr) => pr.id === nextProp.id);
    if (idx >= 0) {
      if (JSON.stringify(state.props[idx]) !== JSON.stringify(nextProp)) {
        state.props[idx] = nextProp;
        changed = true;
      }
    } else {
      state.props.push(nextProp);
      changed = true;
    }
  };

  const upsertZone = (nextZone: WorldTerrainZone) => {
    const idx = state.terrainZones.findIndex((z) => z.id === nextZone.id);
    if (idx >= 0) {
      if (JSON.stringify(state.terrainZones[idx]) !== JSON.stringify(nextZone)) {
        state.terrainZones[idx] = nextZone;
        changed = true;
      }
    } else {
      state.terrainZones.push(nextZone);
      changed = true;
    }
  };

  // -------------------------------------------------------------------------
  // 1. Move Sydney Terrace Row (`c-mvssze4o-1191dc`) next to Animorphosis (`[-48.2, -3.4]`)
  // -------------------------------------------------------------------------
  const sydneyTerrace = state.creations.find((c) => c.id === "c-mvssze4o-1191dc");
  if (sydneyTerrace) {
    const targetX = -61.6;
    const targetZ = -3.2;
    const targetYaw = -3.142;
    const targetDesc =
      "Historic inner-city terrace homes next to the Animorphosis shop along the western lane.";
    const targetStatus =
      "Heritage terrace homes next to the Animorphosis shop on the western lane";
    if (
      Math.hypot(sydneyTerrace.x - targetX, sydneyTerrace.z - targetZ) > 0.2 ||
      Math.abs((sydneyTerrace.yaw ?? 0) - targetYaw) > 0.05 ||
      sydneyTerrace.description !== targetDesc
    ) {
      sydneyTerrace.x = targetX;
      sydneyTerrace.z = targetZ;
      sydneyTerrace.yaw = targetYaw;
      sydneyTerrace.description = targetDesc;
      if (sydneyTerrace.blueprint) {
        sydneyTerrace.blueprint.description = targetDesc;
      }
      if (sydneyTerrace.behavior?.type === "landmark") {
        sydneyTerrace.behavior = {
          ...sydneyTerrace.behavior,
          facingYaw: targetYaw,
          statusLine: targetStatus,
        };
      }
      changed = true;
    }
    upsertPath({
      id: "spur-c-mvssze4o-1191dc",
      kind: "cobblestone",
      points: [
        [-61.6, -6.2],
        [-61.6, -9.2],
      ],
    });
  }

  // -------------------------------------------------------------------------
  // 2. Move Springfield Nuclear Power Plant (`c-mvqyc53g-60ace9`) near Borealis Quarry (`[118, -114]`)
  //    + Create Lush Quarryside Botanical Garden Area
  // -------------------------------------------------------------------------
  const nuclearPlant = state.creations.find((c) => c.id === "c-mvqyc53g-60ace9");
  if (nuclearPlant) {
    const targetX = 92.0;
    const targetZ = -124.0;
    const targetYaw = 0;
    const targetDesc =
      "Primary municipal nuclear power facility generating electric energy beside the northeast quarry and botanical gardens.";
    const targetStatus =
      "Municipal nuclear power plant beside the northeast quarry and gardens";
    if (
      Math.hypot(nuclearPlant.x - targetX, nuclearPlant.z - targetZ) > 0.2 ||
      nuclearPlant.description !== targetDesc
    ) {
      nuclearPlant.x = targetX;
      nuclearPlant.z = targetZ;
      nuclearPlant.yaw = targetYaw;
      nuclearPlant.description = targetDesc;
      if (nuclearPlant.blueprint) {
        nuclearPlant.blueprint.description = targetDesc;
      }
      if (nuclearPlant.behavior?.type === "landmark") {
        nuclearPlant.behavior = {
          ...nuclearPlant.behavior,
          facingYaw: targetYaw,
          statusLine: targetStatus,
        };
      }
      changed = true;
    }
    upsertPath({
      id: "spur-c-mvqyc53g-60ace9",
      kind: "cobblestone",
      points: [
        [92.0, -113.2],
        [99.5, -104.5],
        [114.2, -98.8],
      ],
    });

    // Keep northern perimeter wanderer clear of the relocated Power Plant & Botanical Garden
    const fusionTitan = state.creations.find((c) => c.id === "c-mw9tr0at-5785ad");
    if (
      fusionTitan &&
      fusionTitan.behavior?.type === "wander" &&
      Math.hypot(fusionTitan.x - targetX, fusionTitan.z - targetZ) < 22
    ) {
      fusionTitan.x = 66.0;
      fusionTitan.z = -128.0;
      fusionTitan.behavior = {
        ...fusionTitan.behavior,
        homeX: 66.0,
        homeZ: -128.0,
        targets: [
          [66.0, -128.0],
          [44.0, -124.0],
          [32.0, -114.0],
          [54.0, -138.0],
        ],
      };
      changed = true;
    }
  }

  // Ensure Quarryside Botanical Garden creation exists right beside the Quarry & Power Plant
  let quarryGarden = state.creations.find((c) => c.id === QUARRY_BOTANICAL_GARDEN_ID);
  if (!quarryGarden) {
    const bp = buildQuarryBotanicalGardenBlueprint();
    quarryGarden = {
      id: QUARRY_BOTANICAL_GARDEN_ID,
      name: bp.name,
      description: bp.description,
      creatorPrompt: "A lush landscaped botanical garden with rose beds, cherry blossoms, and a Victorian gazebo fountain",
      category: "building",
      scaleClass: "large",
      x: 100.0,
      z: -94.0,
      yaw: 1.571,
      blueprint: bp,
      behavior: {
        type: "landmark",
        facingYaw: 1.571,
        activity: "sparkling its waterlily fountain amid blooming rose parterres and cherry trees",
        statusLine: "Botanical rose and waterlily garden oasis beside the quarry and power plant",
      },
      integratedLevel: 2,
      createdAt: 1794433500000,
      isSeed: false,
    };
    state.creations.push(quarryGarden);
    changed = true;
  } else if (Math.hypot(quarryGarden.x - 100.0, quarryGarden.z - -94.0) > 0.2) {
    quarryGarden.x = 100.0;
    quarryGarden.z = -94.0;
    changed = true;
  }

  upsertPath({
    id: `spur-${QUARRY_BOTANICAL_GARDEN_ID}`,
    kind: "cobblestone",
    points: [
      [107.5, -94.0],
      [113.8, -94.0],
    ],
  });

  // Remove old NW desert sand zone (`zone-f647a04f` under flying UFO) so NW waterfall coast is mossy green
  // and total terrainZones stays well within the 28-zone shader budget.
  const staleDesertIdx = state.terrainZones.findIndex((z) => z.id === "zone-f647a04f");
  if (staleDesertIdx >= 0) {
    state.terrainZones.splice(staleDesertIdx, 1);
    changed = true;
  }

  upsertZone({
    id: "zone-quarry-garden",
    biome: "meadow_clover",
    x: 98.0,
    z: -99.0,
    radius: 19,
  });

  // Scenic lily pond, flower patches, blossom tree clusters, benches, lamps & signpost for the garden area
  upsertProp({
    id: "prop-quarry-garden-pond",
    kind: "pond",
    x: 89.5,
    z: -105.0,
    yaw: 0,
    radius: 4.0,
  });
  upsertProp({
    id: "prop-quarry-garden-flowers-1",
    kind: "flower_patch",
    x: 108.5,
    z: -103.0,
    yaw: 0.4,
    radius: 3.2,
  });
  upsertProp({
    id: "prop-quarry-garden-flowers-2",
    kind: "flower_patch",
    x: 91.5,
    z: -86.5,
    yaw: 1.8,
    radius: 3.2,
  });
  upsertProp({
    id: "prop-quarry-garden-trees-1",
    kind: "tree_cluster",
    x: 82.5,
    z: -112.0,
    yaw: 0.9,
    radius: 3.5,
  });
  upsertProp({
    id: "prop-quarry-garden-trees-2",
    kind: "tree_cluster",
    x: 105.5,
    z: -125.0,
    yaw: 2.2,
    radius: 3.5,
  });
  upsertProp({
    id: "prop-quarry-garden-bench-1",
    kind: "bench",
    x: 95.2,
    z: -104.5,
    yaw: -1.571,
    label: "Lily Pond Garden Bench",
  });
  upsertProp({
    id: "prop-quarry-garden-bench-2",
    kind: "bench",
    x: 107.2,
    z: -90.5,
    yaw: 1.571,
    label: "Quarryside Rose Garden Bench",
  });
  upsertProp({
    id: "prop-quarry-garden-lamp-1",
    kind: "lamp_post",
    x: 107.8,
    z: -96.2,
    yaw: 0,
  });
  upsertProp({
    id: "prop-quarry-garden-sign",
    kind: "signpost",
    x: 111.8,
    z: -91.5,
    yaw: 1.571,
    label: "Quarryside Botanical Garden",
  });

  if (!state.villagers.some((v) => v.id === "villager-flora-quarry")) {
    state.villagers.push({
      id: "villager-flora-quarry",
      name: "Flora",
      role: "gardener",
      hatColor: "#f6c844",
      shirtColor: "#ec658e",
      homeX: 107.5,
      homeZ: -94.0,
      stops: [
        [107.5, -94.0],
        [95.2, -104.5],
        [99.5, -86.5],
      ],
      usesTransit: false,
    });
    changed = true;
  }

  // -------------------------------------------------------------------------
  // 3. Move Emerald Cliff Waterfall (`c-mvn0lbb4-74136e`) to where the Nuclear Power Plant was
  //    previously (`[-78.2, -94.7]` radial), except right near the northwest ocean water (`[-114, -114]`)
  // -------------------------------------------------------------------------
  const waterfall = state.creations.find((c) => c.id === "c-mvn0lbb4-74136e");
  if (waterfall) {
    const targetX = -114.0;
    const targetZ = -114.0;
    const targetYaw = 0.7854; // Facing SE (+X, +Z) inland from the NW coastal cliff edge
    const targetDesc =
      "Northwest coastal waterfall cascading beside the ocean shore and feeding fresh mountain water into the island's streams.";
    const targetStatus =
      "Coastal waterfall cascading beside the northwest ocean shore";
    if (
      Math.hypot(waterfall.x - targetX, waterfall.z - targetZ) > 0.2 ||
      Math.abs((waterfall.yaw ?? 0) - targetYaw) > 0.05 ||
      waterfall.description !== targetDesc
    ) {
      waterfall.x = targetX;
      waterfall.z = targetZ;
      waterfall.yaw = targetYaw;
      waterfall.description = targetDesc;
      if (waterfall.blueprint) {
        waterfall.blueprint.description = targetDesc;
      }
      if (waterfall.behavior?.type === "landmark") {
        waterfall.behavior = {
          ...waterfall.behavior,
          facingYaw: targetYaw,
          statusLine: targetStatus,
        };
      }
      changed = true;
    }

    upsertZone({
      id: "zone-waterfall-lagoon",
      biome: "misty_moss",
      x: -112.0,
      z: -112.0,
      radius: 21,
    });

    // Keep Secret Bunker Entrance (`c-mvvof1qs-c35822` at `[-90.4, -149.3]`) connected to `path-outer-ring`
    if (state.creations.some((c) => c.id === "c-mvvof1qs-c35822")) {
      upsertPath({
        id: "spur-c-mvvof1qs-c35822",
        kind: "cottage_road",
        points: [
          [-88.9, -145.3],
          [-68.9, -145.3],
          [-68.9, -92.0],
          [-46.7, -80.4],
          [-42.5, -82.4],
        ],
      });
    }

    // Scenic NW coastal boardwalk leading out past the former power-plant meadow to the Waterfall lagoon
    upsertPath({
      id: "spur-c-mvn0lbb4-74136e",
      kind: "boardwalk",
      points: [
        [-102.0, -102.0],
        [-84.0, -78.0],
        [-80.4, -46.8],
      ],
    });

    upsertProp({
      id: "prop-nw-waterfall-bench",
      kind: "bench",
      x: -99.5,
      z: -104.5,
      yaw: -2.356,
      label: "Coastal Waterfall Overlook",
    });

    // Ensure Tropical Palm Grove (`c-mwafobip-90526d`) in the south connects cleanly to `path-outer-ring`
    // now that the waterfall moved from `[-14, 91]` to the NW coast
    if (state.creations.some((c) => c.id === "c-mwafobip-90526d")) {
      upsertPath({
        id: "spur-c-mwafobip-90526d",
        kind: "boardwalk",
        points: [
          [15.8, 118.3],
          [12.8, 65.5],
        ],
      });
    }
  }

  if (ensureSafeCommunityBuildings({ creations: state.creations, paths: state.paths })) {
    changed = true;
  }

  if (ensureSafeCommunityBuildingsBatch2({ creations: state.creations, paths: state.paths })) {
    changed = true;
  }

  return changed;
}

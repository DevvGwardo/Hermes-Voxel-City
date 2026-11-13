import { sanitizeLiveFeed } from "./live_feeds";
import { sanitizePlainText } from "./security";
import { autoRepairBlueprintOverlaps } from "./voxel_audit";
import type {
  BlueprintAmendment,
  BlueprintCriticReview,
  BlueprintInteraction,
  CreationCategory,
  InteractionKind,
  ScaleClass,
  VoxelBlueprint,
  VoxelOp,
  VoxelPart,
  VoxelPartKind,
} from "./types";

export const VOX_PALETTE: Record<string, string> = {
  grass: "#86c864",
  grass2: "#78ba57",
  grass3: "#97d675",
  soil: "#8b5e3c",
  soilDark: "#70492c",
  path: "#e6d6b5",
  path2: "#d8c6a1",
  concrete: "#dcd6cb",
  concrete2: "#cfcac0",
  concreteDark: "#b4afa5",
  asphalt: "#585b63",
  slate: "#434854",
  slateLight: "#656d7d",
  brick: "#cc7a57",
  brick2: "#b96947",
  brickDark: "#945036",
  mortar: "#e5cbb0",
  plaster: "#f2eadb",
  cream: "#faf3e3",
  limestone: "#e8dfc8",
  marble: "#f5f2ec",
  marbleShade: "#e1ddd4",
  granite: "#7a7e85",
  wood: "#c9935b",
  woodLight: "#deb07c",
  woodDark: "#8f5e36",
  oak: "#a87444",
  crate: "#d4a366",
  leather: "#6e4328",
  terracotta: "#c86d49",
  steel: "#8c99a6",
  steelLight: "#b4c0cc",
  steelDark: "#59636e",
  iron: "#3b4048",
  chrome: "#d8e2eb",
  brass: "#d9a74a",
  gold: "#f4c44e",
  goldDark: "#c79428",
  copper: "#c8754b",
  hazard: "#f2be38",
  red: "#df5246",
  redDark: "#a8342b",
  crimson: "#be3438",
  orange: "#ec8438",
  amber: "#ffb642",
  yellow: "#f6d55c",
  busYellow: "#f5b82e",
  lime: "#96d65f",
  leaf: "#58ad52",
  leafDark: "#3e853b",
  leafLight: "#78c86c",
  teal: "#47b0a3",
  tealDark: "#2d7d74",
  cyan: "#5ce6db",
  sky: "#6fb7f0",
  water: "#4fa8de",
  blue: "#4c82d4",
  blueDark: "#2f5696",
  indigo: "#5b63b8",
  purple: "#9370cf",
  purpleDark: "#65469c",
  pink: "#ec8db0",
  magenta: "#d95ca3",
  white: "#fcfaf5",
  silver: "#c5ccd4",
  charcoal: "#262930",
  rubber: "#23252b",
  black: "#181a20",
  glass: "#b8e4f2",
  warmGlow: "#ffe29a",
  screenCyan: "#64f5df",
  screenGreen: "#5ef28c",
  fire: "#ff7426",
  lava: "#ff5a1f",
  basalt: "#363840",
  ash: "#6c6e75",
  sand: "#ead39c",
  moss: "#4b9645",
  snow: "#f3f7fc",
};

export const VOXEL_UNIT = 0.25;
export const SCALE_FACTORS: Record<ScaleClass, number> = {
  tiny: 0.4,
  small: 0.56,
  medium: 0.92,
  large: 1.14,
  colossal: 1.72,
};

export function getWorldVoxelSize(scaleClass: ScaleClass | string | undefined): number {
  const f = SCALE_FACTORS[scaleClass as ScaleClass] ?? SCALE_FACTORS.medium;
  return VOXEL_UNIT * f;
}

export function getCreationFootprintRadius(
  scaleClass: ScaleClass | string | undefined,
  footprintX = 14,
  footprintZ = 14,
): number {
  const voxSize = getWorldVoxelSize(scaleClass);
  const maxSpan = Math.max(4, footprintX, footprintZ);
  const minSpan = Math.max(4, Math.min(footprintX, footprintZ));
  const effectiveHalfSpan = (maxSpan * 0.72 + minSpan * 0.28) * 0.5 * voxSize;
  const minR =
    scaleClass === "colossal"
      ? 7.2
      : scaleClass === "large"
        ? 3.8
        : scaleClass === "medium"
          ? 2.6
          : scaleClass === "small"
            ? 1.7
            : 1.05;
  return Number(Math.max(minR, Math.min(14.5, effectiveHalfSpan + 0.35)).toFixed(2));
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const PART_KINDS: Record<VoxelPartKind, true> = {
  wheel: true,
  spinY: true,
  spinZ: true,
  spinX: true,
  bob: true,
  swingX: true,
  swingY: true,
  swingZ: true,
};

const CATEGORIES: Record<CreationCategory, true> = {
  vehicle: true,
  creature: true,
  building: true,
  prop: true,
  aircraft: true,
  watercraft: true,
};

const SCALES: Record<ScaleClass, true> = {
  tiny: true,
  small: true,
  medium: true,
  large: true,
  colossal: true,
};

const num = (v: unknown, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const clamp = (v: number, lo: number, hi: number): number => {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
};

function orderedSpan(aRaw: unknown, bRaw: unknown, defA: number, defB: number): [number, number] {
  let a = Math.round(num(aRaw, defA));
  let b = Math.round(num(bRaw, defB));
  if (a > b) [a, b] = [b, a];
  if (a === b) b = a + 1;
  return [a, b];
}

function hashToken(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SAFE_TOKEN_RE = /^[a-zA-Z0-9_-]{1,28}$/;

export function normalizeColorToken(raw: unknown, palette: Record<string, string>, fallback = "cream"): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return fallback;
  if (HEX_RE.test(name)) return name.toLowerCase();
  if (!SAFE_TOKEN_RE.test(name) || name === "__proto__" || name === "constructor" || name === "prototype") {
    return fallback;
  }
  if (Object.hasOwn(palette, name) && HEX_RE.test(palette[name])) return name;
  if (Object.hasOwn(VOX_PALETTE, name)) return name;
  const lower = name.toLowerCase();
  for (const k of Object.keys(VOX_PALETTE)) {
    if (k.toLowerCase() === lower) return k;
  }
  if (Object.keys(palette).length >= 32) return fallback;
  if (lower.includes("yellow") || lower.includes("amber")) palette[name] = "#f5b82e";
  else if (lower.includes("red") || lower.includes("crimson")) palette[name] = "#df5246";
  else if (lower.includes("glass") || lower.includes("window")) palette[name] = "#b8e4f2";
  else if (lower.includes("tire") || lower.includes("rubber") || lower.includes("dark")) palette[name] = "#23252b";
  else if (lower.includes("wood") || lower.includes("fur") || lower.includes("brown")) palette[name] = "#c9935b";
  else if (lower.includes("leaf") || lower.includes("green")) palette[name] = "#58ad52";
  else if (lower.includes("gold") || lower.includes("brass")) palette[name] = "#f4c44e";
  else {
    const swatches = ["#e8a85a", "#5d9be3", "#d96b52", "#65b891", "#9b7bd4", "#e388ad", "#d8c39e"];
    palette[name] = swatches[hashToken(name) % swatches.length];
  }
  return name;
}

interface SimCell {
  x: number;
  y: number;
  z: number;
  color: string;
  emit: number;
}

export class SimVox {
  v = new Map<string, SimCell>();

  get size(): number {
    return this.v.size;
  }

  put(x: number, y: number, z: number, color: string | null, emit = 0): this {
    const xi = Math.round(x);
    const yi = Math.round(y);
    const zi = Math.round(z);
    const k = `${xi | 0},${yi | 0},${zi | 0}`;
    if (!color) this.v.delete(k);
    else this.v.set(k, { x: xi, y: yi, z: zi, color, emit: Number(emit) || 0 });
    return this;
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string | null, emit = 0): this {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const ay0 = Math.round(Math.min(y0, y1)), ay1 = Math.round(Math.max(y0, y1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    for (let x = ax0; x < ax1; x++) {
      for (let y = ay0; y < ay1; y++) {
        for (let z = az0; z < az1; z++) {
          this.put(x, y, z, color, emit);
        }
      }
    }
    return this;
  }

  roundedBox(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    radius: number,
    color: string,
    emit = 0,
  ): this {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const ay0 = Math.round(Math.min(y0, y1)), ay1 = Math.round(Math.max(y0, y1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    const r = Math.max(0.5, Math.min(radius, (ax1 - ax0) / 2, (ay1 - ay0) / 2, (az1 - az0) / 2));
    const ix0 = ax0 + r, ix1 = ax1 - r;
    const iy0 = ay0 + r, iy1 = ay1 - r;
    const iz0 = az0 + r, iz1 = az1 - r;
    const r2 = (r + 0.15) * (r + 0.15);
    for (let x = ax0; x < ax1; x++) {
      const px = x + 0.5;
      const dx = px < ix0 ? ix0 - px : px > ix1 ? px - ix1 : 0;
      for (let y = ay0; y < ay1; y++) {
        const py = y + 0.5;
        const dy = py < iy0 ? iy0 - py : py > iy1 ? py - iy1 : 0;
        for (let z = az0; z < az1; z++) {
          const pz = z + 0.5;
          const dz = pz < iz0 ? iz0 - pz : pz > iz1 ? pz - iz1 : 0;
          if (dx * dx + dy * dy + dz * dz <= r2) {
            this.put(x, y, z, color, emit);
          }
        }
      }
    }
    return this;
  }

  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.box(x0, y0, z0, x1, y1, z1, null);
  }

  pillars(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string): this {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    for (const px of [ax0, ax1 - 1]) {
      for (const pz of [az0, az1 - 1]) {
        this.box(px, y0, pz, px + 1, y1, pz + 1, color);
      }
    }
    return this;
  }

  hollowBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall = 1, color = "plaster", trim: string | null = null): this {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const ay0 = Math.round(Math.min(y0, y1)), ay1 = Math.round(Math.max(y0, y1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    this.box(ax0, ay0, az0, ax1, ay1, az1, color);
    if (ax1 - ax0 > wall * 2 && az1 - az0 > wall * 2 && ay1 - ay0 > wall) {
      this.clear(ax0 + wall, ay0 + wall, az0 + wall, ax1 - wall, ay1, az1 - wall);
    }
    if (trim) {
      this.pillars(ax0, ay0, az0, ax1, ay1, az1, trim);
      this.box(ax0, ay1 - 1, az0, ax1, ay1, az0 + 1, trim);
      this.box(ax0, ay1 - 1, az1 - 1, ax1, ay1, az1, trim);
      this.box(ax0, ay1 - 1, az0, ax0 + 1, ay1, az1, trim);
      this.box(ax1 - 1, ay1 - 1, az0, ax1, ay1, az1, trim);
    }
    return this;
  }

  plinth(sizeX = 16, heightY = 2, sizeZ = 16, baseCol = "concrete2", topCol = "limestone", cornerCol = "brass"): this {
    const hx = Math.floor(sizeX / 2), hz = Math.floor(sizeZ / 2);
    this.box(-hx - 1, 0, -hz - 1, hx + 1, 1, hz + 1, baseCol);
    if (heightY >= 2) {
      this.box(-hx, 1, -hz, hx, heightY, hz, topCol);
      for (const [cx, cz] of [[-hx, -hz], [hx - 1, -hz], [-hx, hz - 1], [hx - 1, hz - 1]]) {
        this.put(cx, heightY - 1, cz, cornerCol);
      }
    }
    return this;
  }

  cylinderAxis(axis: "x" | "y" | "z", c1: number, c2: number, s0: number, s1: number, radius: number, color: string | null, emit = 0): this {
    const ri = Math.ceil(Math.max(0.5, radius)) + 1;
    const as0 = Math.round(Math.min(s0, s1));
    const as1 = Math.max(as0 + 1, Math.round(Math.max(s0, s1)));
    const r2 = radius * radius + 0.18;
    for (let u = Math.floor(c1 - ri); u <= Math.ceil(c1 + ri); u++) {
      for (let v = Math.floor(c2 - ri); v <= Math.ceil(c2 + ri); v++) {
        if ((u + 0.5 - c1) ** 2 + (v + 0.5 - c2) ** 2 <= r2) {
          for (let s = as0; s < as1; s++) {
            if (axis === "y") this.put(u, s, v, color, emit);
            else if (axis === "x") this.put(s, u, v, color, emit);
            else this.put(u, v, s, color, emit);
          }
        }
      }
    }
    return this;
  }

  ringAxis(axis: "x" | "y" | "z", c1: number, c2: number, s0: number, s1: number, outerR: number, innerR: number, color: string, emit = 0): this {
    const ri = Math.ceil(Math.max(0.5, outerR)) + 1;
    const as0 = Math.round(Math.min(s0, s1));
    const as1 = Math.max(as0 + 1, Math.round(Math.max(s0, s1)));
    const o2 = outerR * outerR + 0.18;
    const i2 = innerR * innerR;
    for (let u = Math.floor(c1 - ri); u <= Math.ceil(c1 + ri); u++) {
      for (let v = Math.floor(c2 - ri); v <= Math.ceil(c2 + ri); v++) {
        const d2 = (u + 0.5 - c1) ** 2 + (v + 0.5 - c2) ** 2;
        if (d2 <= o2 && d2 >= i2) {
          for (let s = as0; s < as1; s++) {
            if (axis === "y") this.put(u, s, v, color, emit);
            else if (axis === "x") this.put(s, u, v, color, emit);
            else this.put(u, v, s, color, emit);
          }
        }
      }
    }
    return this;
  }

  cone(cx: number, y0: number, y1: number, cz: number, rBottom: number, rTop: number, color: string, emit = 0): this {
    const ay0 = Math.round(Math.min(y0, y1)), ay1 = Math.max(ay0 + 1, Math.round(Math.max(y0, y1)));
    const span = Math.max(1, ay1 - ay0);
    for (let y = ay0; y < ay1; y++) {
      const t = (y - ay0) / span;
      const r = rBottom + (rTop - rBottom) * t;
      this.cylinderAxis("y", cx, cz, y, y + 1, Math.max(0.45, r), color, emit);
    }
    return this;
  }

  sphere(cx: number, cy: number, cz: number, rx: number, ry = rx, rz = rx, color: string | null = "leaf", emit = 0): this {
    const arx = Math.max(0.5, rx), ary = Math.max(0.5, ry), arz = Math.max(0.5, rz);
    for (let x = Math.floor(cx - arx) - 1; x <= Math.ceil(cx + arx) + 1; x++) {
      for (let y = Math.floor(cy - ary) - 1; y <= Math.ceil(cy + ary) + 1; y++) {
        for (let z = Math.floor(cz - arz) - 1; z <= Math.ceil(cz + arz) + 1; z++) {
          const d = ((x + 0.5 - cx) / arx) ** 2 + ((y + 0.5 - cy) / ary) ** 2 + ((z + 0.5 - cz) / arz) ** 2;
          if (d <= 1.0) this.put(x, y, z, color, emit);
        }
      }
    }
    return this;
  }

  dome(cx: number, yBase: number, cz: number, radius: number, color: string, emit = 0): this {
    const r = Math.max(0.5, radius);
    const yb = Math.round(yBase);
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      for (let y = yb; y <= Math.ceil(yb + r) + 1; y++) {
        for (let z = Math.floor(cz - r) - 1; z <= Math.ceil(cz + r) + 1; z++) {
          const d = ((x + 0.5 - cx) / r) ** 2 + ((y + 0.5 - yb) / r) ** 2 + ((z + 0.5 - cz) / r) ** 2;
          if (d <= 1.0) this.put(x, y, z, color, emit);
        }
      }
    }
    return this;
  }

  roofGable(x0: number, yBase: number, z0: number, x1: number, z1: number, rise = 4, axis: "x" | "z" = "x", roofCol = "terracotta", trimCol: string | null = "cream"): this {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    for (let step = 0; step < rise; step++) {
      if (axis === "x") {
        if (az0 + step >= az1 - step) break;
        this.box(ax0, yBase + step, az0 + step, ax1, yBase + step + 1, az1 - step, roofCol);
        if (trimCol) {
          this.box(ax0, yBase + step, az0 + step, ax0 + 1, yBase + step + 1, az1 - step, trimCol);
          this.box(ax1 - 1, yBase + step, az0 + step, ax1, yBase + step + 1, az1 - step, trimCol);
        }
      } else {
        if (ax0 + step >= ax1 - step) break;
        this.box(ax0 + step, yBase + step, az0, ax1 - step, yBase + step + 1, az1, roofCol);
        if (trimCol) {
          this.box(ax0 + step, yBase + step, az0, ax1 - step, yBase + step + 1, az0 + 1, trimCol);
          this.box(ax0 + step, yBase + step, az1 - 1, ax1 - step, yBase + step + 1, az1, trimCol);
        }
      }
    }
    return this;
  }

  roofPyramid(x0: number, yBase: number, z0: number, x1: number, z1: number, roofCol = "slate", trimCol: string | null = "gold"): this {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    for (let s = 0; ax0 + s < ax1 - s && az0 + s < az1 - s; s++) {
      this.box(ax0 + s, yBase + s, az0 + s, ax1 - s, yBase + s + 1, az1 - s, s === 0 && trimCol ? trimCol : roofCol);
    }
    return this;
  }

  stairs(x0: number, y0: number, z0: number, steps: number, width: number, dir: "+z" | "-z" | "+x" | "-x" = "+z", color = "limestone"): this {
    for (let i = 0; i < steps; i++) {
      if (dir === "+z") this.box(x0, y0, z0 + i, x0 + width, y0 + steps - i, z0 + i + 1, color);
      else if (dir === "-z") this.box(x0, y0, z0 - i, x0 + width, y0 + steps - i, z0 - i + 1, color);
      else if (dir === "+x") this.box(x0 + i, y0, z0, x0 + i + 1, y0 + steps - i, z0 + width, color);
      else this.box(x0 - i, y0, z0, x0 - i + 1, y0 + steps - i, z0 + width, color);
    }
    return this;
  }

  arch(cx: number, y0: number, cz: number, halfSpan = 3, height = 6, depth = 2, axis: "x" | "z" = "z", color = "brick"): this {
    for (let u = -halfSpan; u <= halfSpan; u++) {
      const archTop = y0 + height - Math.round((u / Math.max(1, halfSpan)) ** 2 * 2);
      for (let y = y0; y <= archTop; y++) {
        const isPillar = Math.abs(u) >= halfSpan - 1;
        const isCrown = y >= archTop - 1;
        if (!isPillar && !isCrown) continue;
        if (axis === "z") this.box(cx + u, y, cz, cx + u + 1, y + 1, cz + depth, color);
        else this.box(cx, y, cz + u, cx + depth, y + 1, cz + u + 1, color);
      }
    }
    return this;
  }

  line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius = 0, color = "steel", emit = 0): this {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) * 1.6));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t, py = y0 + dy * t, pz = z0 + dz * t;
      if (radius <= 0.5) this.put(Math.floor(px), Math.floor(py), Math.floor(pz), color, emit);
      else this.sphere(px, py, pz, radius, radius, radius, color, emit);
    }
    return this;
  }

  merge(other: SimVox, dx = 0, dy = 0, dz = 0): this {
    for (const c of other.v.values()) {
      this.put(c.x + dx, c.y + dy, c.z + dz, c.color, c.emit);
    }
    return this;
  }

  bounds() {
    if (!this.v.size) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, count: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.v.values()) {
      if (p.x < minX) minX = p.x;
      if (p.x + 1 > maxX) maxX = p.x + 1;
      if (p.y < minY) minY = p.y;
      if (p.y + 1 > maxY) maxY = p.y + 1;
      if (p.z < minZ) minZ = p.z;
      if (p.z + 1 > maxZ) maxZ = p.z + 1;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, count: this.v.size };
  }
}

export function mirrorOpX(op: VoxelOp): VoxelOp | null {
  switch (op.op) {
    case "box":
      return { ...op, x0: -op.x1, x1: -op.x0, mirrorX: false };
    case "roundedBox":
      return { ...op, x0: -op.x1, x1: -op.x0, mirrorX: false };
    case "clear":
      return { ...op, x0: -op.x1, x1: -op.x0, mirrorX: false };
    case "cylinder": {
      const axis = op.axis ?? "y";
      if (axis === "x") {
        const s0 = op.x0 ?? -2, s1 = op.x1 ?? 2;
        return { ...op, x0: -s1, x1: -s0, mirrorX: false };
      }
      return { ...op, cx: -(op.cx ?? 0), mirrorX: false };
    }
    case "ring": {
      const axis = op.axis ?? "y";
      if (axis === "x") {
        const s0 = op.x0 ?? -2, s1 = op.x1 ?? 2;
        return { ...op, x0: -s1, x1: -s0, mirrorX: false };
      }
      return { ...op, cx: -(op.cx ?? 0), mirrorX: false };
    }
    case "cone":
      return { ...op, cx: -op.cx, mirrorX: false };
    case "sphere":
      return { ...op, cx: -op.cx, mirrorX: false };
    case "dome":
      return { ...op, cx: -op.cx, mirrorX: false };
    case "line":
      return { ...op, x0: -op.x0, x1: -op.x1, mirrorX: false };
    case "voxels":
      return { ...op, list: op.list.map(([x, y, z, c, e]) => [-(x + 1), y, z, c, e]), mirrorX: false };
    default:
      return null;
  }
}

export function applySimOps(vox: SimVox, ops: VoxelOp[], palette: Record<string, string>): SimVox {
  const col = (c: string) =>
    (Object.hasOwn(palette, c) ? palette[c] : undefined) ||
    (Object.hasOwn(VOX_PALETTE, c) ? VOX_PALETTE[c] : undefined) ||
    c;
  const runSingle = (op: VoxelOp) => {
    switch (op.op) {
      case "plinth":
        vox.plinth(op.sizeX, op.heightY, op.sizeZ, col(op.base), col(op.top), col(op.corner));
        break;
      case "box":
        vox.box(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, col(op.color), op.emit ?? 0);
        break;
      case "roundedBox":
        vox.roundedBox(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, op.radius, col(op.color), op.emit ?? 0);
        break;
      case "clear":
        vox.clear(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1);
        break;
      case "hollowBox":
        vox.hollowBox(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, op.wall, col(op.color), op.trim ? col(op.trim) : null);
        break;
      case "pillars":
        vox.pillars(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, col(op.color));
        break;
      case "cylinder": {
        const axis = op.axis ?? "y";
        const c = op.carve ? null : col(op.color ?? "steel");
        if (axis === "x") vox.cylinderAxis("x", op.cy ?? 2, op.cz ?? 0, op.x0 ?? -2, op.x1 ?? 2, op.radius, c, op.emit ?? 0);
        else if (axis === "z") vox.cylinderAxis("z", op.cx ?? 0, op.cy ?? 2, op.z0 ?? -2, op.z1 ?? 2, op.radius, c, op.emit ?? 0);
        else vox.cylinderAxis("y", op.cx ?? 0, op.cz ?? 0, op.y0 ?? 0, op.y1 ?? 6, op.radius, c, op.emit ?? 0);
        break;
      }
      case "ring": {
        const axis = op.axis ?? "y";
        if (axis === "x") vox.ringAxis("x", op.cy ?? 2, op.cz ?? 0, op.x0 ?? -2, op.x1 ?? 2, op.outerR, op.innerR, col(op.color), op.emit ?? 0);
        else if (axis === "z") vox.ringAxis("z", op.cx ?? 0, op.cy ?? 2, op.z0 ?? -2, op.z1 ?? 2, op.outerR, op.innerR, col(op.color), op.emit ?? 0);
        else vox.ringAxis("y", op.cx ?? 0, op.cz ?? 0, op.y0 ?? 0, op.y1 ?? 2, op.outerR, op.innerR, col(op.color), op.emit ?? 0);
        break;
      }
      case "cone":
        vox.cone(op.cx, op.y0, op.y1, op.cz, op.rBottom, op.rTop, col(op.color), op.emit ?? 0);
        break;
      case "sphere":
        vox.sphere(op.cx, op.cy, op.cz, op.rx, op.ry, op.rz, op.carve ? null : col(op.color ?? "leaf"), op.emit ?? 0);
        break;
      case "dome":
        vox.dome(op.cx, op.yBase, op.cz, op.radius, col(op.color), op.emit ?? 0);
        break;
      case "roofGable":
        vox.roofGable(op.x0, op.yBase, op.z0, op.x1, op.z1, op.rise, op.axis, col(op.color), op.trim ? col(op.trim) : null);
        break;
      case "roofPyramid":
        vox.roofPyramid(op.x0, op.yBase, op.z0, op.x1, op.z1, col(op.color), op.trim ? col(op.trim) : null);
        break;
      case "stairs":
        vox.stairs(op.x0, op.y0, op.z0, op.steps, op.width, op.dir, col(op.color));
        break;
      case "arch":
        vox.arch(op.cx, op.y0, op.cz, op.halfSpan, op.height, op.depth, op.axis, col(op.color));
        break;
      case "line":
        vox.line(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, op.radius, col(op.color), op.emit ?? 0);
        break;
      case "voxels":
        for (const [x, y, z, c, e] of op.list) {
          vox.put(x, y, z, col(c), e ?? 0);
        }
        break;
    }
  };

  for (const op of ops) {
    runSingle(op);
    if ("mirrorX" in op && op.mirrorX) {
      const mirrored = mirrorOpX(op);
      if (mirrored) runSingle(mirrored);
    }
  }
  return vox;
}

export function translateOp(op: VoxelOp, dx: number, dy: number, dz: number): VoxelOp {
  switch (op.op) {
    case "plinth":
      return op;
    case "box":
    case "roundedBox":
    case "clear":
    case "hollowBox":
    case "pillars":
      return { ...op, x0: op.x0 + dx, y0: op.y0 + dy, z0: op.z0 + dz, x1: op.x1 + dx, y1: op.y1 + dy, z1: op.z1 + dz };
    case "cylinder":
    case "ring": {
      const axis = op.axis ?? "y";
      if (axis === "x") {
        return { ...op, x0: (op.x0 ?? 0) + dx, x1: (op.x1 ?? 1) + dx, cy: (op.cy ?? 0) + dy, cz: (op.cz ?? 0) + dz };
      }
      if (axis === "z") {
        return { ...op, cx: (op.cx ?? 0) + dx, cy: (op.cy ?? 0) + dy, z0: (op.z0 ?? 0) + dz, z1: (op.z1 ?? 1) + dz };
      }
      return { ...op, cx: (op.cx ?? 0) + dx, y0: (op.y0 ?? 0) + dy, y1: (op.y1 ?? 1) + dy, cz: (op.cz ?? 0) + dz };
    }
    case "cone":
      return { ...op, cx: op.cx + dx, y0: op.y0 + dy, y1: op.y1 + dy, cz: op.cz + dz };
    case "sphere":
      return { ...op, cx: op.cx + dx, cy: op.cy + dy, cz: op.cz + dz };
    case "dome":
      return { ...op, cx: op.cx + dx, yBase: op.yBase + dy, cz: op.cz + dz };
    case "roofGable":
    case "roofPyramid":
      return { ...op, x0: op.x0 + dx, yBase: op.yBase + dy, z0: op.z0 + dz, x1: op.x1 + dx, z1: op.z1 + dz };
    case "stairs":
      return { ...op, x0: op.x0 + dx, y0: op.y0 + dy, z0: op.z0 + dz };
    case "arch":
      return { ...op, cx: op.cx + dx, y0: op.y0 + dy, cz: op.cz + dz };
    case "line":
      return { ...op, x0: op.x0 + dx, y0: op.y0 + dy, z0: op.z0 + dz, x1: op.x1 + dx, y1: op.y1 + dy, z1: op.z1 + dz };
    case "voxels":
      return { ...op, list: op.list.map(([x, y, z, c, e]) => [x + dx, y + dy, z + dz, c, e]) };
  }
}

const B = 28;
const MAX_Y = 64;

export function sanitizeOp(raw: Record<string, unknown>, palette: Record<string, string>, isPart = false): VoxelOp | null {
  const kind = typeof raw.op === "string" ? raw.op.trim() : "";
  const emitVal = num(raw.emit, 0) > 0 ? clamp(Number(num(raw.emit, 0).toFixed(2)), 0, 2.2) : undefined;
  const mirrorX = Boolean(raw.mirrorX);
  const loY = isPart ? -24 : -8;

  switch (kind) {
    case "plinth":
      if (isPart) return null;
      return {
        op: "plinth",
        sizeX: clamp(Math.round(num(raw.sizeX, 16)), 4, 48),
        heightY: clamp(Math.round(num(raw.heightY, 2)), 1, 6),
        sizeZ: clamp(Math.round(num(raw.sizeZ, 16)), 4, 48),
        base: normalizeColorToken(raw.base, palette, "concrete2"),
        top: normalizeColorToken(raw.top, palette, "limestone"),
        corner: normalizeColorToken(raw.corner, palette, "brass"),
      };
    case "box": {
      const [x0, x1] = orderedSpan(raw.x0, raw.x1, -3, 3);
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 0, 4);
      const [z0, z1] = orderedSpan(raw.z0, raw.z1, -3, 3);
      return {
        op: "box",
        x0: clamp(x0, -B, B - 1),
        y0: clamp(y0, loY, MAX_Y - 1),
        z0: clamp(z0, -B, B - 1),
        x1: clamp(Math.max(x0 + 1, x1), -B + 1, B),
        y1: clamp(Math.max(y0 + 1, y1), loY + 1, MAX_Y),
        z1: clamp(Math.max(z0 + 1, z1), -B + 1, B),
        color: normalizeColorToken(raw.color, palette, "cream"),
        ...(emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "roundedBox": {
      const [x0, x1] = orderedSpan(raw.x0, raw.x1, -4, 4);
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 1, 7);
      const [z0, z1] = orderedSpan(raw.z0, raw.z1, -6, 6);
      return {
        op: "roundedBox",
        x0: clamp(x0, -B, B - 1),
        y0: clamp(y0, loY, MAX_Y - 1),
        z0: clamp(z0, -B, B - 1),
        x1: clamp(Math.max(x0 + 2, x1), -B + 2, B),
        y1: clamp(Math.max(y0 + 2, y1), loY + 2, MAX_Y),
        z1: clamp(Math.max(z0 + 2, z1), -B + 2, B),
        radius: clamp(num(raw.radius, 1.6), 0.8, 6),
        color: normalizeColorToken(raw.color, palette, "busYellow"),
        ...(emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "clear": {
      const [x0, x1] = orderedSpan(raw.x0, raw.x1, -2, 2);
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 1, 5);
      const [z0, z1] = orderedSpan(raw.z0, raw.z1, -2, 2);
      return {
        op: "clear",
        x0: clamp(x0, -B, B),
        y0: clamp(y0, loY, MAX_Y),
        z0: clamp(z0, -B, B),
        x1: clamp(x1, -B, B),
        y1: clamp(y1, loY, MAX_Y),
        z1: clamp(z1, -B, B),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "hollowBox": {
      const [x0, x1] = orderedSpan(raw.x0, raw.x1, -6, 6);
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 1, 12);
      const [z0, z1] = orderedSpan(raw.z0, raw.z1, -6, 6);
      return {
        op: "hollowBox",
        x0: clamp(x0, -B, B - 2),
        y0: clamp(y0, loY, MAX_Y - 2),
        z0: clamp(z0, -B, B - 2),
        x1: clamp(Math.max(x0 + 2, x1), -B + 2, B),
        y1: clamp(Math.max(y0 + 2, y1), loY + 2, MAX_Y),
        z1: clamp(Math.max(z0 + 2, z1), -B + 2, B),
        wall: clamp(Math.round(num(raw.wall, 1)), 1, 3),
        color: normalizeColorToken(raw.color, palette, "cream"),
        ...(raw.trim ? { trim: normalizeColorToken(raw.trim, palette, "woodDark") } : {}),
      };
    }
    case "pillars": {
      const [x0, x1] = orderedSpan(raw.x0, raw.x1, -6, 6);
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 1, 12);
      const [z0, z1] = orderedSpan(raw.z0, raw.z1, -6, 6);
      return {
        op: "pillars",
        x0: clamp(x0, -B, B - 2),
        y0: clamp(y0, loY, MAX_Y - 1),
        z0: clamp(z0, -B, B - 2),
        x1: clamp(Math.max(x0 + 2, x1), -B + 2, B),
        y1: clamp(Math.max(y0 + 1, y1), loY + 1, MAX_Y),
        z1: clamp(Math.max(z0 + 2, z1), -B + 2, B),
        color: normalizeColorToken(raw.color, palette, "woodDark"),
      };
    }
    case "cylinder": {
      const axis: "x" | "y" | "z" = raw.axis === "x" || raw.axis === "z" ? raw.axis : "y";
      const radius = clamp(num(raw.radius, 2.5), 0.5, 24);
      const carve = Boolean(raw.carve);
      if (axis === "x") {
        const [x0, x1] = orderedSpan(raw.x0, raw.x1, -1, 1);
        return {
          op: "cylinder",
          axis: "x",
          x0: clamp(x0, -B, B - 1),
          x1: clamp(Math.max(x0 + 1, x1), -B + 1, B),
          cy: clamp(num(raw.cy, 0), loY, MAX_Y),
          cz: clamp(num(raw.cz, 0), -B, B),
          radius: Number(radius.toFixed(2)),
          ...(carve ? { carve: true } : { color: normalizeColorToken(raw.color, palette, "rubber") }),
          ...(!carve && emitVal ? { emit: emitVal } : {}),
          ...(mirrorX ? { mirrorX: true } : {}),
        };
      }
      if (axis === "z") {
        const [z0, z1] = orderedSpan(raw.z0, raw.z1, -4, 4);
        return {
          op: "cylinder",
          axis: "z",
          cx: clamp(num(raw.cx, 0), -B, B),
          cy: clamp(num(raw.cy, 4), loY, MAX_Y),
          z0: clamp(z0, -B, B - 1),
          z1: clamp(Math.max(z0 + 1, z1), -B + 1, B),
          radius: Number(radius.toFixed(2)),
          ...(carve ? { carve: true } : { color: normalizeColorToken(raw.color, palette, "steel") }),
          ...(!carve && emitVal ? { emit: emitVal } : {}),
          ...(mirrorX ? { mirrorX: true } : {}),
        };
      }
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 0, 10);
      return {
        op: "cylinder",
        axis: "y",
        cx: clamp(num(raw.cx, 0), -B, B),
        y0: clamp(y0, loY, MAX_Y - 1),
        y1: clamp(Math.max(y0 + 1, y1), loY + 1, MAX_Y),
        cz: clamp(num(raw.cz, 0), -B, B),
        radius: Number(radius.toFixed(2)),
        ...(carve ? { carve: true } : { color: normalizeColorToken(raw.color, palette, "steel") }),
        ...(!carve && emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "ring": {
      const axis: "x" | "y" | "z" = raw.axis === "x" || raw.axis === "z" ? raw.axis : "y";
      const outerR = clamp(num(raw.outerR, 3.0), 1.0, 24);
      const innerR = clamp(num(raw.innerR, outerR - 1.1), 0.4, Math.max(0.4, outerR - 0.5));
      if (axis === "x") {
        const [x0, x1] = orderedSpan(raw.x0, raw.x1, -1, 1);
        return {
          op: "ring",
          axis: "x",
          x0: clamp(x0, -B, B - 1),
          x1: clamp(Math.max(x0 + 1, x1), -B + 1, B),
          cy: clamp(num(raw.cy, 0), loY, MAX_Y),
          cz: clamp(num(raw.cz, 0), -B, B),
          outerR: Number(outerR.toFixed(2)),
          innerR: Number(innerR.toFixed(2)),
          color: normalizeColorToken(raw.color, palette, "rubber"),
          ...(emitVal ? { emit: emitVal } : {}),
          ...(mirrorX ? { mirrorX: true } : {}),
        };
      }
      if (axis === "z") {
        const [z0, z1] = orderedSpan(raw.z0, raw.z1, -1, 1);
        return {
          op: "ring",
          axis: "z",
          cx: clamp(num(raw.cx, 0), -B, B),
          cy: clamp(num(raw.cy, 6), loY, MAX_Y),
          z0: clamp(z0, -B, B - 1),
          z1: clamp(Math.max(z0 + 1, z1), -B + 1, B),
          outerR: Number(outerR.toFixed(2)),
          innerR: Number(innerR.toFixed(2)),
          color: normalizeColorToken(raw.color, palette, "brass"),
          ...(emitVal ? { emit: emitVal } : {}),
          ...(mirrorX ? { mirrorX: true } : {}),
        };
      }
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 4, 5);
      return {
        op: "ring",
        axis: "y",
        cx: clamp(num(raw.cx, 0), -B, B),
        y0: clamp(y0, loY, MAX_Y - 1),
        y1: clamp(Math.max(y0 + 1, y1), loY + 1, MAX_Y),
        cz: clamp(num(raw.cz, 0), -B, B),
        outerR: Number(outerR.toFixed(2)),
        innerR: Number(innerR.toFixed(2)),
        color: normalizeColorToken(raw.color, palette, "brass"),
        ...(emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "cone": {
      const [y0, y1] = orderedSpan(raw.y0, raw.y1, 8, 16);
      const rBottom = clamp(num(raw.rBottom, 4), 0.6, 26);
      const rTop = clamp(num(raw.rTop, 0.5), 0.2, rBottom);
      return {
        op: "cone",
        cx: clamp(num(raw.cx, 0), -B, B),
        y0: clamp(y0, loY, MAX_Y - 1),
        y1: clamp(Math.max(y0 + 1, y1), loY + 1, MAX_Y),
        cz: clamp(num(raw.cz, 0), -B, B),
        rBottom: Number(rBottom.toFixed(2)),
        rTop: Number(rTop.toFixed(2)),
        color: normalizeColorToken(raw.color, palette, "terracotta"),
        ...(emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "sphere": {
      const rx = clamp(num(raw.rx ?? raw.radius, 2.5), 0.5, 24);
      const ry = clamp(num(raw.ry ?? rx, rx), 0.5, 24);
      const rz = clamp(num(raw.rz ?? rx, rx), 0.5, 24);
      const carve = Boolean(raw.carve);
      return {
        op: "sphere",
        cx: clamp(num(raw.cx, 0), -B, B),
        cy: clamp(num(raw.cy, 4), loY, MAX_Y),
        cz: clamp(num(raw.cz, 0), -B, B),
        rx: Number(rx.toFixed(2)),
        ry: Number(ry.toFixed(2)),
        rz: Number(rz.toFixed(2)),
        ...(carve ? { carve: true } : { color: normalizeColorToken(raw.color, palette, "leaf") }),
        ...(!carve && emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "dome": {
      const radius = clamp(num(raw.radius, 4), 0.8, 24);
      return {
        op: "dome",
        cx: clamp(num(raw.cx, 0), -B, B),
        yBase: clamp(Math.round(num(raw.yBase, 8)), loY, MAX_Y - 1),
        cz: clamp(num(raw.cz, 0), -B, B),
        radius: Number(radius.toFixed(2)),
        color: normalizeColorToken(raw.color, palette, "copper"),
        ...(emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "roofGable": {
      const [x0, x1] = orderedSpan(raw.x0, raw.x1, -7, 7);
      const [z0, z1] = orderedSpan(raw.z0, raw.z1, -6, 6);
      return {
        op: "roofGable",
        x0: clamp(x0, -B, B - 2),
        yBase: clamp(Math.round(num(raw.yBase, 12)), 1, MAX_Y - 2),
        z0: clamp(z0, -B, B - 2),
        x1: clamp(Math.max(x0 + 2, x1), -B + 2, B),
        z1: clamp(Math.max(z0 + 2, z1), -B + 2, B),
        rise: clamp(Math.round(num(raw.rise, 5)), 2, 18),
        axis: raw.axis === "z" ? "z" : "x",
        color: normalizeColorToken(raw.color, palette, "terracotta"),
        ...(raw.trim ? { trim: normalizeColorToken(raw.trim, palette, "cream") } : {}),
      };
    }
    case "roofPyramid": {
      const [x0, x1] = orderedSpan(raw.x0, raw.x1, -6, 6);
      const [z0, z1] = orderedSpan(raw.z0, raw.z1, -6, 6);
      return {
        op: "roofPyramid",
        x0: clamp(x0, -B, B - 2),
        yBase: clamp(Math.round(num(raw.yBase, 12)), 1, MAX_Y - 2),
        z0: clamp(z0, -B, B - 2),
        x1: clamp(Math.max(x0 + 2, x1), -B + 2, B),
        z1: clamp(Math.max(z0 + 2, z1), -B + 2, B),
        color: normalizeColorToken(raw.color, palette, "slate"),
        ...(raw.trim ? { trim: normalizeColorToken(raw.trim, palette, "gold") } : {}),
      };
    }
    case "stairs": {
      const dir: "+z" | "-z" | "+x" | "-x" = raw.dir === "-z" || raw.dir === "+x" || raw.dir === "-x" ? raw.dir : "+z";
      return {
        op: "stairs",
        x0: clamp(Math.round(num(raw.x0, -2)), -B, B - 1),
        y0: clamp(Math.round(num(raw.y0, 0)), 0, MAX_Y - 2),
        z0: clamp(Math.round(num(raw.z0, 6)), -B, B - 1),
        steps: clamp(Math.round(num(raw.steps, 2)), 1, 8),
        width: clamp(Math.round(num(raw.width, 4)), 1, 12),
        dir,
        color: normalizeColorToken(raw.color, palette, "marble"),
      };
    }
    case "arch": {
      return {
        op: "arch",
        cx: clamp(Math.round(num(raw.cx, 0)), -B + 2, B - 2),
        y0: clamp(Math.round(num(raw.y0, 1)), 0, MAX_Y - 3),
        cz: clamp(Math.round(num(raw.cz, 5)), -B + 1, B - 1),
        halfSpan: clamp(Math.round(num(raw.halfSpan, 3)), 1, 8),
        height: clamp(Math.round(num(raw.height, 6)), 3, 14),
        depth: clamp(Math.round(num(raw.depth, 2)), 1, 6),
        axis: raw.axis === "x" ? "x" : "z",
        color: normalizeColorToken(raw.color, palette, "brickDark"),
      };
    }
    case "line": {
      return {
        op: "line",
        x0: clamp(num(raw.x0, 0), -B, B),
        y0: clamp(num(raw.y0, 0), loY, MAX_Y),
        z0: clamp(num(raw.z0, 0), -B, B),
        x1: clamp(num(raw.x1, 0), -B, B),
        y1: clamp(num(raw.y1, 5), loY, MAX_Y),
        z1: clamp(num(raw.z1, 0), -B, B),
        radius: clamp(num(raw.radius, 0), 0, 3.5),
        color: normalizeColorToken(raw.color, palette, "steel"),
        ...(emitVal ? { emit: emitVal } : {}),
        ...(mirrorX ? { mirrorX: true } : {}),
      };
    }
    case "voxels": {
      if (!Array.isArray(raw.list)) return null;
      const list: [number, number, number, string, number?][] = [];
      for (const item of raw.list.slice(0, 600)) {
        if (!Array.isArray(item) || item.length < 4) continue;
        const vx = clamp(Math.round(num(item[0], 0)), -B, B - 1);
        const vy = clamp(Math.round(num(item[1], 0)), loY, MAX_Y - 1);
        const vz = clamp(Math.round(num(item[2], 0)), -B, B - 1);
        const vc = normalizeColorToken(item[3], palette, "black");
        const ve = num(item[4], 0) > 0 ? clamp(Number(num(item[4], 0).toFixed(2)), 0, 2.2) : undefined;
        list.push(ve ? [vx, vy, vz, vc, ve] : [vx, vy, vz, vc]);
      }
      if (!list.length) return null;
      return { op: "voxels", list, ...(mirrorX ? { mirrorX: true } : {}) };
    }
    default:
      return null;
  }
}

const INTERACTION_KINDS: Record<InteractionKind, true> = {
  tic_tac_toe: true,
  connect_four: true,
  whack_a_mole: true,
  floor_piano: true,
  simon_synth: true,
  lights_out: true,
  step_sequencer: true,
  basketball_hoop: true,
  slot_machine: true,
  fireworks_mortar: true,
  tesla_coil: true,
  gravity_inverter: true,
  marble_run: true,
};

export function sanitizeInteraction(
  raw: unknown,
  contextText = "",
): BlueprintInteraction | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const k = typeof rec.kind === "string" ? rec.kind.trim().toLowerCase() : "";
    if (INTERACTION_KINDS[k as InteractionKind]) {
      return { kind: k as InteractionKind };
    }
  } else if (typeof raw === "string") {
    const k = raw.trim().toLowerCase();
    if (INTERACTION_KINDS[k as InteractionKind]) {
      return { kind: k as InteractionKind };
    }
  }

  const text = contextText.toLowerCase();
  if (!text) return null;
  if (/\b(naughts?\s*(?:and|&)\s*crosses|noughts?\s*(?:and|&)\s*crosses|tic[\s-]*tac[\s-]*toe)\b/i.test(text)) {
    return { kind: "tic_tac_toe" };
  }
  if (/\b(connect[\s-]*(?:four|4)|four[\s-]*in[\s-]*a[\s-]*row|4[\s-]*in[\s-]*a[\s-]*row)\b/i.test(text)) {
    return { kind: "connect_four" };
  }
  if (/\b(whack[\s-]*a[\s-]*mole|whac[\s-]*a[\s-]*mole|critter\s*bonk|mole\s*arcade)\b/i.test(text)) {
    return { kind: "whack_a_mole" };
  }
  if (/\b(floor\s*piano|walk[\s-]*on\s*piano|giant\s*(?:voxel\s*)?piano|piano\s*mat|foot\s*piano)\b/i.test(text)) {
    return { kind: "floor_piano" };
  }
  if (/\b(simon\s*(?:says|memory|synth|obelisk)|memory\s*(?:obelisk|pads?|game))\b/i.test(text)) {
    return { kind: "simon_synth" };
  }
  if (/\b(lights[\s-]*out|rune\s*puzzle|glowing\s*rune\s*grid)\b/i.test(text)) {
    return { kind: "lights_out" };
  }
  if (/\b(step\s*sequencer|beat\s*(?:matrix|sequencer)|drum\s*matrix|chiptune\s*sequencer)\b/i.test(text)) {
    return { kind: "step_sequencer" };
  }
  if (/\b(basketball\s*(?:hoop|court)|streetball|trick[\s-]*shot\s*hoop|free[\s-]*throw\s*court)\b/i.test(text)) {
    return { kind: "basketball_hoop" };
  }
  if (/\b(slot\s*machine|one[\s-]*armed\s*bandit|jackpot\s*(?:machine|reels?|automaton)|fortune\s*reels?)\b/i.test(text)) {
    return { kind: "slot_machine" };
  }
  if (/\b(fireworks?\s*(?:mortar|battery|launcher|rack)|pyrotechnic\s*launcher)\b/i.test(text)) {
    return { kind: "fireworks_mortar" };
  }
  if (/\b(tesla\s*coil|lightning\s*(?:coil|spire|generator)|jacob'?s\s*ladder)\b/i.test(text)) {
    return { kind: "tesla_coil" };
  }
  if (/\b(gravity\s*(?:inverter|flipper)|anti[\s-]*gravity\s*house|upside[\s-]*down\s*(?:escher\s*)?house)\b/i.test(text)) {
    return { kind: "gravity_inverter" };
  }
  if (/\b(marble\s*run|rube\s*goldberg|kinetic\s*ball\s*tower|pinball\s*tower)\b/i.test(text)) {
    return { kind: "marble_run" };
  }
  return null;
}

const EXPLICIT_PEDESTAL_SUBJECT_RE =
  /\b(statue|monument|memorial|trophy|bust|obelisk|pedestal|podium|floor\s*piano|walk[\s-]*on\s*piano|tic[\s-]*tac[\s-]*toe|naughts|noughts|lights[\s-]*out|simon)\b/i;

const LIVED_IN_PLACE_RE =
  /\b(cottage|house|home|cabin|villa|manor|mansion|hall|parliament|shop|store|bookshop|bakery|windmill|cafe|pub|bar|inn|cantina|shack|burger|ihop|pancake|diner|restaurant|firehouse|station|datacentre|datacenter|tower|arena|stadium|amphitheater|amphitheatre|pavilion|court|half-?pipe|skate|quarry|mine|mining|farm|barn|apiary|waterfall|cliff|volcano|mountain|island|coast|beach|hammock|lounger)\b/i;

function isCarveOpTouchingSlab(op: VoxelOp, slabY0: number, slabY1: number): boolean {
  if (op.op === "clear") {
    return op.y0 < slabY1 && op.y1 > slabY0;
  }
  if (op.op === "cylinder" && op.carve) {
    const axis = op.axis ?? "y";
    const minY = axis === "y" ? (op.y0 ?? 0) : (op.cy ?? 0) - op.radius;
    const maxY = axis === "y" ? (op.y1 ?? 6) : (op.cy ?? 0) + op.radius;
    return minY < slabY1 - 0.1 && maxY > slabY0 + 0.1;
  }
  if (op.op === "sphere" && op.carve) {
    const minY = op.cy - op.ry;
    const maxY = op.cy + op.ry;
    return minY < slabY1 - 0.1 && maxY > slabY0 + 0.1;
  }
  return false;
}

/**
 * Strips artificial raised `plinth`s, wide plot-filling base pedestal slabs (`box`/`roundedBox`),
 * and orphaned pedestal-climbing `stairs` so buildings, courts, quarries, and landforms sit
 * directly and naturally on the meadow ground (`Y = 0`) instead of on raised concrete blocks.
 * Preserves court playing surfaces (detected via coplanar boundary-line ops) and explicit stepped monuments.
 */
export function stripRaisedPlatformOps(
  ops: VoxelOp[],
  palette: Record<string, string>,
  contextText = "",
): { ops: VoxelOp[]; stripped: boolean } {
  const preservePedestal =
    EXPLICIT_PEDESTAL_SUBJECT_RE.test(contextText) && !LIVED_IN_PLACE_RE.test(contextText);

  let curOps = ops.map((o) => ({ ...o }));
  let stripped = false;

  // 1. Always strip rectangular `plinth` ops unless this is an explicit statue/monument pedestal
  if (!preservePedestal) {
    const withoutPlinth = curOps.filter((o) => o.op !== "plinth");
    if (withoutPlinth.length !== curOps.length) {
      curOps = withoutPlinth;
      stripped = true;
    }
  } else {
    return { ops: curOps, stripped: false };
  }

  // 2. Peel up to 3 wide, flat bottom base slabs (e.g. stacked concrete/tarmac/plaza/blue-pad platform boxes under buildings)
  for (let pass = 0; pass < 3; pass++) {
    const sim = new SimVox();
    applySimOps(
      sim,
      curOps.filter((o) => o.op !== "stairs"),
      palette,
    );
    const b = sim.bounds();
    if (b.count < 45) break;

    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    const totalH = b.maxY - b.minY;
    if (totalH < 7 || spanX < 10 || spanZ < 10) break;

    let slabIdx = -1;
    let slabY1 = b.minY;

    for (let i = 0; i < curOps.length; i++) {
      const o = curOps[i];
      if (o.op !== "box" && o.op !== "roundedBox") continue;
      if (o.mirrorX || (o.emit && o.emit > 0.25)) continue;
      if (o.y0 > b.minY + 1) continue;

      const thickness = o.y1 - o.y0;
      const maxSlabThickness =
        totalH >= 28 && o.y0 === b.minY ? 5 : totalH >= 18 && o.y0 === b.minY ? 4 : 3;
      if (thickness < 1 || thickness > maxSlabThickness) continue;
      if (b.maxY < o.y1 + 5) continue;

      const ox = o.x1 - o.x0;
      const oz = o.z1 - o.z0;
      if (ox < Math.max(10, spanX * 0.72) || oz < Math.max(10, spanZ * 0.72)) continue;

      // Preserve functional court floors / striped plazas that have >= 3 coplanar line/detail ops
      let coplanarDetailOps = 0;
      for (let j = 0; j < curOps.length; j++) {
        if (j === i) continue;
        const d = curOps[j];
        if (d.op === "box" || d.op === "roundedBox") {
          const dh = d.y1 - d.y0;
          if (dh <= 2 && d.y0 >= o.y0 && d.y0 <= o.y1 && d.y1 <= o.y1 + 1) {
            const dx = d.x1 - d.x0;
            const dz = d.z1 - d.z0;
            if (dx < ox * 0.82 || dz < oz * 0.82) {
              coplanarDetailOps++;
            }
          }
        } else if (d.op === "line" && Math.min(d.y0, d.y1) >= o.y0 && Math.max(d.y0, d.y1) <= o.y1 + 1) {
          coplanarDetailOps++;
        }
      }
      if (coplanarDetailOps >= 3) continue;

      // Preserve slabs that have a concave basin/pool carved directly into them from later ops
      let carvedIntoSlab = false;
      for (let j = i + 1; j < curOps.length; j++) {
        if (isCarveOpTouchingSlab(curOps[j], o.y0, o.y1)) {
          carvedIntoSlab = true;
          break;
        }
      }
      if (carvedIntoSlab) continue;

      slabIdx = i;
      slabY1 = o.y1;
      break;
    }

    if (slabIdx === -1) break;

    // Make sure removing this slab still leaves a substantial creation (>= 32% of voxels & >= 35 voxels)
    const candidateOps = curOps.filter((_, idx) => idx !== slabIdx);
    const checkVox = new SimVox();
    applySimOps(checkVox, candidateOps, palette);
    if (checkVox.size < Math.max(35, Math.floor(b.count * 0.32))) {
      break;
    }

    curOps = candidateOps
      .map((o): VoxelOp | null => {
        // Slice cleanly at the new ground plane `slabY1` so no stray pedestal step, trim, or bollard
        // dangles below `slabY1` and holds the building floating above Y = 0!
        if (o.op === "box" || o.op === "roundedBox" || o.op === "pillars") {
          if (o.y1 <= slabY1) return null;
          if (o.y0 < slabY1) return { ...o, y0: slabY1 };
          return o;
        }
        if (o.op === "cylinder" && (o.axis ?? "y") === "y") {
          const cy0 = o.y0 ?? 0;
          const cy1 = o.y1 ?? 6;
          if (cy1 <= slabY1) return null;
          if (cy0 < slabY1) return { ...o, y0: slabY1 };
          return o;
        }
        if (o.op === "ring" && (o.axis ?? "y") === "y") {
          const ry0 = o.y0 ?? 0;
          const ry1 = o.y1 ?? 2;
          if (ry1 <= slabY1) return null;
          if (ry0 < slabY1) return { ...o, y0: slabY1 };
          return o;
        }
        if (o.op === "cone") {
          if (o.y1 <= slabY1) return null;
          if (o.y0 < slabY1) return { ...o, y0: slabY1 };
          return o;
        }
        if (o.op === "stairs") {
          const drop = slabY1 - o.y0;
          if (drop <= 0) return o;
          const remSteps = o.steps - drop;
          if (remSteps <= 0) return null;
          // Shift stair start inward along its climb direction by `drop` steps
          const nx0 = o.dir === "+x" ? o.x0 + drop : o.dir === "-x" ? o.x0 - drop : o.x0;
          const nz0 = o.dir === "+z" ? o.z0 + drop : o.dir === "-z" ? o.z0 - drop : o.z0;
          return { ...o, x0: nx0, y0: slabY1, z0: nz0, steps: remSteps };
        }
        if (o.op === "line") {
          if (Math.max(o.y0, o.y1) <= slabY1) return null;
          if (Math.min(o.y0, o.y1) < slabY1) {
            return {
              ...o,
              y0: Math.max(slabY1, o.y0),
              y1: Math.max(slabY1, o.y1),
            };
          }
          return o;
        }
        return o;
      })
      .filter((o): o is VoxelOp => o !== null);
    stripped = true;
  }

  // 3. If a `plinth` op was stripped in step 1 (typically height 2..3) without a matching slab box,
  // also trim orphaned pedestal stairs / bollards below the main structure's base `sb.minY`.
  const structVox = new SimVox();
  applySimOps(
    structVox,
    curOps.filter((o) => o.op !== "stairs"),
    palette,
  );
  const sb = structVox.bounds();
  if (sb.count >= 35 && sb.minY > 0) {
    const filteredStairs = curOps
      .map((o): VoxelOp | null => {
        if (o.op !== "stairs") return o;
        const drop = sb.minY - o.y0;
        if (drop <= 0) return o;
        const remSteps = o.steps - drop;
        if (remSteps <= 0) return null;
        const nx0 = o.dir === "+x" ? o.x0 + drop : o.dir === "-x" ? o.x0 - drop : o.x0;
        const nz0 = o.dir === "+z" ? o.z0 + drop : o.dir === "-z" ? o.z0 - drop : o.z0;
        return { ...o, x0: nx0, y0: sb.minY, z0: nz0, steps: remSteps };
      })
      .filter((o): o is VoxelOp => o !== null);
    if (JSON.stringify(filteredStairs) !== JSON.stringify(curOps)) {
      curOps = filteredStairs;
      stripped = true;
    }
  }

  return { ops: curOps, stripped };
}

/**
 * Infers the local horizontal forward/entrance angle (in radians, where `0` = `+Z`,
 * `Math.PI / 2` = `+X`, `Math.PI` = `-Z`, `-Math.PI / 2` = `-X`) of a stationary blueprint
 * so the world orchestrator can orient doorways/courtyards cleanly toward their road frontage.
 */
export function detectBlueprintFrontAngle(bp: VoxelBlueprint): number {
  const votes = { posZ: 0, negZ: 0, posX: 0, negX: 0 };
  for (const o of bp.ops || []) {
    if (o.op === "stairs") {
      if (o.dir === "+z" || o.z0 >= 3) votes.posZ += 2;
      else if (o.dir === "-z" || o.z0 <= -3) votes.negZ += 2;
      else if (o.dir === "+x" || o.x0 >= 3) votes.posX += 2;
      else if (o.dir === "-x" || o.x0 <= -3) votes.negX += 2;
    } else if (o.op === "arch") {
      if (o.axis === "z" && o.cz >= 2) votes.posZ += 2;
      else if (o.axis === "z" && o.cz <= -2) votes.negZ += 2;
      else if (o.axis === "x" && o.cx >= 2) votes.posX += 2;
      else if (o.axis === "x" && o.cx <= -2) votes.negX += 2;
    }
  }
  if (votes.posZ > 0) return 0;
  const best = Math.max(votes.negZ, votes.posX, votes.negX);
  if (best <= 0) return 0;
  if (votes.posX === best) return Math.PI / 2;
  if (votes.negX === best) return -Math.PI / 2;
  return Math.PI;
}

export function normalizeAndGroundBlueprint(
  raw: Record<string, unknown>,
  fallbackName = "Meadow Creation",
  options?: { skipAutoRepair?: boolean; keepPlinth?: boolean; contextText?: string },
): VoxelBlueprint {
  const palette: Record<string, string> = {};
  if (raw.palette && typeof raw.palette === "object" && !Array.isArray(raw.palette)) {
    for (const [k, v] of Object.entries(raw.palette as Record<string, unknown>).slice(0, 32)) {
      const key = k.trim();
      if (!SAFE_TOKEN_RE.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      if (typeof v === "string" && HEX_RE.test(v.trim())) {
        palette[key] = v.trim().toLowerCase();
      } else if (typeof v === "string" && Object.hasOwn(VOX_PALETTE, v.trim())) {
        palette[key] = VOX_PALETTE[v.trim()];
      }
    }
  }

  let ops: VoxelOp[] = [];
  for (const item of Array.isArray(raw.ops) ? raw.ops.slice(0, 96) : []) {
    if (item && typeof item === "object") {
      const cleaned = sanitizeOp(item as Record<string, unknown>, palette, false);
      if (cleaned) ops.push(cleaned);
    }
  }

  let parts: VoxelPart[] = [];
  for (const pRaw of Array.isArray(raw.parts) ? raw.parts.slice(0, 16) : []) {
    if (!pRaw || typeof pRaw !== "object") continue;
    const rec = pRaw as Record<string, unknown>;
    const piv = Array.isArray(rec.pivot) ? rec.pivot : [0, 4, 0];
    const px = clamp(num(piv[0], 0), -28, 28);
    const py = clamp(num(piv[1], 4), 0, 62);
    const pz = clamp(num(piv[2], 0), -28, 28);

    let pOps: VoxelOp[] = [];
    for (const item of Array.isArray(rec.ops) ? rec.ops.slice(0, 48) : []) {
      if (item && typeof item === "object") {
        const cleaned = sanitizeOp(item as Record<string, unknown>, palette, true);
        if (cleaned) pOps.push(cleaned);
      }
    }
    if (!pOps.length) continue;

    // Auto-repair if LLM authored part ops in world coordinates around pivot instead of local [0,0,0]
    const pv = new SimVox();
    applySimOps(pv, pOps, palette);
    const pb = pv.bounds();
    if (pb.count > 0) {
      const centerLocalX = (pb.minX + pb.maxX) / 2;
      const centerLocalY = (pb.minY + pb.maxY) / 2;
      const centerLocalZ = (pb.minZ + pb.maxZ) / 2;
      const distToOrigin = Math.hypot(centerLocalX, centerLocalY, centerLocalZ);
      const distToPivot = Math.hypot(centerLocalX - px, centerLocalY - py, centerLocalZ - pz);
      if (Math.hypot(px, py, pz) >= 4 && distToPivot < distToOrigin * 0.45) {
        pOps = pOps.map((o) => translateOp(o, -Math.round(px), -Math.round(py), -Math.round(pz)));
      }
    }

    const kindStr = typeof rec.kind === "string" ? rec.kind : "bob";
    const kind: VoxelPartKind = PART_KINDS[kindStr as VoxelPartKind] ? (kindStr as VoxelPartKind) : "bob";
    parts.push({
      name: sanitizePlainText(rec.name, 36, true) || "part",
      kind,
      speed: clamp(Number(num(rec.speed, 1.2).toFixed(2)), 0.25, 4.0),
      ...(rec.amp !== undefined ? { amp: clamp(Number(num(rec.amp, 0.35).toFixed(2)), 0.05, 1.4) } : {}),
      ...(rec.phase !== undefined ? { phase: clamp(Number(num(rec.phase, 0).toFixed(2)), 0, 6.28) } : {}),
      pivot: [Number(px.toFixed(2)), Number(py.toFixed(2)), Number(pz.toFixed(2))],
      ops: pOps,
    });
  }

  // Synchronize paired symmetrical wings (`swingZ`) and alternating gait legs (`swingX`):
  // For `swingZ` wings on opposite X shoulders (+X vs -X), +rotation.z lifts +X and drops -X,
  // so offsetting the -X wing by PI makes both wings flap UP and DOWN together symmetrically!
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    for (let j = i + 1; j < parts.length; j++) {
      const bPart = parts[j];
      if (a.kind !== bPart.kind) continue;
      const oppositeX =
        (a.pivot[0] > 0.5 && bPart.pivot[0] < -0.5) ||
        (a.pivot[0] < -0.5 && bPart.pivot[0] > 0.5);
      if (!oppositeX) continue;
      if (Math.abs(a.pivot[1] - bPart.pivot[1]) > 3.0 || Math.abs(a.pivot[2] - bPart.pivot[2]) > 3.0) {
        continue;
      }
      const phA = a.phase ?? 0;
      const phB = bPart.phase ?? 0;
      const diff = Math.abs((((phA - phB) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
      if (diff < 0.35 || diff > Math.PI * 2 - 0.35) {
        if (a.kind === "swingZ" || a.kind === "swingX") {
          const negPart = a.pivot[0] < 0 ? a : bPart;
          const posPart = a.pivot[0] < 0 ? bPart : a;
          negPart.phase = Number((((posPart.phase ?? 0) + Math.PI) % (Math.PI * 2)).toFixed(2));
        }
      }
    }
  }

  if (!options?.keepPlinth) {
    const ctxText = `${typeof raw.name === "string" ? raw.name : ""} ${typeof raw.description === "string" ? raw.description : ""} ${fallbackName} ${options?.contextText ?? ""}`;
    ops = stripRaisedPlatformOps(ops, palette, ctxText).ops;
  }

  // Simulate full combined voxel volume (base + parts at pivots) to compute exact ground contact!
  const calcCombined = (curOps: VoxelOp[], curParts: VoxelPart[]) => {
    const worldVox = new SimVox();
    applySimOps(worldVox, curOps, palette);
    for (const pt of curParts) {
      const pv = new SimVox();
      applySimOps(pv, pt.ops, palette);
      worldVox.merge(pv, Math.round(pt.pivot[0]), Math.round(pt.pivot[1]), Math.round(pt.pivot[2]));
    }
    return worldVox.bounds();
  };

  let b = calcCombined(ops, parts);
  if (b.count > 0 && b.minY !== 0) {
    const dy = -b.minY;
    ops = ops.map((o) => translateOp(o, 0, dy, 0));
    parts = parts.map((p) => ({
      ...p,
      pivot: [p.pivot[0], Number((p.pivot[1] + dy).toFixed(2)), p.pivot[2]],
    }));
    b = calcCombined(ops, parts);
  }

  // Center horizontally in X/Z so rotation and placement sit cleanly around (0, 0)
  if (b.count > 0) {
    const cxShift = -Math.round((b.minX + b.maxX) / 2);
    const czShift = -Math.round((b.minZ + b.maxZ) / 2);
    if (Math.abs(cxShift) >= 2 || Math.abs(czShift) >= 2) {
      ops = ops.map((o) => translateOp(o, cxShift, 0, czShift));
      parts = parts.map((p) => ({
        ...p,
        pivot: [
          Number((p.pivot[0] + cxShift).toFixed(2)),
          p.pivot[1],
          Number((p.pivot[2] + czShift).toFixed(2)),
        ],
      }));
      b = calcCombined(ops, parts);
    }
  }

  const catRaw = typeof raw.category === "string" ? raw.category.trim().toLowerCase() : "prop";
  const category: CreationCategory = CATEGORIES[catRaw as CreationCategory] ? (catRaw as CreationCategory) : "prop";

  const scaleRaw = typeof raw.scaleClass === "string" ? raw.scaleClass.trim().toLowerCase() : "";
  const defaultScale: ScaleClass =
    category === "building" ? "large" : category === "vehicle" || category === "aircraft" || category === "watercraft" ? "medium" : "small";
  const scaleClass: ScaleClass = SCALES[scaleRaw as ScaleClass] ? (scaleRaw as ScaleClass) : defaultScale;

  const name = sanitizePlainText(raw.name, 48, true) || sanitizePlainText(fallbackName, 48, true) || "Meadow Creation";
  let description =
    sanitizePlainText(raw.description, 224, true) || `A handcrafted micro-voxel ${name.toLowerCase()}.`;
  if (description.length > 220) {
    const cut = description.slice(0, 217);
    const lastSpace = cut.lastIndexOf(" ");
    description = `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, "")}…`;
  }

  const fullContextText = `${name} ${description} ${options?.contextText ?? ""}`;
  const interaction = sanitizeInteraction(raw.interaction, fullContextText);

  let finalCategory = category;
  let finalScaleClass = scaleClass;
  if (interaction) {
    if (finalCategory !== "building" && finalCategory !== "prop") {
      finalCategory = "prop";
    }
    if (finalScaleClass === "tiny") {
      finalScaleClass = "medium";
    }
  }

  const liveFeed = sanitizeLiveFeed(raw.liveFeed);
  let criticReview: BlueprintCriticReview | undefined;
  if (raw.criticReview && typeof raw.criticReview === "object") {
    const cr = raw.criticReview as Record<string, unknown>;
    if (typeof cr.approved === "boolean" && Number.isFinite(Number(cr.score))) {
      criticReview = {
        approved: cr.approved,
        score: clamp(Math.round(Number(cr.score)), 1, 10),
        attempts: clamp(Math.round(num(cr.attempts, 1)), 1, 5),
        ...(typeof cr.summary === "string" && cr.summary
          ? { summary: sanitizePlainText(cr.summary, 240, true) }
          : {}),
        reviewedAt: Number(cr.reviewedAt) || Date.now(),
      };
    }
  }

  const normalized: VoxelBlueprint = {
    version: 1,
    name,
    description,
    category: finalCategory,
    scaleClass: finalScaleClass,
    palette,
    ops,
    parts,
    ...(liveFeed ? { liveFeed } : {}),
    ...(interaction ? { interaction } : {}),
    ...(criticReview ? { criticReview } : {}),
    stats: {
      voxels: b.count,
      footprintX: Math.max(2, b.maxX - b.minX),
      footprintZ: Math.max(2, b.maxZ - b.minZ),
      maxY: Math.max(2, b.maxY),
    },
  };

  if (options?.skipAutoRepair) {
    return normalized;
  }
  return autoRepairBlueprintOverlaps(normalized).blueprint;
}

export function sanitizeBlueprintAmendment(
  raw: unknown,
  existingPalette: Record<string, string>,
): BlueprintAmendment | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const out: BlueprintAmendment = {};
  let hasChange = false;

  if (typeof rec.category === "string") {
    const c = rec.category.trim().toLowerCase() as CreationCategory;
    if (CATEGORIES[c]) {
      out.category = c;
      hasChange = true;
    }
  }
  if (typeof rec.scaleClass === "string") {
    const sc = rec.scaleClass.trim().toLowerCase() as ScaleClass;
    if (SCALES[sc]) {
      out.scaleClass = sc;
      hasChange = true;
    }
  }
  if (rec.stripPlinth === true) {
    out.stripPlinth = true;
    hasChange = true;
  }

  if (Array.isArray(rec.clearOps) && rec.clearOps.length > 0) {
    const clears: VoxelOp[] = [];
    for (const item of rec.clearOps.slice(0, 12)) {
      if (item && typeof item === "object" && (item as Record<string, unknown>).op === "clear") {
        const cleaned = sanitizeOp(item as Record<string, unknown>, existingPalette, false);
        if (cleaned && cleaned.op === "clear") clears.push(cleaned);
      }
    }
    if (clears.length > 0) {
      out.clearOps = clears;
      hasChange = true;
    }
  }

  if (Array.isArray(rec.upsertParts) && rec.upsertParts.length > 0) {
    const upserts: VoxelPart[] = [];
    for (const pRaw of rec.upsertParts.slice(0, 8)) {
      if (!pRaw || typeof pRaw !== "object") continue;
      const pr = pRaw as Record<string, unknown>;
      const piv = Array.isArray(pr.pivot) ? pr.pivot : [0, 4, 0];
      const px = clamp(num(piv[0], 0), -28, 28);
      const py = clamp(num(piv[1], 4), 0, 62);
      const pz = clamp(num(piv[2], 0), -28, 28);
      const pOps: VoxelOp[] = [];
      for (const opRaw of Array.isArray(pr.ops) ? pr.ops.slice(0, 24) : []) {
        if (opRaw && typeof opRaw === "object") {
          const cleaned = sanitizeOp(opRaw as Record<string, unknown>, existingPalette, true);
          if (cleaned) pOps.push(cleaned);
        }
      }
      if (!pOps.length) continue;
      const kindStr = typeof pr.kind === "string" ? pr.kind : "bob";
      const kind: VoxelPartKind = PART_KINDS[kindStr as VoxelPartKind] ? (kindStr as VoxelPartKind) : "bob";
      upserts.push({
        name: sanitizePlainText(pr.name, 36, true) || `part-${upserts.length + 1}`,
        kind,
        speed: clamp(Number(num(pr.speed, 1.5).toFixed(2)), 0.25, 4.0),
        ...(pr.amp !== undefined ? { amp: clamp(Number(num(pr.amp, 0.4).toFixed(2)), 0.05, 1.4) } : {}),
        ...(pr.phase !== undefined ? { phase: clamp(Number(num(pr.phase, 0).toFixed(2)), 0, 6.28) } : {}),
        pivot: [Number(px.toFixed(2)), Number(py.toFixed(2)), Number(pz.toFixed(2))],
        ops: pOps,
      });
    }
    if (upserts.length > 0) {
      out.upsertParts = upserts;
      hasChange = true;
    }
  }

  return hasChange ? out : null;
}

export function applyBlueprintAmendment(
  existing: VoxelBlueprint,
  amendment: BlueprintAmendment,
): VoxelBlueprint {
  let nextOps = amendment.stripPlinth
    ? existing.ops.filter((o) => o.op !== "plinth")
    : [...existing.ops];

  if (amendment.clearOps && amendment.clearOps.length > 0) {
    nextOps = [...nextOps, ...amendment.clearOps];
  }

  let nextParts = [...existing.parts];
  if (amendment.upsertParts && amendment.upsertParts.length > 0) {
    for (const up of amendment.upsertParts) {
      const idx = nextParts.findIndex((p) => p.name.toLowerCase() === up.name.toLowerCase());
      if (idx >= 0) nextParts[idx] = up;
      else if (nextParts.length < 16) nextParts.push(up);
    }
  }

  const candidate = normalizeAndGroundBlueprint(
    {
      name: existing.name,
      description: existing.description,
      category: amendment.category ?? existing.category,
      scaleClass: amendment.scaleClass ?? existing.scaleClass,
      palette: existing.palette,
      ops: nextOps,
      parts: nextParts,
      liveFeed: existing.liveFeed ?? null,
      ...(existing.interaction ? { interaction: existing.interaction } : {}),
      ...(existing.criticReview ? { criticReview: existing.criticReview } : {}),
    },
    existing.name,
  );

  // Guard: never let an overly broad clearOp wipe out most of the sculpture's voxels
  const minSafeVoxels = Math.max(25, Math.floor(existing.stats.voxels * 0.4));
  if (candidate.stats.voxels < minSafeVoxels && amendment.clearOps?.length) {
    return applyBlueprintAmendment(existing, { ...amendment, clearOps: undefined });
  }
  return candidate.stats.voxels >= 25 ? candidate : existing;
}

export function rasterizeCompleteBlueprint(bp: VoxelBlueprint): SimVox {
  const full = new SimVox();
  applySimOps(full, bp.ops || [], bp.palette || {});
  for (const part of bp.parts || []) {
    const pv = new SimVox();
    applySimOps(pv, part.ops || [], bp.palette || {});
    const [px, py, pz] = part.pivot || [0, 0, 0];
    full.merge(pv, Math.round(px), Math.round(py), Math.round(pz));
  }
  return full;
}

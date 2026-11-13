// Micro-Voxel CSG Compiler, 4-Corner Baked AO Mesher, and 3D Chamfered Bevel Shader.
// Exact client-side counterpart to src/voxel_dsl.ts.

import * as THREE from "three";

export const VOXEL_UNIT = 0.25;
export const SCALE_FACTORS = {
  tiny: 0.4,
  small: 0.56,
  medium: 0.92,
  large: 1.14,
  colossal: 1.72,
};

export function getWorldVoxelSize(scaleClass) {
  return VOXEL_UNIT * (SCALE_FACTORS[scaleClass] || SCALE_FACTORS.medium);
}

export function getCreationFootprintRadius(scaleClass, footprintX = 14, footprintZ = 14) {
  const voxSize = getWorldVoxelSize(scaleClass);
  const maxSpan = Math.max(4, footprintX || 14, footprintZ || 14);
  const minSpan = Math.max(4, Math.min(footprintX || 14, footprintZ || 14));
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

export const PALETTE = {
  grass: "#86c864",
  grass2: "#78ba57",
  grass3: "#97d675",
  soil: "#8b5e3c",
  soilDark: "#70492c",
  path: "#e6d6b5",
  path2: "#d8c6a1",
  concrete: "#dcd6cb",
  stone: "#8e948c",
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

const AO_LEVELS = [0.22, 0.48, 0.76, 1.0];

const FACES = [
  {
    n: [1, 0, 0],
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    aoDirs: [
      [[1, -1, 0], [1, 0, 1], [1, -1, 1]],
      [[1, -1, 0], [1, 0, -1], [1, -1, -1]],
      [[1, 1, 0], [1, 0, -1], [1, 1, -1]],
      [[1, 1, 0], [1, 0, 1], [1, 1, 1]],
    ],
  },
  {
    n: [-1, 0, 0],
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    aoDirs: [
      [[-1, -1, 0], [-1, 0, -1], [-1, -1, -1]],
      [[-1, -1, 0], [-1, 0, 1], [-1, -1, 1]],
      [[-1, 1, 0], [-1, 0, 1], [-1, 1, 1]],
      [[-1, 1, 0], [-1, 0, -1], [-1, 1, -1]],
    ],
  },
  {
    n: [0, 1, 0],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    aoDirs: [
      [[-1, 1, 0], [0, 1, 1], [-1, 1, 1]],
      [[1, 1, 0], [0, 1, 1], [1, 1, 1]],
      [[1, 1, 0], [0, 1, -1], [1, 1, -1]],
      [[-1, 1, 0], [0, 1, -1], [-1, 1, -1]],
    ],
  },
  {
    n: [0, -1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    aoDirs: [
      [[-1, -1, 0], [0, -1, -1], [-1, -1, -1]],
      [[1, -1, 0], [0, -1, -1], [1, -1, -1]],
      [[1, -1, 0], [0, -1, 1], [1, -1, 1]],
      [[-1, -1, 0], [0, -1, 1], [-1, -1, 1]],
    ],
  },
  {
    n: [0, 0, 1],
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    aoDirs: [
      [[-1, 0, 1], [0, -1, 1], [-1, -1, 1]],
      [[1, 0, 1], [0, -1, 1], [1, -1, 1]],
      [[1, 0, 1], [0, 1, 1], [1, 1, 1]],
      [[-1, 0, 1], [0, 1, 1], [-1, 1, 1]],
    ],
  },
  {
    n: [0, 0, -1],
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    aoDirs: [
      [[1, 0, -1], [0, -1, -1], [1, -1, -1]],
      [[-1, 0, -1], [0, -1, -1], [-1, -1, -1]],
      [[-1, 0, -1], [0, 1, -1], [-1, 1, -1]],
      [[1, 0, -1], [0, 1, -1], [1, 1, -1]],
    ],
  },
];

const QUAD_UVS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

for (const f of FACES) {
  const c0 = f.corners[0];
  const c1 = f.corners[1];
  const c3 = f.corners[3];
  f.stepU = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
  f.stepV = [c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2]];
}

const rgbCache = new Map();
export function parseColorLinear(hexOrName) {
  const safeName = typeof hexOrName === "string" ? hexOrName : "";
  const key = (Object.hasOwn(PALETTE, safeName) ? PALETTE[safeName] : safeName) || "#eae4d7";
  let cached = rgbCache.get(key);
  if (!cached) {
    const c = new THREE.Color();
    try {
      c.set(key);
    } catch {
      c.set("#eae4d7");
    }
    const lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const sat = 1.14;
    cached = [
      Math.max(0, Math.min(1, lum + (c.r - lum) * sat)),
      Math.max(0, Math.min(1, lum + (c.g - lum) * sat)),
      Math.max(0, Math.min(1, lum + (c.b - lum) * sat)),
    ];
    rgbCache.set(key, cached);
  }
  return cached;
}

export function hashCoords(x, y, z, seed = 1) {
  let n =
    Math.imul(x | 0, 73856093) ^
    Math.imul(y | 0, 19349663) ^
    Math.imul(z | 0, 83492791) ^
    Math.imul(seed | 0, 2654435761);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

const KEY_BIAS = 512;
const KEY_MASK = 1023;
export function packVoxKey(x, y, z) {
  return (
    (((x + KEY_BIAS) & KEY_MASK) << 20) |
    (((y + KEY_BIAS) & KEY_MASK) << 10) |
    ((z + KEY_BIAS) & KEY_MASK)
  );
}

const styleKeyToId = new Map();
const styleRgbs = [null];
const styleEmits = [0];

function internVoxStyle(colStr, emitVal) {
  const numEmit = Number(emitVal) || 0;
  const k = numEmit === 0 ? colStr : `${colStr}|${numEmit}`;
  let id = styleKeyToId.get(k);
  if (!id) {
    id = styleRgbs.length;
    styleKeyToId.set(k, id);
    styleRgbs.push(parseColorLinear(colStr));
    styleEmits.push(numEmit);
  }
  return id;
}

export class Vox {
  constructor(seed = 1) {
    this.v = new Map();
    this.seed = seed;
  }

  get size() {
    return this.v.size;
  }

  hasCell(x, y, z) {
    return this.v.has(packVoxKey(x | 0, y | 0, z | 0));
  }

  resolveColor(color, x, y, z) {
    const raw = typeof color === "function" ? color(x, y, z) : color;
    if (!raw) return null;
    return PALETTE[raw] || raw;
  }

  put(x, y, z, color, emit = 0) {
    const xi = Math.round(x) | 0;
    const yi = Math.round(y) | 0;
    const zi = Math.round(z) | 0;
    const col = this.resolveColor(color, xi, yi, zi);
    const k = packVoxKey(xi, yi, zi);
    if (!col) this.v.delete(k);
    else this.v.set(k, internVoxStyle(col, emit));
    return this;
  }

  box(x0, y0, z0, x1, y1, z1, color, emit = 0) {
    const ax0 = Math.round(Math.min(x0, x1)) | 0;
    const ax1 = Math.round(Math.max(x0, x1)) | 0;
    const ay0 = Math.round(Math.min(y0, y1)) | 0;
    const ay1 = Math.round(Math.max(y0, y1)) | 0;
    const az0 = Math.round(Math.min(z0, z1)) | 0;
    const az1 = Math.round(Math.max(z0, z1)) | 0;
    if (typeof color !== "function") {
      const constCol = color ? PALETTE[color] || color : null;
      if (!constCol) {
        if (this.v.size === 0) return this;
        for (let x = ax0; x < ax1; x++) {
          const kx = ((x + KEY_BIAS) & KEY_MASK) << 20;
          for (let y = ay0; y < ay1; y++) {
            const kxy = kx | (((y + KEY_BIAS) & KEY_MASK) << 10);
            for (let z = az0; z < az1; z++) {
              this.v.delete(kxy | ((z + KEY_BIAS) & KEY_MASK));
            }
          }
        }
      } else {
        const styleId = internVoxStyle(constCol, emit);
        for (let x = ax0; x < ax1; x++) {
          const kx = ((x + KEY_BIAS) & KEY_MASK) << 20;
          for (let y = ay0; y < ay1; y++) {
            const kxy = kx | (((y + KEY_BIAS) & KEY_MASK) << 10);
            for (let z = az0; z < az1; z++) {
              this.v.set(kxy | ((z + KEY_BIAS) & KEY_MASK), styleId);
            }
          }
        }
      }
      return this;
    }
    for (let x = ax0; x < ax1; x++) {
      for (let y = ay0; y < ay1; y++) {
        for (let z = az0; z < az1; z++) {
          this.put(x, y, z, color, emit);
        }
      }
    }
    return this;
  }

  roundedBox(x0, y0, z0, x1, y1, z1, radius, color, emit = 0) {
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

  clear(x0, y0, z0, x1, y1, z1) {
    return this.box(x0, y0, z0, x1, y1, z1, null);
  }

  pillars(x0, y0, z0, x1, y1, z1, color) {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    for (const px of [ax0, ax1 - 1]) {
      for (const pz of [az0, az1 - 1]) {
        this.box(px, y0, pz, px + 1, y1, pz + 1, color);
      }
    }
    return this;
  }

  hollowBox(x0, y0, z0, x1, y1, z1, wall = 1, color = "plaster", trim = null) {
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

  plinth(sizeX = 16, heightY = 2, sizeZ = 16, baseCol = "concrete2", topCol = "limestone", cornerCol = "brass") {
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

  cylinderAxis(axis, c1, c2, s0, s1, radius, color, emit = 0) {
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

  ringAxis(axis, c1, c2, s0, s1, outerR, innerR, color, emit = 0) {
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

  cone(cx, y0, y1, cz, rBottom, rTop, color, emit = 0) {
    const ay0 = Math.round(Math.min(y0, y1)), ay1 = Math.max(ay0 + 1, Math.round(Math.max(y0, y1)));
    const span = Math.max(1, ay1 - ay0);
    for (let y = ay0; y < ay1; y++) {
      const t = (y - ay0) / span;
      const r = rBottom + (rTop - rBottom) * t;
      this.cylinderAxis("y", cx, cz, y, y + 1, Math.max(0.45, r), color, emit);
    }
    return this;
  }

  sphere(cx, cy, cz, rx, ry = rx, rz = rx, color = "leaf", emit = 0) {
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

  dome(cx, yBase, cz, radius, color, emit = 0) {
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

  roofGable(x0, yBase, z0, x1, z1, rise = 4, axis = "x", roofCol = "terracotta", trimCol = "cream") {
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

  roofPyramid(x0, yBase, z0, x1, z1, roofCol = "slate", trimCol = "gold") {
    const ax0 = Math.round(Math.min(x0, x1)), ax1 = Math.round(Math.max(x0, x1));
    const az0 = Math.round(Math.min(z0, z1)), az1 = Math.round(Math.max(z0, z1));
    for (let s = 0; ax0 + s < ax1 - s && az0 + s < az1 - s; s++) {
      this.box(ax0 + s, yBase + s, az0 + s, ax1 - s, yBase + s + 1, az1 - s, s === 0 && trimCol ? trimCol : roofCol);
    }
    return this;
  }

  stairs(x0, y0, z0, steps, width, dir = "+z", color = "limestone") {
    for (let i = 0; i < steps; i++) {
      if (dir === "+z") this.box(x0, y0, z0 + i, x0 + width, y0 + steps - i, z0 + i + 1, color);
      else if (dir === "-z") this.box(x0, y0, z0 - i, x0 + width, y0 + steps - i, z0 - i + 1, color);
      else if (dir === "+x") this.box(x0 + i, y0, z0, x0 + i + 1, y0 + steps - i, z0 + width, color);
      else this.box(x0 - i, y0, z0, x0 - i + 1, y0 + steps - i, z0 + width, color);
    }
    return this;
  }

  arch(cx, y0, cz, halfSpan = 3, height = 6, depth = 2, axis = "z", color = "brick") {
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

  line(x0, y0, z0, x1, y1, z1, radius = 0, color = "steel", emit = 0) {
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

  bounds() {
    if (!this.v.size) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, count: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const k of this.v.keys()) {
      const x = ((k >> 20) & KEY_MASK) - KEY_BIAS;
      const y = ((k >> 10) & KEY_MASK) - KEY_BIAS;
      const z = (k & KEY_MASK) - KEY_BIAS;
      if (x < minX) minX = x;
      if (x + 1 > maxX) maxX = x + 1;
      if (y < minY) minY = y;
      if (y + 1 > maxY) maxY = y + 1;
      if (z < minZ) minZ = z;
      if (z + 1 > maxZ) maxZ = z + 1;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, count: this.v.size };
  }
}

export function mirrorOpX(op) {
  switch (op.op) {
    case "box":
    case "roundedBox":
    case "clear":
      return { ...op, x0: -op.x1, x1: -op.x0, mirrorX: false };
    case "cylinder":
    case "ring": {
      const axis = op.axis ?? "y";
      if (axis === "x") {
        const s0 = op.x0 ?? -2, s1 = op.x1 ?? 2;
        return { ...op, x0: -s1, x1: -s0, mirrorX: false };
      }
      return { ...op, cx: -(op.cx ?? 0), mirrorX: false };
    }
    case "cone":
    case "sphere":
    case "dome":
      return { ...op, cx: -op.cx, mirrorX: false };
    case "line":
      return { ...op, x0: -op.x0, x1: -op.x1, mirrorX: false };
    case "voxels":
      return { ...op, list: (op.list || []).map(([x, y, z, c, e]) => [-(x + 1), y, z, c, e]), mirrorX: false };
    default:
      return null;
  }
}

export function applyOps(vox, ops = [], customPalette = {}) {
  const col = (c) =>
    (typeof c === "string" && customPalette && Object.hasOwn(customPalette, c) ? customPalette[c] : undefined) ||
    (typeof c === "string" && Object.hasOwn(PALETTE, c) ? PALETTE[c] : undefined) ||
    c;
  const runOne = (op) => {
    if (!op || typeof op !== "object") return;
    const emit = Number(op.emit) || 0;
    switch (op.op) {
      case "plinth":
        vox.plinth(op.sizeX ?? 16, op.heightY ?? 2, op.sizeZ ?? 16, col(op.base ?? "concrete2"), col(op.top ?? "limestone"), col(op.corner ?? "brass"));
        break;
      case "box":
        vox.box(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, col(op.color), emit);
        break;
      case "roundedBox":
        vox.roundedBox(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, op.radius ?? 1.5, col(op.color), emit);
        break;
      case "clear":
        vox.clear(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1);
        break;
      case "hollowBox":
        vox.hollowBox(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, op.wall ?? 1, col(op.color), op.trim ? col(op.trim) : null);
        break;
      case "pillars":
        vox.pillars(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, col(op.color));
        break;
      case "cylinder": {
        const axis = op.axis ?? "y";
        const c = op.carve ? null : col(op.color ?? "steel");
        if (axis === "x") vox.cylinderAxis("x", op.cy ?? 0, op.cz ?? 0, op.x0 ?? -2, op.x1 ?? 2, op.radius ?? 2.5, c, emit);
        else if (axis === "z") vox.cylinderAxis("z", op.cx ?? 0, op.cy ?? 2, op.z0 ?? -2, op.z1 ?? 2, op.radius ?? 2.5, c, emit);
        else vox.cylinderAxis("y", op.cx ?? 0, op.cz ?? 0, op.y0 ?? 0, op.y1 ?? 6, op.radius ?? 2.5, c, emit);
        break;
      }
      case "ring": {
        const axis = op.axis ?? "y";
        if (axis === "x") vox.ringAxis("x", op.cy ?? 0, op.cz ?? 0, op.x0 ?? -2, op.x1 ?? 2, op.outerR ?? 3, op.innerR ?? 1.6, col(op.color), emit);
        else if (axis === "z") vox.ringAxis("z", op.cx ?? 0, op.cy ?? 2, op.z0 ?? -2, op.z1 ?? 2, op.outerR ?? 3, op.innerR ?? 1.6, col(op.color), emit);
        else vox.ringAxis("y", op.cx ?? 0, op.cz ?? 0, op.y0 ?? 0, op.y1 ?? 2, op.outerR ?? 3, op.innerR ?? 1.6, col(op.color), emit);
        break;
      }
      case "cone":
        vox.cone(op.cx, op.y0, op.y1, op.cz, op.rBottom, op.rTop ?? 0.5, col(op.color), emit);
        break;
      case "sphere":
        vox.sphere(op.cx, op.cy, op.cz, op.rx, op.ry ?? op.rx, op.rz ?? op.rx, op.carve ? null : col(op.color ?? "leaf"), emit);
        break;
      case "dome":
        vox.dome(op.cx, op.yBase, op.cz, op.radius, col(op.color), emit);
        break;
      case "roofGable":
        vox.roofGable(op.x0, op.yBase, op.z0, op.x1, op.z1, op.rise ?? 4, op.axis ?? "x", col(op.color ?? "terracotta"), op.trim ? col(op.trim) : null);
        break;
      case "roofPyramid":
        vox.roofPyramid(op.x0, op.yBase, op.z0, op.x1, op.z1, col(op.color ?? "slate"), op.trim ? col(op.trim) : null);
        break;
      case "stairs":
        vox.stairs(op.x0, op.y0, op.z0, op.steps ?? 2, op.width ?? 4, op.dir ?? "+z", col(op.color ?? "limestone"));
        break;
      case "arch":
        vox.arch(op.cx, op.y0, op.cz, op.halfSpan ?? 3, op.height ?? 6, op.depth ?? 2, op.axis ?? "z", col(op.color ?? "brick"));
        break;
      case "line":
        vox.line(op.x0, op.y0, op.z0, op.x1, op.y1, op.z1, op.radius ?? 0, col(op.color ?? "steel"), emit);
        break;
      case "voxels":
        for (const v of op.list || []) {
          vox.put(v[0], v[1], v[2], col(v[3]), v[4] || 0);
        }
        break;
    }
  };

  for (const op of ops) {
    runOne(op);
    if (op?.mirrorX) {
      const m = mirrorOpX(op);
      if (m) runOne(m);
    }
  }
  return vox;
}

const voxelLayerMaterials = new Map();
const voxShaderUniforms = {
  uVoxDetailScale: { value: 1.0 },
};

export function setVoxelShaderDetailScale(scale = 1.0) {
  voxShaderUniforms.uVoxDetailScale.value = Math.max(0, Math.min(1, Number(scale) || 0));
}

function createVoxelStandardMaterial(layerIndex = 0) {
  const layer = Math.max(0, Math.min(7, layerIndex | 0));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.06,
    dithering: true,
    ...(layer > 0
      ? {
          polygonOffset: true,
          polygonOffsetFactor: -layer,
          polygonOffsetUnits: -layer * 1.5,
        }
      : {}),
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVoxDetailScale = voxShaderUniforms.uVoxDetailScale;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aEmit;
        attribute float aJitterSeed;
        varying float vEmit;
        varying float vJitterSeed;
        varying vec2 vVoxUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vEmit = aEmit;
        vJitterSeed = aJitterSeed;
        vVoxUv = uv;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uVoxDetailScale;
        varying float vEmit;
        varying float vJitterSeed;
        varying vec2 vVoxUv;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float voxPx = max(fwidth(vVoxUv.x), fwidth(vVoxUv.y));
        float voxDetail = (1.0 - smoothstep(0.04, 0.14, voxPx)) * uVoxDetailScale;
        if (voxDetail > 0.005) {
          vec2 cellUv = fract(vVoxUv);
          if (vJitterSeed >= 0.0) {
            vec2 cellId = floor(vVoxUv);
            vec2 jq = fract(cellId * vec2(123.34, 456.21) + vJitterSeed);
            jq += dot(jq, jq + 45.32);
            float cellJ = fract(jq.x * jq.y) - 0.5;
            diffuseColor.rgb *= 1.0 + cellJ * 0.072 * voxDetail;
          }
          float edgeDist = min(min(cellUv.x, 1.0 - cellUv.x), min(cellUv.y, 1.0 - cellUv.y));
          float seam = smoothstep(0.0, max(0.085, voxPx * 1.45), edgeDist);
          float hi = smoothstep(0.14, 0.02, edgeDist) * (cellUv.y * 0.6 + 0.4);
          diffuseColor.rgb *= mix(1.0 - 0.22 * voxDetail, 1.0, seam);
          diffuseColor.rgb += hi * 0.05 * voxDetail;
        }
        if (vEmit > 0.05) {
          diffuseColor.rgb *= 0.48;
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (uVoxDetailScale > 0.02) {
          float bevPx = max(fwidth(vVoxUv.x), fwidth(vVoxUv.y));
          float bevStrength = (1.0 - smoothstep(0.04, 0.14, bevPx)) * uVoxDetailScale;
          if (bevStrength > 0.02) {
            vec3 dPosX = dFdx(vViewPosition);
            vec3 dPosY = dFdy(vViewPosition);
            vec2 dUvX = dFdx(vVoxUv);
            vec2 dUvY = dFdy(vVoxUv);
            vec2 bevUv = fract(vVoxUv);
            float bevW = 0.115;
            float bx = smoothstep(bevW, 0.0, bevUv.x) - smoothstep(1.0 - bevW, 1.0, bevUv.x);
            float by = smoothstep(bevW, 0.0, bevUv.y) - smoothstep(1.0 - bevW, 1.0, bevUv.y);
            vec3 surfT = normalize(dPosX * dUvY.y - dPosY * dUvX.y + 1e-6);
            vec3 surfB = normalize(-dPosX * dUvY.x + dPosY * dUvX.x + 1e-6);
            normal = normalize(normal - (surfT * bx + surfB * by) * (0.26 * bevStrength));
          }
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * min(vEmit * 0.9, 1.35);`,
      );
  };
  mat.customProgramCacheKey = () => "meadow-voxel-bevel-ao-v3";
  return mat;
}

export function getVoxelMaterialForLayer(layerIndex = 0) {
  const layer = Math.max(0, Math.min(7, layerIndex | 0));
  if (!voxelLayerMaterials.has(layer)) {
    voxelLayerMaterials.set(layer, createVoxelStandardMaterial(layer));
  }
  return voxelLayerMaterials.get(layer);
}

export function getSharedVoxelMaterial() {
  return getVoxelMaterialForLayer(0);
}

let ghostMat = null;
function getGhostVoxelMaterial() {
  if (!ghostMat) {
    ghostMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.05,
      transparent: true,
      opacity: 0.78,
      emissive: new THREE.Color("#429867"),
      emissiveIntensity: 0.18,
    });
  }
  return ghostMat;
}

let greedyMaskScratch = new Int32Array(4096);

export function buildVoxelMesh(vox, options = {}) {
  const {
    jitter = 0.036,
    ao = true,
    scale = 1,
    castShadow = true,
    receiveShadow = true,
    ghost = false,
    depthLayer = 0,
    cullFloorY = null,
  } = options;

  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const emits = [];
  const jSeeds = [];
  const indices = [];

  const map = vox.v;
  const seedBase = (vox.seed & 1023) * 0.73;
  let vertCount = 0;

  const emitQuad = (
    x0,
    y0,
    z0,
    w,
    h,
    face,
    fi,
    sliceW,
    u0,
    v0,
    br,
    bg,
    bb,
    ao0,
    ao1,
    ao2,
    ao3,
    emit,
    dirShade,
  ) => {
    const [nx, ny, nz] = face.n;
    const c0 = face.corners[0];
    const su = face.stepU;
    const sv = face.stepV;
    const bx = x0 + c0[0];
    const by = y0 + c0[1];
    const bz = z0 + c0[2];
    const wx = w * su[0];
    const wy = w * su[1];
    const wz = w * su[2];
    const hx = h * sv[0];
    const hy = h * sv[1];
    const hz = h * sv[2];

    positions.push(
      bx * scale,
      by * scale,
      bz * scale,
      (bx + wx) * scale,
      (by + wy) * scale,
      (bz + wz) * scale,
      (bx + wx + hx) * scale,
      (by + wy + hy) * scale,
      (bz + wz + hz) * scale,
      (bx + hx) * scale,
      (by + hy) * scale,
      (bz + hz) * scale,
    );
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);

    const s0 = ao0 * dirShade;
    const s1 = ao1 * dirShade;
    const s2 = ao2 * dirShade;
    const s3 = ao3 * dirShade;
    colors.push(
      Math.min(1, br * s0),
      Math.min(1, bg * s0),
      Math.min(1, bb * s0),
      Math.min(1, br * s1),
      Math.min(1, bg * s1),
      Math.min(1, bb * s1),
      Math.min(1, br * s2),
      Math.min(1, bg * s2),
      Math.min(1, bb * s2),
      Math.min(1, br * s3),
      Math.min(1, bg * s3),
      Math.min(1, bb * s3),
    );

    const uBase = u0 + 512;
    const vBase = v0 + 512;
    uvs.push(uBase, vBase, uBase + w, vBase, uBase + w, vBase + h, uBase, vBase + h);
    emits.push(emit, emit, emit, emit);

    const jSeed = jitter > 0 && !ghost ? seedBase + fi * 13.1 + (sliceW + 512) * 2.3 : -1.0;
    jSeeds.push(jSeed, jSeed, jSeed, jSeed);

    if (ao0 + ao2 < ao1 + ao3) {
      indices.push(
        vertCount + 1,
        vertCount + 2,
        vertCount + 3,
        vertCount + 1,
        vertCount + 3,
        vertCount + 0,
      );
    } else {
      indices.push(
        vertCount + 0,
        vertCount + 1,
        vertCount + 2,
        vertCount + 0,
        vertCount + 2,
        vertCount + 3,
      );
    }
    vertCount += 4;
  };

  // Slices grouped by face direction (0..5) -> sliceW -> flat [u, v, faceToken, ...]
  // faceToken = (styleId << 8) | (ai0 << 6) | (ai1 << 4) | (ai2 << 2) | ai3
  const faceSlices = [new Map(), new Map(), new Map(), new Map(), new Map(), new Map()];

  for (const [k, styleId] of map.entries()) {
    const x = ((k >> 20) & KEY_MASK) - KEY_BIAS;
    const y = ((k >> 10) & KEY_MASK) - KEY_BIAS;
    const z = (k & KEY_MASK) - KEY_BIAS;
    const emit = styleEmits[styleId];
    const parsedRgb = styleRgbs[styleId];

    for (let fi = 0; fi < 6; fi++) {
      if (cullFloorY !== null && fi === 3 && y === cullFloorY) continue;
      const face = FACES[fi];
      const [nx, ny, nz] = face.n;
      if (map.has(packVoxKey(x + nx, y + ny, z + nz))) continue;

      let ai0 = 3;
      let ai1 = 3;
      let ai2 = 3;
      let ai3 = 3;
      if (ao && emit < 0.5) {
        const dirs = face.aoDirs;
        {
          const [d1, d2, dc] = dirs[0];
          const s1 = map.has(packVoxKey(x + d1[0], y + d1[1], z + d1[2]));
          const s2 = map.has(packVoxKey(x + d2[0], y + d2[1], z + d2[2]));
          const sc = map.has(packVoxKey(x + dc[0], y + dc[1], z + dc[2]));
          ai0 = s1 && s2 ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0));
        }
        {
          const [d1, d2, dc] = dirs[1];
          const s1 = map.has(packVoxKey(x + d1[0], y + d1[1], z + d1[2]));
          const s2 = map.has(packVoxKey(x + d2[0], y + d2[1], z + d2[2]));
          const sc = map.has(packVoxKey(x + dc[0], y + dc[1], z + dc[2]));
          ai1 = s1 && s2 ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0));
        }
        {
          const [d1, d2, dc] = dirs[2];
          const s1 = map.has(packVoxKey(x + d1[0], y + d1[1], z + d1[2]));
          const s2 = map.has(packVoxKey(x + d2[0], y + d2[1], z + d2[2]));
          const sc = map.has(packVoxKey(x + dc[0], y + dc[1], z + dc[2]));
          ai2 = s1 && s2 ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0));
        }
        {
          const [d1, d2, dc] = dirs[3];
          const s1 = map.has(packVoxKey(x + d1[0], y + d1[1], z + d1[2]));
          const s2 = map.has(packVoxKey(x + d2[0], y + d2[1], z + d2[2]));
          const sc = map.has(packVoxKey(x + dc[0], y + dc[1], z + dc[2]));
          ai3 = s1 && s2 ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0));
        }
      }

      const su = face.stepU;
      const sv = face.stepV;
      const sliceW = x * nx + y * ny + z * nz;
      const u = x * su[0] + y * su[1] + z * su[2];
      const v = x * sv[0] + y * sv[1] + z * sv[2];

      // Uniform AO (2D merge) OR 1D-constant AO creases (exact linear interpolation along U or V!)
      const canMergeU = ai0 === ai1 && ai2 === ai3;
      const canMergeV = ai0 === ai3 && ai1 === ai2;
      if (canMergeU || canMergeV) {
        let bucket = faceSlices[fi].get(sliceW);
        if (!bucket) {
          bucket = { minU: u, maxU: u, minV: v, maxV: v, items: [] };
          faceSlices[fi].set(sliceW, bucket);
        } else {
          if (u < bucket.minU) bucket.minU = u;
          if (u > bucket.maxU) bucket.maxU = u;
          if (v < bucket.minV) bucket.minV = v;
          if (v > bucket.maxV) bucket.maxV = v;
        }
        const token = (styleId << 8) | (ai0 << 6) | (ai1 << 4) | (ai2 << 2) | ai3;
        bucket.items.push(u, v, token);
      } else {
        const dirShade =
          ny > 0 ? 1.04 : ny < 0 ? 0.64 : nz > 0 ? 0.96 : nx > 0 ? 0.89 : nx < 0 ? 0.83 : 0.79;
        emitQuad(
          x,
          y,
          z,
          1,
          1,
          face,
          fi,
          sliceW,
          u,
          v,
          parsedRgb[0],
          parsedRgb[1],
          parsedRgb[2],
          AO_LEVELS[ai0],
          AO_LEVELS[ai1],
          AO_LEVELS[ai2],
          AO_LEVELS[ai3],
          emit,
          dirShade,
        );
      }
    }
  }

  // Greedy merge across every coplanar slice (2D for uniform AO, 1D strips for straight wall/sill creases)
  for (let fi = 0; fi < 6; fi++) {
    const face = FACES[fi];
    const [nx, ny, nz] = face.n;
    const su = face.stepU;
    const sv = face.stepV;
    const dirShade =
      ny > 0 ? 1.04 : ny < 0 ? 0.64 : nz > 0 ? 0.96 : nx > 0 ? 0.89 : nx < 0 ? 0.83 : 0.79;

    for (const [sliceW, bucket] of faceSlices[fi].entries()) {
      const items = bucket.items;
      if (items.length === 3) {
        const u0 = items[0];
        const v0 = items[1];
        const token = items[2];
        const styleId = token >>> 8;
        const rgb = styleRgbs[styleId];
        const x0 = sliceW * nx + u0 * su[0] + v0 * sv[0];
        const y0 = sliceW * ny + u0 * su[1] + v0 * sv[1];
        const z0 = sliceW * nz + u0 * su[2] + v0 * sv[2];
        emitQuad(
          x0,
          y0,
          z0,
          1,
          1,
          face,
          fi,
          sliceW,
          u0,
          v0,
          rgb[0],
          rgb[1],
          rgb[2],
          AO_LEVELS[(token >>> 6) & 3],
          AO_LEVELS[(token >>> 4) & 3],
          AO_LEVELS[(token >>> 2) & 3],
          AO_LEVELS[token & 3],
          styleEmits[styleId],
          dirShade,
        );
        continue;
      }

      const { minU, minV } = bucket;
      const spanU = bucket.maxU - minU + 1;
      const spanV = bucket.maxV - minV + 1;
      const area = spanU * spanV;
      if (area > greedyMaskScratch.length) {
        greedyMaskScratch = new Int32Array(Math.max(area, greedyMaskScratch.length * 2));
      }
      const mask = greedyMaskScratch;
      mask.fill(0, 0, area);

      for (let idx = 0; idx < items.length; idx += 3) {
        mask[(items[idx + 1] - minV) * spanU + (items[idx] - minU)] = items[idx + 2];
      }

      for (let dv = 0; dv < spanV; dv++) {
        const rowOff = dv * spanU;
        for (let du = 0; du < spanU; du++) {
          const token = mask[rowOff + du];
          if (token === 0) continue;

          const ai0 = (token >>> 6) & 3;
          const ai1 = (token >>> 4) & 3;
          const ai2 = (token >>> 2) & 3;
          const ai3 = token & 3;
          const allowU = ai0 === ai1 && ai2 === ai3;
          const allowV = ai0 === ai3 && ai1 === ai2;

          let w = 1;
          if (allowU) {
            while (du + w < spanU && mask[rowOff + du + w] === token) {
              w++;
            }
          }

          let h = 1;
          if (allowV) {
            outerH: while (dv + h < spanV) {
              const nextRow = (dv + h) * spanU + du;
              for (let k = 0; k < w; k++) {
                if (mask[nextRow + k] !== token) break outerH;
              }
              h++;
            }
          }

          for (let r = 0; r < h; r++) {
            const clrRow = (dv + r) * spanU + du;
            for (let k = 0; k < w; k++) {
              mask[clrRow + k] = 0;
            }
          }

          const u0 = minU + du;
          const v0 = minV + dv;
          const x0 = sliceW * nx + u0 * su[0] + v0 * sv[0];
          const y0 = sliceW * ny + u0 * su[1] + v0 * sv[1];
          const z0 = sliceW * nz + u0 * su[2] + v0 * sv[2];
          const styleId = token >>> 8;
          const rgb = styleRgbs[styleId];
          emitQuad(
            x0,
            y0,
            z0,
            w,
            h,
            face,
            fi,
            sliceW,
            u0,
            v0,
            rgb[0],
            rgb[1],
            rgb[2],
            AO_LEVELS[ai0],
            AO_LEVELS[ai1],
            AO_LEVELS[ai2],
            AO_LEVELS[ai3],
            styleEmits[styleId],
            dirShade,
          );
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("aEmit", new THREE.Float32BufferAttribute(emits, 1));
  geo.setAttribute("aJitterSeed", new THREE.Float32BufferAttribute(jSeeds, 1));
  geo.setIndex(
    vertCount <= 65535
      ? new THREE.Uint16BufferAttribute(indices, 1)
      : new THREE.Uint32BufferAttribute(indices, 1),
  );
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geo,
    ghost ? getGhostVoxelMaterial() : getVoxelMaterialForLayer(depthLayer),
  );
  mesh.castShadow = castShadow && !ghost;
  mesh.receiveShadow = receiveShadow && !ghost;
  return mesh;
}

/**
 * Merges an array of static voxel mesh instances `{ mesh, x, y, z, rotY, scaleX, scaleY, scaleZ }`
 * into a single static `THREE.Mesh` draw call while preserving per-vertex AO, color, emit, UV bevels, and jitter.
 */
export function mergeVoxelMeshInstances(entries, options = {}) {
  const { depthLayer = 0, castShadow = true, receiveShadow = true } = options;
  if (!entries || entries.length === 0) return null;

  let totalVerts = 0;
  let totalIndices = 0;
  for (let i = 0; i < entries.length; i++) {
    const geo = entries[i].mesh?.geometry;
    if (!geo) continue;
    const p = geo.attributes.position;
    const idx = geo.index;
    if (!p || !idx) continue;
    totalVerts += p.count;
    totalIndices += idx.count;
  }
  if (totalVerts === 0 || totalIndices === 0) return null;

  const posOut = new Float32Array(totalVerts * 3);
  const normOut = new Float32Array(totalVerts * 3);
  const colOut = new Float32Array(totalVerts * 3);
  const uvOut = new Float32Array(totalVerts * 2);
  const emitOut = new Float32Array(totalVerts);
  const jSeedOut = new Float32Array(totalVerts);
  const idxOut =
    totalVerts <= 65535 ? new Uint16Array(totalIndices) : new Uint32Array(totalIndices);

  let vCursor = 0;
  let iCursor = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const geo = entry.mesh?.geometry;
    if (!geo) continue;
    const pArr = geo.attributes.position.array;
    const nArr = geo.attributes.normal.array;
    const cArr = geo.attributes.color.array;
    const uArr = geo.attributes.uv.array;
    const eArr = geo.attributes.aEmit?.array;
    const jArr = geo.attributes.aJitterSeed?.array;
    const idxArr = geo.index.array;
    const vCount = geo.attributes.position.count;

    const tx = entry.x || 0;
    const ty = entry.y || 0;
    const tz = entry.z || 0;
    const rotY = entry.rotY || 0;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const sx = entry.scaleX ?? entry.scale ?? 1;
    const sy = entry.scaleY ?? entry.scale ?? 1;
    const sz = entry.scaleZ ?? entry.scale ?? 1;

    for (let v = 0; v < vCount; v++) {
      const i3 = v * 3;
      const o3 = (vCursor + v) * 3;
      const lx = pArr[i3] * sx;
      const ly = pArr[i3 + 1] * sy;
      const lz = pArr[i3 + 2] * sz;
      posOut[o3] = lx * cosY + lz * sinY + tx;
      posOut[o3 + 1] = ly + ty;
      posOut[o3 + 2] = -lx * sinY + lz * cosY + tz;

      const nx = nArr[i3];
      const ny = nArr[i3 + 1];
      const nz = nArr[i3 + 2];
      normOut[o3] = nx * cosY + nz * sinY;
      normOut[o3 + 1] = ny;
      normOut[o3 + 2] = -nx * sinY + nz * cosY;

      colOut[o3] = cArr[i3];
      colOut[o3 + 1] = cArr[i3 + 1];
      colOut[o3 + 2] = cArr[i3 + 2];

      const i2 = v * 2;
      const o2 = (vCursor + v) * 2;
      uvOut[o2] = uArr[i2];
      uvOut[o2 + 1] = uArr[i2 + 1];

      emitOut[vCursor + v] = eArr ? eArr[v] : 0;
      jSeedOut[vCursor + v] = jArr ? jArr[v] : -1;
    }

    for (let k = 0; k < idxArr.length; k++) {
      idxOut[iCursor + k] = idxArr[k] + vCursor;
    }

    vCursor += vCount;
    iCursor += idxArr.length;
  }

  const mergedGeo = new THREE.BufferGeometry();
  mergedGeo.setAttribute("position", new THREE.BufferAttribute(posOut, 3));
  mergedGeo.setAttribute("normal", new THREE.BufferAttribute(normOut, 3));
  mergedGeo.setAttribute("color", new THREE.BufferAttribute(colOut, 3));
  mergedGeo.setAttribute("uv", new THREE.BufferAttribute(uvOut, 2));
  mergedGeo.setAttribute("aEmit", new THREE.BufferAttribute(emitOut, 1));
  mergedGeo.setAttribute("aJitterSeed", new THREE.BufferAttribute(jSeedOut, 1));
  mergedGeo.setIndex(new THREE.BufferAttribute(idxOut, 1));
  mergedGeo.computeBoundingSphere();

  const mergedMesh = new THREE.Mesh(mergedGeo, getVoxelMaterialForLayer(depthLayer));
  mergedMesh.castShadow = castShadow;
  mergedMesh.receiveShadow = receiveShadow;
  mergedMesh.matrixAutoUpdate = false;
  mergedMesh.updateMatrix();
  return mergedMesh;
}

/**
 * Compile a VoxelBlueprint into a scaled, articulated THREE.Group ready for world simulation or modal turntable.
 */
export function buildCreationGroup(blueprint, options = {}) {
  const { seed = 11, ghost = false, useWorldScale = true, cullFloorY = null } = options;
  const group = new THREE.Group();
  const animators = [];
  const partPivots = {};
  const pal = blueprint?.palette || {};

  const scaleFactor = useWorldScale ? (SCALE_FACTORS[blueprint?.scaleClass] || SCALE_FACTORS.medium) : 1.0;
  const voxScale = VOXEL_UNIT * scaleFactor;

  const baseVox = new Vox(seed);
  applyOps(baseVox, blueprint?.ops || [], pal);
  const baseBounds = baseVox.bounds();
  if (baseVox.size > 0) {
    const baseMesh = buildVoxelMesh(baseVox, { scale: voxScale, ghost, cullFloorY });
    baseMesh.userData.depthLayer = 0;
    group.add(baseMesh);
  }

  // Record compact [-3..3] x [-3..3] column occupancy so `baseVox` (hundreds of MB across 115+ builds) can be freed immediately!
  const centerColKeys = new Set();
  if (baseVox.size > 0) {
    const maxCheckY = Math.min(64, baseBounds.maxY + 1);
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        for (let y = 0; y <= maxCheckY; y++) {
          const k = packVoxKey(x, y, z);
          if (baseVox.v.has(k)) centerColKeys.add(k);
        }
      }
    }
  }

  let maxTopY = baseBounds.maxY * voxScale;

  for (let i = 0; i < (blueprint?.parts || []).length; i++) {
    const part = blueprint.parts[i];
    const pv = new Vox(seed + 17 + i * 7);
    applyOps(pv, part.ops || [], pal);
    if (!pv.size) continue;

    const pivot = new THREE.Group();
    const partName = part.name || `part-${i}`;
    pivot.name = partName;
    const [px, py, pz] = part.pivot || [0, 0, 0];
    pivot.position.set(px * voxScale, py * voxScale, pz * voxScale);
    const depthLayer = (i % 6) + 1;
    const pMesh = buildVoxelMesh(pv, {
      scale: voxScale,
      ghost,
      castShadow: pv.size > 14,
      depthLayer,
    });
    pMesh.userData.depthLayer = depthLayer;
    // Microscopic scale inset + per-part polygonOffset prevents coplanar depth shimmer on grazing joints
    pMesh.scale.setScalar(0.9985);
    pivot.add(pMesh);
    group.add(pivot);

    partPivots[partName] = {
      pivot,
      px,
      py,
      pz,
      baseX: px * voxScale,
      baseY: py * voxScale,
      baseZ: pz * voxScale,
      voxScale,
      part,
    };

    maxTopY = Math.max(maxTopY, (py + pv.bounds().maxY) * voxScale);

    const speed = Number(part.speed) || 1.2;
    const amp = Number(part.amp) || 0.38;
    const phase = Number(part.phase) || 0;
    const kind = part.kind || "bob";

    animators.push((t, motion = null) => {
      const moveFactor = motion?.moveFactor ?? 1.0;
      if (kind === "wheel") {
        // In the world, roll wheels strictly by distance traveled along the ground!
        const angle = motion && typeof motion.wheelAngle === "number" ? motion.wheelAngle * speed : t * 2.4 * speed;
        pivot.rotation.x = angle;
      } else if (kind === "spinY") {
        pivot.rotation.y = t * speed + phase;
      } else if (kind === "spinZ") {
        pivot.rotation.z = t * speed + phase;
      } else if (kind === "spinX") {
        pivot.rotation.x = t * speed + phase;
      } else if (kind === "bob") {
        pivot.position.y = py * voxScale + Math.sin(t * speed * 2.2 + phase) * amp * voxScale * 2.5;
      } else if (kind === "swingX") {
        const effAmp = amp * (0.18 + 0.82 * moveFactor);
        pivot.rotation.x = Math.sin(t * speed * 2.6 + phase) * effAmp;
      } else if (kind === "swingY") {
        pivot.rotation.y = Math.sin(t * speed * 2.4 + phase) * amp;
      } else if (kind === "swingZ") {
        pivot.rotation.z = Math.sin(t * speed * 2.2 + phase) * amp;
      }
    });
  }

  group.userData.topY = Math.max(1.0, maxTopY);
  group.userData.voxScale = voxScale;
  group.userData.hasCenterVox =
    centerColKeys.size > 0
      ? (x, y, z) => centerColKeys.has(packVoxKey(x | 0, y | 0, z | 0))
      : null;
  group.userData.baseBounds = baseBounds;
  group.userData.partPivots = partPivots;
  group.userData.animatorCount = animators.length;
  group.userData.animate =
    animators.length > 0
      ? (t, motion = null) => {
          for (const fn of animators) fn(t, motion);
        }
      : null;
  group.userData.dispose = () => {
    group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
  };
  return group;
}

/**
 * Splits a dual-vehicle blueprint (where two side-by-side vehicles were sculpted across X=0.5,
 * such as the Waratah Train + Melbourne Tram) into two centered, independently animated THREE.Groups.
 */
export function buildSplitDualVehicleGroups(blueprint, options = {}) {
  const { seed = 11, ghost = false, useWorldScale = true, splitX = 0.5 } = options;
  const pal = blueprint?.palette || {};
  const scaleFactor = useWorldScale ? (SCALE_FACTORS[blueprint?.scaleClass] || SCALE_FACTORS.medium) : 1.0;
  const voxScale = VOXEL_UNIT * scaleFactor;

  const fullVox = new Vox(seed);
  applyOps(fullVox, blueprint?.ops || [], pal);

  const buildSideGroup = (isRightSide, seedOffset) => {
    const sideVox = new Vox(seed + seedOffset);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const [k, styleId] of fullVox.v.entries()) {
      const cx = ((k >> 20) & KEY_MASK) - KEY_BIAS;
      const belongs = isRightSide ? cx >= splitX : cx < splitX;
      if (!belongs) continue;
      sideVox.v.set(k, styleId);
      if (cx < minX) minX = cx;
      if (cx + 1 > maxX) maxX = cx + 1;
    }
    if (!sideVox.size) return null;

    const sideParts = (blueprint?.parts || []).filter((p) => {
      const px = p.pivot?.[0] ?? 0;
      return isRightSide ? px >= splitX : px < splitX;
    });
    const centerX = sideParts.length
      ? sideParts.reduce((acc, p) => acc + (p.pivot?.[0] ?? 0), 0) / sideParts.length
      : (minX + maxX) * 0.5;

    const outer = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.x = -centerX * voxScale;
    outer.add(inner);

    const animators = [];
    const baseMesh = buildVoxelMesh(sideVox, { scale: voxScale, ghost });
    inner.add(baseMesh);

    let maxTopY = sideVox.bounds().maxY * voxScale;
    for (let i = 0; i < sideParts.length; i++) {
      const part = sideParts[i];
      const pv = new Vox(seed + seedOffset + 19 + i * 7);
      applyOps(pv, part.ops || [], pal);
      if (!pv.size) continue;

      const pivot = new THREE.Group();
      const [px, py, pz] = part.pivot || [0, 0, 0];
      pivot.position.set(px * voxScale, py * voxScale, pz * voxScale);
      const pMesh = buildVoxelMesh(pv, {
        scale: voxScale,
        ghost,
        castShadow: pv.size > 14,
        depthLayer: (i % 6) + 1,
      });
      pMesh.scale.setScalar(0.9985);
      pivot.add(pMesh);
      inner.add(pivot);
      maxTopY = Math.max(maxTopY, (py + pv.bounds().maxY) * voxScale);

      const speed = Number(part.speed) || 1.2;
      const kind = part.kind || "wheel";
      animators.push((t, motion = null) => {
        if (kind === "wheel") {
          const angle =
            motion && typeof motion.wheelAngle === "number" ? motion.wheelAngle * speed : t * 2.4 * speed;
          pivot.rotation.x = angle;
        }
      });
    }

    outer.userData.topY = Math.max(1.0, maxTopY);
    outer.userData.voxScale = voxScale;
    outer.userData.animatorCount = animators.length;
    outer.userData.animate =
      animators.length > 0
        ? (t, motion = null) => {
            for (const fn of animators) fn(t, motion);
          }
        : null;
    outer.userData.dispose = () => {
      outer.traverse((obj) => {
        if (obj.isMesh && obj.geometry) obj.geometry.dispose();
      });
    };
    return outer;
  };

  const leftGroup = buildSideGroup(false, 0);
  const rightGroup = buildSideGroup(true, 101);
  if (!leftGroup || !rightGroup) return null;
  return { leftGroup, rightGroup };
}

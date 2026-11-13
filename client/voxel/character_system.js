// Articulated Voxel Player Avatar Rig, Appearance Schema/Storage, and Multiplayer Remote Avatar Manager.

import * as THREE from "three";
import { Vox, buildVoxelMesh } from "./vox.js";

export const AVATAR_STORAGE_KEY = "geminisland_avatar_v1";

export const AVATAR_OPTIONS = Object.freeze({
  skinColors: Object.freeze([
    "#fae0cb", // porcelain peach
    "#f4cba6", // warm fair
    "#eab586", // golden honey
    "#d99866", // warm tan
    "#c27d4c", // amber bronze
    "#9e5e36", // rich chestnut
    "#764226", // deep espresso
    "#522c1a", // warm cacao
    "#c5d3de", // robot chrome
    "#8fe0be", // voxel mint
  ]),
  hairStyles: Object.freeze([
    "short",
    "spiky",
    "parted",
    "long",
    "ponytail",
    "buns",
    "curly",
    "mohawk",
    "bob",
    "none",
  ]),
  hairColors: Object.freeze([
    "#242024", // jet black
    "#4a3121", // dark espresso
    "#7a4b2a", // warm chestnut
    "#c9823b", // ginger copper
    "#e8c468", // golden blonde
    "#b8432e", // auburn
    "#d8dce3", // silver frost
    "#4c82d4", // cobalt blue
    "#d95ca3", // berry pink
    "#47b0a3", // seafoam teal
  ]),
  hatStyles: Object.freeze([
    "none",
    "cap",
    "beanie",
    "sunhat",
    "wizard",
    "crown",
    "cowboy",
    "headphones",
    "hard_hat",
    "sprout",
    "party",
    "beret",
  ]),
  hatColors: Object.freeze([
    "#df5246",
    "#f5b82e",
    "#4c82d4",
    "#47b0a3",
    "#58ad52",
    "#7a56b8",
    "#2d323b",
    "#f2eadb",
    "#d9773b",
    "#ec8db0",
  ]),
  eyeStyles: Object.freeze([
    "classic",
    "happy",
    "wink",
    "shades",
    "glasses",
    "visor",
    "starry",
  ]),
  accessories: Object.freeze([
    "none",
    "backpack",
    "cape",
    "wings",
    "scarf",
    "bowtie",
    "guitar",
    "jetpack",
  ]),
  accessoryColors: Object.freeze([
    "#d9773b",
    "#df5246",
    "#4c82d4",
    "#f4c44e",
    "#58ad52",
    "#7a56b8",
    "#2d323b",
    "#fcfaf5",
    "#47b0a3",
    "#c86d49",
  ]),
  topStyles: Object.freeze([
    "tee",
    "hoodie",
    "jacket",
    "overalls",
    "striped",
    "suit",
    "tunic",
  ]),
  topColors: Object.freeze([
    "#4c82d4",
    "#df5246",
    "#58ad52",
    "#f5b82e",
    "#47b0a3",
    "#7a56b8",
    "#ec8438",
    "#ec8db0",
    "#2d323b",
    "#fcfaf5",
    "#2f5696",
    "#be3438",
  ]),
  bottomStyles: Object.freeze([
    "jeans",
    "shorts",
    "cuffed",
    "skirt",
    "cargo",
  ]),
  bottomColors: Object.freeze([
    "#364d73",
    "#2b303a",
    "#6e553e",
    "#cbb894",
    "#3d6b5e",
    "#5b527a",
    "#8a94a0",
    "#a8443a",
  ]),
  shoeColors: Object.freeze([
    "#262930",
    "#fcfaf5",
    "#8f5e36",
    "#df5246",
    "#4c82d4",
    "#f5b82e",
    "#47b0a3",
    "#65469c",
  ]),
});

export const AVATAR_LABELS = Object.freeze({
  none: "None",
  short: "Short",
  spiky: "Spiky",
  parted: "Parted",
  long: "Long",
  ponytail: "Ponytail",
  buns: "Buns",
  curly: "Curly",
  mohawk: "Mohawk",
  bob: "Bob",
  cap: "Cap",
  beanie: "Beanie",
  sunhat: "Sunhat",
  wizard: "Wizard",
  crown: "Crown",
  cowboy: "Cowboy",
  headphones: "Headphones",
  hard_hat: "Hard Hat",
  sprout: "Sprout",
  party: "Party",
  beret: "Beret",
  classic: "Classic",
  happy: "Happy",
  wink: "Wink",
  shades: "Shades",
  glasses: "Glasses",
  visor: "Visor",
  starry: "Starry",
  backpack: "Backpack",
  cape: "Cape",
  wings: "Wings",
  scarf: "Scarf",
  bowtie: "Bowtie",
  guitar: "Guitar",
  jetpack: "Jetpack",
  tee: "Tee",
  hoodie: "Hoodie",
  jacket: "Jacket",
  overalls: "Overalls",
  striped: "Striped",
  suit: "Suit",
  tunic: "Tunic",
  jeans: "Jeans",
  shorts: "Shorts",
  cuffed: "Cuffed",
  skirt: "Skirt",
  cargo: "Cargo",
});

function sanitizeName(val) {
  if (typeof val !== "string") return "";
  return val.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
}

function sanitizeHex(val, fallbackList, fallbackIndex = 0) {
  if (typeof val === "string") {
    const clean = val.replace(/[\u0000-\u001f\u007f]/g, "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(clean)) return clean;
    if (/^#[0-9a-f]{3}$/.test(clean)) {
      return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
    }
  }
  return fallbackList[fallbackIndex % fallbackList.length];
}

function sanitizeEnum(val, allowed, fallbackIndex = 0) {
  if (typeof val === "string" && allowed.includes(val)) return val;
  return allowed[fallbackIndex % allowed.length];
}

export function sanitizeAppearance(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    name: sanitizeName(src.name),
    skin: sanitizeHex(src.skin, AVATAR_OPTIONS.skinColors, 2),
    hairStyle: sanitizeEnum(src.hairStyle, AVATAR_OPTIONS.hairStyles, 0),
    hairColor: sanitizeHex(src.hairColor, AVATAR_OPTIONS.hairColors, 1),
    hatStyle: sanitizeEnum(src.hatStyle, AVATAR_OPTIONS.hatStyles, 0),
    hatColor: sanitizeHex(src.hatColor, AVATAR_OPTIONS.hatColors, 0),
    eyeStyle: sanitizeEnum(src.eyeStyle, AVATAR_OPTIONS.eyeStyles, 0),
    accessory: sanitizeEnum(src.accessory, AVATAR_OPTIONS.accessories, 0),
    accessoryColor: sanitizeHex(src.accessoryColor, AVATAR_OPTIONS.accessoryColors, 0),
    topStyle: sanitizeEnum(src.topStyle, AVATAR_OPTIONS.topStyles, 1),
    topColor: sanitizeHex(src.topColor, AVATAR_OPTIONS.topColors, 0),
    bottomStyle: sanitizeEnum(src.bottomStyle, AVATAR_OPTIONS.bottomStyles, 0),
    bottomColor: sanitizeHex(src.bottomColor, AVATAR_OPTIONS.bottomColors, 0),
    shoeColor: sanitizeHex(src.shoeColor, AVATAR_OPTIONS.shoeColors, 0),
  };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomizeAppearance(keepName = true, currentName = "") {
  const naturalSkins = AVATAR_OPTIONS.skinColors.slice(0, 8);
  const playfulSkins = AVATAR_OPTIONS.skinColors.slice(8);
  const skin = Math.random() < 0.88 ? pickRandom(naturalSkins) : pickRandom(playfulSkins);

  const styledHairs = AVATAR_OPTIONS.hairStyles.filter((h) => h !== "none");
  const hairStyle = Math.random() < 0.93 ? pickRandom(styledHairs) : "none";
  const hairColor = pickRandom(AVATAR_OPTIONS.hairColors);

  const nonNoneHats = AVATAR_OPTIONS.hatStyles.filter((h) => h !== "none");
  const hatStyle = Math.random() < 0.34 ? "none" : pickRandom(nonNoneHats);
  const hatColor = pickRandom(AVATAR_OPTIONS.hatColors);

  const eyeStyle =
    Math.random() < 0.38
      ? pickRandom(["classic", "happy"])
      : pickRandom(AVATAR_OPTIONS.eyeStyles);

  const nonNoneAcc = AVATAR_OPTIONS.accessories.filter((a) => a !== "none");
  const accessory = Math.random() < 0.3 ? "none" : pickRandom(nonNoneAcc);
  const accessoryColor = pickRandom(AVATAR_OPTIONS.accessoryColors);

  const topStyle = pickRandom(AVATAR_OPTIONS.topStyles);
  const topColor = pickRandom(AVATAR_OPTIONS.topColors);
  const bottomStyle = pickRandom(AVATAR_OPTIONS.bottomStyles);

  let bottomColor = pickRandom(AVATAR_OPTIONS.bottomColors);
  if (bottomColor === topColor && topStyle !== "suit") {
    bottomColor = AVATAR_OPTIONS.bottomColors[0] === topColor
      ? AVATAR_OPTIONS.bottomColors[1]
      : AVATAR_OPTIONS.bottomColors[0];
  }
  const shoeColor = pickRandom(AVATAR_OPTIONS.shoeColors);

  return sanitizeAppearance({
    name: keepName ? sanitizeName(currentName) : "",
    skin,
    hairStyle,
    hairColor,
    hatStyle,
    hatColor,
    eyeStyle,
    accessory,
    accessoryColor,
    topStyle,
    topColor,
    bottomStyle,
    bottomColor,
    shoeColor,
  });
}

export function appearanceSignature(appearance) {
  const a = sanitizeAppearance(appearance);
  return [
    a.skin,
    a.hairStyle,
    a.hairColor,
    a.hatStyle,
    a.hatColor,
    a.eyeStyle,
    a.accessory,
    a.accessoryColor,
    a.topStyle,
    a.topColor,
    a.bottomStyle,
    a.bottomColor,
    a.shoeColor,
  ].join("|");
}

export function saveAppearance(appearance) {
  const clean = sanitizeAppearance(appearance);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(clean));
    }
  } catch {
    // Ignore storage quota or private mode failures
  }
  return clean;
}

export function loadSavedAppearance() {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
      if (raw) {
        return sanitizeAppearance(JSON.parse(raw));
      }
    }
  } catch {
    // Fall through to fresh randomized profile
  }
  const fresh = randomizeAppearance(false, "");
  saveAppearance(fresh);
  return fresh;
}

// ---------------- Hex Color Helpers ----------------

function hexToRgb(hex) {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [220, 210, 200];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    "#" +
    ((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b))
      .toString(16)
      .slice(1)
  );
}

function shadeHex(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

function mixHex(hexA, hexB, t) {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

const FULL_COVER_HATS = new Set([
  "cap",
  "beanie",
  "sunhat",
  "wizard",
  "cowboy",
  "hard_hat",
  "beret",
]);

const TOP_CROWN_HATS = new Set(["crown", "party"]);

// ---------------- Micro-Voxel Sculpting ----------------

function sculptTorsoVox(a) {
  const v = new Vox(311);
  const top = a.topColor;
  const topDark = shadeHex(top, 0.82);
  const topLight = shadeHex(top, 1.14);
  const acc = a.accessoryColor;
  const accDark = shadeHex(acc, 0.8);
  const accLight = shadeHex(acc, 1.16);
  const skinNeck = shadeHex(a.skin, 0.92);
  const bottom = a.bottomColor;

  // Base torso block: x[-4..4], y[0..10], z[-2..3] (chest faces +Z)
  v.box(-4, 0, -2, 4, 10, 3, top);
  // Subtle side/hem shading
  v.box(-4, 0, -2, 4, 1, 3, topDark);

  // Top-specific tailoring (front chest details kept flush at z <= 3 for clean FP downward sightlines)
  if (a.topStyle === "tee") {
    // Crew-neck collar + skin collarbone peek
    v.box(-2, 9, 1, 2, 10, 3, shadeHex(top, 0.88));
    v.box(-1, 9, 2, 1, 10, 3, skinNeck);
  } else if (a.topStyle === "hoodie") {
    // Kangaroo front pocket + drawstrings (flush z <= 3) + cozy rolled back hood (y <= 10)
    v.box(-3, 1, 2, 3, 4, 3, topDark);
    v.put(-3, 3, 2, top);
    v.put(2, 3, 2, top);
    v.box(-2, 6, 2, -1, 9, 3, "#fcfaf5");
    v.box(1, 6, 2, 2, 9, 3, "#fcfaf5");
    v.box(-3, 8, -4, 3, 10, -1, topDark);
    v.box(-2, 9, -3, 2, 10, -1, topLight);
  } else if (a.topStyle === "jacket") {
    // Inner cream tee + zip placket + lapels (flush z <= 3)
    v.box(-2, 1, 2, 2, 10, 3, "#f7f3e8");
    v.box(-4, 0, 2, -1, 10, 3, top);
    v.box(1, 0, 2, 4, 10, 3, top);
    v.box(-2, 6, 2, -1, 10, 3, topDark);
    v.box(1, 6, 2, 2, 10, 3, topDark);
    v.box(0, 1, 2, 1, 9, 3, "#b4c0cc");
  } else if (a.topStyle === "overalls") {
    // Undershirt uses topColor; overalls bib/straps/waist match bottomColor seamlessly into legs!
    const shirtUnder =
      top.toLowerCase() === bottom.toLowerCase() ? "#fcfaf5" : top;
    const bibDark = shadeHex(bottom, 0.82);
    v.box(-4, 4, -2, 4, 10, 3, shirtUnder);
    v.box(-4, 0, -2, 4, 4, 3, bottom);
    // Front bib + pocket + straps + brass buttons (flush z <= 3)
    v.box(-3, 4, 2, 3, 8, 3, bottom);
    v.box(-2, 4, 2, 2, 6, 3, bibDark);
    v.box(-3, 7, -2, -2, 10, 3, bottom);
    v.box(2, 7, -2, 3, 10, 3, bottom);
    v.box(-3, 4, -3, -2, 10, -2, bottom);
    v.box(2, 4, -3, 3, 10, -2, bottom);
    v.put(-3, 7, 2, "#f4c44e");
    v.put(2, 7, 2, "#f4c44e");
  } else if (a.topStyle === "striped") {
    const stripeAlt = top === "#fcfaf5" ? "#2f5696" : "#fcfaf5";
    for (let y = 1; y < 9; y += 2) {
      v.box(-4, y, -2, 4, y + 1, 3, stripeAlt);
    }
    v.box(-2, 9, 1, 2, 10, 3, topDark);
  } else if (a.topStyle === "suit") {
    // Crisp white dress shirt V-front + necktie + blazer lapels + pocket square (flush z <= 3)
    v.box(-2, 3, 2, 2, 10, 3, "#fcfaf5");
    const tieCol = a.accessory === "bowtie" ? acc : "#be3438";
    v.box(-1, 3, 2, 1, 9, 3, tieCol);
    v.box(-4, 0, 2, -2, 10, 3, top);
    v.box(2, 0, 2, 4, 10, 3, top);
    v.box(-2, 0, 2, 2, 3, 3, top);
    v.box(-3, 5, 2, -2, 10, 3, topDark);
    v.box(2, 5, 2, 3, 10, 3, topDark);
    v.put(2, 7, 2, "#fcfaf5");
  } else if (a.topStyle === "tunic") {
    // Belted adventurer tunic + gold buckle + V-collar trim (flush z <= 3)
    v.box(-2, 8, 2, 2, 10, 3, topLight);
    v.box(-1, 7, 2, 1, 10, 3, skinNeck);
    v.box(-4, 2, -3, 4, 4, 3, "#5c3b22");
    v.box(-1, 2, 2, 1, 4, 3, "#f4c44e");
  }

  // Pleated skirt waist flare so skirt looks seamless across hip joint
  if (a.bottomStyle === "skirt") {
    v.box(-4, -1, -2, 4, 1, 3, bottom);
  }

  // Accessories (front chest harness/straps/ties kept flush at z <= 3)
  if (a.accessory === "backpack") {
    v.box(-3, 2, -6, 3, 9, -2, acc);
    v.box(-3, 6, -6, 3, 9, -2, accLight);
    v.box(-2, 2, -7, 2, 5, -6, accDark);
    v.put(0, 6, -6, "#f4c44e");
    // Shoulder straps
    v.box(-4, 4, 2, -3, 10, 3, accDark);
    v.box(3, 4, 2, 4, 10, 3, accDark);
    v.box(-4, 9, -3, -3, 10, 3, accDark);
    v.box(3, 9, -3, 4, 10, 3, accDark);
  } else if (a.accessory === "cape") {
    v.box(-4, 9, -3, 4, 10, 3, accDark);
    v.box(-4, 3, -4, 4, 9, -2, acc);
    v.box(-5, -4, -4, 5, 3, -2, acc);
    v.box(-5, -4, -4, 5, -3, -2, accLight);
  } else if (a.accessory === "wings") {
    const featherInner = "#fcfaf5";
    // Right wing (-X) & Left wing (+X)
    for (const dir of [-1, 1]) {
      const bx = (x0, x1) => (dir === 1 ? [x0, x1] : [-x1, -x0]);
      {
        const [x0, x1] = bx(2, 5);
        v.box(x0, 4, -4, x1, 9, -2, featherInner);
      }
      {
        const [x0, x1] = bx(5, 8);
        v.box(x0, 5, -4, x1, 10, -3, acc);
        v.box(x0, 3, -4, x1 - dir, 5, -3, featherInner);
      }
      {
        const [x0, x1] = bx(8, 10);
        v.box(x0, 6, -4, x1, 11, -3, accLight);
      }
    }
  } else if (a.accessory === "scarf") {
    v.box(-4, 8, -3, 4, 10, 3, acc);
    v.box(-4, 9, -3, 4, 10, 3, accLight);
    // Hanging knit tail on front left chest (flush z <= 3)
    v.box(1, 3, 2, 3, 9, 3, acc);
    v.box(1, 3, 2, 3, 4, 3, accLight);
  } else if (a.accessory === "bowtie") {
    v.box(-3, 8, 2, -1, 10, 3, acc);
    v.box(1, 8, 2, 3, 10, 3, acc);
    v.box(-1, 8, 2, 1, 9, 3, accDark);
  } else if (a.accessory === "guitar") {
    // Diagonal strap across chest (flush z <= 3)
    for (let i = 0; i < 7; i++) {
      v.box(-3 + i, 3 + i, 2, -2 + i, 4 + i, 3, "#4a3121");
    }
    // Guitar body on back + angled neck
    v.roundedBox(-4, 1, -5, 2, 7, -2, 1.2, acc);
    v.box(-2, 3, -5, 0, 5, -4, "#1e2026");
    v.box(-1, 6, -4, 1, 9, -3, "#c9935b");
    v.box(0, 8, -4, 3, 11, -3, "#8f5e36");
    v.box(1, 10, -4, 3, 12, -3, accDark);
  } else if (a.accessory === "jetpack") {
    // Twin cylinders + center core + glowing thruster nozzles
    v.box(-4, 3, -6, -1, 9, -2, acc);
    v.box(1, 3, -6, 4, 9, -2, acc);
    v.box(-1, 4, -5, 1, 8, -2, "#b4c0cc");
    v.box(-4, 7, -6, -1, 8, -2, "#d8e2eb");
    v.box(1, 7, -6, 4, 8, -2, "#d8e2eb");
    v.box(-3, 2, -5, -2, 3, -3, "#3b4048");
    v.box(2, 2, -5, 3, 3, -3, "#3b4048");
    v.box(-3, 1, -5, -2, 2, -3, "#ff7426", 1.25);
    v.box(2, 1, -5, 3, 2, -3, "#ff7426", 1.25);
    // Harness straps (flush z <= 3)
    v.box(-4, 4, 2, -3, 10, 3, "#3b4048");
    v.box(3, 4, 2, 4, 10, 3, "#3b4048");
  }

  return v;
}

function sculptHeadVox(a) {
  const v = new Vox(419);
  const skin = a.skin;
  const [sr, sg, sb] = hexToRgb(skin);
  const skinLum = (0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 255;
  const skinWarm = mixHex(skin, "#e86e62", skinLum < 0.36 ? 0.28 : 0.22);
  const hair = a.hairColor;
  const hairLight = shadeHex(hair, 1.14);
  const hairDark = shadeHex(hair, 0.82);
  const hat = a.hatColor;
  const hatDark = shadeHex(hat, 0.8);
  const hatLight = shadeHex(hat, 1.16);

  // 1. Neck post inside headPivot (y = -1..0) so hiding headPivot in FP hides neck cleanly with zero stump
  v.box(-2, -1, -2, 2, 0, 1, shadeHex(skin, 0.92));

  // Base 8x8x8 head skull: x[-4..4), y[0..8), z[-4..4) (faces +Z)
  v.box(-4, 0, -4, 4, 8, 4, skin);
  // Subtle voxel ears
  v.box(-5, 2, -1, -4, 5, 1, skinWarm);
  v.box(4, 2, -1, 5, 5, 1, skinWarm);

  // 2. Hair sculpting (runs BEFORE facial features and keeps front face x[-3..3), y[0..7) completely open!)
  const fullCover = FULL_COVER_HATS.has(a.hatStyle);
  const topCrownHat = TOP_CROWN_HATS.has(a.hatStyle);
  const hasHeadphones = a.hatStyle === "headphones";

  if (a.hairStyle !== "none") {
    const capTopY = fullCover ? 7 : 9;

    if (a.hairStyle === "mohawk") {
      // Shaved sides, bold central crest — never touches facial plane!
      v.box(-1, 3, -5, 1, 8, -4, hair);
      v.box(-1, 7, -4, 1, capTopY, 4, hair);
      if (!fullCover) {
        v.box(-1, 7, 3, 1, 9, 5, hairLight);
      }
      if (!fullCover && !topCrownHat && !hasHeadphones) {
        v.box(-1, 8, -4, 1, 12, 4, hair);
        v.box(-1, 11, -3, 1, 13, 3, hairLight);
      }
    } else {
      // Base hairline shell around back, crown & sides (front hairline sits at y >= 7)
      v.box(-4, 6, -5, 4, capTopY, 2, hair);
      v.box(-4, 7, 2, 4, capTopY, 4, hair);
      v.box(-5, 4, -4, -4, capTopY - 1, 2, hair);
      v.box(4, 4, -4, 5, capTopY - 1, 2, hair);
      v.box(-4, 2, -5, 4, 6, -4, hairDark);

      if (a.hairStyle === "short") {
        if (!fullCover) {
          v.box(-4, 8, -4, 4, 9, 4, hairLight);
          v.box(-3, 7, 3, 3, 8, 5, hair);
        }
      } else if (a.hairStyle === "spiky") {
        if (!fullCover) {
          v.box(-4, 7, 3, 4, 8, 5, hair);
          v.put(-3, 7, 5, hairLight);
          v.put(1, 7, 5, hairLight);
        }
        if (!fullCover && !topCrownHat) {
          v.box(-3, 8, -3, 3, 10, 3, hair);
          v.box(-3, 10, 1, -1, 11, 3, hairLight);
          v.box(1, 10, -1, 3, 11, 2, hairLight);
          v.box(-1, 10, -3, 1, 11, -1, hairLight);
        }
      } else if (a.hairStyle === "parted") {
        if (!fullCover) {
          v.box(-4, 7, 3, 1, 9, 5, hairLight);
          v.box(2, 7, 3, 4, 8, 5, hair);
          v.box(-4, 8, -4, 2, 10, 4, hairLight);
          v.box(2, 8, -4, 4, 9, 4, hair);
        }
      } else if (a.hairStyle === "long") {
        // Flowing back & side-framing locks (kept outside x[-3..3) so eyes & mouth stay 100% unobstructed)
        v.box(-4, -3, -5, 4, 6, -4, hair);
        v.box(-5, -2, -4, -4, 6, 3, hair);
        v.box(4, -2, -4, 5, 6, 3, hair);
        v.box(-5, -1, 1, -4, 6, 3, hairLight);
        v.box(4, -1, 1, 5, 6, 3, hairLight);
        if (!fullCover) {
          v.box(-4, 7, 3, 4, 8, 5, hair);
          v.box(-4, 8, -4, 4, 10, 4, hairLight);
        }
      } else if (a.hairStyle === "ponytail") {
        if (fullCover) {
          v.box(-1, 3, -6, 1, 5, -4, hat);
          v.box(-2, -1, -7, 2, 4, -5, hair);
          v.box(-1, -2, -7, 1, 0, -5, hairLight);
        } else {
          v.box(-3, 7, 3, 3, 8, 5, hair);
          v.box(-4, 8, -4, 4, 9, 4, hairLight);
          v.box(-1, 6, -6, 1, 8, -4, hat);
          v.box(-2, 1, -7, 2, 8, -5, hair);
          v.box(-1, 0, -7, 1, 2, -5, hairLight);
        }
      } else if (a.hairStyle === "buns") {
        if (fullCover || hasHeadphones) {
          v.box(-6, 1, -4, -4, 4, -1, hairLight);
          v.box(4, 1, -4, 6, 4, -1, hairLight);
        } else {
          v.box(-3, 7, 3, 3, 8, 5, hair);
          v.box(-4, 8, -4, 4, 9, 4, hair);
          v.box(-6, 7, -2, -3, 11, 1, hairLight);
          v.box(3, 7, -2, 6, 11, 1, hairLight);
        }
      } else if (a.hairStyle === "curly") {
        v.box(-5, 3, -5, 5, 7, -3, hair);
        v.box(-5, 4, -3, -4, 7, 3, hairLight);
        v.box(4, 4, -3, 5, 7, 3, hairLight);
        if (!fullCover) {
          v.box(-4, 7, 3, 4, 8, 5, hair);
          v.box(-5, 7, -5, 5, 10, 4, hair);
          v.box(-4, 10, -4, 4, 11, 3, hairLight);
        }
      } else if (a.hairStyle === "bob") {
        v.box(-5, 1, -4, -4, 7, 3, hair);
        v.box(4, 1, -4, 5, 7, 3, hair);
        v.box(-4, 1, -5, 4, 7, -4, hairDark);
        if (!fullCover) {
          v.box(-4, 7, 3, 4, 8, 5, hairLight);
          v.box(-4, 8, -4, 4, 10, 4, hairLight);
        }
      }
    }
  }

  // 3. Hats & Headgear (all sit cleanly at y >= 7 on the front so y[0..6] face stays clear)
  if (a.hatStyle === "cap") {
    v.box(-4, 7, -4, 4, 10, 4, hat);
    v.box(-3, 10, -3, 3, 11, 3, hatLight);
    v.box(-4, 7, 4, 4, 8, 7, hatDark);
    v.box(-1, 8, 4, 1, 9, 5, "#fcfaf5");
  } else if (a.hatStyle === "beanie") {
    v.box(-5, 7, -5, 5, 9, 5, hatDark);
    v.box(-4, 9, -4, 4, 11, 4, hat);
    v.box(-1, 11, -1, 1, 13, 1, "#fcfaf5");
  } else if (a.hatStyle === "sunhat") {
    v.cylinderAxis("y", 0, 0, 7, 8, 7.2, "#ead39c");
    v.cylinderAxis("y", 0, 0, 8, 10, 4.4, "#deb07c");
    v.cylinderAxis("y", 0, 0, 8, 9, 4.6, hat);
    v.cylinderAxis("y", 0, 0, 10, 11, 3.8, "#ead39c");
  } else if (a.hatStyle === "wizard") {
    v.cylinderAxis("y", 0, 0, 7, 8, 6.8, hatDark);
    v.cylinderAxis("y", 0, 0, 8, 9, 4.5, "#f4c44e");
    v.cone(0, 9, 16, 0, 4.2, 0.7, hat);
    v.box(-1, 15, -2, 1, 17, 0, hatLight);
  } else if (a.hatStyle === "crown") {
    const gold = "#f4c44e";
    const goldDark = "#c79428";
    v.box(-4, 8, -4, 4, 10, 4, gold);
    v.clear(-3, 9, -3, 3, 12, 3);
    for (const x of [-4, -1, 3]) {
      v.put(x, 10, 3, gold);
      v.put(x, 10, -4, gold);
    }
    for (const z of [-2, 1]) {
      v.put(-4, 10, z, gold);
      v.put(3, 10, z, gold);
    }
    v.box(-1, 8, 4, 1, 10, 5, hat);
    v.put(-3, 9, 4, goldDark);
    v.put(2, 9, 4, goldDark);
  } else if (a.hatStyle === "cowboy") {
    v.box(-7, 7, -6, 7, 8, 6, hat);
    v.box(-7, 8, -5, -6, 9, 5, hatLight);
    v.box(6, 8, -5, 7, 9, 5, hatLight);
    v.box(-4, 8, -4, 4, 9, 4, "#4a3121");
    v.box(-4, 9, -4, 4, 11, 4, hat);
    v.box(-4, 11, -3, -1, 12, 3, hatLight);
    v.box(1, 11, -3, 4, 12, 3, hatLight);
  } else if (a.hatStyle === "headphones") {
    v.box(-5, 8, -1, 5, 10, 1, "#2d323b");
    v.box(-6, 4, -1, -5, 9, 1, "#2d323b");
    v.box(5, 4, -1, 6, 9, 1, "#2d323b");
    v.box(-7, 1, -2, -5, 6, 2, hat);
    v.box(5, 1, -2, 7, 6, 2, hat);
    v.box(-7, 2, -1, -6, 5, 1, hatLight);
    v.box(6, 2, -1, 7, 5, 1, hatLight);
  } else if (a.hatStyle === "hard_hat") {
    v.box(-5, 7, -5, 5, 9, 5, hat);
    v.box(-4, 9, -4, 4, 11, 4, hatLight);
    v.box(-1, 9, -4, 1, 12, 5, hat);
    v.box(-4, 7, 5, 4, 8, 6, hatDark);
    v.box(-1, 8, 4, 1, 10, 6, "#ffe29a", 0.9);
  } else if (a.hatStyle === "sprout") {
    const baseY = a.hairStyle === "none" ? 8 : 9;
    v.box(0, baseY, 0, 1, baseY + 4, 1, "#3e853b");
    v.box(1, baseY + 3, 0, 4, baseY + 5, 1, "#78c86c");
    v.box(-3, baseY + 2, 0, 0, baseY + 4, 1, "#58ad52");
  } else if (a.hatStyle === "party") {
    v.cone(0, 8, 15, 0, 3.2, 0.6, hat);
    v.put(1, 10, 2, "#fcfaf5");
    v.put(-2, 11, 1, "#f6d55c");
    v.put(0, 12, -2, "#fcfaf5");
    v.box(-1, 15, -1, 1, 17, 1, "#f6d55c");
  } else if (a.hatStyle === "beret") {
    v.box(-4, 7, -4, 4, 8, 4, hatDark);
    v.box(-5, 8, -4, 4, 10, 4, hat);
    v.box(-4, 10, -3, 2, 11, 3, hatLight);
    v.put(-1, 11, 0, hatDark);
  }

  // 4. Crisp, High-Contrast Facial Features (ALWAYS sculpted last so nothing can overwrite eyes or mouth!)
  const darkEye = "#12141c";
  const whiteEye = "#ffffff";
  const mouthCol = skinLum < 0.34 ? "#100a0e" : "#26141a";
  const tongueCol = "#e25d5d";
  const browBase = a.hairStyle === "none" ? shadeHex(skin, 0.52) : shadeHex(hair, 0.76);
  const [br, bg, bb] = hexToRgb(browBase);
  const browLum = (0.2126 * br + 0.7152 * bg + 0.0722 * bb) / 255;
  const browCol =
    Math.abs(browLum - skinLum) < 0.14
      ? skinLum < 0.35
        ? "#14161e"
        : shadeHex(browBase, 0.62)
      : browBase;

  // Outer rosy cheek warmth (leaves mid-face row y = 3 crisp between eyes and mouth)
  v.put(-4, 3, 3, skinWarm);
  v.put(3, 3, 3, skinWarm);

  if (a.eyeStyle === "classic") {
    // Expressive eyebrows (y = 6)
    v.box(-3, 6, 3, -1, 7, 4, browCol);
    v.box(1, 6, 3, 3, 7, 4, browCol);
    // Bold 2x2 eyes with crisp white sclera + deep pupil (x[-3..-1] and x[1..3], y[4..6])
    v.box(-3, 4, 3, -2, 6, 4, whiteEye);
    v.box(-2, 4, 3, -1, 6, 4, darkEye);
    v.box(1, 4, 3, 2, 6, 4, darkEye);
    v.box(2, 4, 3, 3, 6, 4, whiteEye);
    // Clean, friendly curved smile with soft upturned dimple corners (y = 1..3)
    const cornerCol = skinLum < 0.34 ? "#181015" : mixHex(skin, mouthCol, 0.72);
    v.box(-2, 1, 3, 2, 2, 4, mouthCol);
    v.put(-3, 2, 3, cornerCol);
    v.put(2, 2, 3, cornerCol);
    if (skinLum < 0.34) {
      v.box(-1, 1, 3, 1, 2, 4, tongueCol);
    }
  } else if (a.eyeStyle === "happy") {
    // Symmetric joyful ^ ^ arches (clear on both fair and deep espresso skin tones)
    const happyEyeCol = skinLum < 0.34 ? "#0b0d13" : darkEye;
    if (skinLum < 0.36) {
      const lidHighlight = shadeHex(skin, 1.36);
      v.box(-3, 6, 3, -1, 7, 4, lidHighlight);
      v.box(1, 6, 3, 3, 7, 4, lidHighlight);
    }
    v.box(-3, 5, 3, -1, 6, 4, happyEyeCol);
    v.put(-4, 4, 3, happyEyeCol);
    v.put(-1, 4, 3, mixHex(skin, happyEyeCol, 0.55));
    v.box(1, 5, 3, 3, 6, 4, happyEyeCol);
    v.put(0, 4, 3, mixHex(skin, happyEyeCol, 0.55));
    v.put(3, 4, 3, happyEyeCol);
    // Big cheerful open toothy grin (y = 1..3)
    v.box(-2, 2, 3, 2, 3, 4, whiteEye);
    v.box(-2, 1, 3, 2, 2, 4, mouthCol);
    v.box(-1, 1, 3, 1, 2, 4, tongueCol);
  } else if (a.eyeStyle === "wink") {
    // Winking left eye (-X) + raised brow, open 2x2 right eye (+X)
    v.box(-3, 6, 3, -1, 7, 4, browCol);
    v.box(-3, 4, 3, -1, 5, 4, darkEye);
    v.put(-3, 5, 3, darkEye);
    v.box(1, 6, 3, 3, 7, 4, browCol);
    v.box(1, 4, 3, 2, 6, 4, darkEye);
    v.box(2, 4, 3, 3, 6, 4, whiteEye);
    // Cheeky asymmetric smirk with tooth gleam
    v.box(-2, 1, 3, 2, 2, 4, mouthCol);
    v.put(1, 2, 3, whiteEye);
    v.put(2, 2, 3, mouthCol);
  } else if (a.eyeStyle === "shades") {
    // Cool 3D wrap-around sunglasses (y = 4..6, z = 4..5)
    v.box(-4, 5, 4, 4, 6, 5, "#15171d");
    v.box(-4, 4, 4, -1, 6, 5, "#232730");
    v.box(1, 4, 4, 4, 6, 5, "#232730");
    v.put(-3, 5, 4, "#6fb7f0");
    v.put(2, 5, 4, "#6fb7f0");
    v.box(-5, 5, 0, -4, 6, 5, "#15171d");
    v.box(4, 5, 0, 5, 6, 5, "#15171d");
    // Confident cool smirk with tooth glint
    v.box(-2, 1, 3, 2, 2, 4, mouthCol);
    v.put(1, 2, 3, whiteEye);
    v.put(2, 2, 3, mouthCol);
  } else if (a.eyeStyle === "glasses") {
    // Unobstructed 2x2 eyes on face + sleek 3D glasses frames around them
    v.box(-3, 4, 3, -2, 6, 4, whiteEye);
    v.box(-2, 4, 3, -1, 6, 4, darkEye);
    v.box(1, 4, 3, 2, 6, 4, darkEye);
    v.box(2, 4, 3, 3, 6, 4, whiteEye);
    const frameCol = "#2c313b";
    v.box(-4, 6, 4, -1, 7, 5, frameCol);
    v.box(1, 6, 4, 4, 7, 5, frameCol);
    v.box(-1, 5, 4, 1, 6, 5, frameCol);
    v.box(-4, 4, 4, -3, 6, 5, frameCol);
    v.box(3, 4, 4, 4, 6, 5, frameCol);
    v.box(-5, 5, 0, -4, 6, 5, frameCol);
    v.box(4, 5, 0, 5, 6, 5, frameCol);
    // Warm friendly smile
    const cornerCol = skinLum < 0.34 ? "#181015" : mixHex(skin, mouthCol, 0.72);
    v.box(-2, 1, 3, 2, 2, 4, mouthCol);
    v.put(-3, 2, 3, cornerCol);
    v.put(2, 2, 3, cornerCol);
    if (skinLum < 0.34) {
      v.box(-1, 1, 3, 1, 2, 4, tongueCol);
    }
  } else if (a.eyeStyle === "visor") {
    // Glowing cyber visor (y = 4..6, z = 4..5)
    v.box(-5, 4, 2, 5, 6, 5, "#232730");
    v.box(-4, 4, 4, 4, 6, 5, "#5ce6db", 1.15);
    v.box(-3, 5, 4, 2, 6, 5, "#ffffff", 1.25);
    // Crisp cyber grin
    v.box(-2, 1, 3, 2, 2, 4, mouthCol);
    v.box(-1, 2, 3, 1, 3, 4, whiteEye);
    v.put(-2, 2, 3, mouthCol);
    v.put(1, 2, 3, mouthCol);
  } else if (a.eyeStyle === "starry") {
    // Big sparkly anime-voxel eyes + brows + excited smile
    v.box(-3, 6, 3, -1, 7, 4, browCol);
    v.box(1, 6, 3, 3, 7, 4, browCol);
    v.box(-3, 4, 3, -1, 6, 4, "#1b1f33");
    v.box(1, 4, 3, 3, 6, 4, "#1b1f33");
    v.put(-2, 5, 3, "#f6d55c", 0.9);
    v.put(-3, 4, 3, whiteEye, 0.85);
    v.put(1, 5, 3, "#f6d55c", 0.9);
    v.put(2, 4, 3, whiteEye, 0.85);
    v.box(-2, 2, 3, 2, 3, 4, whiteEye);
    v.box(-2, 1, 3, 2, 2, 4, mouthCol);
    v.box(-1, 1, 3, 1, 2, 4, tongueCol);
  }

  return v;
}

function sculptArmVox(a, isLeft) {
  const v = new Vox(isLeft ? 503 : 509);
  const top = a.topColor;
  const topDark = shadeHex(top, 0.84);
  const skin = a.skin;
  const x0 = isLeft ? -1 : -2;
  const x1 = isLeft ? 2 : 1;

  if (a.topStyle === "tee" || a.topStyle === "overalls") {
    const sleeveCol =
      a.topStyle === "overalls" && top.toLowerCase() === a.bottomColor.toLowerCase()
        ? "#fcfaf5"
        : top;
    v.box(x0, -4, -1, x1, 1, 2, sleeveCol);
    v.box(x0, -8, -1, x1, -4, 2, skin);
  } else if (a.topStyle === "striped") {
    const stripeAlt = top === "#fcfaf5" ? "#2f5696" : "#fcfaf5";
    v.box(x0, -5, -1, x1, 1, 2, top);
    v.box(x0, -4, -1, x1, -3, 2, stripeAlt);
    v.box(x0, -2, -1, x1, -1, 2, stripeAlt);
    v.box(x0, -8, -1, x1, -5, 2, skin);
  } else if (a.topStyle === "suit") {
    v.box(x0, -5, -1, x1, 1, 2, top);
    v.box(x0, -6, -1, x1, -5, 2, "#fcfaf5");
    v.box(x0, -8, -1, x1, -6, 2, skin);
  } else if (a.topStyle === "tunic") {
    v.box(x0, -5, -1, x1, 1, 2, top);
    v.box(x0, -6, -1, x1, -5, 2, topDark);
    v.box(x0, -8, -1, x1, -6, 2, skin);
  } else {
    // hoodie & jacket
    v.box(x0, -5, -1, x1, 1, 2, top);
    v.box(x0, -6, -1, x1, -5, 2, topDark);
    v.box(x0, -8, -1, x1, -6, 2, skin);
  }

  return v;
}

function sculptLegVox(a, isLeft) {
  const v = new Vox(isLeft ? 607 : 613);
  const pants = a.bottomColor;
  const pantsDark = shadeHex(pants, 0.84);
  const pantsLight = shadeHex(pants, 1.18);
  const shoe = a.shoeColor;
  const shoeSole = shoe === "#fcfaf5" ? "#2d323b" : "#f2eadb";

  // Leg spans x[-1..2] (width 3), y[-8..0], z[-2..2]
  if (a.bottomStyle === "shorts") {
    v.box(-1, -3, -2, 2, 0, 2, pants);
    v.box(-1, -5, -1, 2, -3, 2, a.skin);
    v.box(-1, -6, -1, 2, -5, 2, "#fcfaf5");
  } else if (a.bottomStyle === "skirt") {
    v.box(-2, -3, -2, 3, 0, 3, pants);
    v.box(-1, -6, -1, 2, -3, 2, a.skin);
  } else if (a.bottomStyle === "cuffed") {
    v.box(-1, -4, -2, 2, 0, 2, pants);
    v.box(-1, -6, -2, 2, -4, 2, pantsLight);
  } else if (a.bottomStyle === "cargo") {
    v.box(-1, -6, -2, 2, 0, 2, pants);
    if (isLeft) {
      v.box(2, -4, -1, 3, -1, 1, pantsDark);
    } else {
      v.box(-2, -4, -1, -1, -1, 1, pantsDark);
    }
  } else {
    // jeans
    v.box(-1, -6, -2, 2, 0, 2, pants);
    v.box(-1, -1, -2, 2, 0, 2, pantsDark);
  }

  // Crisp sneaker/boot extending forward (+Z)
  v.box(-1, -7, -2, 2, -5, 3, shoe);
  v.put(0, -6, 2, "#fcfaf5");
  v.box(-1, -8, -2, 2, -7, 4, shoeSole);

  return v;
}

// ---------------- Articulated Voxel Character Rig ----------------

function disposeObjectGeometries(group) {
  group.traverse((obj) => {
    if (obj.isMesh && obj.geometry) {
      obj.geometry.dispose();
    }
  });
  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
}

export function buildCharacterAvatarRig(appearance, options = {}) {
  const {
    isLocalPlayer = false,
    scale = 0.145,
    castShadow = true,
  } = options;

  const s = scale;
  const vs = s * 0.5; // Fine half-voxel resolution while matching exact world proportions

  const root = new THREE.Group();
  root.name = isLocalPlayer ? "local-avatar-rig" : "remote-avatar-rig";

  const bodyPivot = new THREE.Group();
  bodyPivot.name = "bodyPivot";
  root.add(bodyPivot);

  const torsoPivot = new THREE.Group();
  torsoPivot.name = "torsoPivot";
  torsoPivot.position.set(0, 4.0 * s, 0);
  bodyPivot.add(torsoPivot);

  const headPivot = new THREE.Group();
  headPivot.name = "headPivot";
  headPivot.position.set(0, 9.2 * s, 0);
  bodyPivot.add(headPivot);

  const leftArm = new THREE.Group();
  leftArm.name = "leftArm";
  leftArm.position.set(2.35 * s, 8.7 * s, 0);
  bodyPivot.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.name = "rightArm";
  rightArm.position.set(-2.35 * s, 8.7 * s, 0);
  bodyPivot.add(rightArm);

  const leftLeg = new THREE.Group();
  leftLeg.name = "leftLeg";
  leftLeg.position.set(1.12 * s, 4.1 * s, 0);
  bodyPivot.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.name = "rightLeg";
  rightLeg.position.set(-1.12 * s, 4.1 * s, 0);
  bodyPivot.add(rightLeg);

  let currentAppearance = sanitizeAppearance(appearance);
  let currentSig = "";
  let fpMode = false;
  let gaitPhase = 0;
  let smoothBodyLift = 0;
  let smoothTorsoRx = 0;
  let smoothLeftLegRx = 0;
  let smoothRightLegRx = 0;
  let smoothLeftArmRx = 0;
  let smoothLeftArmRz = 0;
  let smoothRightArmRx = 0;
  let smoothRightArmRy = 0;
  let smoothRightArmRz = 0;

  function rebuildParts(cleanApp) {
    disposeObjectGeometries(torsoPivot);
    disposeObjectGeometries(headPivot);
    disposeObjectGeometries(leftArm);
    disposeObjectGeometries(rightArm);
    disposeObjectGeometries(leftLeg);
    disposeObjectGeometries(rightLeg);

    const limbCast = Boolean(castShadow && isLocalPlayer);

    const torsoMesh = buildVoxelMesh(sculptTorsoVox(cleanApp), {
      scale: vs,
      depthLayer: 0,
      castShadow: Boolean(castShadow),
    });
    torsoMesh.position.set(0, 0, -0.25 * s);
    torsoPivot.add(torsoMesh);

    const headMesh = buildVoxelMesh(sculptHeadVox(cleanApp), {
      scale: vs,
      depthLayer: 1,
      castShadow: Boolean(castShadow),
    });
    headPivot.add(headMesh);

    const lArmMesh = buildVoxelMesh(sculptArmVox(cleanApp, true), {
      scale: vs,
      depthLayer: 3,
      castShadow: limbCast,
    });
    lArmMesh.position.set(0.18 * s, 0, -0.25 * s);
    leftArm.add(lArmMesh);

    const rArmMesh = buildVoxelMesh(sculptArmVox(cleanApp, false), {
      scale: vs,
      depthLayer: 3,
      castShadow: limbCast,
    });
    rArmMesh.position.set(-0.18 * s, 0, -0.25 * s);
    rightArm.add(rArmMesh);

    const lLegMesh = buildVoxelMesh(sculptLegVox(cleanApp, true), {
      scale: vs,
      depthLayer: 2,
      castShadow: limbCast,
    });
    lLegMesh.position.set(-0.25 * s, -0.1 * s, 0);
    leftLeg.add(lLegMesh);

    const rLegMesh = buildVoxelMesh(sculptLegVox(cleanApp, false), {
      scale: vs,
      depthLayer: 2,
      castShadow: limbCast,
    });
    rLegMesh.position.set(-0.25 * s, -0.1 * s, 0);
    rightLeg.add(rLegMesh);
  }

  function setAppearance(nextAppearance) {
    const clean = sanitizeAppearance(nextAppearance);
    currentAppearance = clean;
    const nextSig = appearanceSignature(clean);
    if (nextSig !== currentSig) {
      currentSig = nextSig;
      rebuildParts(clean);
    }
    return clean;
  }

  function setFirstPersonMode(isFp) {
    fpMode = Boolean(isFp);
    headPivot.visible = !fpMode;
    const legZ = fpMode ? 0.05 * (s / 0.145) : 0;
    leftLeg.position.z = legZ;
    rightLeg.position.z = legZ;
    if (fpMode) {
      bodyPivot.position.set(0, -0.05 + smoothBodyLift, -0.22);
    } else {
      bodyPivot.position.set(0, smoothBodyLift, 0);
    }
  }

  function applyPose({
    dt = 0.016,
    t = 0,
    yaw = 0,
    pitch = 0,
    speed = 0,
    anim = "idle",
    jumpY = 0,
    waveTimer = 0,
    isFirstPerson,
  } = {}) {
    const safeDt = Math.max(0.0005, Math.min(0.1, Number(dt) || 0.016));
    if (typeof isFirstPerson === "boolean" && isFirstPerson !== fpMode) {
      setFirstPersonMode(isFirstPerson);
    }

    // Characters face local +Z; fpCamera looks along -Z, so add PI!
    root.rotation.y = (Number(yaw) || 0) + Math.PI;

    if (!fpMode) {
      headPivot.rotation.x = Math.max(-0.55, Math.min(0.55, -(Number(pitch) || 0) * 0.65));
    } else {
      headPivot.rotation.x = 0;
    }

    const isSeated = anim === "sit" || anim === "ride";
    const isJumping = !isSeated && (anim === "jump" || jumpY > 0.03);
    const isWaving = waveTimer > 0 || anim === "wave";
    const effSpeed = isSeated
      ? 0
      : Math.max(0, Number(speed) || (anim === "run" ? 8.2 : anim === "walk" ? 4.6 : 0));
    const moveFactor = Math.min(1.35, effSpeed / 5.4);
    const isSprinting = !isSeated && (anim === "run" || effSpeed > 6.4);

    if (moveFactor > 0.04 && !isJumping) {
      gaitPhase += safeDt * (6.8 + effSpeed * 0.85);
    }

    let goalBodyLift = 0;
    let goalTorsoRx = 0;
    let goalLLegRx = 0;
    let goalRLegRx = 0;
    let goalLArmRx = 0;
    let goalLArmRz = 0.04;
    let goalRArmRx = 0;
    let goalRArmRy = 0;
    let goalRArmRz = -0.04;

    if (isSeated) {
      // Legs bent forward (-1.35 rad swings -Y limb toward +Z), hips lowered neatly onto seat
      goalBodyLift = -1.15 * s;
      goalLLegRx = -1.35;
      goalRLegRx = -1.35;
      goalLArmRx = -0.42;
      goalRArmRx = -0.42;
      goalLArmRz = 0.06;
      goalRArmRz = -0.06;
    } else if (isJumping) {
      goalBodyLift = 0.02;
      goalTorsoRx = 0.06;
      goalLLegRx = -0.58;
      goalRLegRx = 0.34;
      if (fpMode) {
        // Subtle peripheral hand lift in first person
        goalLArmRx = -1.08;
        goalRArmRx = -1.08;
        goalLArmRz = 0.14;
        goalRArmRz = -0.14;
      } else {
        goalLArmRx = -0.95;
        goalRArmRx = -0.95;
        goalLArmRz = 0.22;
        goalRArmRz = -0.22;
      }
    } else if (moveFactor > 0.04) {
      const strideAmp = (isSprinting ? 0.86 : 0.64) * Math.min(1.15, moveFactor);
      const sWave = Math.sin(gaitPhase);
      goalLLegRx = sWave * strideAmp;
      goalRLegRx = -sWave * strideAmp;

      const armSwing = -sWave * strideAmp * (isSprinting ? 0.96 : 0.82);
      const fpForwardBias = fpMode && isSprinting ? -0.44 : fpMode ? -0.14 : 0;
      goalLArmRx = armSwing + fpForwardBias;
      goalRArmRx = -armSwing + fpForwardBias;
      goalLArmRz = 0.06;
      goalRArmRz = -0.06;
      goalTorsoRx = isSprinting ? 0.09 : 0.03 * moveFactor;
      goalBodyLift = fpMode ? 0 : Math.abs(Math.cos(gaitPhase)) * 0.055 * Math.min(1, moveFactor);
    } else {
      // Gentle idle breathing
      const breathe = Math.sin(t * 2.1);
      goalBodyLift = fpMode ? 0 : breathe * 0.008;
      goalLArmRz = 0.05 + breathe * 0.02;
      goalRArmRz = -0.05 - breathe * 0.02;
      goalLArmRx = Math.sin(t * 1.4) * 0.025;
      goalRArmRx = -Math.sin(t * 1.4) * 0.025;
    }

    if (isWaving) {
      const waveOsc = Math.sin(t * 11.5);
      if (fpMode) {
        // Bring waving hand clearly into lower-right first-person view and wag side-to-side
        const pitchFollow = Math.max(-0.45, Math.min(0.45, Number(pitch) || 0)) * 0.65;
        goalRArmRx = -1.92 - pitchFollow + Math.cos(t * 11.5) * 0.06;
        goalRArmRy = 0.28 + waveOsc * 0.22;
        goalRArmRz = -0.08 + waveOsc * 0.22;
      } else {
        goalRArmRx = -2.55;
        goalRArmRz = -0.3 + waveOsc * 0.32;
      }
    }

    const blend = 1 - Math.exp(-safeDt * 17);
    smoothBodyLift += (goalBodyLift - smoothBodyLift) * blend;
    smoothTorsoRx += (goalTorsoRx - smoothTorsoRx) * blend;
    smoothLeftLegRx += (goalLLegRx - smoothLeftLegRx) * blend;
    smoothRightLegRx += (goalRLegRx - smoothRightLegRx) * blend;
    smoothLeftArmRx += (goalLArmRx - smoothLeftArmRx) * blend;
    smoothLeftArmRz += (goalLArmRz - smoothLeftArmRz) * blend;
    smoothRightArmRx += (goalRArmRx - smoothRightArmRx) * blend;
    smoothRightArmRy += (goalRArmRy - smoothRightArmRy) * blend;
    smoothRightArmRz += (goalRArmRz - smoothRightArmRz) * blend;

    torsoPivot.rotation.x = smoothTorsoRx;
    leftLeg.rotation.x = smoothLeftLegRx;
    rightLeg.rotation.x = smoothRightLegRx;
    leftArm.rotation.set(smoothLeftArmRx, 0, smoothLeftArmRz);
    rightArm.rotation.set(smoothRightArmRx, smoothRightArmRy, smoothRightArmRz);

    const legZ = fpMode ? 0.05 * (s / 0.145) : 0;
    leftLeg.position.z = legZ;
    rightLeg.position.z = legZ;
    if (fpMode) {
      bodyPivot.position.set(0, -0.05 + smoothBodyLift, -0.22);
    } else {
      bodyPivot.position.set(0, smoothBodyLift, 0);
    }
  }

  function dispose() {
    disposeObjectGeometries(torsoPivot);
    disposeObjectGeometries(headPivot);
    disposeObjectGeometries(leftArm);
    disposeObjectGeometries(rightArm);
    disposeObjectGeometries(leftLeg);
    disposeObjectGeometries(rightLeg);
  }

  setAppearance(currentAppearance);
  root.userData.dispose = dispose;

  return {
    root,
    bodyPivot,
    torsoPivot,
    headPivot,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    getAppearance: () => ({ ...currentAppearance }),
    setAppearance,
    setFirstPersonMode,
    applyPose,
    dispose,
  };
}

// ---------------- Multiplayer Remote Avatar Manager ----------------

function wrapPi(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(from, to, alpha) {
  return from + wrapPi(to - from) * alpha;
}

function drawRoundedPill(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function createNameplateSprite(rawName) {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 56;
  const ctx = canvas.getContext("2d");
  const labelFont = "600 28px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif";

  let tex = null;
  const mat = new THREE.SpriteMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0.0);
  sprite.raycast = () => {};

  function renderLabel(nameStr) {
    const clean = sanitizeName(nameStr);
    const label = clean || "Explorer";
    const isCustom = Boolean(clean);

    ctx.font = labelFont;
    const textWidth = Math.ceil(ctx.measureText(label).width);
    const dotSpace = 22;
    const padX = 22;
    const pillW = Math.min(340, Math.max(92, textWidth + dotSpace + padX * 2));
    const pillH = 50;
    const nextW = Math.ceil(pillW + 6);
    const nextH = pillH + 6;
    const dimsChanged = canvas.width !== nextW || canvas.height !== nextH || !tex;

    if (canvas.width !== nextW) canvas.width = nextW;
    if (canvas.height !== nextH) canvas.height = nextH;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pillX = 3;
    const pillY = 3;

    drawRoundedPill(ctx, pillX, pillY, pillW, pillH, pillH * 0.5);
    ctx.fillStyle = isCustom ? "rgba(18, 24, 20, 0.82)" : "rgba(18, 24, 20, 0.68)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
    ctx.stroke();

    // Live human-player indicator dot
    const dotX = pillX + padX + 5;
    const dotY = pillY + pillH * 0.5;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "#3fb963";
    ctx.fill();

    ctx.font = labelFont;
    ctx.fillStyle = isCustom ? "#ffffff" : "rgba(255, 255, 255, 0.88)";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(label, dotX + 14, dotY + 1);

    if (dimsChanged) {
      if (tex) tex.dispose();
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      mat.map = tex;
      mat.needsUpdate = true;
    } else {
      tex.needsUpdate = true;
    }

    const worldH = 0.22;
    const worldW = worldH * (canvas.width / canvas.height);
    sprite.scale.set(worldW, worldH, 1);
  }

  let currentRendered = null;
  sprite.userData.setLabel = (nextName) => {
    const key = sanitizeName(nextName);
    if (key === currentRendered) return;
    currentRendered = key;
    renderLabel(key);
  };
  sprite.userData.dispose = () => {
    if (tex) {
      tex.dispose();
      tex = null;
    }
    mat.dispose();
  };

  sprite.userData.setLabel(rawName);
  return sprite;
}

function computeNameplateHeight(app, scale = 0.145) {
  const ratio = scale / 0.145;
  const hat = app?.hatStyle || "none";
  const hair = app?.hairStyle || "short";
  if (hat === "wizard" || hat === "party") {
    return 2.76 * ratio;
  }
  if (
    hat === "sprout" ||
    hat === "crown" ||
    hat === "cowboy" ||
    hat === "sunhat" ||
    hat === "hard_hat" ||
    hat === "beanie" ||
    hat === "beret" ||
    (hat === "none" &&
      (hair === "mohawk" || hair === "buns" || hair === "spiky" || hair === "curly"))
  ) {
    return 2.58 * ratio;
  }
  return 2.44 * ratio;
}

export class RemotePlayerManager {
  constructor(options = {}) {
    this.options = options;
    this.group = new THREE.Group();
    this.group.name = "remote-player-group";
    this.peers = new Map();
  }

  upsertPeer(peerData) {
    if (!peerData || !peerData.id) return null;
    const id = String(peerData.id);
    let peer = this.peers.get(id);

    const cleanName = sanitizeName(peerData.name ?? peerData.appearance?.name ?? "");
    const cleanApp = sanitizeAppearance({
      ...(peerData.appearance || {}),
      name: cleanName,
    });

    const tx = Number.isFinite(peerData.x) ? Number(peerData.x) : 0;
    const ty = Number.isFinite(peerData.y) ? Number(peerData.y) : 0;
    const tz = Number.isFinite(peerData.z) ? Number(peerData.z) : 0;
    const tyaw = Number.isFinite(peerData.yaw) ? Number(peerData.yaw) : 0;
    const tpitch = Number.isFinite(peerData.pitch) ? Number(peerData.pitch) : 0;
    const vx = Number.isFinite(peerData.vx) ? Number(peerData.vx) : 0;
    const vz = Number.isFinite(peerData.vz) ? Number(peerData.vz) : 0;

    if (!peer) {
      const scale = this.options.scale ?? 0.145;
      const rig = buildCharacterAvatarRig(cleanApp, {
        isLocalPlayer: false,
        scale,
        castShadow: true,
      });

      const nameplate = createNameplateSprite(cleanName);
      if (nameplate) {
        nameplate.position.set(0, computeNameplateHeight(cleanApp, scale), 0);
        rig.root.add(nameplate);
      }

      peer = {
        id,
        scale,
        name: cleanName,
        appearance: cleanApp,
        rig,
        nameplate,
        mode: peerData.mode === "aerial" ? "aerial" : "walk",
        tx,
        ty,
        tz,
        tyaw,
        tpitch,
        vx,
        vz,
        anim: typeof peerData.anim === "string" ? peerData.anim : "idle",
        ride: peerData.ride || null,
        seat: Number.isInteger(peerData.seat) ? peerData.seat : 0,
        room: peerData.room || null,
        curX: tx,
        curY: ty,
        curZ: tz,
        curYaw: tyaw,
        curPitch: tpitch,
        packetAge: 0,
        waveTimer: 0,
        emoteJumpY: 0,
        emoteJumpVy: 0,
        needsSnap: true,
        phaseOffset: (this.peers.size * 1.618) % (Math.PI * 2),
      };

      rig.root.position.set(tx, ty, tz);
      this.group.add(rig.root);
      this.peers.set(id, peer);
      return peer;
    }

    if (peerData.appearance || typeof peerData.name === "string") {
      this.updatePeerProfile(id, cleanName, cleanApp);
    }
    this.updatePeerPose(peerData);
    return peer;
  }

  updatePeerPose(poseMsg) {
    if (!poseMsg || !poseMsg.id) return;
    const id = String(poseMsg.id);
    let peer = this.peers.get(id);
    if (!peer) {
      this.upsertPeer(poseMsg);
      return;
    }

    const nextRoom = poseMsg.room || null;
    const nextRide = poseMsg.ride || null;
    const nextMode = poseMsg.mode === "aerial" ? "aerial" : "walk";
    const nx = Number.isFinite(poseMsg.x) ? Number(poseMsg.x) : peer.tx;
    const ny = Number.isFinite(poseMsg.y) ? Number(poseMsg.y) : peer.ty;
    const nz = Number.isFinite(poseMsg.z) ? Number(poseMsg.z) : peer.tz;

    const jumpedFar = Math.hypot(nx - peer.tx, nz - peer.tz) > 18;
    if (nextRoom !== peer.room || nextRide !== peer.ride || nextMode !== peer.mode || jumpedFar) {
      peer.needsSnap = true;
    }

    peer.mode = nextMode;
    peer.tx = nx;
    peer.ty = ny;
    peer.tz = nz;
    if (Number.isFinite(poseMsg.yaw)) peer.tyaw = Number(poseMsg.yaw);
    if (Number.isFinite(poseMsg.pitch)) peer.tpitch = Number(poseMsg.pitch);
    peer.vx = Number.isFinite(poseMsg.vx) ? Number(poseMsg.vx) : 0;
    peer.vz = Number.isFinite(poseMsg.vz) ? Number(poseMsg.vz) : 0;
    if (typeof poseMsg.anim === "string") peer.anim = poseMsg.anim;
    peer.ride = nextRide;
    peer.seat = Number.isInteger(poseMsg.seat) ? poseMsg.seat : 0;
    peer.room = nextRoom;
    peer.packetAge = 0;

    if (peer.anim === "wave" && peer.waveTimer <= 0.1) {
      peer.waveTimer = 0.35;
    }
  }

  updatePeerProfile(idOrObj, name, appearance) {
    const isObj = idOrObj && typeof idOrObj === "object";
    const id = String(isObj ? idOrObj.id : idOrObj || "");
    if (!id) return;
    const nextName = isObj ? idOrObj.name : name;
    const nextApp = isObj ? idOrObj.appearance : appearance;

    const peer = this.peers.get(id);
    if (!peer) {
      this.upsertPeer({ id, name: nextName, appearance: nextApp });
      return;
    }

    if (typeof nextName === "string") {
      peer.name = sanitizeName(nextName);
      peer.nameplate?.userData?.setLabel?.(peer.name);
    }
    if (nextApp && typeof nextApp === "object") {
      peer.appearance = peer.rig.setAppearance({
        ...peer.appearance,
        ...nextApp,
        name: peer.name,
      });
      if (peer.nameplate) {
        peer.nameplate.position.y = computeNameplateHeight(
          peer.appearance,
          peer.scale ?? this.options.scale ?? 0.145,
        );
      }
    }
  }

  triggerPeerEmote(idOrObj, kindArg) {
    const isObj = idOrObj && typeof idOrObj === "object";
    const id = String(isObj ? idOrObj.id : idOrObj || "");
    const kind = isObj ? idOrObj.kind : kindArg;
    const peer = this.peers.get(id);
    if (!peer) return;

    if (kind === "wave") {
      peer.waveTimer = 2.2;
    } else if (kind === "jump") {
      peer.emoteJumpVy = 5.4;
      peer.emoteJumpY = Math.max(peer.emoteJumpY, 0.02);
    } else if (kind === "cheer") {
      peer.waveTimer = 2.4;
      peer.emoteJumpVy = 5.0;
      peer.emoteJumpY = Math.max(peer.emoteJumpY, 0.02);
    }
  }

  removePeer(idOrObj) {
    const key = String(idOrObj && typeof idOrObj === "object" ? idOrObj.id : idOrObj || "");
    const peer = this.peers.get(key);
    if (!peer) return;
    if (peer.nameplate) {
      peer.rig.root.remove(peer.nameplate);
      peer.nameplate.userData?.dispose?.();
    }
    this.group.remove(peer.rig.root);
    peer.rig.dispose();
    this.peers.delete(key);
  }

  clear() {
    for (const id of Array.from(this.peers.keys())) {
      this.removePeer(id);
    }
  }

  getPeerCount() {
    return this.peers.size;
  }

  step(dt = 0.016, t = 0, ctx = {}) {
    const safeDt = Math.max(0.0005, Math.min(0.1, Number(dt) || 0.016));
    const localRoomId = ctx.localRoomId || null;
    const io = ctx.interiorOrigin || { x: 0, y: 520, z: 0 };
    const resolveRidePose = ctx.resolveRidePose || null;
    const getGroundHeight = ctx.getGroundHeight || null;

    for (const peer of this.peers.values()) {
      peer.packetAge = Math.min(2.0, peer.packetAge + safeDt);
      peer.waveTimer = Math.max(0, peer.waveTimer - safeDt);

      if (peer.emoteJumpY > 0 || peer.emoteJumpVy > 0) {
        peer.emoteJumpY += peer.emoteJumpVy * safeDt;
        peer.emoteJumpVy -= 15.5 * safeDt;
        if (peer.emoteJumpY <= 0) {
          peer.emoteJumpY = 0;
          peer.emoteJumpVy = 0;
        }
      }

      // Visibility gating by room vs exterior
      if (peer.room) {
        const vis = localRoomId === peer.room;
        peer.rig.root.visible = vis;
        if (!vis) continue;
      } else {
        const vis = localRoomId === null;
        peer.rig.root.visible = vis;
        if (!vis) continue;
      }

      // 1. Riding an island transit vehicle
      if (!peer.room && peer.ride && typeof resolveRidePose === "function") {
        const rPose = resolveRidePose(peer.ride, peer.seat || 0);
        if (rPose && Number.isFinite(rPose.x) && Number.isFinite(rPose.z)) {
          const ry = Number.isFinite(rPose.y) ? rPose.y : 0.45;
          const rideBlend = peer.needsSnap ? 1 : 1 - Math.exp(-safeDt * 28);
          peer.curX += (rPose.x - peer.curX) * rideBlend;
          peer.curY += (ry - peer.curY) * rideBlend;
          peer.curZ += (rPose.z - peer.curZ) * rideBlend;
          const targetYaw = Number.isFinite(peer.tyaw) ? peer.tyaw : (rPose.yaw || 0);
          peer.curYaw = peer.needsSnap
            ? targetYaw
            : lerpAngle(peer.curYaw, targetYaw, 1 - Math.exp(-safeDt * 18));
          peer.curPitch += (peer.tpitch - peer.curPitch) * (1 - Math.exp(-safeDt * 16));
          peer.needsSnap = false;

          peer.rig.root.position.set(peer.curX, peer.curY, peer.curZ);
          peer.rig.applyPose({
            dt: safeDt,
            t: t + peer.phaseOffset,
            yaw: peer.curYaw,
            pitch: peer.curPitch,
            speed: 0,
            anim: "ride",
            jumpY: 0,
            waveTimer: peer.waveTimer,
            isFirstPerson: false,
          });
          continue;
        }
      }

      // 2. Short dead-reckoning velocity projection (<= 0.14s) + exponential smoothing
      const projSec = Math.min(0.14, peer.packetAge) * Math.exp(-peer.packetAge * 2.4);
      let goalX = peer.tx + peer.vx * projSec;
      let goalY = peer.ty;
      let goalZ = peer.tz + peer.vz * projSec;

      if (peer.room) {
        // Support both room-local [-5..5, 0, -5..5] and already-offset interior world coords
        if (Math.abs(goalY - io.y) > 40) {
          goalX += io.x;
          goalY += io.y;
          goalZ += io.z;
        }
      } else if (typeof getGroundHeight === "function") {
        const gy = getGroundHeight(goalX, goalZ);
        if (peer.mode === "aerial") {
          goalY = gy;
        } else if (peer.anim !== "sit" && peer.anim !== "ride") {
          goalY = Math.max(gy, goalY);
        }
      }

      const prevX = peer.curX;
      const prevZ = peer.curZ;

      if (peer.needsSnap) {
        peer.curX = goalX;
        peer.curY = goalY;
        peer.curZ = goalZ;
        peer.curYaw = peer.tyaw;
        peer.curPitch = peer.tpitch;
        peer.needsSnap = false;
      } else {
        const posAlpha = 1 - Math.exp(-safeDt * 15);
        const rotAlpha = 1 - Math.exp(-safeDt * 16);
        peer.curX += (goalX - peer.curX) * posAlpha;
        peer.curY += (goalY - peer.curY) * posAlpha;
        peer.curZ += (goalZ - peer.curZ) * posAlpha;
        peer.curYaw = lerpAngle(peer.curYaw, peer.tyaw, rotAlpha);
        peer.curPitch += (peer.tpitch - peer.curPitch) * rotAlpha;
      }

      const movedSpeed = Math.hypot(peer.curX - prevX, peer.curZ - prevZ) / safeDt;
      const netSpeed = Math.hypot(peer.vx, peer.vz);
      const effSpeed = peer.mode === "aerial" ? 0 : Math.max(movedSpeed * 0.7 + netSpeed * 0.3, 0);

      let effAnim = peer.mode === "aerial" ? "idle" : peer.anim;
      if (peer.emoteJumpY > 0.03 && effAnim !== "sit" && effAnim !== "ride") {
        effAnim = "jump";
      } else if (effAnim !== "sit" && effAnim !== "ride" && effAnim !== "jump") {
        if (effSpeed > 6.5) effAnim = "run";
        else if (effSpeed > 0.35) effAnim = "walk";
        else if (effAnim === "walk" || effAnim === "run") effAnim = "idle";
      }

      peer.rig.root.position.set(peer.curX, peer.curY + peer.emoteJumpY, peer.curZ);
      peer.rig.applyPose({
        dt: safeDt,
        t: t + peer.phaseOffset,
        yaw: peer.curYaw,
        pitch: peer.curPitch,
        speed: effSpeed,
        anim: effAnim,
        jumpY: Math.max(0, peer.emoteJumpY),
        waveTimer: peer.waveTimer,
        isFirstPerson: false,
      });
    }
  }

  dispose() {
    this.clear();
  }
}

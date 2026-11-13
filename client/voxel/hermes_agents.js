// 3D Micro-Voxel Hermes Agent & Sub-Agent Swarm Renderer + Steering Manager.

import * as THREE from "three";
import { Vox, buildVoxelMesh } from "./vox.js";

const ROLE_THEMES = {
  orchestrator: {
    coat: "#2f5696",
    coatDark: "#213f70",
    coatLight: "#4976bf",
    trim: "#f4c44e",
    accent: "#64f5df",
    visor: "#5ce6db",
    skin: "#eab586",
    hair: "#242024",
    pants: "#232730",
    boots: "#181a20",
    packColor: "#f4c44e",
    accentHex: 0x64f5df,
  },
  architect: {
    coat: "#d98c38",
    coatDark: "#a86722",
    coatLight: "#eba859",
    trim: "#f4c44e",
    accent: "#ffe29a",
    visor: "#ffe29a",
    skin: "#f4cba6",
    hair: "#4a3121",
    pants: "#364d73",
    boots: "#5c3b22",
    packColor: "#deb07c",
    accentHex: 0xf4c44e,
  },
  coder: {
    coat: "#2d7d74",
    coatDark: "#1f5952",
    coatLight: "#47b0a3",
    trim: "#64f5df",
    accent: "#5ef28c",
    visor: "#64f5df",
    skin: "#d99866",
    hair: "#242024",
    pants: "#262930",
    boots: "#2d323b",
    packColor: "#434854",
    accentHex: 0x5ef28c,
  },
  researcher: {
    coat: "#4c82d4",
    coatDark: "#335ea1",
    coatLight: "#6fb7f0",
    trim: "#b8e4f2",
    accent: "#64f5df",
    visor: "#6fb7f0",
    skin: "#fae0cb",
    hair: "#c9823b",
    pants: "#394a6d",
    boots: "#6e4328",
    packColor: "#8c99a6",
    accentHex: 0x6fb7f0,
  },
  critic: {
    coat: "#be3438",
    coatDark: "#8f2225",
    coatLight: "#df5246",
    trim: "#ffb642",
    accent: "#ff7426",
    visor: "#ffb642",
    skin: "#c27d4c",
    hair: "#181a20",
    pants: "#262930",
    boots: "#181a20",
    packColor: "#434854",
    accentHex: 0xffb642,
  },
  memory: {
    coat: "#65469c",
    coatDark: "#493175",
    coatLight: "#9370cf",
    trim: "#d8b4fe",
    accent: "#d8b4fe",
    visor: "#d8b4fe",
    skin: "#f4cba6",
    hair: "#d8dce3",
    pants: "#2d2a3d",
    boots: "#4a3121",
    packColor: "#c9935b",
    accentHex: 0xd8b4fe,
  },
  tool_runner: {
    coat: "#c8754b",
    coatDark: "#965331",
    coatLight: "#ec8438",
    trim: "#f5b82e",
    accent: "#ffe29a",
    visor: "#ffe29a",
    skin: "#9e5e36",
    hair: "#242024",
    pants: "#4b4f59",
    boots: "#262930",
    packColor: "#8c99a6",
    accentHex: 0xffe29a,
  },
  sculptor: {
    coat: "#47b0a3",
    coatDark: "#2d7d74",
    coatLight: "#64f5df",
    trim: "#f4c44e",
    accent: "#ffe29a",
    visor: "#64f5df",
    skin: "#eab586",
    hair: "#7a4b2a",
    pants: "#4b4f59",
    boots: "#6e4328",
    packColor: "#c9935b",
    accentHex: 0x64f5df,
  },
};

const STATUS_COLORS = {
  standby: 0x6b9080,
  thinking: 0xffb642,
  executing: 0x5ce6db,
  delegating: 0xf4c44e,
  completed: 0x3fb963,
  error: 0xdf5246,
};

const CONFETTI_HEX = [0xf4c44e, 0x5ce6db, 0x5ef28c, 0xff7426, 0xd8b4fe, 0x6fb7f0, 0xffe29a, 0x3fb963];
const ARC_POINTS = 13;

// Shared geometries & materials across all Hermes agents (cuts draw state overhead cleanly)
const SHARED_PACKET_GEO = new THREE.BoxGeometry(0.115, 0.115, 0.115);
const SHARED_CONFETTI_GEO = new THREE.BoxGeometry(0.085, 0.085, 0.085);
const SHARED_CONFETTI_MATS = CONFETTI_HEX.map(
  (hex) => new THREE.MeshBasicMaterial({ color: hex }),
);
const HERMES_RIG_PROTO_CACHE = new Map();

function tagHermesTree(obj, agentId) {
  obj.traverse((child) => {
    child.userData.hermesAgentId = agentId;
  });
}

function truncateText(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function renderBannerTexture(agentName, status, progress, subtitle, accentHex) {
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 104;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const r = 14;
  ctx.fillStyle = "rgba(22, 27, 24, 0.90)";
  ctx.beginPath();
  ctx.moveTo(r, 4);
  ctx.lineTo(canvas.width - r, 4);
  ctx.quadraticCurveTo(canvas.width - 4, 4, canvas.width - 4, r);
  ctx.lineTo(canvas.width - 4, canvas.height - r - 12);
  ctx.quadraticCurveTo(canvas.width - 4, canvas.height - 12, canvas.width - r, canvas.height - 12);
  ctx.lineTo(canvas.width * 0.5 + 10, canvas.height - 12);
  ctx.lineTo(canvas.width * 0.5, canvas.height - 2);
  ctx.lineTo(canvas.width * 0.5 - 10, canvas.height - 12);
  ctx.lineTo(r, canvas.height - 12);
  ctx.quadraticCurveTo(4, canvas.height - 12, 4, canvas.height - r - 12);
  ctx.lineTo(4, r);
  ctx.quadraticCurveTo(4, 4, r, 4);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.stroke();

  const hexStr = `#${(accentHex >>> 0).toString(16).padStart(6, "0")}`;

  ctx.fillStyle = hexStr;
  ctx.beginPath();
  ctx.arc(24, 30, 6.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "600 22px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  const rightLabel =
    status === "executing" || status === "thinking"
      ? `${status} ${Math.round(progress || 0)}%`
      : status === "completed"
        ? "done!"
        : status;
  ctx.fillText(truncateText(agentName, 20), 40, 31);

  ctx.font = "600 18px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = hexStr;
  const rightW = ctx.measureText(rightLabel).width;
  ctx.fillText(rightLabel, canvas.width - 20 - rightW, 31);

  ctx.font = "500 18px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(232, 240, 236, 0.88)";
  ctx.fillText(truncateText(subtitle || "Working on task", 36), 20, 66);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// ---------------- High-Craft Micro-Voxel Hermes Character Sculpting ----------------

function sculptHermesTorsoVox(role, theme, isLead) {
  const v = new Vox(isLead ? 901 : 940 + role.length * 13);
  // Base torso: x[-4..4], y[0..10], z[-2..3] (faces +Z)
  v.box(-4, 0, -2, 4, 10, 3, theme.coat);
  v.box(-4, 0, -2, 4, 1, 3, theme.coatDark);

  // Chest placket / inner vest + glowing chest arc emblem
  v.box(-2, 2, 2, 2, 10, 3, "#1f242c");
  v.box(-1, 5, 2, 1, 8, 3, theme.accent, 0.9);
  v.box(-4, 2, -3, 4, 3, 3, "#3b4048"); // utility waist belt
  v.box(-1, 2, 2, 1, 3, 3, theme.trim); // gold/brass buckle

  if (isLead || role === "orchestrator") {
    // Royal Hermes Prime mantle shoulders, gold lapels & flowing twin cape
    v.box(-4, 8, -2, -2, 10, 3, theme.trim);
    v.box(2, 8, -2, 4, 10, 3, theme.trim);
    v.box(-5, 9, -2, -4, 10, 2, theme.trim);
    v.box(4, 9, -2, 5, 10, 2, theme.trim);
    // Flowing cape down the back
    v.box(-4, 9, -3, 4, 10, 3, theme.coatDark);
    v.box(-4, 3, -4, 4, 9, -2, theme.coat);
    v.box(-5, -4, -4, 5, 3, -2, theme.coatDark);
    v.box(-5, -4, -4, 5, -3, -2, theme.trim);
  } else if (role === "architect" || role === "sculptor") {
    // Drafting coat collar + rolled blueprint scroll cylinder diagonally on back
    v.box(-3, 8, 2, -2, 10, 3, theme.coatLight);
    v.box(2, 8, 2, 3, 10, 3, theme.coatLight);
    for (let i = 0; i < 7; i++) {
      v.box(-3 + i, 2 + i, -5, -1 + i, 4 + i, -3, "#faf3e3");
    }
    v.box(-3, 2, -5, -1, 4, -3, theme.trim);
    v.box(3, 8, -5, 5, 10, -3, theme.trim);
  } else if (role === "coder") {
    // Tactical coder hoodie + twin glowing antenna telemetry backpack
    v.box(-3, 8, -4, 3, 10, -1, theme.coatDark);
    v.box(-2, 9, -3, 2, 10, -1, theme.coatLight);
    v.box(-3, 2, -5, 3, 8, -2, "#323741");
    v.box(-2, 4, -6, 2, 6, -5, theme.accent, 0.85);
    v.box(2, 8, -5, 2, 14, -4, "#8c99a6");
    v.put(2, 14, -4, theme.accent, 1.1);
    v.box(-2, 8, -5, -2, 12, -4, "#8c99a6");
  } else if (role === "researcher") {
    // Explorer scarf + field telemetry backpack with mini radar dish
    v.box(-4, 8, -3, 4, 10, 3, theme.trim);
    v.box(1, 3, 2, 3, 9, 3, theme.trim);
    v.box(-3, 2, -5, 3, 8, -2, theme.packColor);
    v.box(-2, 7, -6, 2, 11, -4, "#d8e2eb");
    v.put(0, 9, -6, theme.accent, 1.0);
  } else if (role === "critic") {
    // Inspector high-collar trench lapels + shoulder armor plates
    v.box(-4, 6, 2, -2, 10, 3, theme.trim);
    v.box(2, 6, 2, 4, 10, 3, theme.trim);
    v.box(-5, 8, -2, -4, 10, 2, "#3b4048");
    v.box(4, 8, -2, 5, 10, 2, "#3b4048");
    v.box(-3, 3, -5, 3, 8, -2, "#3b4048");
    v.put(0, 5, -5, theme.accent, 0.9);
  } else if (role === "memory") {
    // Scholar sash + leather tome pack with luminous rune spine
    v.box(-3, 7, 2, 3, 10, 3, theme.trim);
    v.box(-3, 2, -6, 3, 9, -2, "#6e4328");
    v.box(-2, 3, -7, 2, 8, -6, "#faf3e3");
    v.box(-1, 4, -7, 1, 7, -6, theme.accent, 0.95);
  } else {
    // Tool runner jet-relay pack with twin thrusters & chest harness
    v.box(-4, 3, -5, -1, 9, -2, theme.packColor);
    v.box(1, 3, -5, 4, 9, -2, theme.packColor);
    v.box(-3, 1, -5, -2, 3, -3, theme.accent, 1.1);
    v.box(2, 1, -5, 3, 3, -3, theme.accent, 1.1);
    v.box(-4, 4, 2, -3, 10, 3, "#3b4048");
    v.box(3, 4, 2, 4, 10, 3, "#3b4048");
  }

  return v;
}

function sculptHermesHeadVox(role, theme, isLead) {
  const v = new Vox(isLead ? 911 : 960 + role.length * 7);

  // Neck post inside headPivot
  v.box(-2, -1, -2, 2, 0, 1, theme.skin);

  // Sculpted 8x8x8 head with warm voxel ears
  v.box(-4, 0, -4, 4, 8, 4, theme.skin);
  v.box(-5, 2, -1, -4, 5, 1, theme.skin);
  v.box(4, 2, -1, 5, 5, 1, theme.skin);

  // Hair base peeking under headgear
  v.box(-4, 6, -5, 4, 8, 2, theme.hair);
  v.box(-5, 4, -4, -4, 7, 1, theme.hair);
  v.box(4, 4, -4, 5, 7, 1, theme.hair);

  // Role Headgear (all kept at y >= 7 on front so face stays crisp)
  if (isLead || role === "orchestrator") {
    // Winged Gold-Crested Hermes Helmet
    v.box(-4, 7, -4, 4, 10, 4, theme.coat);
    v.box(-1, 8, -4, 1, 11, 5, theme.trim);
    v.box(-4, 7, 4, 4, 8, 5, theme.trim);
    // Crisp sculpted feathered side wings on helmet
    v.box(-6, 5, -2, -5, 9, 1, theme.trim);
    v.box(-7, 7, -3, -6, 11, 0, "#fcfaf5");
    v.put(-8, 10, -2, "#fcfaf5");
    v.box(5, 5, -2, 6, 9, 1, theme.trim);
    v.box(6, 7, -3, 7, 11, 0, "#fcfaf5");
    v.put(7, 10, -2, "#fcfaf5");
  } else if (role === "architect" || role === "sculptor") {
    // Hard-hat / Drafting cap with headlamp prism
    v.box(-5, 7, -5, 5, 9, 5, theme.coat);
    v.box(-4, 9, -4, 4, 11, 4, theme.coatLight);
    v.box(-4, 7, 4, 4, 8, 6, theme.coatDark);
    v.box(-1, 8, 4, 1, 10, 6, theme.accent, 0.95);
  } else if (role === "coder") {
    // Tech headphones + sleek beanie crown
    v.box(-4, 7, -4, 4, 10, 4, theme.coatDark);
    v.box(-6, 4, -1, -5, 9, 1, "#232730");
    v.box(5, 4, -1, 6, 9, 1, "#232730");
    v.box(-7, 2, -2, -5, 6, 2, theme.trim);
    v.box(5, 2, -2, 7, 6, 2, theme.trim);
  } else if (role === "researcher") {
    // Explorer cap with pushed-up glowing field goggles
    v.box(-4, 7, -4, 4, 10, 4, theme.coat);
    v.box(-4, 7, 4, 4, 8, 6, theme.coatDark);
    v.box(-4, 8, 4, -1, 10, 5, theme.accent, 0.9);
    v.box(1, 8, 4, 4, 10, 5, theme.accent, 0.9);
    v.box(-1, 9, 4, 1, 10, 5, "#262930");
  } else if (role === "critic") {
    // Angular crimson inspector helm + twin gold antennae fins
    v.box(-4, 7, -4, 4, 10, 4, theme.coatDark);
    v.box(-4, 7, 4, 4, 8, 5, theme.trim);
    v.box(-5, 9, -1, -4, 12, 1, theme.trim);
    v.box(4, 9, -1, 5, 12, 1, theme.trim);
  } else if (role === "memory") {
    // Scholar wizard-beret crown with luminous amethyst crest
    v.box(-5, 7, -4, 4, 10, 4, theme.coat);
    v.box(-4, 10, -3, 3, 11, 3, theme.coatLight);
    v.put(0, 11, 3, theme.accent, 0.95);
  } else {
    // Tool runner winged relay helmet
    v.box(-4, 7, -4, 4, 10, 4, theme.coat);
    v.box(-6, 6, -1, -5, 10, 1, theme.trim);
    v.box(5, 6, -1, 6, 10, 1, theme.trim);
  }

  // Expressive Face / Cyber Visor (sculpted last on z = 3..5)
  if (isLead || role === "orchestrator" || role === "coder" || role === "tool_runner") {
    // Sleek glowing cyber visor + confident smile
    v.box(-5, 4, 2, 5, 6, 5, "#232730");
    v.box(-4, 4, 4, 4, 6, 5, theme.visor, 1.05);
    v.box(-3, 5, 4, 2, 6, 5, "#ffffff", 1.15);
    v.box(-2, 1, 3, 2, 2, 4, "#26141a");
    v.put(-3, 2, 3, "#4a2a2d");
    v.put(2, 2, 3, "#4a2a2d");
  } else if (role === "critic") {
    // Tactile analyzer monocle over sharp brows + smirk
    v.box(-3, 6, 3, -1, 7, 4, "#181a20");
    v.box(1, 6, 3, 3, 7, 4, "#181a20");
    v.box(-3, 4, 3, -2, 6, 4, "#ffffff");
    v.box(-2, 4, 3, -1, 6, 4, "#12141c");
    v.box(1, 4, 4, 4, 6, 5, theme.visor, 1.1); // glowing analyzer monocle lens
    v.box(-2, 1, 3, 2, 2, 4, "#26141a");
  } else if (role === "memory") {
    // Expressive eyes + round scholar spectacles + gentle smile
    v.box(-3, 4, 3, -2, 6, 4, "#ffffff");
    v.box(-2, 4, 3, -1, 6, 4, "#12141c");
    v.box(1, 4, 3, 2, 6, 4, "#12141c");
    v.box(2, 4, 3, 3, 6, 4, "#ffffff");
    v.box(-4, 6, 4, -1, 7, 5, "#d9a74a");
    v.box(1, 6, 4, 4, 7, 5, "#d9a74a");
    v.box(-1, 5, 4, 1, 6, 5, "#d9a74a");
    v.box(-2, 1, 3, 2, 2, 4, "#26141a");
  } else {
    // Bright cheerful 2x2 eyes + brows + warm smile
    v.box(-3, 6, 3, -1, 7, 4, theme.hair);
    v.box(1, 6, 3, 3, 7, 4, theme.hair);
    v.box(-3, 4, 3, -2, 6, 4, "#ffffff");
    v.box(-2, 4, 3, -1, 6, 4, "#12141c");
    v.box(1, 4, 3, 2, 6, 4, "#12141c");
    v.box(2, 4, 3, 3, 6, 4, "#ffffff");
    v.box(-2, 1, 3, 2, 2, 4, "#26141a");
    v.put(-3, 2, 3, "#4a2a2d");
    v.put(2, 2, 3, "#4a2a2d");
  }

  return v;
}

function sculptHermesArmVox(theme, isLeft) {
  const v = new Vox(isLeft ? 503 : 509);
  const x0 = isLeft ? -1 : -2;
  const x1 = isLeft ? 2 : 1;
  // Sleeve + trim cuff + tactical glove
  v.box(x0, -5, -1, x1, 1, 2, theme.coat);
  v.box(x0, -6, -1, x1, -5, 2, theme.trim);
  v.box(x0, -8, -1, x1, -6, 2, "#232730");
  return v;
}

function sculptHermesLegVox(theme, isLead) {
  const v = new Vox(607);
  // Articulated pants + cuffed knee/boot top + sturdy boot sole
  v.box(-1, -5, -2, 2, 0, 2, theme.pants);
  v.box(-1, -1, -2, 2, 0, 2, "#1c1f26");
  v.box(-1, -7, -2, 2, -5, 3, theme.boots);
  v.put(0, -6, 2, theme.trim);
  v.box(-1, -8, -2, 2, -7, 4, isLead ? theme.trim : "#3b4048");
  return v;
}

function sculptRolePropVox(role, theme) {
  const propVox = new Vox(410 + role.length * 17);
  if (role === "researcher") {
    propVox.box(-1, 0, 0, 1, 2, 0, theme.trim);
    propVox.put(0, 1, 0, theme.accent, 0.9);
    propVox.put(0, -1, 0, "#3b4048");
  } else if (role === "coder") {
    propVox.box(-1, 0, 0, -1, 2, 0, theme.accent, 0.9);
    propVox.box(1, 0, 0, 1, 1, 0, theme.trim, 0.9);
  } else if (role === "critic") {
    propVox.box(-1, 0, -1, 1, 0, 1, theme.trim);
    propVox.put(0, 1, 0, theme.accent, 0.95);
    propVox.put(0, -1, 0, theme.accent, 0.95);
  } else if (role === "memory") {
    propVox.box(-1, 0, -1, 1, 1, 1, "#6e4328");
    propVox.put(0, 1, 1, theme.accent, 0.95);
  } else if (role === "architect" || role === "sculptor") {
    propVox.box(-1, 0, -1, 1, 0, 1, theme.trim);
    propVox.put(0, 1, 0, theme.accent, 0.95);
  } else {
    propVox.box(-1, 0, 0, 1, 0, 0, theme.trim);
    propVox.box(0, -1, 0, 0, 1, 0, theme.trim);
    propVox.put(0, 0, 0, theme.accent, 0.95);
  }
  return propVox;
}

function getHermesRigProto(role, isLead) {
  const key = `${role}:${isLead ? 1 : 0}`;
  let cached = HERMES_RIG_PROTO_CACHE.get(key);
  if (cached) return cached;

  const theme = ROLE_THEMES[role] || ROLE_THEMES.tool_runner;
  const s = isLead ? 0.168 : 0.145;
  const vs = s * 0.5;

  const torsoMesh = buildVoxelMesh(sculptHermesTorsoVox(role, theme, isLead), {
    scale: vs,
    depthLayer: 0,
    castShadow: true,
  });
  const headMesh = buildVoxelMesh(sculptHermesHeadVox(role, theme, isLead), {
    scale: vs,
    depthLayer: 1,
    castShadow: true,
  });
  const leftArmMesh = buildVoxelMesh(sculptHermesArmVox(theme, true), {
    scale: vs,
    depthLayer: 3,
    castShadow: false,
  });
  const rightArmMesh = buildVoxelMesh(sculptHermesArmVox(theme, false), {
    scale: vs,
    depthLayer: 3,
    castShadow: false,
  });
  const legMesh = buildVoxelMesh(sculptHermesLegVox(theme, isLead), {
    scale: vs,
    depthLayer: 2,
    castShadow: false,
  });
  const rolePropMesh = buildVoxelMesh(sculptRolePropVox(role, theme), {
    scale: 0.085,
    depthLayer: 4,
    castShadow: false,
  });

  cached = { s, theme, torsoMesh, headMesh, leftArmMesh, rightArmMesh, legMesh, rolePropMesh };
  HERMES_RIG_PROTO_CACHE.set(key, cached);
  return cached;
}

function cloneSharedPart(protoMesh) {
  const m = protoMesh.clone();
  m.userData.sharedProto = true;
  return m;
}

function buildHermesVoxelRig(agentId, role, isLead) {
  const proto = getHermesRigProto(role, isLead);
  const { s, theme } = proto;

  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  // 1. Torso
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 4.0 * s, 0);
  const torsoMesh = cloneSharedPart(proto.torsoMesh);
  torsoMesh.position.set(0, 0, -0.25 * s);
  torsoPivot.add(torsoMesh);
  bodyPivot.add(torsoPivot);

  // 2. Sculpted Micro-Voxel Head
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 9.2 * s, 0);
  headPivot.add(cloneSharedPart(proto.headMesh));
  bodyPivot.add(headPivot);

  // 3. Legs
  const leftLeg = new THREE.Group();
  leftLeg.position.set(1.12 * s, 4.1 * s, 0);
  const lLegM = cloneSharedPart(proto.legMesh);
  lLegM.position.set(-0.25 * s, -0.1 * s, 0);
  leftLeg.add(lLegM);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(-1.12 * s, 4.1 * s, 0);
  const rLegM = cloneSharedPart(proto.legMesh);
  rLegM.position.set(-0.25 * s, -0.1 * s, 0);
  rightLeg.add(rLegM);
  bodyPivot.add(leftLeg, rightLeg);

  // 4. Arms
  const leftArm = new THREE.Group();
  leftArm.position.set(2.35 * s, 8.7 * s, 0);
  const lArmM = cloneSharedPart(proto.leftArmMesh);
  lArmM.position.set(0.18 * s, 0, -0.25 * s);
  leftArm.add(lArmM);

  const rightArm = new THREE.Group();
  rightArm.position.set(-2.35 * s, 8.7 * s, 0);
  const rArmM = cloneSharedPart(proto.rightArmMesh);
  rArmM.position.set(-0.18 * s, 0, -0.25 * s);
  rightArm.add(rArmM);
  bodyPivot.add(leftArm, rightArm);

  // 5. Floating holographic data tablet (visible when thinking/executing/delegating)
  const slateGeo = new THREE.BoxGeometry(0.44, 0.3, 0.045);
  const slateMat = new THREE.MeshStandardMaterial({
    color: theme.accentHex,
    emissive: theme.accentHex,
    emissiveIntensity: 0.72,
    roughness: 0.28,
    metalness: 0.25,
    transparent: true,
    opacity: 0.86,
  });
  const slateMesh = new THREE.Mesh(slateGeo, slateMat);
  slateMesh.position.set(0, 1.05, 0.64);
  slateMesh.rotation.x = -0.35;
  slateMesh.visible = false;
  root.add(slateMesh);

  // 6. Role-specific floating voxel gadget prop (shared proto mesh)
  const roleProp = new THREE.Group();
  roleProp.add(cloneSharedPart(proto.rolePropMesh));
  roleProp.position.set(0.58, 1.18, 0.35);
  roleProp.visible = false;
  root.add(roleProp);

  // 7. Status beacon octahedron above helm
  const beaconGeo = new THREE.OctahedronGeometry(isLead ? 0.16 : 0.125, 0);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: STATUS_COLORS.standby,
    emissive: STATUS_COLORS.standby,
    emissiveIntensity: 0.55,
    roughness: 0.24,
    metalness: 0.35,
  });
  const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
  beaconMesh.position.set(0, isLead ? 2.75 : 2.35, 0);
  root.add(beaconMesh);

  // 8. Ground tactical ring (lead, active workers, or selected)
  const ringGeo = new THREE.RingGeometry(isLead ? 0.68 : 0.52, isLead ? 0.86 : 0.65, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: isLead ? 0xf4c44e : theme.accentHex,
    transparent: true,
    opacity: isLead ? 0.55 : 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.055;
  root.add(ringMesh);

  // 9. Field workbench pad for top-level active task leads
  const benchGeo = new THREE.RingGeometry(0.95, 1.08, 6);
  benchGeo.rotateX(-Math.PI / 2);
  const benchMat = new THREE.MeshBasicMaterial({
    color: 0xf4c44e,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const benchMesh = new THREE.Mesh(benchGeo, benchMat);
  benchMesh.position.y = 0.048;
  benchMesh.visible = false;
  root.add(benchMesh);

  // 10. Floating 3D task speech banner sprite
  const spriteMat = new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const bannerSprite = new THREE.Sprite(spriteMat);
  bannerSprite.position.set(0, isLead ? 3.65 : 3.15, 0);
  bannerSprite.scale.set(2.55, 0.64, 1);
  bannerSprite.visible = false;
  bannerSprite.raycast = () => {};
  root.add(bannerSprite);

  // 11. Pre-allocated celebration confetti burst cubes sharing global geometries + materials
  const celebrateGroup = new THREE.Group();
  celebrateGroup.visible = false;
  const confetti = [];
  for (let i = 0; i < CONFETTI_HEX.length; i++) {
    const cMesh = new THREE.Mesh(SHARED_CONFETTI_GEO, SHARED_CONFETTI_MATS[i]);
    cMesh.raycast = () => {};
    celebrateGroup.add(cMesh);
    const angle = (i / CONFETTI_HEX.length) * Math.PI * 2 + 0.3;
    confetti.push({
      mesh: cMesh,
      vx: Math.cos(angle) * (1.1 + (i % 3) * 0.32),
      vy: 2.9 + (i % 2) * 0.85,
      vz: Math.sin(angle) * (1.1 + (i % 3) * 0.32),
    });
  }
  root.add(celebrateGroup);

  tagHermesTree(root, agentId);

  return {
    root,
    bodyPivot,
    headPivot,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    slateMesh,
    roleProp,
    beaconMesh,
    beaconMat,
    ringMesh,
    ringMat,
    benchMesh,
    benchMat,
    bannerSprite,
    spriteMat,
    bannerTexture: null,
    celebrateGroup,
    confetti,
    isLead,
    dispose() {
      if (this.bannerTexture) {
        this.bannerTexture.dispose?.();
        this.bannerTexture = null;
      }
      root.traverse((o) => {
        if (o.userData?.sharedProto) return;
        if (o.isMesh || o.isSprite) {
          if (o.geometry && o.geometry !== SHARED_CONFETTI_GEO && o.geometry !== SHARED_PACKET_GEO) {
            o.geometry.dispose?.();
          }
          if (
            o.material === slateMat ||
            o.material === beaconMat ||
            o.material === ringMat ||
            o.material === benchMat ||
            o.material === spriteMat
          ) {
            o.material.dispose?.();
          }
        }
      });
    },
  };
}

export class HermesSwarmManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "HermesSwarmGroup";
    this.scene.add(this.group);

    this.agents = new Map();
    this.latestSnapshot = null;
    this.selectedAgentId = null;

    // Plaza Pad Marker under Hermes Central Plaza (0, -13.5)
    const padGeo = new THREE.RingGeometry(1.45, 1.72, 32);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshBasicMaterial({
      color: 0xf4c44e,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.plazaPad = new THREE.Mesh(padGeo, padMat);
    this.plazaPad.position.set(0, 0.045, -13.5);
    this.plazaPad.raycast = () => {};
    this.group.add(this.plazaPad);
  }

  ensureEntity(agentData, isLead) {
    let entry = this.agents.get(agentData.id);
    if (entry) {
      if (entry.role !== agentData.role) {
        this.group.remove(entry.rig.root);
        entry.rig.dispose();
        entry.rig = buildHermesVoxelRig(agentData.id, agentData.role, isLead);
        entry.rig.root.position.set(entry.x, 0, entry.z);
        this.group.add(entry.rig.root);
        entry.role = agentData.role;
        entry.bannerKey = "";
      }
      return entry;
    }

    const rig = buildHermesVoxelRig(agentData.id, agentData.role, isLead);
    const startX = typeof agentData.x === "number" ? agentData.x : 0;
    const startZ = typeof agentData.z === "number" ? agentData.z : -13.5;
    rig.root.position.set(startX, 0, startZ);
    this.group.add(rig.root);

    let tetherLine = null;
    let tetherPositions = null;
    let packetOut = null;
    let packetIn = null;
    if (!isLead) {
      tetherPositions = new Float32Array(ARC_POINTS * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(tetherPositions, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x64f5df,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
      });
      tetherLine = new THREE.Line(lineGeo, lineMat);
      tetherLine.visible = false;
      tetherLine.frustumCulled = false;
      tetherLine.raycast = () => {};
      this.group.add(tetherLine);

      const pOutMat = new THREE.MeshBasicMaterial({ color: 0x64f5df });
      packetOut = new THREE.Mesh(SHARED_PACKET_GEO, pOutMat);
      packetOut.visible = false;
      packetOut.raycast = () => {};
      this.group.add(packetOut);

      const pInMat = new THREE.MeshBasicMaterial({ color: 0xf4c44e });
      packetIn = new THREE.Mesh(SHARED_PACKET_GEO, pInMat);
      packetIn.visible = false;
      packetIn.raycast = () => {};
      this.group.add(packetIn);
    }

    const shadowMeshes = [];
    rig.root.traverse((o) => {
      if (o.isMesh && o.castShadow) shadowMeshes.push(o);
    });

    entry = {
      id: agentData.id,
      name: agentData.name,
      role: agentData.role,
      isLead,
      parentId: agentData.parentId || "hermes-prime",
      status: agentData.status || "standby",
      prevStatus: agentData.status || "standby",
      celebrateTimer: 0,
      task: agentData.task || agentData.currentTask || "",
      tool: agentData.tool || "",
      progress: Number(agentData.progress || 0),
      source: agentData.source || "island_runtime",
      output: agentData.output || "",
      stationLabel: agentData.stationLabel || "Hermes Central Plaza",
      x: startX,
      z: startZ,
      targetX: typeof agentData.targetX === "number" ? agentData.targetX : startX,
      targetZ: typeof agentData.targetZ === "number" ? agentData.targetZ : startZ,
      yaw: 0,
      walkPhase: Math.random() * Math.PI * 2,
      bannerKey: "",
      rig,
      tetherLine,
      tetherPositions,
      packetOut,
      packetIn,
      shadowMeshes,
      shadowEnabled: true,
      lodAccumDt: 0,
      lodIndex: this.agents.size,
      raw: agentData,
    };

    this.agents.set(agentData.id, entry);
    return entry;
  }

  applyState(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    this.latestSnapshot = snapshot;
    const seenIds = new Set();

    if (snapshot.leadAgent) {
      const lead = snapshot.leadAgent;
      seenIds.add(lead.id);
      const entry = this.ensureEntity(
        {
          ...lead,
          role: "orchestrator",
          x: 0,
          z: -13.5,
          targetX: 0,
          targetZ: -13.5,
          task: lead.currentTask,
          stationLabel: "Hermes Central Plaza",
        },
        true,
      );
      entry.name = lead.name;
      if (entry.status !== "completed" && lead.status === "completed") {
        entry.celebrateTimer = 1.75;
      }
      entry.prevStatus = entry.status;
      entry.status = lead.status;
      entry.task = lead.currentTask;
      entry.raw = {
        ...lead,
        role: "orchestrator",
        task: lead.currentTask,
        stationLabel: "Hermes Central Plaza",
        isLead: true,
      };
    }

    const subs = Array.isArray(snapshot.subAgents) ? snapshot.subAgents : [];
    for (const sub of subs) {
      if (!sub || !sub.id) continue;
      seenIds.add(sub.id);
      const entry = this.ensureEntity(sub, false);
      entry.name = sub.name;
      if (entry.status !== "completed" && sub.status === "completed") {
        entry.celebrateTimer = 1.75;
      }
      entry.prevStatus = entry.status;
      entry.status = sub.status;
      entry.parentId = sub.parentId || "hermes-prime";
      entry.task = sub.task;
      entry.tool = sub.tool;
      entry.progress = Number(sub.progress || 0);
      entry.source = sub.source;
      entry.output = sub.output || "";
      entry.stationLabel = sub.stationLabel || "Island Station";
      entry.targetX = typeof sub.targetX === "number" ? sub.targetX : entry.targetX;
      entry.targetZ = typeof sub.targetZ === "number" ? sub.targetZ : entry.targetZ;
      entry.raw = { ...sub, isLead: false };
    }

    for (const [id, entry] of this.agents.entries()) {
      if (!seenIds.has(id)) {
        this.group.remove(entry.rig.root);
        if (entry.tetherLine) {
          this.group.remove(entry.tetherLine);
          entry.tetherLine.geometry?.dispose?.();
          entry.tetherLine.material?.dispose?.();
        }
        if (entry.packetOut) {
          this.group.remove(entry.packetOut);
          entry.packetOut.material?.dispose?.();
        }
        if (entry.packetIn) {
          this.group.remove(entry.packetIn);
          entry.packetIn.material?.dispose?.();
        }
        entry.rig.dispose();
        this.agents.delete(id);
      }
    }
  }

  setSelectedAgent(id) {
    this.selectedAgentId = id || null;
  }

  step(dt, t, ponds = [], lodCtx = null) {
    const baseDt = Math.min(0.08, Math.max(0.001, dt));
    const leadEntry = this.agents.get("hermes-prime");
    if (leadEntry) {
      this.plazaPad.rotation.z = t * 0.18;
    }

    let helperSlotIndex = 0;

    for (const entry of this.agents.values()) {
      const { rig } = entry;
      const isActive =
        entry.status === "thinking" ||
        entry.status === "executing" ||
        entry.status === "delegating";

      let stepDt = baseDt;
      if (lodCtx) {
        const dxF = entry.x - lodCtx.focusX;
        const dzF = entry.z - lodCtx.focusZ;
        const dSq = dxF * dxF + dzF * dzF;
        const castShadowNow =
          entry.isLead ||
          entry.id === lodCtx.followingAgentId ||
          dSq <= lodCtx.shadowCullSq;
        if (entry.shadowEnabled !== castShadowNow) {
          entry.shadowEnabled = castShadowNow;
          for (let si = 0; si < entry.shadowMeshes.length; si++) {
            entry.shadowMeshes[si].castShadow = castShadowNow;
          }
        }
        if (
          !entry.isLead &&
          !isActive &&
          entry.celebrateTimer <= 0 &&
          entry.id !== this.selectedAgentId &&
          entry.id !== lodCtx.followingAgentId &&
          dSq > lodCtx.farLodSq
        ) {
          entry.lodAccumDt += baseDt;
          if ((lodCtx.frameTick + entry.lodIndex) % 3 !== 0) {
            continue;
          }
          stepDt = Math.min(0.12, entry.lodAccumDt);
          entry.lodAccumDt = 0;
        } else if (entry.lodAccumDt > 0) {
          stepDt = Math.min(0.12, baseDt + entry.lodAccumDt);
          entry.lodAccumDt = 0;
        }
      }
      const safeDt = stepDt;

      const parentEntry =
        !entry.isLead && entry.parentId && entry.parentId !== entry.id
          ? this.agents.get(entry.parentId) || leadEntry
          : null;
      const isHelpingNonPrimeParent = Boolean(parentEntry && !parentEntry.isLead);
      const isTeamLead = !entry.isLead && !isHelpingNonPrimeParent;

      let goalX = entry.targetX;
      let goalZ = entry.targetZ;
      if (entry.isLead && entry.status === "standby") {
        goalX = Math.sin(t * 0.26) * 1.3;
        goalZ = -13.5 + Math.cos(t * 0.21) * 1.1;
      } else if (isHelpingNonPrimeParent && isActive && parentEntry) {
        const slotAngle = helperSlotIndex * 2.18 + t * 0.12 + 0.4;
        helperSlotIndex += 1;
        goalX = parentEntry.x + Math.cos(slotAngle) * 2.95;
        goalZ = parentEntry.z + Math.sin(slotAngle) * 2.95;
      } else if (!entry.isLead && entry.status === "standby") {
        const phase = (entry.id.charCodeAt(entry.id.length - 1) || 1) * 0.9;
        goalX = entry.targetX + Math.cos(t * 0.32 + phase) * 1.45;
        goalZ = entry.targetZ + Math.sin(t * 0.28 + phase) * 1.45;
      }

      // Softly avoid ponds using squared-distance early check
      for (let i = 0; i < ponds.length; i++) {
        const p = ponds[i];
        const minR = (p.radius || 6) + 1.6;
        const pdx = goalX - p.x;
        const pdz = goalZ - p.z;
        const dSq = pdx * pdx + pdz * pdz;
        if (dSq < minR * minR && dSq > 0.0001) {
          const pd = Math.sqrt(dSq);
          goalX = p.x + (pdx / pd) * minR;
          goalZ = p.z + (pdz / pd) * minR;
        }
      }

      const dx = goalX - entry.x;
      const dz = goalZ - entry.z;
      const distSq = dx * dx + dz * dz;
      const speed = isActive ? 5.6 : 2.1;
      let movingSpeed = 0;

      if (distSq > 0.0324) {
        const dist = Math.sqrt(distSq);
        const stepDist = Math.min(dist, speed * safeDt);
        entry.x += (dx / dist) * stepDist;
        entry.z += (dz / dist) * stepDist;
        movingSpeed = speed;

        const targetYaw = Math.atan2(dx, dz);
        let diff = targetYaw - entry.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        entry.yaw += diff * Math.min(1, safeDt * 10);
      } else if (isActive && parentEntry) {
        const targetYaw = Math.atan2(parentEntry.x - entry.x, parentEntry.z - entry.z);
        let diff = targetYaw - entry.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        entry.yaw += diff * Math.min(1, safeDt * 6);
      }

      let hopY = 0;
      if (entry.celebrateTimer > 0) {
        entry.celebrateTimer = Math.max(0, entry.celebrateTimer - safeDt);
        const u = 1 - entry.celebrateTimer / 1.75;
        hopY = Math.abs(Math.sin(u * Math.PI * 2)) * 0.42 * (1 - u * 0.35);
        rig.celebrateGroup.visible = true;
        const scaleFade = Math.max(0.01, 1 - u * u);
        const ct = u * 1.55;
        for (let ci = 0; ci < rig.confetti.length; ci++) {
          const cf = rig.confetti[ci];
          cf.mesh.position.set(cf.vx * ct, 1.65 + cf.vy * ct - 2.4 * ct * ct, cf.vz * ct);
          cf.mesh.rotation.set(ct * 4.5, ct * 3.8, ct * 2.5);
          cf.mesh.scale.setScalar(scaleFade);
        }
      } else if (rig.celebrateGroup.visible) {
        rig.celebrateGroup.visible = false;
      }

      rig.root.position.set(entry.x, 0, entry.z);
      rig.root.rotation.y = entry.yaw;

      if (entry.celebrateTimer > 0) {
        rig.leftLeg.rotation.x = 0.15;
        rig.rightLeg.rotation.x = -0.15;
        rig.leftArm.rotation.x = -2.45 + Math.sin(t * 14) * 0.25;
        rig.rightArm.rotation.x = -2.45 - Math.sin(t * 14) * 0.25;
        rig.bodyPivot.position.y = hopY;
        rig.bodyPivot.rotation.x = 0;
      } else if (movingSpeed > 0.2) {
        entry.walkPhase += safeDt * (isActive ? 11.5 : 6.4);
        const swing = Math.sin(entry.walkPhase) * 0.58;
        rig.leftLeg.rotation.x = swing;
        rig.rightLeg.rotation.x = -swing;
        rig.leftArm.rotation.x = -swing * 0.72;
        rig.rightArm.rotation.x = swing * 0.72;
        rig.bodyPivot.position.y = Math.abs(Math.sin(entry.walkPhase)) * 0.055;
        rig.bodyPivot.rotation.x = isActive ? 0.08 : 0.03;
      } else {
        rig.leftLeg.rotation.x *= 0.85;
        rig.rightLeg.rotation.x *= 0.85;
        rig.bodyPivot.rotation.x *= 0.85;
        if (entry.status === "thinking") {
          rig.leftArm.rotation.x = -0.35;
          rig.rightArm.rotation.x = -1.25 + Math.sin(t * 2.6) * 0.14;
          rig.headPivot.rotation.z = Math.sin(t * 2.1) * 0.08;
        } else if (entry.status === "delegating") {
          rig.leftArm.rotation.x = -0.85 + Math.sin(t * 3.4) * 0.28;
          rig.rightArm.rotation.x = -0.85 + Math.cos(t * 3.4) * 0.28;
          rig.headPivot.rotation.z = 0;
        } else if (entry.status === "executing") {
          rig.leftArm.rotation.x = -0.78 + Math.sin(t * 8.5) * 0.22;
          rig.rightArm.rotation.x = -0.78 + Math.cos(t * 8.5) * 0.22;
          rig.headPivot.rotation.z = 0;
        } else {
          rig.leftArm.rotation.x *= 0.88;
          rig.rightArm.rotation.x *= 0.88;
          rig.headPivot.rotation.z *= 0.85;
        }
        rig.bodyPivot.position.y = Math.sin(t * 2.2 + entry.walkPhase) * 0.015;
      }

      rig.headPivot.rotation.y = Math.sin(t * 1.1 + entry.walkPhase) * 0.14;

      const col = STATUS_COLORS[entry.status] || STATUS_COLORS.standby;
      rig.beaconMat.color.setHex(col);
      rig.beaconMat.emissive.setHex(col);
      rig.beaconMat.emissiveIntensity = isActive ? 0.95 + Math.sin(t * 6) * 0.25 : 0.4;
      rig.beaconMesh.rotation.y = t * (isActive ? 2.8 : 0.9);
      rig.beaconMesh.position.y = (entry.isLead ? 2.75 : 2.35) + Math.sin(t * 3 + entry.walkPhase) * 0.06;

      rig.slateMesh.visible = isActive;
      rig.roleProp.visible = isActive;
      if (isActive) {
        rig.slateMesh.position.y = 1.06 + Math.sin(t * 3.8) * 0.05;
        rig.roleProp.position.y = 1.18 + Math.cos(t * 4.4) * 0.07;
        rig.roleProp.rotation.y = t * 2.4;
        rig.roleProp.rotation.z = Math.sin(t * 3.1) * 0.18;
      }

      const showBench = isTeamLead && isActive;
      rig.benchMesh.visible = showBench;
      if (showBench) {
        rig.benchMesh.rotation.y = t * 0.45;
      }

      const showRing = entry.isLead || isActive || entry.id === this.selectedAgentId || entry.celebrateTimer > 0;
      rig.ringMesh.visible = showRing;
      if (showRing) {
        rig.ringMat.color.setHex(entry.id === this.selectedAgentId ? 0xf4c44e : col);
        rig.ringMat.opacity = entry.id === this.selectedAgentId ? 0.72 : isActive ? 0.45 : 0.25;
        rig.ringMesh.scale.setScalar(1 + Math.sin(t * 3.5) * 0.06);
      }

      const showBanner = isActive || entry.id === this.selectedAgentId || entry.celebrateTimer > 0;
      if (showBanner) {
        const helpPrefix = isHelpingNonPrimeParent && parentEntry ? `Helping ${parentEntry.name} · ` : "";
        const toolTag = entry.tool ? `[${entry.tool}] ` : "";
        const subLine = `${helpPrefix}${toolTag}${entry.task || ""}`.trim();
        const key = `${entry.name}|${entry.status}|${Math.round(entry.progress || 0)}|${subLine}|${col}`;
        if (entry.bannerKey !== key) {
          entry.bannerKey = key;
          const oldTex = rig.bannerTexture;
          const nextTex = renderBannerTexture(entry.name, entry.status, entry.progress, subLine, col);
          if (nextTex) {
            rig.bannerTexture = nextTex;
            rig.spriteMat.map = nextTex;
            rig.spriteMat.needsUpdate = true;
            if (oldTex) oldTex.dispose?.();
          }
        }
        rig.bannerSprite.visible = Boolean(rig.bannerTexture);
        rig.bannerSprite.position.y = (entry.isLead ? 3.65 : 3.15) + Math.sin(t * 2.4 + entry.walkPhase) * 0.04;
      } else {
        rig.bannerSprite.visible = false;
      }

      if (entry.tetherLine && entry.tetherPositions && parentEntry) {
        if (isActive) {
          const p0x = entry.x;
          const p0y = 1.32;
          const p0z = entry.z;
          const p2x = parentEntry.x;
          const p2y = parentEntry.isLead ? 1.55 : 1.38;
          const p2z = parentEntry.z;
          const arcDist = Math.hypot(p2x - p0x, p2z - p0z);
          const p1x = (p0x + p2x) * 0.5;
          const p1y = Math.max(2.15, 1.65 + arcDist * 0.12);
          const p1z = (p0z + p2z) * 0.5;

          const posArr = entry.tetherPositions;
          for (let k = 0; k < ARC_POINTS; k++) {
            const u = k / (ARC_POINTS - 1);
            const inv = 1 - u;
            const b0 = inv * inv;
            const b1 = 2 * inv * u;
            const b2 = u * u;
            const idx = k * 3;
            posArr[idx] = b0 * p0x + b1 * p1x + b2 * p2x;
            posArr[idx + 1] = b0 * p0y + b1 * p1y + b2 * p2y;
            posArr[idx + 2] = b0 * p0z + b1 * p1z + b2 * p2z;
          }

          entry.tetherLine.geometry.attributes.position.needsUpdate = true;
          entry.tetherLine.material.color.setHex(col);
          entry.tetherLine.visible = true;

          if (entry.packetOut) {
            const uOut = ((t * 0.85 + entry.walkPhase) % 1 + 1) % 1;
            const invO = 1 - uOut;
            entry.packetOut.position.set(
              invO * invO * p0x + 2 * invO * uOut * p1x + uOut * uOut * p2x,
              invO * invO * p0y + 2 * invO * uOut * p1y + uOut * uOut * p2y,
              invO * invO * p0z + 2 * invO * uOut * p1z + uOut * uOut * p2z,
            );
            entry.packetOut.rotation.set(t * 4, t * 5, 0);
            entry.packetOut.material.color.setHex(col);
            entry.packetOut.visible = true;
          }

          if (entry.packetIn) {
            const uIn = 1 - (((t * 0.65 + entry.walkPhase + 0.45) % 1 + 1) % 1);
            const invI = 1 - uIn;
            entry.packetIn.position.set(
              invI * invI * p0x + 2 * invI * uIn * p1x + uIn * uIn * p2x,
              invI * invI * p0y + 2 * invI * uIn * p1y + uIn * uIn * p2y,
              invI * invI * p0z + 2 * invI * uIn * p1z + uIn * uIn * p2z,
            );
            entry.packetIn.rotation.set(-t * 3.5, t * 4.5, 0);
            entry.packetIn.visible = true;
          }
        } else {
          entry.tetherLine.visible = false;
          if (entry.packetOut) entry.packetOut.visible = false;
          if (entry.packetIn) entry.packetIn.visible = false;
        }
      }
    }
  }

  getAgentPosition(id) {
    const entry = this.agents.get(id);
    if (!entry) return null;
    return { x: entry.x, z: entry.z, entry };
  }

  pickAtGround(gx, gz) {
    let best = null;
    let bestSq = 2.1 * 2.1;
    for (const entry of this.agents.values()) {
      const dx = entry.x - gx;
      const dz = entry.z - gz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = entry;
      }
    }
    return best ? best.raw : null;
  }

  pickAtRaycaster(raycaster) {
    const candidates = [];
    for (const entry of this.agents.values()) {
      candidates.push(entry.rig.root);
    }
    if (candidates.length === 0) return null;
    const hits = raycaster.intersectObjects(candidates, true);
    for (const hit of hits) {
      const aid = hit.object?.userData?.hermesAgentId;
      if (aid && this.agents.has(aid)) {
        return this.agents.get(aid).raw;
      }
    }
    return null;
  }

  dispose() {
    for (const entry of this.agents.values()) {
      this.group.remove(entry.rig.root);
      if (entry.tetherLine) {
        this.group.remove(entry.tetherLine);
        entry.tetherLine.geometry?.dispose?.();
        entry.tetherLine.material?.dispose?.();
      }
      if (entry.packetOut) {
        this.group.remove(entry.packetOut);
        entry.packetOut.material?.dispose?.();
      }
      if (entry.packetIn) {
        this.group.remove(entry.packetIn);
        entry.packetIn.material?.dispose?.();
      }
      entry.rig.dispose();
    }
    this.agents.clear();
    this.plazaPad.geometry?.dispose?.();
    this.plazaPad.material?.dispose?.();
    this.scene.remove(this.group);
  }
}

// GeminIsland — In-World 3D Voxel Mini-Games & Interactive Contraptions Engine.
// Pure 3D micro-voxel boards, game pieces, physics arcs, AI opponents, and WebAudio synthesis.
// All invisible raycast hit-boxes live exclusively on Three.js Layer 2 so GTAO / ShadowMap / RenderPass
// never draw phantom shadows or extra draw calls.

import * as THREE from "three";
import { Vox, buildVoxelMesh } from "./vox.js";

export const INTERACTIVE_HIT_LAYER = 2;

// ─── Procedural WebAudio Micro-Synth (unlocked only on user gesture) ──────────
let audioCtx = null;

function ensureAudio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq = 440, dur = 0.14, type = "triangle", gainPeak = 0.075, delaySec = 0) {
  if (!audioCtx || audioCtx.state !== "running") return;
  try {
    const t0 = audioCtx.currentTime + delaySec;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, freq), t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    // Ignore audio context edge errors
  }
}

function playArpeggio(freqs, stepSec = 0.075, dur = 0.18, type = "triangle", gainPeak = 0.07) {
  freqs.forEach((f, idx) => playTone(f, dur, type, gainPeak, idx * stepSec));
}

function playBurstNoise(dur = 0.16, gainPeak = 0.055, delaySec = 0) {
  if (!audioCtx || audioCtx.state !== "running") return;
  try {
    const sr = audioCtx.sampleRate;
    const len = Math.max(256, Math.floor(sr * dur));
    const buf = audioCtx.createBuffer(1, len, sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * 3.2);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const gain = audioCtx.createGain();
    const t0 = audioCtx.currentTime + delaySec;
    gain.gain.setValueAtTime(gainPeak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start(t0);
  } catch {
    // Ignore
  }
}

// ─── Shared Invisible Raycast Hit Material (Layer 2 Only) ────────────────────
const sharedHitMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

function makeHitBox(w, h, d, creationId, action) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, sharedHitMat);
  mesh.layers.set(INTERACTIVE_HIT_LAYER);
  mesh.userData = { creationId, interactiveAction: action };
  return mesh;
}

// ─── Reusable Voxel Piece Builders ───────────────────────────────────────────
function buildVoxelHoverBracket(spanMeters = 0.54, color = "#ffe57f") {
  const s = 0.065;
  const half = Math.max(2, Math.round((spanMeters * 0.5) / s));
  const v = new Vox(901);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx > 0 ? half - 1 : -half;
      const cz = sz > 0 ? half - 1 : -half;
      v.put(cx, 0, cz, color, 1.5);
      v.put(cx - sx, 0, cz, color, 1.3);
      v.put(cx, 0, cz - sz, color, 1.3);
    }
  }
  return buildVoxelMesh(v, { scale: s, castShadow: false, depthLayer: 5 });
}

function inspectCenterDeckSurface(group, maxOpenHeightVox = 6) {
  const hasCenterVox = group.userData?.hasCenterVox;
  const voxScale = group.userData?.voxScale || 0.23;
  const b = group.userData?.baseBounds || { minX: -6, maxX: 6, minY: 0, maxY: 8, minZ: -6, maxZ: 6 };
  if (typeof hasCenterVox !== "function") {
    return { onCenterTop: false, yMeters: 0.01, frontZMeters: 1.8, maxYMeters: 2.0, voxScale, bounds: b };
  }

  // Scan [-3..3] x [-3..3] to see if the creation is an open-sky table/mat with no roof overhead
  let filledColumns = 0;
  let maxCentralY = 0;
  let minCentralTop = Infinity;
  let hasOverheadRoof = false;

  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      let colTop = -1;
      for (let y = 0; y <= maxOpenHeightVox; y++) {
        if (hasCenterVox(x, y, z)) colTop = y + 1;
      }
      for (let y = maxOpenHeightVox + 1; y <= Math.min(64, b.maxY + 1); y++) {
        if (hasCenterVox(x, y, z)) {
          hasOverheadRoof = true;
          break;
        }
      }
      if (colTop > 0) {
        filledColumns++;
        if (colTop > maxCentralY) maxCentralY = colTop;
        if (colTop < minCentralTop) minCentralTop = colTop;
      }
    }
  }

  const flatEnough =
    !hasOverheadRoof &&
    filledColumns >= 28 &&
    maxCentralY >= 1 &&
    maxCentralY <= maxOpenHeightVox &&
    maxCentralY - minCentralTop <= 2;

  return {
    onCenterTop: flatEnough,
    yMeters: flatEnough ? maxCentralY * voxScale + 0.006 : 0.008,
    frontZMeters: Math.max(0.9, b.maxZ * voxScale),
    maxYMeters: Math.max(1.2, b.maxY * voxScale),
    voxScale,
    bounds: b,
  };
}

function buildApronPedestalMesh(halfSpanX, halfSpanZ, heightVox = 3, topCol = "limestone", baseCol = "woodDark") {
  const s = 0.11;
  const hx = Math.max(4, Math.round(halfSpanX / s));
  const hz = Math.max(4, Math.round(halfSpanZ / s));
  const v = new Vox(913);
  v.box(-hx, 0, -hz, hx, Math.max(1, heightVox - 1), hz, baseCol);
  v.box(-hx - 1, Math.max(1, heightVox - 1), -hz - 1, hx + 1, heightVox, hz + 1, topCol);
  return {
    mesh: buildVoxelMesh(v, { scale: s, depthLayer: 2 }),
    topY: heightVox * s + 0.005,
  };
}

function buildTallyPipMesh(color, emit = 1.2) {
  const v = new Vox(919);
  v.box(-1, 0, -1, 1, 2, 1, color, emit);
  return buildVoxelMesh(v, { scale: 0.055, depthLayer: 4 });
}

// ─── Live Hermes Park AI Opponent Client (/api/minigame-move) ─────────────
async function requestAgentMove(payload, fallbackValidMoves) {
  const minBeat = new Promise((r) => setTimeout(r, 260));
  if (typeof fetch !== "function" || typeof window === "undefined") {
    await minBeat;
    return {
      move: fallbackValidMoves[Math.floor(fallbackValidMoves.length / 2)] ?? fallbackValidMoves[0] ?? -1,
      quip: "",
      modelUsed: "offline",
    };
  }
  try {
    const [res] = await Promise.all([
      fetch("/api/minigame-move", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-meadow-client": "1",
          ...(typeof window.__geminIslandVisitorHeaders === "function"
            ? window.__geminIslandVisitorHeaders()
            : {}),
        },
        body: JSON.stringify(payload),
      }),
      minBeat,
    ]);
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && fallbackValidMoves.includes(data.move)) {
        return {
          move: data.move,
          quip: typeof data.quip === "string" ? data.quip.trim() : "",
          modelUsed: data.modelUsed || "hermes-agent",
        };
      }
    }
  } catch {
    // Graceful network hiccup fallback so the 3D board never locks up
  }
  return {
    move: fallbackValidMoves[Math.floor(fallbackValidMoves.length / 2)] ?? fallbackValidMoves[0] ?? -1,
    quip: "",
    modelUsed: "fallback",
  };
}

// ─── 1. Naughts & Crosses (Tic-Tac-Toe) vs Hermes Park AI ─────────────────
const TTT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function checkTttWinner(board) {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (board[a] !== 0 && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((v) => v !== 0)) return { winner: 3, line: null }; // draw
  return null;
}

function createTicTacToeController(creation, group, onEvent) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 6);
  const cellStep = 0.56;
  let deckY = surf.yMeters;
  let extraRadius = 0;

  if (!surf.onCenterTop) {
    const ped = buildApronPedestalMesh(1.08, 1.08, 3, "limestone", "woodDark");
    root.position.set(0, 0, surf.frontZMeters + 1.28);
    root.add(ped.mesh);
    deckY = ped.topY;
    extraRadius = surf.frontZMeters + 2.4;
  }

  // Crisp 3D Voxel # Grid Bars
  const gridScale = 0.056;
  const gridHalf = Math.round((cellStep * 1.5) / gridScale);
  const barOff = Math.round((cellStep * 0.5) / gridScale);
  const gv = new Vox(931);
  // Subtle recessed dark-slate mat + raised brass/oak grid dividers
  gv.box(-gridHalf - 1, 0, -gridHalf - 1, gridHalf + 1, 1, gridHalf + 1, "#2f3440");
  for (const off of [-barOff, barOff]) {
    gv.box(off - 1, 1, -gridHalf, off + 1, 2, gridHalf, "brass", 0.15);
    gv.box(-gridHalf, 1, off - 1, gridHalf, 2, off + 1, "brass", 0.15);
  }
  const gridMesh = buildVoxelMesh(gv, { scale: gridScale, depthLayer: 3 });
  gridMesh.position.y = deckY;
  root.add(gridMesh);
  const pieceBaseY = deckY + 2 * gridScale + 0.004;

  // Build reusable 3D Voxel X, O, and Gold-Win piece geometries
  const makeX = (col, emit) => {
    const v = new Vox(937);
    for (let k = -3; k <= 3; k++) {
      v.box(k, 0, k, k + 1, 2, k + 1, col, emit);
      v.box(k, 0, -k, k + 1, 2, -k + 1, col, emit);
      if (Math.abs(k) < 3) {
        v.put(k + 1, 0, k, col, emit);
        v.put(k + 1, 0, -k, col, emit);
      }
    }
    return buildVoxelMesh(v, { scale: 0.054, depthLayer: 4 });
  };
  const makeO = (col, emit) => {
    const v = new Vox(941);
    v.ringAxis("y", 0, 0, 0, 2, 3.4, 1.9, col, emit);
    return buildVoxelMesh(v, { scale: 0.054, depthLayer: 4 });
  };

  const protoX = makeX("#ff5a4f", 0.65);
  const protoO = makeO("#4ce8e0", 0.65);
  const protoXWin = makeX("#ffe055", 1.75);
  const protoOWin = makeO("#ffe055", 1.75);

  const hoverBracket = buildVoxelHoverBracket(cellStep * 0.84, "#ffe57f");
  hoverBracket.visible = false;
  root.add(hoverBracket);

  // Thinking orb when CPU is pondering
  const thinkVox = new Vox(947);
  thinkVox.box(-1, 0, -1, 1, 2, 1, "#4ce8e0", 1.6);
  const thinkOrb = buildVoxelMesh(thinkVox, { scale: 0.05, depthLayer: 5 });
  thinkOrb.visible = false;
  root.add(thinkOrb);

  const hitMeshes = [];
  const cellCenters = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cx = (c - 1) * cellStep;
      const cz = (r - 1) * cellStep;
      cellCenters.push([cx, cz]);
      const hb = makeHitBox(cellStep * 0.94, 0.36, cellStep * 0.94, creation.id, { cell: idx });
      hb.position.set(cx, pieceBaseY + 0.12, cz);
      root.add(hb);
      hitMeshes.push(hb);
    }
  }

  const board = new Array(9).fill(0); // 0 empty, 1 player X, 2 cpu O
  const cellHolders = cellCenters.map(([cx, cz]) => {
    const g = new THREE.Group();
    g.position.set(cx, pieceBaseY, cz);
    root.add(g);
    return { group: g, pop: 1, isWin: false };
  });

  const tallyGroup = new THREE.Group();
  root.add(tallyGroup);
  let playerWins = 0;
  let cpuWins = 0;
  let cpuThinking = false;
  let turnToken = 0;
  let disposed = false;
  let gameOver = null; // { winner: 1|2|3, line, age }

  function rebuildTally() {
    while (tallyGroup.children.length) tallyGroup.remove(tallyGroup.children[0]);
    for (let i = 0; i < Math.min(6, playerWins); i++) {
      const pip = buildTallyPipMesh("#ff5a4f", 1.15);
      pip.position.set(-cellStep * 1.75, pieceBaseY + i * 0.12, -cellStep + i * 0.22);
      tallyGroup.add(pip);
    }
    for (let i = 0; i < Math.min(6, cpuWins); i++) {
      const pip = buildTallyPipMesh("#4ce8e0", 1.15);
      pip.position.set(cellStep * 1.75, pieceBaseY + i * 0.12, -cellStep + i * 0.22);
      tallyGroup.add(pip);
    }
  }

  function syncBoardMeshes() {
    const winSet = new Set(gameOver?.line || []);
    for (let i = 0; i < 9; i++) {
      const h = cellHolders[i];
      while (h.group.children.length) h.group.remove(h.group.children[0]);
      const v = board[i];
      if (v === 0) continue;
      const isWin = winSet.has(i);
      h.isWin = isWin;
      const proto = v === 1 ? (isWin ? protoXWin : protoX) : isWin ? protoOWin : protoO;
      const clone = new THREE.Mesh(proto.geometry, proto.material);
      clone.castShadow = true;
      h.group.add(clone);
    }
  }

  function resetBoard() {
    turnToken++;
    board.fill(0);
    gameOver = null;
    cpuThinking = false;
    thinkOrb.visible = false;
    syncBoardMeshes();
  }

  function placeMark(idx, who, quip = "") {
    board[idx] = who;
    cellHolders[idx].pop = 0.05;
    const outcome = checkTttWinner(board);
    if (outcome) {
      gameOver = { ...outcome, age: 0 };
      syncBoardMeshes();
      const quipSuffix = quip ? ` · "${quip}"` : "";
      if (outcome.winner === 1) {
        playerWins++;
        rebuildTally();
        playArpeggio([523.25, 659.25, 783.99, 1046.5], 0.075, 0.22, "triangle", 0.085);
        return `Naughts & Crosses — You beat Hermes Park AI! (${playerWins}–${cpuWins})`;
      } else if (outcome.winner === 2) {
        cpuWins++;
        rebuildTally();
        playArpeggio([440, 392, 329.63], 0.09, 0.22, "sawtooth", 0.055);
        return `Naughts & Crosses — Hermes Park AI wins! (${playerWins}–${cpuWins})${quipSuffix}`;
      } else {
        playArpeggio([440, 523.25, 440], 0.08, 0.18, "triangle", 0.065);
        return `Naughts & Crosses — Draw vs Hermes Park AI!${quipSuffix}`;
      }
    }
    syncBoardMeshes();
    playTone(who === 1 ? 587.33 : 440, 0.11, "triangle", 0.075);
    return quip ? `Hermes Park AI — "${quip}"` : null;
  }

  function askAgentTurn() {
    const empty = [];
    for (let i = 0; i < 9; i++) if (board[i] === 0) empty.push(i);
    if (!empty.length) return;
    const myToken = ++turnToken;
    cpuThinking = true;
    thinkOrb.visible = true;
    requestAgentMove(
      {
        game: "tic_tac_toe",
        board: [...board],
        creationName: creation.name,
      },
      empty,
    ).then((reply) => {
      if (disposed || myToken !== turnToken || gameOver) return;
      cpuThinking = false;
      thinkOrb.visible = false;
      if (reply.move >= 0 && board[reply.move] === 0) {
        const aiMsg = placeMark(reply.move, 2, reply.quip);
        if (aiMsg) onEvent?.(aiMsg);
      }
    });
  }

  return {
    kind: "tic_tac_toe",
    hitMeshes,
    extraRadius,
    setHovered(action) {
      const idx = action?.cell;
      if (
        !cpuThinking &&
        typeof idx === "number" &&
        idx >= 0 &&
        idx < 9 &&
        (board[idx] === 0 || gameOver)
      ) {
        const [cx, cz] = cellCenters[idx];
        hoverBracket.position.set(cx, pieceBaseY + 0.02, cz);
        hoverBracket.visible = true;
      } else {
        hoverBracket.visible = false;
      }
    },
    trigger(action) {
      ensureAudio();
      const idx = typeof action?.cell === "number" ? action.cell : -1;
      if (gameOver) {
        if (gameOver.age < 0.45) return null;
        resetBoard();
        if (idx >= 0 && idx < 9) {
          const msg = placeMark(idx, 1);
          if (!gameOver) askAgentTurn();
          return msg;
        }
        return null;
      }
      if (cpuThinking) return null;
      if (idx < 0 || idx >= 9 || board[idx] !== 0) return null;
      const msg = placeMark(idx, 1);
      if (!gameOver) askAgentTurn();
      return msg;
    },
    step(dt, t) {
      if (hoverBracket.visible) {
        hoverBracket.position.y = pieceBaseY + 0.025 + Math.sin(t * 6.0) * 0.015;
      }
      if (cpuThinking) {
        thinkOrb.position.set(0, pieceBaseY + 0.36 + Math.sin(t * 10) * 0.05, -cellStep * 1.55);
        thinkOrb.rotation.y = t * 4.5;
      }
      if (gameOver) {
        gameOver.age += dt;
      }
      for (let i = 0; i < 9; i++) {
        const h = cellHolders[i];
        if (h.pop < 1) {
          h.pop = Math.min(1, h.pop + dt * 6.5);
          const s = h.pop < 0.7 ? (h.pop / 0.7) * 1.18 : 1.18 - ((h.pop - 0.7) / 0.3) * 0.18;
          h.group.scale.setScalar(s);
        } else {
          h.group.scale.setScalar(1);
        }
        if (h.isWin && gameOver) {
          h.group.position.y = pieceBaseY + Math.abs(Math.sin(t * 5.2 + i * 0.7)) * 0.09;
        } else {
          h.group.position.y = pieceBaseY;
        }
      }
    },
    dispose() {
      disposed = true;
      turnToken++;
      protoX.geometry.dispose();
      protoO.geometry.dispose();
      protoXWin.geometry.dispose();
      protoOWin.geometry.dispose();
      gridMesh.geometry.dispose();
      hoverBracket.geometry.dispose();
      thinkOrb.geometry.dispose();
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 2. Connect Four (7x6 Vertical Drop Frame vs Hermes Park AI) ──────────
function checkConnectFourWin(grid) {
  // grid[col][row], 7 cols x 6 rows (row 0 = bottom)
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let c = 0; c < 7; c++) {
    for (let r = 0; r < 6; r++) {
      const who = grid[c][r];
      if (!who) continue;
      for (const [dc, dr] of dirs) {
        const cells = [[c, r]];
        for (let k = 1; k < 4; k++) {
          const nc = c + dc * k;
          const nr = r + dr * k;
          if (nc < 0 || nc >= 7 || nr < 0 || nr >= 6 || grid[nc][nr] !== who) break;
          cells.push([nc, nr]);
        }
        if (cells.length === 4) return { winner: who, cells };
      }
    }
  }
  const full = grid.every((col) => col[5] !== 0);
  return full ? { winner: 3, cells: [] } : null;
}

function createConnectFourController(creation, group, onEvent) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 4);
  const voxS = 0.068;
  // Each cell is 4 voxels wide, 4 voxels tall
  // 7 cols => 28 + 2 side posts = 30 voxels wide (~2.04m)
  // 6 rows => 24 + 2 bottom/top rails = 26 voxels tall (~1.77m)
  let baseY = surf.onCenterTop ? surf.yMeters : 0.01;
  let extraRadius = 0;
  if (!surf.onCenterTop) {
    root.position.set(0, 0, surf.frontZMeters + 0.85);
    extraRadius = surf.frontZMeters + 1.5;
  }

  const fv = new Vox(953);
  // Brass side feet
  fv.box(-16, 0, -3, -13, 2, 3, "brass");
  fv.box(13, 0, -3, 16, 2, 3, "brass");
  // Slotted royal-blue upright frame with open 2x2 windows per cell so discs show front & back!
  fv.box(-15, 1, -1, 15, 27, 1, "#2f5696");
  for (let c = 0; c < 7; c++) {
    const x0 = -14 + c * 4 + 1;
    for (let r = 0; r < 6; r++) {
      const y0 = 2 + r * 4 + 1;
      fv.clear(x0, y0, -2, x0 + 2, y0 + 2, 2);
    }
  }
  // Open top slot channel
  fv.box(-16, 1, -2, -14, 28, 2, "brass");
  fv.box(14, 1, -2, 16, 28, 2, "brass");
  const frameMesh = buildVoxelMesh(fv, { scale: voxS, depthLayer: 3 });
  frameMesh.position.y = baseY;
  root.add(frameMesh);

  const makeDisc = (col, emit) => {
    const dv = new Vox(967);
    dv.box(-1, -1, -1, 2, 2, 1, col, emit);
    return buildVoxelMesh(dv, { scale: voxS * 0.92, depthLayer: 4 });
  };
  const protoP1 = makeDisc("#ff5247", 0.65);
  const protoCpu = makeDisc("#ffd24c", 0.65);
  const protoWin = makeDisc("#5ef28c", 1.75);

  const hoverDisc = makeDisc("#ff5247", 1.25);
  hoverDisc.visible = false;
  root.add(hoverDisc);

  const thinkDisc = makeDisc("#ffd24c", 1.5);
  thinkDisc.visible = false;
  root.add(thinkDisc);

  const colX = (c) => (-14 + c * 4 + 1.5) * voxS;
  const rowY = (r) => baseY + (2 + r * 4 + 1.5) * voxS;
  const dropStartY = baseY + 30 * voxS;

  const hitMeshes = [];
  for (let c = 0; c < 7; c++) {
    const hb = makeHitBox(4 * voxS * 0.96, 28 * voxS, 0.45, creation.id, { col: c });
    hb.position.set(colX(c), baseY + 14 * voxS, 0);
    root.add(hb);
    hitMeshes.push(hb);
  }

  const grid = Array.from({ length: 7 }, () => new Array(6).fill(0));
  const discs = []; // { col, row, who, mesh, y, vy, targetY, settled }
  const discsGroup = new THREE.Group();
  root.add(discsGroup);

  let cpuThinking = false;
  let turnToken = 0;
  let disposed = false;
  let gameOver = null;

  function clearGame() {
    turnToken++;
    for (let c = 0; c < 7; c++) grid[c].fill(0);
    discs.length = 0;
    while (discsGroup.children.length) discsGroup.remove(discsGroup.children[0]);
    gameOver = null;
    cpuThinking = false;
    thinkDisc.visible = false;
  }

  function dropInColumn(c, who, quip = "") {
    const r = grid[c].indexOf(0);
    if (r === -1) return null;
    grid[c][r] = who;
    const proto = who === 1 ? protoP1 : protoCpu;
    const m = new THREE.Mesh(proto.geometry, proto.material);
    m.position.set(colX(c), dropStartY, 0);
    discsGroup.add(m);
    discs.push({
      col: c,
      row: r,
      who,
      mesh: m,
      y: dropStartY,
      vy: 0,
      targetY: rowY(r),
      settled: false,
      isWin: false,
    });
    playTone(who === 1 ? 523.25 : 392.0, 0.09, "triangle", 0.065);

    const outcome = checkConnectFourWin(grid);
    if (outcome) {
      gameOver = { ...outcome, age: 0 };
      const winKey = new Set(outcome.cells.map(([wc, wr]) => `${wc},${wr}`));
      for (const d of discs) {
        if (winKey.has(`${d.col},${d.row}`)) {
          d.isWin = true;
          d.mesh.geometry = protoWin.geometry;
        }
      }
      const quipSuffix = quip ? ` · "${quip}"` : "";
      if (outcome.winner === 1) {
        playArpeggio([523.25, 659.25, 783.99, 1046.5], 0.08, 0.24, "triangle", 0.085);
        return "Connect Four — Four in a row! You beat Hermes Park AI!";
      }
      if (outcome.winner === 2) {
        playArpeggio([440, 349.23, 293.66], 0.09, 0.24, "sawtooth", 0.055);
        return `Connect Four — Hermes Park AI connected four!${quipSuffix}`;
      }
      return `Connect Four — Full frame draw vs Hermes Park AI!${quipSuffix}`;
    }
    return quip ? `Hermes Park AI — "${quip}"` : null;
  }

  function askAgentColumn() {
    const validCols = [0, 1, 2, 3, 4, 5, 6].filter((col) => grid[col].indexOf(0) !== -1);
    if (!validCols.length) return;
    const myToken = ++turnToken;
    cpuThinking = true;
    thinkDisc.visible = true;
    requestAgentMove(
      {
        game: "connect_four",
        grid: grid.map((col) => [...col]),
        creationName: creation.name,
      },
      validCols,
    ).then((reply) => {
      if (disposed || myToken !== turnToken || gameOver) return;
      cpuThinking = false;
      thinkDisc.visible = false;
      if (reply.move >= 0 && reply.move < 7 && grid[reply.move].indexOf(0) !== -1) {
        const aiMsg = dropInColumn(reply.move, 2, reply.quip);
        if (aiMsg) onEvent?.(aiMsg);
      }
    });
  }

  return {
    kind: "connect_four",
    hitMeshes,
    extraRadius,
    setHovered(action) {
      const c = action?.col;
      if (
        !cpuThinking &&
        typeof c === "number" &&
        c >= 0 &&
        c < 7 &&
        (grid[c].indexOf(0) !== -1 || gameOver)
      ) {
        hoverDisc.position.set(colX(c), dropStartY, 0);
        hoverDisc.visible = true;
      } else {
        hoverDisc.visible = false;
      }
    },
    trigger(action) {
      ensureAudio();
      const c = typeof action?.col === "number" ? action.col : -1;
      if (gameOver) {
        if (gameOver.age < 0.5) return null;
        clearGame();
        if (c >= 0 && c < 7) {
          const msg = dropInColumn(c, 1);
          if (!gameOver) askAgentColumn();
          return msg;
        }
        return null;
      }
      if (cpuThinking || c < 0 || c >= 7 || grid[c].indexOf(0) === -1) return null;
      const msg = dropInColumn(c, 1);
      if (!gameOver) askAgentColumn();
      return msg;
    },
    step(dt, t) {
      if (hoverDisc.visible) {
        hoverDisc.position.y = dropStartY + Math.sin(t * 6.5) * 0.035;
      }
      if (cpuThinking) {
        thinkDisc.position.set(Math.sin(t * 3.8) * 3 * voxS, dropStartY + 0.06, 0);
        thinkDisc.rotation.y = t * 4.2;
      }
      if (gameOver) gameOver.age += dt;
      for (const d of discs) {
        if (!d.settled) {
          d.vy -= 13.5 * dt;
          d.y += d.vy * dt;
          if (d.y <= d.targetY) {
            d.y = d.targetY;
            if (Math.abs(d.vy) > 1.2) {
              d.vy = -d.vy * 0.28;
              playTone(220 + d.row * 35, 0.05, "sine", 0.045);
            } else {
              d.vy = 0;
              d.settled = true;
            }
          }
          d.mesh.position.y = d.y;
        } else if (d.isWin) {
          d.mesh.scale.setScalar(1 + Math.sin(t * 8.0 + d.col) * 0.12);
        }
      }
    },
    dispose() {
      disposed = true;
      turnToken++;
      frameMesh.geometry.dispose();
      protoP1.geometry.dispose();
      protoCpu.geometry.dispose();
      protoWin.geometry.dispose();
      hoverDisc.geometry.dispose();
      thinkDisc.geometry.dispose();
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 3. Whack-a-Mole 3D Voxel Critter Bonk Arcade ────────────────────────────
function createWhackAMoleController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 6);
  const holeStep = 0.54;
  let deckY = surf.yMeters;
  let extraRadius = 0;

  if (!surf.onCenterTop) {
    const ped = buildApronPedestalMesh(1.05, 1.05, 4, "grass2", "woodDark");
    root.position.set(0, 0, surf.frontZMeters + 1.24);
    root.add(ped.mesh);
    deckY = ped.topY;
    extraRadius = surf.frontZMeters + 2.35;
  }

  // 9 voxel burrow rings + back arcade score/timer header
  const bv = new Vox(971);
  const gs = 0.06;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = Math.round(((c - 1) * holeStep) / gs);
      const cz = Math.round(((r - 1) * holeStep) / gs);
      bv.ringAxis("y", cx, cz, 0, 1, 3.2, 1.8, "soilDark");
      bv.cylinderAxis("y", cx, cz, 0, 1, 1.8, "black");
    }
  }
  const burrowsMesh = buildVoxelMesh(bv, { scale: gs, depthLayer: 3 });
  burrowsMesh.position.y = deckY;
  root.add(burrowsMesh);

  const buildMoleProto = (golden = false) => {
    const mv = new Vox(golden ? 977 : 983);
    const body = golden ? "#ffd24c" : "#8f5e36";
    const emit = golden ? 0.9 : 0;
    mv.box(-2, 0, -2, 2, 4, 2, body, emit);
    mv.box(-1, 4, -1, 1, 5, 1, body, emit);
    mv.put(-1, 3, 2, "black");
    mv.put(1, 3, 2, "black");
    mv.box(-1, 2, 2, 1, 3, 3, "#ec8db0", 0.3); // pink nose
    mv.put(0, 1, 2, "white"); // bucktooth
    return buildVoxelMesh(mv, { scale: 0.056, depthLayer: 4 });
  };
  const moleNormal = buildMoleProto(false);
  const moleGold = buildMoleProto(true);

  const sparkVox = new Vox(991);
  sparkVox.put(0, 0, 0, "#ffe57f", 1.8);
  const sparkProto = buildVoxelMesh(sparkVox, { scale: 0.055, castShadow: false, depthLayer: 5 });

  const holes = [];
  const hitMeshes = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const hx = (c - 1) * holeStep;
      const hz = (r - 1) * holeStep;
      const holder = new THREE.Group();
      holder.position.set(hx, deckY, hz);
      const mesh = new THREE.Mesh(moleNormal.geometry, moleNormal.material);
      mesh.visible = false;
      holder.add(mesh);
      root.add(holder);

      const hb = makeHitBox(holeStep * 0.92, 0.44, holeStep * 0.92, creation.id, { hole: idx });
      hb.position.set(hx, deckY + 0.18, hz);
      root.add(hb);
      hitMeshes.push(hb);

      holes.push({
        idx,
        hx,
        hz,
        holder,
        mesh,
        up: 0,
        goalUp: 0,
        stayTimer: 0,
        golden: false,
        bonked: false,
      });
    }
  }

  // Timer bar + score cubes along back edge (-Z)
  const timerVox = new Vox(997);
  timerVox.box(-12, 0, -1, 12, 2, 1, "#5ef28c", 1.35);
  const timerBar = buildVoxelMesh(timerVox, { scale: 0.05, depthLayer: 4 });
  timerBar.position.set(0, deckY + 0.08, -holeStep * 1.55);
  timerBar.visible = false;
  root.add(timerBar);

  const scoreGroup = new THREE.Group();
  root.add(scoreGroup);
  const sparks = [];

  let activeRoundSec = 0;
  let spawnCooldown = 1.2;
  let score = 0;

  function rebuildScoreTower() {
    while (scoreGroup.children.length) scoreGroup.remove(scoreGroup.children[0]);
    const pips = Math.min(18, score);
    for (let i = 0; i < pips; i++) {
      const pip = buildTallyPipMesh(i >= 10 ? "#ffe055" : "#ff7426", 1.3);
      pip.position.set(holeStep * 1.65, deckY + (i % 9) * 0.11, -0.3 + Math.floor(i / 9) * 0.18);
      scoreGroup.add(pip);
    }
  }

  function popRandomMole(inGame) {
    const down = holes.filter((h) => h.goalUp === 0 && h.up < 0.05);
    if (!down.length) return;
    const h = down[Math.floor(Math.random() * down.length)];
    h.golden = inGame && Math.random() < 0.22;
    h.mesh.geometry = h.golden ? moleGold.geometry : moleNormal.geometry;
    h.mesh.visible = true;
    h.bonked = false;
    h.goalUp = 1;
    h.stayTimer = inGame ? Math.max(0.58, 1.25 - score * 0.03) : 1.7;
  }

  function spawnBonkSparks(hx, hz) {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const m = new THREE.Mesh(sparkProto.geometry, sparkProto.material);
      m.position.set(hx, deckY + 0.24, hz);
      root.add(m);
      sparks.push({
        mesh: m,
        vx: Math.cos(ang) * 1.25,
        vy: 1.9 + Math.random() * 0.7,
        vz: Math.sin(ang) * 1.25,
        life: 0.42,
      });
    }
  }

  return {
    kind: "whack_a_mole",
    hitMeshes,
    extraRadius,
    setHovered() {},
    trigger(action) {
      ensureAudio();
      const idx = typeof action?.hole === "number" ? action.hole : -1;
      const startingFresh = activeRoundSec <= 0;
      if (startingFresh) {
        activeRoundSec = 22.0;
        score = 0;
        rebuildScoreTower();
        timerBar.visible = true;
        spawnCooldown = 0.12;
        playArpeggio([392, 523.25, 659.25], 0.06, 0.14, "square", 0.055);
      }
      if (idx >= 0 && idx < 9) {
        const h = holes[idx];
        if (h.up > 0.25 && !h.bonked) {
          h.bonked = true;
          h.goalUp = 0;
          h.stayTimer = 0;
          score += h.golden ? 3 : 1;
          rebuildScoreTower();
          spawnBonkSparks(h.hx, h.hz);
          playArpeggio(h.golden ? [659.25, 880, 1174.66] : [587.33, 880], 0.045, 0.12, "triangle", 0.08);
          return null;
        } else if (!startingFresh) {
          playTone(190, 0.07, "sine", 0.045);
        }
      }
      return startingFresh ? "Whack-a-Mole — 22s round started! Bonk the critters!" : null;
    },
    step(dt) {
      if (activeRoundSec > 0) {
        activeRoundSec -= dt;
        timerBar.scale.x = Math.max(0.02, activeRoundSec / 22.0);
        spawnCooldown -= dt;
        if (spawnCooldown <= 0) {
          popRandomMole(true);
          if (activeRoundSec < 12 && Math.random() < 0.42) popRandomMole(true);
          spawnCooldown = Math.max(0.32, 0.68 - score * 0.015);
        }
        if (activeRoundSec <= 0) {
          timerBar.visible = false;
          playArpeggio([523.25, 659.25, 783.99, 1046.5], 0.08, 0.2, "triangle", 0.07);
        }
      } else {
        // Gentle idle peek every ~3.4s so the garden cabinet looks alive in the world
        spawnCooldown -= dt;
        if (spawnCooldown <= 0) {
          popRandomMole(false);
          spawnCooldown = 3.4;
        }
      }

      for (const h of holes) {
        if (h.goalUp > 0) {
          h.stayTimer -= dt;
          if (h.stayTimer <= 0) h.goalUp = 0;
        }
        const rate = h.bonked ? 15.0 : 9.5;
        h.up += (h.goalUp - h.up) * Math.min(1, dt * rate);
        if (h.up < 0.02 && h.goalUp === 0) {
          h.up = 0;
          h.mesh.visible = false;
        } else {
          h.mesh.position.y = (h.up - 1) * 0.24;
          const squash = h.bonked ? 0.55 : 1.0;
          h.mesh.scale.set(h.bonked ? 1.25 : 1, squash, h.bonked ? 1.25 : 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.life -= dt;
        if (sp.life <= 0) {
          root.remove(sp.mesh);
          sparks.splice(i, 1);
          continue;
        }
        sp.vy -= 9.5 * dt;
        sp.mesh.position.x += sp.vx * dt;
        sp.mesh.position.y += sp.vy * dt;
        sp.mesh.position.z += sp.vz * dt;
      }
    },
    dispose() {
      burrowsMesh.geometry.dispose();
      moleNormal.geometry.dispose();
      moleGold.geometry.dispose();
      sparkProto.geometry.dispose();
      timerBar.geometry.dispose();
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 4. Giant Walk-On & Clickable 8-Key Floor Piano (C4..C5 Major) ───────────
const PIANO_FREQS = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
const PIANO_GLOW_COLS = [
  "#ff5a4f",
  "#ff9d3b",
  "#ffe055",
  "#5ef28c",
  "#4ce8e0",
  "#5d9be3",
  "#9b7bd4",
  "#ec8db0",
];
const DEMO_MELODY = [0, 2, 4, 7, 4, 2, 0, 4, 5, 4, 2, 0];

function createFloorPianoController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 3);
  const keyW = 0.38;
  const keyD = 1.38;
  const baseY = surf.onCenterTop ? surf.yMeters : 0.015;
  if (!surf.onCenterTop) {
    root.position.set(0, 0, surf.frontZMeters + 1.05);
  }

  // Dark ebony surround frame + black sharp keys at back
  const fv = new Vox(1009);
  const fs = 0.08;
  const hw = Math.round((keyW * 4.2) / fs);
  const hd = Math.round((keyD * 0.56) / fs);
  fv.box(-hw, 0, -hd, hw, 1, hd, "#1f2229");
  // Decorative raised black accidentals (C#, D#, F#, G#, A#)
  for (const sharpSlot of [0.5, 1.5, 3.5, 4.5, 5.5]) {
    const sx = Math.round(((sharpSlot - 3.5) * keyW) / fs);
    fv.box(sx - 1, 1, -hd + 1, sx + 1, 3, 0, "#181a20");
  }
  const frameMesh = buildVoxelMesh(fv, { scale: fs, depthLayer: 2 });
  frameMesh.position.y = baseY;
  root.add(frameMesh);

  const noteVox = new Vox(1013);
  noteVox.box(-1, 0, 0, 1, 2, 1, "#ffe57f", 1.7);
  noteVox.box(0, 2, 0, 1, 5, 1, "#ffe57f", 1.7);
  noteVox.put(1, 4, 0, "#ffe57f", 1.7);
  const noteProto = buildVoxelMesh(noteVox, { scale: 0.055, castShadow: false, depthLayer: 5 });

  const keys = [];
  const hitMeshes = [];
  const ks = 0.068;
  const kwVox = Math.max(2, Math.round((keyW * 0.44) / ks));
  const kdVox = Math.max(5, Math.round((keyD * 0.46) / ks));

  for (let i = 0; i < 8; i++) {
    const kx = (i - 3.5) * keyW;
    const kvIdle = new Vox(1021 + i);
    kvIdle.box(-kwVox, 0, -kdVox, kwVox, 2, kdVox, "white");
    kvIdle.box(-kwVox, 2, kdVox - 2, kwVox, 3, kdVox, PIANO_GLOW_COLS[i], 0.35);

    const kvLit = new Vox(1031 + i);
    kvLit.box(-kwVox, 0, -kdVox, kwVox, 2, kdVox, PIANO_GLOW_COLS[i], 1.45);

    const idleMesh = buildVoxelMesh(kvIdle, { scale: ks, depthLayer: 3 });
    const litMesh = buildVoxelMesh(kvLit, { scale: ks, depthLayer: 3 });
    const holder = new THREE.Group();
    holder.position.set(kx, baseY + 0.06, 0);
    const mesh = new THREE.Mesh(idleMesh.geometry, idleMesh.material);
    holder.add(mesh);
    root.add(holder);

    const hb = makeHitBox(keyW * 0.95, 0.3, keyD, creation.id, { key: i });
    hb.position.set(kx, baseY + 0.14, 0);
    root.add(hb);
    hitMeshes.push(hb);

    keys.push({
      i,
      kx,
      holder,
      mesh,
      idleGeo: idleMesh.geometry,
      litGeo: litMesh.geometry,
      press: 0,
      glowSec: 0,
    });
  }

  // Crimson "Auto-Riff" button on the right cheek
  const btnVox = new Vox(1049);
  btnVox.box(-2, 0, -2, 2, 3, 2, "#ff5247", 1.2);
  const riffBtn = buildVoxelMesh(btnVox, { scale: 0.06, depthLayer: 4 });
  riffBtn.position.set(4.35 * keyW, baseY + 0.06, -keyD * 0.32);
  root.add(riffBtn);
  const riffHit = makeHitBox(0.34, 0.34, 0.34, creation.id, { riff: true });
  riffHit.position.copy(riffBtn.position);
  root.add(riffHit);
  hitMeshes.push(riffHit);

  const floatingNotes = [];
  let lastWalkKey = -1;
  let riffStep = -1;
  let riffTimer = 0;

  function strikeKey(idx, withSound = true) {
    if (idx < 0 || idx >= 8) return;
    const k = keys[idx];
    k.press = 1.0;
    k.glowSec = 0.32;
    k.mesh.geometry = k.litGeo;
    if (withSound) {
      playTone(PIANO_FREQS[idx], 0.36, "triangle", 0.085);
      playTone(PIANO_FREQS[idx] * 2, 0.22, "sine", 0.03);
    }
    const nm = new THREE.Mesh(noteProto.geometry, noteProto.material);
    nm.position.set(k.kx, baseY + 0.28, 0);
    root.add(nm);
    floatingNotes.push({ mesh: nm, life: 0.85, phase: idx });
  }

  return {
    kind: "floor_piano",
    hitMeshes,
    allowWalkOver: true,
    extraRadius: 0,
    setHovered(action) {
      riffBtn.scale.setScalar(action?.riff ? 1.18 : 1.0);
    },
    trigger(action) {
      ensureAudio();
      if (action?.riff) {
        riffStep = 0;
        riffTimer = 0.01;
        return "Floor Piano — Playing voxel melody!";
      }
      if (typeof action?.key === "number") {
        strikeKey(action.key, true);
      }
      return null;
    },
    step(dt, t, ctx) {
      if (riffStep >= 0) {
        riffTimer -= dt;
        if (riffTimer <= 0) {
          strikeKey(DEMO_MELODY[riffStep], true);
          riffStep++;
          if (riffStep >= DEMO_MELODY.length) riffStep = -1;
          else riffTimer = 0.19;
        }
      }

      // First-Person Walk Mode footstep trigger!
      if (ctx?.viewerPos) {
        const dx = ctx.viewerPos.x - ctx.entX;
        const dz = ctx.viewerPos.z - ctx.entZ;
        const c = Math.cos(-(ctx.entYaw || 0));
        const s = Math.sin(-(ctx.entYaw || 0));
        const lx = dx * c + dz * s - root.position.x;
        const lz = -dx * s + dz * c - root.position.z;
        if (Math.abs(lz) <= keyD * 0.58 && Math.abs(lx) <= keyW * 4.1) {
          const kIdx = Math.max(0, Math.min(7, Math.floor(lx / keyW + 4)));
          if (kIdx !== lastWalkKey) {
            lastWalkKey = kIdx;
            ensureAudio();
            strikeKey(kIdx, true);
          }
        } else {
          lastWalkKey = -1;
        }
      }

      for (const k of keys) {
        if (k.glowSec > 0) {
          k.glowSec -= dt;
          if (k.glowSec <= 0) k.mesh.geometry = k.idleGeo;
        }
        k.press = Math.max(0, k.press - dt * 5.2);
        k.holder.position.y = baseY + 0.06 - k.press * 0.055;
      }

      for (let i = floatingNotes.length - 1; i >= 0; i--) {
        const fn = floatingNotes[i];
        fn.life -= dt;
        if (fn.life <= 0) {
          root.remove(fn.mesh);
          floatingNotes.splice(i, 1);
          continue;
        }
        fn.mesh.position.y += dt * 1.15;
        fn.mesh.position.x += Math.sin(t * 6 + fn.phase) * dt * 0.22;
        fn.mesh.scale.setScalar(Math.min(1, fn.life * 1.6));
      }
    },
    dispose() {
      frameMesh.geometry.dispose();
      noteProto.geometry.dispose();
      riffBtn.geometry.dispose();
      keys.forEach((k) => {
        k.idleGeo.dispose();
        k.litGeo.dispose();
      });
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 5. Simon 4-Pad Glowing Voxel Memory Synth ───────────────────────────────
const SIMON_PADS = [
  { pos: [-0.42, -0.42], idle: "#2e6e41", lit: "#5ef28c", freq: 329.63 },
  { pos: [0.42, -0.42], idle: "#8a2d2b", lit: "#ff5a4f", freq: 440.0 },
  { pos: [-0.42, 0.42], idle: "#99741f", lit: "#ffe055", freq: 554.37 },
  { pos: [0.42, 0.42], idle: "#23687a", lit: "#4ce8e0", freq: 659.25 },
];

function createSimonSynthController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 5);
  let deckY = surf.yMeters;
  let extraRadius = 0;
  if (!surf.onCenterTop) {
    const ped = buildApronPedestalMesh(0.95, 0.95, 3, "basalt", "charcoal");
    root.position.set(0, 0, surf.frontZMeters + 1.15);
    root.add(ped.mesh);
    deckY = ped.topY;
    extraRadius = surf.frontZMeters + 2.15;
  }

  const pads = [];
  const hitMeshes = [];
  SIMON_PADS.forEach((cfg, idx) => {
    const vIdle = new Vox(1061 + idx);
    vIdle.box(-4, 0, -4, 4, 2, 4, cfg.idle, 0.25);
    const vLit = new Vox(1069 + idx);
    vLit.box(-4, 0, -4, 4, 3, 4, cfg.lit, 1.85);
    const idleMesh = buildVoxelMesh(vIdle, { scale: 0.08, depthLayer: 3 });
    const litMesh = buildVoxelMesh(vLit, { scale: 0.08, depthLayer: 3 });
    const m = new THREE.Mesh(idleMesh.geometry, idleMesh.material);
    m.position.set(cfg.pos[0], deckY, cfg.pos[1]);
    root.add(m);

    const hb = makeHitBox(0.7, 0.34, 0.7, creation.id, { pad: idx });
    hb.position.set(cfg.pos[0], deckY + 0.15, cfg.pos[1]);
    root.add(hb);
    hitMeshes.push(hb);

    pads.push({ idx, cfg, mesh: m, idleGeo: idleMesh.geometry, litGeo: litMesh.geometry, litTimer: 0 });
  });

  // Central level spire
  const spireGroup = new THREE.Group();
  root.add(spireGroup);

  let sequence = [];
  let userStep = 0;
  let playbackIdx = -1;
  let playbackTimer = 0;

  function rebuildSpire(level) {
    while (spireGroup.children.length) spireGroup.remove(spireGroup.children[0]);
    for (let i = 0; i < Math.min(12, level); i++) {
      const pip = buildTallyPipMesh("#ffe57f", 1.5);
      pip.position.set(0, deckY + 0.06 + i * 0.12, 0);
      spireGroup.add(pip);
    }
  }

  function flashPad(idx, dur = 0.32) {
    const p = pads[idx];
    p.litTimer = dur;
    p.mesh.geometry = p.litGeo;
    playTone(p.cfg.freq, dur, "triangle", 0.085);
  }

  function nextRound() {
    sequence.push(Math.floor(Math.random() * 4));
    userStep = 0;
    playbackIdx = 0;
    playbackTimer = 0.45;
    rebuildSpire(sequence.length);
  }

  return {
    kind: "simon_synth",
    hitMeshes,
    extraRadius,
    setHovered() {},
    trigger(action) {
      ensureAudio();
      const idx = typeof action?.pad === "number" ? action.pad : -1;
      if (sequence.length === 0) {
        nextRound();
        return "Simon Memory — Watch the glowing pads & repeat!";
      }
      if (playbackIdx >= 0 || idx < 0 || idx >= 4) return null;
      flashPad(idx, 0.25);
      if (idx === sequence[userStep]) {
        userStep++;
        if (userStep >= sequence.length) {
          const completed = sequence.length;
          nextRound();
          return completed >= 3 ? `Simon Memory — Level ${completed} cleared!` : null;
        }
        return null;
      } else {
        const reached = Math.max(0, sequence.length - 1);
        sequence = [];
        rebuildSpire(0);
        playArpeggio([220, 164.81], 0.12, 0.26, "sawtooth", 0.065);
        return `Simon Memory — Missed! Reached level ${reached}. Click to play again`;
      }
    },
    step(dt) {
      if (playbackIdx >= 0) {
        playbackTimer -= dt;
        if (playbackTimer <= 0) {
          flashPad(sequence[playbackIdx], 0.34);
          playbackIdx++;
          if (playbackIdx >= sequence.length) {
            playbackIdx = -1;
          } else {
            playbackTimer = 0.48;
          }
        }
      }
      for (const p of pads) {
        if (p.litTimer > 0) {
          p.litTimer -= dt;
          if (p.litTimer <= 0) p.mesh.geometry = p.idleGeo;
        }
      }
    },
    dispose() {
      pads.forEach((p) => {
        p.idleGeo.dispose();
        p.litGeo.dispose();
      });
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 6. Lights-Out 3x3 Bioluminescent Rune Cube Puzzle ───────────────────────
function createLightsOutController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 5);
  const step = 0.5;
  let deckY = surf.yMeters;
  let extraRadius = 0;
  if (!surf.onCenterTop) {
    const ped = buildApronPedestalMesh(0.95, 0.95, 3, "basalt", "charcoal");
    root.position.set(0, 0, surf.frontZMeters + 1.15);
    root.add(ped.mesh);
    deckY = ped.topY;
    extraRadius = surf.frontZMeters + 2.15;
  }

  const vDormant = new Vox(1087);
  vDormant.box(-3, 0, -3, 3, 2, 3, "basalt");
  vDormant.box(-1, 2, -1, 1, 3, 1, "#2d7d74", 0.35);
  const vLit = new Vox(1091);
  vLit.box(-3, 0, -3, 3, 3, 3, "#4ce8e0", 1.7);
  vLit.box(-1, 3, -1, 1, 4, 1, "#ffe57f", 1.9);

  const dormantGeo = buildVoxelMesh(vDormant, { scale: 0.065, depthLayer: 3 }).geometry;
  const litGeo = buildVoxelMesh(vLit, { scale: 0.065, depthLayer: 3 }).geometry;
  const runeMat = buildVoxelMesh(vDormant, { scale: 0.065, depthLayer: 3 }).material;

  const capVox = new Vox(1093);
  capVox.box(-2, -2, -2, 2, 2, 2, "#ffe055", 1.9);
  const capstone = buildVoxelMesh(capVox, { scale: 0.065, depthLayer: 5 });
  capstone.position.set(0, deckY + 0.95, 0);
  capstone.visible = false;
  root.add(capstone);

  const state = new Array(9).fill(true); // goal: all true (all 9 runes lit!)
  const cells = [];
  const hitMeshes = [];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cx = (c - 1) * step;
      const cz = (r - 1) * step;
      const m = new THREE.Mesh(dormantGeo, runeMat);
      m.position.set(cx, deckY, cz);
      root.add(m);
      cells.push(m);

      const hb = makeHitBox(step * 0.92, 0.35, step * 0.92, creation.id, { rune: idx });
      hb.position.set(cx, deckY + 0.16, cz);
      root.add(hb);
      hitMeshes.push(hb);
    }
  }

  let solved = false;
  function toggleAt(idx) {
    const r = Math.floor(idx / 3);
    const c = idx % 3;
    for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < 3 && nc >= 0 && nc < 3) {
        const k = nr * 3 + nc;
        state[k] = !state[k];
      }
    }
  }

  function syncRunes() {
    for (let i = 0; i < 9; i++) {
      cells[i].geometry = state[i] ? litGeo : dormantGeo;
      cells[i].position.y = deckY + (state[i] ? 0.05 : 0);
    }
  }

  function scrambleSolvable() {
    state.fill(true);
    solved = false;
    capstone.visible = false;
    // Apply 4 distinct moves from solved state -> guaranteed solvable in <= 4 clicks!
    const picks = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5).slice(0, 4);
    picks.forEach((p) => toggleAt(p));
    if (state.every(Boolean)) toggleAt(4);
    syncRunes();
  }
  scrambleSolvable();

  return {
    kind: "lights_out",
    hitMeshes,
    extraRadius,
    setHovered() {},
    trigger(action) {
      ensureAudio();
      if (solved) {
        scrambleSolvable();
        playTone(440, 0.12, "triangle", 0.07);
        return null;
      }
      const idx = typeof action?.rune === "number" ? action.rune : -1;
      if (idx < 0 || idx >= 9) return null;
      toggleAt(idx);
      syncRunes();
      const litCount = state.filter(Boolean).length;
      playTone(330 + litCount * 55, 0.14, "sine", 0.075);
      if (litCount === 9) {
        solved = true;
        capstone.visible = true;
        playArpeggio([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.075, 0.28, "triangle", 0.085);
        return "Rune Shrine — All 9 bioluminescent runes ignited!";
      }
      return null;
    },
    step(dt, t) {
      if (capstone.visible) {
        capstone.rotation.y = t * 2.8;
        capstone.rotation.x = Math.sin(t * 2.1) * 0.4;
        capstone.position.y = deckY + 0.88 + Math.sin(t * 3.5) * 0.1;
      }
    },
    dispose() {
      dormantGeo.dispose();
      litGeo.dispose();
      capstone.geometry.dispose();
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 7. Live 8-Step x 4-Note Voxel Beat & Melody Matrix ──────────────────────
const SEQ_NOTES = [196.0, 293.66, 392.0, 587.33]; // G3, D4, G4, D5 pentatonic
const SEQ_COLS = ["#ff5a4f", "#ffb642", "#5ef28c", "#4ce8e0"];

function createStepSequencerController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 4);
  const baseY = surf.onCenterTop ? surf.yMeters : 0.02;
  let extraRadius = 0;
  if (!surf.onCenterTop) {
    root.position.set(0, 0, surf.frontZMeters + 0.9);
    extraRadius = surf.frontZMeters + 1.5;
  }

  // Console frame tilted gently toward viewer
  const consoleGroup = new THREE.Group();
  consoleGroup.position.y = baseY + 0.45;
  consoleGroup.rotation.x = -0.45;
  root.add(consoleGroup);

  const backVox = new Vox(1103);
  backVox.box(-18, -10, -2, 18, 10, 0, "#23252b");
  const backMesh = buildVoxelMesh(backVox, { scale: 0.06, depthLayer: 2 });
  consoleGroup.add(backMesh);

  const offVox = new Vox(1109);
  offVox.box(-1, -1, 0, 2, 2, 1, "#3b4048");
  const offGeo = buildVoxelMesh(offVox, { scale: 0.058, depthLayer: 3 }).geometry;
  const padMat = buildVoxelMesh(offVox, { scale: 0.058, depthLayer: 3 }).material;

  const rowGeos = SEQ_COLS.map((c, idx) => {
    const v = new Vox(1117 + idx);
    v.box(-1, -1, 0, 2, 2, 2, c, 1.65);
    return buildVoxelMesh(v, { scale: 0.058, depthLayer: 4 }).geometry;
  });

  // Pre-seeded catchy 8-step voxel groove (silent until clicked!)
  const pattern = [
    [true, false, false, true, false, false, true, false],
    [false, false, true, false, false, true, false, false],
    [true, false, true, false, false, false, true, true],
    [false, true, false, false, true, false, false, true],
  ];

  const cells = [];
  const hitMeshes = [];
  const stepSpacingX = 0.24;
  const rowSpacingY = 0.24;

  for (let r = 0; r < 4; r++) {
    cells[r] = [];
    for (let s = 0; s < 8; s++) {
      const px = (s - 3.5) * stepSpacingX;
      const py = (r - 1.5) * rowSpacingY;
      const m = new THREE.Mesh(pattern[r][s] ? rowGeos[r] : offGeo, padMat);
      m.position.set(px, py, 0.02);
      consoleGroup.add(m);
      cells[r][s] = m;

      const hb = makeHitBox(0.22, 0.22, 0.18, creation.id, { row: r, step: s });
      hb.position.set(px, py, 0.05);
      consoleGroup.add(hb);
      hitMeshes.push(hb);
    }
  }

  // Sweeping playhead bar
  const phVox = new Vox(1129);
  phVox.box(0, -9, 0, 1, 9, 1, "#ffe57f", 1.8);
  const playhead = buildVoxelMesh(phVox, { scale: 0.055, castShadow: false, depthLayer: 5 });
  playhead.position.z = 0.09;
  consoleGroup.add(playhead);

  let playingAudio = false;
  let stepAccum = 0;
  let curStep = 0;

  return {
    kind: "step_sequencer",
    hitMeshes,
    extraRadius,
    setHovered() {},
    trigger(action) {
      ensureAudio();
      const wasSilent = !playingAudio;
      playingAudio = true;
      if (typeof action?.row === "number" && typeof action?.step === "number") {
        const { row, step } = action;
        pattern[row][step] = !pattern[row][step];
        cells[row][step].geometry = pattern[row][step] ? rowGeos[row] : offGeo;
        if (pattern[row][step]) {
          playTone(SEQ_NOTES[row], 0.14, "triangle", 0.075);
        }
        return wasSilent ? "Step Sequencer — Live synth loop unmuted!" : null;
      }
      playingAudio = !wasSilent;
      return playingAudio ? "Step Sequencer — Playing 8-step voxel groove!" : "Step Sequencer — Muted";
    },
    step(dt) {
      stepAccum += dt;
      if (stepAccum >= 0.22) {
        stepAccum -= 0.22;
        curStep = (curStep + 1) % 8;
        playhead.position.x = (curStep - 3.5) * stepSpacingX;
        for (let r = 0; r < 4; r++) {
          for (let s = 0; s < 8; s++) {
            cells[r][s].position.z = s === curStep && pattern[r][s] ? 0.075 : 0.02;
          }
          if (playingAudio && pattern[r][curStep]) {
            playTone(SEQ_NOTES[r], 0.16, r === 0 ? "triangle" : "sine", 0.055);
          }
        }
      }
    },
    dispose() {
      backMesh.geometry.dispose();
      offGeo.dispose();
      rowGeos.forEach((g) => g.dispose());
      playhead.geometry.dispose();
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 8. Interactive Streetball Trick-Shot Hoop ───────────────────────────────
function createBasketballController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 3);
  const voxS = surf.voxScale;
  const b = surf.bounds;

  // Locate orange/red rim in sculpted baseVox or mount a regulation rim at -Z
  const rimPos = new THREE.Vector3(0, Math.max(2.35, b.maxY * voxS * 0.78), Math.min(-1.2, b.minZ * voxS + 0.55));
  const rimVox = new Vox(1151);
  rimVox.ringAxis("y", 0, 0, 0, 1, 3.2, 2.2, "#ff7426", 0.9);
  // Crisp white voxel net below rim
  rimVox.ringAxis("y", 0, 0, -3, 0, 2.5, 1.8, "white", 0.25);
  const rimMesh = buildVoxelMesh(rimVox, { scale: 0.075, depthLayer: 4 });
  rimMesh.position.copy(rimPos);
  root.add(rimMesh);

  const ballVox = new Vox(1153);
  ballVox.sphere(0, 0, 0, 2.4, 2.4, 2.4, "#ec8438", 0.45);
  ballVox.box(-3, 0, 0, 3, 1, 1, "#23252b");
  const ballProto = buildVoxelMesh(ballVox, { scale: 0.068, depthLayer: 5 });

  const shotSpots = [
    { label: "Free Throw", x: 0, z: Math.max(1.5, b.maxZ * voxS + 0.35), pts: 2 },
    { label: "Left Wing 3-Pointer", x: -1.35, z: Math.max(1.9, b.maxZ * voxS + 0.75), pts: 3 },
    { label: "Right Wing 3-Pointer", x: 1.35, z: Math.max(1.9, b.maxZ * voxS + 0.75), pts: 3 },
  ];

  const spotBalls = [];
  const hitMeshes = [];
  shotSpots.forEach((sp, idx) => {
    const padV = new Vox(1163 + idx);
    padV.ringAxis("y", 0, 0, 0, 1, 3.0, 2.0, "#ffe055", 1.1);
    const padM = buildVoxelMesh(padV, { scale: 0.07, castShadow: false, depthLayer: 2 });
    padM.position.set(sp.x, 0.02, sp.z);
    root.add(padM);

    const bm = new THREE.Mesh(ballProto.geometry, ballProto.material);
    bm.position.set(sp.x, 0.22, sp.z);
    root.add(bm);
    spotBalls.push(bm);

    const hb = makeHitBox(0.68, 0.65, 0.68, creation.id, { spot: idx });
    hb.position.set(sp.x, 0.32, sp.z);
    root.add(hb);
    hitMeshes.push(hb);
  });

  const activeShots = [];
  const scoreGroup = new THREE.Group();
  root.add(scoreGroup);
  let totalPoints = 0;

  function launchShot(spotIdx) {
    const sp = shotSpots[spotIdx] || shotSpots[0];
    const start = new THREE.Vector3(sp.x, 0.35, sp.z);
    const swish = Math.random() < (sp.pts === 2 ? 0.82 : 0.72);
    const target = rimPos.clone().add(new THREE.Vector3(swish ? 0 : (Math.random() > 0.5 ? 0.22 : -0.22), 0.06, 0));
    const flightT = sp.pts === 3 ? 1.02 : 0.86;
    const g = 11.8;
    const vx = (target.x - start.x) / flightT;
    const vz = (target.z - start.z) / flightT;
    const vy = (target.y - start.y + 0.5 * g * flightT * flightT) / flightT;

    const m = new THREE.Mesh(ballProto.geometry, ballProto.material);
    m.position.copy(start);
    root.add(m);
    playTone(310, 0.09, "triangle", 0.07);
    activeShots.push({ mesh: m, vx, vy, vz, g, age: 0, flightT, swish, pts: sp.pts, resolved: false });
  }

  return {
    kind: "basketball_hoop",
    hitMeshes,
    extraRadius: Math.max(0, b.maxZ * voxS + 1.4),
    setHovered(action) {
      spotBalls.forEach((bm, i) => bm.scale.setScalar(action?.spot === i ? 1.24 : 1.0));
    },
    onInspectFocus() {
      ensureAudio();
      launchShot(0);
    },
    trigger(action) {
      ensureAudio();
      const idx = typeof action?.spot === "number" ? action.spot : Math.floor(Math.random() * 3);
      launchShot(idx);
      return null;
    },
    step(dt, t) {
      spotBalls.forEach((bm, idx) => {
        bm.position.y = 0.22 + Math.abs(Math.sin(t * 3.4 + idx)) * 0.14;
        bm.rotation.x = t * 2.0;
      });
      for (let i = activeShots.length - 1; i >= 0; i--) {
        const s = activeShots[i];
        s.age += dt;
        s.vy -= s.g * dt;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.mesh.rotation.x -= dt * 11.0;

        if (!s.resolved && s.age >= s.flightT) {
          s.resolved = true;
          if (s.swish) {
            totalPoints += s.pts;
            s.vx *= 0.15;
            s.vz *= 0.15;
            rimMesh.scale.set(1.06, 0.86, 1.06);
            playBurstNoise(0.14, 0.05);
            playArpeggio(s.pts === 3 ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 783.99], 0.06, 0.18, "triangle", 0.075);
            while (scoreGroup.children.length) scoreGroup.remove(scoreGroup.children[0]);
            for (let p = 0; p < Math.min(18, totalPoints); p++) {
              const pip = buildTallyPipMesh("#ff7426", 1.4);
              pip.position.set(-0.9 + (p % 6) * 0.11, rimPos.y + 0.52 + Math.floor(p / 6) * 0.12, rimPos.z);
              scoreGroup.add(pip);
            }
          } else {
            s.vy = 2.8;
            s.vx = (Math.random() - 0.5) * 2.6;
            s.vz = 2.2;
            playTone(185, 0.11, "square", 0.05);
          }
        }
        if (s.mesh.position.y <= 0.18 && s.vy < 0) {
          s.mesh.position.y = 0.18;
          s.vy = -s.vy * 0.45;
        }
        if (s.age > 2.2) {
          root.remove(s.mesh);
          activeShots.splice(i, 1);
        }
      }
      rimMesh.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 10));
    },
    dispose() {
      rimMesh.geometry.dispose();
      ballProto.geometry.dispose();
      hitMeshes.forEach((m) => m.geometry.dispose());
    },
  };
}

// ─── 9. Mechanical 3-Reel Voxel Jackpot Automaton ────────────────────────────
function createSlotMachineController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 3);
  const voxS = surf.voxScale;
  const b = surf.bounds;
  const frontZ = Math.max(0.55, b.maxZ * voxS + 0.14);
  const reelY = Math.max(0.85, Math.min(2.2, b.maxY * voxS * 0.56));

  // Build 3 octagonal symbol reels (4 distinct symbol faces at 0, pi/2, pi, 3pi/2)
  const buildReelMesh = () => {
    const rv = new Vox(1171);
    rv.cylinderAxis("x", 0, 0, -2, 2, 3.2, "white");
    // Face 0 (+Z): Cherry (crimson)
    rv.box(-1, -1, 3, 1, 1, 4, "#df5246", 1.1);
    // Face 1 (+Y): Gold Star
    rv.box(-1, 3, -1, 1, 4, 1, "#ffe055", 1.5);
    // Face 2 (-Z): Cyan Gem
    rv.box(-1, -1, -4, 1, 1, -3, "#4ce8e0", 1.4);
    // Face 3 (-Y): Emerald Clover
    rv.box(-1, -4, -1, 1, -3, 1, "#5ef28c", 1.4);
    return buildVoxelMesh(rv, { scale: 0.055, depthLayer: 4 });
  };
  const reelProto = buildReelMesh();
  const reels = [-0.34, 0, 0.34].map((rx) => {
    const m = new THREE.Mesh(reelProto.geometry, reelProto.material);
    m.position.set(rx, reelY, frontZ);
    root.add(m);
    return { mesh: m, angle: 0, targetAngle: 0, spinningSec: 0 };
  });

  // Side pull lever with red ball handle
  const lv = new Vox(1181);
  lv.box(0, 0, -1, 1, 7, 1, "chrome");
  lv.sphere(0.5, 7.5, 0, 1.8, 1.8, 1.8, "#ff5247", 1.1);
  const leverPivot = new THREE.Group();
  leverPivot.position.set(Math.max(0.62, b.maxX * voxS + 0.08), reelY - 0.12, frontZ * 0.5);
  const leverMesh = buildVoxelMesh(lv, { scale: 0.06, depthLayer: 4 });
  leverPivot.add(leverMesh);
  root.add(leverPivot);

  const coinVox = new Vox(1187);
  coinVox.box(-1, 0, -1, 1, 1, 1, "#ffe055", 1.7);
  const coinProto = buildVoxelMesh(coinVox, { scale: 0.065, depthLayer: 5 });
  const coins = [];

  const hb = makeHitBox(1.55, 1.55, 0.9, creation.id, { spin: true });
  hb.position.set(0.1, reelY, frontZ);
  root.add(hb);

  let leverPull = 0;
  let pendingOutcome = null;

  function pullHandle() {
    if (reels.some((r) => r.spinningSec > 0.1)) return null;
    leverPull = 1.0;
    // Give generous fun odds (~30% 3-of-a-kind jackpot, ~40% pair!)
    const r0 = Math.floor(Math.random() * 4);
    const roll = Math.random();
    const faces =
      roll < 0.32
        ? [r0, r0, r0]
        : roll < 0.72
          ? [r0, r0, (r0 + 1 + Math.floor(Math.random() * 3)) % 4]
          : [r0, (r0 + 1) % 4, (r0 + 2) % 4];
    reels.forEach((r, idx) => {
      const fullTurns = 4 + idx * 2;
      const base = Math.ceil(r.angle / (Math.PI * 2)) * Math.PI * 2;
      r.targetAngle = base + fullTurns * Math.PI * 2 + faces[idx] * (Math.PI * 0.5);
      r.spinningSec = 0.72 + idx * 0.42;
    });
    pendingOutcome = faces;
    playArpeggio([330, 440, 554.37], 0.045, 0.1, "square", 0.055);
    return null;
  }

  return {
    kind: "slot_machine",
    hitMeshes: [hb],
    extraRadius: 0,
    setHovered(action) {
      leverMesh.scale.setScalar(action?.spin ? 1.12 : 1.0);
    },
    onInspectFocus() {
      ensureAudio();
      pullHandle();
    },
    trigger() {
      ensureAudio();
      return pullHandle();
    },
    step(dt) {
      leverPull = Math.max(0, leverPull - dt * 2.8);
      leverPivot.rotation.x = Math.sin(leverPull * Math.PI) * 1.15;

      let stillSpinning = false;
      for (const r of reels) {
        if (r.spinningSec > 0) {
          stillSpinning = true;
          r.spinningSec -= dt;
          if (r.spinningSec <= 0) {
            r.angle = r.targetAngle;
            playTone(587.33, 0.08, "triangle", 0.07);
          } else {
            r.angle += (r.targetAngle - r.angle) * Math.min(1, dt * 6.5);
          }
          r.mesh.rotation.x = r.angle;
        }
      }

      if (!stillSpinning && pendingOutcome) {
        const [a, bSym, c] = pendingOutcome;
        pendingOutcome = null;
        const burstCount = a === bSym && bSym === c ? 18 : a === bSym || bSym === c || a === c ? 7 : 0;
        if (burstCount > 0) {
          playArpeggio(
            burstCount >= 18 ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99],
            0.07,
            0.22,
            "triangle",
            0.085,
          );
          for (let i = 0; i < burstCount; i++) {
            const cm = new THREE.Mesh(coinProto.geometry, coinProto.material);
            cm.position.set((Math.random() - 0.5) * 0.4, Math.max(0.25, reelY - 0.45), frontZ + 0.08);
            root.add(cm);
            coins.push({
              mesh: cm,
              vx: (Math.random() - 0.5) * 1.8,
              vy: 2.2 + Math.random() * 1.6,
              vz: 0.9 + Math.random() * 1.4,
              life: 1.4,
            });
          }
        }
      }

      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.life -= dt;
        if (c.life <= 0) {
          root.remove(c.mesh);
          coins.splice(i, 1);
          continue;
        }
        c.vy -= 9.8 * dt;
        c.mesh.position.x += c.vx * dt;
        c.mesh.position.y += c.vy * dt;
        c.mesh.position.z += c.vz * dt;
        c.mesh.rotation.y += dt * 9;
        if (c.mesh.position.y < 0.06) {
          c.mesh.position.y = 0.06;
          c.vy = Math.abs(c.vy) * 0.45;
        }
      }
    },
    dispose() {
      reelProto.geometry.dispose();
      leverMesh.geometry.dispose();
      coinProto.geometry.dispose();
      hb.geometry.dispose();
    },
  };
}

// ─── 10. Sky-High 3D Voxel Fireworks Mortar Battery ──────────────────────────
const FW_PALETTES = [
  ["#ffe055", "#ff7426"],
  ["#4ce8e0", "#ec8db0"],
  ["#5ef28c", "#9b7bd4"],
];

function createFireworksController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 4);
  const launchY = Math.max(0.75, surf.maxYMeters * 0.85);

  const sparkGeos = FW_PALETTES.flat().map((col, idx) => {
    const v = new Vox(1201 + idx);
    v.box(-1, -1, -1, 1, 1, 1, col, 2.0);
    return buildVoxelMesh(v, { scale: 0.085, castShadow: false, depthLayer: 5 }).geometry;
  });
  const sparkMat = buildVoxelMesh(new Vox(1213).put(0, 0, 0, "#ffe055", 2.0), {
    scale: 0.085,
    castShadow: false,
    depthLayer: 5,
  }).material;

  const hb = makeHitBox(1.8, Math.max(1.4, launchY + 0.5), 1.8, creation.id, { launch: true });
  hb.position.set(0, launchY * 0.5, 0);
  root.add(hb);

  const shells = [];
  const particles = [];
  let idleSalvoTimer = 9.0 + (creation.id.charCodeAt(3) % 7);

  function launchSalvo(count = 3, withAudio = true) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(sparkGeos[(i * 2) % sparkGeos.length], sparkMat);
      m.position.set((i - (count - 1) * 0.5) * 0.35, launchY, 0);
      m.visible = false;
      root.add(m);
      shells.push({
        mesh: m,
        delay: i * 0.28,
        vx: (Math.random() - 0.5) * 1.6,
        vy: 15.5 + Math.random() * 3.8,
        vz: (Math.random() - 0.5) * 1.6,
        fuse: 0.92 + Math.random() * 0.18,
        palIdx: i % FW_PALETTES.length,
        withAudio,
      });
    }
    if (withAudio) {
      playTone(380, 0.25, "sine", 0.05);
    }
  }

  return {
    kind: "fireworks_mortar",
    hitMeshes: [hb],
    extraRadius: 0,
    setHovered() {},
    onInspectFocus() {
      ensureAudio();
      launchSalvo(3, true);
    },
    trigger() {
      ensureAudio();
      launchSalvo(3, true);
      return "Fireworks Mortar — Salvo launched!";
    },
    step(dt) {
      idleSalvoTimer -= dt;
      if (idleSalvoTimer <= 0) {
        launchSalvo(1, false);
        idleSalvoTimer = 16.0;
      }

      for (let i = shells.length - 1; i >= 0; i--) {
        const sh = shells[i];
        if (sh.delay > 0) {
          sh.delay -= dt;
          continue;
        }
        sh.mesh.visible = true;
        sh.fuse -= dt;
        sh.vy -= 4.2 * dt;
        sh.mesh.position.x += sh.vx * dt;
        sh.mesh.position.y += sh.vy * dt;
        sh.mesh.position.z += sh.vz * dt;
        if (sh.fuse <= 0) {
          const origin = sh.mesh.position.clone();
          root.remove(sh.mesh);
          shells.splice(i, 1);
          if (sh.withAudio) {
            playBurstNoise(0.22, 0.065);
            playArpeggio([783.99, 1046.5], 0.06, 0.2, "triangle", 0.045);
          }
          for (let k = 0; k < 28; k++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const spd = 4.2 + Math.random() * 3.4;
            const gIdx = sh.palIdx * 2 + (k % 2);
            const pm = new THREE.Mesh(sparkGeos[gIdx], sparkMat);
            pm.position.copy(origin);
            root.add(pm);
            particles.push({
              mesh: pm,
              vx: Math.sin(phi) * Math.cos(theta) * spd,
              vy: Math.cos(phi) * spd,
              vz: Math.sin(phi) * Math.sin(theta) * spd,
              life: 1.15 + Math.random() * 0.35,
            });
          }
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          root.remove(p.mesh);
          particles.splice(i, 1);
          continue;
        }
        p.vx *= 1 - dt * 1.4;
        p.vz *= 1 - dt * 1.4;
        p.vy = p.vy * (1 - dt * 1.1) - 3.8 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.scale.setScalar(Math.max(0.15, Math.min(1, p.life)));
      }
    },
    dispose() {
      sparkGeos.forEach((g) => g.dispose());
      hb.geometry.dispose();
    },
  };
}

// ─── 11. High-Voltage 3D Voxel Tesla Lightning Coil ──────────────────────────
function createTeslaCoilController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 4);
  const topY = Math.max(1.6, surf.maxYMeters * 0.92);
  const rodR = Math.max(1.2, (surf.bounds.maxX - surf.bounds.minX) * 0.5 * surf.voxScale + 0.35);

  const buildArcVariant = (seed, angle) => {
    const v = new Vox(1230 + seed);
    const s = 0.085;
    const x1 = Math.cos(angle) * rodR;
    const z1 = Math.sin(angle) * rodR;
    const y0 = topY / s;
    let px = 0;
    let py = y0;
    let pz = 0;
    for (let seg = 1; seg <= 6; seg++) {
      const u = seg / 6;
      const jitter = seg < 6 ? (((seed * 17 + seg * 31) % 7) - 3) * 1.4 : 0;
      const nx = (x1 / s) * u + Math.sin(angle) * jitter;
      const ny = y0 * (1 - u) + 2;
      const nz = (z1 / s) * u - Math.cos(angle) * jitter;
      v.line(px, py, pz, nx, ny, nz, 0.4, seg % 2 === 0 ? "#64f5df" : "#b58cff", 2.1);
      px = nx;
      py = ny;
      pz = nz;
    }
    return buildVoxelMesh(v, { scale: s, castShadow: false, depthLayer: 5 });
  };

  const arcs = [];
  for (let i = 0; i < 6; i++) {
    const m = buildArcVariant(i, (i / 6) * Math.PI * 2);
    m.visible = false;
    root.add(m);
    arcs.push(m);
  }

  const hb = makeHitBox(rodR * 1.8, topY + 0.5, rodR * 1.8, creation.id, { zap: true });
  hb.position.set(0, topY * 0.5, 0);
  root.add(hb);

  let energizedSec = 1.5;
  let flickerAccum = 0;

  return {
    kind: "tesla_coil",
    hitMeshes: [hb],
    extraRadius: 0,
    setHovered() {},
    onInspectFocus() {
      ensureAudio();
      energizedSec = 5.5;
      playBurstNoise(0.18, 0.05);
      playArpeggio([110, 220, 440], 0.04, 0.25, "sawtooth", 0.045);
    },
    trigger() {
      ensureAudio();
      energizedSec = 5.5;
      playBurstNoise(0.2, 0.055);
      playArpeggio([146.83, 293.66, 587.33], 0.04, 0.26, "sawtooth", 0.05);
      return "Tesla Coil — 500,000V voxel arc discharge!";
    },
    step(dt, t) {
      if (energizedSec > 0) {
        energizedSec -= dt;
        flickerAccum += dt;
        if (flickerAccum >= 0.065) {
          flickerAccum = 0;
          const a = Math.floor(Math.random() * arcs.length);
          const b = (a + 2 + Math.floor(Math.random() * 3)) % arcs.length;
          arcs.forEach((m, idx) => {
            m.visible = idx === a || idx === b;
            m.rotation.y = Math.sin(t * 9 + idx) * 0.25;
          });
        }
        if (energizedSec <= 0) {
          arcs.forEach((m) => {
            m.visible = false;
          });
        }
      } else if (Math.sin(t * 1.7) > 0.985) {
        // Occasional brief static crackle
        energizedSec = 0.24;
      }
    },
    dispose() {
      arcs.forEach((m) => m.geometry.dispose());
      hb.geometry.dispose();
    },
  };
}

// ─── 12. Anti-Gravity 180° Levitating Inverter ───────────────────────────────
function createGravityInverterController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 4);
  const halfH = Math.max(1.2, surf.maxYMeters);
  const ringR = Math.max(1.2, (surf.bounds.maxX - surf.bounds.minX) * 0.45 * surf.voxScale);

  const rv = new Vox(1259);
  rv.ringAxis("y", 0, 0, 0, 1, Math.round(ringR / 0.1), Math.max(2, Math.round(ringR / 0.1) - 1), "#9b7bd4", 1.8);
  const antiGravRing = buildVoxelMesh(rv, { scale: 0.1, castShadow: false, depthLayer: 5 });
  antiGravRing.visible = false;
  root.add(antiGravRing);

  const hb = makeHitBox(ringR * 2.1, halfH + 0.8, ringR * 2.1, creation.id, { flip: true });
  hb.position.set(0, halfH * 0.5, 0);
  root.add(hb);

  let inverted = false;
  let blend = 0;

  return {
    kind: "gravity_inverter",
    hitMeshes: [hb],
    extraRadius: 0,
    setHovered() {},
    onInspectFocus() {
      ensureAudio();
      inverted = !inverted;
      playArpeggio(inverted ? [261.63, 392, 523.25, 783.99] : [783.99, 523.25, 392, 261.63], 0.06, 0.2, "sine", 0.065);
    },
    trigger() {
      ensureAudio();
      inverted = !inverted;
      playArpeggio(inverted ? [261.63, 392, 523.25, 783.99] : [783.99, 523.25, 392, 261.63], 0.06, 0.2, "sine", 0.065);
      return inverted ? "Gravity Inverter — Flipped upside-down!" : "Gravity Inverter — Gravity restored!";
    },
    getPoseOffset(t) {
      if (blend <= 0.002) return null;
      const ease = blend * blend * (3 - 2 * blend);
      return {
        liftY: ease * (halfH + 1.15) + Math.sin(t * 2.4) * 0.16 * ease,
        rollZ: ease * Math.PI,
      };
    },
    step(dt, t) {
      const goal = inverted ? 1 : 0;
      blend += (goal - blend) * Math.min(1, dt * 3.4);
      antiGravRing.visible = blend > 0.04;
      if (antiGravRing.visible) {
        antiGravRing.rotation.y = t * 2.8;
        antiGravRing.position.y = 0.25 + Math.sin(t * 4.0) * 0.12;
      }
    },
    dispose() {
      antiGravRing.geometry.dispose();
      hb.geometry.dispose();
    },
  };
}

// ─── 13. Musical Helical 3D Voxel Marble Run Cascade ─────────────────────────
function createMarbleRunController(creation, group) {
  const root = new THREE.Group();
  group.add(root);

  const surf = inspectCenterDeckSurface(group, 4);
  const peakY = Math.max(1.8, surf.maxYMeters * 0.95);
  const orbitR = Math.max(0.85, (surf.bounds.maxX - surf.bounds.minX) * 0.48 * surf.voxScale + 0.18);

  const colors = ["#ff5a4f", "#ffe055", "#5ef28c", "#4ce8e0", "#ec8db0"];
  const marbleProtos = colors.map((c, idx) => {
    const v = new Vox(1277 + idx);
    v.sphere(0, 0, 0, 1.8, 1.8, 1.8, c, 1.45);
    return buildVoxelMesh(v, { scale: 0.065, depthLayer: 5 });
  });

  const hb = makeHitBox(orbitR * 2.2, peakY + 0.4, orbitR * 2.2, creation.id, { drop: true });
  hb.position.set(0, peakY * 0.5, 0);
  root.add(hb);

  const marbles = [];
  const chimeNotes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
  let autoTimer = 6.0;

  function dropCascade(count = 5, withAudio = true) {
    for (let i = 0; i < count; i++) {
      const proto = marbleProtos[i % marbleProtos.length];
      const m = new THREE.Mesh(proto.geometry, proto.material);
      m.visible = false;
      root.add(m);
      marbles.push({
        mesh: m,
        delay: i * 0.24,
        u: 0,
        lastTier: 0,
        withAudio,
      });
    }
  }

  return {
    kind: "marble_run",
    hitMeshes: [hb],
    extraRadius: 0,
    setHovered() {},
    onInspectFocus() {
      ensureAudio();
      dropCascade(5, true);
    },
    trigger() {
      ensureAudio();
      dropCascade(6, true);
      return "Marble Run — Cascading glowing voxel marbles!";
    },
    step(dt) {
      autoTimer -= dt;
      if (autoTimer <= 0 && marbles.length === 0) {
        dropCascade(2, false);
        autoTimer = 11.0;
      }
      for (let i = marbles.length - 1; i >= 0; i--) {
        const mb = marbles[i];
        if (mb.delay > 0) {
          mb.delay -= dt;
          continue;
        }
        mb.mesh.visible = true;
        mb.u += dt * 0.36;
        if (mb.u >= 1) {
          root.remove(mb.mesh);
          marbles.splice(i, 1);
          continue;
        }
        const turns = 3.5;
        const ang = mb.u * Math.PI * 2 * turns;
        const r = orbitR * (0.45 + 0.55 * mb.u);
        const bounce = Math.abs(Math.sin(mb.u * Math.PI * 6)) * 0.08;
        mb.mesh.position.set(Math.cos(ang) * r, peakY * (1 - mb.u) + 0.14 + bounce, Math.sin(ang) * r);

        const tier = Math.floor(mb.u * 6);
        if (tier > mb.lastTier) {
          mb.lastTier = tier;
          if (mb.withAudio) {
            playTone(chimeNotes[tier % chimeNotes.length], 0.12, "sine", 0.055);
          }
        }
      }
    },
    dispose() {
      marbleProtos.forEach((p) => p.geometry.dispose());
      hb.geometry.dispose();
    },
  };
}

// ─── Factory Dispatcher ──────────────────────────────────────────────────────
export function createInteractiveController(creation, group, onEvent = null) {
  const kind = creation?.blueprint?.interaction?.kind;
  if (!kind) return null;
  switch (kind) {
    case "tic_tac_toe":
      return createTicTacToeController(creation, group, onEvent);
    case "connect_four":
      return createConnectFourController(creation, group, onEvent);
    case "whack_a_mole":
      return createWhackAMoleController(creation, group);
    case "floor_piano":
      return createFloorPianoController(creation, group);
    case "simon_synth":
      return createSimonSynthController(creation, group);
    case "lights_out":
      return createLightsOutController(creation, group);
    case "step_sequencer":
      return createStepSequencerController(creation, group);
    case "basketball_hoop":
      return createBasketballController(creation, group);
    case "slot_machine":
      return createSlotMachineController(creation, group);
    case "fireworks_mortar":
      return createFireworksController(creation, group);
    case "tesla_coil":
      return createTeslaCoilController(creation, group);
    case "gravity_inverter":
      return createGravityInverterController(creation, group);
    case "marble_run":
      return createMarbleRunController(creation, group);
    default:
      return null;
  }
}

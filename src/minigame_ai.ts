import type { AppEnv } from "./env_types";
import { callHermesAgentForJson } from "./hermes_agent_client";
import { redactSecrets, safeLogWarn, sanitizePlainText } from "./security";

export type MinigameAiKind = "tic_tac_toe" | "connect_four";

export interface MinigameMoveRequest {
  game: MinigameAiKind;
  board?: number[];
  grid?: number[][];
  creationName?: string;
}

export interface MinigameMoveResult {
  move: number;
  quip: string;
  modelUsed: string;
  latencyMs: number;
}

function formatTicTacToePrompt(board: number[], validMoves: number[], creationName?: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  const sym = (idx: number) => (board[idx] === 1 ? "X" : board[idx] === 2 ? "O" : String(idx));
  const ascii = [
    ` ${sym(0)} | ${sym(1)} | ${sym(2)} `,
    `---+---+---`,
    ` ${sym(3)} | ${sym(4)} | ${sym(5)} `,
    `---+---+---`,
    ` ${sym(6)} | ${sym(7)} | ${sym(8)} `,
  ].join("\n");

  const systemPrompt = [
    "You are the Hermes Island park games AI, playing Naughts & Crosses (Tic-Tac-Toe) at a stone park game table in a sunlit 3D voxel village.",
    "You play 'O'. The human visitor plays 'X'.",
    "Play sharp, competitive Naughts & Crosses:",
    "1. If you have 2 'O's in a row/column/diagonal with an open 3rd cell, take the winning move immediately.",
    "2. Otherwise, if the human has 2 'X's in a row/column/diagonal with an open 3rd cell, block it immediately.",
    "3. Otherwise, play strong positional strategy (center 4, corners 0/2/6/8, forks, or blocking forks).",
    'Return ONLY JSON matching {"move": <integer 0..8>, "quip": "<witty friendly 2-6 word park remark>"}.',
  ].join("\n");

  const userPrompt = [
    creationName ? `Table: ${creationName}` : "Table: Park Tic-Tac-Toe Table",
    "Current 3x3 board (numbers show empty cell indices):",
    ascii,
    `Legal empty cell indices: [${validMoves.join(", ")}]`,
    "Choose your move index from the legal empty cell indices.",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function formatConnectFourPrompt(grid: number[][], validCols: number[], creationName?: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  // grid is 7 columns x 6 rows (row 0 = bottom, row 5 = top)
  const rowsAscii: string[] = [];
  for (let r = 5; r >= 0; r--) {
    const cells: string[] = [];
    for (let c = 0; c < 7; c++) {
      const v = grid[c][r];
      cells.push(v === 1 ? "X" : v === 2 ? "O" : ".");
    }
    rowsAscii.push(`r${r} | ${cells.join(" ")} |`);
  }
  rowsAscii.push("   +---------------+");
  rowsAscii.push("col  0 1 2 3 4 5 6");

  const landingDesc = validCols.map((c) => `col ${c} (lands at r${grid[c].indexOf(0)})`).join(", ");

  const systemPrompt = [
    "You are the Hermes Island park games AI, playing 7x6 Connect Four on an outdoor voxel frame in a sunlit 3D voxel village.",
    "You play 'O' (Gold). The human visitor plays 'X' (Red). Gravity drops each disc to the lowest empty row in the chosen column.",
    "Play strong tactical Connect Four:",
    "1. If dropping 'O' in any legal column completes 4-in-a-row horizontally, vertically, or diagonally, play that winning column immediately.",
    "2. Otherwise, if the human 'X' would complete 4-in-a-row on their next drop in a legal column, block that column immediately.",
    "3. Avoid playing a column whose next row directly above gifts 'X' an immediate 4-in-a-row.",
    "4. Prefer center columns (3, then 2/4) and building connected threats.",
    'Return ONLY JSON matching {"move": <integer 0..6>, "quip": "<witty friendly 2-6 word park remark>"}.',
  ].join("\n");

  const userPrompt = [
    creationName ? `Table: ${creationName}` : "Table: Connect Four Plaza Frame",
    "Current 7x6 frame (r5 = top, r0 = bottom):",
    rowsAscii.join("\n"),
    `Legal columns: ${landingDesc}`,
    `Choose one legal column integer from [${validCols.join(", ")}].`,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function validateMinigameRequest(raw: Record<string, unknown>): {
  ok: true;
  req: MinigameMoveRequest;
  validMoves: number[];
} | {
  ok: false;
  error: string;
} {
  const game = raw.game;
  const creationName = sanitizePlainText(raw.creationName, 64);

  if (game === "tic_tac_toe") {
    if (!Array.isArray(raw.board) || raw.board.length !== 9) {
      return { ok: false, error: "Invalid tic_tac_toe board." };
    }
    const board: number[] = [];
    const validMoves: number[] = [];
    for (let i = 0; i < 9; i++) {
      const v = Number(raw.board[i]);
      if (v !== 0 && v !== 1 && v !== 2) {
        return { ok: false, error: "Invalid cell value in tic_tac_toe board." };
      }
      board.push(v);
      if (v === 0) validMoves.push(i);
    }
    if (validMoves.length === 0) {
      return { ok: false, error: "No legal moves remaining." };
    }
    return {
      ok: true,
      req: { game: "tic_tac_toe", board, creationName },
      validMoves,
    };
  }

  if (game === "connect_four") {
    if (!Array.isArray(raw.grid) || raw.grid.length !== 7) {
      return { ok: false, error: "Invalid connect_four grid." };
    }
    const grid: number[][] = [];
    const validMoves: number[] = [];
    for (let c = 0; c < 7; c++) {
      const colRaw = raw.grid[c];
      if (!Array.isArray(colRaw) || colRaw.length !== 6) {
        return { ok: false, error: "Invalid column in connect_four grid." };
      }
      const col: number[] = [];
      for (let r = 0; r < 6; r++) {
        const v = Number(colRaw[r]);
        if (v !== 0 && v !== 1 && v !== 2) {
          return { ok: false, error: "Invalid disc value in connect_four grid." };
        }
        col.push(v);
      }
      grid.push(col);
      if (col.indexOf(0) !== -1) validMoves.push(c);
    }
    if (validMoves.length === 0) {
      return { ok: false, error: "No legal columns remaining." };
    }
    return {
      ok: true,
      req: { game: "connect_four", grid, creationName },
      validMoves,
    };
  }

  return { ok: false, error: "Unsupported minigame kind." };
}

export async function chooseMoveWithAgent(opts: {
  env: AppEnv;
  req: MinigameMoveRequest;
  validMoves: number[];
}): Promise<MinigameMoveResult> {
  const t0 = Date.now();
  const { systemPrompt, userPrompt } =
    opts.req.game === "tic_tac_toe"
      ? formatTicTacToePrompt(opts.req.board!, opts.validMoves, opts.req.creationName)
      : formatConnectFourPrompt(opts.req.grid!, opts.validMoves, opts.req.creationName);

  const validSet = new Set(opts.validMoves);

  try {
    const res = await callHermesAgentForJson({
      env: opts.env,
      mode: "minigame",
      callerLabel: `minigame_${opts.req.game}`,
      systemPrompt,
      userText: userPrompt,
      temperature: 0.3,
      maxOutputTokens: 256,
      maxCascadeMs: 20_000,
      validateJson: (candidate) => {
        const move = Math.trunc(Number(candidate.move));
        if (!validSet.has(move)) {
          return `move ${String(candidate.move)} is not one of the legal moves [${opts.validMoves.join(", ")}]`;
        }
        return null;
      },
    });

    const rawMove = Math.trunc(Number(res.json.move));
    const quip = sanitizePlainText(res.json.quip, 56);
    if (validSet.has(rawMove)) {
      return {
        move: rawMove,
        quip,
        modelUsed: res.modelUsed,
        latencyMs: Math.max(1, Date.now() - t0),
      };
    }
  } catch (err) {
    safeLogWarn(
      "minigame_agent_fallback",
      `Hermes agent move attempt failed (${redactSecrets(err, [opts.env.HERMES_AGENT_TOKEN]).slice(0, 200)}); selecting legal fallback move`,
      [opts.env.HERMES_AGENT_TOKEN],
    );
  }

  const fallbackMove = opts.validMoves[Math.floor(opts.validMoves.length / 2)] ?? opts.validMoves[0];
  return {
    move: fallbackMove,
    quip: "",
    modelUsed: "fallback-legal",
    latencyMs: Math.max(1, Date.now() - t0),
  };
}

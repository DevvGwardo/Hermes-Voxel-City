import { GoogleGenAI, Type } from "@google/genai";
import { extractJsonObject, isHydrogenModel, parseModelList } from "./gemini_models";
import { redactSecrets, safeLogWarn, sanitizePlainText } from "./security";

export const DEFAULT_FLASH_LITE_MODELS = [
  "hydrogen-l",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
] as const;

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

let cachedFlashLiteModel: string | null = null;
const skipThinkingConfigModels = new Set<string>();

function buildFlashLiteModelOrder(configured?: string): string[] {
  const custom = parseModelList(configured);
  const raw = [
    ...(cachedFlashLiteModel ? [cachedFlashLiteModel] : []),
    ...custom,
    ...DEFAULT_FLASH_LITE_MODELS,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of raw) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
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
    "You are Gemini Flash-Lite, playing Naughts & Crosses (Tic-Tac-Toe) at a stone park game table in GeminIsland (a sunlit 3D voxel village).",
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
    "You are Gemini Flash-Lite, playing 7x6 Connect Four on an outdoor voxel frame in GeminIsland.",
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

async function callSingleFlashLiteModel(opts: {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  withZeroThinking: boolean;
  timeoutMs: number;
}): Promise<{
  ok: true;
  rawText: string;
} | {
  ok: false;
  httpStatus?: number;
  errorBody?: string;
  reason: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const ai = new GoogleGenAI({
      apiKey: opts.apiKey || process.env.GEMINI_API_KEY || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    const hydrogen = isHydrogenModel(opts.model);
    const isNoTempModel = /^gemini-(?:4|3\.8)/i.test(opts.model);
    const config: Record<string, unknown> = {
      systemInstruction: opts.systemPrompt,
      ...(isNoTempModel ? {} : { temperature: 0.3 }),
      maxOutputTokens: hydrogen ? 2048 : 128,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          move: { type: Type.INTEGER },
          quip: { type: Type.STRING },
        },
        required: ["move"],
      },
      abortSignal: controller.signal,
    };
    if (opts.withZeroThinking && !isNoTempModel && !hydrogen) {
      config.thinkingConfig = /^gemini-3/i.test(opts.model)
        ? { thinkingLevel: "MINIMAL" }
        : { thinkingBudget: 0 };
    }

    const response = await ai.models.generateContent({
      model: opts.model,
      contents: opts.userPrompt,
      config,
    });
    clearTimeout(timer);

    const parts = response?.candidates?.[0]?.content?.parts ?? [];
    let nonThought = "";
    let all = "";
    for (const p of parts) {
      if (typeof p.text === "string") {
        all += p.text;
        if (!p.thought) nonThought += p.text;
      }
    }
    return {
      ok: true,
      rawText: nonThought.trim() || all.trim() || (response.text ?? "").trim(),
    };
  } catch (err) {
    clearTimeout(timer);
    const errText = redactSecrets(err, [opts.apiKey]);
    const statusMatch = errText.match(/\b(400|403|404|429|500|503)\b/);
    const parsedStatus = statusMatch ? Number(statusMatch[1]) : undefined;
    return {
      ok: false,
      httpStatus: parsedStatus,
      errorBody: errText,
      reason: controller.signal.aborted ? `Timeout(${opts.timeoutMs}ms)` : errText.slice(0, 140),
    };
  }
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

export async function chooseMoveWithGeminiFlashLite(opts: {
  apiKey: string;
  configuredModel?: string;
  req: MinigameMoveRequest;
  validMoves: number[];
}): Promise<MinigameMoveResult> {
  const t0 = Date.now();
  const { systemPrompt, userPrompt } =
    opts.req.game === "tic_tac_toe"
      ? formatTicTacToePrompt(opts.req.board!, opts.validMoves, opts.req.creationName)
      : formatConnectFourPrompt(opts.req.grid!, opts.validMoves, opts.req.creationName);

  const models = buildFlashLiteModelOrder(opts.configuredModel);
  const validSet = new Set(opts.validMoves);
  const errors: string[] = [];

  for (const model of models) {
    const tryZeroThinking = !skipThinkingConfigModels.has(model);
    let res = await callSingleFlashLiteModel({
      model,
      apiKey: opts.apiKey,
      systemPrompt,
      userPrompt,
      withZeroThinking: tryZeroThinking,
      timeoutMs: 4_500,
    });

    if (
      tryZeroThinking &&
      !res.ok &&
      res.httpStatus === 400 &&
      res.errorBody &&
      /thinking|schema/i.test(res.errorBody)
    ) {
      skipThinkingConfigModels.add(model);
      res = await callSingleFlashLiteModel({
        model,
        apiKey: opts.apiKey,
        systemPrompt,
        userPrompt,
        withZeroThinking: false,
        timeoutMs: 4_500,
      });
    }

    if (!res.ok) {
      errors.push(`${model}(${res.reason})`);
      continue;
    }

    try {
      const parsed = extractJsonObject(res.rawText);
      const rawMove = Math.trunc(Number(parsed.move));
      const quip = sanitizePlainText(parsed.quip, 56);
      if (validSet.has(rawMove)) {
        cachedFlashLiteModel = model;
        return {
          move: rawMove,
          quip,
          modelUsed: model,
          latencyMs: Math.max(1, Date.now() - t0),
        };
      }
      errors.push(`${model}(illegal move ${String(parsed.move)})`);
    } catch (parseErr) {
      errors.push(`${model}(parse: ${redactSecrets(parseErr, [opts.apiKey]).slice(0, 60)})`);
    }
  }

  safeLogWarn(
    "minigame_flash_lite_fallback",
    `All Flash-Lite attempts failed (${errors.join(" -> ")}); selecting legal fallback move`,
    [opts.apiKey],
  );
  const fallbackMove = opts.validMoves[Math.floor(opts.validMoves.length / 2)] ?? opts.validMoves[0];
  return {
    move: fallbackMove,
    quip: "",
    modelUsed: "fallback-legal",
    latencyMs: Math.max(1, Date.now() - t0),
  };
}

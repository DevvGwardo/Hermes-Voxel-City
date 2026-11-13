/**
 * Adaptive Build Telemetry & Survival-Conditional ETA Micro-Engine
 *
 * Learns from real completed GeminIsland builds persisted in WorldDO SQLite (`build_telemetry`),
 * stratified by prompt/image complexity and recency-weighted so recent agent speed shifts
 * adapt within a few builds.
 *
 * Eliminates early countdown stalls via two mechanisms:
 *  1. Initial estimates blend EWMA mean + rolling P75 (`0.38 * mean + 0.62 * p75`), so ~75% of
 *     builds finish at or ahead of the initial timer rather than half of builds overrunning.
 *  2. Live remaining time uses a C1-continuous Generalized Pareto (Lomax) survival tail calibrated
 *     to empirical P90 + real-time phase transitions when Argon enters Round-2 refinement.
 */

export type BuildComplexityBucket = "compact" | "standard" | "complex";
export type ActiveBuildPhase = "approving" | "sculpting" | "reviewing" | "refining" | "placing";

export interface BuildTelemetrySample {
  durationMs: number;
  round1Ms: number;
  hadRefinementPass: boolean;
  usedFallback: boolean;
  hasImage: boolean;
  complexity: BuildComplexityBucket;
  createdAt: number;
}

export interface BuildFeatureProfile {
  complexity: BuildComplexityBucket;
  hasImage: boolean;
}

export interface BuildEtaTelemetrySummary {
  realSampleCount: number;
  meanMs: number;
  medianMs: number;
  p75Ms: number;
  p90Ms: number;
  refinementRate: number;
  estimatesSec: {
    compact: number;
    standard: number;
    complex: number;
    withImage: number;
  };
}

const COMPLEX_PROMPT_RE =
  /\b(volcano|waterfall|castle|cathedral|palace|citadel|fortress|colosseum|stadium|datacentre|data\s*cent(?:er|re)|skyscraper|clock\s*tower|dragon|wyvern|phoenix|spaceship|starship|galleon|pirate\s*ship|roller\s*coaster|ferris\s*wheel|mountain|canyon|glacier|temple|bridge|train\s*station|airport|factory|observatory|lighthouse|mech|leviathan|kraken)\b/i;

const COMPACT_PROMPT_RE =
  /\b(tiny|mini|small|little|micro|mushroom|toadstool|mailbox|postbox|lantern|lamp|bench|signpost|flower|tulip|sunflower|rose|rock|pebble|boulder|bush|shrub|hydrant|barrel|crate|campfire|bonfire|birdhouse|snowman|cactus|bonsai|chair|stool|table|cat|kitten|dog|puppy|duck|frog|bunny|rabbit|squirrel|hedgehog|owl|bee|butterfly|chest|bicycle|scooter|skateboard)\b/i;

/**
 * Cold-start Bayesian prior pseudo-samples (ms) calibrated to `hydrogen-l` micro-voxel
 * sculpting + 3D critic review latencies. Their weight decays automatically as real builds accumulate in SQLite.
 */
const PRIOR_TOTAL_SAMPLES: Record<BuildComplexityBucket, number[]> = {
  compact: [30_000, 36_000, 42_000, 52_000],
  standard: [38_000, 46_000, 54_000, 68_000],
  complex: [48_000, 58_000, 70_000, 92_000],
};

const PRIOR_REFINEMENT_R2_MS = [28_000, 35_000, 44_000, 56_000];

const MIN_VALID_SAMPLE_MS = 4_000;
const MAX_VALID_SAMPLE_MS = 240_000;
const RECENCY_DECAY = 0.94; // half-life ~11 builds

interface WeightedPoint {
  ms: number;
  w: number;
}

export function classifyBuildFeatures(prompt: string, hasImage: boolean): BuildFeatureProfile {
  const clean = (prompt || "").trim();
  if (hasImage) {
    return { complexity: "complex", hasImage: true };
  }
  if (COMPLEX_PROMPT_RE.test(clean) || clean.length > 135) {
    return { complexity: "complex", hasImage: false };
  }
  if (COMPACT_PROMPT_RE.test(clean) && clean.length <= 75) {
    return { complexity: "compact", hasImage: false };
  }
  return { complexity: "standard", hasImage: false };
}

function sanitizeHistory(history: BuildTelemetrySample[]): BuildTelemetrySample[] {
  return history
    .filter(
      (s) =>
        Number.isFinite(s.durationMs) &&
        s.durationMs >= MIN_VALID_SAMPLE_MS &&
        s.durationMs <= MAX_VALID_SAMPLE_MS,
    )
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 90);
}

function computeWeightedStats(points: WeightedPoint[]): {
  mean: number;
  p50: number;
  p75: number;
  p90: number;
} {
  if (points.length === 0) {
    return { mean: 48_000, p50: 46_000, p75: 55_000, p90: 70_000 };
  }
  const sorted = points
    .filter((p) => p.w > 0 && Number.isFinite(p.ms))
    .slice()
    .sort((a, b) => a.ms - b.ms);

  if (sorted.length === 0) {
    return { mean: 48_000, p50: 46_000, p75: 55_000, p90: 70_000 };
  }

  let totalW = 0;
  let weightedSum = 0;
  for (const p of sorted) {
    totalW += p.w;
    weightedSum += p.ms * p.w;
  }
  const mean = weightedSum / totalW;

  // Midpoint cumulative weight centers for smooth continuous quantile interpolation
  const centers: number[] = [];
  let acc = 0;
  for (const p of sorted) {
    centers.push((acc + p.w * 0.5) / totalW);
    acc += p.w;
  }

  const quantileAt = (q: number): number => {
    if (sorted.length === 1) return sorted[0].ms;
    if (q <= centers[0]) return sorted[0].ms;
    const last = sorted.length - 1;
    if (q >= centers[last]) return sorted[last].ms;
    for (let i = 0; i < last; i++) {
      const c0 = centers[i];
      const c1 = centers[i + 1];
      if (q >= c0 && q <= c1) {
        const span = Math.max(1e-6, c1 - c0);
        const t = (q - c0) / span;
        return sorted[i].ms + t * (sorted[i + 1].ms - sorted[i].ms);
      }
    }
    return sorted[last].ms;
  };

  return {
    mean,
    p50: quantileAt(0.5),
    p75: quantileAt(0.75),
    p90: quantileAt(0.9),
  };
}

function profileSpeedFactor(profile: BuildFeatureProfile): number {
  if (profile.hasImage) return 1.44;
  if (profile.complexity === "complex") return 1.28;
  if (profile.complexity === "compact") return 0.78;
  return 1.0;
}

function buildFeatureDistribution(
  features: BuildFeatureProfile,
  cleanHistory: BuildTelemetrySample[],
): { mean: number; p50: number; p75: number; p90: number } {
  const points: WeightedPoint[] = [];
  const targetFactor = profileSpeedFactor(features);

  for (let i = 0; i < cleanHistory.length; i++) {
    const s = cleanHistory[i];
    const recencyW = Math.pow(RECENCY_DECAY, i);
    const sampleFactor = profileSpeedFactor({ complexity: s.complexity, hasImage: s.hasImage });
    let affinityW = 0.85;
    let normalizedMs = s.durationMs * (targetFactor / sampleFactor);
    if (s.complexity === features.complexity && s.hasImage === features.hasImage) {
      affinityW = 2.4;
      normalizedMs = s.durationMs;
    } else if (s.complexity === features.complexity) {
      affinityW = 1.5;
    }
    points.push({ ms: normalizedMs, w: recencyW * affinityW });
  }

  // Smoothly fade cold-start priors out as real GeminIsland telemetry rows accumulate
  const priorUnitWeight = Math.max(0.06, 1 / (1 + cleanHistory.length * 0.55));
  const priorList = PRIOR_TOTAL_SAMPLES[features.complexity] || PRIOR_TOTAL_SAMPLES.standard;
  const imageBump = features.hasImage ? 1.12 : 1.0;
  for (const ms of priorList) {
    points.push({ ms: ms * imageBump, w: priorUnitWeight });
  }

  return computeWeightedStats(points);
}

function buildRefinementPass2Distribution(cleanHistory: BuildTelemetrySample[]): {
  mean: number;
  p75: number;
  p90: number;
} {
  const points: WeightedPoint[] = [];
  const refined = cleanHistory.filter(
    (s) => s.hadRefinementPass && s.durationMs > s.round1Ms + 3_000,
  );
  for (let i = 0; i < refined.length; i++) {
    const r2Ms = refined[i].durationMs - refined[i].round1Ms;
    points.push({ ms: r2Ms, w: Math.pow(RECENCY_DECAY, i) * 1.8 });
  }
  const priorW = Math.max(0.1, 1 / (1 + refined.length * 0.65));
  for (const ms of PRIOR_REFINEMENT_R2_MS) {
    points.push({ ms, w: priorW });
  }
  const st = computeWeightedStats(points);
  return { mean: st.mean, p75: st.p75, p90: st.p90 };
}

/**
 * Estimates initial total sculpt duration (ms) for a job before it starts or at t=0.
 * Uses 38% weighted mean + 62% weighted P75 so ~3 out of 4 builds finish before 0s.
 */
export function estimateInitialBuildMs(
  features: BuildFeatureProfile,
  history: BuildTelemetrySample[],
): number {
  const clean = sanitizeHistory(history);
  const stats = buildFeatureDistribution(features, clean);
  const target = stats.mean * 0.38 + stats.p75 * 0.62;
  return Math.max(12_000, Math.min(180_000, Math.round(target)));
}

/**
 * C1-continuous Generalized Pareto (Lomax) survival tail:
 * - For `elapsed <= 0.60 * baseTotal`: exact 1:1 countdown (`baseTotal - elapsed`).
 * - Beyond `0.60 * baseTotal`: smoothly decelerates with slope matching `-1` at the join point,
 *   calibrated to the empirical P90 tail so slow builds never slam into `~3s` and freeze.
 */
function evaluateLomaxRemainingMs(
  elapsedMs: number,
  baseTotalMs: number,
  p90Ms: number,
  floorMs = 4_500,
): number {
  const t = Math.max(0, elapsedMs);
  const tJoin = baseTotalMs * 0.6;
  if (t <= tJoin) {
    return Math.round(baseTotalMs - t);
  }

  const rJoin = Math.max(floorMs + 2_000, baseTotalMs - tJoin);
  const spanA = rJoin - floorMs;
  const tau = t - tJoin;

  // Calibrate Pareto shape k from empirical tail ratio (heavier P90/base ratio -> gentler decay k)
  const tailRatio = Math.max(1.08, p90Ms / Math.max(1, baseTotalMs));
  const k = Math.max(0.75, Math.min(2.6, 1.45 / Math.max(0.35, tailRatio - 0.72)));

  const lomaxRem = floorMs + spanA * Math.pow(1 + tau / (k * spanA), -k);
  return Math.max(floorMs, Math.round(lomaxRem));
}

/**
 * Computes survival-conditional remaining ms for an actively sculpting or refining job.
 */
export function estimateRemainingBuildMs(opts: {
  elapsedMs: number;
  phase?: ActiveBuildPhase | string | null;
  round1Ms?: number | null;
  features: BuildFeatureProfile;
  history: BuildTelemetrySample[];
}): number {
  const clean = sanitizeHistory(opts.history);
  const elapsed = Math.max(0, opts.elapsedMs);

  if (opts.phase === "reviewing") {
    const r1 = typeof opts.round1Ms === "number" && opts.round1Ms > 0 ? opts.round1Ms : elapsed;
    const revElapsed = Math.max(0, elapsed - r1);
    return evaluateLomaxRemainingMs(revElapsed, 9_500, 16_000, 4_000);
  }

  if (opts.phase === "refining") {
    const r1 = typeof opts.round1Ms === "number" && opts.round1Ms > 0 ? opts.round1Ms : elapsed;
    const r2Elapsed = Math.max(0, elapsed - r1);
    const r2Stats = buildRefinementPass2Distribution(clean);
    const r2Base = Math.max(14_000, Math.round(r2Stats.mean * 0.4 + r2Stats.p75 * 0.6));
    return evaluateLomaxRemainingMs(r2Elapsed, r2Base, Math.max(r2Base * 1.25, r2Stats.p90), 4_500);
  }

  const stats = buildFeatureDistribution(opts.features, clean);
  const baseTotal = Math.max(12_000, Math.round(stats.mean * 0.38 + stats.p75 * 0.62));
  const tailP90 = Math.max(baseTotal * 1.18, stats.p90);
  return evaluateLomaxRemainingMs(elapsed, baseTotal, tailP90, 4_500);
}

export interface QueuedSlotInput {
  elapsedMs: number;
  phase?: ActiveBuildPhase | string | null;
  round1Ms?: number | null;
  simDelayMs?: number | null;
  features: BuildFeatureProfile;
}

export interface QueuedWaitItemInput {
  jobId: string;
  simDelayMs?: number | null;
  features: BuildFeatureProfile;
}

/**
 * Simulates multi-worker FIFO completion across `workerConcurrency` active slots to estimate
 * total time until `targetJobId` finishes (wait time in queue + its own sculpt duration).
 */
export function estimateMultiSlotQueueEtaMs(opts: {
  workerConcurrency: number;
  activeSlots: QueuedSlotInput[];
  queuedItems: QueuedWaitItemInput[];
  targetJobId: string;
  targetFallbackFeatures: BuildFeatureProfile;
  history: BuildTelemetrySample[];
}): { position: number; totalEtaMs: number } {
  const clean = sanitizeHistory(opts.history);
  const slotRemaining: number[] = [];

  for (let s = 0; s < opts.workerConcurrency; s++) {
    const active = opts.activeSlots[s];
    if (!active) {
      slotRemaining.push(0);
      continue;
    }
    if (typeof active.simDelayMs === "number" && active.simDelayMs > 0) {
      slotRemaining.push(Math.max(1_500, active.simDelayMs - Math.max(0, active.elapsedMs)));
    } else {
      slotRemaining.push(
        estimateRemainingBuildMs({
          elapsedMs: active.elapsedMs,
          phase: active.phase,
          round1Ms: active.round1Ms,
          features: active.features,
          history: clean,
        }),
      );
    }
  }

  const qIdx = opts.queuedItems.findIndex((q) => q.jobId === opts.targetJobId);
  const position = qIdx >= 0 ? qIdx + 1 : opts.queuedItems.length + 1;
  const limit = qIdx >= 0 ? qIdx : opts.queuedItems.length;

  let totalEtaMs = estimateInitialBuildMs(opts.targetFallbackFeatures, clean);

  for (let i = 0; i <= limit; i++) {
    let minSlot = 0;
    for (let s = 1; s < slotRemaining.length; s++) {
      if (slotRemaining[s] < slotRemaining[minSlot]) {
        minSlot = s;
      }
    }
    const qItem = opts.queuedItems[i];
    const itemDur = qItem
      ? typeof qItem.simDelayMs === "number" && qItem.simDelayMs > 0
        ? qItem.simDelayMs
        : estimateInitialBuildMs(qItem.features, clean)
      : estimateInitialBuildMs(opts.targetFallbackFeatures, clean);

    if (i === limit) {
      totalEtaMs = slotRemaining[minSlot] + itemDur;
    } else {
      slotRemaining[minSlot] += itemDur;
    }
  }

  return { position, totalEtaMs };
}

export function summarizeTelemetryStats(history: BuildTelemetrySample[]): BuildEtaTelemetrySummary {
  const clean = sanitizeHistory(history);
  const realPoints: WeightedPoint[] = clean.map((s, idx) => ({
    ms: s.durationMs,
    w: Math.pow(RECENCY_DECAY, idx),
  }));

  const stats =
    realPoints.length > 0
      ? computeWeightedStats(realPoints)
      : buildFeatureDistribution({ complexity: "standard", hasImage: false }, []);

  const refinedCount = clean.filter((s) => s.hadRefinementPass).length;

  return {
    realSampleCount: clean.length,
    meanMs: Math.round(stats.mean),
    medianMs: Math.round(stats.p50),
    p75Ms: Math.round(stats.p75),
    p90Ms: Math.round(stats.p90),
    refinementRate: clean.length > 0 ? Number((refinedCount / clean.length).toFixed(3)) : 0,
    estimatesSec: {
      compact: Math.ceil(estimateInitialBuildMs({ complexity: "compact", hasImage: false }, clean) / 1000),
      standard: Math.ceil(estimateInitialBuildMs({ complexity: "standard", hasImage: false }, clean) / 1000),
      complex: Math.ceil(estimateInitialBuildMs({ complexity: "complex", hasImage: false }, clean) / 1000),
      withImage: Math.ceil(estimateInitialBuildMs({ complexity: "complex", hasImage: true }, clean) / 1000),
    },
  };
}

import type { PmmSectionConfig } from "./config.ts";

export interface DriftAttributeLike {
  name: string;
  value: unknown;
  time?: string;
}

export interface DriftRelationshipLike {
  objectId: string;
  qualifier: string;
}

export interface DriftObjectLike {
  id: string;
  type: string;
  attributes: readonly DriftAttributeLike[] | readonly unknown[] | Record<string, unknown>;
  relationships?: readonly DriftRelationshipLike[] | readonly unknown[];
}

export interface DriftEventLike {
  id: string;
  type: string;
  time: string;
  attributes?: readonly DriftAttributeLike[] | Record<string, unknown>;
  relationships?: readonly DriftRelationshipLike[];
}

export interface DriftDocLike {
  objects?: readonly DriftObjectLike[];
  events: readonly DriftEventLike[];
}

export interface PageHinkleyOptions {
  delta?: number;
  lambda?: number;
  alpha?: number;
  minInstances?: number;
  direction?: "increase" | "decrease" | "both";
}

export interface PageHinkleyResult {
  driftDetected: boolean;
  changePoints: number[];
  firstChangeIndex: number | null;
  maxStatistic: number;
  threshold: number;
  direction: "increase" | "decrease" | "none";
}

export interface AdwinOptions {
  delta?: number;
  minWindow?: number;
}

export interface AdwinResult {
  driftDetected: boolean;
  changePoints: number[];
  shrinkCount: number;
  finalWindowMean: number;
  finalWindowSize: number;
  delta: number;
}

export interface EwmaOptions {
  lambda?: number;
  L?: number;
  baselineLength?: number;
  targetMean?: number;
  targetStd?: number;
}

export interface EwmaResult {
  driftDetected: boolean;
  outOfControlIndices: number[];
  zValues: number[];
  ucl: number[];
  lcl: number[];
  baselineMean: number;
  baselineStd: number;
}

export interface TwoSampleTestOptions {
  alpha?: number;
}

export interface TwoSampleTestResult {
  statistic: number;
  pValue: number;
  significant: boolean;
  nA: number;
  nB: number;
  alpha: number;
}

export interface MannWhitneyResult extends TwoSampleTestResult {
  uStatistic: number;
  zScore: number;
  tiesCorrected: boolean;
}

export type DriftKind = "sudden" | "gradual" | "recurring" | "incremental";

export interface ConceptDriftConfig extends Partial<PmmSectionConfig> {
  alpha?: number;
  minWindow?: number;
  stratification?: "transitionClass" | "tool_name" | "auto";
}

export interface DriftFinding {
  driftType: DriftKind;
  stratum: string;
  metric: string;
  objectType: string;
  edgeOrRule: string;
  windowStart: string;
  windowEnd: string;
  changePointTime: string | null;
  pValue: number;
  statistic: number;
  detector: "page_hinkley" | "adwin" | "ewma" | "two_sample_ks" | "mann_whitney_u";
  severity: "low" | "medium" | "high";
}

export interface ConceptDriftReport {
  schema: "zcode.concept-drift/1";
  driftDetected: boolean;
  driftKind: DriftKind | "none";
  pValue: number;
  findings: DriftFinding[];
  pageHinkley: PageHinkleyResult | null;
  adwin: AdwinResult | null;
  ewma: EwmaResult | null;
  ks: TwoSampleTestResult | null;
  mannWhitney: MannWhitneyResult | null;
  strataAnalyzed: string[];
  kingmanCs2ByStratum: Record<string, number>;
  configUsed: { alpha: number; minWindow: number; stratification: string };
}

function sampleMean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = sampleMean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(Math.max(0, v));
}

function erfcApprox(x: number): number {
  // Abramowitz & Stegun 7.1.26 complementary error function (max error ~1.5e-7)
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  const res = poly * Math.exp(-z * z);
  return x >= 0 ? res : 2 - res;
}

export function pageHinkley(
  series: readonly number[],
  options: PageHinkleyOptions = {}
): PageHinkleyResult {
  const clean = series.filter((x) => Number.isFinite(x));
  const minInstances = Math.max(2, options.minInstances ?? 10);
  const directionOpt = options.direction ?? "both";

  if (clean.length < Math.max(4, minInstances)) {
    return {
      driftDetected: false,
      changePoints: [],
      firstChangeIndex: null,
      maxStatistic: 0,
      threshold: options.lambda ?? 1,
      direction: "none"
    };
  }

  const baseLen = Math.min(minInstances, Math.max(2, Math.floor(clean.length / 2)));
  const baseSlice = clean.slice(0, baseLen);
  const baseMean = sampleMean(baseSlice);
  let baseStd = sampleStd(baseSlice);
  if (baseStd <= 1e-12) {
    baseStd = Math.max(1e-6, Math.abs(baseMean) * 0.05 || 1e-3);
  }

  const delta = options.delta ?? 0.25 * baseStd;
  const lambda = options.lambda ?? 4.0 * baseStd;

  let count = 0;
  let mean = 0;
  let uSum = 0;
  let mU = 0;
  let lSum = 0;
  let mL = 0;
  let maxStat = 0;
  let detectedDir: "increase" | "decrease" | "none" = "none";
  const changePoints: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const x = clean[i]!;
    count += 1;
    if (options.alpha !== undefined && count > 1) {
      mean = options.alpha * x + (1 - options.alpha) * mean;
    } else {
      mean = mean + (x - mean) / count;
    }

    uSum += x - mean - delta;
    if (uSum < mU) mU = uSum;
    const phUp = uSum - mU;

    lSum += mean - x - delta;
    if (lSum < mL) mL = lSum;
    const phDown = lSum - mL;

    const activeStat =
      directionOpt === "increase"
        ? phUp
        : directionOpt === "decrease"
          ? phDown
          : Math.max(phUp, phDown);
    if (activeStat > maxStat) maxStat = activeStat;

    if (count >= minInstances) {
      const upHit = (directionOpt === "increase" || directionOpt === "both") && phUp > lambda;
      const downHit = (directionOpt === "decrease" || directionOpt === "both") && phDown > lambda;
      if (upHit || downHit) {
        changePoints.push(i);
        if (detectedDir === "none") {
          detectedDir = upHit ? "increase" : "decrease";
        }
        // Reset accumulators after change point to allow recurring drift detection
        count = 1;
        mean = x;
        uSum = 0;
        mU = 0;
        lSum = 0;
        mL = 0;
      }
    }
  }

  return {
    driftDetected: changePoints.length > 0,
    changePoints,
    firstChangeIndex: changePoints[0] ?? null,
    maxStatistic: maxStat,
    threshold: lambda,
    direction: detectedDir
  };
}

export function adwin(series: readonly number[], options: AdwinOptions = {}): AdwinResult {
  const clean = series.filter((x) => Number.isFinite(x));
  const delta = options.delta ?? 0.01;
  const minWindow = Math.max(3, options.minWindow ?? 5);

  if (clean.length === 0) {
    return {
      driftDetected: false,
      changePoints: [],
      shrinkCount: 0,
      finalWindowMean: 0,
      finalWindowSize: 0,
      delta
    };
  }

  const window: number[] = [];
  const changePoints: number[] = [];
  let shrinkCount = 0;

  for (let t = 0; t < clean.length; t++) {
    window.push(clean[t]!);
    if (window.length < 2 * minWindow) continue;

    let cutFound = true;
    while (cutFound && window.length >= 2 * minWindow) {
      cutFound = false;
      const n = window.length;
      const prefSum = new Array<number>(n + 1).fill(0);
      const prefSq = new Array<number>(n + 1).fill(0);
      let minVal = Infinity;
      let maxVal = -Infinity;

      for (let i = 0; i < n; i++) {
        const v = window[i]!;
        prefSum[i + 1] = prefSum[i]! + v;
        prefSq[i + 1] = prefSq[i]! + v * v;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }

      const range = maxVal - minVal;
      if (range <= 0) break;

      const totalMean = prefSum[n]! / n;
      void totalMean;
      const deltaPrime = Math.min(0.5, Math.max(1e-12, delta / Math.max(1, Math.log(n))));
      const lnTerm = Math.log(2 / deltaPrime);

      for (let n0 = minWindow; n0 <= n - minWindow; n0++) {
        const n1 = n - n0;
        const mean0 = prefSum[n0]! / n0;
        const mean1 = (prefSum[n]! - prefSum[n0]!) / n1;
        const diff = Math.abs(mean0 - mean1);
        if (diff === 0) continue;

        const var0 = Math.max(0, prefSq[n0]! / n0 - mean0 * mean0);
        const var1 = Math.max(0, (prefSq[n]! - prefSq[n0]!) / n1 - mean1 * mean1);
        const pooledVar = Math.max(0, (n0 * var0 + n1 * var1) / n);
        const m = (n0 * n1) / n;
        const epsCut = Math.sqrt((2 * pooledVar * lnTerm) / m) + (2 * range * lnTerm) / (3 * m);
        if (diff >= epsCut) {
          window.splice(0, n0);
          shrinkCount += 1;
          if (changePoints[changePoints.length - 1] !== t) {
            changePoints.push(t);
          }
          cutFound = true;
          break;
        }
      }
    }
  }

  return {
    driftDetected: changePoints.length > 0,
    changePoints,
    shrinkCount,
    finalWindowMean: sampleMean(window),
    finalWindowSize: window.length,
    delta
  };
}

export function ewmaChart(series: readonly number[], options: EwmaOptions = {}): EwmaResult {
  const clean = series.filter((x) => Number.isFinite(x));
  const lambda = options.lambda ?? 0.2;
  const L = options.L ?? 3.0;
  const baselineLen = Math.min(clean.length, Math.max(3, options.baselineLength ?? Math.floor(clean.length / 3)));

  if (clean.length === 0) {
    return {
      driftDetected: false,
      outOfControlIndices: [],
      zValues: [],
      ucl: [],
      lcl: [],
      baselineMean: 0,
      baselineStd: 0
    };
  }

  const baseSlice = clean.slice(0, baselineLen);
  const mu0 = options.targetMean ?? sampleMean(baseSlice);
  const rawStd = options.targetStd ?? sampleStd(baseSlice);
  const sigma0 = rawStd > 1e-12 ? rawStd : Math.max(1e-6, Math.abs(mu0) * 0.05 || 1e-3);

  const zValues: number[] = [];
  const ucl: number[] = [];
  const lcl: number[] = [];
  const outOfControlIndices: number[] = [];
  const checkFrom = options.targetMean !== undefined ? 0 : baselineLen;

  let zPrev = mu0;
  for (let i = 0; i < clean.length; i++) {
    const t = i + 1;
    const z = lambda * clean[i]! + (1 - lambda) * zPrev;
    zPrev = z;
    const factor = Math.sqrt((lambda / (2 - lambda)) * (1 - Math.pow(1 - lambda, 2 * t)));
    const sigmaZ = sigma0 * factor;
    const hi = mu0 + L * sigmaZ;
    const lo = mu0 - L * sigmaZ;
    zValues.push(z);
    ucl.push(hi);
    lcl.push(lo);
    if (i >= checkFrom && (z > hi || z < lo)) {
      outOfControlIndices.push(i);
    }
  }

  return {
    driftDetected: outOfControlIndices.length > 0,
    outOfControlIndices,
    zValues,
    ucl,
    lcl,
    baselineMean: mu0,
    baselineStd: sigma0
  };
}

export function twoSampleKs(
  a: readonly number[],
  b: readonly number[],
  options: TwoSampleTestOptions = {}
): TwoSampleTestResult {
  const alpha = options.alpha ?? 0.01;
  const sa = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  const sb = b.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  const n = sa.length;
  const m = sb.length;

  if (n === 0 || m === 0) {
    return { statistic: 0, pValue: 1, significant: false, nA: n, nB: m, alpha };
  }

  let i = 0;
  let j = 0;
  let maxD = 0;

  while (i < n || j < m) {
    const nextA = i < n ? sa[i]! : Infinity;
    const nextB = j < m ? sb[j]! : Infinity;
    const cur = Math.min(nextA, nextB);
    while (i < n && sa[i]! === cur) i += 1;
    while (j < m && sb[j]! === cur) j += 1;
    const d = Math.abs(i / n - j / m);
    if (d > maxD) maxD = d;
  }

  const nEff = (n * m) / (n + m);
  const sqrtNe = Math.sqrt(nEff);
  const lambda = maxD * (sqrtNe + 0.12 + 0.11 / sqrtNe);

  let pValue = 1;
  if (lambda <= 0) {
    pValue = 1;
  } else if (lambda < 0.35) {
    let sum = 0;
    for (let k = 1; k <= 10; k++) {
      const term = Math.exp(-(((2 * k - 1) * Math.PI) ** 2) / (8 * lambda * lambda));
      sum += term;
    }
    pValue = 1 - (Math.sqrt(2 * Math.PI) / lambda) * sum;
  } else {
    let sum = 0;
    for (let jIdx = 1; jIdx <= 100; jIdx++) {
      const term = Math.exp(-2 * jIdx * jIdx * lambda * lambda);
      sum += (jIdx % 2 === 1 ? 1 : -1) * term;
      if (term < 1e-15) break;
    }
    pValue = 2 * sum;
  }

  pValue = Math.max(0, Math.min(1, pValue));
  return {
    statistic: maxD,
    pValue,
    significant: pValue < alpha,
    nA: n,
    nB: m,
    alpha
  };
}

function binomialCoeff(n: number, k: number): number {
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = (res * (n - k + i)) / i;
  }
  return res;
}

function exactMannWhitneyTwoSidedP(n1: number, n2: number, u: number): number {
  const maxU = n1 * n2;
  const uMin = Math.min(u, maxU - u);
  // DP: ways[i][j] = map or array of length maxU+1
  const stride = maxU + 1;
  let dp = new Float64Array((n1 + 1) * (n2 + 1) * stride);
  dp[0] = 1;

  for (let i = 0; i <= n1; i++) {
    for (let j = 0; j <= n2; j++) {
      const base = (i * (n2 + 1) + j) * stride;
      for (let w = 0; w <= maxU; w++) {
        const cur = dp[base + w]!;
        if (cur === 0) continue;
        if (i < n1) {
          const nw = w + j;
          if (nw <= maxU) {
            dp[((i + 1) * (n2 + 1) + j) * stride + nw]! += cur;
          }
        }
        if (j < n2) {
          dp[(i * (n2 + 1) + (j + 1)) * stride + w]! += cur;
        }
      }
    }
  }

  const finalBase = (n1 * (n2 + 1) + n2) * stride;
  let tailCount = 0;
  for (let w = 0; w <= uMin; w++) {
    tailCount += dp[finalBase + w]!;
  }
  const total = binomialCoeff(n1 + n2, n1);
  if (uMin * 2 === maxU) return 1;
  return Math.max(0, Math.min(1, (2 * tailCount) / total));
}

export function mannWhitneyU(
  a: readonly number[],
  b: readonly number[],
  options: TwoSampleTestOptions = {}
): MannWhitneyResult {
  const alpha = options.alpha ?? 0.01;
  const fa = a.filter((x) => Number.isFinite(x));
  const fb = b.filter((x) => Number.isFinite(x));
  const n1 = fa.length;
  const n2 = fb.length;

  if (n1 === 0 || n2 === 0) {
    return {
      statistic: 0,
      uStatistic: 0,
      zScore: 0,
      tiesCorrected: false,
      pValue: 1,
      significant: false,
      nA: n1,
      nB: n2,
      alpha
    };
  }

  const combined: Array<{ val: number; group: 0 | 1 }> = [
    ...fa.map((val) => ({ val, group: 0 as const })),
    ...fb.map((val) => ({ val, group: 1 as const }))
  ].sort((x, y) => x.val - y.val);

  const N = n1 + n2;
  let rankSumA = 0;
  let tieCorrectionSum = 0;
  let idx = 0;
  while (idx < N) {
    let end = idx + 1;
    while (end < N && combined[end]!.val === combined[idx]!.val) end += 1;
    const t = end - idx;
    if (t > 1) tieCorrectionSum += t * t * t - t;
    const avgRank = (idx + 1 + end) / 2;
    for (let k = idx; k < end; k++) {
      if (combined[k]!.group === 0) rankSumA += avgRank;
    }
    idx = end;
  }

  const u1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);
  const tiesCorrected = tieCorrectionSum > 0;

  const varianceU =
    ((n1 * n2) / 12) * (N + 1 - (N > 1 ? tieCorrectionSum / (N * (N - 1)) : 0));
  const sigmaU = Math.sqrt(Math.max(0, varianceU));
  const meanU = (n1 * n2) / 2;
  const zScore = sigmaU > 0 ? Math.max(0, (Math.abs(u - meanU) - 0.5) / sigmaU) : 0;

  let pValue: number;
  if (!tiesCorrected && n1 <= 10 && n2 <= 10) {
    pValue = exactMannWhitneyTwoSidedP(n1, n2, Math.round(u));
  } else if (sigmaU === 0) {
    pValue = 1;
  } else {
    pValue = Math.max(0, Math.min(1, erfcApprox(zScore / Math.SQRT2)));
  }

  return {
    statistic: u,
    uStatistic: u,
    zScore,
    tiesCorrected,
    pValue,
    significant: pValue < alpha,
    nA: n1,
    nB: n2,
    alpha
  };
}

function readAttrStr(
  attrs: readonly DriftAttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!attrs) return undefined;
  if (Array.isArray(attrs)) {
    let last: string | undefined;
    for (const a of attrs) {
      if (a && typeof a === "object" && (a as DriftAttributeLike).name === key) {
        const v = (a as DriftAttributeLike).value;
        last = v === undefined || v === null ? undefined : String(v);
      }
    }
    return last;
  }
  const rec = attrs as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rec, key)) {
    const v = rec[key];
    return v === undefined || v === null ? undefined : String(v);
  }
  return undefined;
}

function readAttrNum(
  attrs: readonly DriftAttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const s = readAttrStr(attrs, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

interface ObservationPoint {
  value: number;
  time: string;
  objectType: string;
  edgeOrRule: string;
}

function rSquaredLinear(vals: readonly number[]): number {
  const n = vals.length;
  if (n < 3) return 0;
  const mx = (n - 1) / 2;
  const my = sampleMean(vals);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    const dy = vals[i]! - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  const r = num / Math.sqrt(denX * denY);
  return r * r;
}

function bestStepSplitSse(vals: readonly number[]): number {
  const n = vals.length;
  if (n < 4) return 0;
  const pref = new Array<number>(n + 1).fill(0);
  const prefSq = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    pref[i + 1] = pref[i]! + vals[i]!;
    prefSq[i + 1] = prefSq[i]! + vals[i]! * vals[i]!;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let k = 2; k <= n - 2; k++) {
    const sseL = prefSq[k]! - (pref[k]! * pref[k]!) / k;
    const nR = n - k;
    const sumR = pref[n]! - pref[k]!;
    const sumSqR = prefSq[n]! - prefSq[k]!;
    const sseR = sumSqR - (sumR * sumR) / nR;
    const total = sseL + sseR;
    if (total < best) best = total;
  }
  return Math.max(0, best);
}

function linearSse(vals: readonly number[]): number {
  const n = vals.length;
  if (n < 3) return 0;
  const my = sampleMean(vals);
  const tss = vals.reduce((acc, v) => acc + (v - my) * (v - my), 0);
  return Math.max(0, tss * (1 - rSquaredLinear(vals)));
}

function checkSegmentedRecurring(
  vals: readonly number[],
  cuts: readonly number[],
  alpha: number,
  adjAlpha = alpha
): { pValue: number; statistic: number; firstCp: number } | null {
  if (cuts.length < 4) return null; // need >= 3 segments
  const segs: number[][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const seg = vals.slice(cuts[i]!, cuts[i + 1]!);
    if (seg.length < 4) return null;
    segs.push(seg);
  }
  const m = segs.length;
  const means = segs.map(sampleMean);
  const adjKs: TwoSampleTestResult[] = [];
  const adjMw: MannWhitneyResult[] = [];
  const adjSig: boolean[] = [];
  for (let i = 0; i < m - 1; i++) {
    const ks = twoSampleKs(segs[i]!, segs[i + 1]!, { alpha: adjAlpha });
    const mw = mannWhitneyU(segs[i]!, segs[i + 1]!, { alpha: adjAlpha });
    adjKs.push(ks);
    adjMw.push(mw);
    adjSig.push(Math.min(ks.pValue, mw.pValue) < adjAlpha);
  }

  let bestRecP = 1;
  let bestRecStat = 0;
  let matchedReversal = false;
  let firstCp = cuts[1]!;

  for (let i = 0; i + 2 < m; i++) {
    if (!adjSig[i] || !adjSig[i + 1]) continue;
    const d1 = means[i + 1]! - means[i]!;
    const d2 = means[i + 2]! - means[i + 1]!;
    if (d1 * d2 >= 0) continue; // must reverse direction
    const ksSkip = twoSampleKs(segs[i]!, segs[i + 2]!, { alpha });
    const mwSkip = mannWhitneyU(segs[i]!, segs[i + 2]!, { alpha });
    if (ksSkip.pValue >= alpha && mwSkip.pValue >= alpha) {
      if (!matchedReversal) firstCp = cuts[i + 1]!;
      matchedReversal = true;
      bestRecP = Math.min(bestRecP, adjKs[i]!.pValue, adjMw[i]!.pValue, adjKs[i + 1]!.pValue, adjMw[i + 1]!.pValue);
      bestRecStat = Math.max(bestRecStat, adjKs[i]!.statistic, adjKs[i + 1]!.statistic);
    }
  }
  if (!matchedReversal) return null;
  return { pValue: bestRecP, statistic: bestRecStat, firstCp };
}

function findMultiPhaseRecurring(
  vals: readonly number[],
  alpha: number,
  adjAlpha = alpha
): { pValue: number; statistic: number; firstCp: number } | null {
  const n = vals.length;
  let best: { pValue: number; statistic: number; firstCp: number } | null = null;
  for (const m of [4, 5, 6]) {
    if (n >= m * 4) {
      const cuts = [0];
      for (let i = 1; i < m; i++) cuts.push(Math.floor((i * n) / m));
      cuts.push(n);
      const rec = checkSegmentedRecurring(vals, cuts, alpha, adjAlpha);
      if (rec && (!best || rec.pValue < best.pValue)) {
        best = rec;
      }
    }
  }
  return best;
}

function classifyDriftPattern(
  vals: readonly number[],
  ph: PageHinkleyResult,
  adw: AdwinResult,
  ew: EwmaResult,
  alpha: number
): { kind: DriftKind; pValue: number; statistic: number; detector: DriftFinding["detector"]; changeIdx: number | null } {
  const n = vals.length;
  const half = Math.floor(n / 2);
  const firstHalf = vals.slice(0, half);
  const secondHalf = vals.slice(half);
  const ksHalf = twoSampleKs(firstHalf, secondHalf, { alpha });
  const mwHalf = mannWhitneyU(firstHalf, secondHalf, { alpha });

  // 3-segment check for recurring (A -> B -> A)
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor((2 * n) / 3);
  const s0 = vals.slice(0, t1);
  const s1 = vals.slice(t1, t2);
  const s2 = vals.slice(t2);
  const ks01 = twoSampleKs(s0, s1, { alpha });
  const ks12 = twoSampleKs(s1, s2, { alpha });
  const ks02 = twoSampleKs(s0, s2, { alpha });
  const mw01 = mannWhitneyU(s0, s1, { alpha });
  const mw12 = mannWhitneyU(s1, s2, { alpha });
  const mw02 = mannWhitneyU(s0, s2, { alpha });

  const bestP = Math.min(ksHalf.pValue, mwHalf.pValue, ks01.pValue, ks12.pValue, mw01.pValue, mw12.pValue);
  const bestStat = Math.max(ksHalf.statistic, ks01.statistic, ks12.statistic);

  const changeIdx =
    adw.changePoints[0] ?? ph.firstChangeIndex ?? ew.outOfControlIndices[0] ?? (n > 2 ? half : null);

  // 1. Recurring check: S0 and S2 match (p >= alpha) while S1 shifts away (p < alpha),
  //    or >= 2 alternating regime shifts across equal multi-phase partitions (m = 4, 5, 6) or changepoint segments
  const endpointsMatch = ks02.pValue >= alpha && mw02.pValue >= alpha;
  const middleDiffers = Math.min(ks01.pValue, mw01.pValue) < alpha && Math.min(ks12.pValue, mw12.pValue) < alpha;
  if (s0.length >= 4 && s1.length >= 4 && s2.length >= 4 && endpointsMatch && middleDiffers) {
    return {
      kind: "recurring",
      pValue: Math.min(ks01.pValue, mw01.pValue),
      statistic: Math.max(ks01.statistic, ks12.statistic),
      detector: adw.changePoints.length >= 2 ? "adwin" : ph.changePoints.length >= 2 ? "page_hinkley" : "two_sample_ks",
      changeIdx
    };
  }

  // Check equal m-segment splits (m = 4, 5, 6) when n >= 4 * m, plus changepoint-derived splits
  let bestMultiRec = findMultiPhaseRecurring(vals, alpha, alpha);
  const mergedCps = [...new Set([...adw.changePoints, ...ph.changePoints])]
    .filter((cp) => cp >= 4 && n - cp >= 4)
    .sort((a, b) => a - b);
  if (mergedCps.length >= 2) {
    const cpCuts = [0];
    for (const cp of mergedCps) {
      if (cp - cpCuts[cpCuts.length - 1]! >= 4 && n - cp >= 4) {
        cpCuts.push(cp);
      }
    }
    cpCuts.push(n);
    if (cpCuts.length >= 4) {
      const cpRec = checkSegmentedRecurring(vals, cpCuts, alpha, alpha);
      if (cpRec && (!bestMultiRec || cpRec.pValue < bestMultiRec.pValue)) {
        bestMultiRec = cpRec;
      }
    }
  }
  if (bestMultiRec) {
    return {
      kind: "recurring",
      pValue: bestMultiRec.pValue,
      statistic: bestMultiRec.statistic,
      detector: adw.changePoints.length >= 2 ? "adwin" : ph.changePoints.length >= 2 ? "page_hinkley" : "two_sample_ks",
      changeIdx: adw.changePoints[0] ?? ph.firstChangeIndex ?? ew.outOfControlIndices[0] ?? bestMultiRec.firstCp
    };
  }

  // 2. Incremental check: 4 quartiles strictly monotonic mean progression with significant Q0 vs Q3
  if (n >= 16) {
    const qSize = Math.floor(n / 4);
    const qMeans = [0, 1, 2, 3].map((k) =>
      sampleMean(vals.slice(k * qSize, k === 3 ? n : (k + 1) * qSize))
    );
    const d0 = qMeans[1]! - qMeans[0]!;
    const d1 = qMeans[2]! - qMeans[1]!;
    const d2 = qMeans[3]! - qMeans[2]!;
    const allInc = d0 > 0 && d1 > 0 && d2 > 0;
    const allDec = d0 < 0 && d1 < 0 && d2 < 0;
    const totalSpan = Math.abs(qMeans[3]! - qMeans[0]!);
    if (
      (allInc || allDec) &&
      totalSpan > 0 &&
      Math.min(Math.abs(d0), Math.abs(d1), Math.abs(d2)) >= totalSpan * 0.1
    ) {
      const q0 = vals.slice(0, qSize);
      const q3 = vals.slice(3 * qSize);
      const ks03 = twoSampleKs(q0, q3, { alpha });
      const mw03 = mannWhitneyU(q0, q3, { alpha });
      if (ks03.significant || mw03.significant) {
        return {
          kind: "incremental",
          pValue: Math.min(ks03.pValue, mw03.pValue),
          statistic: ks03.statistic,
          detector: adw.driftDetected ? "adwin" : "two_sample_ks",
          changeIdx
        };
      }
    }
  }

  // 3. Gradual check: linear ramp fits better than a 2-level step OR transitional middle segment has elevated mixture variance (not explained by a single crisp step)
  const stepErr = bestStepSplitSse(vals);
  const linErr = linearSse(vals);
  const muAll = sampleMean(vals);
  const tss = vals.reduce((acc, v) => acc + (v - muAll) * (v - muAll), 0);
  const std0 = sampleStd(s0);
  const std1 = sampleStd(s1);
  const std2 = sampleStd(s2);
  const mixtureTransition =
    s0.length >= 4 &&
    s1.length >= 4 &&
    s2.length >= 4 &&
    std1 > 1.5 * Math.max(1e-6, Math.min(std0, std2)) &&
    Math.min(ks02.pValue, mw02.pValue) < alpha &&
    tss > 0 &&
    stepErr > tss * 0.05;

  if (linErr < stepErr * 0.9 || mixtureTransition) {
    return {
      kind: "gradual",
      pValue: bestP,
      statistic: bestStat,
      detector: ew.driftDetected ? "ewma" : adw.driftDetected ? "adwin" : "two_sample_ks",
      changeIdx
    };
  }

  return {
    kind: "sudden",
    pValue: bestP,
    statistic: bestStat,
    detector: adw.driftDetected ? "adwin" : ph.driftDetected ? "page_hinkley" : "two_sample_ks",
    changeIdx
  };
}

export function detectConceptDrift(
  logs: DriftDocLike | readonly DriftDocLike[],
  config: ConceptDriftConfig = {}
): ConceptDriftReport {
  const docs = Array.isArray(logs) ? logs : [logs];
  const alpha = config.drift_alpha ?? config.alpha ?? 0.01;
  const minWindow = Math.max(4, config.min_window ?? config.minWindow ?? 20);
  const stratification = config.stratification ?? "auto";

  interface NormalizedEvent {
    ev: DriftEventLike;
    docIdx: number;
    ms: number;
    objMap: Map<string, DriftObjectLike>;
  }

  const allEvents: NormalizedEvent[] = [];
  for (let dIdx = 0; dIdx < docs.length; dIdx++) {
    const doc = docs[dIdx]!;
    const objMap = new Map<string, DriftObjectLike>();
    for (const o of doc.objects ?? []) objMap.set(o.id, o);
    for (const ev of doc.events ?? []) {
      const ms = Date.parse(ev.time);
      allEvents.push({ ev, docIdx: dIdx, ms: Number.isFinite(ms) ? ms : 0, objMap });
    }
  }

  allEvents.sort((a, b) => a.ms - b.ms);

  // Collect stratified numeric observation streams
  const streams = new Map<string, { metric: string; stratum: string; points: ObservationPoint[] }>();
  const addObs = (metric: string, stratum: string, pt: ObservationPoint) => {
    const key = `${metric}::${stratum}`;
    let rec = streams.get(key);
    if (!rec) {
      rec = { metric, stratum, points: [] };
      streams.set(key, rec);
    }
    rec.points.push(pt);
  };

  for (const item of allEvents) {
    const { ev, objMap } = item;
    let linkedModelReq: DriftObjectLike | undefined;
    let linkedToolCall: DriftObjectLike | undefined;
    let linkedPerm: DriftObjectLike | undefined;

    for (const rel of ev.relationships ?? []) {
      const o = objMap.get(rel.objectId);
      if (!o) continue;
      if (o.type === "model_request") linkedModelReq = o;
      if (o.type === "tool_call") linkedToolCall = o;
      if (o.type === "permission") linkedPerm = o;
    }

    const toolName =
      readAttrStr(ev.attributes, "tool_name") ??
      (linkedToolCall ? readAttrStr(linkedToolCall.attributes, "tool_name") : undefined);
    const transitionClass =
      readAttrStr(ev.attributes, "transitionClass") ??
      readAttrStr(ev.attributes, "transition_class") ??
      (linkedToolCall ? readAttrStr(linkedToolCall.attributes, "transitionClass") : undefined);

    const stratum =
      stratification === "tool_name"
        ? toolName ?? ev.type
        : stratification === "transitionClass"
          ? transitionClass ?? ev.type
          : transitionClass ?? toolName ?? ev.type;

    const ttft =
      readAttrNum(ev.attributes, "ttft_ms") ??
      (linkedModelReq ? readAttrNum(linkedModelReq.attributes, "ttft_ms") : undefined);
    if (ttft !== undefined) {
      addObs("ttft_ms", stratum, {
        value: ttft,
        time: ev.time,
        objectType: "model_request",
        edgeOrRule: `${ev.type}:ttft_ms`
      });
    }

    const svc =
      readAttrNum(ev.attributes, "service_ms") ??
      (linkedModelReq ? readAttrNum(linkedModelReq.attributes, "service_ms") : undefined) ??
      (linkedToolCall ? readAttrNum(linkedToolCall.attributes, "service_ms") : undefined);
    if (svc !== undefined) {
      addObs("service_ms", stratum, {
        value: svc,
        time: ev.time,
        objectType: linkedModelReq ? "model_request" : linkedToolCall ? "tool_call" : "turn",
        edgeOrRule: `${stratum}:service_ms`
      });
    }

    const decLat =
      readAttrNum(ev.attributes, "decision_latency_ms") ??
      (linkedPerm ? readAttrNum(linkedPerm.attributes, "decision_latency_ms") : undefined);
    if (decLat !== undefined) {
      addObs("decision_latency_ms", stratum, {
        value: decLat,
        time: ev.time,
        objectType: "permission",
        edgeOrRule: `${ev.type}:decision_latency_ms`
      });
    }

    const fitness = readAttrNum(ev.attributes, "fitness");
    if (fitness !== undefined) {
      addObs("fitness", stratum, {
        value: fitness,
        time: ev.time,
        objectType: "turn",
        edgeOrRule: `${ev.type}:fitness`
      });
    }

    if (
      ev.type === "turn_completed" ||
      ev.type === "turn_failed" ||
      ev.type === "transition_completed" ||
      ev.type === "transition_refused" ||
      ev.type === "execution_crash"
    ) {
      const isErr =
        ev.type === "turn_failed" || ev.type === "transition_refused" || ev.type === "execution_crash" ? 1 : 0;
      addObs("error_rate", "session", {
        value: isErr,
        time: ev.time,
        objectType: "turn",
        edgeOrRule: "turn_outcome:error_rate"
      });
    }
  }

  const findings: DriftFinding[] = [];
  const strataAnalyzed = new Set<string>();
  const kingmanCs2ByStratum: Record<string, number> = {};

  let primaryPh: PageHinkleyResult | null = null;
  let primaryAdw: AdwinResult | null = null;
  let primaryEw: EwmaResult | null = null;
  let primaryKs: TwoSampleTestResult | null = null;
  let primaryMw: MannWhitneyResult | null = null;

  for (const { metric, stratum, points } of streams.values()) {
    strataAnalyzed.add(`${metric}:${stratum}`);
    const vals = points.map((p) => p.value);

    if (metric === "service_ms") {
      const m = sampleMean(vals);
      const s = sampleStd(vals);
      kingmanCs2ByStratum[stratum] = m > 0 ? (s * s) / (m * m) : 0;
    }

    const phMin = Math.min(Math.max(4, Math.floor(minWindow / 2)), Math.max(4, Math.floor(vals.length / 3)));
    const adwMin = Math.min(Math.max(4, Math.floor(minWindow / 4)), Math.max(4, Math.floor(vals.length / 4)));
    const ph = pageHinkley(vals, { minInstances: phMin });
    const adw = adwin(vals, { delta: alpha, minWindow: adwMin });
    const ew = ewmaChart(vals, { baselineLength: Math.max(4, Math.floor(vals.length / 3)) });

    const half = Math.floor(vals.length / 2);
    const ksHalf = half >= 3 ? twoSampleKs(vals.slice(0, half), vals.slice(half), { alpha }) : null;
    const mwHalf = half >= 3 ? mannWhitneyU(vals.slice(0, half), vals.slice(half), { alpha }) : null;

    if (!primaryPh || metric === "ttft_ms" || metric === "service_ms") {
      primaryPh = ph;
      primaryAdw = adw;
      primaryEw = ew;
      if (ksHalf) primaryKs = ksHalf;
      if (mwHalf) primaryMw = mwHalf;
    }

    if (vals.length < 8) continue;

    // Check 2-half, 3-segment, and (for n >= 20) 4-quarter adjacent distributional shifts + m=4..6 recurring
    const t1 = Math.floor(vals.length / 3);
    const t2 = Math.floor((2 * vals.length) / 3);
    const ks01 = t1 >= 4 ? twoSampleKs(vals.slice(0, t1), vals.slice(t1, t2), { alpha }) : null;
    const ks12 = vals.length - t2 >= 4 ? twoSampleKs(vals.slice(t1, t2), vals.slice(t2), { alpha }) : null;
    const mw01 = t1 >= 4 ? mannWhitneyU(vals.slice(0, t1), vals.slice(t1, t2), { alpha }) : null;
    const mw12 = vals.length - t2 >= 4 ? mannWhitneyU(vals.slice(t1, t2), vals.slice(t2), { alpha }) : null;

    let qMinP = 1;
    if (vals.length >= 20) {
      const qCuts = [0, Math.floor(vals.length / 4), Math.floor(vals.length / 2), Math.floor((3 * vals.length) / 4), vals.length];
      for (let qi = 0; qi < 3; qi++) {
        const segA = vals.slice(qCuts[qi]!, qCuts[qi + 1]!);
        const segB = vals.slice(qCuts[qi + 1]!, qCuts[qi + 2]!);
        qMinP = Math.min(qMinP, twoSampleKs(segA, segB, { alpha }).pValue, mannWhitneyU(segA, segB, { alpha }).pValue);
      }
    }

    const minPVal = Math.min(
      ksHalf?.pValue ?? 1,
      mwHalf?.pValue ?? 1,
      ks01?.pValue ?? 1,
      ks12?.pValue ?? 1,
      mw01?.pValue ?? 1,
      mw12?.pValue ?? 1,
      qMinP
    );
    const cs2 = metric === "service_ms" ? (kingmanCs2ByStratum[stratum] ?? 0) : 0;
    const isHeavyTailSvc = metric === "service_ms" && cs2 > 1.5;
    const distSignificant = minPVal < (isHeavyTailSvc ? alpha / 4 : alpha);
    const multiRec = findMultiPhaseRecurring(vals, alpha, isHeavyTailSvc ? alpha / 2 : alpha);

    // Heavy-tail confirmation guard on service_ms: stationary heavy tails (c_s^2 >> 1) must NOT fire!
    let triggered = false;
    if (metric === "service_ms") {
      triggered = distSignificant || multiRec !== null;
    } else {
      triggered = distSignificant || (adw.driftDetected && ph.driftDetected) || multiRec !== null;
    }

    if (triggered) {
      let localizedMinP = Math.min(minPVal, multiRec?.pValue ?? 1);
      if (metric !== "service_ms" && adw.driftDetected && ph.driftDetected) {
        const cps = [adw.changePoints[0], ph.firstChangeIndex].filter(
          (cp): cp is number => cp !== null && cp !== undefined && cp >= 3 && vals.length - cp >= 3
        );
        for (const cp of cps) {
          const ksCp = twoSampleKs(vals.slice(0, cp), vals.slice(cp), { alpha });
          const mwCp = mannWhitneyU(vals.slice(0, cp), vals.slice(cp), { alpha });
          localizedMinP = Math.min(localizedMinP, ksCp.pValue, mwCp.pValue);
        }
        if (adw.changePoints.length >= 2) {
          const c1 = adw.changePoints[0]!;
          const c2 = adw.changePoints[1]!;
          if (c1 >= 3 && c2 - c1 >= 3) {
            const ksSeg = twoSampleKs(vals.slice(0, c1), vals.slice(c1, c2), { alpha });
            const mwSeg = mannWhitneyU(vals.slice(0, c1), vals.slice(c1, c2), { alpha });
            localizedMinP = Math.min(localizedMinP, ksSeg.pValue, mwSeg.pValue);
          }
        }
      }
      const cls = classifyDriftPattern(vals, ph, adw, ew, alpha);
      const cpTime = cls.changeIdx !== null && points[cls.changeIdx] ? points[cls.changeIdx]!.time : null;
      const pVal = Math.min(cls.pValue, localizedMinP);
      findings.push({
        driftType: cls.kind,
        stratum,
        metric,
        objectType: points[0]!.objectType,
        edgeOrRule: points[0]!.edgeOrRule,
        windowStart: points[0]!.time,
        windowEnd: points[points.length - 1]!.time,
        changePointTime: cpTime,
        pValue: pVal,
        statistic: Math.max(cls.statistic, multiRec?.statistic ?? 0),
        detector: cls.detector,
        severity: pVal < 0.001 ? "high" : pVal < alpha ? "medium" : "low"
      });
    }
  }

  // Control-flow directly-follows edge drift per objectType across chronological traces
  const tracesByOt = new Map<string, Array<{ startTime: string; endTime: string; edges: Set<string> }>>();
  const traceEventsByObjKey = new Map<string, { ot: string; events: DriftEventLike[] }>();

  for (const item of allEvents) {
    const { ev, docIdx, objMap } = item;
    for (const rel of ev.relationships ?? []) {
      const obj = objMap.get(rel.objectId);
      const ot = obj?.type;
      if (!ot) continue;
      const k = `${docIdx}:${ot}:${rel.objectId}`;
      let rec = traceEventsByObjKey.get(k);
      if (!rec) {
        rec = { ot, events: [] };
        traceEventsByObjKey.set(k, rec);
      }
      rec.events.push(ev);
    }
  }

  for (const { ot, events } of traceEventsByObjKey.values()) {
    if (events.length < 2) continue;
    const edgeSet = new Set<string>();
    for (let i = 0; i + 1 < events.length; i++) {
      edgeSet.add(`${events[i]!.type}->${events[i + 1]!.type}`);
    }
    let arr = tracesByOt.get(ot);
    if (!arr) {
      arr = [];
      tracesByOt.set(ot, arr);
    }
    arr.push({
      startTime: events[0]!.time,
      endTime: events[events.length - 1]!.time,
      edges: edgeSet
    });
  }

  for (const [ot, traces] of tracesByOt.entries()) {
    if (traces.length < 8) continue;
    traces.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    const edgeNames = new Set<string>();
    for (const t of traces) {
      for (const e of t.edges) edgeNames.add(e);
    }
    const half = Math.floor(traces.length / 2);
    const t1 = Math.floor(traces.length / 3);
    const t2 = Math.floor((2 * traces.length) / 3);
    for (const edge of edgeNames) {
      const series = traces.map((t) => (t.edges.has(edge) ? 1 : 0));
      const mw = mannWhitneyU(series.slice(0, half), series.slice(half), { alpha });
      const ks = twoSampleKs(series.slice(0, half), series.slice(half), { alpha });
      const ks01 = t1 >= 4 && t2 - t1 >= 4 ? twoSampleKs(series.slice(0, t1), series.slice(t1, t2), { alpha }) : null;
      const ks12 = traces.length - t2 >= 4 && t2 - t1 >= 4 ? twoSampleKs(series.slice(t1, t2), series.slice(t2), { alpha }) : null;
      const mw01 = t1 >= 4 && t2 - t1 >= 4 ? mannWhitneyU(series.slice(0, t1), series.slice(t1, t2), { alpha }) : null;
      const mw12 = traces.length - t2 >= 4 && t2 - t1 >= 4 ? mannWhitneyU(series.slice(t1, t2), series.slice(t2), { alpha }) : null;

      const ph = pageHinkley(series, { minInstances: 4 });
      const adw = adwin(series, { delta: alpha, minWindow: 4 });
      const ew = ewmaChart(series, { baselineLength: Math.max(4, Math.floor(series.length / 3)) });

      let cpMinP = 1;
      for (const cp of [adw.changePoints[0], ph.firstChangeIndex]) {
        if (cp !== null && cp !== undefined && cp >= 3 && series.length - cp >= 3) {
          const ksCp = twoSampleKs(series.slice(0, cp), series.slice(cp), { alpha });
          const mwCp = mannWhitneyU(series.slice(0, cp), series.slice(cp), { alpha });
          cpMinP = Math.min(cpMinP, ksCp.pValue, mwCp.pValue);
        }
      }

      let qMinP = 1;
      if (series.length >= 20) {
        const qCuts = [0, Math.floor(series.length / 4), Math.floor(series.length / 2), Math.floor((3 * series.length) / 4), series.length];
        for (let qi = 0; qi < 3; qi++) {
          const segA = series.slice(qCuts[qi]!, qCuts[qi + 1]!);
          const segB = series.slice(qCuts[qi + 1]!, qCuts[qi + 2]!);
          qMinP = Math.min(qMinP, twoSampleKs(segA, segB, { alpha }).pValue, mannWhitneyU(segA, segB, { alpha }).pValue);
        }
      }

      const minPVal = Math.min(
        mw.pValue,
        ks.pValue,
        ks01?.pValue ?? 1,
        ks12?.pValue ?? 1,
        mw01?.pValue ?? 1,
        mw12?.pValue ?? 1,
        cpMinP,
        qMinP
      );
      const multiRec = findMultiPhaseRecurring(series, alpha, alpha);
      if (minPVal < alpha || (adw.driftDetected && ph.driftDetected) || multiRec !== null) {
        const cls = classifyDriftPattern(series, ph, adw, ew, alpha);
        const pVal = Math.min(minPVal, cls.pValue, multiRec?.pValue ?? 1);
        const cpIdx = cls.changeIdx ?? adw.changePoints[0] ?? ph.firstChangeIndex ?? half;
        const safeCpIdx = Math.min(traces.length - 1, Math.max(0, cpIdx));
        findings.push({
          driftType: cls.kind,
          stratum: ot,
          metric: "control_flow_edge",
          objectType: ot,
          edgeOrRule: edge,
          windowStart: traces[0]!.startTime,
          windowEnd: traces[traces.length - 1]!.endTime,
          changePointTime: traces[safeCpIdx]!.startTime,
          pValue: pVal,
          statistic: Math.max(ks.statistic, ks01?.statistic ?? 0, ks12?.statistic ?? 0, cls.statistic, multiRec?.statistic ?? 0),
          detector: cls.detector,
          severity: pVal < 0.001 ? "high" : pVal < alpha ? "medium" : "low"
        });
      }
    }
  }

  findings.sort((a, b) => a.pValue - b.pValue);
  const driftDetected = findings.length > 0;
  const primaryFinding = findings[0];

  return {
    schema: "zcode.concept-drift/1",
    driftDetected,
    driftKind: primaryFinding ? primaryFinding.driftType : "none",
    pValue: primaryFinding ? primaryFinding.pValue : primaryKs?.pValue ?? 1,
    findings,
    pageHinkley: primaryPh,
    adwin: primaryAdw,
    ewma: primaryEw,
    ks: primaryKs,
    mannWhitney: primaryMw,
    strataAnalyzed: [...strataAnalyzed].sort(),
    kingmanCs2ByStratum,
    configUsed: { alpha, minWindow, stratification }
  };
}

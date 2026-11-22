import { computeSummaryStats, type DiscoverDocLike, type DiscoverAttributeLike } from "./ocel-discover.ts";

export interface KingmanQueueEstimate {
  rho: number;
  ca2: number;
  cs2: number;
  meanServiceMs: number;
  utilizationFactor: number;
  variabilityFactor: number;
  expectedQueueWaitMs: number;
  expectedSojournMs: number;
  recommendedMaxRho: number;
  lambdaAlivePerSec: number;
  saturated: boolean;
}

export interface KingmanSchedulerConfig {
  ttftSpikeFactor?: number;
  ttftWindow?: number;
  serviceWindow?: number;
  rateLimitSafetyFloor?: number;
  minWip?: number;
  maxWip?: number;
  targetWaitRatio?: number;
  warmupSamples?: number;
  useWallClockFallback?: boolean;
}

export interface TransportTelemetrySample {
  ttftMs?: number;
  rpmHeadroomRatio?: number;
  tpmHeadroomRatio?: number;
  interArrivalMs?: number;
}

export interface KingmanStepDecision {
  changed: boolean;
  oldWip: number;
  newWip: number;
  reason: string;
  ttftMdTriggered: boolean;
  heavyTailedProtected: boolean;
  estimate: KingmanQueueEstimate;
}

export interface KingmanMetricsSnapshot {
  wip: number;
  peakEquilibriumWip: number;
  ttftMdTriggered: boolean;
  mdCount: number;
  heavyTailedProtectedCount: number;
  cs2: number;
  ca2: number;
  rho: number;
  meanServiceMs: number;
  medianTtftMs: number;
  estimate: KingmanQueueEstimate;
}

export function computeKingmanQueueEstimate(
  rho: number,
  ca2: number,
  cs2: number,
  meanServiceMs: number,
  targetWaitRatio = 1.5,
  servers = 1
): KingmanQueueEstimate {
  const safeCa2 = Number.isFinite(ca2) && ca2 >= 0 ? ca2 : 1;
  const safeCs2 = Number.isFinite(cs2) && cs2 >= 0 ? cs2 : 1;
  const safeServiceMs = Number.isFinite(meanServiceMs) && meanServiceMs > 0 ? meanServiceMs : 1;
  const safeRho = Number.isFinite(rho) ? Math.max(0, rho) : 0;
  const safeServers = Number.isFinite(servers) && servers >= 1 ? servers : 1;

  const variabilityFactor = (safeCa2 + safeCs2) / 2;
  const recommendedMaxRho = Math.min(
    0.92,
    Math.max(0.2, targetWaitRatio / (targetWaitRatio + Math.max(0.05, variabilityFactor)))
  );

  if (safeRho >= 1) {
    return {
      rho: safeRho,
      ca2: safeCa2,
      cs2: safeCs2,
      meanServiceMs: safeServiceMs,
      utilizationFactor: Number.POSITIVE_INFINITY,
      variabilityFactor,
      expectedQueueWaitMs: Number.POSITIVE_INFINITY,
      expectedSojournMs: Number.POSITIVE_INFINITY,
      recommendedMaxRho,
      lambdaAlivePerSec: 0,
      saturated: true
    };
  }

  // Sakasegawa / Allen-Cunneen G/G/c queueing approximation (reduces to G/G/1 when servers = 1)
  const sakasegawaExponent = Math.sqrt(2 * (safeServers + 1)) - 1;
  const utilizationFactor =
    Math.pow(safeRho, sakasegawaExponent) / (safeServers * (1 - safeRho));
  const expectedQueueWaitMs = utilizationFactor * variabilityFactor * safeServiceMs;
  const expectedSojournMs = expectedQueueWaitMs + safeServiceMs;
  const deadlineMs = Math.max(safeServiceMs * 4, 30_000);
  const serviceSec = safeServiceMs / 1000;
  const survivalProbability = 1 / (1 + expectedQueueWaitMs / deadlineMs);
  const lambdaAlivePerSec =
    safeRho > 0 ? ((safeServers * safeRho) / serviceSec) * survivalProbability : 0;

  return {
    rho: safeRho,
    ca2: safeCa2,
    cs2: safeCs2,
    meanServiceMs: safeServiceMs,
    utilizationFactor,
    variabilityFactor,
    expectedQueueWaitMs,
    expectedSojournMs,
    recommendedMaxRho,
    lambdaAlivePerSec,
    saturated: false
  };
}

function medianOf(samples: readonly number[]): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export class KingmanScheduler {
  wip: number;
  peakEquilibriumWip: number;
  ttftMdTriggered = false;
  mdCount = 0;
  heavyTailedProtectedCount = 0;

  private readonly ttftSpikeFactor: number;
  private readonly ttftWindow: number;
  private readonly serviceWindow: number;
  private readonly rateLimitSafetyFloor: number;
  private readonly minWip: number;
  private readonly maxWip: number;
  private readonly targetWaitRatio: number;
  private readonly warmupSamples: number;
  private readonly useWallClockFallback: boolean;

  private readonly ttftSamples: number[] = [];
  private readonly serviceSamples: number[] = [];
  private readonly interArrivalSamples: number[] = [];
  private lastCompletionTimestampMs: number | null = null;

  constructor(config: KingmanSchedulerConfig = {}) {
    this.minWip = config.minWip ?? 1;
    this.maxWip = config.maxWip ?? 64;
    this.wip = this.minWip;
    this.peakEquilibriumWip = this.minWip;
    this.ttftSpikeFactor = config.ttftSpikeFactor ?? 2.0;
    this.ttftWindow = config.ttftWindow ?? 32;
    this.serviceWindow = config.serviceWindow ?? 64;
    this.rateLimitSafetyFloor = config.rateLimitSafetyFloor ?? 0.05;
    this.targetWaitRatio = config.targetWaitRatio ?? 1.5;
    this.warmupSamples = config.warmupSamples ?? 3;
    this.useWallClockFallback = config.useWallClockFallback ?? true;
  }

  private pushBounded(arr: number[], value: number, limit: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    arr.push(value);
    if (arr.length > limit) arr.shift();
  }

  private currentEstimate(): KingmanQueueEstimate {
    const svcStats = computeSummaryStats(this.serviceSamples);
    const arrStats = computeSummaryStats(this.interArrivalSamples);
    const meanSvc = svcStats.count > 0 ? svcStats.meanMs : 100;
    const cs2 = svcStats.count >= 2 ? svcStats.cs2 : 1;
    const ca2 = arrStats.count >= 2 ? arrStats.cs2 : 1;
    const rho =
      arrStats.count >= 1 && arrStats.meanMs > 0
        ? Math.min(0.99, meanSvc / (arrStats.meanMs * Math.max(1, this.wip)))
        : Math.min(0.95, this.wip / Math.max(2, this.maxWip));
    return computeKingmanQueueEstimate(
      rho,
      ca2,
      cs2,
      meanSvc,
      this.targetWaitRatio,
      Math.max(1, this.wip)
    );
  }

  onSuccess(serviceMs: number, transport: TransportTelemetrySample = {}): KingmanStepDecision {
    const oldWip = this.wip;
    const nowMs = Date.now();
    const interArrival =
      transport.interArrivalMs !== undefined
        ? transport.interArrivalMs
        : this.useWallClockFallback && this.lastCompletionTimestampMs !== null
          ? Math.max(1, nowMs - this.lastCompletionTimestampMs)
          : undefined;
    this.lastCompletionTimestampMs = nowMs;
    if (interArrival !== undefined) {
      this.pushBounded(this.interArrivalSamples, interArrival, this.serviceWindow);
    }

    const prevSvcMedian = medianOf(this.serviceSamples);
    this.pushBounded(this.serviceSamples, serviceMs, this.serviceWindow);

    // Check transport-layer congestion ONLY (never coding-turn serviceMs!)
    const prevTtftMedian = medianOf(this.ttftSamples);
    const hasTtftWarmup = this.ttftSamples.length >= this.warmupSamples;
    const ttftSpike =
      transport.ttftMs !== undefined &&
      hasTtftWarmup &&
      Number.isFinite(prevTtftMedian) &&
      prevTtftMedian > 0 &&
      transport.ttftMs > prevTtftMedian * this.ttftSpikeFactor;

    if (transport.ttftMs !== undefined) {
      this.pushBounded(this.ttftSamples, transport.ttftMs, this.ttftWindow);
    }

    const rpmLow =
      transport.rpmHeadroomRatio !== undefined &&
      transport.rpmHeadroomRatio < this.rateLimitSafetyFloor;
    const tpmLow =
      transport.tpmHeadroomRatio !== undefined &&
      transport.tpmHeadroomRatio < this.rateLimitSafetyFloor;

    if (ttftSpike || rpmLow || tpmLow) {
      this.wip = Math.max(this.minWip, Math.floor(this.wip * 0.5));
      this.ttftMdTriggered = true;
      this.mdCount += 1;
      const reason = ttftSpike
        ? "ttft_spike_md"
        : rpmLow
          ? "rpm_headroom_md"
          : "tpm_headroom_md";
      return {
        changed: this.wip !== oldWip,
        oldWip,
        newWip: this.wip,
        reason,
        ttftMdTriggered: true,
        heavyTailedProtected: false,
        estimate: this.currentEstimate()
      };
    }

    const estimate = this.currentEstimate();
    const heavyTailed =
      Number.isFinite(prevSvcMedian) &&
      prevSvcMedian > 0 &&
      serviceMs > prevSvcMedian * 2.0;

    if (heavyTailed) {
      this.heavyTailedProtectedCount += 1;
    }

    // Cap AI growth using Kingman recommendedMaxRho when combined arrival/service variability is high
    const kingmanCeiling =
      estimate.variabilityFactor > 1.25
        ? Math.max(this.minWip + 1, Math.round(estimate.recommendedMaxRho * this.maxWip))
        : this.maxWip;

    const nextWip =
      this.wip >= kingmanCeiling ? this.wip : Math.min(kingmanCeiling, this.wip + 1);
    this.wip = Math.max(this.minWip, nextWip);
    this.peakEquilibriumWip = Math.max(this.peakEquilibriumWip, this.wip);

    return {
      changed: this.wip !== oldWip,
      oldWip,
      newWip: this.wip,
      reason: heavyTailed ? "heavy_tail_protected_ai" : "clean_completion_ai",
      ttftMdTriggered: false,
      heavyTailedProtected: heavyTailed,
      estimate
    };
  }

  onTransportBackpressure(): KingmanStepDecision {
    const oldWip = this.wip;
    this.wip = Math.max(this.minWip, Math.floor(this.wip * 0.5));
    this.ttftMdTriggered = true;
    this.mdCount += 1;
    return {
      changed: this.wip !== oldWip,
      oldWip,
      newWip: this.wip,
      reason: "transport_timeout_md",
      ttftMdTriggered: true,
      heavyTailedProtected: false,
      estimate: this.currentEstimate()
    };
  }

  medianServiceMs(): number {
    return medianOf(this.serviceSamples);
  }

  getSnapshot(): KingmanMetricsSnapshot {
    const svcStats = computeSummaryStats(this.serviceSamples);
    const arrStats = computeSummaryStats(this.interArrivalSamples);
    const estimate = this.currentEstimate();
    return {
      wip: this.wip,
      peakEquilibriumWip: this.peakEquilibriumWip,
      ttftMdTriggered: this.ttftMdTriggered,
      mdCount: this.mdCount,
      heavyTailedProtectedCount: this.heavyTailedProtectedCount,
      cs2: svcStats.cs2,
      ca2: arrStats.count >= 2 ? arrStats.cs2 : 1,
      rho: estimate.rho,
      meanServiceMs: svcStats.meanMs,
      medianTtftMs: this.ttftSamples.length > 0 ? medianOf(this.ttftSamples) : 0,
      estimate
    };
  }
}

function readAttrNumber(
  attrs: readonly DiscoverAttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  key: string
): number | undefined {
  if (!attrs) return undefined;
  if (Array.isArray(attrs)) {
    let last: number | undefined;
    for (const a of attrs) {
      if (a && typeof a === "object" && (a as DiscoverAttributeLike).name === key) {
        const n = Number((a as DiscoverAttributeLike).value);
        if (Number.isFinite(n)) last = n;
      }
    }
    return last;
  }
  const rec = attrs as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(rec, key)) {
    const n = Number(rec[key]);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function analyzeOcelKingmanMetrics(
  logs: DiscoverDocLike | readonly DiscoverDocLike[],
  config: KingmanSchedulerConfig = {}
): KingmanMetricsSnapshot & { samplesAnalyzed: number } {
  const docs: readonly DiscoverDocLike[] = Array.isArray(logs) ? logs : [logs as DiscoverDocLike];
  const scheduler = new KingmanScheduler({ ...config, useWallClockFallback: false });

  const observations: Array<{ timeMs: number; serviceMs: number; ttftMs?: number; rpm?: number; tpm?: number }> = [];

  for (const doc of docs) {
    const objById = new Map(doc.objects.map((o) => [o.id, o]));
    for (const ev of doc.events ?? []) {
      const evSvc = readAttrNumber(ev.attributes, "service_ms");
      const evTtft = readAttrNumber(ev.attributes, "ttft_ms");
      const evRpm = readAttrNumber(ev.attributes, "rpm_headroom_ratio");
      const evTpm = readAttrNumber(ev.attributes, "tpm_headroom_ratio");

      let svc = evSvc;
      let ttft = evTtft;
      if (svc === undefined || ttft === undefined) {
        for (const rel of ev.relationships ?? []) {
          const obj = objById.get(rel.objectId);
          if (!obj || obj.type !== "model_request") continue;
          if (svc === undefined) svc = readAttrNumber(obj.attributes, "service_ms");
          if (ttft === undefined) ttft = readAttrNumber(obj.attributes, "ttft_ms");
        }
      }

      if (svc !== undefined || ttft !== undefined) {
        const parsedMs = Date.parse(ev.time);
        observations.push({
          timeMs: Number.isFinite(parsedMs) ? parsedMs : 0,
          serviceMs: svc ?? ttft ?? 0,
          ttftMs: ttft,
          rpm: evRpm,
          tpm: evTpm
        });
      }
    }
  }

  observations.sort((a, b) => a.timeMs - b.timeMs);

  for (let i = 0; i < observations.length; i++) {
    const cur = observations[i]!;
    const interArrivalMs =
      i > 0 && cur.timeMs > observations[i - 1]!.timeMs
        ? cur.timeMs - observations[i - 1]!.timeMs
        : undefined;
    scheduler.onSuccess(cur.serviceMs, {
      ttftMs: cur.ttftMs,
      rpmHeadroomRatio: cur.rpm,
      tpmHeadroomRatio: cur.tpm,
      interArrivalMs
    });
  }

  return {
    ...scheduler.getSnapshot(),
    samplesAnalyzed: observations.length
  };
}

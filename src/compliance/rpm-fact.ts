import { createHash } from "node:crypto";
import { ComplianceRefusalError } from "./config.ts";
import {
  containsUnredactedSecretsOrPii,
  pseudonymizeActor,
  redactComplianceData,
  redactComplianceText
} from "./redactor.ts";

export interface RpmAttributeLike {
  name: string;
  value: unknown;
  time?: string;
}

export interface RpmRelationshipLike {
  objectId: string;
  qualifier: string;
}

export interface RpmObjectLike {
  id: string;
  type: string;
  attributes: readonly RpmAttributeLike[] | readonly unknown[] | Record<string, unknown>;
  relationships?: readonly RpmRelationshipLike[] | readonly unknown[];
}

export interface RpmEventLike {
  id: string;
  type: string;
  time: string;
  attributes: readonly RpmAttributeLike[] | Record<string, unknown>;
  relationships: readonly RpmRelationshipLike[];
}

export interface RpmDocLike {
  objectTypes?: ReadonlyArray<{ name: string; attributes?: unknown[] }>;
  eventTypes?: ReadonlyArray<{ name: string; attributes?: unknown[] }>;
  objects: readonly RpmObjectLike[];
  events: readonly RpmEventLike[];
}

export type RpmStanding = "ALIVE" | "PARTIAL_ALIVE" | "UNVERIFIED";

export interface RpmAuditOptions {
  fairnessThreshold?: number;
  minGroupSessions?: number;
  fairnessAlpha?: number;
  latencyParityThreshold?: number;
  ttftParityThreshold?: number;
  redactPii?: boolean;
  redactEnv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  strictHashChain?: boolean;
}

export interface FairnessGroupMetric {
  dimension: "provider_id" | "model_id" | "repo";
  group: string;
  totalSessions: number;
  conformingCount: number;
  conformingRate: number;
  meanServiceMs: number;
  meanTtftMs: number;
  sessionIds: string[];
}

export interface FairnessDimensionReport {
  dimension: "provider_id" | "model_id" | "repo";
  groups: FairnessGroupMetric[];
  disparateImpactRatio: number;
  parityDifference: number;
  pValue?: number;
  insufficientSample?: boolean;
  serviceMsParityRatio?: number;
  ttftMsParityRatio?: number;
  passed: boolean;
}

export interface FairnessDisparityFinding {
  dimension: "provider_id" | "model_id" | "repo";
  metric?: "conforming_rate" | "service_ms" | "ttft_ms";
  lowestGroup: string;
  highestGroup: string;
  disparateImpactRatio: number;
  threshold: number;
  pValue?: number;
  offendingSessionIds: string[];
  articleRef: string;
}

export interface RpmAccuracyReport {
  standing: RpmStanding;
  totalEvents: number;
  totalObjects: number;
  missingE2oCount: number;
  missingE2oRatio: number;
  danglingE2oCount: number;
  danglingO2oCount: number;
  invalidTimestampCount: number;
  nonMonotonicCount: number;
  chainStatus: "INTACT" | "BROKEN" | "PARTIAL" | "ABSENT";
  chainFailureReason: string | null;
  qualityScore: number;
}

export interface RpmConfidentialityViolation {
  targetType: "event" | "object";
  targetId: string;
  kind: "secret_or_pii" | "raw_actor_id";
  field: string;
  redactedSummary: string;
}

export interface RpmTransparencyExplanation {
  pillar: "fairness" | "accuracy" | "confidentiality" | "transparency";
  ruleId: string;
  articleRef: string;
  verdict: "PASS" | "WARN" | "FAIL";
  summary: string;
  evidenceIds: string[];
  metric: string;
  observed: number | string;
  threshold: number | string;
}

export interface RpmFactAuditReport {
  schema: "zcode.rpm-fact/1";
  standing: RpmStanding;
  passed: boolean;
  missingE2oRatio: number;
  fairness: {
    passed: boolean;
    threshold: number;
    dimensions: Record<"provider_id" | "model_id" | "repo", FairnessDimensionReport>;
    disparities: FairnessDisparityFinding[];
  };
  accuracy: RpmAccuracyReport;
  confidentiality: {
    passed: boolean;
    violations: RpmConfidentialityViolation[];
  };
  transparency: {
    passed: boolean;
    explanationCount: number;
  };
  explanations: RpmTransparencyExplanation[];
}

const ACTOR_OBJECT_TYPES = new Set([
  "human_overseer",
  "worker",
  "actor",
  "user",
  "overseer"
]);

const ACTOR_ATTR_KEYS = new Set([
  "overseer_id",
  "actor",
  "actor_id",
  "user",
  "user_id",
  "worker",
  "worker_id",
  "approved_by"
]);

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
const PSEUDO_HEX_RE = /^[0-9a-f]{32,64}$/i;

function readAttrStr(
  attrs: readonly RpmAttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!attrs) return undefined;
  if (Array.isArray(attrs)) {
    let last: string | undefined;
    for (const a of attrs) {
      if (a && typeof a === "object" && (a as RpmAttributeLike).name === key) {
        const v = (a as RpmAttributeLike).value;
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
  attrs: readonly RpmAttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const s = readAttrStr(attrs, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function canonOcelEvent(
  e: { id: string; type: string; time: string; relationships: readonly RpmRelationshipLike[] },
  phase = "",
  ref = ""
): string {
  const rels = (e.relationships ?? [])
    .map(
      (r) =>
        `{"objectId":${JSON.stringify(r.objectId)},"qualifier":${JSON.stringify(r.qualifier)}}`
    )
    .join(",");
  const bound = phase
    ? `,"pendingRef":${JSON.stringify(ref)},"phase":${JSON.stringify(phase)}`
    : "";
  return `{"id":${JSON.stringify(e.id)}${bound},"relationships":[${rels}],"time":${JSON.stringify(e.time)},"type":${JSON.stringify(e.type)}}`;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function verifyOcelDocChain(events: readonly RpmEventLike[]): {
  status: "INTACT" | "BROKEN" | "PARTIAL" | "ABSENT";
  reason: string | null;
  offendingEventIds: string[];
} {
  if (events.length === 0) return { status: "ABSENT", reason: null, offendingEventIds: [] };

  let withHash = 0;
  let withoutHash = 0;
  let parent = "";
  const unhashedIds: string[] = [];

  for (const ev of events) {
    const hash = readAttrStr(ev.attributes, "pi_hash");
    const piParent = readAttrStr(ev.attributes, "pi_parent");
    const phase = readAttrStr(ev.attributes, "pi_phase") ?? "";
    const pendingRef = readAttrStr(ev.attributes, "pi_pending_ref") ?? "";
    const alg = readAttrStr(ev.attributes, "pi_hash_alg") ?? "sha256";

    if (hash === undefined) {
      withoutHash += 1;
      unhashedIds.push(ev.id);
      continue;
    }
    withHash += 1;

    if (alg !== "sha256") {
      return {
        status: "BROKEN",
        reason: `unsupported hash algorithm "${alg}" at event ${ev.id}`,
        offendingEventIds: [ev.id]
      };
    }
    if (piParent !== undefined && piParent !== parent) {
      return {
        status: "BROKEN",
        reason: `pi_parent mismatch at event ${ev.id}`,
        offendingEventIds: [ev.id]
      };
    }
    const expected = sha256Hex(`${parent}\n${canonOcelEvent(ev, phase, pendingRef)}`);
    if (hash !== expected) {
      return {
        status: "BROKEN",
        reason: `pi_hash mismatch at event ${ev.id}`,
        offendingEventIds: [ev.id]
      };
    }
    parent = expected;
  }

  if (withHash === 0) return { status: "ABSENT", reason: null, offendingEventIds: unhashedIds };
  if (withoutHash > 0) return { status: "PARTIAL", reason: null, offendingEventIds: unhashedIds };
  return { status: "INTACT", reason: null, offendingEventIds: [] };
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * Two-sided Fisher's exact test for a 2x2 contingency table:
 *   [[a, b],
 *    [c, d]]
 */
function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const n = row1 + row2;
  if (n === 0) return 1;
  const denom = logChoose(n, col1);
  const hyperProb = (x: number): number =>
    Math.exp(logChoose(row1, x) + logChoose(row2, col1 - x) - denom);

  const pObs = hyperProb(a);
  const lo = Math.max(0, col1 - row2);
  const hi = Math.min(row1, col1);
  let pSum = 0;
  for (let x = lo; x <= hi; x++) {
    const px = hyperProb(x);
    if (px <= pObs + 1e-12) {
      pSum += px;
    }
  }
  return Math.min(1, pSum);
}

function isActorValueRedactedOrPseudonymized(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return true;
  if (trimmed === "REDACTED" || trimmed === "[REDACTED]") return true;
  if (SHA256_HEX_RE.test(trimmed)) return true;
  if (trimmed.startsWith("pseudo_") && PSEUDO_HEX_RE.test(trimmed.slice(7))) return true;
  return false;
}

export function auditRpmFact(
  logs: RpmDocLike | readonly RpmDocLike[],
  options: RpmAuditOptions = {}
): RpmFactAuditReport {
  const docs: readonly RpmDocLike[] = Array.isArray(logs) ? logs : [logs as RpmDocLike];
  const fairnessThreshold = options.fairnessThreshold ?? 0.8;
  const minGroupSessions = options.minGroupSessions ?? 2;
  const fairnessAlpha = options.fairnessAlpha ?? 0.15;
  const latencyParityThreshold = options.latencyParityThreshold ?? 0.5;
  const ttftParityThreshold = options.ttftParityThreshold ?? 0.5;
  const strictHashChain = options.strictHashChain ?? false;
  const redactorOpts = {
    redactPii: options.redactPii ?? true,
    redactEnv: options.redactEnv,
    env: options.env
  };

  let totalEvents = 0;
  let totalObjects = 0;
  let missingE2oCount = 0;
  let danglingE2oCount = 0;
  let danglingO2oCount = 0;
  let invalidTimestampCount = 0;
  let nonMonotonicCount = 0;

  let brokenChains = 0;
  let intactChains = 0;
  let partialChains = 0;
  let chainFailureReason: string | null = null;
  const accuracyEvidenceIds = new Set<string>();

  const confidentialityViolations: RpmConfidentialityViolation[] = [];

  // Operational fairness accumulators (provider_id, model_id, repo)
  const sessionInfo = new Map<
    string,
    {
      provider_id?: string;
      model_id?: string;
      repo?: string;
      failed: boolean;
      serviceMsSum: number;
      serviceMsCount: number;
      ttftMsSum: number;
      ttftMsCount: number;
    }
  >();

  const ensureSession = (sid: string) => {
    let rec = sessionInfo.get(sid);
    if (!rec) {
      rec = {
        failed: false,
        serviceMsSum: 0,
        serviceMsCount: 0,
        ttftMsSum: 0,
        ttftMsCount: 0
      };
      sessionInfo.set(sid, rec);
    }
    return rec;
  };

  for (let dIdx = 0; dIdx < docs.length; dIdx++) {
    const doc = docs[dIdx]!;
    const objById = new Map<string, RpmObjectLike>();

    for (const obj of doc.objects ?? []) {
      totalObjects += 1;
      objById.set(obj.id, obj);

      if (containsUnredactedSecretsOrPii(JSON.stringify(obj), redactorOpts)) {
        confidentialityViolations.push({
          targetType: "object",
          targetId: obj.id,
          kind: "secret_or_pii",
          field: "attributes",
          redactedSummary: redactComplianceText(`Unredacted secret/PII in object ${obj.id}`, redactorOpts)
        });
      }

      if (ACTOR_OBJECT_TYPES.has(obj.type) && !isActorValueRedactedOrPseudonymized(obj.id)) {
        confidentialityViolations.push({
          targetType: "object",
          targetId: obj.id,
          kind: "raw_actor_id",
          field: "id",
          redactedSummary: `Raw unpseudonymized actor identifier in ${obj.type}.id`
        });
      }

      for (const key of ACTOR_ATTR_KEYS) {
        const val = readAttrStr(obj.attributes, key);
        if (val !== undefined && !isActorValueRedactedOrPseudonymized(val)) {
          confidentialityViolations.push({
            targetType: "object",
            targetId: obj.id,
            kind: "raw_actor_id",
            field: key,
            redactedSummary: `Raw unpseudonymized actor identifier in ${obj.type}.${key}`
          });
        }
      }
    }

    for (const obj of doc.objects ?? []) {
      const o2oRels = (obj.relationships ?? []) as readonly RpmRelationshipLike[];
      for (const rel of o2oRels) {
        if (rel && typeof rel.objectId === "string" && !objById.has(rel.objectId)) {
          danglingO2oCount += 1;
          accuracyEvidenceIds.add(obj.id);
        }
      }
    }

    const docEvents = doc.events ?? [];
    const chainRes = verifyOcelDocChain(docEvents);
    if (chainRes.status === "BROKEN") {
      brokenChains += 1;
      if (!chainFailureReason) chainFailureReason = chainRes.reason;
      for (const eid of chainRes.offendingEventIds) accuracyEvidenceIds.add(eid);
    } else if (chainRes.status === "INTACT") {
      intactChains += 1;
    } else if (chainRes.status === "PARTIAL") {
      partialChains += 1;
      for (const eid of chainRes.offendingEventIds) accuracyEvidenceIds.add(eid);
    } else if (chainRes.status === "ABSENT") {
      for (const eid of chainRes.offendingEventIds) accuracyEvidenceIds.add(eid);
    }

    let prevMs = -Infinity;

    for (const ev of docEvents) {
      totalEvents += 1;

      const ms = Date.parse(ev.time);
      if (!Number.isFinite(ms)) {
        invalidTimestampCount += 1;
        accuracyEvidenceIds.add(ev.id);
      } else {
        if (ms < prevMs) {
          nonMonotonicCount += 1;
          accuracyEvidenceIds.add(ev.id);
        }
        prevMs = ms;
      }

      const rels = ev.relationships ?? [];
      if (rels.length === 0) {
        missingE2oCount += 1;
        accuracyEvidenceIds.add(ev.id);
      } else {
        for (const rel of rels) {
          if (!objById.has(rel.objectId)) {
            danglingE2oCount += 1;
            accuracyEvidenceIds.add(ev.id);
          }
        }
      }

      if (containsUnredactedSecretsOrPii(JSON.stringify(ev), redactorOpts)) {
        confidentialityViolations.push({
          targetType: "event",
          targetId: ev.id,
          kind: "secret_or_pii",
          field: "attributes",
          redactedSummary: redactComplianceText(`Unredacted secret/PII in event ${ev.id}`, redactorOpts)
        });
      }

      for (const key of ACTOR_ATTR_KEYS) {
        const val = readAttrStr(ev.attributes, key);
        if (val !== undefined && !isActorValueRedactedOrPseudonymized(val)) {
          confidentialityViolations.push({
            targetType: "event",
            targetId: ev.id,
            kind: "raw_actor_id",
            field: key,
            redactedSummary: `Raw unpseudonymized actor identifier in event ${ev.type}.${key}`
          });
        }
      }

      // Attribute session fairness metrics
      const sessRel = rels.find(
        (r) => r.qualifier === "in_session" || objById.get(r.objectId)?.type === "session"
      );
      const sessionId = sessRel ? `${dIdx}:${sessRel.objectId}` : `${dIdx}:__doc__`;
      const srec = ensureSession(sessionId);

      const pId = readAttrStr(ev.attributes, "provider_id");
      const mId = readAttrStr(ev.attributes, "model_id");
      const rId = readAttrStr(ev.attributes, "repo");
      if (pId) srec.provider_id = pId;
      if (mId) srec.model_id = mId;
      if (rId) srec.repo = rId;

      for (const rel of rels) {
        const o = objById.get(rel.objectId);
        if (!o) continue;
        const op = readAttrStr(o.attributes, "provider_id");
        const om = readAttrStr(o.attributes, "model_id");
        const or = readAttrStr(o.attributes, "repo");
        if (op && !srec.provider_id) srec.provider_id = op;
        if (om && !srec.model_id) srec.model_id = om;
        if (or && !srec.repo) srec.repo = or;
      }

      const svc = readAttrNum(ev.attributes, "service_ms");
      if (svc !== undefined) {
        srec.serviceMsSum += svc;
        srec.serviceMsCount += 1;
      }
      const ttft = readAttrNum(ev.attributes, "ttft_ms");
      if (ttft !== undefined) {
        srec.ttftMsSum += ttft;
        srec.ttftMsCount += 1;
      }

      if (
        ev.type === "turn_failed" ||
        ev.type === "transition_refused" ||
        ev.type === "execution_crash" ||
        ev.type === "oversight_policy_refused" ||
        readAttrStr(ev.attributes, "status") === "error" ||
        readAttrStr(ev.attributes, "status") === "failed"
      ) {
        srec.failed = true;
      }
    }
  }

  // Finalize Accuracy standing
  const chainStatus: RpmAccuracyReport["chainStatus"] =
    brokenChains > 0
      ? "BROKEN"
      : intactChains === docs.length && intactChains > 0
        ? "INTACT"
        : intactChains > 0 || partialChains > 0
          ? "PARTIAL"
          : "ABSENT";

  const missingE2oRatio = totalEvents > 0 ? missingE2oCount / totalEvents : 1;

  let standing: RpmStanding;
  if (
    totalEvents === 0 ||
    chainStatus === "BROKEN" ||
    invalidTimestampCount > 0 ||
    (strictHashChain && chainStatus !== "INTACT")
  ) {
    standing = "UNVERIFIED";
  } else if (
    chainStatus === "INTACT" &&
    missingE2oCount === 0 &&
    danglingE2oCount === 0 &&
    danglingO2oCount === 0 &&
    invalidTimestampCount === 0 &&
    nonMonotonicCount === 0
  ) {
    standing = "ALIVE";
  } else {
    standing = "PARTIAL_ALIVE";
  }

  const penalty =
    (chainStatus === "BROKEN" ? 0.5 : chainStatus === "ABSENT" ? 0.15 : chainStatus === "PARTIAL" ? 0.1 : 0) +
    0.35 * Math.min(1, missingE2oRatio) +
    (totalEvents > 0
      ? 0.15 * Math.min(1, (danglingE2oCount + danglingO2oCount + invalidTimestampCount + nonMonotonicCount) / totalEvents)
      : 0);
  const qualityScore = totalEvents === 0 ? 0 : Math.max(0, Math.min(1, 1 - penalty));

  const accuracy: RpmAccuracyReport = {
    standing,
    totalEvents,
    totalObjects,
    missingE2oCount,
    missingE2oRatio,
    danglingE2oCount,
    danglingO2oCount,
    invalidTimestampCount,
    nonMonotonicCount,
    chainStatus,
    chainFailureReason,
    qualityScore
  };

  // Finalize Fairness dimensions
  const buildDimension = (
    dim: "provider_id" | "model_id" | "repo"
  ): {
    report: FairnessDimensionReport;
    disparities: FairnessDisparityFinding[];
    underpoweredSessionIds: string[];
  } => {
    const byGroup = new Map<
      string,
      { sessions: string[]; conforming: number; svcSum: number; svcCnt: number; ttftSum: number; ttftCnt: number }
    >();

    for (const [sid, srec] of sessionInfo.entries()) {
      const grp = srec[dim];
      if (!grp) continue;
      let acc = byGroup.get(grp);
      if (!acc) {
        acc = { sessions: [], conforming: 0, svcSum: 0, svcCnt: 0, ttftSum: 0, ttftCnt: 0 };
        byGroup.set(grp, acc);
      }
      acc.sessions.push(sid);
      if (!srec.failed) acc.conforming += 1;
      acc.svcSum += srec.serviceMsSum;
      acc.svcCnt += srec.serviceMsCount;
      acc.ttftSum += srec.ttftMsSum;
      acc.ttftCnt += srec.ttftMsCount;
    }

    const groups: FairnessGroupMetric[] = [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, acc]) => ({
        dimension: dim,
        group,
        totalSessions: acc.sessions.length,
        conformingCount: acc.conforming,
        conformingRate: acc.sessions.length > 0 ? acc.conforming / acc.sessions.length : 1,
        meanServiceMs: acc.svcCnt > 0 ? acc.svcSum / acc.svcCnt : 0,
        meanTtftMs: acc.ttftCnt > 0 ? acc.ttftSum / acc.ttftCnt : 0,
        sessionIds: acc.sessions
      }));

    if (groups.length < 2) {
      return {
        report: {
          dimension: dim,
          groups,
          disparateImpactRatio: 1,
          parityDifference: 0,
          pValue: 1,
          insufficientSample: false,
          serviceMsParityRatio: 1,
          ttftMsParityRatio: 1,
          passed: true
        },
        disparities: [],
        underpoweredSessionIds: []
      };
    }

    let minGrp = groups[0]!;
    let maxGrp = groups[0]!;
    for (const g of groups) {
      if (g.conformingRate < minGrp.conformingRate) minGrp = g;
      if (g.conformingRate > maxGrp.conformingRate) maxGrp = g;
    }

    const disparateImpactRatio =
      maxGrp.conformingRate > 0 ? minGrp.conformingRate / maxGrp.conformingRate : 1;
    const parityDifference = maxGrp.conformingRate - minGrp.conformingRate;

    const pValue = fisherExactTwoSided(
      maxGrp.conformingCount,
      maxGrp.totalSessions - maxGrp.conformingCount,
      minGrp.conformingCount,
      minGrp.totalSessions - minGrp.conformingCount
    );

    const poweredGroups = groups.filter((g) => g.totalSessions >= minGroupSessions);
    const hasUnderpoweredDisparity =
      disparateImpactRatio < fairnessThreshold &&
      (minGrp.totalSessions < minGroupSessions ||
        maxGrp.totalSessions < minGroupSessions ||
        pValue > fairnessAlpha);

    const dimDisparities: FairnessDisparityFinding[] = [];
    if (disparateImpactRatio < fairnessThreshold && !hasUnderpoweredDisparity) {
      dimDisparities.push({
        dimension: dim,
        metric: "conforming_rate",
        lowestGroup: minGrp.group,
        highestGroup: maxGrp.group,
        disparateImpactRatio,
        threshold: fairnessThreshold,
        pValue,
        offendingSessionIds: minGrp.sessionIds,
        articleRef: "EU AI Act Art. 10/15"
      });
    }

    // Latency (service_ms) parity check across powered groups with service_ms > 0
    let serviceMsParityRatio = 1;
    const svcGroups = poweredGroups.filter((g) => g.meanServiceMs > 0);
    if (svcGroups.length >= 2) {
      let fastestSvc = svcGroups[0]!;
      let slowestSvc = svcGroups[0]!;
      for (const g of svcGroups) {
        if (g.meanServiceMs < fastestSvc.meanServiceMs) fastestSvc = g;
        if (g.meanServiceMs > slowestSvc.meanServiceMs) slowestSvc = g;
      }
      serviceMsParityRatio =
        slowestSvc.meanServiceMs > 0 ? fastestSvc.meanServiceMs / slowestSvc.meanServiceMs : 1;
      if (serviceMsParityRatio < latencyParityThreshold) {
        dimDisparities.push({
          dimension: dim,
          metric: "service_ms",
          lowestGroup: slowestSvc.group,
          highestGroup: fastestSvc.group,
          disparateImpactRatio: serviceMsParityRatio,
          threshold: latencyParityThreshold,
          offendingSessionIds: slowestSvc.sessionIds,
          articleRef: "EU AI Act Art. 10/15"
        });
      }
    }

    // TTFT (ttft_ms) parity check across powered groups with ttft_ms > 0
    let ttftMsParityRatio = 1;
    const ttftGroups = poweredGroups.filter((g) => g.meanTtftMs > 0);
    if (ttftGroups.length >= 2) {
      let fastestTtft = ttftGroups[0]!;
      let slowestTtft = ttftGroups[0]!;
      for (const g of ttftGroups) {
        if (g.meanTtftMs < fastestTtft.meanTtftMs) fastestTtft = g;
        if (g.meanTtftMs > slowestTtft.meanTtftMs) slowestTtft = g;
      }
      ttftMsParityRatio =
        slowestTtft.meanTtftMs > 0 ? fastestTtft.meanTtftMs / slowestTtft.meanTtftMs : 1;
      if (ttftMsParityRatio < ttftParityThreshold) {
        dimDisparities.push({
          dimension: dim,
          metric: "ttft_ms",
          lowestGroup: slowestTtft.group,
          highestGroup: fastestTtft.group,
          disparateImpactRatio: ttftMsParityRatio,
          threshold: ttftParityThreshold,
          offendingSessionIds: slowestTtft.sessionIds,
          articleRef: "EU AI Act Art. 10/15"
        });
      }
    }

    const passed = dimDisparities.length === 0;
    const underpoweredSessionIds = hasUnderpoweredDisparity
      ? [...new Set([...minGrp.sessionIds, ...maxGrp.sessionIds])]
      : [];

    return {
      report: {
        dimension: dim,
        groups,
        disparateImpactRatio,
        parityDifference,
        pValue,
        insufficientSample: hasUnderpoweredDisparity,
        serviceMsParityRatio,
        ttftMsParityRatio,
        passed
      },
      disparities: dimDisparities,
      underpoweredSessionIds
    };
  };

  const pDim = buildDimension("provider_id");
  const mDim = buildDimension("model_id");
  const rDim = buildDimension("repo");
  const disparities: FairnessDisparityFinding[] = [
    ...pDim.disparities,
    ...mDim.disparities,
    ...rDim.disparities
  ];
  const underpoweredSessionIds = [
    ...new Set([
      ...pDim.underpoweredSessionIds,
      ...mDim.underpoweredSessionIds,
      ...rDim.underpoweredSessionIds
    ])
  ];
  const hasUnderpoweredFairness =
    pDim.report.insufficientSample === true ||
    mDim.report.insufficientSample === true ||
    rDim.report.insufficientSample === true;
  const fairnessPassed = disparities.length === 0;
  const confidentialityPassed = confidentialityViolations.length === 0;

  // Build White-Box Transparency Explanations
  const pillarExplanations: RpmTransparencyExplanation[] = [
    {
      pillar: "accuracy",
      ruleId: "RPM-ACC-01",
      articleRef: "EU AI Act Art. 12/15",
      verdict: standing === "ALIVE" ? "PASS" : standing === "PARTIAL_ALIVE" ? "WARN" : "FAIL",
      summary:
        standing === "ALIVE"
          ? `All ${totalEvents} events verified with intact SHA-256 chain and complete E2O/O2O bindings.`
          : `Accuracy standing is ${standing}: chainStatus=${chainStatus}, missingE2o=${missingE2oCount}/${totalEvents}, danglingE2o=${danglingE2oCount}, danglingO2o=${danglingO2oCount}, invalidTimestamps=${invalidTimestampCount}.`,
      evidenceIds: [...accuracyEvidenceIds],
      metric: "missing_e2o_ratio",
      observed: Number(missingE2oRatio.toFixed(4)),
      threshold: 0
    },
    {
      pillar: "confidentiality",
      ruleId: "RPM-CONF-01",
      articleRef: "EU AI Act Art. 10",
      verdict: confidentialityPassed ? "PASS" : "FAIL",
      summary: confidentialityPassed
        ? "Zero unredacted secrets, PII, or raw actor identifiers detected across OCEL objects and events."
        : `Detected ${confidentialityViolations.length} unredacted secret/PII or raw actor identifier violation(s).`,
      evidenceIds: confidentialityViolations.map((v) => v.targetId),
      metric: "confidentiality_violations",
      observed: confidentialityViolations.length,
      threshold: 0
    },
    {
      pillar: "fairness",
      ruleId: "RPM-FAIR-01",
      articleRef: "EU AI Act Art. 10/15",
      verdict: !fairnessPassed ? "FAIL" : hasUnderpoweredFairness ? "WARN" : "PASS",
      summary: !fairnessPassed
        ? `Disparate impact violation across ${[...new Set(disparities.map((d) => d.dimension))].join(", ")}.`
        : hasUnderpoweredFairness
          ? "Observed group disparity did not meet minimum session floor or statistical significance threshold (insufficient sample)."
          : "Operational conformance and latency parity across provider_id, model_id, and repo satisfies thresholds.",
      evidenceIds: !fairnessPassed
        ? disparities.flatMap((d) => d.offendingSessionIds)
        : underpoweredSessionIds,
      metric: "min_disparate_impact_ratio",
      observed: Number(
        Math.min(
          pDim.report.disparateImpactRatio,
          mDim.report.disparateImpactRatio,
          rDim.report.disparateImpactRatio
        ).toFixed(4)
      ),
      threshold: fairnessThreshold
    }
  ];

  // Derived transparency completeness check (no hardcoded PASS)
  const hasEntities = totalEvents > 0 || totalObjects > 0;
  const incompleteRuleIds: string[] = [];
  for (const exp of pillarExplanations) {
    const hasMetadata =
      exp.ruleId.trim().length > 0 &&
      exp.articleRef.trim().length > 0 &&
      exp.summary.trim().length > 0 &&
      exp.metric.trim().length > 0;
    const hasRequiredEvidence =
      exp.verdict === "PASS" || !hasEntities || exp.evidenceIds.length > 0;
    if (!hasMetadata || !hasRequiredEvidence) {
      incompleteRuleIds.push(exp.ruleId);
    }
  }
  const completePillars = pillarExplanations.length - incompleteRuleIds.length;
  const transparencyPassed = incompleteRuleIds.length === 0;

  const explanations: RpmTransparencyExplanation[] = [
    ...pillarExplanations,
    {
      pillar: "transparency",
      ruleId: "RPM-TRANS-01",
      articleRef: "EU AI Act Art. 13/50",
      verdict: transparencyPassed ? "PASS" : "FAIL",
      summary: transparencyPassed
        ? "All FACT verdicts emit white-box metric citations, thresholds, and exact OCEL evidence IDs."
        : `Incomplete white-box evidence citations for rule(s): ${incompleteRuleIds.join(", ")}.`,
      evidenceIds: incompleteRuleIds,
      metric: "explanation_coverage",
      observed: completePillars + (transparencyPassed ? 1 : 0),
      threshold: 4
    }
  ];

  const passed =
    standing !== "UNVERIFIED" &&
    fairnessPassed &&
    confidentialityPassed &&
    transparencyPassed;

  return {
    schema: "zcode.rpm-fact/1",
    standing,
    passed,
    missingE2oRatio,
    fairness: {
      passed: fairnessPassed,
      threshold: fairnessThreshold,
      dimensions: {
        provider_id: pDim.report,
        model_id: mDim.report,
        repo: rDim.report
      },
      disparities
    },
    accuracy,
    confidentiality: {
      passed: confidentialityPassed,
      violations: confidentialityViolations
    },
    transparency: {
      passed: transparencyPassed,
      explanationCount: explanations.length
    },
    explanations
  };
}

export interface KAnonOptions {
  generalizeQuasiIdentifiers?: boolean;
  suppressBelowK?: boolean;
  resealHashChain?: boolean;
  timestampBucket?: "hour" | "day" | "none";
  lDiversity?: number;
}

export interface KAnonResult<T extends RpmDocLike = RpmDocLike> {
  doc: T;
  k: number;
  totalTraces: number;
  retainedTraces: number;
  suppressedTraces: number;
  generalizedTraces: number;
  minEquivalenceClassSize: number;
  minLDiversity: number;
  variantCounts: Record<string, number>;
}

const QUASI_ATTR_KEYS = new Set(["provider_id", "model_id", "repo"]);

function mapAttributes(
  attrs: readonly RpmAttributeLike[] | readonly unknown[] | Record<string, unknown>,
  fn: (name: string, value: unknown, time?: string) => unknown
): RpmAttributeLike[] | Record<string, unknown> {
  if (Array.isArray(attrs)) {
    return (attrs as readonly RpmAttributeLike[]).map((entry) => ({
      ...entry,
      value: fn(entry.name, entry.value, entry.time)
    }));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
    out[k] = fn(k, v);
  }
  return out;
}

function generalizeTimestamp(iso: string, bucket: "hour" | "day" | "none"): string {
  if (bucket === "none") return iso;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms).toISOString();
  if (bucket === "hour") return `${d.slice(0, 13)}:00:00.000Z`;
  return `${d.slice(0, 10)}T00:00:00.000Z`;
}

export function anonymizeOcel2KAnon<T extends RpmDocLike>(
  doc: T,
  k: number,
  salt: string,
  options: KAnonOptions = {}
): KAnonResult<T> {
  if (!Number.isInteger(k) || k < 2) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `k_anonymity must be an integer >= 2 (got ${String(k)})`,
      "admission_vacuous"
    );
  }
  if (typeof salt !== "string" || salt.trim().length === 0 || /^0+$/.test(salt.trim())) {
    throw new ComplianceRefusalError(
      "REDACTION_FAILURE",
      "anonymizeOcel2KAnon requires a non-empty, non-zero cryptographic salt",
      "R_missing_authority"
    );
  }

  const generalizeQuasi = options.generalizeQuasiIdentifiers ?? true;
  const suppressBelowK = options.suppressBelowK ?? true;
  const timestampBucket = options.timestampBucket ?? "none";
  const lDiversity = options.lDiversity ?? 1;
  if (!Number.isInteger(lDiversity) || lDiversity < 1) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `lDiversity must be an integer >= 1 (got ${String(lDiversity)})`,
      "admission_vacuous"
    );
  }

  // 1. Pseudonymize actor object IDs and rewrite relationships
  const actorIdMap = new Map<string, string>();
  for (const obj of doc.objects ?? []) {
    if (ACTOR_OBJECT_TYPES.has(obj.type)) {
      actorIdMap.set(obj.id, `pseudo_${pseudonymizeActor(obj.id, salt)}`);
    }
  }

  const remapObjectId = (id: string): string => actorIdMap.get(id) ?? id;

  const scrubAttrs = (attrs: readonly RpmAttributeLike[] | readonly unknown[] | Record<string, unknown>) =>
    mapAttributes(attrs, (name, value) => {
      if (name.startsWith("pi_")) return value;
      if (ACTOR_ATTR_KEYS.has(name) && value !== undefined && value !== null && String(value).length > 0) {
        return isActorValueRedactedOrPseudonymized(String(value))
          ? String(value)
          : pseudonymizeActor(String(value), salt);
      }
      return redactComplianceData(value, { redactPii: true });
    });

  const objById = new Map<string, RpmObjectLike>();
  const clonedObjects: RpmObjectLike[] = (doc.objects ?? []).map((obj) => {
    const newId = remapObjectId(obj.id);
    const rels = (obj.relationships ?? []) as readonly RpmRelationshipLike[];
    const cloned: RpmObjectLike = {
      ...obj,
      id: newId,
      attributes: scrubAttrs(obj.attributes),
      relationships: rels.map((r) => ({
        ...r,
        objectId: remapObjectId(r.objectId)
      }))
    };
    objById.set(newId, cloned);
    return cloned;
  });

  const hadHashChain = (doc.events ?? []).some((e) => readAttrStr(e.attributes, "pi_hash") !== undefined);

  const clonedEvents: RpmEventLike[] = (doc.events ?? []).map((ev) => ({
    ...ev,
    attributes: scrubAttrs(ev.attributes),
    relationships: (ev.relationships ?? []).map((r) => ({
      ...r,
      objectId: remapObjectId(r.objectId)
    }))
  }));

  // 2. Group events into case traces (session > work_order > turn > singleton)
  const tracesMap = new Map<string, RpmEventLike[]>();
  for (const ev of clonedEvents) {
    let caseKey: string | undefined;
    for (const rel of ev.relationships) {
      const o = objById.get(rel.objectId);
      if (rel.qualifier === "in_session" || o?.type === "session") {
        caseKey = `session:${rel.objectId}`;
        break;
      }
    }
    if (!caseKey) {
      for (const rel of ev.relationships) {
        const o = objById.get(rel.objectId);
        if (rel.qualifier === "subject" || o?.type === "work_order") {
          caseKey = `work_order:${rel.objectId}`;
          break;
        }
      }
    }
    if (!caseKey) {
      for (const rel of ev.relationships) {
        const o = objById.get(rel.objectId);
        if (rel.qualifier === "in_turn" || o?.type === "turn") {
          caseKey = `turn:${rel.objectId}`;
          break;
        }
      }
    }
    if (!caseKey) caseKey = `singleton:${ev.id}`;

    let arr = tracesMap.get(caseKey);
    if (!arr) {
      arr = [];
      tracesMap.set(caseKey, arr);
    }
    arr.push(ev);
  }

  interface TraceInfo {
    caseKey: string;
    events: RpmEventLike[];
    variant: string;
    timeBucket: string;
    quasiKey: string;
    sensitiveOutcome: string;
    linkedObjectIds: Set<string>;
  }

  const classifySensitiveOutcome = (evs: readonly RpmEventLike[]): string => {
    for (const ev of evs) {
      if (ev.type === "oversight_policy_refused") return "oversight_policy_refused";
      if (
        ev.type === "turn_failed" ||
        ev.type === "execution_crash" ||
        ev.type === "transition_refused"
      ) {
        return ev.type;
      }
      const st = readAttrStr(ev.attributes, "status");
      if (st === "error" || st === "failed") return `status_${st}`;
    }
    return "conforming";
  };

  const collectReachableObjectIds = (evs: readonly RpmEventLike[]): Set<string> => {
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const e of evs) {
      for (const rel of e.relationships ?? []) {
        if (!visited.has(rel.objectId)) {
          visited.add(rel.objectId);
          queue.push(rel.objectId);
        }
      }
    }
    while (queue.length > 0) {
      const oid = queue.shift()!;
      const o = objById.get(oid);
      if (!o) continue;
      for (const rel of (o.relationships ?? []) as readonly RpmRelationshipLike[]) {
        if (rel && typeof rel.objectId === "string" && !visited.has(rel.objectId)) {
          visited.add(rel.objectId);
          queue.push(rel.objectId);
        }
      }
    }
    return visited;
  };

  const traces: TraceInfo[] = [];
  for (const [caseKey, evs] of tracesMap.entries()) {
    evs.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const variant = evs.map((e) => e.type).join("->");
    const linkedObjectIds = collectReachableObjectIds(evs);
    const provVals = new Set<string>();
    const modelVals = new Set<string>();
    const repoVals = new Set<string>();

    for (const e of evs) {
      const ep = readAttrStr(e.attributes, "provider_id");
      const em = readAttrStr(e.attributes, "model_id");
      const er = readAttrStr(e.attributes, "repo");
      if (ep) provVals.add(ep);
      if (em) modelVals.add(em);
      if (er) repoVals.add(er);

      for (const rel of e.relationships ?? []) {
        const o = objById.get(rel.objectId);
        if (!o) continue;
        const op = readAttrStr(o.attributes, "provider_id");
        const om = readAttrStr(o.attributes, "model_id");
        const or = readAttrStr(o.attributes, "repo");
        if (op) provVals.add(op);
        if (om) modelVals.add(om);
        if (or) repoVals.add(or);
      }
    }
    for (const oid of linkedObjectIds) {
      const o = objById.get(oid);
      if (!o) continue;
      const op = readAttrStr(o.attributes, "provider_id");
      const om = readAttrStr(o.attributes, "model_id");
      const or = readAttrStr(o.attributes, "repo");
      if (op) provVals.add(op);
      if (om) modelVals.add(om);
      if (or) repoVals.add(or);
    }

    const formatQuasiSet = (vals: Set<string>): string =>
      vals.size === 0 ? "*" : [...vals].sort().join(",");
    const prov = formatQuasiSet(provVals);
    const model = formatQuasiSet(modelVals);
    const repo = formatQuasiSet(repoVals);
    const timeBucket =
      timestampBucket !== "none"
        ? formatQuasiSet(new Set(evs.map((e) => generalizeTimestamp(e.time, timestampBucket))))
        : "*";
    const quasiKey =
      timestampBucket !== "none"
        ? `${variant}::${prov}|${model}|${repo}|${timeBucket}`
        : `${variant}::${prov}|${model}|${repo}`;
    traces.push({
      caseKey,
      events: evs,
      variant,
      timeBucket,
      quasiKey,
      sensitiveOutcome: classifySensitiveOutcome(evs),
      linkedObjectIds
    });
  }

  // Count equivalence classes (variant + quasi-identifiers) and ensure post-generalization k-anonymity
  const quasiClassCounts = new Map<string, number>();
  const variantCountsMap = new Map<string, number>();
  for (const tr of traces) {
    quasiClassCounts.set(tr.quasiKey, (quasiClassCounts.get(tr.quasiKey) ?? 0) + 1);
    variantCountsMap.set(tr.variant, (variantCountsMap.get(tr.variant) ?? 0) + 1);
  }

  const tracePlan = traces.map((tr) => {
    const qCount = quasiClassCounts.get(tr.quasiKey) ?? 0;
    const vCount = variantCountsMap.get(tr.variant) ?? 0;
    const suppressed = vCount < k && suppressBelowK;
    const generalize = !suppressed && generalizeQuasi && qCount < k && (vCount >= k || !suppressBelowK);
    return { tr, suppressed, generalize };
  });

  const postGenKey = (tr: TraceInfo, gen: boolean): string =>
    gen
      ? timestampBucket !== "none"
        ? `${tr.variant}::*|*|*|${tr.timeBucket}`
        : `${tr.variant}::*|*|*`
      : tr.quasiKey;

  if (generalizeQuasi) {
    const postGenCounts = new Map<string, number>();
    const postGenOutcomes = new Map<string, Set<string>>();
    for (const item of tracePlan) {
      if (item.suppressed) continue;
      const pk = postGenKey(item.tr, item.generalize);
      postGenCounts.set(pk, (postGenCounts.get(pk) ?? 0) + 1);
      let outs = postGenOutcomes.get(pk);
      if (!outs) {
        outs = new Set<string>();
        postGenOutcomes.set(pk, outs);
      }
      outs.add(item.tr.sensitiveOutcome);
    }

    // If generalizing minority quasi-classes left any equivalence class < k or < lDiversity
    // within a variant of size >= k, widen generalization to all traces in that variant.
    const variantsToWiden = new Set<string>();
    for (const item of tracePlan) {
      if (item.suppressed) continue;
      const vCount = variantCountsMap.get(item.tr.variant) ?? 0;
      const pk = postGenKey(item.tr, item.generalize);
      const eqSize = postGenCounts.get(pk) ?? 0;
      const eqDiversity = postGenOutcomes.get(pk)?.size ?? 0;
      if (vCount >= k && (eqSize < k || eqDiversity < lDiversity)) {
        variantsToWiden.add(item.tr.variant);
      }
    }
    if (variantsToWiden.size > 0) {
      for (const item of tracePlan) {
        if (!item.suppressed && variantsToWiden.has(item.tr.variant)) {
          item.generalize = true;
        }
      }
    }
  }

  // Final post-generalization equivalence-class k-anonymity & l-diversity enforcement
  const preFinalEqCounts = new Map<string, number>();
  const preFinalEqOutcomes = new Map<string, Set<string>>();
  for (const item of tracePlan) {
    if (item.suppressed) continue;
    const pk = postGenKey(item.tr, item.generalize);
    preFinalEqCounts.set(pk, (preFinalEqCounts.get(pk) ?? 0) + 1);
    let outs = preFinalEqOutcomes.get(pk);
    if (!outs) {
      outs = new Set<string>();
      preFinalEqOutcomes.set(pk, outs);
    }
    outs.add(item.tr.sensitiveOutcome);
  }
  if (suppressBelowK) {
    for (const item of tracePlan) {
      if (item.suppressed) continue;
      const pk = postGenKey(item.tr, item.generalize);
      const eqSize = preFinalEqCounts.get(pk) ?? 0;
      const eqDiversity = preFinalEqOutcomes.get(pk)?.size ?? 0;
      if (eqSize < k || eqDiversity < lDiversity) {
        item.suppressed = true;
      }
    }
  }

  // Track object usage across generalized vs non-generalized retained traces so QUASI_ATTR_KEYS
  // on objects (e.g. session.repo, model_request.provider_id/model_id) are generalized without leaking < k values.
  const genObjIds = new Set<string>();
  const nonGenObjIds = new Set<string>();
  for (const item of tracePlan) {
    if (item.suppressed) continue;
    const targetSet = item.generalize ? genObjIds : nonGenObjIds;
    for (const oid of item.tr.linkedObjectIds) {
      targetSet.add(oid);
    }
  }

  const objectHasQuasiAttr = (obj: RpmObjectLike): boolean =>
    readAttrStr(obj.attributes, "provider_id") !== undefined ||
    readAttrStr(obj.attributes, "model_id") !== undefined ||
    readAttrStr(obj.attributes, "repo") !== undefined;

  const generalizeQuasiAttrs = (
    attrs: readonly RpmAttributeLike[] | readonly unknown[] | Record<string, unknown>
  ) => mapAttributes(attrs, (name, value) => (QUASI_ATTR_KEYS.has(name) ? "*" : value));

  const splitObjectIds = new Map<string, string>();
  const needsGenVariant = new Set<string>();
  const clonedSplits: RpmObjectLike[] = [];

  const ensureSplitClone = (oid: string): boolean => {
    if (splitObjectIds.has(oid)) return false;
    const obj = objById.get(oid);
    if (!obj) return false;
    let cloneId: string;
    let suffix = 1;
    if (ACTOR_OBJECT_TYPES.has(obj.type)) {
      cloneId = `pseudo_${pseudonymizeActor(`${oid}__gen`, salt)}`;
      while (objById.has(cloneId)) {
        suffix += 1;
        cloneId = `pseudo_${pseudonymizeActor(`${oid}__gen_${suffix}`, salt)}`;
      }
    } else {
      cloneId = `${oid}__gen`;
      while (objById.has(cloneId)) {
        suffix += 1;
        cloneId = `${oid}__gen_${suffix}`;
      }
    }
    const clonedObj: RpmObjectLike = {
      ...obj,
      id: cloneId,
      attributes: objectHasQuasiAttr(obj)
        ? generalizeQuasiAttrs(obj.attributes)
        : obj.attributes
    };
    splitObjectIds.set(oid, cloneId);
    needsGenVariant.add(oid);
    objById.set(cloneId, clonedObj);
    clonedSplits.push(clonedObj);
    return true;
  };

  // 1. Seed objects in genObjIds that carry QUASI_ATTR_KEYS
  for (const oid of genObjIds) {
    const obj = objById.get(oid);
    if (!obj || !objectHasQuasiAttr(obj)) continue;
    if (nonGenObjIds.has(oid)) {
      ensureSplitClone(oid);
    } else {
      obj.attributes = generalizeQuasiAttrs(obj.attributes);
    }
  }

  // 2. Cycle-safe backwards propagation: shared objects in genObjIds ∩ nonGenObjIds
  //    that point via O2O to any object in splitObjectIds/needsGenVariant also need __gen splits.
  let splitPropagated = true;
  while (splitPropagated) {
    splitPropagated = false;
    for (const oid of genObjIds) {
      if (needsGenVariant.has(oid) || !nonGenObjIds.has(oid)) continue;
      const obj = objById.get(oid);
      if (!obj) continue;
      const rels = (obj.relationships ?? []) as readonly RpmRelationshipLike[];
      if (rels.some((r) => r && (splitObjectIds.has(r.objectId) || needsGenVariant.has(r.objectId)))) {
        if (ensureSplitClone(oid)) {
          splitPropagated = true;
        }
      }
    }
  }

  // 3. Remap relationships via splitObjectIds on all clonedSplits AND all objects exclusively in genObjIds
  for (const oid of genObjIds) {
    if (nonGenObjIds.has(oid)) continue;
    const obj = objById.get(oid);
    if (!obj) continue;
    obj.relationships = ((obj.relationships ?? []) as readonly RpmRelationshipLike[]).map((r) =>
      splitObjectIds.has(r.objectId) ? { ...r, objectId: splitObjectIds.get(r.objectId)! } : r
    );
  }
  for (const splitObj of clonedSplits) {
    splitObj.relationships = ((splitObj.relationships ?? []) as readonly RpmRelationshipLike[]).map((r) =>
      splitObjectIds.has(r.objectId) ? { ...r, objectId: splitObjectIds.get(r.objectId)! } : r
    );
    clonedObjects.push(splitObj);
  }

  let generalizedTraces = 0;
  let suppressedTraces = 0;
  const retainedEvents: RpmEventLike[] = [];
  const retainedVariantCounts: Record<string, number> = {};
  const retainedEqClassCounts = new Map<string, number>();
  const retainedEqClassOutcomes = new Map<string, Set<string>>();

  for (const item of tracePlan) {
    const { tr, suppressed, generalize } = item;
    if (suppressed) {
      suppressedTraces += 1;
      continue;
    }
    if (generalize) generalizedTraces += 1;

    retainedVariantCounts[tr.variant] = (retainedVariantCounts[tr.variant] ?? 0) + 1;
    const finalEqKey = postGenKey(tr, generalize);
    retainedEqClassCounts.set(finalEqKey, (retainedEqClassCounts.get(finalEqKey) ?? 0) + 1);
    let outs = retainedEqClassOutcomes.get(finalEqKey);
    if (!outs) {
      outs = new Set<string>();
      retainedEqClassOutcomes.set(finalEqKey, outs);
    }
    outs.add(tr.sensitiveOutcome);

    for (const ev of tr.events) {
      let attrs = ev.attributes;
      if (generalize) {
        attrs = generalizeQuasiAttrs(attrs);
      }
      const rels = generalize
        ? ev.relationships.map((r) =>
            splitObjectIds.has(r.objectId) ? { ...r, objectId: splitObjectIds.get(r.objectId)! } : r
          )
        : ev.relationships;
      retainedEvents.push({
        ...ev,
        time: timestampBucket !== "none" ? generalizeTimestamp(ev.time, timestampBucket) : ev.time,
        attributes: attrs,
        relationships: rels
      });
    }
  }

  // Sort retained events chronologically and re-seal pi_hash chain if present
  retainedEvents.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const shouldReseal = options.resealHashChain ?? hadHashChain;
  if (shouldReseal) {
    let parent = "";
    for (const ev of retainedEvents) {
      const phase = readAttrStr(ev.attributes, "pi_phase") ?? "";
      const ref = readAttrStr(ev.attributes, "pi_pending_ref") ?? "";
      const nextHash = sha256Hex(`${parent}\n${canonOcelEvent(ev, phase, ref)}`);

      if (Array.isArray(ev.attributes)) {
        const filtered = (ev.attributes as RpmAttributeLike[]).filter(
          (a) => a.name !== "pi_parent" && a.name !== "pi_hash" && a.name !== "pi_hash_alg"
        );
        filtered.push(
          { name: "pi_parent", value: parent },
          { name: "pi_hash", value: nextHash },
          { name: "pi_hash_alg", value: "sha256" }
        );
        ev.attributes = filtered;
      } else {
        const rec = { ...(ev.attributes as Record<string, unknown>) };
        rec.pi_parent = parent;
        rec.pi_hash = nextHash;
        rec.pi_hash_alg = "sha256";
        ev.attributes = rec;
      }
      parent = nextHash;
    }
  }

  // Prune orphan objects not transitively reachable from retained events via E2O -> O2O (cycle-safe BFS)
  const referencedIds = new Set<string>();
  const refQueue: string[] = [];
  for (const ev of retainedEvents) {
    for (const rel of ev.relationships) {
      if (!referencedIds.has(rel.objectId)) {
        referencedIds.add(rel.objectId);
        refQueue.push(rel.objectId);
      }
    }
  }
  let refHead = 0;
  while (refHead < refQueue.length) {
    const oid = refQueue[refHead++]!;
    const obj = objById.get(oid);
    if (!obj) continue;
    for (const rel of (obj.relationships ?? []) as readonly RpmRelationshipLike[]) {
      if (
        rel &&
        typeof rel.objectId === "string" &&
        objById.has(rel.objectId) &&
        !referencedIds.has(rel.objectId)
      ) {
        referencedIds.add(rel.objectId);
        refQueue.push(rel.objectId);
      }
    }
  }
  const retainedObjects = clonedObjects
    .filter((o) => referencedIds.has(o.id))
    .map((o) => ({
      ...o,
      relationships: ((o.relationships ?? []) as readonly RpmRelationshipLike[]).filter((r) =>
        referencedIds.has(r.objectId)
      )
    }));

  const retainedEqCountsList = [...retainedEqClassCounts.values()];
  const minEquivalenceClassSize =
    retainedEqCountsList.length > 0 ? Math.min(...retainedEqCountsList) : 0;
  const retainedLDiversities = [...retainedEqClassOutcomes.values()].map((s) => s.size);
  const minLDiversity =
    retainedLDiversities.length > 0 ? Math.min(...retainedLDiversities) : 0;

  const outDoc = {
    ...doc,
    objects: retainedObjects,
    events: retainedEvents
  } as T;

  if (containsUnredactedSecretsOrPii(JSON.stringify(outDoc), { redactPii: true })) {
    throw new ComplianceRefusalError(
      "REDACTION_FAILURE",
      "Post-anonymization confidentiality gate detected unredacted secret or PII",
      "R_missing_consequence"
    );
  }

  return {
    doc: outDoc,
    k,
    totalTraces: traces.length,
    retainedTraces: traces.length - suppressedTraces,
    suppressedTraces,
    generalizedTraces,
    minEquivalenceClassSize,
    minLDiversity,
    variantCounts: retainedVariantCounts
  };
}

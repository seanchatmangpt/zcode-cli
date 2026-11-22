import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { PowlNode } from "../powl-ocel-orchestrator.ts";
import {
  ComplianceRefusalError,
  loadComplianceConfig,
  parseTomlDocument
} from "./config.ts";
import { detectConceptDrift, type ConceptDriftReport } from "./concept-drift.ts";
import { DEFAULT_EU_AI_ACT_DECLARE_RULES, evaluateDeclareRules } from "./declare-conformance.ts";
import { analyzeOcelKingmanMetrics, type KingmanMetricsSnapshot } from "./kingman-scheduler.ts";
import { validateOcel2, type Ocel2Document, type Ocel2Event, type Ocel2Object } from "./ocel2.ts";
import { discoverOcDfg, type OcDfgModel } from "./ocel-discover.ts";
import { readOcel2Sqlite } from "./ocel-sqlite.ts";
import { loadOcelLogsFromDirectory } from "./qms-conformity.ts";
import { containsUnredactedSecretsOrPii, redactComplianceData } from "./redactor.ts";
import { auditRpmFact, type RpmFactAuditReport } from "./rpm-fact.ts";

function atomicWriteJson(targetPath: string, data: unknown): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    renameSync(tmp, targetPath);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function readAttr(
  attrs: readonly { name: string; value: unknown }[] | Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!attrs) return undefined;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      if (a && typeof a === "object" && (a as { name: string }).name === key) {
        return String((a as { value: unknown }).value ?? "");
      }
    }
    return undefined;
  }
  const rec = attrs as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(rec, key) ? String(rec[key] ?? "") : undefined;
}

export interface PmmAnalysisReport {
  schema: "zcode.pmm-report/1";
  regulation: "Regulation (EU) 2024/1689 Art. 72";
  standing: "ALIVE" | "PARTIAL_ALIVE" | "UNVERIFIED";
  status: "OK" | "DRIFT_DETECTED" | "UNVERIFIED";
  insufficientPower: boolean;
  sampleCount: number;
  minWindow: number;
  driftDetected: boolean;
  driftKind: ConceptDriftReport["driftKind"];
  pValue: number;
  findings: ConceptDriftReport["findings"];
  pageHinkley: ConceptDriftReport["pageHinkley"];
  adwin: ConceptDriftReport["adwin"];
  ewma: ConceptDriftReport["ewma"];
  ks: ConceptDriftReport["ks"];
  mannWhitney: ConceptDriftReport["mannWhitney"];
  ttftMdTriggered: boolean;
  cs2: number;
  rho: number;
  lambdaAlivePerSec: number;
  kingman: KingmanMetricsSnapshot & {
    samplesAnalyzed: number;
    lambdaAlive: number;
    lambdaAlivePerSec: number;
    expectedQueueWaitMs: number;
    recommendedMaxRho: number;
    saturated: boolean;
  };
  fairness: RpmFactAuditReport["fairness"];
  accuracy: RpmFactAuditReport["accuracy"];
  confidentiality: RpmFactAuditReport["confidentiality"];
  explanations: RpmFactAuditReport["explanations"];
  oversightBottlenecks: OcDfgModel["oversightBottlenecks"];
  abRiskFlag: boolean;
  flags: string[];
  remediation_recommendations: PowlNode[];
  message?: string;
}

export function runPmmAnalysis(options: {
  logsDir: string;
  outPath?: string;
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): PmmAnalysisReport {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const cfg = loadComplianceConfig({ cwd, configPath: options.configPath, env });

  let ttftSpikeFactor = 2.0;
  let ttftWindow = 32;
  let rateLimitSafetyFloor = 0.05;
  if (cfg.configPresent) {
    const rawToml = parseTomlDocument(readFileSync(cfg.configPath, "utf8"));
    const aimd = rawToml.aimd as Record<string, unknown> | undefined;
    if (aimd && typeof aimd === "object") {
      if (typeof aimd.ttft_spike_factor === "number") ttftSpikeFactor = aimd.ttft_spike_factor;
      if (typeof aimd.ttft_window === "number") ttftWindow = aimd.ttft_window;
      if (typeof aimd.rate_limit_safety_floor === "number") {
        rateLimitSafetyFloor = aimd.rate_limit_safety_floor;
      }
    }
  }

  const loadedLogs = loadOcelLogsFromDirectory(options.logsDir);
  if (loadedLogs.length === 0) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `No OCEL 2.0 log files found in '${options.logsDir}' (0 logs; cannot run PMM analysis).`,
      "R_missing_consequence"
    );
  }

  const docs = loadedLogs.map((l) => l.doc);
  const sessionIds = new Set<string>();
  let totalEvents = 0;
  for (const doc of docs) {
    totalEvents += doc.events?.length ?? 0;
    for (const obj of doc.objects ?? []) {
      if (obj.type === "session") sessionIds.add(obj.id);
    }
  }
  if (totalEvents === 0) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `OCEL logs in '${options.logsDir}' contain 0 events; cannot run PMM analysis.`,
      "R_missing_consequence"
    );
  }

  const sampleCount = Math.max(docs.length, sessionIds.size);
  const kingmanRaw = analyzeOcelKingmanMetrics(docs, {
    ttftSpikeFactor,
    ttftWindow,
    rateLimitSafetyFloor
  });
  const rpm = auditRpmFact(docs, {
    redactPii: cfg.compliance.redact_pii,
    redactEnv: cfg.compliance.redact_env,
    env
  });
  const dfg = discoverOcDfg(docs, { minReviewMs: cfg.compliance.min_review_ms });

  const abRiskFlag =
    dfg.oversightBottlenecks.some((b) => b.kind === "rubber_stamp") ||
    docs.some((d) =>
      d.events.some((ev) => {
        if (ev.type !== "permission_resolved") return false;
        const lat = Number(readAttr(ev.attributes, "decision_latency_ms"));
        return Number.isFinite(lat) && lat < cfg.compliance.min_review_ms;
      })
    );

  const flags: string[] = [];
  if (abRiskFlag) flags.push("AB_RISK_FLAG");
  if (kingmanRaw.ttftMdTriggered) flags.push("TTFT_MD_TRIGGERED");

  const kingman = {
    ...kingmanRaw,
    lambdaAlive: kingmanRaw.estimate.lambdaAlivePerSec,
    lambdaAlivePerSec: kingmanRaw.estimate.lambdaAlivePerSec,
    expectedQueueWaitMs: kingmanRaw.estimate.expectedQueueWaitMs,
    recommendedMaxRho: kingmanRaw.estimate.recommendedMaxRho,
    saturated: kingmanRaw.estimate.saturated
  };

  if (sampleCount < cfg.pmm.min_window) {
    const insufficientReport: PmmAnalysisReport = {
      schema: "zcode.pmm-report/1",
      regulation: "Regulation (EU) 2024/1689 Art. 72",
      standing: "UNVERIFIED",
      status: "UNVERIFIED",
      insufficientPower: true,
      sampleCount,
      minWindow: cfg.pmm.min_window,
      driftDetected: false,
      driftKind: "none",
      pValue: 1,
      findings: [],
      pageHinkley: null,
      adwin: null,
      ewma: null,
      ks: null,
      mannWhitney: null,
      ttftMdTriggered: kingmanRaw.ttftMdTriggered,
      cs2: kingmanRaw.cs2,
      rho: kingmanRaw.rho,
      lambdaAlivePerSec: kingmanRaw.estimate.lambdaAlivePerSec,
      kingman,
      fairness: rpm.fairness,
      accuracy: rpm.accuracy,
      confidentiality: rpm.confidentiality,
      explanations: rpm.explanations,
      oversightBottlenecks: dfg.oversightBottlenecks,
      abRiskFlag,
      flags,
      remediation_recommendations: [],
      message: `UNVERIFIED: insufficient sample window (${sampleCount} < min_window ${cfg.pmm.min_window}).`
    };
    if (options.outPath) atomicWriteJson(options.outPath, insufficientReport);
    return insufficientReport;
  }

  const drift = detectConceptDrift(docs, {
    alpha: cfg.pmm.drift_alpha,
    minWindow: cfg.pmm.min_window
  });

  const remediationRecommendations: PowlNode[] = [];
  if (drift.driftDetected) {
    remediationRecommendations.push({
      id: "powl_pmm_drift_remediation",
      kind: "partial_order",
      children: [
        {
          id: "pmm_freeze_rollout",
          kind: "activity",
          label: "investigate_concept_drift",
          objectType: "session"
        },
        {
          id: "pmm_realign_wfnet",
          kind: "activity",
          label: "run_a_star_conformance_audit",
          objectType: "session"
        }
      ],
      order: [["pmm_freeze_rollout", "pmm_realign_wfnet"]]
    });
  }
  if (abRiskFlag) {
    remediationRecommendations.push({
      id: "powl_ab_risk_remediation",
      kind: "activity",
      label: "enforce_min_review_ms_dwell",
      objectType: "permission"
    });
  }

  const report: PmmAnalysisReport = {
    schema: "zcode.pmm-report/1",
    regulation: "Regulation (EU) 2024/1689 Art. 72",
    standing: rpm.standing,
    status: drift.driftDetected ? "DRIFT_DETECTED" : "OK",
    insufficientPower: false,
    sampleCount,
    minWindow: cfg.pmm.min_window,
    driftDetected: drift.driftDetected,
    driftKind: drift.driftKind,
    pValue: drift.pValue,
    findings: drift.findings,
    pageHinkley: drift.pageHinkley,
    adwin: drift.adwin,
    ewma: drift.ewma,
    ks: drift.ks,
    mannWhitney: drift.mannWhitney,
    ttftMdTriggered: kingmanRaw.ttftMdTriggered,
    cs2: kingmanRaw.cs2,
    rho: kingmanRaw.rho,
    lambdaAlivePerSec: kingmanRaw.estimate.lambdaAlivePerSec,
    kingman,
    fairness: rpm.fairness,
    accuracy: rpm.accuracy,
    confidentiality: rpm.confidentiality,
    explanations: rpm.explanations,
    oversightBottlenecks: dfg.oversightBottlenecks,
    abRiskFlag,
    flags,
    remediation_recommendations: remediationRecommendations
  };

  if (options.outPath) {
    atomicWriteJson(options.outPath, report);
  }
  return report;
}

export interface IncidentReportPacket {
  schema: "zcode.art73-incident/1";
  regulation: "Regulation (EU) 2024/1689 Art. 73";
  article: "Art. 73";
  session_id: string;
  deadline_class: "2d" | "10d" | "15d";
  deadline_rationale: string;
  first_failing_event_at: string | null;
  reporting_deadline_at: string | null;
  // chain_intact omitted: validateOcel2 throws PROVENANCE_SEAL_FAILED before emit,
  // so a boolean mirror of validation.ok would be a dead always-true witness.
  causal_slice: Ocel2Document;
  ocel_slice_sha256: string;
  root_cause: {
    summary: string;
    failing_events: Array<{ id: string; type: string; time: string }>;
    error_signatures: string[];
    rework_cycles: OcDfgModel["reworkCycles"];
    oversight_bottlenecks: OcDfgModel["oversightBottlenecks"];
    declare_violations: Array<{ id: string; template: string; counterexample_event_ids: string[] }>;
    oc_dfg_edges: number;
  };
  accuracy_standing: RpmFactAuditReport["standing"];
  remediation_powl: PowlNode;
}

const MS_PER_DAY = 86_400_000;

function computeArt73SlaTimestamps(
  failingEvents: ReadonlyArray<{ time: string }>,
  sliceEvents: ReadonlyArray<{ time: string }>,
  deadlineClass: "2d" | "10d" | "15d"
): { firstFailingEventAt: string | null; reportingDeadlineAt: string | null } {
  const candidates = failingEvents.length > 0 ? failingEvents : sliceEvents;
  let minMs = Number.POSITIVE_INFINITY;
  for (const ev of candidates) {
    const parsed = Date.parse(ev.time);
    if (Number.isFinite(parsed) && parsed < minMs) {
      minMs = parsed;
    }
  }
  if (!Number.isFinite(minMs)) {
    return { firstFailingEventAt: null, reportingDeadlineAt: null };
  }
  const days = deadlineClass === "2d" ? 2 : deadlineClass === "10d" ? 10 : 15;
  return {
    firstFailingEventAt: new Date(minMs).toISOString(),
    reportingDeadlineAt: new Date(minMs + days * MS_PER_DAY).toISOString()
  };
}

function synthesizeIncidentRemediationPowl(input: {
  deadlineClass: "2d" | "10d" | "15d";
  hasSecretBreach: boolean;
  hasDrift: boolean;
  hasDeclareViolations: boolean;
}): PowlNode {
  if (input.deadlineClass === "2d") {
    return {
      id: "powl_incident_2d_secret_remediation",
      kind: "partial_order",
      children: [
        {
          id: "incident_revoke_rotate_secrets",
          kind: "activity",
          label: input.hasSecretBreach
            ? "revoke_and_rotate_exposed_credentials"
            : "contain_critical_security_breach",
          objectType: "secret"
        },
        {
          id: "incident_purge_and_seal_audit",
          kind: "activity",
          label: "purge_unredacted_artifacts_and_seal_audit",
          objectType: "session"
        },
        {
          id: "incident_notify_authority_2d",
          kind: "activity",
          label: "submit_art73_3_urgent_2d_notification",
          objectType: "human_overseer"
        }
      ],
      order: [
        ["incident_revoke_rotate_secrets", "incident_purge_and_seal_audit"],
        ["incident_purge_and_seal_audit", "incident_notify_authority_2d"]
      ]
    };
  }
  if (input.deadlineClass === "10d" && (input.hasDrift || input.hasDeclareViolations)) {
    return {
      id: "powl_incident_10d_drift_declare_remediation",
      kind: "partial_order",
      children: [
        {
          id: "incident_declare_realign",
          kind: "activity",
          label: "run_a_star_declare_conformance_realignment",
          objectType: "session"
        },
        {
          id: "incident_drift_recalibrate",
          kind: "activity",
          label: "recalibrate_pmm_concept_drift_baseline",
          objectType: "session"
        },
        {
          id: "incident_notify_authority_10d",
          kind: "activity",
          label: "submit_art73_4_10d_incident_report",
          objectType: "human_overseer"
        }
      ],
      order: [
        ["incident_declare_realign", "incident_drift_recalibrate"],
        ["incident_drift_recalibrate", "incident_notify_authority_10d"]
      ]
    };
  }
  if (input.deadlineClass === "10d") {
    return {
      id: "powl_incident_10d_rollback_remediation",
      kind: "partial_order",
      children: [
        {
          id: "incident_contain_rollback",
          kind: "activity",
          label: "verify_workspace_clean_or_rollback",
          objectType: "workspace_snapshot"
        },
        {
          id: "incident_root_cause_patch",
          kind: "activity",
          label: "patch_failing_transition_and_add_falsifier",
          objectType: "session"
        },
        {
          id: "incident_human_review",
          kind: "activity",
          label: "overseer_signoff_art14_and_10d_report",
          objectType: "human_overseer"
        }
      ],
      order: [
        ["incident_contain_rollback", "incident_root_cause_patch"],
        ["incident_root_cause_patch", "incident_human_review"]
      ]
    };
  }
  return {
    id: "powl_incident_15d_anomaly_remediation",
    kind: "partial_order",
    children: [
      {
        id: "incident_triage_anomaly",
        kind: "activity",
        label: "triage_operational_anomaly_oc_dfg",
        objectType: "session"
      },
      {
        id: "incident_human_review",
        kind: "activity",
        label: "overseer_signoff_art14",
        objectType: "human_overseer"
      }
    ],
    order: [["incident_triage_anomaly", "incident_human_review"]]
  };
}

function loadSingleOcelDocument(inPath: string): Ocel2Document {
  if (!existsSync(inPath)) {
    throw new ComplianceRefusalError(
      "LOGGING_UNAVAILABLE",
      `Input OCEL file does not exist: '${inPath}'.`,
      "R_missing_consequence"
    );
  }
  if (inPath.endsWith(".sqlite") || inPath.endsWith(".ocel.sqlite")) {
    return readOcel2Sqlite(inPath);
  }
  const raw = readFileSync(inPath, "utf8");
  try {
    return JSON.parse(raw) as Ocel2Document;
  } catch (err) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Failed to parse JSON OCEL file '${inPath}': ${(err as Error).message}`
    );
  }
}

export function generateIncidentReportPacket(options: {
  inPath: string;
  outPath: string;
  sessionId?: string;
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): IncidentReportPacket {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const cfg = loadComplianceConfig({ cwd, configPath: options.configPath, env });
  const doc = loadSingleOcelDocument(options.inPath);
  const validation = validateOcel2(doc, { requireHashChain: true });
  if (!validation.ok) {
    throw new ComplianceRefusalError(
      "PROVENANCE_SEAL_FAILED",
      `Incident OCEL log failed verification: ${validation.errors.join("; ")}`,
      "R_missing_consequence"
    );
  }

  const targetSessionId = options.sessionId?.trim();
  if (!targetSessionId) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      "incident report requires a non-empty --session <id>.",
      "R_missing_identity"
    );
  }

  const objById = new Map<string, Ocel2Object>();
  const foreignSessionIds = new Set<string>();
  for (const obj of doc.objects) {
    objById.set(obj.id, obj);
    if (obj.type === "session" && obj.id !== targetSessionId) {
      foreignSessionIds.add(obj.id);
    }
  }

  const matchingEvents = doc.events.filter((ev) => {
    if (ev.relationships.some((r) => foreignSessionIds.has(r.objectId))) return false;
    const attrSid = readAttr(ev.attributes, "session_id");
    if (attrSid && attrSid !== targetSessionId) return false;
    return (
      ev.relationships.some((r) => r.objectId === targetSessionId) ||
      attrSid === targetSessionId
    );
  });
  const hasSessionObj = doc.objects.some((o) => o.id === targetSessionId);
  if (!hasSessionObj && matchingEvents.length === 0) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Session '${targetSessionId}' not found in '${options.inPath}'.`
    );
  }

  // Shared infrastructure/governance hub types never confer ownership of another session's
  // events and must never be traversed backward during causal slicing.
  const SHARED_HUB_OBJECT_TYPES = new Set<string>([
    "provider",
    "ai_model",
    "human_overseer",
    "compliance_profile",
    "workspace_file",
    "disclosure_notice",
    "disclosure",
    "authority",
    "worker"
  ]);
  const OWNERSHIP_EDGE_QUALIFIERS = new Set<string>([
    "in_session",
    "in_turn",
    "spawned_by",
    "mutated_in",
    "seals"
  ]);

  const ownedIds = new Set<string>([targetSessionId]);
  for (const ev of matchingEvents) {
    for (const r of ev.relationships) {
      if (foreignSessionIds.has(r.objectId)) continue;
      const relObj = objById.get(r.objectId);
      if (relObj && (relObj.type === "session" || SHARED_HUB_OBJECT_TYPES.has(relObj.type))) {
        continue;
      }
      if (relObj) {
        ownedIds.add(r.objectId);
      }
    }
  }

  let added = true;
  while (added) {
    added = false;
    for (const obj of doc.objects) {
      if (foreignSessionIds.has(obj.id)) continue;
      if (obj.type === "session" && obj.id !== targetSessionId) continue;
      if (SHARED_HUB_OBJECT_TYPES.has(obj.type)) continue;

      if (!ownedIds.has(obj.id)) {
        const isOwnedViaEdge = obj.relationships.some(
          (r) =>
            ownedIds.has(r.objectId) &&
            (OWNERSHIP_EDGE_QUALIFIERS.has(r.qualifier) ||
              (obj.type === "permission" && r.qualifier === "governs"))
        );
        if (isOwnedViaEdge) {
          ownedIds.add(obj.id);
          added = true;
        }
      } else if (obj.type === "permission") {
        for (const r of obj.relationships) {
          if (r.qualifier !== "governs") continue;
          if (foreignSessionIds.has(r.objectId) || ownedIds.has(r.objectId)) continue;
          const targetObj = objById.get(r.objectId);
          if (targetObj && targetObj.type === "tool_call") {
            ownedIds.add(targetObj.id);
            added = true;
          }
        }
      }
    }
  }

  const sliceEvents: Ocel2Event[] = doc.events.filter((ev) => {
    if (ev.relationships.some((r) => foreignSessionIds.has(r.objectId))) return false;
    const attrSid = readAttr(ev.attributes, "session_id");
    if (attrSid && attrSid !== targetSessionId) return false;
    return (
      ev.relationships.some((r) => ownedIds.has(r.objectId)) ||
      attrSid === targetSessionId
    );
  });

  // Include referenced E2O targets from sliceEvents and immediate metadata targets/governors of
  // ownedIds (e.g., provider, human_overseer, compliance_profile, ai_model, workspace_file)
  // without expanding into foreign sessions, and filter O2O relationships to keep zero dangling refs.
  const sliceObjectIds = new Set<string>(ownedIds);
  for (const ev of sliceEvents) {
    for (const r of ev.relationships) {
      if (!foreignSessionIds.has(r.objectId)) {
        sliceObjectIds.add(r.objectId);
      }
    }
  }
  for (const obj of doc.objects) {
    if (foreignSessionIds.has(obj.id)) continue;
    if (ownedIds.has(obj.id)) {
      for (const r of obj.relationships) {
        if (!foreignSessionIds.has(r.objectId)) {
          sliceObjectIds.add(r.objectId);
        }
      }
    } else if (
      obj.type !== "session" &&
      obj.relationships.some((r) => ownedIds.has(r.objectId))
    ) {
      sliceObjectIds.add(obj.id);
    }
  }
  const sliceObjects: Ocel2Object[] = doc.objects
    .filter((o) => sliceObjectIds.has(o.id) && !foreignSessionIds.has(o.id))
    .map((o) => ({
      ...o,
      relationships: o.relationships.filter((r) => sliceObjectIds.has(r.objectId))
    }));

  const sliceDoc: Ocel2Document = {
    objectTypes: doc.objectTypes,
    eventTypes: doc.eventTypes,
    objects: sliceObjects,
    events: sliceEvents
  };

  const dfg = discoverOcDfg(sliceDoc, { minReviewMs: cfg.compliance.min_review_ms });
  const declareReport = evaluateDeclareRules(sliceDoc, DEFAULT_EU_AI_ACT_DECLARE_RULES);
  const rpm = auditRpmFact(sliceDoc, {
    redactPii: cfg.compliance.redact_pii,
    redactEnv: cfg.compliance.redact_env,
    env
  });

  const failingEvents: Array<{ id: string; type: string; time: string }> = [];
  const errorSignatures = new Set<string>();
  let hasSecretBreach = false;
  let hasCriticalSeverity = false;
  let hasSeriousStopOrRollback = false;
  let hasDrift = false;

  for (const ev of sliceEvents) {
    const sev = readAttr(ev.attributes, "severity")?.toLowerCase();
    const sig = readAttr(ev.attributes, "error_signature");
    const reason = readAttr(ev.attributes, "reason");
    const refusal = readAttr(ev.attributes, "refusal_code");
    if (sig) errorSignatures.add(sig);
    if (refusal) errorSignatures.add(refusal);
    if (reason) errorSignatures.add(reason);

    if (ev.type === "unredacted_secret" || ev.type === "unredacted_secret_detected") {
      hasSecretBreach = true;
      failingEvents.push({ id: ev.id, type: ev.type, time: ev.time });
    }
    if (sev === "critical" && ev.type !== "permission_requested") {
      hasCriticalSeverity = true;
    }
    if (
      ev.type === "oversight_intervened" ||
      ev.type === "workspace_rolled_back" ||
      ev.type === "turn_failed" ||
      ev.type === "execution_crash" ||
      ev.type === "oversight_policy_refused" ||
      ev.type === "retry_budget_exhausted"
    ) {
      hasSeriousStopOrRollback = true;
      failingEvents.push({ id: ev.id, type: ev.type, time: ev.time });
    }
    if (ev.type === "drift_detected") {
      hasDrift = true;
      failingEvents.push({ id: ev.id, type: ev.type, time: ev.time });
    }
  }

  if (containsUnredactedSecretsOrPii(JSON.stringify(sliceDoc), { redactPii: false })) {
    hasSecretBreach = true;
  }

  const declareViolations = declareReport.results
    .filter((r) => r.status === "VIOLATED")
    .map((r) => ({
      id: r.id,
      template: r.template,
      counterexample_event_ids: r.counterexample_event_ids
    }));

  let deadlineClass: "2d" | "10d" | "15d" = "15d";
  let deadlineRationale =
    "Standard 15-day Art. 73 serious incident notification window for non-critical operational anomaly.";

  if (hasSecretBreach || hasCriticalSeverity) {
    deadlineClass = "2d";
    deadlineRationale =
      "Art. 73(3) 2-day urgent reporting deadline: critical security/confidentiality breach or audit-integrity threat.";
  } else if (hasSeriousStopOrRollback || declareViolations.length > 0 || hasDrift) {
    deadlineClass = "10d";
    deadlineRationale =
      "Art. 73(4) 10-day serious incident deadline: oversight intervention, execution crash, transactional rollback, or statistical drift.";
  }

  const totalEdges = Object.values(dfg.byObjectType).reduce(
    (sum, g) => sum + g.edges.length,
    0
  );

  const summaryParts: string[] = [];
  if (failingEvents.length > 0) {
    summaryParts.push(`${failingEvents.length} failing/incident event(s): ${failingEvents.map((e) => e.type).join(", ")}`);
  }
  if (errorSignatures.size > 0) {
    summaryParts.push(`signatures: ${[...errorSignatures].join(", ")}`);
  }
  if (dfg.reworkCycles.length > 0) {
    summaryParts.push(`${dfg.reworkCycles.length} OC-DFG rework cycle(s)`);
  }
  if (declareViolations.length > 0) {
    summaryParts.push(`${declareViolations.length} Declare violation(s)`);
  }

  const { firstFailingEventAt, reportingDeadlineAt } = computeArt73SlaTimestamps(
    failingEvents,
    sliceEvents,
    deadlineClass
  );
  const ocelSliceSha256 = createHash("sha256")
    .update(JSON.stringify(sliceDoc), "utf8")
    .digest("hex");

  const packet: IncidentReportPacket = {
    schema: "zcode.art73-incident/1",
    regulation: "Regulation (EU) 2024/1689 Art. 73",
    article: "Art. 73",
    session_id: targetSessionId,
    deadline_class: deadlineClass,
    deadline_rationale: deadlineRationale,
    first_failing_event_at: firstFailingEventAt,
    reporting_deadline_at: reportingDeadlineAt,
    causal_slice: sliceDoc,
    ocel_slice_sha256: ocelSliceSha256,
    root_cause: {
      summary: summaryParts.join("; ") || "Operational anomaly captured in OC-DFG slice.",
      failing_events: failingEvents,
      error_signatures: [...errorSignatures],
      rework_cycles: dfg.reworkCycles,
      oversight_bottlenecks: dfg.oversightBottlenecks,
      declare_violations: declareViolations,
      oc_dfg_edges: totalEdges
    },
    accuracy_standing: rpm.standing,
    remediation_powl: synthesizeIncidentRemediationPowl({
      deadlineClass,
      hasSecretBreach,
      hasDrift,
      hasDeclareViolations: declareViolations.length > 0
    })
  };

  const redactedPacket = redactComplianceData(packet, {
    redactPii: cfg.compliance.redact_pii,
    redactEnv: cfg.compliance.redact_env,
    env
  });

  atomicWriteJson(options.outPath, redactedPacket);
  return redactedPacket;
}

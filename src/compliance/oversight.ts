import { randomUUID } from "node:crypto";

import {
  ComplianceRefusalError,
  isHighRiskProfile,
  isRegulatedProfile,
  type ComplianceProfile,
  type ResolvedComplianceConfig
} from "./config.ts";
import type {
  Ocel2Event,
  Ocel2Object,
  Ocel2Relationship
} from "./ocel2.ts";
import {
  containsUnredactedSecretsOrPii,
  redactComplianceData,
  redactComplianceText,
  type RedactComplianceOptions
} from "./redactor.ts";

export type PolicyCeiling = "SELECT" | "CONSTRUCT" | "DO";

export const DEFAULT_AB_STREAK_THRESHOLD = 3;

export const APPROVAL_DECISIONS: ReadonlySet<string> = new Set([
  "allow",
  "allow_always",
  "modify",
  "approve"
]);

export function isApprovalDecision(decision: string | undefined): boolean {
  const normalized = (decision ?? "allow").trim().toLowerCase();
  return APPROVAL_DECISIONS.has(normalized);
}

const PROFILE_RANK: Readonly<Record<ComplianceProfile, number>> = {
  standard: 0,
  "art50-only": 1,
  "high-risk-annex-iii": 2,
  "high-risk-annex-i": 2
};

const CEILING_RANK: Readonly<Record<PolicyCeiling, number>> = {
  SELECT: 0,
  CONSTRUCT: 1,
  DO: 2
};

const VALUE_TAKING_NON_MODE_FLAGS = new Set([
  "-p",
  "--prompt",
  "--cwd",
  "--target",
  "--output-format",
  "--model",
  "--max-turns",
  "--surface",
  "--settings",
  "--browser-use",
  "--config"
]);

const FORBIDDEN_YOLO_MODES = new Set(["yolo", "bypasspermissions", "dontask"]);

const LEASE_ENV_KEYS = [
  "XAAS_LEASE_CWD",
  "XAAS_EPOCH_ID",
  "XAAS_LEASE_ID",
  "XAAS_WORK_ORDER_IRI",
  "XAAS_BASE_SHA",
  "XAAS_REPLAY_BINDING"
] as const;

export interface EnforceOversightArgsResult {
  allowed: true;
  profile: ComplianceProfile;
  allowYolo: boolean;
  mode?: string;
}

function isTruthyFlagValue(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const norm = raw.trim().toLowerCase();
  return norm === "1" || norm === "true" || norm === "yes";
}

export function enforceOversightArgs(
  args: readonly string[],
  config: ResolvedComplianceConfig,
  env: NodeJS.ProcessEnv = process.env
): EnforceOversightArgsResult {
  const profile = config.compliance.profile;
  const yoloForbidden = isHighRiskProfile(profile) || config.compliance.allow_yolo === false;

  if (!yoloForbidden) {
    return {
      allowed: true,
      profile,
      allowYolo: config.compliance.allow_yolo
    };
  }

  if (isTruthyFlagValue(env.ZCODE_ALLOW_YOLO)) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `ZCODE_ALLOW_YOLO is forbidden under compliance profile '${profile}' (EU AI Act Art. 14).`,
      "admission_vacuous"
    );
  }

  let observedMode: string | undefined;
  let headlessFlag: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") break;

    if (arg === "-p" || arg === "--prompt") {
      headlessFlag ??= arg;
      i++;
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      headlessFlag ??= "--prompt";
      continue;
    }
    if (arg.startsWith("-p") && arg.length > 2 && !arg.startsWith("--")) {
      headlessFlag ??= "-p";
      continue;
    }
    if (arg === "--output-format" || arg.startsWith("--output-format=")) {
      const inline = arg.startsWith("--output-format=");
      const val = inline ? arg.slice("--output-format=".length) : args[i + 1];
      if (!inline && val !== undefined) i++;
      if (val !== undefined && val.trim().toLowerCase() === "stream-json") {
        headlessFlag ??= "--output-format stream-json";
      }
      continue;
    }

    if (VALUE_TAKING_NON_MODE_FLAGS.has(arg)) {
      i++;
      continue;
    }

    if (arg === "--dangerously-skip-permissions") {
      throw new ComplianceRefusalError(
        "OVERSIGHT_POLICY_REFUSED",
        `Flag '--dangerously-skip-permissions' is forbidden under profile '${profile}' (EU AI Act Art. 14).`,
        "admission_vacuous"
      );
    }
    if (arg.startsWith("--dangerously-skip-permissions=")) {
      const val = arg.slice("--dangerously-skip-permissions=".length);
      if (isTruthyFlagValue(val)) {
        throw new ComplianceRefusalError(
          "OVERSIGHT_POLICY_REFUSED",
          `Flag '--dangerously-skip-permissions=${val}' is forbidden under profile '${profile}' (EU AI Act Art. 14).`,
          "admission_vacuous"
        );
      }
      continue;
    }

    if (arg === "--allow-main-worktree-yolo") {
      throw new ComplianceRefusalError(
        "OVERSIGHT_POLICY_REFUSED",
        `Flag '--allow-main-worktree-yolo' is forbidden under profile '${profile}' (EU AI Act Art. 14).`,
        "admission_vacuous"
      );
    }
    if (arg.startsWith("--allow-main-worktree-yolo=")) {
      const val = arg.slice("--allow-main-worktree-yolo=".length);
      if (isTruthyFlagValue(val)) {
        throw new ComplianceRefusalError(
          "OVERSIGHT_POLICY_REFUSED",
          `Flag '--allow-main-worktree-yolo=${val}' is forbidden under profile '${profile}' (EU AI Act Art. 14).`,
          "admission_vacuous"
        );
      }
      continue;
    }

    if (arg === "--mode" || arg.startsWith("--mode=")) {
      const inline = arg.startsWith("--mode=");
      const val = inline ? arg.slice("--mode=".length) : args[i + 1];
      if (!inline && val !== undefined) i++;
      if (val !== undefined) {
        const norm = val.trim().toLowerCase();
        if (FORBIDDEN_YOLO_MODES.has(norm)) {
          throw new ComplianceRefusalError(
            "OVERSIGHT_POLICY_REFUSED",
            `--mode ${val.trim()} is forbidden under profile '${profile}' (EU AI Act Art. 14).`,
            "admission_vacuous"
          );
        }
        observedMode = val.trim();
      }
      continue;
    }

    if (arg === "--permission-mode" || arg.startsWith("--permission-mode=")) {
      const inline = arg.startsWith("--permission-mode=");
      const val = inline ? arg.slice("--permission-mode=".length) : args[i + 1];
      if (!inline && val !== undefined) i++;
      if (val !== undefined) {
        const norm = val.trim().toLowerCase();
        if (FORBIDDEN_YOLO_MODES.has(norm)) {
          throw new ComplianceRefusalError(
            "OVERSIGHT_POLICY_REFUSED",
            `--permission-mode ${val.trim()} is forbidden under profile '${profile}' (EU AI Act Art. 14).`,
            "admission_vacuous"
          );
        }
        observedMode = val.trim();
      }
      continue;
    }
  }

  if (isHighRiskProfile(profile) && headlessFlag !== undefined) {
    const attested = env.ZCODE_HEADLESS_OVERSIGHT_ATTESTED?.trim() === "1";
    const overseerId = (env.ZCODE_OVERSEER_ID ?? "").trim();
    if (!attested || !overseerId) {
      throw new ComplianceRefusalError(
        "OVERSIGHT_POLICY_REFUSED",
        `Headless/non-TUI flag '${headlessFlag}' under high-risk profile '${profile}' requires ZCODE_HEADLESS_OVERSIGHT_ATTESTED=1 and non-empty ZCODE_OVERSEER_ID (EU AI Act Art. 14).`,
        "R_missing_authority"
      );
    }
  }

  return {
    allowed: true,
    profile,
    allowYolo: false,
    ...(observedMode ? { mode: observedMode } : {})
  };
}

export interface ParentOversightContext {
  sessionId: string;
  profile: ComplianceProfile;
  allowYolo?: boolean;
  allow_yolo?: boolean;
  minReviewMs?: number;
  min_review_ms?: number;
  policyCeiling?: PolicyCeiling;
  overseerId?: string;
  overseer_id?: string;
  overseerObjectId?: string;
  xaasWorker?: boolean;
  env?: NodeJS.ProcessEnv;
  leaseIdentity?: Partial<Record<(typeof LEASE_ENV_KEYS)[number], string>>;
  timestamp?: string;
}

export interface SubagentOversightRequest {
  profile?: ComplianceProfile;
  allowYolo?: boolean;
  allow_yolo?: boolean;
  minReviewMs?: number;
  policyCeiling?: PolicyCeiling;
  permissionMode?: string;
  overseerId?: string;
  xaasWorker?: boolean;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export interface PropagatedSubagentOversightContext {
  parentSessionId: string;
  subagentId: string;
  effectiveProfile: ComplianceProfile;
  effectiveAllowYolo: boolean;
  effectiveMinReviewMs: number;
  effectiveCeiling: PolicyCeiling;
  overseerId?: string;
  xaasWorker: boolean;
  preToolUseEnforced: boolean;
  env: Record<string, string>;
  ocelObject: Ocel2Object;
  ocelO2ORelationship: {
    sourceObjectId: string;
    targetObjectId: string;
    qualifier: "spawned_by";
  };
}

export function propagateSubagentOversightContext(
  parentCtx: ParentOversightContext,
  subagentId: string,
  requested: SubagentOversightRequest = {}
): PropagatedSubagentOversightContext {
  const parentSessionId = parentCtx.sessionId?.trim() ?? "";
  const cleanSubagentId = subagentId?.trim() ?? "";
  if (!parentSessionId || !cleanSubagentId) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      "Subagent oversight propagation requires non-empty parent sessionId and subagentId.",
      "R_missing_identity"
    );
  }

  const parentProfile = parentCtx.profile;
  if (!Object.prototype.hasOwnProperty.call(PROFILE_RANK, parentProfile)) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Unknown parent compliance profile '${String(parentProfile)}' for subagent '${cleanSubagentId}'.`,
      "mu_on_O"
    );
  }
  if (
    requested.profile !== undefined &&
    !Object.prototype.hasOwnProperty.call(PROFILE_RANK, requested.profile)
  ) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Unknown subagent compliance profile '${String(requested.profile)}' for '${cleanSubagentId}'.`,
      "mu_on_O"
    );
  }

  const parentCeiling: PolicyCeiling = parentCtx.policyCeiling ?? "CONSTRUCT";
  if (!Object.prototype.hasOwnProperty.call(CEILING_RANK, parentCeiling)) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Unknown parent policy ceiling '${String(parentCeiling)}' for subagent '${cleanSubagentId}'.`,
      "mu_on_O"
    );
  }
  if (
    requested.policyCeiling !== undefined &&
    !Object.prototype.hasOwnProperty.call(CEILING_RANK, requested.policyCeiling)
  ) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Unknown subagent policy ceiling '${String(requested.policyCeiling)}' for '${cleanSubagentId}'.`,
      "mu_on_O"
    );
  }

  const parentMinReviewMs = parentCtx.minReviewMs ?? parentCtx.min_review_ms ?? 1000;
  if (!Number.isFinite(parentMinReviewMs) || parentMinReviewMs < 0) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Invalid parent min_review_ms (${String(parentMinReviewMs)}) for subagent '${cleanSubagentId}'.`,
      "mu_on_O"
    );
  }
  if (
    requested.minReviewMs !== undefined &&
    (!Number.isFinite(requested.minReviewMs) || requested.minReviewMs < 0)
  ) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Invalid subagent min_review_ms (${String(requested.minReviewMs)}) for '${cleanSubagentId}'.`,
      "mu_on_O"
    );
  }

  const parentAllowYolo = isHighRiskProfile(parentProfile)
    ? false
    : (parentCtx.allowYolo ?? parentCtx.allow_yolo ?? true);
  const parentOverseerId =
    (parentCtx.overseerId ?? parentCtx.overseer_id ?? parentCtx.env?.ZCODE_OVERSEER_ID)?.trim() ||
    undefined;
  const parentXaasWorker =
    parentCtx.xaasWorker === true || parentCtx.env?.XAAS_WORKER === "1";

  if (isHighRiskProfile(parentProfile) && !parentOverseerId) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      "High-risk subagent propagation requires a non-empty overseer_id.",
      "R_missing_authority"
    );
  }

  if ((isHighRiskProfile(parentProfile) || !parentAllowYolo) && isTruthyFlagValue(parentCtx.env?.ZCODE_ALLOW_YOLO)) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      "ZCODE_ALLOW_YOLO is forbidden under regulated parent oversight context.",
      "admission_vacuous"
    );
  }

  if (requested.profile !== undefined && PROFILE_RANK[requested.profile] < PROFILE_RANK[parentProfile]) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Subagent '${cleanSubagentId}' cannot downgrade compliance profile from '${parentProfile}' to '${requested.profile}'.`,
      "mu_unlawful"
    );
  }

  if (
    requested.policyCeiling !== undefined &&
    CEILING_RANK[requested.policyCeiling] > CEILING_RANK[parentCeiling]
  ) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Subagent '${cleanSubagentId}' cannot escalate policy ceiling from '${parentCeiling}' to '${requested.policyCeiling}'.`,
      "mu_unlawful"
    );
  }

  if (
    parentXaasWorker &&
    (requested.xaasWorker === false || requested.env?.XAAS_WORKER === "0")
  ) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Subagent '${cleanSubagentId}' cannot strip inherited XAAS_WORKER=1 PreToolUse gate.`,
      "mu_unlawful"
    );
  }

  if (requested.overseerId !== undefined && requested.overseerId.trim().length === 0) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Subagent '${cleanSubagentId}' cannot clear inherited overseer_id.`,
      "mu_unlawful"
    );
  }

  const effectiveProfile = requested.profile ?? parentProfile;
  const effectiveAllowYolo =
    isHighRiskProfile(effectiveProfile) || !parentAllowYolo
      ? false
      : (requested.allowYolo ?? requested.allow_yolo ?? parentAllowYolo);
  const effectiveMinReviewMs = Math.max(
    parentMinReviewMs,
    requested.minReviewMs ?? parentMinReviewMs
  );
  const effectiveCeiling = requested.policyCeiling ?? parentCeiling;
  const effectiveOverseerId = requested.overseerId?.trim() || parentOverseerId;

  if (isHighRiskProfile(effectiveProfile) && !effectiveOverseerId) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Effective high-risk profile '${effectiveProfile}' for subagent '${cleanSubagentId}' requires a non-empty overseer_id.`,
      "R_missing_authority"
    );
  }

  if (!effectiveAllowYolo || isHighRiskProfile(effectiveProfile)) {
    const requestedYoloMode =
      requested.permissionMode !== undefined &&
      FORBIDDEN_YOLO_MODES.has(requested.permissionMode.trim().toLowerCase());
    if (
      requested.allowYolo === true ||
      requested.allow_yolo === true ||
      requestedYoloMode ||
      isTruthyFlagValue(requested.env?.ZCODE_ALLOW_YOLO)
    ) {
      throw new ComplianceRefusalError(
        "OVERSIGHT_POLICY_REFUSED",
        `Subagent '${cleanSubagentId}' cannot enable yolo/bypass permissions under effective profile '${effectiveProfile}'.`,
        "mu_unlawful"
      );
    }
  }

  if (
    isRegulatedProfile(effectiveProfile) &&
    requested.minReviewMs !== undefined &&
    requested.minReviewMs < parentMinReviewMs
  ) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      `Subagent '${cleanSubagentId}' cannot reduce min_review_ms below parent (${requested.minReviewMs} < ${parentMinReviewMs}).`,
      "mu_unlawful"
    );
  }

  if ((requested.args && requested.args.length > 0) || isHighRiskProfile(effectiveProfile) || !effectiveAllowYolo) {
    const syntheticCfg: ResolvedComplianceConfig = {
      compliance: {
        profile: effectiveProfile,
        redact_pii: true,
        min_review_ms: effectiveMinReviewMs,
        git_provenance_trailer: isRegulatedProfile(effectiveProfile),
        allow_yolo: effectiveAllowYolo,
        max_retries_per_signature: 3,
        redact_env: []
      },
      deployer: {
        ...(effectiveOverseerId ? { overseer_id: effectiveOverseerId } : {}),
        log_retention_days: 180,
        monitoring_enabled: true,
        worker_notice_acknowledged: true
      },
      pmm: {
        drift_alpha: 0.01,
        min_window: 20,
        k_anonymity: 5
      },
      complianceLogEnabled: isRegulatedProfile(effectiveProfile),
      complianceDir: "",
      configPath: "",
      configPresent: false
    };
    enforceOversightArgs(requested.args ?? [], syntheticCfg, requested.env ?? {});
  }

  const env: Record<string, string> = {
    ZCODE_SUBAGENT: "1",
    ZCODE_PARENT_SESSION_ID: parentSessionId,
    ZCODE_SUBAGENT_ID: cleanSubagentId,
    ZCODE_COMPLIANCE_PROFILE: effectiveProfile,
    ZCODE_ALLOW_YOLO: effectiveAllowYolo ? "1" : "0",
    ZCODE_MIN_REVIEW_MS: String(effectiveMinReviewMs),
    ZCODE_POLICY_CEILING: effectiveCeiling
  };

  if (effectiveOverseerId) {
    env.ZCODE_OVERSEER_ID = effectiveOverseerId;
  }
  if (parentXaasWorker) {
    env.XAAS_WORKER = "1";
    for (const key of LEASE_ENV_KEYS) {
      const val = parentCtx.leaseIdentity?.[key] ?? parentCtx.env?.[key];
      if (typeof val === "string" && val.length > 0) {
        env[key] = val;
      }
    }
  }

  const nowIso = parentCtx.timestamp ?? new Date().toISOString();
  const relationships: Ocel2Relationship[] = [
    { objectId: parentSessionId, qualifier: "spawned_by" }
  ];
  if (parentCtx.overseerObjectId) {
    relationships.push({ objectId: parentCtx.overseerObjectId, qualifier: "governs" });
  }

  const safeOcelOverseerId = effectiveOverseerId
    ? redactComplianceText(effectiveOverseerId, { redactPii: true })
    : undefined;

  const ocelObject: Ocel2Object = {
    id: cleanSubagentId,
    type: "subagent",
    attributes: [
      { name: "agent_id", value: cleanSubagentId, time: nowIso },
      { name: "compliance_profile", value: effectiveProfile, time: nowIso },
      { name: "policy_ceiling", value: effectiveCeiling, time: nowIso },
      { name: "allow_yolo", value: String(effectiveAllowYolo), time: nowIso },
      ...(safeOcelOverseerId
        ? [{ name: "overseer_id", value: safeOcelOverseerId, time: nowIso }]
        : []),
      ...(parentXaasWorker ? [{ name: "xaas_worker", value: "1", time: nowIso }] : [])
    ],
    relationships
  };

  return {
    parentSessionId,
    subagentId: cleanSubagentId,
    effectiveProfile,
    effectiveAllowYolo,
    effectiveMinReviewMs,
    effectiveCeiling,
    ...(effectiveOverseerId ? { overseerId: effectiveOverseerId } : {}),
    xaasWorker: parentXaasWorker,
    preToolUseEnforced: parentXaasWorker || isRegulatedProfile(effectiveProfile),
    env,
    ocelObject,
    ocelO2ORelationship: {
      sourceObjectId: cleanSubagentId,
      targetObjectId: parentSessionId,
      qualifier: "spawned_by"
    }
  };
}

export interface OversightInterventionInput {
  overseerId: string;
  reason: string;
  sessionId: string;
  targetObjectId: string;
  targetObjectType?: string;
  targetQualifier?: string;
  action?: "emergency_stop" | "abort_turn" | "deny_tool" | "quarantine_subagent";
  turnId?: string;
  overseerObjectId?: string;
  eventId?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  redactionOptions?: RedactComplianceOptions;
  onEvent?: (event: Ocel2Event) => void;
}

export interface OversightInterventionResult {
  event: Ocel2Event;
  redacted: true;
  standing: "INTERVENED";
}

export function recordOversightIntervention(
  input: OversightInterventionInput
): OversightInterventionResult {
  const rawOverseerId = input.overseerId?.trim() ?? "";
  const rawReason = input.reason?.trim() ?? "";
  const rawSessionId = input.sessionId?.trim() ?? "";
  const rawTargetId = input.targetObjectId?.trim() ?? "";

  if (!rawOverseerId || !rawReason || !rawSessionId || !rawTargetId) {
    throw new ComplianceRefusalError(
      "OVERSIGHT_POLICY_REFUSED",
      "Oversight intervention requires non-empty overseerId, reason, sessionId, and targetObjectId.",
      "R_missing_authority"
    );
  }

  const redactOpts: RedactComplianceOptions = {
    redactPii: true,
    ...input.redactionOptions
  };

  const safeOverseerId = redactComplianceText(rawOverseerId, redactOpts);
  const safeReason = redactComplianceText(rawReason, redactOpts);
  const safeSessionId = redactComplianceText(rawSessionId, redactOpts);
  const safeTargetId = redactComplianceText(rawTargetId, redactOpts);
  const safeAction = input.action ?? "emergency_stop";
  const safeTargetType = input.targetObjectType ?? "session";

  const attributes = [
    { name: "overseer_id", value: safeOverseerId },
    { name: "reason", value: safeReason },
    { name: "action", value: safeAction },
    { name: "target_object_id", value: safeTargetId },
    { name: "target_object_type", value: safeTargetType }
  ];

  if (input.metadata !== undefined) {
    const redactedMeta = redactComplianceData(input.metadata, redactOpts);
    attributes.push({
      name: "metadata",
      value: JSON.stringify(redactedMeta)
    });
  }

  if (containsUnredactedSecretsOrPii(JSON.stringify(attributes), redactOpts)) {
    throw new ComplianceRefusalError(
      "REDACTION_FAILURE",
      "Unredacted secret or PII remained in oversight intervention event.",
      "R_missing_consequence"
    );
  }

  const relationships: Ocel2Relationship[] = [
    { objectId: safeSessionId, qualifier: "in_session" }
  ];
  const targetQual = input.targetQualifier ?? "governs";
  if (safeTargetId !== safeSessionId || targetQual !== "in_session") {
    relationships.push({ objectId: safeTargetId, qualifier: targetQual });
  }
  if (input.turnId?.trim()) {
    relationships.push({
      objectId: redactComplianceText(input.turnId.trim(), redactOpts),
      qualifier: "in_turn"
    });
  }
  if (input.overseerObjectId?.trim()) {
    relationships.push({
      objectId: redactComplianceText(input.overseerObjectId.trim(), redactOpts),
      qualifier: "approved_by"
    });
  }

  const event: Ocel2Event = {
    id: input.eventId ?? `oversight_stop_${randomUUID()}`,
    type: "oversight_intervened",
    time: input.timestamp ?? new Date().toISOString(),
    attributes,
    relationships
  };

  input.onEvent?.(event);

  return {
    event,
    redacted: true,
    standing: "INTERVENED"
  };
}

export interface PermissionLatencyInput {
  decisionLatencyMs: number;
  minReviewMs: number;
  decision?: "allow" | "allow_always" | "modify" | "deny" | "reject" | string;
  riskLevel?: "low" | "medium" | "high" | "critical" | string;
  consecutiveFastApprovals?: number;
  consecutiveThreshold?: number;
  windowIntervalMs?: number;
}

export interface PermissionLatencyEvaluation {
  abRiskFlag: boolean;
  flags: string[];
  severity: "none" | "warning" | "high";
  belowMinReview: boolean;
  streakTriggered: boolean;
  consecutiveFastApprovals: number;
  deficitMs: number;
}

export function evaluatePermissionDecisionLatency(
  input: PermissionLatencyInput
): PermissionLatencyEvaluation {
  const isApproval = isApprovalDecision(input.decision);
  const invalidMinReview =
    !Number.isFinite(input.minReviewMs) || input.minReviewMs < 0;
  const invalidLatency =
    !Number.isFinite(input.decisionLatencyMs) || input.decisionLatencyMs < 0;
  const belowMinReview =
    isApproval &&
    (invalidMinReview || invalidLatency || input.decisionLatencyMs < input.minReviewMs);
  const rapidInterval =
    isApproval &&
    !invalidMinReview &&
    input.windowIntervalMs !== undefined &&
    Number.isFinite(input.windowIntervalMs) &&
    input.windowIntervalMs >= 0 &&
    input.windowIntervalMs < input.minReviewMs;

  const prevFast =
    typeof input.consecutiveFastApprovals === "number" &&
    Number.isFinite(input.consecutiveFastApprovals) &&
    input.consecutiveFastApprovals >= 0
      ? Math.floor(input.consecutiveFastApprovals)
      : 0;
  const consecutiveFastApprovals =
    belowMinReview || rapidInterval ? prevFast + 1 : 0;
  const rawThreshold = input.consecutiveThreshold ?? DEFAULT_AB_STREAK_THRESHOLD;
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold >= 1
      ? Math.floor(rawThreshold)
      : 1;
  const streakTriggered = consecutiveFastApprovals >= threshold;
  const abRiskFlag = belowMinReview || streakTriggered;

  const flags: string[] = [];
  if (abRiskFlag) flags.push("AB_RISK_FLAG");
  if (streakTriggered) flags.push("RAPID_CONSECUTIVE_APPROVALS");

  const riskNorm = input.riskLevel?.trim().toLowerCase();
  const severity: "none" | "warning" | "high" = !abRiskFlag
    ? "none"
    : streakTriggered || riskNorm === "high" || riskNorm === "critical"
      ? "high"
      : "warning";

  const deficitMs =
    belowMinReview && !invalidMinReview && !invalidLatency
      ? Math.max(0, input.minReviewMs - input.decisionLatencyMs)
      : 0;

  return {
    abRiskFlag,
    flags,
    severity,
    belowMinReview,
    streakTriggered,
    consecutiveFastApprovals,
    deficitMs
  };
}

export class AutomationBiasMonitor {
  consecutiveFastApprovals = 0;
  lastApprovalAtMs?: number;
  totalDecisions = 0;
  flaggedCount = 0;

  constructor(
    private readonly minReviewMs: number = 1000,
    private readonly consecutiveThreshold: number = DEFAULT_AB_STREAK_THRESHOLD
  ) {}

  recordDecision(input: {
    decisionLatencyMs: number;
    decision?: string;
    riskLevel?: string;
    timestampMs?: number;
  }): PermissionLatencyEvaluation {
    const isApproval = isApprovalDecision(input.decision);

    const windowIntervalMs =
      isApproval &&
      this.lastApprovalAtMs !== undefined &&
      input.timestampMs !== undefined &&
      Number.isFinite(input.timestampMs)
        ? Math.max(0, input.timestampMs - this.lastApprovalAtMs)
        : undefined;

    const evalResult = evaluatePermissionDecisionLatency({
      decisionLatencyMs: input.decisionLatencyMs,
      minReviewMs: this.minReviewMs,
      decision: input.decision,
      riskLevel: input.riskLevel,
      consecutiveFastApprovals: this.consecutiveFastApprovals,
      consecutiveThreshold: this.consecutiveThreshold,
      windowIntervalMs
    });

    this.totalDecisions++;
    this.consecutiveFastApprovals = evalResult.consecutiveFastApprovals;
    if (evalResult.abRiskFlag) this.flaggedCount++;
    if (
      isApproval &&
      input.timestampMs !== undefined &&
      Number.isFinite(input.timestampMs)
    ) {
      this.lastApprovalAtMs = input.timestampMs;
    }

    return evalResult;
  }
}

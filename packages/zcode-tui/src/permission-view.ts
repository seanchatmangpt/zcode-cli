import { randomUUID } from "node:crypto";

import {
  Box,
  Text,
  type Component
} from "@earendil-works/pi-tui";

import type { Ocel2Event, Ocel2Relationship } from "../../../src/compliance/ocel2.ts";
import {
  AutomationBiasMonitor,
  DEFAULT_AB_STREAK_THRESHOLD,
  isApprovalDecision,
  recordOversightIntervention,
  type PermissionLatencyEvaluation
} from "../../../src/compliance/oversight.ts";
import {
  fileDiffsForPermission,
  FileDiffView
} from "./file-diff-view.ts";
import type { ZCodeTheme } from "./theme.ts";
import { sanitizeTerminalText, truncateGraphemes } from "./terminal-text.ts";
import { normalizeToolName, recordString } from "./tool-renderers.ts";
import { isRecord } from "./types.ts";

const maxInputLines = 32;
const maxInputCharacters = 6_000;

export type BlastRadiusLevel = "low" | "medium" | "high" | "critical";

const BLAST_RADIUS_RANK: Readonly<Record<BlastRadiusLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

const OVERSIGHT_INTERVENTION_ACTIONS = new Set([
  "emergency_stop",
  "abort_turn",
  "deny_tool",
  "quarantine_subagent"
]);

export interface PermissionOversightOptions {
  minReviewMs?: number;
  elapsedReviewMs?: number;
  presentedAtMs?: number;
  nowMs?: () => number;
  blastRadius?: BlastRadiusLevel;
  blastRadiusDetail?: string;
  abRiskFlag?: boolean;
  consecutiveFastApprovals?: number;
  abStreakThreshold?: number;
  complianceProfile?: string;
  overseerId?: string;
  sessionId?: string;
  targetObjectId?: string;
  turnId?: string;
  overseerObjectId?: string;
  automationBiasMonitor?: AutomationBiasMonitor;
  onOcelEvent?: (event: Ocel2Event) => void;
}

export interface PermissionDwellDecisionResult {
  allowed: boolean;
  held: boolean;
  abRiskFlag: boolean;
  remainingMs: number;
  elapsedMs: number;
  minReviewMs: number;
  reason?: string;
  latencyEvaluation?: PermissionLatencyEvaluation;
  ocelEvents?: Ocel2Event[];
}

const DEFAULT_HIGH_RISK_MIN_REVIEW_MS = 1000;

const sessionMonitors = new Map<string, AutomationBiasMonitor>();

export function getSessionAutomationBiasMonitor(
  sessionId: string,
  minReviewMs: number = DEFAULT_HIGH_RISK_MIN_REVIEW_MS,
  consecutiveThreshold: number = DEFAULT_AB_STREAK_THRESHOLD
): AutomationBiasMonitor {
  const existing = sessionMonitors.get(sessionId);
  if (existing) return existing;
  const created = new AutomationBiasMonitor(minReviewMs, consecutiveThreshold);
  sessionMonitors.set(sessionId, created);
  return created;
}

export function resetSessionAutomationBiasMonitor(sessionId?: string): void {
  if (sessionId === undefined) {
    sessionMonitors.clear();
  } else {
    sessionMonitors.delete(sessionId);
  }
}

interface ReviewDwellComputation {
  elapsedMs: number;
  remainingMs: number;
  invalidElapsed: boolean;
}

function computeReviewDwell(
  oversight: PermissionOversightOptions | undefined,
  minReviewMs: number,
  elapsedMsOverride?: number
): ReviewDwellComputation {
  const nowFn = oversight?.nowMs ?? Date.now;
  const rawElapsed =
    elapsedMsOverride ??
    oversight?.elapsedReviewMs ??
    (oversight?.presentedAtMs !== undefined ? nowFn() - oversight.presentedAtMs : 0);
  const invalidElapsed = !Number.isFinite(rawElapsed) || rawElapsed < 0;
  const elapsedMs = invalidElapsed ? 0 : rawElapsed;
  const remainingMs = Math.max(0, minReviewMs - elapsedMs);
  return { elapsedMs, remainingMs, invalidElapsed };
}

export function resolvePermissionOversightFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: Partial<PermissionOversightOptions>
): PermissionOversightOptions | undefined {
  const rawProfile = env.ZCODE_COMPLIANCE_PROFILE?.trim();
  const normalizedProfile = rawProfile?.toLowerCase();
  const hasRegulatedProfile = Boolean(rawProfile && normalizedProfile !== "standard");
  const rawMinReview = env.ZCODE_MIN_REVIEW_MS?.trim();
  const rawOverseer = env.ZCODE_OVERSEER_ID?.trim();

  if (!hasRegulatedProfile && !rawMinReview && !rawOverseer && !overrides) {
    return undefined;
  }

  let minReviewMs: number | undefined = overrides?.minReviewMs;
  if (minReviewMs === undefined) {
    if (rawMinReview !== undefined && rawMinReview.length > 0) {
      const parsed = Number(rawMinReview);
      minReviewMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
    } else if (
      normalizedProfile === "high-risk-annex-iii" ||
      normalizedProfile === "high-risk-annex-i"
    ) {
      minReviewMs = DEFAULT_HIGH_RISK_MIN_REVIEW_MS;
    }
  }

  const nowFn = overrides?.nowMs ?? Date.now;
  return {
    complianceProfile: overrides?.complianceProfile ?? (hasRegulatedProfile ? rawProfile : undefined),
    overseerId: overrides?.overseerId ?? (rawOverseer || undefined),
    minReviewMs,
    presentedAtMs: overrides?.presentedAtMs ?? nowFn(),
    nowMs: overrides?.nowMs,
    elapsedReviewMs: overrides?.elapsedReviewMs,
    blastRadius: overrides?.blastRadius,
    blastRadiusDetail: overrides?.blastRadiusDetail,
    abRiskFlag: overrides?.abRiskFlag,
    consecutiveFastApprovals: overrides?.consecutiveFastApprovals
  };
}

export function evaluatePermissionDwellGuard(
  oversight: PermissionOversightOptions | undefined,
  decision: string,
  elapsedMsOverride?: number
): PermissionDwellDecisionResult {
  if (!isApprovalDecision(decision)) {
    return {
      allowed: true,
      held: false,
      abRiskFlag: false,
      remainingMs: 0,
      elapsedMs: elapsedMsOverride ?? 0,
      minReviewMs: oversight?.minReviewMs ?? 0
    };
  }

  const rawMinReviewMs = oversight?.minReviewMs;
  if (rawMinReviewMs === undefined) {
    return {
      allowed: true,
      held: false,
      abRiskFlag: false,
      remainingMs: 0,
      elapsedMs: elapsedMsOverride ?? 0,
      minReviewMs: 0
    };
  }

  if (!Number.isFinite(rawMinReviewMs) || rawMinReviewMs < 0) {
    return {
      allowed: false,
      held: true,
      abRiskFlag: true,
      remainingMs: 0,
      elapsedMs: 0,
      minReviewMs: rawMinReviewMs,
      reason: "Review dwell guard active: invalid min_review_ms (fail-closed)"
    };
  }

  if (rawMinReviewMs === 0) {
    return {
      allowed: true,
      held: false,
      abRiskFlag: false,
      remainingMs: 0,
      elapsedMs: elapsedMsOverride ?? 0,
      minReviewMs: 0
    };
  }

  const { elapsedMs, remainingMs, invalidElapsed } = computeReviewDwell(
    oversight,
    rawMinReviewMs,
    elapsedMsOverride
  );

  if (invalidElapsed || remainingMs > 0) {
    return {
      allowed: false,
      held: true,
      abRiskFlag: true,
      remainingMs,
      elapsedMs,
      minReviewMs: rawMinReviewMs,
      reason: `Review dwell guard active: ${remainingMs}ms remaining of min_review_ms ${rawMinReviewMs}ms`
    };
  }

  return {
    allowed: true,
    held: false,
    abRiskFlag: false,
    remainingMs: 0,
    elapsedMs,
    minReviewMs: rawMinReviewMs
  };
}

export function inferBlastRadius(
  toolName: string,
  input: unknown,
  riskLevel?: string
): { level: BlastRadiusLevel; detail?: string } {
  const normalizedRisk = riskLevel?.trim().toLowerCase();
  if (normalizedRisk === "critical") return { level: "critical" };

  const normalizedTool = normalizeToolName(toolName);
  if (
    (normalizedTool.includes("bash") ||
      normalizedTool.includes("shell") ||
      normalizedTool === "exec") &&
    isRecord(input)
  ) {
    const command = recordString(input, ["command", "cmd", "script"]) ?? "";
    const hasRmRf =
      /\brm\b[^\n;|&]*(?:\s-(?:[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r[a-z]*)\b|\s(?:-[a-z]*r[a-z]*|--recursive)\b[^\n;|&]*\s(?:-[a-z]*f[a-z]*|--force)\b|\s(?:-[a-z]*f[a-z]*|--force)\b[^\n;|&]*\s(?:-[a-z]*r[a-z]*|--recursive)\b)/iu.test(
        command
      );
    if (hasRmRf || /\bmkfs\b|\bdd\s+if=/iu.test(command)) {
      return { level: "critical", detail: "destructive filesystem command" };
    }
    if (/\bgit\s+(?:reset\s+--hard|clean\s+-f|push\s+(?:-f|--force))|\bsudo\b/iu.test(command)) {
      return { level: "high", detail: "privileged or history-altering command" };
    }
    if (normalizedRisk === "high") return { level: "high" };
    if (normalizedRisk === "medium") return { level: "medium" };
    return { level: "medium", detail: "shell execution" };
  }

  const diffs = fileDiffsForPermission(toolName, input);
  if (diffs.length > 1) {
    return { level: "high", detail: `${diffs.length} files modified` };
  }
  if (diffs.length === 1) {
    return {
      level: normalizedRisk === "high" ? "high" : "medium",
      detail: "1 file modified"
    };
  }

  if (normalizedRisk === "high") return { level: "high" };
  if (normalizedRisk === "medium") return { level: "medium" };
  return { level: "low" };
}

function sanitizedJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return sanitizeTerminalText(JSON.stringify(value, (key, field) => {
      if (/api.?key|authorization|password|secret|token/iu.test(key) && typeof field === "string") return "[redacted]";
      if (typeof field === "string") return truncateGraphemes(field, maxInputCharacters);
      return field;
    }, 2), { preserveSgr: false });
  } catch {
    return sanitizeTerminalText(String(value), { preserveSgr: false });
  }
}

function limited(value: string): string {
  const normalized = value.replace(/\r/g, "");
  const lines = normalized.split("\n");
  if (lines.length > maxInputLines) return `${lines.slice(0, maxInputLines).join("\n")}\n… ${lines.length - maxInputLines} more lines`;
  return truncateGraphemes(normalized, maxInputCharacters);
}

export class PermissionPreview implements Component {
  private blockedApprovalCount: number;
  private readonly abMonitor?: AutomationBiasMonitor;

  constructor(
    private readonly theme: ZCodeTheme,
    private readonly toolName: string,
    private readonly input: unknown,
    private readonly riskLevel?: string,
    private readonly oversight?: PermissionOversightOptions
  ) {
    this.blockedApprovalCount = oversight?.consecutiveFastApprovals ?? 0;
    if (oversight) {
      if (oversight.automationBiasMonitor) {
        this.abMonitor = oversight.automationBiasMonitor;
      } else if (oversight.sessionId) {
        this.abMonitor = getSessionAutomationBiasMonitor(
          oversight.sessionId,
          oversight.minReviewMs ?? DEFAULT_HIGH_RISK_MIN_REVIEW_MS,
          oversight.abStreakThreshold ?? DEFAULT_AB_STREAK_THRESHOLD
        );
      } else {
        this.abMonitor = new AutomationBiasMonitor(
          oversight.minReviewMs ?? DEFAULT_HIGH_RISK_MIN_REVIEW_MS,
          oversight.abStreakThreshold ?? DEFAULT_AB_STREAK_THRESHOLD
        );
      }
    }
  }

  evaluateDecision(decision: string, elapsedMs?: number): PermissionDwellDecisionResult {
    const result = evaluatePermissionDwellGuard(this.oversight, decision, elapsedMs);
    if (result.held) {
      this.blockedApprovalCount += 1;
    }

    if (!this.oversight) {
      return result;
    }

    const nowFn = this.oversight.nowMs ?? Date.now;
    const timestampMs = nowFn();
    const effectiveRisk = this.effectiveRiskLevel();
    const latencyEvaluation = this.abMonitor?.recordDecision({
      decisionLatencyMs: result.elapsedMs,
      decision,
      riskLevel: effectiveRisk,
      timestampMs
    });

    const abRiskFlag = result.abRiskFlag || Boolean(latencyEvaluation?.abRiskFlag);
    const ocelEvents: Ocel2Event[] = [];
    const isoTime = new Date(timestampMs).toISOString();
    const normalizedDecision = decision.trim().toLowerCase();

    const relationships: Ocel2Relationship[] = [];
    if (this.oversight.sessionId?.trim()) {
      relationships.push({ objectId: this.oversight.sessionId.trim(), qualifier: "in_session" });
    }
    if (this.oversight.targetObjectId?.trim()) {
      relationships.push({ objectId: this.oversight.targetObjectId.trim(), qualifier: "governs" });
    }
    if (this.oversight.turnId?.trim()) {
      relationships.push({ objectId: this.oversight.turnId.trim(), qualifier: "in_turn" });
    }
    if (this.oversight.overseerObjectId?.trim()) {
      relationships.push({ objectId: this.oversight.overseerObjectId.trim(), qualifier: "approved_by" });
    }

    const permissionEvent: Ocel2Event = {
      id: `perm_decided_${randomUUID()}`,
      type: "permission_decided",
      time: isoTime,
      attributes: [
        { name: "tool_name", value: this.toolName },
        { name: "decision", value: normalizedDecision },
        { name: "allowed", value: String(result.allowed) },
        { name: "held", value: String(result.held) },
        { name: "ab_risk_flag", value: String(abRiskFlag) },
        { name: "elapsed_ms", value: String(result.elapsedMs) },
        { name: "min_review_ms", value: String(result.minReviewMs) },
        { name: "risk_level", value: effectiveRisk },
        {
          name: "consecutive_fast_approvals",
          value: String(latencyEvaluation?.consecutiveFastApprovals ?? this.blockedApprovalCount)
        },
        {
          name: "streak_triggered",
          value: String(Boolean(latencyEvaluation?.streakTriggered))
        }
      ],
      relationships
    };
    ocelEvents.push(permissionEvent);
    this.oversight.onOcelEvent?.(permissionEvent);

    if (OVERSIGHT_INTERVENTION_ACTIONS.has(normalizedDecision)) {
      const intervention = recordOversightIntervention({
        overseerId: this.oversight.overseerId?.trim() || "overseer",
        reason: `TUI oversight intervention: ${normalizedDecision} on ${this.toolName}`,
        sessionId: this.oversight.sessionId?.trim() || "tui_session",
        targetObjectId: this.oversight.targetObjectId?.trim() || this.toolName,
        targetObjectType: "tool_call",
        action: normalizedDecision as "emergency_stop" | "abort_turn" | "deny_tool" | "quarantine_subagent",
        turnId: this.oversight.turnId,
        overseerObjectId: this.oversight.overseerObjectId,
        timestamp: isoTime,
        onEvent: this.oversight.onOcelEvent
      });
      ocelEvents.push(intervention.event);
    }

    return {
      ...result,
      abRiskFlag,
      ...(latencyEvaluation ? { latencyEvaluation } : {}),
      ocelEvents
    };
  }

  invalidate(): void {}

  render(width: number): string[] {
    const host = new Box(1, 0, this.riskBackground());
    const risk = this.riskLevel ? this.riskStyle()(`Risk: ${this.riskLevel}`) : undefined;
    if (risk) host.addChild(new Text(risk, 0, 0));

    if (this.oversight) {
      this.appendOversightSection(host, this.oversight);
    }

    const diffs = fileDiffsForPermission(this.toolName, this.input);
    if (diffs.length > 0) {
      host.addChild(new FileDiffView(this.theme, {
        toolName: this.toolName,
        state: "waiting_permission",
        diffs
      }));
      return host.render(width);
    }

    const normalized = normalizeToolName(this.toolName);
    if ((normalized.includes("bash") || normalized.includes("shell") || normalized === "exec") && isRecord(this.input)) {
      const command = recordString(this.input, ["command", "cmd", "script"]);
      if (command) {
        const cleanCmd = sanitizeTerminalText(command, { preserveSgr: false });
        host.addChild(new Text(this.theme.bold(limited(cleanCmd)), 0, 0));
      }
      return host.render(width);
    }

    const input = sanitizedJson(this.input);
    if (input) host.addChild(new Text(this.theme.muted(limited(input)), 0, 0));
    return host.render(width);
  }

  private appendOversightSection(host: Box, oversight: PermissionOversightOptions): void {
    const inferred = inferBlastRadius(this.toolName, this.input, this.riskLevel);
    const blastLevel = oversight.blastRadius ?? inferred.level;
    const rawDetail = oversight.blastRadiusDetail ?? inferred.detail;
    const cleanDetail = rawDetail
      ? sanitizeTerminalText(rawDetail, { preserveSgr: false }).replace(/\s+/gu, " ").trim()
      : undefined;

    const blastText = `Blast radius: ${blastLevel}${cleanDetail ? ` (${cleanDetail})` : ""}`;
    const blastStyled =
      blastLevel === "critical" || blastLevel === "high"
        ? this.theme.error(blastText)
        : blastLevel === "medium"
          ? this.theme.warning(blastText)
          : this.theme.muted(blastText);
    host.addChild(new Text(blastStyled, 0, 0));

    let invalidMinReview = false;
    let invalidElapsed = false;
    const rawMinReviewMs = oversight.minReviewMs;
    if (rawMinReviewMs !== undefined) {
      if (!Number.isFinite(rawMinReviewMs) || rawMinReviewMs < 0) {
        invalidMinReview = true;
        host.addChild(
          new Text(this.theme.warning("Review dwell: invalid min_review_ms (dwell guard active)"), 0, 0)
        );
      } else if (rawMinReviewMs > 0) {
        const dwell = computeReviewDwell(oversight, rawMinReviewMs);
        invalidElapsed = dwell.invalidElapsed;
        const dwellStatus = dwell.remainingMs > 0 ? `${dwell.remainingMs}ms remaining` : "ready";
        const dwellText = `Review dwell: ${dwell.elapsedMs}ms / min_review_ms ${rawMinReviewMs}ms (${dwellStatus})`;
        host.addChild(
          new Text(dwell.remainingMs > 0 ? this.theme.warning(dwellText) : this.theme.muted(dwellText), 0, 0)
        );
      }
    }

    const threshold = oversight.abStreakThreshold ?? DEFAULT_AB_STREAK_THRESHOLD;
    const effectiveFastApprovals = Math.max(
      oversight.consecutiveFastApprovals ?? 0,
      this.blockedApprovalCount,
      this.abMonitor?.consecutiveFastApprovals ?? 0
    );
    const showAbFlag =
      oversight.abRiskFlag === true ||
      invalidMinReview ||
      invalidElapsed ||
      this.blockedApprovalCount > 0 ||
      effectiveFastApprovals >= threshold;
    if (showAbFlag) {
      const abStyle =
        effectiveFastApprovals >= threshold ? this.theme.error : this.theme.warning;
      host.addChild(
        new Text(
          abStyle("⚠ AB_RISK_FLAG · Automation-bias dwell guard active — verify action before approving"),
          0,
          0
        )
      );
    }

    if (oversight.complianceProfile || oversight.overseerId) {
      const cleanProfile = oversight.complianceProfile
        ? sanitizeTerminalText(oversight.complianceProfile, { preserveSgr: false }).trim()
        : "regulated";
      const cleanOverseer = oversight.overseerId
        ? sanitizeTerminalText(oversight.overseerId, { preserveSgr: false }).trim()
        : undefined;
      const oversightText = `Oversight: ${cleanProfile}${
        cleanOverseer ? ` · overseer=${cleanOverseer}` : ""
      }`;
      host.addChild(new Text(this.theme.muted(oversightText), 0, 0));
    }
  }

  private effectiveRiskLevel(): BlastRadiusLevel {
    const inferred = inferBlastRadius(this.toolName, this.input, this.riskLevel);
    const blastLevel = this.oversight?.blastRadius ?? inferred.level;
    const normalizedRisk = this.riskLevel?.trim().toLowerCase();
    if (
      normalizedRisk === "low" ||
      normalizedRisk === "medium" ||
      normalizedRisk === "high" ||
      normalizedRisk === "critical"
    ) {
      return BLAST_RADIUS_RANK[normalizedRisk] >= BLAST_RADIUS_RANK[blastLevel]
        ? normalizedRisk
        : blastLevel;
    }
    return blastLevel;
  }

  private riskStyle(): (text: string) => string {
    const level = this.effectiveRiskLevel();
    if (level === "critical" || level === "high") return this.theme.error;
    if (level === "medium") return this.theme.warning;
    return this.theme.muted;
  }

  private riskBackground(): ((text: string) => string) | undefined {
    const level = this.effectiveRiskLevel();
    if (level === "critical" || level === "high") return this.theme.toolErrorBackground;
    return this.theme.toolPendingBackground;
  }
}

export { PermissionPreview as PermissionView };

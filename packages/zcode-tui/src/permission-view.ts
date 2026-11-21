import {
  Box,
  Text,
  type Component
} from "@earendil-works/pi-tui";

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

export interface PermissionOversightOptions {
  minReviewMs?: number;
  elapsedReviewMs?: number;
  presentedAtMs?: number;
  nowMs?: () => number;
  blastRadius?: BlastRadiusLevel;
  blastRadiusDetail?: string;
  abRiskFlag?: boolean;
  consecutiveFastApprovals?: number;
  complianceProfile?: string;
  overseerId?: string;
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
  constructor(
    private readonly theme: ZCodeTheme,
    private readonly toolName: string,
    private readonly input: unknown,
    private readonly riskLevel?: string,
    private readonly oversight?: PermissionOversightOptions
  ) {}

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

    let remainingMs = 0;
    let invalidMinReview = false;
    const rawMinReviewMs = oversight.minReviewMs;
    if (rawMinReviewMs !== undefined) {
      if (!Number.isFinite(rawMinReviewMs) || rawMinReviewMs < 0) {
        invalidMinReview = true;
        host.addChild(
          new Text(this.theme.warning("Review dwell: invalid min_review_ms (dwell guard active)"), 0, 0)
        );
      } else if (rawMinReviewMs > 0) {
        const nowFn = oversight.nowMs ?? Date.now;
        const rawElapsed =
          oversight.elapsedReviewMs ??
          (oversight.presentedAtMs !== undefined ? nowFn() - oversight.presentedAtMs : 0);
        const elapsedMs = Number.isFinite(rawElapsed) && rawElapsed >= 0 ? rawElapsed : 0;
        remainingMs = Math.max(0, rawMinReviewMs - elapsedMs);
        const dwellStatus = remainingMs > 0 ? `${remainingMs}ms remaining` : "ready";
        const dwellText = `Review dwell: ${elapsedMs}ms / min_review_ms ${rawMinReviewMs}ms (${dwellStatus})`;
        host.addChild(
          new Text(remainingMs > 0 ? this.theme.warning(dwellText) : this.theme.muted(dwellText), 0, 0)
        );
      }
    }

    const showAbFlag =
      oversight.abRiskFlag === true ||
      invalidMinReview ||
      (rawMinReviewMs !== undefined && Number.isFinite(rawMinReviewMs) && rawMinReviewMs > 0 && remainingMs > 0) ||
      (oversight.consecutiveFastApprovals ?? 0) >= 3;
    if (showAbFlag) {
      const abStyle =
        (oversight.consecutiveFastApprovals ?? 0) >= 3 ? this.theme.error : this.theme.warning;
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

  private riskStyle(): (text: string) => string {
    if (this.riskLevel === "critical" || this.riskLevel === "high") return this.theme.error;
    if (this.riskLevel === "medium") return this.theme.warning;
    return this.theme.muted;
  }

  private riskBackground(): ((text: string) => string) | undefined {
    if (this.riskLevel === "critical" || this.riskLevel === "high") return this.theme.toolErrorBackground;
    return this.theme.toolPendingBackground;
  }
}

export { PermissionPreview as PermissionView };

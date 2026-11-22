import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { createPermissionPreview } from "../packages/zcode-tui/src/index.ts";
import { runRuntime } from "../src/launcher.ts";
import {
  getSessionAutomationBiasMonitor,
  PermissionPreview,
  PermissionView,
  resetSessionAutomationBiasMonitor,
  resolvePermissionOversightFromEnv
} from "../packages/zcode-tui/src/permission-view.ts";
import { createTheme } from "../packages/zcode-tui/src/theme.ts";
import { ComplianceRefusalError, parseComplianceConfigToml } from "../src/compliance/config.ts";
import type { Ocel2Event } from "../src/compliance/ocel2.ts";
import {
  AutomationBiasMonitor,
  DEFAULT_AB_STREAK_THRESHOLD,
  enforceOversightArgs,
  evaluatePermissionDecisionLatency,
  isApprovalDecision,
  propagateSubagentOversightContext,
  recordOversightIntervention
} from "../src/compliance/oversight.ts";
import { containsUnredactedSecretsOrPii } from "../src/compliance/redactor.ts";

describe("F09: EU AI Act Art. 14 Human Oversight Hardening", () => {
  test("enforceOversightArgs refuses yolo/bypass/dontAsk flags and env under regulated/no-yolo profiles", () => {
    const highRiskCfg = parseComplianceConfigToml(
      '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "alice-eu"\n',
      { env: {} }
    );
    const annexICfg = parseComplianceConfigToml(
      '[compliance]\nprofile = "high-risk-annex-i"\n[deployer]\noverseer_id = "alice-eu"\n',
      { env: {} }
    );
    const art50NoYoloCfg = parseComplianceConfigToml(
      '[compliance]\nprofile = "art50-only"\nallow_yolo = false\n',
      { env: {} }
    );
    const stdCfg = parseComplianceConfigToml('[compliance]\nprofile = "standard"\n', { env: {} });

    const forbiddenArgLists: string[][] = [
      ["--dangerously-skip-permissions"],
      ["--dangerously-skip-permissions=true"],
      ["--mode", "yolo"],
      ["--mode=yolo"],
      ["--mode", "YOLO"],
      ["--permission-mode", "bypassPermissions"],
      ["--permission-mode=bypassPermissions"],
      ["--permission-mode", "dontAsk"],
      ["--permission-mode=dontAsk"],
      ["--permission-mode", "yolo"],
      ["--allow-main-worktree-yolo"],
      ["--mode", "edit", "--dangerously-skip-permissions"]
    ];

    for (const cfg of [highRiskCfg, annexICfg, art50NoYoloCfg]) {
      for (const argv of forbiddenArgLists) {
        let caught: unknown;
        try {
          enforceOversightArgs(argv, cfg, {});
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ComplianceRefusalError);
        expect((caught as ComplianceRefusalError).code).toBe("OVERSIGHT_POLICY_REFUSED");
        expect((caught as ComplianceRefusalError).exitCode).toBe(1);
      }

      // Env bypass refused
      expect(() => enforceOversightArgs(["--mode", "edit"], cfg, { ZCODE_ALLOW_YOLO: "1" })).toThrow(
        ComplianceRefusalError
      );
    }

    // Safe modes, post-'--' positional args, and prompt values are allowed
    expect(enforceOversightArgs(["--mode", "build"], highRiskCfg, {}).allowed).toBe(true);
    expect(enforceOversightArgs(["--mode", "edit"], highRiskCfg, {}).allowed).toBe(true);
    expect(enforceOversightArgs(["--permission-mode", "acceptEdits"], highRiskCfg, {}).allowed).toBe(true);
    expect(enforceOversightArgs(["--permission-mode=plan"], highRiskCfg, {}).allowed).toBe(true);
    expect(
      enforceOversightArgs(
        ["--prompt", "--dangerously-skip-permissions", "--", "--mode", "yolo"],
        highRiskCfg,
        { ZCODE_HEADLESS_OVERSIGHT_ATTESTED: "1", ZCODE_OVERSEER_ID: "alice-eu" }
      ).allowed
    ).toBe(true);
    expect(enforceOversightArgs(["--mode"], highRiskCfg, {}).allowed).toBe(true);
    expect(enforceOversightArgs(["--mode", "yolo"], stdCfg, {}).allowed).toBe(true);
  });

  test("propagateSubagentOversightContext enforces monotonic lattice, propagates lease/env & OCEL spawned_by, and refuses escalation", () => {
    const parentCtx = {
      sessionId: "sess_parent_1",
      profile: "high-risk-annex-iii" as const,
      minReviewMs: 1200,
      policyCeiling: "CONSTRUCT" as const,
      overseerId: "overseer-alice",
      xaasWorker: true,
      env: {
        XAAS_WORKER: "1",
        XAAS_LEASE_CWD: "/tmp/repo",
        XAAS_EPOCH_ID: "epoch_9",
        XAAS_LEASE_ID: "lease_9",
        XAAS_WORK_ORDER_IRI: "urn:wo:9",
        XAAS_BASE_SHA: "abc123"
      },
      timestamp: "2026-08-02T10:00:00.000Z"
    };

    const propagated = propagateSubagentOversightContext(parentCtx, "subagent_worker_1");
    expect(propagated.effectiveProfile).toBe("high-risk-annex-iii");
    expect(propagated.effectiveAllowYolo).toBe(false);
    expect(propagated.effectiveMinReviewMs).toBe(1200);
    expect(propagated.effectiveCeiling).toBe("CONSTRUCT");
    expect(propagated.preToolUseEnforced).toBe(true);
    expect(propagated.env.ZCODE_SUBAGENT).toBe("1");
    expect(propagated.env.ZCODE_PARENT_SESSION_ID).toBe("sess_parent_1");
    expect(propagated.env.ZCODE_ALLOW_YOLO).toBe("0");
    expect(propagated.env.ZCODE_OVERSEER_ID).toBe("overseer-alice");
    expect(propagated.env.XAAS_WORKER).toBe("1");
    expect(propagated.env.XAAS_EPOCH_ID).toBe("epoch_9");
    expect(propagated.ocelObject.type).toBe("subagent");
    expect(propagated.ocelObject.relationships).toContainEqual({
      objectId: "sess_parent_1",
      qualifier: "spawned_by"
    });
    expect(propagated.ocelO2ORelationship).toEqual({
      sourceObjectId: "subagent_worker_1",
      targetObjectId: "sess_parent_1",
      qualifier: "spawned_by"
    });

    // Privilege escalation attempts must fail closed
    const badRequests = [
      { profile: "standard" as const },
      { policyCeiling: "DO" as const },
      { allowYolo: true },
      { permissionMode: "yolo" },
      { args: ["--mode", "yolo"] },
      { minReviewMs: 200 },
      { xaasWorker: false },
      { env: { XAAS_WORKER: "0" } },
      { overseerId: "   " }
    ];
    for (const req of badRequests) {
      let err: unknown;
      try {
        propagateSubagentOversightContext(parentCtx, "sub_bad", req);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ComplianceRefusalError);
      expect((err as ComplianceRefusalError).code).toBe("OVERSIGHT_POLICY_REFUSED");
    }

    // Missing overseer under high-risk profile refuses
    expect(() =>
      propagateSubagentOversightContext(
        { sessionId: "s", profile: "high-risk-annex-i" },
        "sub_no_overseer"
      )
    ).toThrow(ComplianceRefusalError);
  });

  test("recordOversightIntervention redacts PII/secrets before emission and refuses empty authority", () => {
    const emitted: unknown[] = [];
    const res = recordOversightIntervention({
      overseerId: "alice.mueller@example.eu",
      reason: "emergency stop due to leaked token sk-secret-123456 in /Users/alice/app.ts",
      sessionId: "sess_int_1",
      targetObjectId: "tool_int_1",
      metadata: { apiKey: "sk-99999", detail: "operator bob@example.com" },
      onEvent: (ev) => emitted.push(ev)
    });

    expect(res.redacted).toBe(true);
    expect(res.standing).toBe("INTERVENED");
    expect(emitted).toHaveLength(1);
    expect(res.event.type).toBe("oversight_intervened");
    expect(res.event.relationships).toContainEqual({
      objectId: "sess_int_1",
      qualifier: "in_session"
    });
    expect(containsUnredactedSecretsOrPii(JSON.stringify(res.event))).toBe(false);

    expect(() =>
      recordOversightIntervention({
        overseerId: "",
        reason: "stop",
        sessionId: "s",
        targetObjectId: "s"
      })
    ).toThrow(ComplianceRefusalError);
  });

  test("evaluatePermissionDecisionLatency and AutomationBiasMonitor detect AB_RISK_FLAG & rapid approval streaks", () => {
    const okEval = evaluatePermissionDecisionLatency({
      decisionLatencyMs: 1450,
      minReviewMs: 1000,
      decision: "allow"
    });
    expect(okEval.abRiskFlag).toBe(false);
    expect(okEval.flags).toEqual([]);
    expect(okEval.severity).toBe("none");

    const fastEval = evaluatePermissionDecisionLatency({
      decisionLatencyMs: 180,
      minReviewMs: 1000,
      decision: "allow",
      riskLevel: "high"
    });
    expect(fastEval.abRiskFlag).toBe(true);
    expect(fastEval.flags).toEqual(["AB_RISK_FLAG"]);
    expect(fastEval.deficitMs).toBe(820);
    expect(fastEval.severity).toBe("high");

    const monitor = new AutomationBiasMonitor(1000, 3);
    const r1 = monitor.recordDecision({ decisionLatencyMs: 200, decision: "allow", timestampMs: 1000 });
    const r2 = monitor.recordDecision({ decisionLatencyMs: 250, decision: "allow", timestampMs: 1300 });
    const r3 = monitor.recordDecision({ decisionLatencyMs: 300, decision: "allow", timestampMs: 1600 });
    expect(r1.abRiskFlag).toBe(true);
    expect(r2.streakTriggered).toBe(false);
    expect(r3.streakTriggered).toBe(true);
    expect(r3.flags).toEqual(["AB_RISK_FLAG", "RAPID_CONSECUTIVE_APPROVALS"]);
    expect(r3.severity).toBe("high");

    // Fast deny must not trigger AB_RISK_FLAG and resets streak
    const rDeny = monitor.recordDecision({ decisionLatencyMs: 50, decision: "deny", timestampMs: 1700 });
    expect(rDeny.abRiskFlag).toBe(false);
    expect(monitor.consecutiveFastApprovals).toBe(0);
  });

  test("PermissionPreview / PermissionView preserves legacy 4-arg behavior and renders oversight guard when provided", () => {
    expect(PermissionView).toBe(PermissionPreview);
    const theme = createTheme(true, "dark");

    const legacyView = new PermissionPreview(theme, "Bash", { command: "ls -la" }, "medium");
    const legacyOut = legacyView.render(80).join("\n");
    expect(legacyOut).toContain("ls -la");
    expect(legacyOut).not.toContain("AB_RISK_FLAG");
    expect(legacyOut).not.toContain("Blast radius:");

    const activeGuard = new PermissionView(
      theme,
      "Bash",
      { command: "rm -rf build\u001b[2J" },
      "critical",
      {
        minReviewMs: 1000,
        elapsedReviewMs: 250,
        blastRadius: "critical",
        abRiskFlag: true,
        complianceProfile: "high-risk-annex-iii",
        overseerId: "alice-eu\u001b[31m"
      }
    );
    const guardOut = activeGuard.render(90).join("\n");
    expect(guardOut).toContain("Blast radius: critical");
    expect(guardOut).toContain("min_review_ms 1000ms");
    expect(guardOut).toContain("750ms remaining");
    expect(guardOut).toContain("AB_RISK_FLAG");
    expect(guardOut).toContain("alice-eu");
    expect(guardOut).not.toContain("\u001b[2J");

    const readyGuard = new PermissionView(
      theme,
      "Write",
      { file_path: "src/a.ts", content: "export const x = 1;\n" },
      "medium",
      {
        minReviewMs: 1000,
        elapsedReviewMs: 1500,
        abRiskFlag: false,
        complianceProfile: "high-risk-annex-iii"
      }
    );
    const readyOut = readyGuard.render(90).join("\n");
    expect(readyOut).toContain("Blast radius: medium");
    expect(readyOut).toContain("ready");
    expect(readyOut).not.toContain("AB_RISK_FLAG");
  });

  test("regression (Iteration 2): propagateSubagentOversightContext enforces effectiveProfile on upgrades, finite minReviewMs, and valid profile/ceiling enums", () => {
    const art50Parent = {
      sessionId: "sess_art50_parent",
      profile: "art50-only" as const,
      allowYolo: true,
      minReviewMs: 1000,
      policyCeiling: "CONSTRUCT" as const
    };

    const badUpgrades = [
      { profile: "high-risk-annex-iii" as const, overseerId: "alice", args: ["--mode", "yolo"] },
      { profile: "high-risk-annex-iii" as const, overseerId: "alice", env: { ZCODE_ALLOW_YOLO: "1" } },
      { profile: "high-risk-annex-iii" as const, overseerId: "alice", allowYolo: true },
      { profile: "high-risk-annex-iii" as const, overseerId: "alice", permissionMode: "yolo" },
      { profile: "high-risk-annex-iii" as const }, // missing overseerId under upgraded high-risk profile
      { minReviewMs: Number.NaN },
      { minReviewMs: Number.POSITIVE_INFINITY },
      { minReviewMs: -10 },
      { profile: "unregulated" as unknown as "standard" },
      { policyCeiling: "ADMIN" as unknown as "DO" }
    ];

    for (const req of badUpgrades) {
      let err: unknown;
      try {
        propagateSubagentOversightContext(art50Parent, "sub_upgrade_bad", req);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ComplianceRefusalError);
      expect((err as ComplianceRefusalError).code).toBe("OVERSIGHT_POLICY_REFUSED");
    }

    // Invalid parent minReviewMs must also refuse
    expect(() =>
      propagateSubagentOversightContext(
        { sessionId: "s", profile: "high-risk-annex-iii", overseerId: "alice", minReviewMs: Number.NaN },
        "sub_nan_parent"
      )
    ).toThrow(ComplianceRefusalError);

    // Legitimate upgrade with overseerId and safe args succeeds and disables yolo
    const validUpgrade = propagateSubagentOversightContext(art50Parent, "sub_upgrade_ok", {
      profile: "high-risk-annex-iii",
      overseerId: "alice-eu",
      args: ["--mode", "edit"]
    });
    expect(validUpgrade.effectiveProfile).toBe("high-risk-annex-iii");
    expect(validUpgrade.effectiveAllowYolo).toBe(false);
    expect(validUpgrade.env.ZCODE_ALLOW_YOLO).toBe("0");
    expect(validUpgrade.preToolUseEnforced).toBe(true);
  });

  test("regression (Iteration 2): PermissionPreview guards NaN elapsedReviewMs/minReviewMs and inferBlastRadius detects rm -fr", () => {
    const theme = createTheme(true, "dark");

    const nanElapsed = new PermissionPreview(theme, "Bash", { command: "ls" }, "high", {
      minReviewMs: 1000,
      elapsedReviewMs: Number.NaN,
      complianceProfile: "high-risk-annex-iii"
    }).render(90).join("\n");
    expect(nanElapsed).toContain("1000ms remaining");
    expect(nanElapsed).not.toContain("(ready)");
    expect(nanElapsed).not.toContain("NaNms");
    expect(nanElapsed).toContain("AB_RISK_FLAG");

    const nanMinReview = new PermissionPreview(theme, "Bash", { command: "ls" }, "high", {
      minReviewMs: Number.NaN,
      elapsedReviewMs: 500,
      complianceProfile: "high-risk-annex-iii"
    }).render(90).join("\n");
    expect(nanMinReview).toContain("invalid min_review_ms");
    expect(nanMinReview).toContain("AB_RISK_FLAG");

    for (const cmd of [
      "rm -fr /tmp/important",
      "rm -rf /tmp/important",
      "rm -r -f /tmp/important",
      "rm -f -r /tmp/important",
      "rm -Rf /tmp/important"
    ]) {
      const preview = new PermissionPreview(theme, "Bash", { command: cmd }, "medium", {
        complianceProfile: "high-risk-annex-iii"
      }).render(90).join("\n");
      expect(preview).toContain("Blast radius: critical");
    }
  });

  test("regression (Iteration 3): evaluatePermissionDecisionLatency & AutomationBiasMonitor fail closed on invalid minReviewMs with finite deficitMs, rm -rfv/--recursive --force blast radius, and subagent overseer_id redaction", () => {
    for (const badMin of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const allowRes = evaluatePermissionDecisionLatency({
        decisionLatencyMs: 500,
        minReviewMs: badMin,
        decision: "allow"
      });
      expect(allowRes.abRiskFlag).toBe(true);
      expect(allowRes.belowMinReview).toBe(true);
      expect(allowRes.flags).toContain("AB_RISK_FLAG");
      expect(allowRes.severity).toBe("warning");
      expect(Number.isFinite(allowRes.deficitMs)).toBe(true);
      expect(allowRes.deficitMs).toBe(0);

      const negLatRes = evaluatePermissionDecisionLatency({
        decisionLatencyMs: -5,
        minReviewMs: badMin,
        decision: "allow",
        riskLevel: "high"
      });
      expect(negLatRes.abRiskFlag).toBe(true);
      expect(negLatRes.belowMinReview).toBe(true);
      expect(negLatRes.severity).toBe("high");
      expect(Number.isFinite(negLatRes.deficitMs)).toBe(true);
      expect(negLatRes.deficitMs).toBe(0);

      const denyRes = evaluatePermissionDecisionLatency({
        decisionLatencyMs: 500,
        minReviewMs: badMin,
        decision: "deny"
      });
      expect(denyRes.abRiskFlag).toBe(false);
      expect(denyRes.belowMinReview).toBe(false);
      expect(denyRes.deficitMs).toBe(0);

      const monitor = new AutomationBiasMonitor(badMin, 3);
      const monRes = monitor.recordDecision({ decisionLatencyMs: 10, decision: "allow" });
      expect(monRes.abRiskFlag).toBe(true);
      expect(monRes.belowMinReview).toBe(true);
      expect(Number.isFinite(monRes.deficitMs)).toBe(true);
      expect(monRes.deficitMs).toBe(0);
    }

    const nanThreshMon = new AutomationBiasMonitor(1000, Number.NaN);
    const nanThreshRes = nanThreshMon.recordDecision({ decisionLatencyMs: 10, decision: "allow" });
    expect(nanThreshRes.abRiskFlag).toBe(true);
    expect(nanThreshRes.streakTriggered).toBe(true);
    expect(nanThreshRes.severity).toBe("high");

    // Blast radius: rm -rfv, rm -r -fv, rm --recursive --force
    const theme = createTheme(true, "dark");
    for (const cmd of [
      "rm -rfv /tmp/x",
      "rm -r -fv /tmp/x",
      "rm --recursive --force /tmp/x",
      "rm --force --recursive /tmp/x",
      "rm -r --force /tmp/x"
    ]) {
      const preview = new PermissionPreview(theme, "Bash", { command: cmd }, "medium", {
        complianceProfile: "high-risk-annex-iii"
      }).render(90).join("\n");
      expect(preview).toContain("Blast radius: critical");
    }
    const nonRecPreview = new PermissionPreview(theme, "Bash", { command: "rm -f /tmp/x" }, "medium", {
      complianceProfile: "high-risk-annex-iii"
    }).render(90).join("\n");
    expect(nonRecPreview).toContain("Blast radius: medium");

    // Subagent OCEL object redacts overseer_id while preserving env.ZCODE_OVERSEER_ID
    const prop = propagateSubagentOversightContext(
      {
        sessionId: "sess_em",
        profile: "high-risk-annex-iii",
        overseerId: "alice.mueller@example.eu"
      },
      "sub_em"
    );
    expect(prop.env.ZCODE_OVERSEER_ID).toBe("alice.mueller@example.eu");
    expect(containsUnredactedSecretsOrPii(JSON.stringify(prop.ocelObject))).toBe(false);
    expect(prop.ocelObject.attributes.find((a) => a.name === "overseer_id")?.value).toBe("REDACTED");
  });

  test("regression (C4-Art14-Oversight): TUI permissionPreview wires env oversight panel and enforces min_review_ms dwell guard", () => {
    const prevProfile = process.env.ZCODE_COMPLIANCE_PROFILE;
    const prevMinReview = process.env.ZCODE_MIN_REVIEW_MS;
    const prevOverseer = process.env.ZCODE_OVERSEER_ID;
    try {
      process.env.ZCODE_COMPLIANCE_PROFILE = "high-risk-annex-iii";
      process.env.ZCODE_MIN_REVIEW_MS = "5000";
      process.env.ZCODE_OVERSEER_ID = "alice-eu";

      const theme = createTheme(true, "dark");
      const preview = createPermissionPreview(
        theme,
        "bash",
        { command: "rm -rf /tmp/x" },
        "high"
      );
      const rendered = preview.render(100).join("\n");
      expect(rendered).toContain("Blast radius:");
      expect(rendered).toContain("Review dwell:");
      expect(rendered).not.toContain("AB_RISK_FLAG");
      expect(rendered).toContain("overseer=alice-eu");

      // Submitting "allow" before min_review_ms (50ms < 5000ms) must be blocked/held
      const heldDecision = preview.evaluateDecision("allow", 50);
      expect(heldDecision.allowed).toBe(false);
      expect(heldDecision.held).toBe(true);
      expect(heldDecision.abRiskFlag).toBe(true);
      expect(heldDecision.remainingMs).toBe(4950);

      // Re-rendering after a premature approval attempt now surfaces AB_RISK_FLAG
      const renderedAfterPremature = preview.render(100).join("\n");
      expect(renderedAfterPremature).toContain("AB_RISK_FLAG");

      // Submitting "deny" is never blocked by dwell guard
      const denyDecision = preview.evaluateDecision("deny", 50);
      expect(denyDecision.allowed).toBe(true);
      expect(denyDecision.held).toBe(false);

      // Submitting "allow" once min_review_ms has elapsed is permitted
      const allowedDecision = preview.evaluateDecision("allow", 5000);
      expect(allowedDecision.allowed).toBe(true);
      expect(allowedDecision.held).toBe(false);
      expect(allowedDecision.remainingMs).toBe(0);

      // Invalid ZCODE_MIN_REVIEW_MS fails closed
      const badOversight = resolvePermissionOversightFromEnv({
        ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii",
        ZCODE_MIN_REVIEW_MS: "invalid"
      });
      const badPreview = new PermissionPreview(
        theme,
        "bash",
        { command: "ls" },
        "high",
        badOversight
      );
      expect(badPreview.evaluateDecision("allow", 10_000).allowed).toBe(false);
    } finally {
      if (prevProfile === undefined) delete process.env.ZCODE_COMPLIANCE_PROFILE;
      else process.env.ZCODE_COMPLIANCE_PROFILE = prevProfile;
      if (prevMinReview === undefined) delete process.env.ZCODE_MIN_REVIEW_MS;
      else process.env.ZCODE_MIN_REVIEW_MS = prevMinReview;
      if (prevOverseer === undefined) delete process.env.ZCODE_OVERSEER_ID;
      else process.env.ZCODE_OVERSEER_ID = prevOverseer;
    }
  });

  test("ERRC (15-Art14-Oversight): unified isApprovalDecision includes 'approve', riskStyle/riskBackground escalate from inferred blast radius", () => {
    expect(isApprovalDecision("allow")).toBe(true);
    expect(isApprovalDecision("allow_always")).toBe(true);
    expect(isApprovalDecision("modify")).toBe(true);
    expect(isApprovalDecision("approve")).toBe(true);
    expect(isApprovalDecision("APPROVE")).toBe(true);
    expect(isApprovalDecision("deny")).toBe(false);
    expect(isApprovalDecision("reject")).toBe(false);
    expect(isApprovalDecision("emergency_stop")).toBe(false);

    // "approve" must be evaluated as an approval in latency + AutomationBiasMonitor
    const approveEval = evaluatePermissionDecisionLatency({
      decisionLatencyMs: 120,
      minReviewMs: 1000,
      decision: "approve",
      riskLevel: "high"
    });
    expect(approveEval.abRiskFlag).toBe(true);
    expect(approveEval.belowMinReview).toBe(true);
    expect(approveEval.consecutiveFastApprovals).toBe(1);

    const mon = new AutomationBiasMonitor(1000, DEFAULT_AB_STREAK_THRESHOLD);
    mon.recordDecision({ decisionLatencyMs: 100, decision: "approve", timestampMs: 1000 });
    mon.recordDecision({ decisionLatencyMs: 150, decision: "approve", timestampMs: 1200 });
    const third = mon.recordDecision({ decisionLatencyMs: 180, decision: "approve", timestampMs: 1400 });
    expect(third.streakTriggered).toBe(true);
    expect(third.flags).toContain("RAPID_CONSECUTIVE_APPROVALS");
    expect(mon.consecutiveFastApprovals).toBe(3);

    // riskStyle/riskBackground escalate from inferBlastRadius() even when upstream riskLevel is "low"
    const theme = createTheme(true, "dark");
    const escalated = new PermissionPreview(theme, "Bash", { command: "rm -rf /tmp/target" }, "low");
    const safeLow = new PermissionPreview(theme, "Read", { file_path: "README.md" }, "low");
    const escalatedOut = escalated.render(80).join("\n");
    const safeLowOut = safeLow.render(80).join("\n");
    expect(escalatedOut).toContain(theme.error("Risk: low"));
    expect(safeLowOut).toContain(theme.muted("Risk: low"));
  });

  test("ERRC (15-Art14-Oversight): session-scoped AutomationBiasMonitor tracks cross-prompt streaks and emits OCEL 2.0 permission_decided & oversight_intervened", () => {
    const sessionId = "sess_errc_ab_1";
    resetSessionAutomationBiasMonitor(sessionId);
    const theme = createTheme(true, "dark");
    const emitted: Ocel2Event[] = [];

    let clock = 10_000;
    const nowMs = () => clock;

    // Three distinct prompts in the same session share one AutomationBiasMonitor
    for (let i = 1; i <= 3; i++) {
      clock += 200;
      const preview = new PermissionPreview(
        theme,
        "Bash",
        { command: `echo step-${i}` },
        "medium",
        {
          sessionId,
          targetObjectId: `tool_call_${i}`,
          turnId: `turn_${i}`,
          overseerId: "alice-eu",
          minReviewMs: 1000,
          presentedAtMs: clock,
          nowMs,
          onOcelEvent: (ev) => emitted.push(ev)
        }
      );

      // Fresh prompt at t=0 does not show AB_RISK_FLAG before streak reaches threshold
      if (i === 1) {
        expect(preview.render(90).join("\n")).not.toContain("AB_RISK_FLAG");
      }

      const res = preview.evaluateDecision("approve", 150);
      expect(res.held).toBe(true);
      expect(res.abRiskFlag).toBe(true);
      expect(res.latencyEvaluation?.consecutiveFastApprovals).toBe(i);
      if (i === 3) {
        expect(res.latencyEvaluation?.streakTriggered).toBe(true);
      }
    }

    const sharedMonitor = getSessionAutomationBiasMonitor(sessionId);
    expect(sharedMonitor.consecutiveFastApprovals).toBe(3);
    expect(emitted.filter((e) => e.type === "permission_decided")).toHaveLength(3);

    // Intervention action (emergency_stop / abort_turn / deny_tool) emits oversight_intervened via recordOversightIntervention
    const stopPreview = new PermissionPreview(
      theme,
      "Bash",
      { command: "rm -rf /" },
      "critical",
      {
        sessionId,
        targetObjectId: "tool_call_stop",
        overseerId: "alice.mueller@example.eu",
        minReviewMs: 1000,
        nowMs,
        onOcelEvent: (ev) => emitted.push(ev)
      }
    );
    const stopRes = stopPreview.evaluateDecision("emergency_stop", 50);
    expect(stopRes.allowed).toBe(true);
    expect(stopRes.held).toBe(false);
    expect(stopRes.ocelEvents?.map((e) => e.type)).toEqual([
      "permission_decided",
      "oversight_intervened"
    ]);
    const interventionEvent = emitted.find((e) => e.type === "oversight_intervened");
    expect(interventionEvent).toBeDefined();
    expect(containsUnredactedSecretsOrPii(JSON.stringify(interventionEvent))).toBe(false);
    expect(sharedMonitor.consecutiveFastApprovals).toBe(0);

    resetSessionAutomationBiasMonitor(sessionId);
  });

  test("regression (G07-G08-Art14): enforceOversightArgs refuses unattested headless flags under high-risk profiles and admits with explicit attestation + overseer_id", () => {
    const highRiskCfg = parseComplianceConfigToml(
      '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "alice-eu"\n',
      { env: {} }
    );
    const annexICfg = parseComplianceConfigToml(
      '[compliance]\nprofile = "high-risk-annex-i"\n[deployer]\noverseer_id = "alice-eu"\n',
      { env: {} }
    );
    const art50Cfg = parseComplianceConfigToml(
      '[compliance]\nprofile = "art50-only"\nallow_yolo = false\n',
      { env: {} }
    );

    const headlessArgLists: string[][] = [
      ["-p", "run shell command"],
      ["-phello"],
      ["--prompt", "run shell command"],
      ["--prompt=run shell command"],
      ["--output-format", "stream-json"],
      ["--output-format=stream-json"],
      ["-p", "run shell command", "--output-format", "stream-json"]
    ];

    for (const cfg of [highRiskCfg, annexICfg]) {
      for (const argv of headlessArgLists) {
        for (const badEnv of [
          {},
          { ZCODE_HEADLESS_OVERSIGHT_ATTESTED: "1" },
          { ZCODE_HEADLESS_OVERSIGHT_ATTESTED: "1", ZCODE_OVERSEER_ID: "   " },
          { ZCODE_OVERSEER_ID: "alice-eu" },
          { ZCODE_HEADLESS_OVERSIGHT_ATTESTED: "0", ZCODE_OVERSEER_ID: "alice-eu" }
        ]) {
          let caught: unknown;
          try {
            enforceOversightArgs(argv, cfg, badEnv);
          } catch (e) {
            caught = e;
          }
          expect(caught).toBeInstanceOf(ComplianceRefusalError);
          expect((caught as ComplianceRefusalError).code).toBe("OVERSIGHT_POLICY_REFUSED");
          expect((caught as ComplianceRefusalError).exitCode).toBe(1);
        }

        // Admitted when both ZCODE_HEADLESS_OVERSIGHT_ATTESTED=1 and non-empty ZCODE_OVERSEER_ID are set
        expect(
          enforceOversightArgs(argv, cfg, {
            ZCODE_HEADLESS_OVERSIGHT_ATTESTED: "1",
            ZCODE_OVERSEER_ID: "alice-eu"
          }).allowed
        ).toBe(true);
      }
    }

    // Non-high-risk regulated profile (art50-only) still allows headless flags without attestation
    for (const argv of headlessArgLists) {
      expect(enforceOversightArgs(argv, art50Cfg, {}).allowed).toBe(true);
    }
  });

  test("regression (G07-G08-Declare): runRuntime evaluates DECLARE rules post-session and fails closed on mandatory violation", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "zcode-declare-rt-"));
    const ocelDir = join(tmp, "ocel");
    const workDir = join(tmp, "work");
    const prevOcelDir = process.env.ZCODE_OCEL_DIR;
    const prevOcel = process.env.ZCODE_OCEL;
    try {
      process.env.ZCODE_OCEL_DIR = ocelDir;
      process.env.ZCODE_OCEL = "1";
      const cfg = parseComplianceConfigToml(
        '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "alice-eu"\n',
        { env: {} }
      );

      // 1) Violating runtime: emits tool.updated without preceding permission.resolved (violates DEC-PREC-ART14)
      const violatingScript = join(tmp, "violating-runtime.mjs");
      writeFileSync(
        violatingScript,
        [
          'const evs = [',
          '  { type: "session.created", eventId: "ev_1", timestamp: "2026-11-22T07:00:00.000Z", sessionId: "sess_decl_bad" },',
          '  { type: "turn.started", eventId: "ev_2", timestamp: "2026-11-22T07:00:01.000Z", sessionId: "sess_decl_bad", turnId: "turn_1" },',
          '  { type: "tool.updated", eventId: "ev_3", timestamp: "2026-11-22T07:00:02.000Z", sessionId: "sess_decl_bad", turnId: "turn_1", payload: { toolCallId: "tc_1", toolName: "Bash", status: "running" } },',
          '  { type: "turn.completed", eventId: "ev_4", timestamp: "2026-11-22T07:00:03.000Z", sessionId: "sess_decl_bad", turnId: "turn_1" }',
          '];',
          'for (const e of evs) process.stdout.write(JSON.stringify(e) + "\\n");'
        ].join("\n")
      );

      const badExit = await runRuntime(
        process.execPath,
        ["-p", "test", "--output-format", "stream-json"],
        {},
        { config: cfg, providerId: "test", modelId: "test", sessionId: "sess_decl_bad" },
        { runtimeScriptPath: violatingScript, cwd: tmp }
      );
      expect(badExit).toBe(1);

      const receiptFiles = readdirSync(ocelDir).filter((f) => f.endsWith(".receipt.json"));
      expect(receiptFiles.length).toBeGreaterThanOrEqual(1);
      const receipt = JSON.parse(readFileSync(join(ocelDir, receiptFiles[0]!), "utf8")) as {
        declare_conformance?: {
          standing: string;
          refusal_code: string;
          violated_rules: Array<{ id: string }>;
        };
      };
      expect(receipt.declare_conformance?.standing).toBe("REFUSED");
      expect(receipt.declare_conformance?.refusal_code).toBe("DECLARE_CONFORMANCE_VIOLATION");
      expect(receipt.declare_conformance?.violated_rules.some((r) => r.id === "DEC-PREC-ART14")).toBe(true);

      // 2) Conforming runtime: permission.resolved precedes tool.updated
      const okScript = join(tmp, "conforming-runtime.mjs");
      writeFileSync(
        okScript,
        [
          'const evs = [',
          '  { type: "session.created", eventId: "ev_10", timestamp: "2026-11-22T07:01:00.000Z", sessionId: "sess_decl_ok" },',
          '  { type: "turn.started", eventId: "ev_11", timestamp: "2026-11-22T07:01:01.000Z", sessionId: "sess_decl_ok", turnId: "turn_1" },',
          '  { type: "permission.resolved", eventId: "ev_12", timestamp: "2026-11-22T07:01:02.000Z", sessionId: "sess_decl_ok", turnId: "turn_1", payload: { requestId: "perm_1", decision: "allow" } },',
          '  { type: "tool.updated", eventId: "ev_13", timestamp: "2026-11-22T07:01:03.000Z", sessionId: "sess_decl_ok", turnId: "turn_1", payload: { toolName: "Bash", status: "running" } },',
          '  { type: "turn.completed", eventId: "ev_14", timestamp: "2026-11-22T07:01:04.000Z", sessionId: "sess_decl_ok", turnId: "turn_1" }',
          '];',
          'for (const e of evs) process.stdout.write(JSON.stringify(e) + "\\n");'
        ].join("\n")
      );

      const okExit = await runRuntime(
        process.execPath,
        ["-p", "test", "--output-format", "stream-json"],
        {},
        { config: cfg, providerId: "test", modelId: "test", sessionId: "sess_decl_ok" },
        { runtimeScriptPath: okScript, cwd: tmp }
      );
      expect(okExit).toBe(0);
    } finally {
      if (prevOcelDir === undefined) delete process.env.ZCODE_OCEL_DIR;
      else process.env.ZCODE_OCEL_DIR = prevOcelDir;
      if (prevOcel === undefined) delete process.env.ZCODE_OCEL;
      else process.env.ZCODE_OCEL = prevOcel;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

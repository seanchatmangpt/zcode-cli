import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

import { ComplianceRefusalError, type ResolvedComplianceConfig } from "../src/compliance/config.ts";
import {
  clearRevokedAuthorityLeases,
  enforceOversightArgs,
  isAuthorityLeaseRevoked,
  recordOversightIntervention,
  revokeAuthorityLease,
  verifyBrceDoGate,
  type As01Seal
} from "../src/compliance/oversight.ts";

function makeHighRiskConfig(): ResolvedComplianceConfig {
  return {
    compliance: {
      profile: "high-risk-annex-iii",
      redact_pii: true,
      min_review_ms: 1000,
      git_provenance_trailer: true,
      allow_yolo: false,
      max_retries_per_signature: 3,
      redact_env: []
    },
    deployer: {
      overseer_id: "overseer-eu-01",
      log_retention_days: 180,
      monitoring_enabled: true,
      worker_notice_acknowledged: true
    },
    pmm: {
      drift_alpha: 0.01,
      min_window: 20,
      k_anonymity: 5
    },
    complianceLogEnabled: true,
    complianceDir: "",
    configPath: "",
    configPresent: true
  };
}

function makeValidAs01Seal(overrides: Partial<As01Seal> = {}): As01Seal {
  return {
    seat: "AS-01",
    sealId: "seal-as01-v27-001",
    subjectSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    overseerId: "overseer-eu-01",
    issuedAt: "2026-11-21T00:00:00.000Z",
    expiresAt: "2027-11-21T00:00:00.000Z",
    authorityCeiling: "DO",
    leaseId: "lease-v27-001",
    ...overrides
  };
}

afterEach(() => {
  clearRevokedAuthorityLeases();
});

describe("v27.1.1 Art. 14 Seat AS-01 & BRCE DO-gate integration", () => {
  test("verifyBrceDoGate admits a valid Seat AS-01 seal with DO ceiling", () => {
    const seal = makeValidAs01Seal();
    const res = verifyBrceDoGate({
      seal,
      requiredCeiling: "DO",
      expectedSubjectSha: seal.subjectSha,
      nowMs: Date.parse("2026-11-21T12:00:00.000Z")
    });

    expect(res.admitted).toBe(true);
    expect(res.seat).toBe("AS-01");
    expect(res.sealId).toBe(seal.sealId);
    expect(res.subjectSha).toBe(seal.subjectSha);
    expect(res.authorityCeiling).toBe("DO");
    expect(res.leaseId).toBe(seal.leaseId);
  });

  test("verifyBrceDoGate fails closed on missing seal, wrong seat, low ceiling, SHA mismatch, or expiry", () => {
    expect(() => verifyBrceDoGate({ seal: null })).toThrow(ComplianceRefusalError);

    expect(() =>
      verifyBrceDoGate({
        seal: makeValidAs01Seal({ seat: "AS-02" as "AS-01" })
      })
    ).toThrow(ComplianceRefusalError);

    expect(() =>
      verifyBrceDoGate({
        seal: makeValidAs01Seal({ authorityCeiling: "CONSTRUCT" }),
        requiredCeiling: "DO"
      })
    ).toThrow(ComplianceRefusalError);

    expect(() =>
      verifyBrceDoGate({
        seal: makeValidAs01Seal(),
        expectedSubjectSha: "deadbeef"
      })
    ).toThrow(ComplianceRefusalError);

    expect(() =>
      verifyBrceDoGate({
        seal: makeValidAs01Seal({ expiresAt: "2026-01-01T00:00:00.000Z" }),
        nowMs: Date.parse("2026-11-21T12:00:00.000Z")
      })
    ).toThrow(ComplianceRefusalError);
  });

  test("verifyBrceDoGate refuses revoked authority leases", () => {
    const seal = makeValidAs01Seal({ leaseId: "lease-revoked-1" });
    revokeAuthorityLease("lease-revoked-1", "manual_stop");
    expect(isAuthorityLeaseRevoked("lease-revoked-1")).toBe(true);

    expect(() =>
      verifyBrceDoGate({
        seal,
        nowMs: Date.parse("2026-11-21T12:00:00.000Z")
      })
    ).toThrow(ComplianceRefusalError);
  });

  test("enforceOversightArgs integrates BRCE DO-gate via options and ZCODE_BRCE_DO_GATE env", () => {
    const cfg = makeHighRiskConfig();
    const seal = makeValidAs01Seal();

    const admitted = enforceOversightArgs(
      ["--model", "test-model"],
      cfg,
      {
        ZCODE_BRCE_DO_GATE: "1",
        ZCODE_AS01_SEAL: JSON.stringify(seal),
        XAAS_BASE_SHA: seal.subjectSha,
        XAAS_LEASE_ID: seal.leaseId
      },
      { nowMs: Date.parse("2026-11-21T12:00:00.000Z") }
    );
    expect(admitted.allowed).toBe(true);
    expect(admitted.brceGate?.admitted).toBe(true);
    expect(admitted.brceGate?.seat).toBe("AS-01");

    // Missing seal under ZCODE_BRCE_DO_GATE=1 must fail closed
    expect(() =>
      enforceOversightArgs(["--model", "test-model"], cfg, {
        ZCODE_BRCE_DO_GATE: "1"
      })
    ).toThrow(ComplianceRefusalError);

    // Malformed seal JSON must fail closed
    expect(() =>
      enforceOversightArgs(["--model", "test-model"], cfg, {
        ZCODE_BRCE_DO_GATE: "1",
        ZCODE_AS01_SEAL: "{not-json"
      })
    ).toThrow(ComplianceRefusalError);
  });

  test("recordOversightIntervention executes real child process termination, lease revocation, and AbortController halt", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      stdio: "ignore"
    });
    expect(child.pid).toBeDefined();

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }
    );

    const abortController = new AbortController();
    const leaseId = "lease-live-halt-99";
    let revokedCallbackLease: string | undefined;
    let haltCallbackCalled = false;

    const result = recordOversightIntervention({
      overseerId: "overseer-eu-01",
      reason: "Emergency stop triggered by human overseer",
      sessionId: "sess-v27-halt",
      targetObjectId: "subagent-runaway-1",
      action: "emergency_stop",
      targetPid: child.pid,
      leaseId,
      abortController,
      onRevokeLease: (id) => {
        revokedCallbackLease = id;
      },
      onHaltActuation: () => {
        haltCallbackCalled = true;
      }
    });

    const exitInfo = await exitPromise;

    expect(result.standing).toBe("INTERVENED");
    expect(result.actuationHalted).toBe(true);
    expect(result.killedPid).toBe(child.pid);
    expect(result.revokedLeaseId).toBe(leaseId);
    expect(result.aborted).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(revokedCallbackLease).toBe(leaseId);
    expect(haltCallbackCalled).toBe(true);
    expect(isAuthorityLeaseRevoked(leaseId)).toBe(true);
    expect(exitInfo.signal === "SIGTERM" || exitInfo.code !== 0).toBe(true);

    // OCEL event must record actuation_halted, killed_pid, and revoked_lease_id
    const attrMap = new Map(result.event.attributes.map((a) => [a.name, a.value]));
    expect(attrMap.get("actuation_halted")).toBe("true");
    expect(attrMap.get("killed_pid")).toBe(String(child.pid));
    expect(attrMap.get("revoked_lease_id")).toBe(leaseId);

    // Subsequent BRCE DO-gate check with the revoked lease must fail closed
    expect(() =>
      verifyBrceDoGate({
        seal: makeValidAs01Seal({ leaseId }),
        nowMs: Date.parse("2026-11-21T12:00:00.000Z")
      })
    ).toThrow(ComplianceRefusalError);
  });
});

import { describe, expect, test } from "bun:test";
import {
  qualifyPermissionStanding,
  replayPermissionStanding,
  type PermissionObservation,
  type PermissionSubject
} from "../src/permission-standing.ts";

const subject: PermissionSubject = {
  repository: "seanchatmangpt/zcode-cli",
  baseSha: "e561c4c0f2cdb6202f3cbcabfcabd82f8c2b619c",
  workerId: "xaas:zcode:worker-1",
  epochId: "7f0e0c5e-4b1a-4c9d-8e2f-1a2b3c4d5e6f"
};

const observation: PermissionObservation = {
  observer: "permission-court/1",
  producer: "zcode-gall-work/1",
  repository: subject.repository,
  baseSha: subject.baseSha,
  argv: ["vendor/zcode.cjs", "--prompt", "work", "--cwd", "/tmp/work", "--mode", "yolo", "--output-format", "stream-json"],
  requestedAuthority: "CONSTRUCT",
  observedMode: "yolo"
};

describe("permission standing court", () => {
  test("absence of independent evidence preserves UNKNOWN", () => {
    const receipt = qualifyPermissionStanding(subject);
    expect(receipt.state).toBe("UNKNOWN");
    expect(receipt.reason).toBe("independent_observation_missing");
    expect(receipt.authorityCeiling).toBe("CONSTRUCT");
  });

  test("exact independent yolo construction is ADMITTED and replay-stable", () => {
    const receipt = qualifyPermissionStanding(subject, observation);
    expect(receipt.state).toBe("ADMITTED");
    expect(receipt.reason).toBe("exact_subject_independent_yolo_construct");
    expect(receipt.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(replayPermissionStanding(receipt, observation)).toBe(true);
  });

  test.each([
    ["cross repository", { repository: "other/repo" }, "cross_repository_evidence"],
    ["stale sha", { baseSha: "a".repeat(40) }, "stale_or_cross_subject_sha"],
    ["self attestation", { observer: observation.producer }, "self_attestation"],
    ["authority laundering", { requestedAuthority: "DO" as const }, "authority_laundering"],
    ["non-yolo mode", { argv: ["zcode.cjs", "--mode", "build"] }, "mode_not_yolo"],
    ["duplicate mode", { argv: ["zcode.cjs", "--mode", "yolo", "--mode", "yolo"] }, "mode_not_uniquely_bound"],
    ["observation divergence", { observedMode: "build" }, "argv_observation_divergence"]
  ])("REFUSED: %s", (_name, patch, reason) => {
    const receipt = qualifyPermissionStanding(subject, { ...observation, ...patch });
    expect(receipt.state).toBe("REFUSED");
    expect(receipt.reason).toContain(reason);
  });

  test("receipt mutation and evidence drift fail replay", () => {
    const receipt = qualifyPermissionStanding(subject, observation);
    expect(replayPermissionStanding({ ...receipt, state: "UNKNOWN" }, observation)).toBe(false);
    expect(replayPermissionStanding(receipt, { ...observation, argv: [...observation.argv, "--verbose"] })).toBe(false);
  });

  test("canonical evidence digest ignores object insertion order", () => {
    const reordered: PermissionObservation = {
      requestedAuthority: observation.requestedAuthority,
      argv: observation.argv,
      baseSha: observation.baseSha,
      repository: observation.repository,
      producer: observation.producer,
      observer: observation.observer,
      observedMode: observation.observedMode
    };
    expect(qualifyPermissionStanding(subject, reordered)).toEqual(
      qualifyPermissionStanding(subject, observation)
    );
  });
});

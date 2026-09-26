import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { admitObservation, digest } from "../src/equilibrium-court.ts";

const repo = "seanchatmangpt/zcode-cli";
const base = "cf1faecba9ea9583f390b334a86369ada7c5f974";
const subject = repo + "@" + base + "#src/evidence-cli.ts";
const d = (c: string) => "sha256:" + c.repeat(64);

function observation(overrides: Record<string, unknown> = {}) {
  return {
    repository_identity: repo,
    base_sha: base,
    exact_subject: subject,
    evidence_digest: d("1"),
    provenance: "artifact://court/evidence.json",
    falsifier_digest: d("2"),
    authority: "none" as const,
    ...overrides
  };
}

describe("Chatman Equilibrium exact-subject court", () => {
  test("canonical TTL participates in the executable qualification vocabulary", () => {
    const ttl = readFileSync(new URL("../docs/equilibrium-v26.9.25.ttl", import.meta.url), "utf8");
    for (const term of ["UNKNOWN", "ADMITTED", "REFUSED", "exactSubject", "evidenceDigest", "falsifierDigest", "authority", "receiptDigest"]) {
      expect(ttl).toContain("ce:" + term);
    }
  });

  test("admits only immutable exact-subject evidence with falsifier and provenance", () => {
    expect(admitObservation(observation())).toBe("ADMITTED");
    expect(admitObservation(observation({ exact_subject: repo + "@main#src/evidence-cli.ts" }))).toBe("REFUSED");
    expect(admitObservation(observation({ exact_subject: repo + "@" + "b".repeat(40) + "#src/evidence-cli.ts" }))).toBe("REFUSED");
    expect(admitObservation(observation({ exact_subject: "other/repo@" + base + "#src/evidence-cli.ts" }))).toBe("REFUSED");
    expect(admitObservation(observation({ provenance: "relative/path.json" }))).toBe("REFUSED");
  });

  test("UNKNOWN is preserved for absent or malformed evidence rather than promoted", () => {
    expect(admitObservation(observation({ evidence_digest: "" }))).toBe("UNKNOWN");
    expect(admitObservation(observation({ falsifier_digest: "sha256:bad" }))).toBe("UNKNOWN");
    expect(admitObservation(observation({ base_sha: "main" }))).toBe("UNKNOWN");
  });

  test("authority laundering refuses and deterministic digest replay is stable", () => {
    expect(admitObservation(observation({ authority: "do" }))).toBe("REFUSED");
    const a = digest(observation());
    const b = digest({ ...observation() });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});

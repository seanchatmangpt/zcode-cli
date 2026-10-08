import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { verifyEvidenceBundle } from "../src/evidence-cli.ts";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const exactSubject = "src/zoom.ts#restoreZoom";

function validBundle(): Record<string, unknown> {
  return {
    schema: "zcode.poly-evidence/1",
    repository_identity: "seanchatmangpt/zcode-cli",
    base_sha: "a".repeat(40),
    exact_subject: exactSubject,
    evidence: [
      {
        id: "E-before",
        kind: "image",
        digest: digest("1"),
        provenance: "artifact://before.png",
        subject: exactSubject
      },
      {
        id: "E-trace",
        kind: "ocel",
        digest: digest("2"),
        provenance: "artifact://session.jsonocel",
        subject: exactSubject
      }
    ],
    derivations: [
      { id: "C-1", stage: "constraint", digest: digest("3"), producer: "pixel-diff", subject: exactSubject },
      { id: "H-1", stage: "hypothesis", digest: digest("4"), producer: "planner", subject: exactSubject },
      { id: "V-1", stage: "verification", digest: digest("5"), producer: "bun-test", subject: exactSubject },
      { id: "A-1", stage: "construction", digest: digest("6"), producer: "ggen", subject: exactSubject }
    ],
    edges: [
      { from: "E-before", to: "C-1", relation: "constrains" },
      { from: "E-trace", to: "C-1", relation: "constrains" },
      { from: "C-1", to: "H-1", relation: "supports" },
      { from: "H-1", to: "V-1", relation: "verified_by" },
      { from: "V-1", to: "A-1", relation: "admits" }
    ],
    claims: [
      { evidence_id: "E-before", construction_id: "A-1" },
      { evidence_id: "E-trace", construction_id: "A-1" }
    ]
  };
}

function writeBundle(name: string, bundle: unknown): string {
  const path = join(process.env.TMPDIR ?? "/tmp", `zcode-${process.pid}-${name}.json`);
  writeFileSync(path, JSON.stringify(bundle), "utf8");
  return path;
}

describe("poly-evidence admission", () => {
  test("admits evidence only when a complete causal path reaches construction", () => {
    const receipt = verifyEvidenceBundle(writeBundle("valid", validBundle()));
    expect(receipt.standing).toBe("ADMITTED");
    expect(receipt.proof_scope).toBe("evidence-integration");
    expect(receipt.authority).toBe("none");
    expect(receipt.external_do_count).toBe(0);
    expect(receipt.admitted_claims[0]?.path).toEqual(["E-before", "C-1", "H-1", "V-1", "A-1"]);
    expect(receipt.admitted_claims[1]?.path).toEqual(["E-trace", "C-1", "H-1", "V-1", "A-1"]);
    expect(receipt.bundle_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.receipt_digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  test("refuses a claim when verification does not reach construction", () => {
    const bundle = validBundle();
    bundle.edges = (bundle.edges as unknown[]).filter((edge) => (edge as { relation?: string }).relation !== "admits");
    expect(() => verifyEvidenceBundle(writeBundle("missing-edge", bundle))).toThrow(
      "no admitted causal path E-before -> A-1"
    );
  });

  test("refuses evidence from a different exact subject", () => {
    const bundle = validBundle();
    const evidence = bundle.evidence as Array<Record<string, unknown>>;
    evidence[0] = { ...evidence[0], subject: "src/other.ts#fn" };
    expect(() => verifyEvidenceBundle(writeBundle("wrong-subject", bundle))).toThrow(
      "subject does not match exact_subject"
    );
  });

  test("refuses stage skipping even when all referenced nodes exist", () => {
    const bundle = validBundle();
    bundle.edges = [
      { from: "E-before", to: "H-1", relation: "supports" },
      ...(bundle.edges as unknown[]).slice(2)
    ];
    expect(() => verifyEvidenceBundle(writeBundle("stage-skip", bundle))).toThrow(
      "is not an admitted transition"
    );
  });
});

import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
    .join(",") + "}";
}

function digest(value: Json): string {
  return "sha256:" + createHash("sha256").update(canonical(value)).digest("hex");
}

function withDigest<T extends Record<string, Json>>(value: T, field: string): T {
  return { ...value, [field]: digest(value) };
}

function bundle(root: string): { composition: string } {
  mkdirSync(root, { recursive: true });
  const manifestBase: Record<string, Json> = {
    schema: "autofde.gall.composition/v26.9.18",
    receipts: [
      { checkpoint: "GALL-001", repository: "seanchatmangpt/ggen", repo_sha: "1".repeat(40), path: "g1.json", receipt_digest: "sha256:" + "1".repeat(64) },
      { checkpoint: "GALL-002", repository: "seanchatmangpt/ggen_igniter", repo_sha: "2".repeat(40), path: "g2.json", receipt_digest: "sha256:" + "2".repeat(64) },
      { checkpoint: "GALL-003", repository: "seanchatmangpt/ash_a2a", repo_sha: "3".repeat(40), path: "g3.json", receipt_digest: "sha256:" + "3".repeat(64) },
      { checkpoint: "GALL-004", repository: "seanchatmangpt/beam4pm", repo_sha: "4".repeat(40), path: "g4.json", receipt_digest: "sha256:" + "4".repeat(64) }
    ],
    autofde_lab_sha: "a".repeat(40),
    planner_identity: "fond-hddl:v26.9.18",
    cmca_identity: "cmca:v26.9.18",
    machine_experience_compiler_identity: "MachineExperienceCompiler:v1",
    corpus_identity: "sha256:" + "c".repeat(64),
    semantic_key: "incident:known"
  };
  const composition = digest(manifestBase);
  writeFileSync(join(root, "gall-composition-manifest.json"), JSON.stringify({
    ...manifestBase,
    composition_digest: composition
  }));

  const experience = withDigest({
    schema: "autofde.gall.machine-experience/v26.9.18",
    semantic_key: "incident:known",
    deterministic_output: { repair: "known" },
    composition_digest: composition,
    rule_fingerprint: "f".repeat(64),
    source_receipts: ["sha256:" + "1".repeat(64)],
    standing: "KNOWN"
  }, "artifact_digest");
  writeFileSync(join(root, "machine-experience.json"), JSON.stringify(experience));

  const episode1 = {
    composition_digest: composition,
    standing: "PARTIAL_ALIVE",
    frontier_resolution_calls: 1,
    llm_allocations: 1,
    planner_invocations: 1
  };
  const episode2 = {
    composition_digest: composition,
    standing: "PARTIAL_ALIVE",
    frontier_resolution_calls: 0,
    llm_allocations: 0,
    planner_invocations: 0,
    machine_experience_hits: 1,
    reflex_executions: 1,
    gate_11: "OPEN",
    gate_12: "PASS"
  };
  writeFileSync(join(root, "episode-1-receipt.json"), JSON.stringify(episode1));
  writeFileSync(join(root, "episode-2-receipt.json"), JSON.stringify(episode2));

  const crownBase: Record<string, Json> = {
    schema: "autofde.gall.crown/v26.9.18",
    composition_digest: composition,
    machine_experience_digest: experience.artifact_digest,
    gates_1_10: "DELEGATED_TO_ADMITTED_RECEIPTS",
    gate_11: "OPEN",
    gate_12: "PASS",
    cross_repo_standing: "PARTIAL_ALIVE"
  };
  writeFileSync(join(root, "gall-005-crown-receipt.json"), JSON.stringify({
    ...crownBase,
    crown_receipt_digest: digest(crownBase)
  }));
  return { composition };
}

async function execute(args: string[], home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "bin/zcode.ts", ...args], {
    cwd: resolve("."),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    code: await proc.exited,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text()
  };
}

describe("GALL-006 fresh consumer", () => {
  test("a clean public zcode subprocess reconstructs Gate 11 without runtime or DO", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-gall006-"));
    const home = join(root, "fresh-home");
    mkdirSync(home);
    const bundleDir = join(root, "bundle");
    const expected = bundle(bundleDir);

    const result = await execute(["gall", "verify", "--bundle", bundleDir, "--json"], home);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const receipt = JSON.parse(result.stdout);
    expect(receipt.composition_digest).toBe(expected.composition);
    expect(receipt.gate_11).toBe("PASS");
    expect(receipt.upstream_gate_12).toBe("PASS");
    expect(receipt.external_do_count).toBe(0);
    expect(receipt.public_interface).toBe("zcode gall verify");
  });

  test("tampered composition is refused by the public subprocess", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-gall006-tamper-"));
    const home = join(root, "fresh-home");
    mkdirSync(home);
    const bundleDir = join(root, "bundle");
    bundle(bundleDir);

    const manifestPath = join(bundleDir, "gall-composition-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.semantic_key = "tampered";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await execute(["gall", "verify", "--bundle", bundleDir, "--json"], home);
    expect(result.code).toBe(1);
    const refusal = JSON.parse(result.stdout);
    expect(refusal.standing).toBe("REFUSED");
    expect(refusal.external_do_count).toBe(0);
  });

  test("missing artifact refuses instead of recovering it from HOME/session state", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-gall006-missing-"));
    const home = join(root, "fresh-home");
    mkdirSync(home);
    const bundleDir = join(root, "bundle");
    bundle(bundleDir);
    Bun.file(join(bundleDir, "machine-experience.json")).delete();

    const result = await execute(["gall", "verify", "--bundle", bundleDir, "--json"], home);
    expect(result.code).toBe(1);
    const refusal = JSON.parse(result.stdout);
    expect(refusal.code).toBe("REFUSED_ARTIFACT");
    expect(refusal.external_do_count).toBe(0);
  });

  test("portable GALL-005 artifact is consumed directly without producer runtime", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-gall006-portable-"));
    const home = join(root, "fresh-home");
    mkdirSync(home);
    const artifactPath = join(root, "gall-005-portable.json");

    const base: Record<string, Json> = {
      schema: "https://autofde.dev/gall/composition/v1",
      release_id: "v26.9.18",
      composition_digest: "sha256:" + "d".repeat(64),
      work_order_digest: "sha256:" + "f".repeat(64),
      standing: "PARTIAL_ALIVE",
      authority: "none",
      checkpoints: [1, 2, 3, 4].map((index) => ({
        checkpoint_id: `GALL-${String(index).padStart(3, "0")}`,
        repository: `repo-${index}`,
        exact_sha: String(index).repeat(40),
        receipt_digest: "sha256:" + String(index).repeat(64),
        standing: "PARTIAL_ALIVE",
        evidence_class: "local_test",
        work_order_digest: "sha256:" + String(index).repeat(64)
      }))
    };
    writeFileSync(artifactPath, JSON.stringify({ ...base, artifact_digest: digest(base) }));

    const result = await execute(["gall", "verify", "--artifact", artifactPath, "--json"], home);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const receipt = JSON.parse(result.stdout);
    expect(receipt.gate_11).toBe("PASS");
    expect(receipt.external_do_count).toBe(0);
    expect(receipt.source_standing).toBe("PARTIAL_ALIVE");
    expect(receipt.upstream_gate_12).toBe("PORTABLE_GALL_005_ARTIFACT");
  });

  test("tampered portable artifact is refused without fallback to bundle or runtime", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-gall006-portable-tamper-"));
    const home = join(root, "fresh-home");
    mkdirSync(home);
    const artifactPath = join(root, "gall-005-portable.json");

    const base: Record<string, Json> = {
      schema: "https://autofde.dev/gall/composition/v1",
      release_id: "v26.9.18",
      composition_digest: "sha256:" + "d".repeat(64),
      work_order_digest: "",
      standing: "PARTIAL_ALIVE",
      authority: "none",
      checkpoints: [1, 2, 3, 4].map((index) => ({
        checkpoint_id: `GALL-${String(index).padStart(3, "0")}`,
        repository: `repo-${index}`,
        exact_sha: String(index).repeat(40),
        receipt_digest: "sha256:" + String(index).repeat(64),
        standing: "PARTIAL_ALIVE",
        evidence_class: "local_test",
        work_order_digest: ""
      }))
    };
    const artifact = { ...base, artifact_digest: digest(base) };
    artifact.standing = "ALIVE";
    writeFileSync(artifactPath, JSON.stringify(artifact));

    const result = await execute(["gall", "verify", "--artifact", artifactPath, "--json"], home);
    expect(result.code).toBe(1);
    const refusal = JSON.parse(result.stdout);
    expect(refusal.standing).toBe("REFUSED");
    expect(refusal.external_do_count).toBe(0);
  });
});


  test("portable receipt identity is independent of artifact filesystem location", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-gall006-path-stable-"));
    const home = join(root, "fresh-home");
    mkdirSync(home);
    const base: Record<string, Json> = {
      schema: "https://autofde.dev/gall/composition/v1",
      release_id: "v26.9.18",
      composition_digest: "sha256:" + "d".repeat(64),
      work_order_digest: "sha256:" + "f".repeat(64),
      standing: "PARTIAL_ALIVE",
      authority: "none",
      checkpoints: [1, 2, 3, 4].map((index) => ({
        checkpoint_id: `GALL-${String(index).padStart(3, "0")}`,
        repository: `repo-${index}`,
        exact_sha: String(index).repeat(40),
        receipt_digest: "sha256:" + String(index).repeat(64),
        standing: "PARTIAL_ALIVE",
        evidence_class: "local_test",
        work_order_digest: "sha256:" + String(index).repeat(64)
      }))
    };
    const artifact = JSON.stringify({ ...base, artifact_digest: digest(base) });
    const left = join(root, "left.json");
    const rightDir = join(root, "nested");
    mkdirSync(rightDir);
    const right = join(rightDir, "right.json");
    writeFileSync(left, artifact);
    writeFileSync(right, artifact);

    const first = await execute(["gall", "verify", "--artifact", left, "--json"], home);
    const second = await execute(["gall", "verify", "--artifact", right, "--json"], home);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(JSON.parse(first.stdout).consumer_receipt_digest)
      .toBe(JSON.parse(second.stdout).consumer_receipt_digest);
  });

// Qualification for OCEL receipt subject/lease identity binding
// (ZCODE-26922-06): a receipt sealed for a gall-work construct turn must
// carry the exact subject_sha (the lease worktree's git HEAD at seal time),
// work_order_iri and epoch_id from the lease, and the lease base_sha. No
// identity is fabricated: the fields appear only when the run carries them.
//
// Real git repos, real recorded runtime fixture lines, real files. No mocks.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OcelRecorder,
  leaseIdentityFromEnv,
  startOcelTap,
  subjectHead
} from "../src/ocel-tap.ts";
import { fixtures } from "./support/ocel.ts";

const workOrderIri = "https://w3id.org/chatman/sjira/v26.9.22#ZOCEL-IDENTITY-TEST";
const epochId = "7f0e0c5e-4b1a-4c9d-8e2f-1a2b3c4d5e6f";
const baseSha = "a".repeat(40);

function makeLeaseRepo(): { path: string; head: string } {
  const path = mkdtempSync(join(tmpdir(), "ocel-identity-lease-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "ocel-identity-test",
    GIT_AUTHOR_EMAIL: "ocel-identity@xaas.local",
    GIT_COMMITTER_NAME: "ocel-identity-test",
    GIT_COMMITTER_EMAIL: "ocel-identity@xaas.local"
  };
  const git = (args: string[]): void => {
    const result = Bun.spawnSync(["git", ...args], { cwd: path, env, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  };
  git(["init", "-b", "main"]);
  writeFileSync(join(path, "base.txt"), "base\n");
  git(["add", "base.txt"]);
  git(["commit", "-m", "base"]);
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: path, stdout: "pipe" }).stdout.toString().trim();
  return { path, head };
}

describe("lease identity resolution", () => {
  test("binds nothing without the worker marker", () => {
    expect(leaseIdentityFromEnv({})).toEqual({});
    expect(leaseIdentityFromEnv({ XAAS_LEASE_CWD: "/tmp" })).toEqual({});
  });

  test("resolves identity variables when XAAS_WORKER=1", () => {
    expect(leaseIdentityFromEnv({
      XAAS_WORKER: "1",
      XAAS_LEASE_CWD: "/lease",
      XAAS_WORK_ORDER_IRI: workOrderIri,
      XAAS_EPOCH_ID: epochId,
      XAAS_BASE_SHA: baseSha
    })).toEqual({ subjectCwd: "/lease", workOrderIri, epochId, baseSha });
  });

  test("subjectHead resolves the exact git head and refuses non-repos", () => {
    const repo = makeLeaseRepo();
    try {
      expect(subjectHead(repo.path)).toBe(repo.head);
      expect(subjectHead(join(tmpdir()))).toBeUndefined();
      expect(subjectHead("/nonexistent-ocel-identity")).toBeUndefined();
      expect(subjectHead(undefined)).toBeUndefined();
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
    }
  });
});

describe("receipt identity binding", () => {
  test("a gall-work identity recorder binds subject_sha, work_order_iri and epoch_id", () => {
    const repo = makeLeaseRepo();
    const dir = mkdtempSync(join(tmpdir(), "ocel-identity-out-"));
    try {
      const identity = leaseIdentityFromEnv({
        XAAS_WORKER: "1",
        XAAS_LEASE_CWD: repo.path,
        XAAS_WORK_ORDER_IRI: workOrderIri,
        XAAS_EPOCH_ID: epochId,
        XAAS_BASE_SHA: baseSha
      });
      const rec = new OcelRecorder("zcode_stream", dir, identity);
      rec.write(fixtures()[0].lines.join("\n") + "\n");
      const out = rec.finish();
      const receipt = JSON.parse(readFileSync(out.receiptPath, "utf8")) as Record<string, unknown>;
      // The binding under test: the receipt names the exact subject head and
      // the exact lease identity.
      expect(receipt.subject_sha).toBe(repo.head);
      expect(receipt.work_order_iri).toBe(workOrderIri);
      expect(receipt.epoch_id).toBe(epochId);
      expect(receipt.base_sha).toBe(baseSha);
      // The pre-existing receipt contract is intact.
      expect(receipt.chain_intact).toBe(true);
      expect(existsSync(out.ocelPath)).toBe(true);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a receipt without identity binds no identity fields (nothing fabricated)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocel-identity-plain-"));
    try {
      const rec = new OcelRecorder("zcode_stream", dir);
      rec.write(fixtures()[0].lines.join("\n") + "\n");
      const out = rec.finish();
      const receipt = JSON.parse(readFileSync(out.receiptPath, "utf8")) as Record<string, unknown>;
      expect("subject_sha" in receipt).toBe(false);
      expect("work_order_iri" in receipt).toBe(false);
      expect("epoch_id" in receipt).toBe(false);
      expect("base_sha" in receipt).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("startOcelTap carries worker identity into the recorder", () => {
    const repo = makeLeaseRepo();
    const dir = mkdtempSync(join(tmpdir(), "ocel-identity-tap-"));
    try {
      const rec = startOcelTap(["-p", "x", "--output-format", "stream-json"], {
        ZCODE_OCEL: "1",
        ZCODE_OCEL_DIR: dir,
        XAAS_WORKER: "1",
        XAAS_LEASE_CWD: repo.path,
        XAAS_WORK_ORDER_IRI: workOrderIri,
        XAAS_EPOCH_ID: epochId
      })!;
      rec.write(fixtures()[0].lines.join("\n") + "\n");
      const out = rec.finish();
      const receipt = JSON.parse(readFileSync(out.receiptPath, "utf8")) as Record<string, unknown>;
      expect(receipt.subject_sha).toBe(repo.head);
      expect(receipt.work_order_iri).toBe(workOrderIri);
      expect(receipt.epoch_id).toBe(epochId);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

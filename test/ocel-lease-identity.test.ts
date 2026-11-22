// Qualification for OCEL receipt subject/lease identity binding
// (ZCODE-26922-06) and object-centric promotion (Explore 21cd2acc):
// a receipt sealed for a gall-work construct turn must carry the exact
// subject_sha (the lease worktree's git HEAD at seal time), work_order_iri
// and epoch_id from the lease, and the lease base_sha. The paired .jsonocel
// must also expose those as E2O objects: work_order id = IRI (not wo:epoch),
// plus distinct epoch:/subj:/base: objects. No identity is fabricated.
//
// Real git repos, real recorded runtime fixture lines, real files. No mocks.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GALL_WORK_SOURCE,
  OcelRecorder,
  bindLeaseIdentityObjects,
  closeLeaseIdentityGraph,
  leaseIdentityFromEnv,
  leaseIdentityObjectIds,
  startOcelTap,
  subjectHead
} from "../src/ocel-tap.ts";
import type { OcelDoc } from "../src/generated/ocel.ts";
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

function objectsByType(doc: {
  objects: Array<{ id: string; type: string }>;
}): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const o of doc.objects) {
    const list = map.get(o.type) ?? [];
    list.push(o.id);
    map.set(o.type, list);
  }
  return map;
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

  test("leaseIdentityObjectIds use IRI + namespaced epoch/subject/base (never wo:epoch)", () => {
    const ids = leaseIdentityObjectIds(
      { workOrderIri, epochId, baseSha, subjectCwd: "/unused" },
      "b".repeat(40)
    );
    expect(ids).toEqual({
      work_order_iri: workOrderIri,
      epoch: `epoch:${epochId}`,
      subject: `subj:${"b".repeat(40)}`,
      base: `base:${baseSha}`
    });
    expect(Object.values(ids).some((v) => v.startsWith("wo:"))).toBe(false);
  });

  test("bindLeaseIdentityObjects merges identity fields without fabricating", () => {
    expect(bindLeaseIdentityObjects({ type: "session.created" }, {})).toEqual({ type: "session.created" });
    expect(
      bindLeaseIdentityObjects({ type: "session.created", sessionId: "s1" }, { workOrderIri, epochId }, undefined)
    ).toEqual({
      type: "session.created",
      sessionId: "s1",
      work_order_iri: workOrderIri,
      epoch: `epoch:${epochId}`
    });
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
      // Dual witness: OCEL pi_hash intact + ALOOP seal; standing alive on OCEL ok.
      expect(receipt.chain_intact).toBe(true);
      expect(receipt.receipt_chain_intact).toBe(true);
      expect((receipt.chain as { standing: string }[]).at(-1)?.standing).toBe("alive");
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

describe("OCEL object promotion (stream + gall E2O)", () => {
  test("stream source promotes IRI/epoch/subject/base as distinct objects", () => {
    const repo = makeLeaseRepo();
    const dir = mkdtempSync(join(tmpdir(), "ocel-identity-objs-"));
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
      const doc = JSON.parse(readFileSync(out.ocelPath, "utf8")) as {
        objects: Array<{ id: string; type: string }>;
        events: Array<{ relationships: Array<{ objectId: string; qualifier: string }> }>;
      };
      const byType = objectsByType(doc);
      expect(byType.get("work_order")).toEqual([workOrderIri]);
      expect(byType.get("epoch")).toEqual([`epoch:${epochId}`]);
      expect(byType.get("subject")).toEqual([`subj:${repo.head}`]);
      expect(byType.get("base")).toEqual([`base:${baseSha}`]);
      // No wo:epoch surrogate object.
      expect(doc.objects.some((o) => o.id.startsWith("wo:"))).toBe(false);
      // At least one event E2O-links the work order IRI.
      expect(
        doc.events.some((e) => e.relationships.some((r) => r.objectId === workOrderIri && r.qualifier === "subject"))
      ).toBe(true);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("gall_work source promotes identity + lease objects (not wo:epoch)", () => {
    const repo = makeLeaseRepo();
    const dir = mkdtempSync(join(tmpdir(), "ocel-identity-gall-"));
    const leaseToken = "lease-token-identity-test";
    try {
      const identity = leaseIdentityFromEnv({
        XAAS_WORKER: "1",
        XAAS_LEASE_CWD: repo.path,
        XAAS_WORK_ORDER_IRI: workOrderIri,
        XAAS_EPOCH_ID: epochId,
        XAAS_BASE_SHA: baseSha
      });
      const rec = new OcelRecorder(GALL_WORK_SOURCE, dir, identity);
      rec.feed({
        event: "worker.claim",
        id: "worker.claim#1",
        ts: new Date().toISOString(),
        sessionId: `gall-work-${epochId}`,
        provider: "zcode",
        worker: "worker-1",
        lease: leaseToken
      });
      const out = rec.finish();
      const doc = JSON.parse(readFileSync(out.ocelPath, "utf8")) as {
        objects: Array<{ id: string; type: string }>;
        events: Array<{ type: string; relationships: Array<{ objectId: string; qualifier: string }> }>;
      };
      const byType = objectsByType(doc);
      // Object inventory (Explore 21cd2acc): IRI work_order + namespaced ids + lease.
      expect(byType.get("work_order")).toEqual([workOrderIri]);
      expect(byType.get("epoch")).toEqual([`epoch:${epochId}`]);
      expect(byType.get("subject")).toEqual([`subj:${repo.head}`]);
      expect(byType.get("base")).toEqual([`base:${baseSha}`]);
      expect(byType.get("lease")).toEqual([leaseToken]);
      expect(byType.get("provider")).toEqual(["zcode"]);
      expect(byType.get("worker")).toEqual(["worker-1"]);
      expect(doc.objects.some((o) => o.id.startsWith("wo:"))).toBe(false);
      expect(doc.events[0]?.type).toBe("worker_claim");
      const quals = new Set(doc.events[0]?.relationships.map((r) => r.qualifier) ?? []);
      expect(quals.has("subject")).toBe(true); // work_order
      expect(quals.has("on_epoch")).toBe(true);
      expect(quals.has("about_subject")).toBe(true);
      expect(quals.has("about_base")).toBe(true);
      expect(quals.has("on_lease")).toBe(true);
      expect(doc.events[0]?.relationships.some((r) => r.objectId === workOrderIri)).toBe(true);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stream without XAAS_WORKER fabricates no identity objects", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocel-identity-none-"));
    try {
      const rec = new OcelRecorder("zcode_stream", dir);
      rec.write(fixtures()[0].lines.join("\n") + "\n");
      const out = rec.finish();
      const doc = JSON.parse(readFileSync(out.ocelPath, "utf8")) as {
        objects: Array<{ id: string; type: string }>;
      };
      const types = new Set(doc.objects.map((o) => o.type));
      expect(types.has("work_order")).toBe(false);
      expect(types.has("epoch")).toBe(false);
      expect(types.has("subject")).toBe(false);
      expect(types.has("base")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sealed log carries non-empty O2O among distinct identity objects", () => {
    const repo = makeLeaseRepo();
    const dir = mkdtempSync(join(tmpdir(), "ocel-identity-o2o-"));
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
      const doc = JSON.parse(readFileSync(out.ocelPath, "utf8")) as {
        objects: Array<{
          id: string;
          type: string;
          attributes: Array<{ name: string; value: string }>;
          relationships: Array<{ objectId: string; qualifier: string }>;
        }>;
      };
      const o2oCount = doc.objects.reduce((n, o) => n + (o.relationships?.length ?? 0), 0);
      expect(o2oCount).toBeGreaterThan(0);
      const wo = doc.objects.find((o) => o.type === "work_order" && o.id === workOrderIri);
      expect(wo).toBeDefined();
      expect(wo!.relationships.some((r) => r.qualifier === "of_epoch" && r.objectId === `epoch:${epochId}`)).toBe(true);
      expect(wo!.relationships.some((r) => r.qualifier === "of_subject" && r.objectId === `subj:${repo.head}`)).toBe(true);
      const subject = doc.objects.find((o) => o.type === "subject");
      expect(subject?.relationships.some((r) => r.qualifier === "at_base" && r.objectId === `base:${baseSha}`)).toBe(true);
      const session = doc.objects.find((o) => o.type === "session");
      expect(session?.relationships.some((r) => r.qualifier === "for_work_order" && r.objectId === workOrderIri)).toBe(true);
      // Object attrs carry raw identity facts (not only namespaced ids).
      expect(wo!.attributes.some((a) => a.name === "work_order_iri" && a.value === workOrderIri)).toBe(true);
      expect(subject?.attributes.some((a) => a.name === "subject_sha" && a.value === repo.head)).toBe(true);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("closeLeaseIdentityGraph is a no-op without identity", () => {
    const empty: OcelDoc = {
      objectTypes: [],
      eventTypes: [],
      objects: [{ id: "s1", type: "session", attributes: [], relationships: [] }],
      events: []
    };
    expect(closeLeaseIdentityGraph(empty, {})).toEqual(empty);
  });

  test("bindLeaseIdentityObjects also mirrors facts into params for app-server", () => {
    const bound = bindLeaseIdentityObjects(
      { method: "session/event", params: { type: "session.created", sessionId: "s1" } },
      { workOrderIri, epochId }
    ) as { params: Record<string, unknown>; work_order_iri: string };
    expect(bound.work_order_iri).toBe(workOrderIri);
    expect(bound.params.work_order_iri).toBe(workOrderIri);
    expect(bound.params.epoch).toBe(`epoch:${epochId}`);
  });
});

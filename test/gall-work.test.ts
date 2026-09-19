import { describe, expect, test } from "bun:test";

import { parseGallWorkLease } from "../src/gall-work.ts";

const lease = {
  schema: "gall.work-lease/1",
  checkpoint_iri: "urn:gall:checkpoint:xaas:001",
  graph_digest: "sha256:" + "a".repeat(64),
  epoch_id: "123e4567-e89b-42d3-a456-426614174000",
  worker_id: "zcode-worker-01",
  worktree: "/tmp/gall-worktree"
};

describe("GALL semantic worker lease", () => {
  test("accepts a closed semantic work descriptor", () => {
    expect(parseGallWorkLease(lease)).toEqual(lease);
  });

  test("refuses branch names in place of graph identity", () => {
    expect(() => parseGallWorkLease({ ...lease, graph_digest: "main" })).toThrow(
      "graph_digest"
    );
  });

  test("refuses relative worktrees", () => {
    expect(() => parseGallWorkLease({ ...lease, worktree: "./repo" })).toThrow(
      "absolute path"
    );
  });

  test("refuses arbitrary worker-id shell syntax", () => {
    expect(() => parseGallWorkLease({ ...lease, worker_id: "worker; rm -rf /" })).toThrow(
      "unsupported characters"
    );
  });
});

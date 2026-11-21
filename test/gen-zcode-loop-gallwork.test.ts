// Falsifier: regenerating ontology/zcode-loop.ttl must not drop Source-GallWorkHook.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("gen-zcode-loop preserves GallWorkHook", () => {
  test("draft generator emits Source-GallWorkHook (not vendor-only Stream/App)", () => {
    const src = readFileSync(join(root, "scripts", "gen-zcode-loop.ts"), "utf8");
    expect(src).toContain("emitGallWorkHook");
    expect(src).toContain("Source-GallWorkHook");
    expect(src).toContain('pi:sourceId "gall_work"');
    for (const wire of [
      "provider.select",
      "provider.replace",
      "worker.claim",
      "execution.crash",
      "receipt.persist",
      "falsifier.run",
      "reobserve"
    ]) {
      expect(src).toContain(wire);
    }
  });

  test("committed ontology still carries the gall-work source", () => {
    const ttl = readFileSync(join(root, "ontology", "zcode-loop.ttl"), "utf8");
    expect(ttl).toContain("zl:Source-GallWorkHook");
    expect(ttl).toContain('pi:sourceId "gall_work"');
  });
});

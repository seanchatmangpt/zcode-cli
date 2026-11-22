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

  test("lease identity E2O uses work_order_iri — never work_order_id / wo:epoch", () => {
    const src = readFileSync(join(root, "scripts", "gen-zcode-loop.ts"), "utf8");
    const ttl = readFileSync(join(root, "ontology", "zcode-loop.ttl"), "utf8");
    // Generator source: identity catalog + IRI path (templates emit pi:typeId).
    expect(src).toContain('IDENTITY_OBJECTS = ["work_order", "epoch", "subject", "base"]');
    expect(src).toContain('work_order: "work_order_iri"');
    expect(src).toContain('pi:objectIdPath "work_order_iri"');
    expect(src).not.toContain('pi:objectIdPath "work_order_id"');
    // Committed ontology: concrete individuals (regen via gen-zcode-loop + gen-ocel).
    expect(ttl).toContain('pi:objectIdPath "work_order_iri"');
    expect(ttl).toContain('pi:objectIdPath "params.work_order_iri"'); // App source
    expect(ttl).not.toContain('pi:objectIdPath "work_order_id"');
    expect(ttl).toContain("zl:Rel-Stream-work_order");
    expect(ttl).toContain("zl:Rel-App-work_order");
    expect(ttl).toContain("zl:Rel-Gall-work_order");
    for (const typeId of ["epoch", "subject", "base", "lease", "work_order"]) {
      expect(ttl).toContain(`pi:typeId "${typeId}"`);
    }
  });
});

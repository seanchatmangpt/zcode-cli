// SA2A manifest validation court — .sa2a/manifest.json declares zcode's
// consumer-side SA2A contract; this court pins it to the documented shape.
//
// Real file read, no mocks, per repo bun-test idiom.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const MANIFEST_PATH = join(REPO_ROOT, ".sa2a", "manifest.json");

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<
  string,
  unknown
>;

const EXPECTED_DEPENDS_ON = ["ash_a2a", "graphlaw", "affidavit", "xaas"];

describe(".sa2a/manifest.json", () => {
  test("parses as JSON object", () => {
    expect(typeof manifest).toBe("object");
    expect(manifest).not.toBeNull();
    expect(Array.isArray(manifest)).toBe(false);
  });

  test("schema field is sa2a-diataxis/v1", () => {
    expect(manifest["schema"]).toBe("sa2a-diataxis/v1");
  });

  test("role is runtime", () => {
    expect(manifest["role"]).toBe("runtime");
  });

  test("depends_on is the exact 4-element expected set", () => {
    const deps = manifest["depends_on"];
    expect(Array.isArray(deps)).toBe(true);
    expect(deps).toHaveLength(4);
    expect([...(deps as string[])].sort()).toEqual([...EXPECTED_DEPENDS_ON].sort());
  });

  test("each dependency name appears in the fleet (documented expectation)", () => {
    const fleetRepos = [
      "ash_a2a",
      "ash_graphlaw",
      "graphlaw",
      "affidavit",
      "xaas",
      "ggen-marketplace",
      "ggen",
    ];
    for (const dep of manifest["depends_on"] as string[]) {
      expect(fleetRepos).toContain(dep);
    }
  });

  test("generator points at the marketplace pack", () => {
    expect(manifest["generator"]).toBe(
      "ggen-marketplace/packs/sa2a-diataxis-pack",
    );
  });
});

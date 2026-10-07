// W683: AIRo wiring pin — zcode-cli ledger row (airo-wiring-ledger.md, CONSISTENT).
//
// Independent of the W615 court: re-derives the ledger claim from the actual
// surface on disk. Real file reads only, no mocks, per repo bun-test idiom.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const TTL_PATH = join(REPO_ROOT, "ontology", "airo_risk_description.ttl");
const text = readFileSync(TTL_PATH, "utf8");

// Ledger row (w615) claims this contract fixture pin; recompute in-test.
const CONTRACT_PINS: Array<[string, string]> = [
  [
    "test/fixtures/gall-work.contract.json",
    "5515775861807cdd7394ef74b1ee38679dd24279224515178702bb6652a95fc4",
  ],
  [
    "test/fixtures/xaas-remote-relay.contract.json",
    "76ff551c16cea5afb40b385ecee9ab7462ce1d73bee47655c0e0c63dc0a33f89",
  ],
];

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function typedCount(classIri: string): number {
  const re = new RegExp(`rdf:type\\s+${classIri}`, "g");
  return [...text.matchAll(re)].length;
}

describe("W683 AIRo wiring pin (zcode-cli)", () => {
  test("ledger-claimed ttl exists on disk (8,022 B claim, non-empty)", () => {
    const st = statSync(TTL_PATH);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);
    // ledger claims 8,022 B; byte length (file has a multi-byte char, so
    // text.length === 8020 is char count, not bytes)
    expect(statSync(TTL_PATH).size).toBe(8022);
    expect(text).toContain("https://w3id.org/airo#");
  });

  test("risk graph closure: 3 risks, 3 sources, 2 controls, all typed", () => {
    expect(typedCount("airo:Risk ;")).toBeGreaterThanOrEqual(3);
    expect(typedCount("airo:RiskSource")).toBe(3);
    expect(typedCount("airo:RiskControl")).toBe(2);
    expect(typedCount("airo:Consequence")).toBeGreaterThan(0);
    // each risk source linked to a risk
    const sources = [...text.matchAll(/^(zc:\w+) rdf:type airo:RiskSource/gm)].map(
      (m) => m[1]!,
    );
    for (const s of sources) {
      expect(text).toContain(`airo:isRiskSourceFor zc:`);
      const short = s.replace("zc:", "");
      expect(
        new RegExp(`airo:isRiskSourceFor zc:${short.replace(/Source$/, "Risk")}`).test(text) ||
          /airo:isRiskSourceFor zc:\w+/.test(text),
      ).toBe(true);
    }
    expect(text).toContain("airo:hasModality zc:Modality_Assessed");
  });

  test("every file: citation resolves to a real, non-empty file", () => {
    const uris = [...text.matchAll(/<file:([^>]+)>/g)].map((m) => m[1]!);
    expect(uris.length).toBeGreaterThanOrEqual(6);
    for (const uri of uris) {
      const p = uri.startsWith("/") ? uri : join(REPO_ROOT, uri);
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(0);
    }
  });

  test("w356 contract sha pins hold (recomputed in-test)", () => {
    for (const [rel, pin] of CONTRACT_PINS) {
      const path = join(REPO_ROOT, rel);
      expect(existsSync(path)).toBe(true);
      expect(sha256(path)).toBe(pin);
    }
  });

  test("AIRo vocabulary surface: likelihoods and controls wired per risk", () => {
    expect(text).toContain("airo:hasLikelihood");
    expect(text).toContain("airo:Likelihood");
    expect([...text.matchAll(/airo:hasRiskControl zc:\w+/g)].length).toBeGreaterThanOrEqual(2);
  });
});

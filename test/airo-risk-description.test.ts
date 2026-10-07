// W615: the zcode-cli AIRo risk description stays grounded and contract-shas hold.
//
// Lane W615, AIRo wiring wave. Validates ontology/airo_risk_description.ttl
// (structural check per the repo's bun test idiom) and recomputes the w356
// contract sha pins so drift fails a test.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const TTL_PATH = join(REPO_ROOT, "ontology", "airo_risk_description.ttl");

// w356 receipt pins (recomputed 2026-10-06, shasum -a 256)
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

describe("W615 airo risk description", () => {
  test("ttl exists with airo/dcterms/rdfs/xsd prefixes", () => {
    const text = readFileSync(TTL_PATH, "utf8");
    for (const prefix of ["airo:", "dcterms:", "rdfs:", "xsd:"]) {
      expect(text).toContain(`@prefix ${prefix}`);
    }
    expect(text).toContain("https://w3id.org/airo#");
  });

  test("every file: citation is a real path on disk", () => {
    const text = readFileSync(TTL_PATH, "utf8");
    const uris = [...text.matchAll(/<file:([^>]+)>/g)].map((m) => m[1]!);
    expect(uris.length).toBeGreaterThan(0);
    const missing = uris.filter((uri) => {
      const p = uri.startsWith("/")
        ? uri
        : join(REPO_ROOT, uri);
      return !existsSync(p);
    });
    expect(missing).toEqual([]);
  });

  test("ttl structure: AISystem, risks, sources, controls present", () => {
    const text = readFileSync(TTL_PATH, "utf8");
    expect(text).toContain("airo:AISystem");
    expect(text).toContain("airo:Risk");
    expect(text).toContain("airo:RiskSource");
    expect(text).toContain("airo:RiskControl");
    expect(text).toContain("airo:isRiskSourceFor");
    expect(text).toContain("airo:mitigatesRiskConcept");
    expect(text).toContain("airo:hasConsequence");
    expect(text).toContain("airo:hasLikelihood");
    // every risk source typed and linked
    const sources = [...text.matchAll(/^(zc:\w+) rdf:type airo:RiskSource/gm)].length;
    expect(sources).toBe(3);
    const links = [...text.matchAll(/airo:isRiskSourceFor zc:\w+/g)].length;
    expect(links).toBeGreaterThanOrEqual(3);
  });

  test("w356 contract sha pins hold", () => {
    for (const [rel, pin] of CONTRACT_PINS) {
      const path = join(REPO_ROOT, rel);
      expect(existsSync(path)).toBe(true);
      expect(sha256(path)).toBe(pin);
    }
  });
});

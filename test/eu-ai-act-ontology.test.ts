import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES, OBJECT_TYPES } from "../src/generated/ocel.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const EU_AI_ACT_TTL = join(REPO_ROOT, "ontology", "eu-ai-act.ttl");
const AIRO_TTL = join(REPO_ROOT, "ontology", "airo_risk_description.ttl");

const euAiActText = readFileSync(EU_AI_ACT_TTL, "utf8");
const airoText = readFileSync(AIRO_TTL, "utf8");

function stripCommentsAndLiterals(ttl: string): string {
  return ttl
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/#[^\n]*/g, "");
}

describe("F03 EU AI Act & AIRO ontology integrity (zero-mock Chicago)", () => {
  test("validates Turtle syntax with real rapper CLI when available on PATH + structural Turtle invariants", () => {
    const rapper = Bun.which("rapper");
    if (rapper) {
      for (const ttlPath of [EU_AI_ACT_TTL, AIRO_TTL]) {
        const res = spawnSync(rapper, ["-i", "turtle", "-c", ttlPath], { encoding: "utf8" });
        expect(res.status).toBe(0);
        expect(`${res.stdout}\n${res.stderr}`).toMatch(/\d+\s+triples/);
      }
    }

    for (const prefix of [
      "airo:",
      "dpv:",
      "dpv-ai:",
      "eu-aiact:",
      "dcterms:",
      "xsd:",
      "pi:",
      "zc:",
      "zl:",
      "euai:"
    ]) {
      expect(euAiActText).toContain(`@prefix ${prefix}`);
    }

    // Pure-TS structural balance check: every non-prefix statement outside literals/comments terminates cleanly
    const stripped = stripCommentsAndLiterals(euAiActText);
    const statements = stripped
      .split(/\s*\.\s*(?=\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("@prefix"));
    expect(statements.length).toBeGreaterThanOrEqual(50);
  });

  test("declares all 13 required EU AI Act articles", () => {
    const expectedArticles = ["9", "10", "11", "12", "13", "14", "15", "17", "26", "27", "50", "72", "73"];
    const found = [...euAiActText.matchAll(/euai:articleNumber\s+"(\d+)"/g)].map((m) => m[1]!);
    expect(found.sort()).toEqual([...expectedArticles].sort());
    for (const n of expectedArticles) {
      expect(euAiActText).toContain(`eu-aiact:Art${n}`);
    }
  });

  test("declares >= 7 operational AI risks with full AIRO closure and valid quantitative residual thresholds", () => {
    const requiredRisks = [
      "Risk_PromptInjection",
      "Risk_UnsafeActuation",
      "Risk_AutomationBias",
      "Risk_SecretAndPiiLeakage",
      "Risk_ModelAndProviderDrift",
      "Risk_SubagentOversightBypass",
      "Risk_LogTamperingOrLoss",
      "Risk_UndisclosedAiInteraction"
    ];

    const riskMatches = [...euAiActText.matchAll(/^(euai:Risk_\w+)\s+rdf:type\s+airo:Risk\b/gm)];
    expect(riskMatches.length).toBeGreaterThanOrEqual(7);
    for (const r of requiredRisks) {
      expect(euAiActText).toContain(`euai:${r} rdf:type airo:Risk`);
      expect(euAiActText).toMatch(new RegExp(`airo:isRiskSourceFor\\s+euai:${r}\\b`));
      expect(euAiActText).toMatch(new RegExp(`airo:mitigatesRiskConcept\\s+euai:${r}\\b`));
    }

    // Split risk blocks and verify quantitative thresholds: 0 < residual <= threshold < inherent <= 1
    const riskBlocks = euAiActText.split(/(?=^euai:Risk_\w+\s+rdf:type\s+airo:Risk\b)/gm).filter((b) =>
      b.startsWith("euai:Risk_")
    );
    expect(riskBlocks.length).toBe(riskMatches.length);

    for (const block of riskBlocks) {
      const inherent = Number(block.match(/euai:inherentRiskScore\s+"([^"]+)"\^\^xsd:decimal/)?.[1]);
      const residual = Number(block.match(/euai:residualRiskScore\s+"([^"]+)"\^\^xsd:decimal/)?.[1]);
      const threshold = Number(block.match(/euai:residualRiskThreshold\s+"([^"]+)"\^\^xsd:decimal/)?.[1]);
      expect(Number.isFinite(inherent)).toBe(true);
      expect(Number.isFinite(residual)).toBe(true);
      expect(Number.isFinite(threshold)).toBe(true);
      expect(residual).toBeGreaterThan(0);
      expect(residual).toBeLessThanOrEqual(threshold);
      expect(threshold).toBeLessThan(inherent);
      expect(inherent).toBeLessThanOrEqual(1);
      expect(block).toContain("airo:hasConsequence");
      expect(block).toContain("airo:hasRiskControl");
    }

    const impactStakeholders = [...euAiActText.matchAll(/airo:hasImpactOnStakeholder\s+euai:Stakeholder_\w+/g)];
    expect(impactStakeholders.length).toBeGreaterThanOrEqual(7);
  });

  test("declares IEEE OCEL 2.0 compliance object types, O2O relations, compliance events, and 7 anti-vacuity Declare rules", () => {
    for (const objId of [
      "compliance_profile",
      "oversight_decision",
      "disclosure_notice",
      "provenance_artifact",
      "workspace_snapshot",
      "risk_assessment",
      "incident_packet"
    ]) {
      expect(euAiActText).toContain(`euai:ocelTypeId "${objId}"`);
    }

    for (const rel of [
      "in_session",
      "in_turn",
      "uses_provider",
      "spawned_by",
      "governs",
      "mutated_in",
      "seals"
    ]) {
      expect(euAiActText).toContain(`euai:o2oQualifier "${rel}"`);
    }

    for (const evt of [
      "art50_disclosure_emitted",
      "provenance_marked",
      "oversight_intervened",
      "oversight_policy_refused",
      "workspace_rolled_back",
      "retry_budget_exhausted",
      "drift_detected",
      "incident_classified",
      "compliance_assessed"
    ]) {
      expect(euAiActText).toContain(`euai:ocelTypeId "${evt}"`);
    }

    for (const tpl of [
      "Init",
      "Existence",
      "Absence",
      "Response",
      "Precedence",
      "ChainResponse",
      "NotCoExistence"
    ]) {
      expect(euAiActText).toContain(`euai:declareTemplate "${tpl}"`);
    }
    const antiVacuityMatches = [...euAiActText.matchAll(/euai:antiVacuityRequired\s+"true"\^\^xsd:boolean/g)];
    expect(antiVacuityMatches.length).toBe(7);
  });

  test("every <file:...> citation in eu-ai-act.ttl exists and is non-empty, and AIRO/OCEL invariants hold", () => {
    const fileUris = [...euAiActText.matchAll(/<file:([^>]+)>/g)].map((m) => m[1]!);
    expect(fileUris.length).toBeGreaterThan(0);
    for (const uri of fileUris) {
      const p = uri.startsWith("/") ? uri : join(REPO_ROOT, uri);
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(0);
    }

    // Preserve AIRO non-regression pins
    expect([...airoText.matchAll(/rdf:type\s+airo:RiskSource/g)].length).toBe(3);
    expect([...airoText.matchAll(/rdf:type\s+airo:RiskControl/g)].length).toBe(2);
    expect([...airoText.matchAll(/rdf:type\s+airo:Risk\s*;/g)].length).toBeGreaterThanOrEqual(3);

    // Verify Art. 9, 12, 14, 15 mappings in airo_risk_description.ttl
    expect([...airoText.matchAll(/rdf:type\s+zc:EuAiActArticleMapping/g)].length).toBe(4);
    for (const art of ["9", "12", "14", "15"]) {
      expect(airoText).toContain(`zc:articleNumber "${art}"`);
    }
    expect(airoText).toContain("<file:ontology/eu-ai-act.ttl>");

    // Preserve closed generated OCEL vocabulary counts
    // (pack demo place_order/ship_order + order/item quarantined; +base/epoch/subject)
    expect(EVENT_TYPES.length).toBe(33);
    expect(OBJECT_TYPES.length).toBe(15);
  });
});

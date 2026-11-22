import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENT_TYPES, OBJECT_TYPES } from "../src/generated/ocel.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const EU_AI_ACT_TTL = join(REPO_ROOT, "ontology", "eu-ai-act.ttl");
const EU_AI_ACT_SHAPES_TTL = join(REPO_ROOT, "ontology", "eu-ai-act.shapes.ttl");
const AIRO_TTL = join(REPO_ROOT, "ontology", "airo_risk_description.ttl");

const euAiActText = readFileSync(EU_AI_ACT_TTL, "utf8");
const airoText = readFileSync(AIRO_TTL, "utf8");

function requireTool(name: string): string {
  const found = Bun.which(name);
  if (!found) {
    throw new Error(`Required RDF/SHACL validator '${name}' not found on PATH (fail-closed)`);
  }
  return found;
}

describe("F03 EU AI Act & AIRO ontology integrity (zero-mock Chicago + SHACL)", () => {
  test("validates Turtle syntax with real rapper CLI (fail-closed) for data and SHACL shapes graphs", () => {
    const rapper = requireTool("rapper");
    for (const ttlPath of [EU_AI_ACT_TTL, EU_AI_ACT_SHAPES_TTL, AIRO_TTL]) {
      const res = spawnSync(rapper, ["-i", "turtle", "-c", ttlPath], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(`${res.stdout}\n${res.stderr}`).toMatch(/\d+\s+triples/);
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
  });

  test("passes W3C SHACL validation via pyshacl (fail-closed) and rejects mutated graphs (anti-vacuity)", () => {
    const pyshacl = requireTool("pyshacl");

    // 1. Positive conformance on canonical ontology
    const ok = spawnSync(pyshacl, ["-s", EU_AI_ACT_SHAPES_TTL, EU_AI_ACT_TTL], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("Conforms: True");

    // 2. Anti-vacuity: mutated graphs MUST fail SHACL validation
    const tmpDir = mkdtempSync(join(tmpdir(), "eu-ai-act-shacl-"));
    try {
      // Mutation A: residualRiskScore > residualRiskThreshold
      const badScorePath = join(tmpDir, "bad-score.ttl");
      writeFileSync(
        badScorePath,
        euAiActText.replace('euai:residualRiskScore "0.15"^^xsd:decimal', 'euai:residualRiskScore "0.35"^^xsd:decimal'),
        "utf8"
      );
      const badScoreRes = spawnSync(pyshacl, ["-s", EU_AI_ACT_SHAPES_TTL, badScorePath], { encoding: "utf8" });
      expect(badScoreRes.status).not.toBe(0);
      expect(badScoreRes.stdout).toContain("Conforms: False");

      // Mutation B: binary Declare constraint missing euai:declareTarget
      const badDeclarePath = join(tmpDir, "bad-declare.ttl");
      writeFileSync(
        badDeclarePath,
        euAiActText.replace("    euai:declareTarget euai:OcelEvt_PermissionResolved ;\n", ""),
        "utf8"
      );
      const badDeclareRes = spawnSync(pyshacl, ["-s", EU_AI_ACT_SHAPES_TTL, badDeclarePath], { encoding: "utf8" });
      expect(badDeclareRes.status).not.toBe(0);
      expect(badDeclareRes.stdout).toContain("Conforms: False");

      // Mutation C: ComplianceO2ORelation missing euai:sourceObjectType
      const badO2OPath = join(tmpDir, "bad-o2o.ttl");
      writeFileSync(
        badO2OPath,
        euAiActText.replace("    euai:sourceObjectType euai:OcelObj_Turn ;\n", ""),
        "utf8"
      );
      const badO2ORes = spawnSync(pyshacl, ["-s", EU_AI_ACT_SHAPES_TTL, badO2OPath], { encoding: "utf8" });
      expect(badO2ORes.status).not.toBe(0);
      expect(badO2ORes.stdout).toContain("Conforms: False");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("declares all 13 required EU AI Act articles and eliminates stale M1 targetModule/targetMilestone workarounds", () => {
    const expectedArticles = ["9", "10", "11", "12", "13", "14", "15", "17", "26", "27", "50", "72", "73"];
    const found = [...euAiActText.matchAll(/euai:articleNumber\s+"(\d+)"/g)].map((m) => m[1]!);
    expect(found.sort()).toEqual([...expectedArticles].sort());
    for (const n of expectedArticles) {
      expect(euAiActText).toContain(`eu-aiact:Art${n}`);
    }

    // ELIMINATE: zero stale euai:targetModule or euai:targetMilestone string literals
    expect(euAiActText).not.toContain("euai:targetModule");
    expect(euAiActText).not.toContain("euai:targetMilestone");
  });

  test("declares complete W3C AIRO/DPV system metadata on cli-agent-runtime", () => {
    expect(euAiActText).toContain("airo:hasDomain euai:Domain_SoftwareEngineering");
    expect(euAiActText).toContain("airo:isProvidedBy euai:Provider_ZCodeCli");
    expect(euAiActText).toContain("airo:isDeployedBy euai:Stakeholder_DeployerOperator");
    expect(euAiActText).toContain('airo:hasVersion "3.14.4-1"');
    expect(euAiActText).toContain("eu-aiact:hasRiskLevel eu-aiact:HighRisk");
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

    const impactStakeholders = [...euAiActText.matchAll(/airo:hasImpactOnStakeholder\s+euai:Stakeholder_\w+/g)];
    expect(impactStakeholders.length).toBeGreaterThanOrEqual(7);
  });

  test("declares typed IEEE OCEL 2.0 compliance objects, O2O relations, events, and 7 anti-vacuity Declare rules", () => {
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
    expect([...euAiActText.matchAll(/euai:sourceObjectType\s+euai:OcelObj_\w+/g)].length).toBe(7);
    expect([...euAiActText.matchAll(/euai:targetObjectType\s+euai:OcelObj_\w+/g)].length).toBe(7);

    for (const evt of [
      "art50_disclosure_emitted",
      "provenance_marked",
      "oversight_intervened",
      "oversight_policy_refused",
      "workspace_rolled_back",
      "retry_budget_exhausted",
      "drift_detected",
      "incident_classified",
      "compliance_assessed",
      "receipt_persist",
      "unredacted_secret_detected",
      "permission_requested",
      "permission_resolved",
      "tool_updated",
      "turn_started",
      "turn_completed",
      "turn_failed",
      "high_risk_profile_active",
      "yolo_bypass_enabled"
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
    // Typed event-type IRI bindings (no bare string literals on declareActivator / declareTarget)
    expect(euAiActText).not.toMatch(/euai:declareActivator\s+"/);
    expect(euAiActText).not.toMatch(/euai:declareTarget\s+"/);
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

    // ELIMINATE: zero hardcoded test-count standings in airo_risk_description.ttl
    expect(airoText).not.toMatch(/\d+\s+pass\s*\/\s*\d+\s+fail/i);
    expect(airoText).not.toContain("1072 pass");
    expect(airoText).not.toContain("268359 expect");

    // REDUCE: single unified euai:addressesArticle vocabulary (zero duplicate zc: wrapper nodes)
    expect(airoText).not.toContain("zc:EuAiActArticleMapping");
    expect(airoText).not.toContain("zc:hasEuAiActMapping");
    expect(airoText).not.toContain("zc:articleNumber");
    expect(airoText).not.toContain("zc:mapsTarget");
    expect(airoText).not.toContain("zc:mapsRiskControl");
    for (const artIri of [
      "euai:Art9_RiskManagement",
      "euai:Art12_RecordKeeping",
      "euai:Art14_HumanOversight",
      "euai:Art15_AccuracyRobustnessCybersecurity"
    ]) {
      expect(airoText).toContain(artIri);
    }
    expect(airoText).toContain("euai:addressesArticle");
    expect(airoText).toContain("<file:ontology/eu-ai-act.ttl>");

    // Preserve closed generated OCEL vocabulary counts
    // (pack demo place_order/ship_order + order/item quarantined; +base/epoch/subject)
    expect(EVENT_TYPES.length).toBe(31);
    expect(OBJECT_TYPES.length).toBe(16);
  });
});

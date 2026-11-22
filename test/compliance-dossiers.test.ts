import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkAnnexIvDossier, compileAnnexIvDossier } from "../src/compliance/annex-iv-report.ts";
import { Ocel2ComplianceBuilder, validateOcel2 } from "../src/compliance/ocel2.ts";
import { generateIncidentReportPacket, runPmmAnalysis } from "../src/compliance/pmm-incident.ts";
import {
  exportFriaReport,
  generateEuDeclarationOfConformity,
  runConformityAssessment,
  runDeployerCheck,
  validateQmsManifest
} from "../src/compliance/qms-conformity.ts";
import {
  buildComplianceInfo,
  formatComplianceInfoMarkdown,
  formatRiskRegisterMarkdown,
  loadAiroRiskRegister
} from "../src/compliance/risk-ledger.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function buildHighRiskSessionDoc(
  sessionId: string,
  opts: {
    baseMs?: number;
    ttftMs?: number;
    serviceMs?: number;
    latencyMs?: number;
    providerId?: string;
    modelId?: string;
    includeFailure?: boolean;
  } = {}
) {
  const baseMs = opts.baseMs ?? Date.parse("2026-08-05T10:00:00.000Z");
  const iso = (d: number) => new Date(baseMs + d).toISOString();
  const builder = new Ocel2ComplianceBuilder();
  const turnId = `${sessionId}_t1`;
  const reqId = `${sessionId}_r1`;
  const permId = `${sessionId}_p1`;

  builder.upsertObject(sessionId, "session", { compliance_profile: "high-risk-annex-iii" }, iso(0));
  builder.upsertObject(turnId, "turn", { standing: "ALIVE" }, iso(100));
  builder.upsertObject(
    reqId,
    "model_request",
    {
      provider_id: opts.providerId ?? "zai",
      model_id: opts.modelId ?? "glm-5.3",
      ttft_ms: String(opts.ttftMs ?? 120),
      service_ms: String(opts.serviceMs ?? 3800)
    },
    iso(200)
  );
  builder.upsertObject(permId, "permission", { overseer_id: "overseer-eu", decision: "allow" }, iso(300));
  builder.addO2O(turnId, "in_session", sessionId);

  builder.recordEvent({
    id: `${sessionId}_e1`,
    type: "session_created",
    time: iso(0),
    attributes: { compliance_profile: "high-risk-annex-iii" },
    relationships: [{ objectId: sessionId, qualifier: "in_session" }]
  });
  builder.recordEvent({
    id: `${sessionId}_e2`,
    type: "art50_disclosure_emitted",
    time: iso(50),
    attributes: {
      channel: "stream-json",
      regulation: "EU-2024-1689-Art50",
      provider_id: opts.providerId ?? "zai",
      model_id: opts.modelId ?? "glm-5.3"
    },
    relationships: [{ objectId: sessionId, qualifier: "in_session" }]
  });
  builder.recordEvent({
    id: `${sessionId}_e3`,
    type: "turn_started",
    time: iso(100),
    attributes: {},
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: turnId, qualifier: "in_turn" }
    ]
  });
  builder.recordEvent({
    id: `${sessionId}_e4`,
    type: "permission_requested",
    time: iso(200),
    attributes: { risk_level: "high" },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: turnId, qualifier: "in_turn" },
      { objectId: permId, qualifier: "governs" }
    ]
  });
  builder.recordEvent({
    id: `${sessionId}_e5`,
    type: "permission_resolved",
    time: iso(200 + (opts.latencyMs ?? 1300)),
    attributes: {
      decision: "allow",
      decision_latency_ms: String(opts.latencyMs ?? 1300),
      overseer_id: "overseer-eu"
    },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: turnId, qualifier: "in_turn" },
      { objectId: permId, qualifier: "governs" }
    ]
  });
  builder.recordEvent({
    id: `${sessionId}_e6`,
    type: "model_request_completed",
    time: iso(200 + (opts.latencyMs ?? 1300) + 100),
    attributes: {
      provider_id: opts.providerId ?? "zai",
      model_id: opts.modelId ?? "glm-5.3",
      ttft_ms: String(opts.ttftMs ?? 120),
      service_ms: String(opts.serviceMs ?? 3800),
      status: "ok"
    },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: turnId, qualifier: "in_turn" },
      { objectId: reqId, qualifier: "about_model_request" }
    ]
  });
  builder.recordEvent({
    id: `${sessionId}_e7`,
    type: "tool_updated",
    time: iso(200 + (opts.latencyMs ?? 1300) + 200),
    attributes: { tool_name: "Edit", status: "success" },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: turnId, qualifier: "in_turn" }
    ]
  });
  if (opts.includeFailure) {
    builder.recordEvent({
      id: `${sessionId}_e7b`,
      type: "turn_failed",
      time: iso(200 + (opts.latencyMs ?? 1300) + 250),
      attributes: { error_signature: "ERR_TEST_SYNTAX" },
      relationships: [
        { objectId: sessionId, qualifier: "in_session" },
        { objectId: turnId, qualifier: "in_turn" }
      ]
    });
  }
  builder.recordEvent({
    id: `${sessionId}_e8`,
    type: "turn_completed",
    time: iso(200 + (opts.latencyMs ?? 1300) + 400),
    attributes: { fitness: "1.0" },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: turnId, qualifier: "in_turn" }
    ]
  });
  return builder.build();
}

describe("M4 EU AI Act Dossiers, Risk Ledger, QMS & PMM/Incident (zero-mock Chicago)", () => {
  test("F16: risk-ledger extracts real AIRO + EU AI Act risks, Art. 9/12/14/15 mappings, and honest UNVERIFIED standing", () => {
    const dir = makeTempDir("zcode-m4-risk-");
    try {
      const cfgPath = join(dir, "zcode-cli.toml");
      writeFileSync(
        cfgPath,
        '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "ov-eu"\n[pmm]\nmin_window = 20\n',
        "utf8"
      );

      const report = loadAiroRiskRegister({ packageRoot: REPO_ROOT, configPath: cfgPath, cwd: dir });
      expect(report.standing).toBe("UNVERIFIED");
      expect(report.risks.length).toBeGreaterThanOrEqual(11);
      expect(report.summary.all_residual_within_threshold).toBe(true);
      expect(report.summary.file_uris_verified).toBe(true);
      expect(report.mappings.map((m) => m.articleNumber).sort()).toEqual(["12", "14", "15", "9"]);
      const md = formatRiskRegisterMarkdown(report);
      expect(md).toContain("Risk_ToolchainDrift");
      expect(md).toContain("Risk_PromptInjection");

      const info = buildComplianceInfo({ packageRoot: REPO_ROOT, configPath: cfgPath, cwd: dir });
      expect(info.standing).toBe("UNVERIFIED");
      expect(info.ai_system.node_engine_requirement).toContain("22.19.0");
      expect(formatComplianceInfoMarkdown(info)).toContain("docs/INSTRUCTIONS_FOR_USE.md");

      const ifuPath = join(REPO_ROOT, "docs", "INSTRUCTIONS_FOR_USE.md");
      expect(existsSync(ifuPath)).toBe(true);
      const ifu = readFileSync(ifuPath, "utf8");
      expect(ifu).toContain("Art. 13(3)(a)");
      expect(ifu).toContain("Art. 13(3)(f)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("F15: Annex IV compiler is byte-identical on re-run and --check rejects tampering and missing [pmm]", () => {
    const dir = makeTempDir("zcode-m4-annex-");
    try {
      const cfgPath = join(dir, "zcode-cli.toml");
      writeFileSync(
        cfgPath,
        '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "ov-eu"\nmonitoring_enabled = true\n[pmm]\ndrift_alpha = 0.01\n',
        "utf8"
      );
      const out1 = join(dir, "d1");
      const out2 = join(dir, "d2");
      const r1 = compileAnnexIvDossier({ outDir: out1, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      const r2 = compileAnnexIvDossier({ outDir: out2, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(sha256File(r1.jsonPath)).toBe(sha256File(r2.jsonPath));
      expect(sha256File(r1.mdPath)).toBe(sha256File(r2.mdPath));

      const okCheck = checkAnnexIvDossier({ outDir: out1, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(okCheck.ok).toBe(true);
      expect(okCheck.standing).toBe("ALIVE");

      const parsed = JSON.parse(readFileSync(r1.jsonPath, "utf8")) as Record<string, unknown>;
      parsed.tampered_field = "bad";
      writeFileSync(r1.jsonPath, JSON.stringify(parsed, null, 2), "utf8");
      const badCheck = checkAnnexIvDossier({ outDir: out1, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(badCheck.ok).toBe(false);
      expect(badCheck.errors.join(" ")).toMatch(/mismatch|tamper|differ/i);

      const noPmmCfg = join(dir, "no-pmm.toml");
      writeFileSync(
        noPmmCfg,
        '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "ov-eu"\nmonitoring_enabled = false\n',
        "utf8"
      );
      const incompleteCheck = checkAnnexIvDossier({ outDir: out2, packageRoot: REPO_ROOT, cwd: dir, configPath: noPmmCfg });
      expect(incompleteCheck.ok).toBe(false);
      expect(incompleteCheck.errors.join(" ")).toMatch(/pmm|monitoring/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25_000);

  test("F17 & F18: QMS manifest resolves all 13 Art. 17 clauses; assess, doc, deployer-check, and fria-export enforce thresholds", () => {
    const dir = makeTempDir("zcode-m4-qms-");
    try {
      const qms = validateQmsManifest(REPO_ROOT);
      expect(qms.ok).toBe(true);
      expect(qms.clauseCount).toBeGreaterThanOrEqual(13);
      expect(qms.missingPaths).toEqual([]);

      const cfgPath = join(dir, "zcode-cli.toml");
      writeFileSync(
        cfgPath,
        '[compliance]\nprofile = "high-risk-annex-iii"\nallow_yolo = false\n[deployer]\noverseer_id = "ov-eu"\nlog_retention_days = 180\nmonitoring_enabled = true\n[pmm]\nmin_window = 20\n',
        "utf8"
      );

      expect(runDeployerCheck({ configPath: cfgPath, cwd: dir }).exitCode).toBe(0);

      const staticConcurrencyCfg = join(dir, "static-aimd.toml");
      writeFileSync(staticConcurrencyCfg, '[compliance]\nprofile = "high-risk-annex-iii"\n[aimd]\nconcurrency = 4\n', "utf8");
      expect(() => runDeployerCheck({ configPath: staticConcurrencyCfg, cwd: dir })).toThrow(/STATIC_CONCURRENCY_FORBIDDEN/);

      const emptyLogs = join(dir, "empty-logs");
      mkdirSync(emptyLogs, { recursive: true });
      const emptyAssess = runConformityAssessment({ logsDir: emptyLogs, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(emptyAssess.exitCode).toBe(1);
      expect(emptyAssess.verdict).toBe("UNVERIFIED");

      const goodLogs = join(dir, "good-logs");
      mkdirSync(goodLogs, { recursive: true });
      writeFileSync(join(goodLogs, "s1.ocel.json"), JSON.stringify(buildHighRiskSessionDoc("s1")), "utf8");
      const okAssess = runConformityAssessment({ logsDir: goodLogs, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(okAssess.exitCode).toBe(0);
      expect(okAssess.verdict).toBe("CONFORMITY_ADMITTED");

      const docPath = join(dir, "eu-doc.json");
      const doc = generateEuDeclarationOfConformity({
        outPath: docPath,
        packageRoot: REPO_ROOT,
        cwd: dir,
        configPath: cfgPath,
        logsDir: goodLogs
      });
      expect(doc.git_head_sha).toMatch(/^[0-9a-f]{40}$/);
      expect(doc.runtime_lock.sha512.length).toBeGreaterThan(20);
      expect(doc.sole_responsibility_statement).toMatch(/sole responsibility/i);
      expect(doc.conformity_statement).toContain("Regulation (EU) 2024/1689");
      expect(doc.place_of_issue.length).toBeGreaterThan(0);
      expect(doc.signatory.name.length).toBeGreaterThan(0);
      expect(doc.signatory.function.length).toBeGreaterThan(0);
      expect(doc.signatory.signature.length).toBeGreaterThan(0);

      const friaPath = join(dir, "fria.json");
      const { report } = exportFriaReport({ outPath: friaPath, format: "json", packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(report.overseer_id).toBe("ov-eu");
      expect(existsSync(friaPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25_000);

  test("F19: PMM analysis separates heavy-tailed coding turns from drift and classifies Art. 73 incidents", () => {
    const dir = makeTempDir("zcode-m4-pmm-");
    try {
      const logsDir = join(dir, "heavy");
      mkdirSync(logsDir, { recursive: true });
      const baseMs = Date.parse("2026-08-05T00:00:00.000Z");
      for (let i = 0; i < 25; i++) {
        const doc = buildHighRiskSessionDoc(`pmm_${i}`, {
          baseMs: baseMs + i * 60_000,
          ttftMs: 100 + (i % 3) * 10,
          serviceMs: i % 5 === 0 ? 120_000 : 3500,
          providerId: i % 2 === 0 ? "zai" : "anthropic",
          modelId: i % 2 === 0 ? "glm-5.3" : "claude-sonnet-4"
        });
        writeFileSync(join(logsDir, `pmm_${i}.ocel.json`), JSON.stringify(doc), "utf8");
      }

      const pmm = runPmmAnalysis({ logsDir, cwd: dir });
      expect(pmm.driftDetected).toBe(false);
      expect(pmm.ttftMdTriggered).toBe(false);
      expect(pmm.kingman.cs2).toBeGreaterThan(1);

      const incIn = join(dir, "fail.ocel.json");
      writeFileSync(incIn, JSON.stringify(buildHighRiskSessionDoc("sess_fail", { includeFailure: true })), "utf8");
      const incOut = join(dir, "inc.json");
      const pkt = generateIncidentReportPacket({ inPath: incIn, outPath: incOut, sessionId: "sess_fail", cwd: dir });
      expect(pkt.deadline_class).toBe("10d");
      expect(pkt.root_cause.error_signatures).toContain("ERR_TEST_SYNTAX");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("F15 regression: checkAnnexIvDossier fails closed on non-object JSON (null/false/0/array) and checks markdown unconditionally", () => {
    const dir = makeTempDir("zcode-m4-annex-tamper-");
    try {
      const cfgPath = join(dir, "zcode-cli.toml");
      writeFileSync(
        cfgPath,
        '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "ov-eu"\nmonitoring_enabled = true\n[pmm]\ndrift_alpha = 0.01\n',
        "utf8"
      );
      const outDir = join(dir, "dossier");
      const compiled = compileAnnexIvDossier({ outDir, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      const originalMd = readFileSync(compiled.mdPath, "utf8");

      for (const payload of ["null\n", "false\n", "0\n", '""\n', "[]\n"]) {
        writeFileSync(compiled.jsonPath, payload, "utf8");
        writeFileSync(compiled.mdPath, "# tampered markdown\n", "utf8");
        const chk = checkAnnexIvDossier({ outDir, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
        expect(chk.ok).toBe(false);
        expect(chk.status).toBe("REFUSED");
        expect(chk.errors.some((e) => /expected plain object/i.test(e))).toBe(true);
        expect(chk.errors.some((e) => /Markdown digest differs/i.test(e))).toBe(true);
      }

      // Valid JSON but tampered markdown still fails
      compileAnnexIvDossier({ outDir, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(readFileSync(compiled.mdPath, "utf8")).toBe(originalMd);
      writeFileSync(compiled.mdPath, originalMd + "tamper\n", "utf8");
      const mdTamper = checkAnnexIvDossier({ outDir, packageRoot: REPO_ROOT, cwd: dir, configPath: cfgPath });
      expect(mdTamper.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25_000);

  test("F17 regression: conformity assess enforces .git/index.lock and dirty rollback_on_dirty=false unconditionally (including from subdirectories)", () => {
    const dir = makeTempDir("zcode-m4-git-assess-");
    try {
      const gitOpts = { cwd: dir, timeout: 15_000 };
      spawnSync("git", ["init", "-b", "main"], gitOpts);
      spawnSync("git", ["config", "user.name", "QMS Test"], gitOpts);
      spawnSync("git", ["config", "user.email", "qms@zcode.local"], gitOpts);

      const subDir = join(dir, "packages", "sub");
      mkdirSync(subDir, { recursive: true });
      const cfgPath = join(subDir, "zcode-cli.toml");
      writeFileSync(
        cfgPath,
        '[compliance]\nprofile = "high-risk-annex-iii"\nallow_yolo = false\n[deployer]\noverseer_id = "ov-eu"\nlog_retention_days = 180\nmonitoring_enabled = true\n[retries]\nrollback_on_dirty = true\n[pmm]\nmin_window = 20\n',
        "utf8"
      );
      writeFileSync(join(dir, "README.md"), "clean\n", "utf8");
      spawnSync("git", ["add", "."], gitOpts);
      spawnSync("git", ["commit", "-m", "init"], gitOpts);

      const cleanLogs = join(dir, "clean-logs");
      mkdirSync(cleanLogs, { recursive: true });
      writeFileSync(join(cleanLogs, "s1.ocel.json"), JSON.stringify(buildHighRiskSessionDoc("s_clean")), "utf8");

      // 1. Clean repo + clean logs from subdirectory passes
      const okSub = runConformityAssessment({ logsDir: cleanLogs, packageRoot: REPO_ROOT, cwd: subDir, configPath: cfgPath });
      expect(okSub.exitCode).toBe(0);
      expect(okSub.verdict).toBe("CONFORMITY_ADMITTED");

      // 2. .git/index.lock on clean tree + clean logs (no crash trace) refuses unconditionally
      const lockPath = join(dir, ".git", "index.lock");
      writeFileSync(lockPath, "lock\n", "utf8");
      const lockedRes = runConformityAssessment({ logsDir: cleanLogs, packageRoot: REPO_ROOT, cwd: subDir, configPath: cfgPath });
      expect(lockedRes.exitCode).toBe(1);
      expect(lockedRes.reasons.join(" ")).toContain("ROLLBACK_FAILED");
      rmSync(lockPath, { force: true });

      // 3. Dirty tree + rollback_on_dirty=false + clean logs (no crash trace) refuses unconditionally
      writeFileSync(
        cfgPath,
        '[compliance]\nprofile = "high-risk-annex-iii"\nallow_yolo = false\n[deployer]\noverseer_id = "ov-eu"\nlog_retention_days = 180\nmonitoring_enabled = true\n[retries]\nrollback_on_dirty = false\n[pmm]\nmin_window = 20\n',
        "utf8"
      );
      writeFileSync(join(subDir, "untracked.txt"), "dirty\n", "utf8");
      const dirtyRes = runConformityAssessment({ logsDir: cleanLogs, packageRoot: REPO_ROOT, cwd: subDir, configPath: cfgPath });
      expect(dirtyRes.exitCode).toBe(1);
      expect(dirtyRes.reasons.join(" ")).toContain("DIRTY_TIMEOUT_REFUSED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("F19 regression: incident report requires non-empty sessionId and includes transitive child-object events", () => {
    const dir = makeTempDir("zcode-m4-inc-trans-");
    try {
      const base = buildHighRiskSessionDoc("sess_parent");
      const subObjId = "subagent_child_01";
      const docWithChild = {
        ...base,
        objects: [
          ...base.objects,
          {
            id: subObjId,
            type: "subagent",
            attributes: [{ name: "agent_id", value: subObjId, time: "2026-08-05T10:00:01.000Z" }],
            relationships: [{ objectId: "sess_parent", qualifier: "spawned_by" }]
          }
        ]
      };
      // Re-build through Ocel2ComplianceBuilder to ensure valid pi_hash chain with child-only turn_failed event
      const builder = new Ocel2ComplianceBuilder();
      for (const o of docWithChild.objects) {
        builder.upsertObject(
          o.id,
          o.type,
          Object.fromEntries(o.attributes.map((a) => [a.name, a.value])),
          "2026-08-05T10:00:00.000Z"
        );
        for (const r of o.relationships) {
          builder.addO2O(o.id, r.qualifier, r.objectId);
        }
      }
      for (const e of docWithChild.events) {
        builder.recordEvent({
          id: e.id,
          type: e.type,
          time: e.time,
          attributes: Object.fromEntries(
            e.attributes.filter((a) => a.name !== "pi_hash" && a.name !== "attr_hash").map((a) => [a.name, a.value])
          ),
          relationships: e.relationships
        });
      }
      builder.recordEvent({
        id: "child_only_fail",
        type: "turn_failed",
        time: "2026-08-05T10:00:03.000Z",
        attributes: { error_signature: "ERR_CHILD_SUBAGENT_FAIL" },
        // Only links to subagent_child_01, not directly to sess_parent!
        relationships: [{ objectId: subObjId, qualifier: "in_turn" }]
      });
      const built = builder.build();
      const inPath = join(dir, "child.ocel.json");
      writeFileSync(inPath, JSON.stringify(built), "utf8");

      const outEmpty = join(dir, "should-not-exist.json");
      expect(() =>
        generateIncidentReportPacket({ inPath, outPath: outEmpty, sessionId: "", cwd: dir })
      ).toThrow(/INVALID_COMPLIANCE_CONFIG|session/i);
      expect(existsSync(outEmpty)).toBe(false);

      const outPath = join(dir, "pkt.json");
      const pkt = generateIncidentReportPacket({ inPath, outPath, sessionId: "sess_parent", cwd: dir });
      expect(pkt.deadline_class).toBe("10d");
      expect(pkt.root_cause.error_signatures).toContain("ERR_CHILD_SUBAGENT_FAIL");
      expect(pkt.causal_slice.events.some((e) => e.id === "child_only_fail")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("F19 regression (M4 Iter3): directional O2O slice isolates shared provider and human_overseer while preserving 1-hop and 2-hop children", () => {
    const dir = makeTempDir("zcode-m4-inc-isolate-");
    try {
      const t0 = "2026-08-05T11:00:00.000Z";
      const b = new Ocel2ComplianceBuilder();

      // Shared hub objects across both sessions
      b.upsertObject("prov_shared", "provider", { provider_id: "zai" }, t0);
      b.upsertObject("overseer:ov_shared", "human_overseer", { overseer_id: "ov_shared", role: "deployer_oversight" }, t0);
      b.upsertObject("profile:high-risk-annex-iii", "compliance_profile", { profile: "high-risk-annex-iii" }, t0);

      // Clean session A
      b.upsertObject("sess_clean_a", "session", { compliance_profile: "high-risk-annex-iii" }, t0);
      b.upsertObject("turn_a1", "turn", { standing: "ALIVE" }, t0);
      b.upsertObject("mr_a1", "model_request", { provider_id: "zai", model_id: "glm-5.3" }, t0);
      b.upsertObject("perm_a1", "permission", { decision: "allow", decision_latency_ms: "1500", overseer_id: "ov_shared" }, t0);
      b.addO2O("turn_a1", "in_session", "sess_clean_a");
      b.addO2O("mr_a1", "in_turn", "turn_a1");
      b.addO2O("mr_a1", "uses_provider", "prov_shared");
      b.addO2O("overseer:ov_shared", "governs", "sess_clean_a");
      b.addO2O("profile:high-risk-annex-iii", "governs", "sess_clean_a");

      // Breached session B sharing the exact same provider, overseer, and compliance_profile
      b.upsertObject("sess_breach_b", "session", { compliance_profile: "high-risk-annex-iii" }, t0);
      b.upsertObject("turn_b1", "turn", { standing: "BLOCKED" }, t0);
      b.upsertObject("mr_b1", "model_request", { provider_id: "zai", model_id: "glm-5.3" }, t0);
      b.addO2O("turn_b1", "in_session", "sess_breach_b");
      b.addO2O("mr_b1", "in_turn", "turn_b1");
      b.addO2O("mr_b1", "uses_provider", "prov_shared");
      b.addO2O("overseer:ov_shared", "governs", "sess_breach_b");
      b.addO2O("profile:high-risk-annex-iii", "governs", "sess_breach_b");

      // Clean session A events
      b.recordEvent({
        id: "a_e1",
        type: "session_created",
        time: "2026-08-05T11:00:00.000Z",
        attributes: {},
        relationships: [{ objectId: "sess_clean_a", qualifier: "in_session" }]
      });
      b.recordEvent({
        id: "a_e2",
        type: "art50_disclosure_emitted",
        time: "2026-08-05T11:00:00.100Z",
        attributes: { channel: "stream-json" },
        relationships: [{ objectId: "sess_clean_a", qualifier: "in_session" }]
      });
      b.recordEvent({
        id: "a_e3",
        type: "turn_started",
        time: "2026-08-05T11:00:00.200Z",
        attributes: {},
        relationships: [
          { objectId: "sess_clean_a", qualifier: "in_session" },
          { objectId: "turn_a1", qualifier: "in_turn" }
        ]
      });
      b.recordEvent({
        id: "a_e4",
        type: "permission_requested",
        time: "2026-08-05T11:00:00.300Z",
        attributes: { risk_level: "high" },
        relationships: [
          { objectId: "sess_clean_a", qualifier: "in_session" },
          { objectId: "turn_a1", qualifier: "in_turn" },
          { objectId: "perm_a1", qualifier: "governs" }
        ]
      });
      b.recordEvent({
        id: "a_e5",
        type: "permission_resolved",
        time: "2026-08-05T11:00:01.900Z",
        attributes: { decision: "allow", decision_latency_ms: "1600", overseer_id: "ov_shared" },
        relationships: [
          { objectId: "sess_clean_a", qualifier: "in_session" },
          { objectId: "turn_a1", qualifier: "in_turn" },
          { objectId: "perm_a1", qualifier: "governs" }
        ]
      });
      b.recordEvent({
        id: "a_e6",
        type: "turn_completed",
        time: "2026-08-05T11:00:02.000Z",
        attributes: {},
        relationships: [
          { objectId: "sess_clean_a", qualifier: "in_session" },
          { objectId: "turn_a1", qualifier: "in_turn" },
          { objectId: "mr_a1", qualifier: "uses_provider" }
        ]
      });

      // Breached session B events (one linked only to mr_b1, one critical breach on sess_breach_b)
      b.recordEvent({
        id: "b_e1",
        type: "model_request_completed",
        time: "2026-08-05T11:01:00.000Z",
        attributes: { provider_id: "zai" },
        relationships: [
          { objectId: "mr_b1", qualifier: "in_turn" },
          { objectId: "prov_shared", qualifier: "uses_provider" }
        ]
      });
      b.recordEvent({
        id: "b_e2",
        type: "turn_failed",
        time: "2026-08-05T11:01:01.000Z",
        attributes: { severity: "critical", error_signature: "CRITICAL_BREACH_IN_B" },
        relationships: [
          { objectId: "sess_breach_b", qualifier: "in_session" },
          { objectId: "turn_b1", qualifier: "in_turn" }
        ]
      });

      const sharedPath = join(dir, "multi-shared.ocel.json");
      writeFileSync(sharedPath, JSON.stringify(b.build()), "utf8");

      const outClean = join(dir, "inc-clean-a.json");
      const pktClean = generateIncidentReportPacket({
        inPath: sharedPath,
        outPath: outClean,
        sessionId: "sess_clean_a",
        cwd: dir
      });

      expect(pktClean.deadline_class).toBe("15d");
      expect(pktClean.causal_slice.events.map((e) => e.id)).toEqual(["a_e1", "a_e2", "a_e3", "a_e4", "a_e5", "a_e6"]);
      expect(pktClean.root_cause.error_signatures).not.toContain("CRITICAL_BREACH_IN_B");
      expect(pktClean.causal_slice.objects.some((o) => o.id === "sess_breach_b" || o.id === "turn_b1" || o.id === "mr_b1")).toBe(false);
      // Outward metadata targets and governors remain present with zero dangling O2O/E2O references
      expect(pktClean.causal_slice.objects.some((o) => o.id === "prov_shared")).toBe(true);
      expect(pktClean.causal_slice.objects.some((o) => o.id === "overseer:ov_shared")).toBe(true);
      const cleanSliceObjIds = new Set(pktClean.causal_slice.objects.map((o) => o.id));
      for (const obj of pktClean.causal_slice.objects) {
        for (const rel of obj.relationships) {
          expect(cleanSliceObjIds.has(rel.objectId)).toBe(true);
        }
      }
      for (const ev of pktClean.causal_slice.events) {
        for (const rel of ev.relationships) {
          expect(cleanSliceObjIds.has(rel.objectId)).toBe(true);
        }
      }
      expect(
        validateOcel2(
          {
            ...pktClean.causal_slice,
            events: pktClean.causal_slice.events.map((ev) => ({
              ...ev,
              attributes: ev.attributes.filter((a) => !a.name.startsWith("pi_"))
            }))
          },
          { requireHashChain: false }
        ).ok
      ).toBe(true);

      // Verify 1-hop (subagent -[spawned_by]-> session) and 2-hop (tool_call -[in_turn]-> turn -[in_session]-> session)
      // child events remain included ("10d") even when a foreign breached session shares the same overseer/provider.
      const b2 = new Ocel2ComplianceBuilder();
      b2.upsertObject("prov_shared", "provider", { provider_id: "zai" }, t0);
      b2.upsertObject("overseer:ov_shared", "human_overseer", { overseer_id: "ov_shared", role: "deployer_oversight" }, t0);
      b2.upsertObject("sess_parent", "session", { compliance_profile: "high-risk-annex-iii" }, t0);
      b2.upsertObject("turn_p1", "turn", { standing: "BLOCKED" }, t0);
      b2.upsertObject("sub_c1", "subagent", { agent_id: "sub_c1" }, t0);
      b2.upsertObject("tool_c1", "tool_call", { tool_name: "bash", risk_level: "high" }, t0);
      b2.upsertObject("mr_p1", "model_request", { provider_id: "zai", model_id: "glm-5.3" }, t0);
      b2.addO2O("turn_p1", "in_session", "sess_parent");
      b2.addO2O("sub_c1", "spawned_by", "sess_parent");
      b2.addO2O("tool_c1", "in_turn", "turn_p1");
      b2.addO2O("mr_p1", "in_turn", "turn_p1");
      b2.addO2O("mr_p1", "uses_provider", "prov_shared");
      b2.addO2O("overseer:ov_shared", "governs", "sess_parent");

      b2.upsertObject("sess_foreign", "session", { compliance_profile: "high-risk-annex-iii" }, t0);
      b2.upsertObject("mr_f1", "model_request", { provider_id: "zai", model_id: "glm-5.3" }, t0);
      b2.upsertObject("turn_f1", "turn", { standing: "BLOCKED" }, t0);
      b2.addO2O("turn_f1", "in_session", "sess_foreign");
      b2.addO2O("mr_f1", "in_turn", "turn_f1");
      b2.addO2O("mr_f1", "uses_provider", "prov_shared");
      b2.addO2O("overseer:ov_shared", "governs", "sess_foreign");

      b2.recordEvent({
        id: "p_e1",
        type: "session_created",
        time: "2026-08-05T12:00:00.000Z",
        attributes: {},
        relationships: [{ objectId: "sess_parent", qualifier: "in_session" }]
      });
      b2.recordEvent({
        id: "p_e2",
        type: "art50_disclosure_emitted",
        time: "2026-08-05T12:00:00.100Z",
        attributes: { channel: "stream-json" },
        relationships: [{ objectId: "sess_parent", qualifier: "in_session" }]
      });
      b2.recordEvent({
        id: "ev_sub_1hop",
        type: "turn_failed",
        time: "2026-08-05T12:00:00.500Z",
        attributes: { error_signature: "ERR_SUBAGENT_1HOP" },
        relationships: [{ objectId: "sub_c1", qualifier: "spawned_by" }]
      });
      b2.recordEvent({
        id: "ev_tool_2hop",
        type: "workspace_rolled_back",
        time: "2026-08-05T12:00:00.700Z",
        attributes: { reason: "ERR_TOOL_2HOP" },
        relationships: [{ objectId: "tool_c1", qualifier: "about_tool_call" }]
      });
      b2.recordEvent({
        id: "ev_foreign_crit",
        type: "turn_failed",
        time: "2026-08-05T12:00:01.000Z",
        attributes: { severity: "critical", error_signature: "ERR_FOREIGN_CRIT" },
        relationships: [{ objectId: "sess_foreign", qualifier: "in_session" }]
      });

      const hierPath = join(dir, "multi-hier.ocel.json");
      writeFileSync(hierPath, JSON.stringify(b2.build()), "utf8");
      const outHier = join(dir, "inc-parent.json");
      const pktParent = generateIncidentReportPacket({
        inPath: hierPath,
        outPath: outHier,
        sessionId: "sess_parent",
        cwd: dir
      });
      expect(pktParent.deadline_class).toBe("10d");
      expect(pktParent.causal_slice.events.map((e) => e.id)).toEqual(["p_e1", "p_e2", "ev_sub_1hop", "ev_tool_2hop"]);
      expect(pktParent.root_cause.error_signatures).toContain("ERR_SUBAGENT_1HOP");
      expect(pktParent.root_cause.error_signatures).toContain("ERR_TOOL_2HOP");
      expect(pktParent.root_cause.error_signatures).not.toContain("ERR_FOREIGN_CRIT");
      const parentSliceObjIds = new Set(pktParent.causal_slice.objects.map((o) => o.id));
      for (const obj of pktParent.causal_slice.objects) {
        for (const rel of obj.relationships) {
          expect(parentSliceObjIds.has(rel.objectId)).toBe(true);
        }
      }
      for (const ev of pktParent.causal_slice.events) {
        for (const rel of ev.relationships) {
          expect(parentSliceObjIds.has(rel.objectId)).toBe(true);
        }
      }
      expect(
        validateOcel2(
          {
            ...pktParent.causal_slice,
            events: pktParent.causal_slice.events.map((ev) => ({
              ...ev,
              attributes: ev.attributes.filter((a) => !a.name.startsWith("pi_"))
            }))
          },
          { requireHashChain: false }
        ).ok
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("C6-AnnexV-DoC falsifier: refuses EU DoC when QMS manifest is missing or Annex VI conformity fails, and emits mandatory Annex V(4), V(5), V(7) fields when admitted", () => {
    const dir = makeTempDir("zcode-c6-annexv-");
    try {
      const fakePkgRoot = join(dir, "pkg-no-qms");
      mkdirSync(fakePkgRoot, { recursive: true });
      writeFileSync(
        join(fakePkgRoot, "package.json"),
        JSON.stringify({ name: "zcode-app-cli", version: "3.14.4-1", author: "Test Provider", license: "MIT" }),
        "utf8"
      );
      writeFileSync(
        join(fakePkgRoot, "zcode-runtime.lock.json"),
        readFileSync(join(REPO_ROOT, "zcode-runtime.lock.json"), "utf8"),
        "utf8"
      );

      const cfgPath = join(dir, "zcode-cli.toml");
      writeFileSync(
        cfgPath,
        '[compliance]\nprofile = "high-risk-annex-iii"\nallow_yolo = false\n[deployer]\noverseer_id = "ov-eu"\nlog_retention_days = 180\nmonitoring_enabled = true\n[pmm]\nmin_window = 20\n',
        "utf8"
      );

      // 1. Missing QMS manifest must throw ComplianceRefusalError and write no file
      const noQmsOut = join(dir, "no-qms-doc.json");
      expect(() =>
        generateEuDeclarationOfConformity({
          outPath: noQmsOut,
          packageRoot: fakePkgRoot,
          cwd: dir,
          configPath: cfgPath
        })
      ).toThrow(/ANNEX_V_QMS_REFUSED/);
      expect(existsSync(noQmsOut)).toBe(false);

      // 2. Valid QMS manifest but no conformity assessment / no logs must throw ComplianceRefusalError
      const noAssessOut = join(dir, "no-assess-doc.json");
      expect(() =>
        generateEuDeclarationOfConformity({
          outPath: noAssessOut,
          packageRoot: REPO_ROOT,
          cwd: dir,
          configPath: cfgPath
        })
      ).toThrow(/ANNEX_V_CONFORMITY_REFUSED/);
      expect(existsSync(noAssessOut)).toBe(false);

      // 3. Valid QMS + admitted Annex VI conformity emits Annex V(4), V(5), V(7) fields
      const goodLogs = join(dir, "good-logs");
      mkdirSync(goodLogs, { recursive: true });
      writeFileSync(join(goodLogs, "s1.ocel.json"), JSON.stringify(buildHighRiskSessionDoc("s_c6")), "utf8");
      const validOut = join(dir, "valid-doc.json");
      const doc = generateEuDeclarationOfConformity({
        outPath: validOut,
        packageRoot: REPO_ROOT,
        cwd: dir,
        configPath: cfgPath,
        logsDir: goodLogs,
        placeOfIssue: "Brussels, Belgium",
        signatory: {
          name: "Jane Doe",
          function: "Head of AI Compliance",
          signature: "sig:ed25519:verified"
        }
      });
      expect(existsSync(validOut)).toBe(true);
      expect(doc.qms_manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.conformity_assessment.verdict).toBe("CONFORMITY_ADMITTED");
      expect(doc.conformity_assessment.logs_analyzed).toBe(1);
      expect(doc.sole_responsibility_statement).toMatch(/sole responsibility/i);
      expect(doc.conformity_statement).toContain("Regulation (EU) 2024/1689");
      expect(doc.place_of_issue).toBe("Brussels, Belgium");
      expect(doc.signatory).toEqual({
        name: "Jane Doe",
        function: "Head of AI Compliance",
        signature: "sig:ed25519:verified"
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

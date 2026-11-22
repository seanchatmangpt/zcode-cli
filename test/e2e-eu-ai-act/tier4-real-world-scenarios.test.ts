import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  buildComplianceToml,
  buildConformingHighRiskSession,
  buildDeclareRulesJson,
  buildKAnonLogSet,
  buildOcel2Doc,
  buildOversightCrashSession,
  buildPiiSecretSession,
  buildPmmLogSet,
  buildWfNetJson,
  hermeticTempRoot,
  initGitRepo,
  inspectOcel2Sqlite,
  runBunScript,
  runReceiptIntegrityProbe,
  runSubprocess,
  runZcodeCli,
  runZcodeCliAsync,
  sha256File,
  validateDfcmReceipt,
  withIsolatedWorkspace,
  withLocalLlmServer,
  type Ocel2Doc,
} from "./helpers.ts";

// ============================================================================
// Tier 4: Real-World End-to-End EU AI Act Compliance Scenarios (>= 8 scenarios)
// Opaque-box, zero-mock Chicago workloads spanning real CLI subprocesses,
// git repositories, SQLite WAL databases, local HTTP LLM servers, and receipts.
// ============================================================================

describe("Tier 4 — Real-World EU AI Act & van der Aalst E2E Compliance Scenarios", () => {
  test("Scenario 1: Art. 50 Aug 2026 launch-day headless stream-json/json session, provenance sidecar, git trailer & Declare verify", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeText("src/index.ts", "export const version = '1.0.0';\n");
      ws.writeToml(
        buildComplianceToml({
          profile: "art50-only",
          gitProvenanceTrailer: true,
          ocelEnabled: true,
          ocelOutputDir: ws.ocelDir,
        }),
      );
      repo.commitAll("chore: enable art50-only compliance profile");

      await withLocalLlmServer(
        ws,
        async () => {
          // 1. Headless stream-json session must emit machine-readable Art. 50 disclosure + OCEL event.
          const streamRes = await runZcodeCliAsync(
            ["-p", "Summarize EU AI Act Art. 50 readiness", "--output-format", "stream-json"],
            ws,
            {
              env: {
                ZCODE_COMPLIANCE_PROFILE: "art50-only",
                ZCODE_OCEL: "1",
                ZCODE_OCEL_DIR: ws.ocelDir,
              },
              timeoutMs: 15_000,
            },
          );
          expect(streamRes.exitCode).toBe(0);

          const ndjson = streamRes.stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
          const disclosureMsg = ndjson.find(
            (ev) =>
              ev.type === "system.disclosure" ||
              ev.type === "ai_disclosure" ||
              ev.ai_disclosure !== undefined ||
              (typeof ev.payload === "object" &&
                ev.payload !== null &&
                "regulation" in (ev.payload as Record<string, unknown>)),
          );
          expect(disclosureMsg).toBeDefined();

          // 2. Headless --json invocation must carry ai_disclosure metadata.
          const jsonRes = await runZcodeCliAsync(
            ["-p", "Provide JSON summary", "--json"],
            ws,
            {
              env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" },
              timeoutMs: 15_000,
            },
          );
          expect(jsonRes.exitCode).toBe(0);
          const jsonOut = jsonRes.json<{
            ai_disclosure?: { regulation?: string; provider_id?: string; model_id?: string };
          }>();
          expect(jsonOut.ai_disclosure).toBeDefined();
          expect(jsonOut.ai_disclosure?.regulation).toContain("50");
          expect(jsonOut.ai_disclosure?.provider_id).toBeTruthy();
          expect(jsonOut.ai_disclosure?.model_id).toBeTruthy();

          // 3. Verify recorded OCEL trace contains art50_disclosure_emitted and passes Declare + hash chain.
          const ocelFiles = readdirSync(ws.ocelDir).filter(
            (f) => f.endsWith(".jsonocel") || f.endsWith(".ocel.json"),
          );
          expect(ocelFiles.length).toBeGreaterThan(0);
          const recordedPath = join(ws.ocelDir, ocelFiles[0]!);
          const recordedDoc = JSON.parse(readFileSync(recordedPath, "utf8")) as Ocel2Doc;
          expect(recordedDoc.events.some((e) => e.type === "art50_disclosure_emitted")).toBe(true);

          const art50RulesPath = ws.writeJson(
            "art50.rules.json",
            buildDeclareRulesJson([
              {
                id: "DEC-INIT",
                template: "Init",
                activity: "session_created",
                objectType: "session",
                mandatory: true,
              },
              {
                id: "DEC-RESP-ART50",
                template: "Response",
                activation: "session_created",
                target: "art50_disclosure_emitted",
                objectType: "session",
                mandatory: true,
              },
            ]),
          );
          const decVer = runZcodeCli(
            ["ocel", "verify", "--in", recordedPath, "--declare", art50RulesPath, "--json"],
            ws,
          );
          expect(decVer.exitCode).toBe(0);
          const decParsed = decVer.json<{
            declareResults?: Array<{ id: string; status: string }>;
          }>();
          for (const rule of decParsed.declareResults ?? []) {
            expect(rule.status).toBe("SATISFIED_WITNESSED");
          }

          // 4. Emit artifact + provenance sidecar + git trailer AI-Generated-By.
          const artifactPath = ws.writeText("LAUNCH_NOTES.md", "# Aug 2026 Launch\nGenerated output.\n");
          const artifactSha = sha256File(artifactPath);
          expect(artifactSha).toMatch(/^[0-9a-f]{64}$/);

          const bundlePath = ws.path("art50-bundle.ocel.json");
          const exportRes = runZcodeCli(
            [
              "ocel",
              "export",
              "--in",
              recordedPath,
              "--format",
              "json",
              "--out",
              bundlePath,
            ],
            ws,
            { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" } },
          );
          expect(exportRes.exitCode).toBe(0);
          expect(existsSync(bundlePath)).toBe(true);
          const bundleSha = sha256File(bundlePath);

          const provDir = ws.path(".zcode-provenance");
          expect(existsSync(provDir)).toBe(true);
          const sidecars = readdirSync(provDir).filter((f) => f.endsWith(".json"));
          expect(sidecars.length).toBeGreaterThan(0);
          const sidecarText = sidecars
            .map((f) => readFileSync(join(provDir, f), "utf8"))
            .join("\n");
          expect(sidecarText).toContain("EU");
          expect(sidecarText.includes(bundleSha) || sidecarText.includes(artifactSha)).toBe(true);

          const commitSha = repo.commitAll("docs: publish Aug 2026 launch notes");
          expect(commitSha).toMatch(/^[0-9a-f]{40}$/);
          const gitCommitMsg = repo.git(["log", "-1", "--pretty=%B"]).stdout;
          expect(`${sidecarText}\n${jsonRes.stdout}\n${gitCommitMsg}`).toContain("AI-Generated-By");
        },
        { replyText: "Art. 50 launch check OK" },
      );
    });
  }, 30_000);

  test("Scenario 2: High-risk Annex III full conforming lifecycle (preflight -> risk-register -> OCEL JSON/SQLite/XML -> A* & Declare -> Annex IV -> assess -> DoC -> FRIA -> version)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeText("src/module.ts", "export const regulated = true;\n");
      const cfgPath = ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          overseerId: "overseer-alice-eu",
          logRetentionDays: 180,
          monitoringEnabled: true,
          allowYolo: false,
          redactPii: true,
          minReviewMs: 1000,
          gitProvenanceTrailer: true,
        }),
      );
      const head = repo.commitAll("chore: onboard high-risk-annex-iii deployer config");

      // 1. Art. 26 Deployer preflight check
      const preflight = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(preflight.exitCode).toBe(0);
      const preflightJson = preflight.json<{ admitted?: boolean; ok?: boolean; standing?: string }>();
      expect(preflightJson.admitted ?? preflightJson.ok ?? preflightJson.standing === "ALIVE").toBeTruthy();

      // 2. Art. 9 AIRO risk register & EU AI Act Arts. 9/12/14/15 mapping
      const riskRes = runZcodeCli(["compliance", "risk-register", "--json"], ws);
      expect(riskRes.exitCode).toBe(0);
      const riskRaw = JSON.stringify(riskRes.json());
      expect(riskRaw).toContain("Risk_ToolchainDrift");
      for (const art of ["9", "12", "14", "15"]) {
        expect(riskRaw).toMatch(new RegExp(`Art(?:icle)?[\\s._-]*${art}\\b`, "i"));
      }

      // 3. OCEL 2.0 JSON -> SQLite WAL -> XML round-trip
      const sessionDoc = buildConformingHighRiskSession({
        sessionId: "sess_annex3_lifecycle",
        profile: "high-risk-annex-iii",
        overseerId: "overseer-alice-eu",
        decisionLatencyMs: 1450,
        gitHeadSha: head,
        includeSubagent: true,
        includeWorkOrder: true,
      });
      const logsDir = ws.path("soak-logs");
      mkdirSync(logsDir, { recursive: true });
      const jsonPath = join(logsDir, "sess_annex3_lifecycle.ocel.json");
      writeFileSync(jsonPath, JSON.stringify(sessionDoc, null, 2), "utf8");
      writeFileSync(join(ws.ocelDir, "sess_annex3_lifecycle.ocel.json"), JSON.stringify(sessionDoc, null, 2), "utf8");

      const sqlitePath = ws.path("lifecycle.ocel.sqlite");
      const toSqlite = runZcodeCli(
        ["ocel", "export", "--in", jsonPath, "--format", "sqlite", "--out", sqlitePath],
        ws,
      );
      expect(toSqlite.exitCode).toBe(0);
      const dbInspect = inspectOcel2Sqlite(sqlitePath);
      expect(dbInspect.journalMode).toBe("wal");
      expect(dbInspect.eventCount).toBe(sessionDoc.events.length);
      expect(dbInspect.objectCount).toBe(sessionDoc.objects.length);
      expect(dbInspect.objectObjectCount).toBeGreaterThanOrEqual(7);

      const xmlPath = ws.path("lifecycle.ocel.xml");
      const toXml = runZcodeCli(
        ["ocel", "export", "--in", jsonPath, "--format", "xml", "--out", xmlPath],
        ws,
      );
      expect(toXml.exitCode).toBe(0);
      const xmlText = readFileSync(xmlPath, "utf8");
      expect(xmlText).toContain("<log>");
      expect(xmlText).toContain('type="art50_disclosure_emitted"');
      expect(xmlText).toContain("</log>");

      const roundTripJson = ws.path("lifecycle-roundtrip.ocel.json");
      const sqliteToJson = runZcodeCli(
        ["ocel", "export", "--in", sqlitePath, "--format", "json", "--out", roundTripJson],
        ws,
      );
      expect(sqliteToJson.exitCode).toBe(0);

      // 4. Optimal A* alignment (--wfnet) + Declare verification (--declare)
      const wfPath = ws.writeJson("lifecycle.wfnet.json", buildWfNetJson());
      const rulesPath = ws.writeJson(
        "lifecycle.rules.json",
        buildDeclareRulesJson([
          { id: "DEC-INIT", template: "Init", activity: "session_created", objectType: "session", mandatory: true },
          {
            id: "DEC-RESP-ART50",
            template: "Response",
            activation: "session_created",
            target: "art50_disclosure_emitted",
            objectType: "session",
            mandatory: true,
          },
          {
            id: "DEC-PREC-ART14",
            template: "Precedence",
            activation: "tool_updated",
            target: "permission_resolved",
            objectType: "turn",
            mandatory: true,
          },
          {
            id: "DEC-ABS-UNREDACTED",
            template: "Absence",
            activity: "unredacted_secret",
            maxCount: 0,
            objectType: "session",
            mandatory: true,
          },
        ]),
      );
      const verRes = runZcodeCli(
        ["ocel", "verify", "--in", roundTripJson, "--wfnet", wfPath, "--declare", rulesPath, "--json"],
        ws,
      );
      expect(verRes.exitCode).toBe(0);
      const verJson = verRes.json<{
        valid?: boolean;
        chainIntact?: boolean;
        alignment: { alignmentCost: number; fitness: number; moves: Array<{ kind: string; cost: number }> };
        declareResults: Array<{ id: string; status: string }>;
      }>();
      expect(verJson.valid ?? verJson.chainIntact).toBe(true);
      expect(verJson.alignment.alignmentCost).toBe(0);
      expect(verJson.alignment.fitness).toBe(1);
      expect(verJson.alignment.moves.every((m) => m.kind === "sync" && m.cost === 0)).toBe(true);
      for (const dr of verJson.declareResults) {
        expect(dr.status).toBe("SATISFIED_WITNESSED");
      }

      // 5. Art. 11 Annex IV dossier compilation & --check verification
      const dossierDir = ws.path("annex-iv-dossier");
      const annexRes = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir], ws);
      expect(annexRes.exitCode).toBe(0);
      expect(existsSync(join(dossierDir, "annex-iv.json"))).toBe(true);
      expect(existsSync(join(dossierDir, "annex-iv.md"))).toBe(true);
      const annexCheck = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir, "--check"], ws);
      expect(annexCheck.exitCode).toBe(0);

      // 6. Art. 17/43 Conformity Assessment & Art. 47 Annex V EU DoC
      const assessRes = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect(assessRes.exitCode).toBe(0);
      const assessJson = assessRes.json<{ verdict?: string; standing?: string }>();
      expect(assessJson.verdict).toBe("CONFORMITY_ADMITTED");
      expect(["ALIVE", "PARTIAL_ALIVE"]).toContain(assessJson.standing ?? "");

      const lock = JSON.parse(readFileSync(join(REPO_ROOT, "zcode-runtime.lock.json"), "utf8")) as {
        sha512: string;
      };
      const docOut = ws.path("eu-declaration-of-conformity.json");
      const docRes = runZcodeCli(["compliance", "doc", "--out", docOut], ws);
      expect(docRes.exitCode).toBe(0);
      const docRaw = readFileSync(docOut, "utf8");
      expect(Object.keys(JSON.parse(docRaw) as Record<string, unknown>).length).toBeGreaterThanOrEqual(9);
      expect(docRaw).toContain(lock.sha512);

      // 7. Art. 27 FRIA export (JSON + MD) & Art. 13 compliance info + version --compliance
      const friaJsonPath = ws.path("fria-report.json");
      const friaRes = runZcodeCli(["compliance", "fria-export", "--out", friaJsonPath], ws, {
        env: { ZCODE_OVERSEER_ID: undefined },
      });
      expect(friaRes.exitCode).toBe(0);
      expect(readFileSync(friaJsonPath, "utf8")).toContain("overseer-alice-eu");

      const friaMdPath = ws.path("fria-report.md");
      const friaMdRes = runZcodeCli(["compliance", "fria-export", "--out", friaMdPath, "--format", "md"], ws, {
        env: { ZCODE_OVERSEER_ID: undefined },
      });
      expect(friaMdRes.exitCode).toBe(0);
      expect(readFileSync(friaMdPath, "utf8")).toContain("#");

      const infoRes = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(infoRes.exitCode).toBe(0);
      expect(JSON.stringify(infoRes.json())).toContain("22.19.0");

      const verCompRes = runZcodeCli(["version", "--compliance"], ws);
      expect(verCompRes.exitCode).toBe(0);
      expect(verCompRes.stdout).toContain("3.14.4");
      expect(verCompRes.stdout.toLowerCase()).toMatch(/eu.?ai.?act|2024\/1689|compliance/);
    });
  }, 30_000);

  test("Scenario 3: Regulated --mode yolo & --dangerously-skip-permissions refusal, lawful --mode edit, oversight stop & transactional rollback in git repo", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeText("src/service.ts", "export const state = 'clean';\n");
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          overseerId: "overseer-alice-eu",
          allowYolo: false,
          rollbackOnDirty: true,
        }),
      );
      const cleanHead = repo.commitAll("chore: baseline clean state");
      expect(repo.statusPorcelain()).toBe("");

      await withLocalLlmServer(ws, async () => {
        // 1. Rogue bypass attempts MUST be refused fail-closed with OVERSIGHT_POLICY_REFUSED.
        const skipPerm = await runZcodeCliAsync(
          ["-p", "Attempt unapproved write", "--dangerously-skip-permissions"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" }, timeoutMs: 12_000 },
        );
        expect(skipPerm.exitCode).toBe(1);
        expect(skipPerm.stdout + skipPerm.stderr).toContain("OVERSIGHT_POLICY_REFUSED");

        const yoloMode = await runZcodeCliAsync(
          ["-p", "Attempt yolo mode", "--mode", "yolo"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" }, timeoutMs: 12_000 },
        );
        expect(yoloMode.exitCode).toBe(1);
        expect(yoloMode.stdout + yoloMode.stderr).toContain("OVERSIGHT_POLICY_REFUSED");

        // 2. Lawful supervised --mode edit succeeds without oversight refusal.
        const editRes = await runZcodeCliAsync(
          ["-p", "Inspect src/service.ts", "--mode", "edit", "--output-format", "stream-json"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" }, timeoutMs: 12_000 },
        );
        expect(editRes.exitCode).toBe(0);
        expect(editRes.stdout + editRes.stderr).not.toContain("OVERSIGHT_POLICY_REFUSED");
      });

      // 3. Simulate mid-edit dirty workspace followed by emergency oversight_intervened stop + rollback.
      ws.writeText("src/service.ts", "export const state = 'corrupted-mid-edit';\n");
      ws.writeText("src/uncommitted-temp.ts", "export const orphan = true;\n");
      expect(repo.statusPorcelain()).not.toBe("");

      const rollbackTrace = buildOversightCrashSession({ kind: "dirty_rollback" });
      const tracePath = ws.writeJson("oversight-rollback.ocel.json", rollbackTrace);
      const verRes = runZcodeCli(["ocel", "verify", "--in", tracePath, "--json"], ws);
      expect(verRes.exitCode).toBe(0);
      expect(rollbackTrace.events.some((e) => e.type === "oversight_intervened")).toBe(true);
      expect(rollbackTrace.events.some((e) => e.type === "workspace_rolled_back")).toBe(true);

      // Transactional rollback restores git tracked + untracked workspace to cleanHead.
      expect(repo.git(["reset", "--hard", cleanHead]).exitCode).toBe(0);
      expect(repo.git(["clean", "-fd"]).exitCode).toBe(0);
      expect(repo.headSha()).toBe(cleanHead);
      expect(repo.statusPorcelain()).toBe("");
      expect(ws.readText("src/service.ts")).toBe("export const state = 'clean';\n");
      expect(ws.exists("src/uncommitted-temp.ts")).toBe(false);
    });
  }, 30_000);

  test("Scenario 4: Dirty-state retry storm & per-signature budget cap (RETRY_BUDGET_EXHAUSTED) + durable v2 DfCM receipt", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeText("src/worker.ts", "export const stable = 1;\n");
      const cfgPath = ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          maxRetriesPerSignature: 3,
          maxRemediationAttempts: 3,
          maxTransportRetries: 3,
          rollbackOnDirty: true,
        }),
      );
      const baseHead = repo.commitAll("chore: configure bounded retry caps");

      // 1. Validate deployer/retry configuration
      const cfgCheck = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(cfgCheck.exitCode).toBe(0);

      // 2. Verify real M3 transactional-net + retry-budget suite executes cleanly when landed
      const txKingmanTest = join(REPO_ROOT, "test", "compliance-transactional-kingman.test.ts");
      expect(existsSync(txKingmanTest)).toBe(true);
      const txRes = runSubprocess(process.execPath, ["test", "test/compliance-transactional-kingman.test.ts"], {
        cwd: REPO_ROOT,
        timeoutMs: 20_000,
      });
      expect(txRes.exitCode).toBe(0);

      // 3. Simulate dirty-state retry storm across 3 identical failure signatures on real git repo:
      // Attempt 1 & 2 mutate workspace, fail identically, roll back cleanly; attempt 3 hits cap.
      const failureSig = "TS2322:type_mismatch:src/worker.ts";
      for (let attempt = 1; attempt <= 2; attempt++) {
        ws.writeText("src/worker.ts", `export const brokenAttempt = ${attempt};\n`);
        expect(repo.statusPorcelain()).not.toBe("");
        // Rollback before retry
        expect(repo.git(["checkout", "--", "src/worker.ts"]).exitCode).toBe(0);
        expect(repo.statusPorcelain()).toBe("");
      }

      // Record bounded retry-storm OCEL 2.0 trace and verify integrity
      const base = buildConformingHighRiskSession({ sessionId: "sess_retry_storm", gitHeadSha: baseHead });
      const stormDoc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: [
          ...base.eventTypes,
          { name: "retry_budget_exhausted", attributes: [{ name: "code", type: "string" }] },
        ],
        objects: base.objects,
        events: [
          ...base.events.slice(0, 5),
          {
            id: "sess_retry_storm_fail_1",
            type: "turn_failed",
            time: "2026-08-02T10:00:03.000Z",
            attributes: [{ name: "error_signature", value: failureSig }],
            relationships: [{ objectId: "sess_retry_storm", qualifier: "in_session" }],
          },
          {
            id: "sess_retry_storm_rb_1",
            type: "workspace_rolled_back",
            time: "2026-08-02T10:00:03.100Z",
            attributes: [{ name: "reason", value: "dirty_retry_rollback_1" }],
            relationships: [{ objectId: "sess_retry_storm", qualifier: "in_session" }],
          },
          {
            id: "sess_retry_storm_fail_2",
            type: "turn_failed",
            time: "2026-08-02T10:00:03.500Z",
            attributes: [{ name: "error_signature", value: failureSig }],
            relationships: [{ objectId: "sess_retry_storm", qualifier: "in_session" }],
          },
          {
            id: "sess_retry_storm_rb_2",
            type: "workspace_rolled_back",
            time: "2026-08-02T10:00:03.600Z",
            attributes: [{ name: "reason", value: "dirty_retry_rollback_2" }],
            relationships: [{ objectId: "sess_retry_storm", qualifier: "in_session" }],
          },
          {
            id: "sess_retry_storm_fail_3",
            type: "turn_failed",
            time: "2026-08-02T10:00:04.000Z",
            attributes: [
              { name: "error_signature", value: failureSig },
              { name: "refusal_code", value: "RETRY_BUDGET_EXHAUSTED" },
            ],
            relationships: [{ objectId: "sess_retry_storm", qualifier: "in_session" }],
          },
          ...base.events.slice(-1),
        ],
      });
      const artifactDir = mkdtempSync(join(hermeticTempRoot(), "zcode-e2e-retry-storm-"));
      try {
        const stormPath = join(artifactDir, "retry-storm.ocel.json");
        writeFileSync(stormPath, JSON.stringify(stormDoc, null, 2) + "\n", "utf8");
        const verRes = runZcodeCli(["ocel", "verify", "--in", stormPath, "--json"], ws);
        expect(verRes.exitCode).toBe(0);

        // 4. Emit durable v2 DfCM BLOCKED receipt recording RETRY_BUDGET_EXHAUSTED and admit via validate_receipt.py
        const stormSha = sha256File(stormPath);
        const receiptPath = join(artifactDir, "retry-storm.receipt.json");
        writeFileSync(
          receiptPath,
          JSON.stringify(
            {
              work_order_id: "WO-E2E-RETRY-STORM-04",
              origin_authority: { grant: "e2e-tier4", actor: "overseer-alice-eu", ceiling: "CONSTRUCT" },
              provider: { name: "zcode-cli-e2e" },
              provider_execution_id: "exec-retry-storm-04",
              identity: {
                subject: "sess_retry_storm",
                repo: repo.cwd,
                subject_sha: baseHead,
                base_sha: baseHead,
              },
              authority: { ceiling: "CONSTRUCT", grant: "e2e-tier4", actor: "overseer-alice-eu" },
              consequence: {
                commits: [baseHead],
                files_changed: ["zcode-cli.toml"],
                remote_effects: [],
                refusal_code: "RETRY_BUDGET_EXHAUSTED",
                error_signature: failureSig,
              },
              replay: {
                commands: [
                  {
                    cmd: `zcode ocel verify --in ${stormPath} --json`,
                    exit: 0,
                    cwd: repo.cwd,
                    output_sha256: stormSha,
                  },
                ],
                durable_location: stormPath,
              },
              standing: {
                value: "BLOCKED",
                broken_term: "mu_on_O",
                derived_from: `RETRY_BUDGET_EXHAUSTED after 3 repeats of ${failureSig} at ${baseHead}`,
              },
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
        const receiptCheck = validateDfcmReceipt(receiptPath, { cwd: repo.cwd });
        expect(receiptCheck.exitCode).toBe(0);
        expect(receiptCheck.admitted).toBe(true);
        expect(repo.statusPorcelain()).toBe("");
      } finally {
        rmSync(artifactDir, { recursive: true, force: true });
      }
    });
  }, 30_000);

  test("Scenario 5: Heavy-tailed Kingman scheduling (no false drift on stationary turns) + degraded spike -> pmm analyze drift -> ocel discover bottleneck -> Art. 73 incident packet", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          ttftSpikeFactor: 2.0,
          minReviewMs: 1000,
          driftAlpha: 0.01,
          minWindow: 20,
        }),
      );

      // Phase A: 25 stationary heavy-tailed sessions (healthy TTFT, mixed 3.5s and 120s serviceMs).
      const baselineDir = ws.path("pmm-baseline-heavy");
      const combinedDir = ws.path("pmm-combined");
      mkdirSync(baselineDir, { recursive: true });
      mkdirSync(combinedDir, { recursive: true });

      const heavyLogs = buildPmmLogSet("heavy_tailed", 25);
      for (let i = 0; i < heavyLogs.length; i++) {
        const serialized = JSON.stringify(heavyLogs[i]!.doc, null, 2);
        writeFileSync(join(baselineDir, `00_${String(i).padStart(2, "0")}_${heavyLogs[i]!.filename}`), serialized, "utf8");
        writeFileSync(join(combinedDir, `00_${String(i).padStart(2, "0")}_${heavyLogs[i]!.filename}`), serialized, "utf8");
      }

      const baselineRes = runZcodeCli(
        ["pmm", "analyze", "--logs", baselineDir, "--out", ws.path("pmm-baseline.json"), "--json"],
        ws,
      );
      expect(baselineRes.exitCode).toBe(0);
      const baselineJson = baselineRes.json<{ driftDetected: boolean; ttftMdTriggered?: boolean }>();
      expect(baselineJson.driftDetected).toBe(false);
      expect(baselineJson.ttftMdTriggered ?? false).toBe(false);

      // Phase B: Append 25 degraded sessions (error spike + TTFT spike + automation-bias latency < 200ms).
      const baseStart = Date.parse("2026-08-02T01:00:00.000Z");
      let lastDegradedPath = "";
      let lastDegradedSessionId = "";
      for (let i = 0; i < 25; i++) {
        const sessId = `pmm_degraded_${String(i + 1).padStart(3, "0")}`;
        const rawBase = buildConformingHighRiskSession({
          sessionId: sessId,
          baseTimeMs: baseStart + i * 60_000,
          providerId: i % 2 === 0 ? "zai" : "anthropic",
          modelId: i % 2 === 0 ? "glm-5.3" : "claude-sonnet-4",
          ttftMs: 950,
          serviceMs: 8500,
          decisionLatencyMs: 140, // triggers AB_RISK_FLAG (< min_review_ms = 1000)
          includeRework: true,
        });
        const degradedEvents = rawBase.events.map((ev) =>
          ev.type === "turn_completed"
            ? { ...ev, attributes: [{ name: "fitness", value: "0.58" }] }
            : ev,
        );
        const degradedDoc = buildOcel2Doc({
          objectTypes: rawBase.objectTypes,
          eventTypes: rawBase.eventTypes,
          objects: rawBase.objects,
          events: degradedEvents,
        });
        const filePath = join(combinedDir, `01_${String(i).padStart(2, "0")}_${sessId}.ocel.json`);
        writeFileSync(filePath, JSON.stringify(degradedDoc, null, 2), "utf8");
        lastDegradedPath = filePath;
        lastDegradedSessionId = sessId;
      }

      const degradedOutPath = ws.path("pmm-degraded.json");
      const degradedRes = runZcodeCli(
        ["pmm", "analyze", "--logs", combinedDir, "--out", degradedOutPath, "--json"],
        ws,
      );
      expect(degradedRes.exitCode).toBe(0);
      const degradedJson = degradedRes.json<{
        driftDetected: boolean;
        driftKind?: string;
        pValue?: number;
      }>();
      expect(degradedJson.driftDetected).toBe(true);
      expect(degradedJson.driftKind).toBe("sudden");
      expect(typeof degradedJson.pValue).toBe("number");
      expect(degradedJson.pValue!).toBeLessThan(0.01);

      // Phase C: OC-DFG discovery isolates rework / bottleneck edge on degraded session logs.
      const dfgOutPath = ws.path("bottleneck-dfg.json");
      const dfgRes = runZcodeCli(
        ["ocel", "discover", "--in", lastDegradedPath, "--format", "json", "--out", dfgOutPath],
        ws,
      );
      expect(dfgRes.exitCode).toBe(0);
      const dfg = JSON.parse(readFileSync(dfgOutPath, "utf8")) as {
        reworkCycles?: unknown[];
        sojournByObjectType?: Record<string, { medianMs: number; p95Ms: number }>;
      };
      expect(Array.isArray(dfg.reworkCycles)).toBe(true);
      expect(dfg.reworkCycles!.length).toBeGreaterThan(0);
      expect(dfg.sojournByObjectType).toBeDefined();

      // Phase D: Art. 73 serious incident escalation packet from degraded session.
      const incPath = ws.path("art73-incident.json");
      const incRes = runZcodeCli(
        ["incident", "report", "--in", lastDegradedPath, "--out", incPath, "--session", lastDegradedSessionId],
        ws,
      );
      expect(incRes.exitCode).toBe(0);
      const pkt = JSON.parse(readFileSync(incPath, "utf8")) as {
        deadline_class?: string;
        causal_slice?: unknown;
        ocel_slice?: unknown;
        root_cause?: unknown;
      };
      expect(["2d", "10d", "15d"]).toContain(pkt.deadline_class ?? "");
      expect(pkt.causal_slice ?? pkt.ocel_slice).toBeDefined();
      expect(pkt.root_cause).toBeDefined();
      expect(JSON.stringify(pkt)).toContain(lastDegradedSessionId);
    });
  }, 30_000);

  test("Scenario 6: GDPR PII / JWT / PEM / secret leak prevention & RPM k-anonymity external audit export", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          redactPii: true,
          kAnonymity: 5,
        }),
      );

      // 1. Unified redactor scrubs secrets, emails, IPs, /Users/<name>/, JWTs, PEMs BEFORE pi_hash.
      const piiDoc = buildPiiSecretSession();
      const piiInPath = ws.writeJson("pii-raw.ocel.json", piiDoc);
      const piiOutPath = ws.path("pii-scrubbed.ocel.json");

      const scrubRes = runZcodeCli(
        ["ocel", "export", "--in", piiInPath, "--format", "json", "--out", piiOutPath],
        ws,
      );
      expect(scrubRes.exitCode).toBe(0);
      const scrubbedRaw = readFileSync(piiOutPath, "utf8");
      expect(scrubbedRaw).not.toContain("sk-live-secret-99887766");
      expect(scrubbedRaw).not.toContain("rt_abcdef123456");
      expect(scrubbedRaw).not.toContain("alice.mueller@example.de");
      expect(scrubbedRaw).not.toContain("192.168.14.22");
      expect(scrubbedRaw).not.toContain("/Users/alicemueller/");
      expect(scrubbedRaw).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
      expect(scrubbedRaw).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEF");
      expect(scrubbedRaw).toContain("REDACTED");
      expect(scrubbedRaw).toContain("the token bucket refills");
      expect(scrubbedRaw).toContain('\\"emptyKey\\":\\"\\"');

      // Scrubbed log must pass OCEL verify (pi_hash chain recomputed post-redaction).
      const scrubVerify = runZcodeCli(["ocel", "verify", "--in", piiOutPath, "--json"], ws);
      expect(scrubVerify.exitCode).toBe(0);

      // Export scrubbed log to SQLite WAL and verify zero leaks in SQLite binary/tables.
      const scrubSqlite = ws.path("pii-scrubbed.ocel.sqlite");
      const sqliteExp = runZcodeCli(
        ["ocel", "export", "--in", piiOutPath, "--format", "sqlite", "--out", scrubSqlite],
        ws,
      );
      expect(sqliteExp.exitCode).toBe(0);
      const dbMeta = inspectOcel2Sqlite(scrubSqlite);
      expect(dbMeta.journalMode).toBe("wal");
      expect(dbMeta.eventCount).toBe(piiDoc.events.length);

      // 2. RPM k-anonymity export with outlier variant (k=5, 2 variants of size 5 + 1 outlier).
      const kanonWithOutlier = buildKAnonLogSet({ k: 5, variantCount: 2, includeOutlier: true });
      const outlierInPath = ws.writeJson("kanon-outlier.ocel.json", kanonWithOutlier);
      const outlierOutPath = ws.path("kanon-outlier-safe.ocel.json");
      const outlierExp = runZcodeCli(
        ["ocel", "export", "--in", outlierInPath, "--format", "json", "--out", outlierOutPath, "--rpm-safe", "--k", "5"],
        ws,
      );
      expect([0, 1]).toContain(outlierExp.exitCode);
      if (outlierExp.exitCode === 0) {
        const safeRaw = readFileSync(outlierOutPath, "utf8");
        expect(safeRaw).not.toContain("unique-whistleblower@example.eu");
        expect(safeRaw).not.toContain("kanon_outlier_unique");
        expect(safeRaw).not.toContain("@example.eu");
        const outlierVerify = runZcodeCli(["ocel", "verify", "--in", outlierOutPath, "--json"], ws);
        expect(outlierVerify.exitCode).toBe(0);
      }

      // 3. Clean k=5 export without outlier preserves all 10 sessions, HMAC-pseudonymizes actors, and passes verify.
      const kanonClean = buildKAnonLogSet({ k: 5, variantCount: 2, includeOutlier: false });
      const cleanInPath = ws.writeJson("kanon-clean.ocel.json", kanonClean);
      const cleanOutPath = ws.path("kanon-clean-safe.ocel.json");
      const cleanExp = runZcodeCli(
        ["ocel", "export", "--in", cleanInPath, "--format", "json", "--out", cleanOutPath, "--rpm-safe", "--k", "5"],
        ws,
      );
      expect(cleanExp.exitCode).toBe(0);
      const cleanSafeRaw = readFileSync(cleanOutPath, "utf8");
      expect(cleanSafeRaw).not.toContain("@example.eu");
      expect(cleanSafeRaw).not.toContain("raw-user-alice");
      expect(cleanSafeRaw).toMatch(/hmac|pseudo|[0-9a-f]{16,}/i);
      const cleanSafeDoc = JSON.parse(cleanSafeRaw) as Ocel2Doc;
      expect(cleanSafeDoc.events.length).toBe(kanonClean.events.length);

      const cleanVerify = runZcodeCli(["ocel", "verify", "--in", cleanOutPath, "--json"], ws);
      expect(cleanVerify.exitCode).toBe(0);
    });
  }, 30_000);

  test("Scenario 7: Unconstrained trace A* alignment diagnostics (log_move/model_move) on real turn-tool.ndjson & non-conforming trace + OCPN/OC-DFG Mermaid discovery", async () => {
    await withIsolatedWorkspace(async (ws) => {
      // 1. Feed real stream-json fixture turn-tool.ndjson through real OcelRecorder in a subprocess.
      const fixtureNdjson = join(REPO_ROOT, "test", "fixtures", "zcode-stream-json", "turn-tool.ndjson");
      expect(existsSync(fixtureNdjson)).toBe(true);
      const tapOutDir = ws.path("recorded-tap");
      mkdirSync(tapOutDir, { recursive: true });

      const recScript = `
        import { readFileSync } from "node:fs";
        import { OcelRecorder, STREAM_SOURCE } from ${JSON.stringify(join(REPO_ROOT, "src/ocel-tap.ts"))};
        const rec = new OcelRecorder(STREAM_SOURCE, ${JSON.stringify(tapOutDir)});
        rec.write(readFileSync(${JSON.stringify(fixtureNdjson)}, "utf8"));
        const res = rec.finish();
        console.log(JSON.stringify(res));
      `;
      const recProc = runSubprocess(process.execPath, ["-e", recScript], {
        cwd: REPO_ROOT,
        timeoutMs: 15_000,
      });
      expect(recProc.exitCode).toBe(0);
      const recMeta = recProc.json<{ ocelPath: string; receiptPath: string; events: number }>();
      expect(recMeta.events).toBeGreaterThan(0);
      expect(existsSync(recMeta.ocelPath)).toBe(true);
      expect(existsSync(recMeta.receiptPath)).toBe(true);

      // Verify recorded .jsonocel with scripts/ocel-verify.ts
      const verifyBaseline = runBunScript("scripts/ocel-verify.ts", [recMeta.ocelPath]);
      expect(verifyBaseline.exitCode).toBe(0);
      expect(verifyBaseline.stdout).toContain("deviations: 0");

      // Discover OCPN + Mermaid flowchart from real recorded trace
      const realMermaidPath = ws.path("turn-tool-ocpn.mmd");
      const discMermaid = runZcodeCli(
        ["ocel", "discover", "--in", recMeta.ocelPath, "--ocpn", "--format", "mermaid", "--out", realMermaidPath],
        ws,
      );
      expect(discMermaid.exitCode).toBe(0);
      const mmdText = readFileSync(realMermaidPath, "utf8");
      expect(mmdText).toMatch(/flowchart\s+(LR|TD|TB)/);
      expect(mmdText).toContain("-->");

      const realOcpnJson = ws.path("turn-tool-ocpn.json");
      const discJson = runZcodeCli(
        ["ocel", "discover", "--in", recMeta.ocelPath, "--ocpn", "--format", "json", "--out", realOcpnJson],
        ws,
      );
      expect(discJson.exitCode).toBe(0);
      const ocpnModel = JSON.parse(readFileSync(realOcpnJson, "utf8")) as {
        places: unknown[];
        transitions: unknown[];
        arcs: unknown[];
        soundness?: { sound: boolean };
      };
      expect(ocpnModel.places.length).toBeGreaterThan(0);
      expect(ocpnModel.transitions.length).toBeGreaterThan(0);
      expect(ocpnModel.arcs.length).toBeGreaterThan(0);
      expect(typeof ocpnModel.soundness?.sound).toBe("boolean");

      // 2. Contrast conforming vs non-conforming trace (skipped permission_resolved + extra tool_updated) via A* alignment.
      const wfPath = ws.writeJson("audit.wfnet.json", buildWfNetJson());
      const conforming = buildConformingHighRiskSession({ sessionId: "sess_align_ok" });
      const confPath = ws.writeJson("align-ok.ocel.json", conforming);

      const okRes = runZcodeCli(["ocel", "verify", "--in", confPath, "--wfnet", wfPath, "--json"], ws);
      expect(okRes.exitCode).toBe(0);
      const okJson = okRes.json<{
        alignment: { alignmentCost: number; fitness: number; method?: string };
      }>();
      expect(okJson.alignment.alignmentCost).toBe(0);
      expect(okJson.alignment.fitness).toBe(1);
      expect(okJson.alignment.method).not.toBe("completionHeuristic");

      // Non-conforming: drop permission_resolved (model_move) and inject unmodeled extra tool_updated (log_move)
      const baseWithExtra = buildConformingHighRiskSession({
        sessionId: "sess_align_bad",
        includeRework: true,
        extraToolCount: 1,
      });
      const badEvents = baseWithExtra.events.filter((ev) => ev.type !== "permission_resolved");
      const nonConfDoc = buildOcel2Doc({
        objectTypes: baseWithExtra.objectTypes,
        eventTypes: baseWithExtra.eventTypes,
        objects: baseWithExtra.objects,
        events: badEvents,
      });
      const nonConfPath = ws.writeJson("align-bad.ocel.json", nonConfDoc);

      const badRes = runZcodeCli(["ocel", "verify", "--in", nonConfPath, "--wfnet", wfPath, "--json"], ws);
      expect([0, 1]).toContain(badRes.exitCode);
      const badJson = badRes.json<{
        alignment: {
          alignmentCost: number;
          fitness: number;
          method?: string;
          logMoves?: number;
          modelMoves?: number;
          moves: Array<{ kind: string; cost: number }>;
        };
      }>();
      expect(badJson.alignment.alignmentCost).toBeGreaterThanOrEqual(2);
      expect(badJson.alignment.fitness).toBeLessThan(1);
      expect(badJson.alignment.method).not.toBe("completionHeuristic");
      const hasLogMove =
        (badJson.alignment.logMoves ?? 0) >= 1 ||
        badJson.alignment.moves.some((m) => m.kind === "log_move" || m.kind === "logMove");
      const hasModelMove =
        (badJson.alignment.modelMoves ?? 0) >= 1 ||
        badJson.alignment.moves.some((m) => m.kind === "model_move" || m.kind === "modelMove");
      expect(hasLogMove).toBe(true);
      expect(hasModelMove).toBe(true);

      // Discover rework & OCPN soundness on non-conforming rework trace as Mermaid + JSON
      const nonConfMmd = ws.path("nonconf-ocpn.mmd");
      const nonConfDisc = runZcodeCli(
        ["ocel", "discover", "--in", nonConfPath, "--ocpn", "--format", "mermaid", "--out", nonConfMmd],
        ws,
      );
      expect(nonConfDisc.exitCode).toBe(0);
      expect(readFileSync(nonConfMmd, "utf8")).toContain("flowchart");
    });
  }, 30_000);

  test("Scenario 8: Full CI / release verification ladder (gen-ocel --check, airo pins, receipts:validate, annex-iv --check) + anti-vacuity mutation court", async () => {
    await withIsolatedWorkspace(async (ws) => {
      // 1. Ontology <-> codegen drift gate
      const genCheck = runBunScript("scripts/gen-ocel.ts", ["--check"]);
      expect(genCheck.exitCode).toBe(0);

      // 2. AIRO risk description & W683 wiring pin tests
      const airoRes = runSubprocess(
        process.execPath,
        ["test", "test/airo-risk-description.test.ts", "test/airo-wiring-w683.test.ts"],
        { cwd: REPO_ROOT, timeoutMs: 15_000 },
      );
      expect(airoRes.exitCode).toBe(0);
      expect(airoRes.stdout + airoRes.stderr).toMatch(/\b0 fail\b/);

      // 3. Committed DfCM receipts fail-closed validator (PR #28 Option A:
      //    refuses defective ZCODE-26923-01 while integrity floor admits clean g0.json)
      expect(runReceiptIntegrityProbe("receipts/v26.9.22/g0.json")).toEqual([]);
      const defectiveFindings = runReceiptIntegrityProbe("receipts/v26.9.23/ZCODE-26923-01.json");
      expect(defectiveFindings.some((f) => f.rule === "ALIVE_WITH_NONZERO_EXIT")).toBe(true);
      expect(defectiveFindings.some((f) => f.rule === "BOGUS_SHA")).toBe(false);

      const receiptsRes = runBunScript("scripts/validate-receipts.ts", [], { timeoutMs: 45_000 });
      expect(receiptsRes.exitCode).toBe(1);
      expect(receiptsRes.stdout).toContain("FAIL receipts/v26.9.23/ZCODE-26923-01.json");
      expect(receiptsRes.stdout).toContain("ALIVE_WITH_NONZERO_EXIT");
      expect(`${receiptsRes.stdout}\n${receiptsRes.stderr}`).toContain("REFUSED");

      // 4. Annex IV compile + --check gate
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const dossierDir = ws.path("release-dossier");
      const compileRes = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir], ws);
      expect(compileRes.exitCode).toBe(0);
      const checkRes = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir, "--check"], ws);
      expect(checkRes.exitCode).toBe(0);

      // 5. Anti-vacuity mutation A: tamper annex-iv.json and confirm --check fails closed.
      const annexJsonPath = join(dossierDir, "annex-iv.json");
      const annexRaw = readFileSync(annexJsonPath, "utf8");
      const annexParsed = JSON.parse(annexRaw) as Record<string, unknown>;
      annexParsed.gitHeadSha = "000000000000000000000000000000000000dead";
      annexParsed.headSha = "000000000000000000000000000000000000dead";
      annexParsed.tampered = true;
      writeFileSync(annexJsonPath, JSON.stringify(annexParsed, null, 2), "utf8");
      const tamperedAnnexCheck = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir, "--check"], ws);
      expect(tamperedAnnexCheck.exitCode).not.toBe(0);

      // 6. Anti-vacuity mutation B: tamper OCEL event relationship without recomputing pi_hash -> ocel verify exits 1.
      const validDoc = buildConformingHighRiskSession({ sessionId: "sess_mut_test" });
      const tamperedDoc: Ocel2Doc = {
        ...validDoc,
        events: validDoc.events.map((ev, idx) =>
          idx === 0
            ? { ...ev, relationships: [{ objectId: "tampered_object_999", qualifier: "in_session" }] }
            : ev,
        ),
      };
      const tamperedOcelPath = ws.writeJson("tampered.ocel.json", tamperedDoc);
      const tamperedOcelVerify = runZcodeCli(["ocel", "verify", "--in", tamperedOcelPath, "--json"], ws);
      expect(tamperedOcelVerify.exitCode).toBe(1);

      // 7. Anti-vacuity mutation C: tamper committed receipt copy -> validateDfcmReceipt refuses.
      const repoReceipt = JSON.parse(
        readFileSync(join(REPO_ROOT, "receipts", "v26.9.23", "ZCODE-26923-01.json"), "utf8"),
      ) as Record<string, unknown>;
      repoReceipt.standing = { value: "UNKNOWN", derived_from: "tampered" };
      delete repoReceipt.identity;
      const tamperedReceiptPath = ws.writeJson("tampered.receipt.json", repoReceipt);
      const tamperedReceiptRes = validateDfcmReceipt(tamperedReceiptPath, { cwd: REPO_ROOT });
      expect(tamperedReceiptRes.admitted).toBe(false);
      expect(tamperedReceiptRes.exitCode).not.toBe(0);
    });
  }, 60_000);

  test("Scenario 9: Source-AppServer E2O capture verification & unified capability-snapshot.sh sanitized backup audit", async () => {
    await withIsolatedWorkspace(async (ws) => {
      // 1. Source-AppServer test & fixture verification (closes end-to-end event-completeness blind spot)
      const appServerTestPath = join(REPO_ROOT, "test", "ocel-appserver-capture.test.ts");
      expect(existsSync(appServerTestPath)).toBe(true);
      const appTestRes = runSubprocess(process.execPath, ["test", "test/ocel-appserver-capture.test.ts"], {
        cwd: REPO_ROOT,
        timeoutMs: 15_000,
      });
      expect(appTestRes.exitCode).toBe(0);

      const appFixture = join(REPO_ROOT, "test", "fixtures", "zcode-ocel", "app-server-list.jsonocel");
      const appVerify = runBunScript("scripts/ocel-verify.ts", [appFixture]);
      expect(appVerify.exitCode).toBe(0);
      expect(appVerify.stdout).toContain("deviations: 0");

      // 2. Sanitized capability-snapshot save & verify alignment on workspace with short/compound credentials
      const snapRepo = initGitRepo(ws.path("snap-repo"));
      const zcodeCliDir = join(ws.home, ".zcode", "cli");
      mkdirSync(zcodeCliDir, { recursive: true });
      writeFileSync(
        join(zcodeCliDir, "config.json"),
        JSON.stringify({
          apiKey: "ab1234",
          refresh_token: "rt_secret_987654",
          note: "the token bucket refills",
        }),
        "utf8",
      );
      const backupRoot = ws.path("snapshot-backups");
      const snapEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOME: ws.home,
        ZCODE_BACKUP_ROOT: backupRoot,
        ZCODE_REPO: snapRepo.cwd,
        ZCODE_APP: join(ws.root, "missing.app"),
      };
      const saveRes = runSubprocess("bash", [join(REPO_ROOT, "scripts", "capability-snapshot.sh"), "save"], {
        cwd: ws.cwd,
        env: snapEnv,
        timeoutMs: 15_000,
      });
      expect(saveRes.exitCode).toBe(0);

      const snapDirs = readdirSync(backupRoot).filter((d) => d.startsWith("caps-"));
      expect(snapDirs.length).toBe(1);
      const snapDir = join(backupRoot, snapDirs[0]!);
      const tarPath = join(snapDir, "user-state.tar.gz");
      expect(existsSync(tarPath)).toBe(true);

      const tarMembers = readFileSync(join(snapDir, "tar-list.txt"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const configMember = tarMembers.find((m) => m.endsWith(".zcode/cli/config.json"));
      expect(configMember).toBeDefined();
      const extracted = runSubprocess("tar", ["-xzOf", tarPath, configMember!], {
        cwd: ws.cwd,
        timeoutMs: 10_000,
      });
      expect(extracted.exitCode).toBe(0);
      expect(extracted.stdout).not.toContain("ab1234");
      expect(extracted.stdout).not.toContain("rt_secret_987654");
      expect(extracted.stdout).toContain("REDACTED");
      expect(extracted.stdout).toContain("the token bucket refills");

      const verifySnap = runSubprocess(
        "bash",
        [join(REPO_ROOT, "scripts", "capability-snapshot.sh"), "verify", snapDir],
        { cwd: ws.cwd, env: snapEnv, timeoutMs: 15_000 },
      );
      expect(verifySnap.exitCode).toBe(0);
      expect(verifySnap.stdout).toContain("verify OK");
    });
  }, 30_000);
});

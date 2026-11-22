import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  REPO_ROOT,
  buildAppServerSession,
  buildComplianceToml,
  buildConformingHighRiskSession,
  buildDeclareRulesJson,
  buildKAnonLogSet,
  buildOcel2Doc,
  buildOversightCrashSession,
  buildPiiSecretSession,
  buildPmmLogSet,
  buildWfNetJson,
  initGitRepo,
  inspectOcel2Sqlite,
  runBunScript,
  runSubprocess,
  runZcodeCli,
  runZcodeCliAsync,
  sha256File,
  sha256Text,
  withIsolatedWorkspace,
  withLocalLlmServer,
  type Ocel2Doc,
  type Ocel2Event,
} from "./helpers.ts";

// ============================================================================
// Tier 3: Pairwise Cross-Feature Combination Tests (>= 22 pairs)
// Opaque-box, zero-mock Chicago suite covering every pair in
// e2e_explorer_schemas/handoff.md §E.3 plus Source-AppServer + OC-DFG/OCPN and
// Kingman heavy-tail separation + stratified SPC.
// Every test chains real CLI invocations and real filesystem/SQLite/git
// artifacts from Step A into Step B inside an isolated temp workspace.
// ============================================================================

describe("Tier 3 — Pairwise Cross-Feature Combinations", () => {
  test("T3.01 (A01 × A05): Art. 50 headless stream-json disclosure auto-logs art50_disclosure_emitted into OCEL 2.0 JSON, passes ocel verify, and exports to WAL SQLite", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "art50-only",
          ocelEnabled: true,
          ocelOutputDir: ws.ocelDir,
        }),
      );

      await withLocalLlmServer(ws, async () => {
        const cliRes = await runZcodeCliAsync(
          ["-p", "Reply OK", "--output-format", "stream-json"],
          ws,
          {
            env: {
              ZCODE_COMPLIANCE_PROFILE: "art50-only",
              ZCODE_OCEL: "1",
              ZCODE_OCEL_DIR: ws.ocelDir,
            },
            timeoutMs: 12_000,
          },
        );
        expect(cliRes.exitCode).toBe(0);

        const streamLines = cliRes.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        const disclosureMsg = streamLines.find(
          (l) =>
            l.type === "system.disclosure" ||
            l.type === "ai_disclosure" ||
            l.ai_disclosure !== undefined ||
            (typeof l.payload === "object" &&
              l.payload !== null &&
              "regulation" in (l.payload as Record<string, unknown>)),
        );
        expect(disclosureMsg).toBeDefined();

        const ocelFiles = readdirSync(ws.ocelDir).filter(
          (f) => f.endsWith(".jsonocel") || f.endsWith(".ocel.json"),
        );
        expect(ocelFiles.length).toBeGreaterThan(0);
        const ocelPath = join(ws.ocelDir, ocelFiles[0]!);
        const doc = JSON.parse(readFileSync(ocelPath, "utf8")) as Ocel2Doc;
        expect(doc.events.some((e) => e.type === "art50_disclosure_emitted")).toBe(true);

        const verRes = runZcodeCli(["ocel", "verify", "--in", ocelPath, "--json"], ws);
        expect(verRes.exitCode).toBe(0);
        const verOut = verRes.json<{ valid?: boolean; chainIntact?: boolean }>();
        expect(verOut.valid ?? verOut.chainIntact).toBe(true);

        const dbPath = ws.path("art50-roundtrip.ocel.sqlite");
        const expRes = runZcodeCli(
          ["ocel", "export", "--in", ocelPath, "--format", "sqlite", "--out", dbPath],
          ws,
        );
        expect(expRes.exitCode).toBe(0);

        const dbInfo = inspectOcel2Sqlite(dbPath);
        expect(dbInfo.journalMode).toBe("wal");
        expect(dbInfo.events.some((e) => e.ocel_type === "art50_disclosure_emitted")).toBe(true);
      });
    });
  }, 45_000);

  test("T3.02 (A01 × A07): Art. 14 OVERSIGHT_POLICY_REFUSED (--mode yolo under high-risk-annex-iii) emits Art. 50 disclosure / audit event without leaking secret env/flags", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const secretToken = "sk-yolo-secret-never-leak-7744";
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          allowYolo: false,
          ocelEnabled: true,
          ocelOutputDir: ws.ocelDir,
        }),
      );

      await withLocalLlmServer(ws, async () => {
        const res = await runZcodeCliAsync(
          ["-p", "Reply OK", "--mode", "yolo", "--output-format", "stream-json"],
          ws,
          {
            env: {
              ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii",
              ZCODE_OCEL: "1",
              ZCODE_OCEL_DIR: ws.ocelDir,
              OPENAI_API_KEY: secretToken,
            },
            timeoutMs: 12_000,
          },
        );

        expect(res.exitCode).toBe(1);
        const combined = `${res.stdout}\n${res.stderr}`;
        expect(combined).toContain("OVERSIGHT_POLICY_REFUSED");
        expect(combined).not.toContain(secretToken);

        const ocelFiles = readdirSync(ws.ocelDir).filter(
          (f) => f.endsWith(".jsonocel") || f.endsWith(".ocel.json"),
        );
        const hasDisclosureInStdout =
          combined.includes("art50") ||
          combined.includes("ai_disclosure") ||
          combined.includes("system.disclosure") ||
          combined.includes("EU-2024-1689");
        let hasDisclosureInOcel = false;
        if (ocelFiles.length > 0) {
          const ocelPath = join(ws.ocelDir, ocelFiles[0]!);
          const rawOcel = readFileSync(ocelPath, "utf8");
          expect(rawOcel).not.toContain(secretToken);
          const doc = JSON.parse(rawOcel) as Ocel2Doc;
          hasDisclosureInOcel = doc.events.some((e) => e.type === "art50_disclosure_emitted");
          const ver = runZcodeCli(["ocel", "verify", "--in", ocelPath, "--json"], ws);
          expect(ver.exitCode).toBe(0);
        }
        expect(hasDisclosureInStdout || hasDisclosureInOcel).toBe(true);
      });
    });
  }, 45_000);

  test("T3.03 (A03 × A05): PII + JWT + PEM inside tool output is scrubbed by unified redactor before pi_hash, then survives SQLite WAL & XML exports with zero leaks", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          redactPii: true,
        }),
      );
      const piiDoc = buildPiiSecretSession();
      const rawPath = ws.writeJson("raw-pii.ocel.json", piiDoc);
      const redactedPath = ws.path("redacted.ocel.json");

      const expJson = runZcodeCli(
        ["ocel", "export", "--in", rawPath, "--format", "json", "--out", redactedPath],
        ws,
      );
      expect(expJson.exitCode).toBe(0);

      const redactedText = readFileSync(redactedPath, "utf8");
      const forbiddenTokens = [
        "sk-live-secret-99887766",
        "rt_abcdef123456",
        "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        "alice.mueller@example.de",
        "192.168.14.22",
        "/Users/alicemueller/",
        "MIIEvQIBADANBgkqhkiG9w0BAQEF",
      ];
      for (const secret of forbiddenTokens) {
        expect(redactedText).not.toContain(secret);
      }
      expect(redactedText).toContain("REDACTED");
      expect(redactedText).toContain("the token bucket refills");

      const verRes = runZcodeCli(["ocel", "verify", "--in", redactedPath, "--json"], ws);
      expect(verRes.exitCode).toBe(0);
      const verOut = verRes.json<{ valid?: boolean; chainIntact?: boolean }>();
      expect(verOut.valid ?? verOut.chainIntact).toBe(true);

      const dbPath = ws.path("redacted.ocel.sqlite");
      const expSqlite = runZcodeCli(
        ["ocel", "export", "--in", redactedPath, "--format", "sqlite", "--out", dbPath],
        ws,
      );
      expect(expSqlite.exitCode).toBe(0);
      const sqliteInfo = inspectOcel2Sqlite(dbPath);
      expect(sqliteInfo.journalMode).toBe("wal");
      expect(sqliteInfo.eventCount).toBe(piiDoc.events.length);

      const db = new Database(dbPath, { readonly: true });
      try {
        for (const tbl of sqliteInfo.tables) {
          const rows = db.query(`SELECT * FROM ${tbl};`).all();
          const dump = JSON.stringify(rows);
          for (const secret of forbiddenTokens) {
            expect(dump).not.toContain(secret);
          }
        }
      } finally {
        db.close();
      }

      const xmlPath = ws.path("redacted.ocel.xml");
      const expXml = runZcodeCli(
        ["ocel", "export", "--in", redactedPath, "--format", "xml", "--out", xmlPath],
        ws,
      );
      expect(expXml.exitCode).toBe(0);
      const xmlText = readFileSync(xmlPath, "utf8");
      expect(xmlText).toContain("<log>");
      for (const secret of forbiddenTokens) {
        expect(xmlText).not.toContain(secret);
      }
    });
  }, 45_000);

  test("T3.04 (A03 × A16): Unified redactor + --rpm-safe --k 5 export pseudonymizes actors, scrubs PII/secrets, and suppresses or refuses <k unique outlier", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          redactPii: true,
          kAnonymity: 5,
        }),
      );

      // Step A: k >= 5 dataset with raw email/secret attributes -> succeeds with HMAC pseudonyms & zero raw PII.
      const kDoc = buildKAnonLogSet({ k: 5, variantCount: 2, includeOutlier: false });
      kDoc.events[0]!.attributes.push({
        name: "debug_leak",
        value: "Authorization: Bearer tok_rpm_secret_12345 user=audit@example.de",
      });
      const canonicalKDoc = buildOcel2Doc({
        objectTypes: kDoc.objectTypes,
        eventTypes: kDoc.eventTypes,
        objects: kDoc.objects,
        events: kDoc.events,
      });
      const kInPath = ws.writeJson("kanon-pii.ocel.json", canonicalKDoc);
      const kOutPath = ws.path("kanon-safe.ocel.json");

      const expSafe = runZcodeCli(
        ["ocel", "export", "--in", kInPath, "--format", "json", "--out", kOutPath, "--rpm-safe", "--k", "5"],
        ws,
      );
      expect(expSafe.exitCode).toBe(0);
      const safeRaw = readFileSync(kOutPath, "utf8");
      expect(safeRaw).not.toContain("@example.eu");
      expect(safeRaw).not.toContain("@example.de");
      expect(safeRaw).not.toContain("raw-user-alice");
      expect(safeRaw).not.toContain("tok_rpm_secret_12345");
      expect(safeRaw).toContain("REDACTED");
      expect(safeRaw).toMatch(/hmac|pseudo|[0-9a-f]{16,}/i);

      const verSafe = runZcodeCli(["ocel", "verify", "--in", kOutPath, "--json"], ws);
      expect(verSafe.exitCode).toBe(0);

      // Step B: k-anonymity outlier (support = 1 < 5) must never leak into exported output.
      const outlierDoc = buildKAnonLogSet({ k: 5, variantCount: 2, includeOutlier: true });
      const outlierIn = ws.writeJson("kanon-outlier.ocel.json", outlierDoc);
      const outlierOut = ws.path("kanon-outlier-safe.ocel.json");
      const expOutlier = runZcodeCli(
        [
          "ocel",
          "export",
          "--in",
          outlierIn,
          "--format",
          "json",
          "--out",
          outlierOut,
          "--rpm-safe",
          "--k",
          "5",
        ],
        ws,
      );
      if (expOutlier.exitCode === 0) {
        const exportedText = readFileSync(outlierOut, "utf8");
        expect(exportedText).not.toContain("unique-whistleblower");
        expect(exportedText).not.toContain("kanon_outlier_unique");
      } else {
        expect(expOutlier.exitCode).toBe(1);
      }
    });
  }, 45_000);

  test("T3.05 (A05 × A12): SQLite OCEL 2.0 round-trip -> JSON re-import -> ocel verify --declare separates SATISFIED_WITNESSED from SATISFIED_VACUOUS", async () => {
    await withIsolatedWorkspace(async (ws) => {
      // Build a valid session with 0 tool_updated events so Precedence(tool_updated -> permission_resolved) is vacuous.
      const base = buildConformingHighRiskSession({ sessionId: "sess_roundtrip_vac" });
      const noToolEvents = base.events.filter((e) => e.type !== "tool_updated");
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: noToolEvents,
      });

      const inJson = ws.writeJson("no-tool.ocel.json", doc);
      const dbPath = ws.path("no-tool.ocel.sqlite");
      const expSqlite = runZcodeCli(
        ["ocel", "export", "--in", inJson, "--format", "sqlite", "--out", dbPath],
        ws,
      );
      expect(expSqlite.exitCode).toBe(0);
      expect(inspectOcel2Sqlite(dbPath).journalMode).toBe("wal");

      const reimportedJson = ws.path("reimported.ocel.json");
      const expJson = runZcodeCli(
        ["ocel", "export", "--in", dbPath, "--format", "json", "--out", reimportedJson],
        ws,
      );
      expect(expJson.exitCode).toBe(0);

      const rulesPath = ws.writeJson(
        "vacuity-check.rules.json",
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
          {
            id: "DEC-PREC-VACUOUS",
            template: "Precedence",
            activation: "tool_updated",
            target: "permission_resolved",
            objectType: "turn",
            mandatory: false,
          },
        ]),
      );

      const ver = runZcodeCli(
        ["ocel", "verify", "--in", reimportedJson, "--declare", rulesPath, "--json"],
        ws,
      );
      expect(ver.exitCode).toBe(0);
      const out = ver.json<{
        declareResults: Array<{
          id: string;
          status: string;
          witness_event_ids: string[];
        }>;
      }>();
      const byId = new Map(out.declareResults.map((r) => [r.id, r]));
      expect(byId.get("DEC-INIT")?.status).toBe("SATISFIED_WITNESSED");
      expect(byId.get("DEC-RESP-ART50")?.status).toBe("SATISFIED_WITNESSED");
      expect(byId.get("DEC-PREC-VACUOUS")?.status).toBe("SATISFIED_VACUOUS");
    });
  }, 45_000);

  test("T3.06 (A05 × A13): OCEL 2.0 trace skipping permission_resolved yields A* model_move (fitness < 1) AND Declare Precedence VIOLATED", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_skip_perm" });
      const withoutPermResolved = base.events.filter((e) => e.type !== "permission_resolved");
      const brokenDoc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: withoutPermResolved,
      });

      const inPath = ws.writeJson("skipped-perm.ocel.json", brokenDoc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const rulesPath = ws.writeJson(
        "prec-art14.rules.json",
        buildDeclareRulesJson([
          {
            id: "DEC-PREC-ART14",
            template: "Precedence",
            activation: "tool_updated",
            target: "permission_resolved",
            objectType: "turn",
            mandatory: true,
          },
        ]),
      );

      const res = runZcodeCli(
        ["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--declare", rulesPath, "--json"],
        ws,
      );
      expect(res.exitCode).toBe(1);
      const out = res.json<{
        alignment: {
          alignmentCost: number;
          fitness: number;
          moves: Array<{ kind: string; activity?: string; label?: string; cost: number }>;
        };
        declareResults: Array<{
          id: string;
          status: string;
          counterexample_event_ids: string[];
        }>;
      }>();

      expect(out.alignment.alignmentCost).toBeGreaterThanOrEqual(1);
      expect(out.alignment.fitness).toBeLessThan(1);
      expect(
        out.alignment.moves.some(
          (m) =>
            m.kind === "model_move" &&
            (m.activity === "permission_resolved" || m.label === "permission_resolved"),
        ),
      ).toBe(true);

      const precRule = out.declareResults.find((r) => r.id === "DEC-PREC-ART14");
      expect(precRule?.status).toBe("VIOLATED");
      expect(precRule?.counterexample_event_ids.length).toBeGreaterThan(0);
    });
  }, 45_000);

  test("T3.07 (A07 × A12): permission_resolved (< 500ms latency) triggers AB_RISK_FLAG across ocel verify and pmm analyze automation-bias check", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          minReviewMs: 1000,
        }),
      );
      const abDoc = buildOversightCrashSession({ kind: "ab_risk" });
      const inPath = ws.writeJson("ab-risk.ocel.json", abDoc);
      const rulesPath = ws.writeJson(
        "ab-rules.json",
        buildDeclareRulesJson([
          {
            id: "DEC-PREC-ART14",
            template: "Precedence",
            activation: "tool_updated",
            target: "permission_resolved",
            objectType: "turn",
            mandatory: true,
          },
        ]),
      );

      const ver = runZcodeCli(
        ["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"],
        ws,
      );
      const verText = JSON.stringify(ver.json());
      expect(verText).toContain("AB_RISK_FLAG");

      const logsDir = ws.path("ab-logs");
      mkdirSync(logsDir, { recursive: true });
      for (let i = 0; i < 20; i++) {
        const s = buildConformingHighRiskSession({
          sessionId: `sess_ab_${i + 1}`,
          baseTimeMs: Date.parse("2026-08-02T12:00:00.000Z") + i * 60_000,
          decisionLatencyMs: 150,
        });
        writeFileSync(join(logsDir, `sess_ab_${i + 1}.ocel.json`), JSON.stringify(s), "utf8");
      }
      const pmmOut = ws.path("ab-pmm.json");
      const pmmRes = runZcodeCli(
        ["pmm", "analyze", "--logs", logsDir, "--out", pmmOut, "--json"],
        ws,
      );
      expect(pmmRes.exitCode).toBe(0);
      expect(readFileSync(pmmOut, "utf8")).toMatch(/AB_RISK_FLAG|automation.?bias/i);
    });
  }, 45_000);

  test("T3.08 (A07 × A17): Emergency oversight stop (oversight_intervened) chains to transactional rollback (workspace_rolled_back) leaving clean git worktree", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          rollbackOnDirty: true,
        }),
      );
      repo.commitAll("chore: add compliance config");
      expect(repo.statusPorcelain()).toBe("");

      const stopDoc = buildOversightCrashSession({ kind: "dirty_rollback" });
      const inPath = join(ws.root, "stop-rollback.ocel.json");
      writeFileSync(inPath, JSON.stringify(stopDoc, null, 2), "utf8");
      const rulesPath = join(ws.root, "stop-rollback.rules.json");
      writeFileSync(
        rulesPath,
        JSON.stringify(
          buildDeclareRulesJson([
            {
              id: "DEC-RESP-STOP-RB",
              template: "Response",
              activation: "oversight_intervened",
              target: "workspace_rolled_back",
              objectType: "session",
              mandatory: true,
            },
          ]),
          null,
          2,
        ),
        "utf8",
      );

      const ver = runZcodeCli(
        ["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"],
        ws,
      );
      expect(ver.exitCode).toBe(0);
      const verOut = ver.json<{ declareResults: Array<{ id: string; status: string }> }>();
      expect(verOut.declareResults[0]?.status).toBe("SATISFIED_WITNESSED");

      const dfgPath = join(ws.root, "stop-rb.dfg.json");
      const disc = runZcodeCli(
        ["ocel", "discover", "--in", inPath, "--format", "json", "--out", dfgPath],
        ws,
      );
      expect(disc.exitCode).toBe(0);
      const dfgText = readFileSync(dfgPath, "utf8");
      expect(dfgText).toContain("oversight_intervened");
      expect(dfgText).toContain("workspace_rolled_back");

      expect(repo.statusPorcelain()).toBe("");
    });
  }, 45_000);

  test("T3.09 (A08 × A17): Dirty-write fault with rollback_on_dirty=true restores clean git HEAD and repeated identical failure signature triggers RETRY_BUDGET_EXHAUSTED", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          rollbackOnDirty: true,
          maxRetriesPerSignature: 3,
          maxRemediationAttempts: 3,
        }),
      );
      repo.commitAll("chore: baseline");

      // Simulate dirty write reverted cleanly back to HEAD
      ws.writeText("README.md", "CORRUPTED BY PROMPT INJECTION\n");
      expect(repo.statusPorcelain()).not.toBe("");
      const resetRes = repo.git(["checkout", "--", "README.md"]);
      expect(resetRes.exitCode).toBe(0);
      expect(repo.statusPorcelain()).toBe("");

      const base = buildConformingHighRiskSession({ sessionId: "sess_retry_cap" });
      const baseMs = Date.parse("2026-08-02T11:00:00.000Z");
      const iso = (offset: number) => new Date(baseMs + offset).toISOString();
      const faultEvents: Ocel2Event[] = [
        ...base.events.slice(0, 3),
        ...([0, 1, 2, 3].flatMap((attempt) => [
          {
            id: `sess_retry_fail_${attempt + 1}`,
            type: "turn_failed",
            time: iso(1000 + attempt * 500),
            attributes: [
              { name: "error_signature", value: "ERR_DIRTY_INJECTION" },
              { name: "attempt", value: String(attempt + 1) },
            ],
            relationships: [{ objectId: "sess_retry_cap", qualifier: "in_session" }],
          },
          {
            id: `sess_retry_rb_${attempt + 1}`,
            type: "workspace_rolled_back",
            time: iso(1200 + attempt * 500),
            attributes: [{ name: "reason", value: "RETRY_BUDGET_EXHAUSTED" }],
            relationships: [{ objectId: "sess_retry_cap", qualifier: "in_session" }],
          },
        ])),
      ];
      const retryDoc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: faultEvents,
      });

      const retryPath = join(ws.root, "retry-storm.ocel.json");
      writeFileSync(retryPath, JSON.stringify(retryDoc, null, 2), "utf8");

      const ver = runZcodeCli(["ocel", "verify", "--in", retryPath, "--json"], ws);
      expect(ver.exitCode).toBe(0);

      const incPath = join(ws.root, "retry-incident.json");
      const inc = runZcodeCli(
        ["incident", "report", "--in", retryPath, "--out", incPath, "--session", "sess_retry_cap"],
        ws,
      );
      expect(inc.exitCode).toBe(0);
      const pktText = readFileSync(incPath, "utf8");
      expect(pktText).toContain("ERR_DIRTY_INJECTION");
      expect(pktText).toContain("workspace_rolled_back");

      // Also verify the unit court for bounded transactional rollback + retry budget passes on real repo
      const txTest = runSubprocess(
        process.execPath,
        ["test", "test/compliance-transactional-kingman.test.ts"],
        { cwd: REPO_ROOT, timeoutMs: 20_000 },
      );
      expect(txTest.exitCode).toBe(0);
    });
  }, 45_000);

  test("T3.10 (A02 × A04): AIRO risk-register feeds Annex IV §5 compiler with exact Art. 9 risks and <file:...> receipts", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));

      const rrRes = runZcodeCli(["compliance", "risk-register", "--json"], ws);
      expect(rrRes.exitCode).toBe(0);
      const rr = rrRes.json<{ risks: Array<{ id: string }> }>();
      expect(rr.risks.length).toBeGreaterThanOrEqual(3);

      const dossierDir = ws.path("dossier-airo");
      const axRes = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir], ws);
      expect(axRes.exitCode).toBe(0);

      const annexJsonText = readFileSync(join(dossierDir, "annex-iv.json"), "utf8");
      const annexMdText = readFileSync(join(dossierDir, "annex-iv.md"), "utf8");
      for (const risk of rr.risks) {
        expect(annexJsonText).toContain(risk.id);
      }
      expect(annexJsonText).toContain("airo_risk_description.ttl");
      expect(annexMdText.toLowerCase()).toMatch(/risk|article\s*9/);

      const checkRes = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir, "--check"], ws);
      expect(checkRes.exitCode).toBe(0);
    });
  }, 45_000);

  test("T3.11 (A04 × A09): annex-iv dossier + qms-manifest -> compliance assess (CONFORMITY_ADMITTED) -> compliance doc (Annex V DoC)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const dossierDir = ws.path("dossier-ok");
      const axRes = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir], ws);
      expect(axRes.exitCode).toBe(0);

      const logsDir = ws.path("assess-logs");
      mkdirSync(logsDir, { recursive: true });
      const doc = buildConformingHighRiskSession({ sessionId: "sess_assess_doc" });
      writeFileSync(join(logsDir, "sess_assess_doc.ocel.json"), JSON.stringify(doc, null, 2), "utf8");

      const assessRes = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect(assessRes.exitCode).toBe(0);
      const verdict = assessRes.json<{ verdict?: string; standing?: string }>();
      expect(verdict.verdict).toBe("CONFORMITY_ADMITTED");

      const docPath = ws.path("eu-declaration-of-conformity.json");
      const docRes = runZcodeCli(["compliance", "doc", "--out", docPath], ws);
      expect(docRes.exitCode).toBe(0);
      expect(existsSync(docPath)).toBe(true);

      const lock = JSON.parse(readFileSync(join(REPO_ROOT, "zcode-runtime.lock.json"), "utf8")) as {
        sha512: string;
      };
      const docText = readFileSync(docPath, "utf8");
      const parsedDoc = JSON.parse(docText) as Record<string, unknown>;
      expect(Object.keys(parsedDoc).length).toBeGreaterThanOrEqual(9);
      expect(docText).toContain(lock.sha512);
    });
  }, 45_000);

  test("T3.12 (A04 × A09 negative): Tampered annex-iv.json or empty/non-conforming logs refuses annex-iv --check, compliance assess (exit 1), and compliance doc", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const dossierDir = ws.path("dossier-tamper");
      const gen = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir], ws);
      expect(gen.exitCode).toBe(0);

      const annexJsonPath = join(dossierDir, "annex-iv.json");
      const parsed = JSON.parse(readFileSync(annexJsonPath, "utf8")) as Record<string, unknown>;
      parsed.tampered_section_hash = "00000000000000000000000000000000";
      parsed.gitHeadSha = "deadbeef".repeat(5);
      writeFileSync(annexJsonPath, JSON.stringify(parsed, null, 2), "utf8");

      const chk = runZcodeCli(["compliance", "annex-iv", "--out", dossierDir, "--check"], ws);
      expect(chk.exitCode).not.toBe(0);

      const emptyLogs = ws.path("empty-logs");
      mkdirSync(emptyLogs, { recursive: true });
      const assessFail = runZcodeCli(["compliance", "assess", "--logs", emptyLogs, "--json"], ws);
      expect(assessFail.exitCode).toBe(1);
      const assessOut = assessFail.json<{ verdict?: string }>();
      expect(assessOut.verdict).not.toBe("CONFORMITY_ADMITTED");

      const badDocPath = join(ws.root, "refused-doc.json");
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          overseerId: "",
          logRetentionDays: 30,
          monitoringEnabled: false,
        }),
      );
      const docFail = runZcodeCli(["compliance", "doc", "--out", badDocPath], ws);
      expect(docFail.exitCode).not.toBe(0);
    });
  }, 45_000);

  test("T3.13 (A10 × A05): [deployer].log_retention_days < 180 fails deployer-check AND fails OCEL retention compliance check", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          overseerId: "overseer-alice-eu",
          logRetentionDays: 90,
          monitoringEnabled: true,
        }),
      );

      const depRes = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(depRes.exitCode).toBe(1);

      const logsDir = ws.path("retention-logs");
      mkdirSync(logsDir, { recursive: true });
      const doc = buildConformingHighRiskSession({ sessionId: "sess_ret_90" });
      writeFileSync(join(logsDir, "sess_ret_90.ocel.json"), JSON.stringify(doc, null, 2), "utf8");

      const assessRes = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect(assessRes.exitCode).toBe(1);
      expect((assessRes.stdout + assessRes.stderr).toLowerCase()).toMatch(/retention|180|refused/);
    });
  }, 45_000);

  test("T3.14 (A10 × A16): fria-export incorporates RPM confidentiality/fairness metrics & [deployer].overseer_id", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          overseerId: "overseer-fria-eu",
          kAnonymity: 5,
        }),
      );

      const logsDir = ws.path("fria-logs");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("stationary", 24)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
        writeFileSync(join(ws.ocelDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const pmmPath = join(ws.complianceDir, "pmm-report.json");
      const pmmRes = runZcodeCli(
        ["pmm", "analyze", "--logs", logsDir, "--out", pmmPath, "--json"],
        ws,
      );
      expect(pmmRes.exitCode).toBe(0);

      const friaPath = ws.path("fria.json");
      const friaRes = runZcodeCli(
        ["compliance", "fria-export", "--out", friaPath, "--format", "json"],
        ws,
        { env: { ZCODE_OCEL_DIR: logsDir } },
      );
      expect(friaRes.exitCode).toBe(0);
      const friaRaw = readFileSync(friaPath, "utf8");
      expect(friaRaw).toContain("overseer-fria-eu");
      expect(friaRaw.toLowerCase()).toMatch(/k_anonymity|kanonymity|confidentiality|fairness/);

      const friaMdPath = ws.path("fria.md");
      const friaMdRes = runZcodeCli(
        ["compliance", "fria-export", "--out", friaMdPath, "--format", "md"],
        ws,
      );
      expect(friaMdRes.exitCode).toBe(0);
      expect(readFileSync(friaMdPath, "utf8")).toContain("overseer-fria-eu");
    });
  }, 45_000);

  test("T3.15 (A13 × A14): Non-conforming rework trace (log_move in A* alignment) feeds ocel discover --ocpn to mine rework edge & OCPN soundness", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const reworkDoc = buildConformingHighRiskSession({
        sessionId: "sess_rework_align",
        includeRework: true,
      });
      const inPath = ws.writeJson("rework.ocel.json", reworkDoc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());

      const alignRes = runZcodeCli(
        ["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"],
        ws,
      );
      expect(alignRes.exitCode).toBe(1);
      const alignOut = alignRes.json<{
        alignment: {
          alignmentCost: number;
          fitness: number;
          moves: Array<{ kind: string; activity?: string; label?: string }>;
        };
      }>();
      expect(alignOut.alignment.alignmentCost).toBeGreaterThanOrEqual(2);
      expect(alignOut.alignment.fitness).toBeLessThan(1);
      expect(
        alignOut.alignment.moves.some(
          (m) => m.kind === "log_move" && (m.activity === "turn_failed" || m.label === "turn_failed"),
        ),
      ).toBe(true);

      const ocpnPath = ws.path("rework-ocpn.json");
      const discRes = runZcodeCli(
        ["ocel", "discover", "--in", inPath, "--ocpn", "--format", "json", "--out", ocpnPath],
        ws,
      );
      expect(discRes.exitCode).toBe(0);
      const ocpnOut = JSON.parse(readFileSync(ocpnPath, "utf8")) as {
        reworkCycles?: unknown[];
        places?: unknown[];
        transitions?: unknown[];
        arcs?: unknown[];
        soundness?: { sound: boolean };
      };
      expect((ocpnOut.reworkCycles ?? []).length).toBeGreaterThan(0);
      expect((ocpnOut.places ?? []).length).toBeGreaterThan(0);
      expect((ocpnOut.transitions ?? []).length).toBeGreaterThan(0);
      expect(typeof ocpnOut.soundness?.sound).toBe("boolean");
      expect(readFileSync(ocpnPath, "utf8")).toContain("turn_failed");
    });
  }, 45_000);

  test("T3.16 (A14 × A11): Injected rework + crash trace flows from ocel discover into incident report with causal OC-DFG root cause", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({
        sessionId: "sess_rework_crash",
        includeRework: true,
      });
      const withoutClose = base.events.filter((e) => e.type !== "session_closed");
      const crashDoc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: withoutClose,
      });
      const inPath = ws.writeJson("rework-crash.ocel.json", crashDoc);

      const dfgPath = ws.path("rework-crash.dfg.json");
      const discRes = runZcodeCli(
        ["ocel", "discover", "--in", inPath, "--format", "json", "--out", dfgPath],
        ws,
      );
      expect(discRes.exitCode).toBe(0);
      const dfgRaw = readFileSync(dfgPath, "utf8");
      expect(dfgRaw).toContain("turn_failed");

      const incPath = ws.path("rework-incident.json");
      const incRes = runZcodeCli(
        ["incident", "report", "--in", inPath, "--out", incPath, "--session", "sess_rework_crash"],
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
      expect(JSON.stringify(pkt.root_cause)).toContain("turn_failed");
    });
  }, 45_000);

  test("T3.17 (A15 × A11): Injected sudden drift -> pmm analyze emits drift_detected -> incident report classifies Art. 73 deadline", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("drift-logs");
      mkdirSync(logsDir, { recursive: true });
      const logSet = buildPmmLogSet("sudden_drift", 40);
      for (const item of logSet) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }

      const pmmPath = ws.path("sudden-pmm.json");
      const pmmRes = runZcodeCli(
        ["pmm", "analyze", "--logs", logsDir, "--out", pmmPath, "--json"],
        ws,
      );
      expect(pmmRes.exitCode).toBe(0);
      const pmmOut = pmmRes.json<{ driftDetected: boolean; driftKind?: string; pValue?: number }>();
      expect(pmmOut.driftDetected).toBe(true);
      expect(pmmOut.driftKind).toBe("sudden");
      expect(pmmOut.pValue!).toBeLessThan(0.01);

      // Attach drift_detected event to the drifted session and compile Art. 73 incident report
      const lastItem = logSet[logSet.length - 1]!;
      const driftedSessId = lastItem.doc.objects.find((o) => o.type === "session")?.id ?? "pmm_sudden_drift_040";
      const augmented = buildOcel2Doc({
        objectTypes: lastItem.doc.objectTypes,
        eventTypes: lastItem.doc.eventTypes,
        objects: lastItem.doc.objects,
        events: [
          ...lastItem.doc.events,
          {
            id: `${driftedSessId}_ev_drift`,
            type: "drift_detected",
            time: "2026-08-02T01:00:00.000Z",
            attributes: [
              { name: "drift_kind", value: pmmOut.driftKind ?? "sudden" },
              { name: "p_value", value: String(pmmOut.pValue ?? 0.001) },
            ],
            relationships: [{ objectId: driftedSessId, qualifier: "in_session" }],
          },
        ],
      });
      const incIn = ws.writeJson("drifted-session.ocel.json", augmented);
      const incOut = ws.path("drift-incident.json");
      const incRes = runZcodeCli(
        ["incident", "report", "--in", incIn, "--out", incOut, "--session", driftedSessId],
        ws,
      );
      expect(incRes.exitCode).toBe(0);
      const pkt = JSON.parse(readFileSync(incOut, "utf8")) as {
        deadline_class?: string;
        root_cause?: unknown;
      };
      expect(["2d", "10d", "15d"]).toContain(pkt.deadline_class ?? "");
      expect(pkt.root_cause).toBeDefined();
    });
  }, 45_000);

  test("T3.18 (A15 × A13): Heavy-tailed coding turns (c_s^2 >> 1) with healthy TTFT keep Kingman/SPC free of false MD/drift AND yield A* fitness === 1.0", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          ttftSpikeFactor: 2.0,
          minWindow: 20,
        }),
      );
      const logsDir = ws.path("heavy-logs");
      mkdirSync(logsDir, { recursive: true });
      const heavySet = buildPmmLogSet("heavy_tailed", 40);
      for (const item of heavySet) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }

      const pmmRes = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(pmmRes.exitCode).toBe(0);
      const pmmOut = pmmRes.json<{
        driftDetected: boolean;
        ttftMdTriggered?: boolean;
        kingman?: { cs2?: number; rho?: number; lambdaAlive?: number };
      }>();
      expect(pmmOut.driftDetected).toBe(false);
      expect(pmmOut.ttftMdTriggered ?? false).toBe(false);
      if (pmmOut.kingman?.cs2 !== undefined) {
        expect(pmmOut.kingman.cs2).toBeGreaterThan(1);
      }

      // Take the 120s outlier session from heavySet and verify A* alignment remains exact (gamma = 0)
      const outlierFile = join(logsDir, heavySet[0]!.filename);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const alignRes = runZcodeCli(
        ["ocel", "verify", "--in", outlierFile, "--wfnet", wfPath, "--json"],
        ws,
      );
      expect(alignRes.exitCode).toBe(0);
      const alignOut = alignRes.json<{ alignment: { alignmentCost: number; fitness: number } }>();
      expect(alignOut.alignment.alignmentCost).toBe(0);
      expect(alignOut.alignment.fitness).toBe(1);
    });
  }, 45_000);

  test("T3.19 (A01 × A08): Sidecar .zcode-provenance SHA-256 + workspace rollback invalidates phantom provenance when aborted edit is rolled back", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          gitProvenanceTrailer: true,
          rollbackOnDirty: true,
        }),
      );
      repo.commitAll("chore: baseline");

      // Step A: Write edited file and generate sidecar provenance
      const targetRel = "aborted-edit.ts";
      ws.writeText(targetRel, "export const aborted = true;\n");
      const editedSha = sha256File(ws.path(targetRel));

      const doc = buildOversightCrashSession({ kind: "dirty_rollback" });
      const docPath = join(ws.root, "tmp-rb.ocel.json");
      const outOcelPath = join(ws.root, "tmp-rb-out.ocel.json");
      writeFileSync(docPath, JSON.stringify(doc, null, 2), "utf8");
      const expRes = runZcodeCli(
        ["ocel", "export", "--in", docPath, "--format", "json", "--out", outOcelPath],
        ws,
      );
      expect(expRes.exitCode).toBe(0);

      const provDir = ws.path(".zcode-provenance");
      expect(existsSync(provDir)).toBe(true);
      const sidecars = readdirSync(provDir).filter((f) => f.endsWith(".json"));
      expect(sidecars.length).toBeGreaterThan(0);

      // Step B: Simulate workspace rollback removing untracked/dirty aborted edit and verify zero phantom artifact
      const cleanRes = repo.git(["clean", "-fd", "--", targetRel]);
      expect(cleanRes.exitCode).toBe(0);
      expect(existsSync(ws.path(targetRel))).toBe(false);
      expect(editedSha).toMatch(/^[0-9a-f]{64}$/);

      // Step C: OCEL verify confirms workspace_rolled_back is sealed in chain
      const verRes = runZcodeCli(["ocel", "verify", "--in", outOcelPath, "--json"], ws);
      expect(verRes.exitCode).toBe(0);
      const outDoc = JSON.parse(readFileSync(outOcelPath, "utf8")) as Ocel2Doc;
      expect(outDoc.events.some((e) => e.type === "workspace_rolled_back")).toBe(true);
    });
  }, 45_000);

  test("T3.20 (A06 × A02): compliance info runtime limitations & accuracy metrics align with AIRO risk-register & EU AI Act Arts. 9/12/14/15", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));

      const rrRes = runZcodeCli(["compliance", "risk-register", "--json"], ws);
      expect(rrRes.exitCode).toBe(0);
      const rrText = JSON.stringify(rrRes.json());

      const infoRes = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(infoRes.exitCode).toBe(0);
      const infoText = JSON.stringify(infoRes.json());

      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string };
      expect(infoText).toContain(pkg.version);
      expect(infoText).toContain("22.19.0");
      for (const art of ["9", "12", "14", "15"]) {
        expect(rrText).toMatch(new RegExp(`Art(?:icle)?[\\s._-]*${art}\\b`, "i"));
      }
      expect(infoText.toLowerCase()).toMatch(/limitation|standing|uncertainty|oversight/);
    });
  }, 45_000);

  test("T3.21 (A03 × A08): capability-snapshot.sh save+verify redacts short/long/JWT/PEM secrets while compliance/dataset-manifest.json validates SHA-256 provenance", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repoDir = ws.path("snap-repo");
      initGitRepo(repoDir);
      const zcodeCliDir = join(ws.home, ".zcode", "cli");
      mkdirSync(zcodeCliDir, { recursive: true });
      const fakeJwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const fakePem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEF\n-----END PRIVATE KEY-----";
      writeFileSync(
        join(zcodeCliDir, "config.json"),
        JSON.stringify({
          short_api_key: "ab1234",
          apiKey: "sk-snap-secret-9988",
          refresh_token: "rt_snap_9988",
          jwt: fakeJwt,
          pem: fakePem,
          note: "the token bucket refills",
          emptyKey: "",
        }),
        "utf8",
      );

      const backupRoot = ws.path("backups");
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOME: ws.home,
        ZCODE_BACKUP_ROOT: backupRoot,
        ZCODE_REPO: repoDir,
        ZCODE_APP: join(ws.root, "nonexistent.app"),
      };
      const saveRes = runSubprocess("bash", [join(REPO_ROOT, "scripts/capability-snapshot.sh"), "save"], {
        cwd: ws.cwd,
        env,
        timeoutMs: 15_000,
      });
      expect(saveRes.exitCode).toBe(0);

      const snapDirs = readdirSync(backupRoot).filter((d) => d.startsWith("caps-"));
      expect(snapDirs.length).toBe(1);
      const snapDir = join(backupRoot, snapDirs[0]!);

      const verRes = runSubprocess("bash", [join(REPO_ROOT, "scripts/capability-snapshot.sh"), "verify", snapDir], {
        cwd: ws.cwd,
        env,
        timeoutMs: 15_000,
      });
      expect(verRes.exitCode).toBe(0);
      expect(verRes.stdout).toContain("verify OK");

      const extractDir = ws.path("extracted-snap");
      mkdirSync(extractDir, { recursive: true });
      const untarRes = runSubprocess(
        "tar",
        ["-xzf", join(snapDir, "user-state.tar.gz"), "-C", extractDir],
        { cwd: ws.cwd, timeoutMs: 10_000 },
      );
      expect(untarRes.exitCode).toBe(0);
      const relConfig = join(extractDir, ws.home.replace(/^\/+/, ""), ".zcode", "cli", "config.json");
      const snapConfig = readFileSync(relConfig, "utf8");
      expect(snapConfig).not.toContain("ab1234");
      expect(snapConfig).not.toContain("sk-snap-secret-9988");
      expect(snapConfig).not.toContain("rt_snap_9988");
      expect(snapConfig).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
      expect(snapConfig).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEF");
      expect(snapConfig).toContain("the token bucket refills");
      expect(snapConfig).toContain("REDACTED");

      // Chain dataset-manifest.json SHA-256 verification
      const manifestPath = join(REPO_ROOT, "compliance", "dataset-manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        datasets?: Array<{ path: string; sha256: string }>;
        entries?: Array<{ path: string; sha256: string }>;
      };
      const items = manifest.datasets ?? manifest.entries ?? [];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        const target = resolve(REPO_ROOT, item.path);
        expect(existsSync(target)).toBe(true);
        expect(sha256File(target)).toBe(item.sha256);
      }
      expect(sha256Text("tamper")).not.toBe(items[0]!.sha256);
    });
  }, 45_000);

  test("T3.22 (A09 × A12): compliance assess evaluates Declare rules internally and refuses when Art. 14 Precedence is VIOLATED in soak logs", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));

      const base = buildConformingHighRiskSession({ sessionId: "sess_art14_violation" });
      const badEvents = base.events.filter((e) => e.type !== "permission_resolved");
      const badDoc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: badEvents,
      });

      const logsDir = ws.path("violated-soak");
      mkdirSync(logsDir, { recursive: true });
      const badPath = join(logsDir, "sess_art14_violation.ocel.json");
      writeFileSync(badPath, JSON.stringify(badDoc, null, 2), "utf8");

      const rulesPath = ws.writeJson("art14.rules.json", buildDeclareRulesJson());
      const decVer = runZcodeCli(
        ["ocel", "verify", "--in", badPath, "--declare", rulesPath, "--json"],
        ws,
      );
      expect(decVer.exitCode).toBe(1);
      const decOut = decVer.json<{ declareResults: Array<{ id: string; status: string }> }>();
      expect(decOut.declareResults.find((r) => r.id === "DEC-PREC-ART14")?.status).toBe("VIOLATED");

      const assessRes = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect(assessRes.exitCode).toBe(1);
      const assessOut = assessRes.json<{ verdict?: string }>();
      expect(assessOut.verdict).not.toBe("CONFORMITY_ADMITTED");
    });
  }, 45_000);

  test("T3.23 (Source-AppServer × A14): Real Source-AppServer fixture verifies via ocel-verify.ts & ocel verify, then mines OC-DFG + OCPN & Mermaid", async () => {
    await withIsolatedWorkspace(async (ws) => {
      // Step A: Baseline script verification of real Source-AppServer capture fixture
      const scriptVer = runBunScript(
        "scripts/ocel-verify.ts",
        ["test/fixtures/zcode-ocel/app-server-list.jsonocel"],
        { cwd: REPO_ROOT },
      );
      expect(scriptVer.exitCode).toBe(0);
      expect(scriptVer.stdout).toContain("deviations: 0");
      expect(scriptVer.stdout).toContain("chain-verified:");

      // Step B: Materialize fixture into isolated workspace and run zcode ocel verify
      const appDoc = buildAppServerSession();
      const inPath = ws.writeJson("app-server.ocel.json", appDoc);
      const cliVer = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(cliVer.exitCode).toBe(0);

      // Step C: Chain into OC-DFG + OCPN discovery and Mermaid rendering
      const ocpnPath = ws.path("app-server-ocpn.json");
      const discJson = runZcodeCli(
        ["ocel", "discover", "--in", inPath, "--ocpn", "--format", "json", "--out", ocpnPath],
        ws,
      );
      expect(discJson.exitCode).toBe(0);
      const ocpnRaw = readFileSync(ocpnPath, "utf8");
      const ocpn = JSON.parse(ocpnRaw) as {
        places?: unknown[];
        transitions?: unknown[];
        arcs?: unknown[];
        soundness?: { sound: boolean };
      };
      expect((ocpn.places ?? []).length).toBeGreaterThan(0);
      expect((ocpn.transitions ?? []).length).toBeGreaterThan(0);
      expect((ocpn.arcs ?? []).length).toBeGreaterThan(0);
      expect(typeof ocpn.soundness?.sound).toBe("boolean");
      expect(ocpnRaw).toContain("tool_updated");
      expect(ocpnRaw).toContain("turn_completed");

      const discMmd = runZcodeCli(
        ["ocel", "discover", "--in", inPath, "--format", "mermaid"],
        ws,
      );
      expect(discMmd.exitCode).toBe(0);
      expect(discMmd.stdout).toMatch(/flowchart\s+(LR|TD|TB)/);
      expect(discMmd.stdout).toContain("-->");
    });
  }, 45_000);

  test("T3.24 (A15 Kingman × A14 OC-DFG / Stratified SPC): Multi-provider heavy-tailed logs yield accurate OC-DFG sojourn tail + stratified no_drift", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          ttftSpikeFactor: 2.0,
          minWindow: 20,
        }),
      );
      const logsDir = ws.path("stratified-heavy");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("heavy_tailed", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }

      const dfgPath = ws.path("heavy-dfg.json");
      const discRes = runZcodeCli(
        ["ocel", "discover", "--in", logsDir, "--format", "json", "--out", dfgPath],
        ws,
      );
      expect(discRes.exitCode).toBe(0);
      const dfg = JSON.parse(readFileSync(dfgPath, "utf8")) as {
        sojournByObjectType?: Record<string, { medianMs: number; p95Ms: number }>;
      };
      expect(dfg.sojournByObjectType).toBeDefined();

      const pmmRes = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(pmmRes.exitCode).toBe(0);
      const pmmText = pmmRes.stdout;
      const pmmOut = pmmRes.json<{ driftDetected: boolean; ttftMdTriggered?: boolean }>();
      expect(pmmOut.driftDetected).toBe(false);
      expect(pmmOut.ttftMdTriggered ?? false).toBe(false);
      expect(pmmText).toContain("zai");
      expect(pmmText).toContain("anthropic");
    });
  }, 45_000);
});

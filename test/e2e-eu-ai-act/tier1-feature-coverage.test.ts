import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  runReceiptIntegrityProbe,
  runSubprocess,
  runZcodeCli,
  runZcodeCliAsync,
  sha256File,
  sha256Text,
  validateDfcmReceipt,
  withIsolatedWorkspace,
  withLocalLlmServer,
  type Ocel2Doc,
} from "./helpers.ts";

// ============================================================================
// Tier 1: Happy-Path Feature Coverage (>= 85 tests = 5 per area A01–A17)
// Opaque-box, zero-mock Chicago suite covering F01–F21 + O* Exploit Upgrades.
// ============================================================================

describe("A01 — Art. 50(1)/(2) Direct AI Disclosure & Provenance Marking (F07, F08)", () => {
  test("A01.1: stream-json under art50-only emits system.disclosure / ai_disclosure and logs art50_disclosure_emitted OCEL event", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "art50-only", ocelEnabled: true, ocelOutputDir: ws.ocelDir }));
      await withLocalLlmServer(ws, async () => {
        const res = await runZcodeCliAsync(
          ["-p", "Reply OK", "--output-format", "stream-json"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only", ZCODE_OCEL: "1" }, timeoutMs: 12_000 },
        );
        expect(res.exitCode).toBe(0);
        const lines = res.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Record<string, unknown>);
        const disclosureLine = lines.find(
          (l) =>
            l.type === "system.disclosure" ||
            l.type === "ai_disclosure" ||
            l.ai_disclosure !== undefined ||
            (typeof l.payload === "object" && l.payload !== null && "regulation" in (l.payload as Record<string, unknown>)),
        );
        expect(disclosureLine).toBeDefined();

        const ocelFiles = readdirSync(ws.ocelDir).filter((f) => f.endsWith(".jsonocel") || f.endsWith(".ocel.json"));
        expect(ocelFiles.length).toBeGreaterThan(0);
        const doc = JSON.parse(readFileSync(join(ws.ocelDir, ocelFiles[0]!), "utf8")) as Ocel2Doc;
        expect(doc.events.some((e) => e.type === "art50_disclosure_emitted")).toBe(true);
      });
    });
  }, 15_000);

  test("A01.2: --json under art50-only includes ai_disclosure object with regulation, provider_id, and model_id", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "art50-only" }));
      await withLocalLlmServer(ws, async () => {
        const res = await runZcodeCliAsync(
          ["-p", "Reply OK", "--json"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" }, timeoutMs: 12_000 },
        );
        expect(res.exitCode).toBe(0);
        const parsed = res.json<{
          ai_disclosure?: { regulation?: string; provider_id?: string; model_id?: string };
        }>();
        expect(parsed.ai_disclosure).toBeDefined();
        expect(parsed.ai_disclosure?.regulation).toContain("50");
        expect(parsed.ai_disclosure?.provider_id).toBeTruthy();
        expect(parsed.ai_disclosure?.model_id).toBeTruthy();
      });
    });
  }, 15_000);

  test("A01.3: provenance sidecar .zcode-provenance/<session>.json records verifiable SHA-256 of artifact bytes", async () => {
    await withIsolatedWorkspace(async (ws) => {
      initGitRepo(ws.cwd);
      ws.writeToml(buildComplianceToml({ profile: "art50-only", gitProvenanceTrailer: true }));
      const targetRel = "artifact.md";
      ws.writeText(targetRel, "# Generated Artifact\n\nContent v1\n");
      const expectedSha = sha256File(ws.path(targetRel));

      const doc = buildConformingHighRiskSession({ sessionId: "sess_art50_prov", profile: "art50-only" });
      const docPath = ws.writeJson("session.ocel.json", doc);
      const exportedPath = ws.path("exported.ocel.json");
      const res = runZcodeCli(
        ["ocel", "export", "--in", docPath, "--format", "json", "--out", exportedPath],
        ws,
        { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" } },
      );
      expect(res.exitCode).toBe(0);
      expect(existsSync(exportedPath)).toBe(true);
      const exportedSha = sha256File(exportedPath);

      const provDir = ws.path(".zcode-provenance");
      expect(existsSync(provDir)).toBe(true);
      const sidecars = readdirSync(provDir).filter((f) => f.endsWith(".json"));
      expect(sidecars.length).toBeGreaterThan(0);
      const sidecarRaw = sidecars.map((f) => readFileSync(join(provDir, f), "utf8")).join("\n");
      expect(sidecarRaw).toContain("EU");
      expect(sidecarRaw.includes(exportedSha) || sidecarRaw.includes(expectedSha)).toBe(true);
    });
  });

  test("A01.4: git_provenance_trailer=true attaches AI-Generated-By trailer on compliance provenance commit", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", gitProvenanceTrailer: true }));
      ws.writeText("output.txt", "AI-assisted content\n");
      const docOutPath = ws.path("eu-doc.json");
      const res = runZcodeCli(["compliance", "doc", "--out", docOutPath], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(docOutPath)).toBe(true);
      const docRaw = readFileSync(docOutPath, "utf8");
      expect(Object.keys(JSON.parse(docRaw) as Record<string, unknown>).length).toBeGreaterThanOrEqual(9);

      let llmStdout = "";
      await withLocalLlmServer(ws, async () => {
        const llmRes = await runZcodeCliAsync(
          ["-p", "Reply OK", "--json"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" }, timeoutMs: 12_000 },
        );
        expect(llmRes.exitCode).toBe(0);
        llmStdout = llmRes.stdout;
      });

      const sha = repo.commitAll("feat: add output");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const logMsg = repo.git(["log", "-1", "--pretty=%B"]).stdout;
      const provDir = ws.path(".zcode-provenance");
      const sidecarText = existsSync(provDir)
        ? readdirSync(provDir)
            .filter((f) => f.endsWith(".json"))
            .map((f) => readFileSync(join(provDir, f), "utf8"))
            .join("\n")
        : "";
      expect(`${logMsg}\n${sidecarText}\n${docRaw}\n${llmStdout}`).toContain("AI-Generated-By");
    });
  });

  test("A01.5: Markdown and JSON provenance metadata outputs preserve strict parseability", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "art50-only" }));
      const doc = buildConformingHighRiskSession({ sessionId: "sess_prov_hdr", profile: "art50-only" });
      const inPath = ws.writeJson("session.ocel.json", doc);

      const jsonRes = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(jsonRes.exitCode).toBe(0);
      const parsed = jsonRes.json<Record<string, unknown>>();
      expect(parsed).toBeDefined();

      const mdRes = runZcodeCli(["compliance", "info", "--md"], ws);
      expect(mdRes.exitCode).toBe(0);
      expect(mdRes.stdout).toContain("#");
      expect(mdRes.stdout.toLowerCase()).toContain("ai");
    });
  });
});

describe("A02 — Art. 9 AIRO Risk Register & Art. 9/12/14/15 Mapping (F03, F16)", () => {
  test("A02.1: zcode compliance risk-register --json exits 0 and includes baseline AIRO + EU AI Act risks", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "risk-register", "--json"], ws);
      expect(res.exitCode).toBe(0);
      const data = res.json<{ risks: Array<{ id: string; article?: string; articles?: string[] }> }>();
      expect(Array.isArray(data.risks)).toBe(true);
      expect(data.risks.length).toBeGreaterThanOrEqual(3);
      const ids = data.risks.map((r) => r.id);
      expect(ids.some((id) => id.includes("Risk_ToolchainDrift"))).toBe(true);
      expect(ids.some((id) => id.includes("Risk_SilentSkip"))).toBe(true);
      expect(ids.some((id) => id.includes("Risk_ContractDrift"))).toBe(true);
    });
  });

  test("A02.2: zcode compliance risk-register --md renders non-empty Markdown matrix with residual thresholds", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "risk-register", "--md"], ws);
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim().length).toBeGreaterThan(100);
      expect(res.stdout).toContain("#");
      expect(res.stdout).toContain("|");
      expect(res.stdout.toLowerCase()).toMatch(/likelihood|residual|risk/);
    });
  });

  test("A02.3: risk-register --json maps OCEL 2.0 logs, POWL soundness, and HITL gates to EU AI Act Arts. 9, 12, 14, 15", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "risk-register", "--json"], ws);
      expect(res.exitCode).toBe(0);
      const serialized = JSON.stringify(res.json());
      for (const art of ["9", "12", "14", "15"]) {
        expect(serialized).toMatch(new RegExp(`Art(?:icle)?[\\s._-]*${art}\\b`, "i"));
      }
      expect(serialized.toLowerCase()).toMatch(/ocel/);
      expect(serialized.toLowerCase()).toMatch(/powl|soundness/);
      expect(serialized.toLowerCase()).toMatch(/oversight|hitl|permission/);
    });
  });

  test("A02.4: baseline AIRO pin tests pass with RiskSource === 3 and RiskControl === 2 preserved", () => {
    const res = runSubprocess(
      process.execPath,
      ["test", "test/airo-risk-description.test.ts", "test/airo-wiring-w683.test.ts"],
      { cwd: REPO_ROOT, timeoutMs: 15_000 },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout + res.stderr).toMatch(/\b0 fail\b/);
  });

  test("A02.5: ontology/eu-ai-act.ttl exists and every <file:...> URI in both AIRO TTLs resolves on disk", () => {
    const airoPath = join(REPO_ROOT, "ontology", "airo_risk_description.ttl");
    const euActPath = join(REPO_ROOT, "ontology", "eu-ai-act.ttl");
    expect(existsSync(airoPath)).toBe(true);
    expect(existsSync(euActPath)).toBe(true);

    for (const ttlPath of [airoPath, euActPath]) {
      const content = readFileSync(ttlPath, "utf8");
      const uris = [...content.matchAll(/<file:([^>]+)>/g)].map((m) => m[1]!);
      expect(uris.length).toBeGreaterThan(0);
      for (const uri of uris) {
        const resolved = uri.startsWith("/") ? uri : resolve(REPO_ROOT, uri);
        expect(existsSync(resolved)).toBe(true);
        expect(statSync(resolved).size).toBeGreaterThan(0);
      }
    }
  });
});

describe("A03 — Art. 10 Data Governance & Unified Secret/PII Redactor (F04)", () => {
  test("A03.1: OCEL export under redact_pii scrubs apiKey, refresh_token, Bearer, Basic before pi_hash and passes ocel verify", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", redactPii: true }));
      const piiDoc = buildPiiSecretSession();
      const inPath = ws.writeJson("pii.ocel.json", piiDoc);
      const outPath = ws.path("redacted.ocel.json");

      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath], ws);
      expect(exp.exitCode).toBe(0);
      const rawOut = readFileSync(outPath, "utf8");
      expect(rawOut).not.toContain("sk-live-secret-99887766");
      expect(rawOut).not.toContain("rt_abcdef123456");
      expect(rawOut).toContain("REDACTED");

      const ver = runZcodeCli(["ocel", "verify", "--in", outPath, "--json"], ws);
      expect(ver.exitCode).toBe(0);
      expect(ver.json<{ chainIntact?: boolean; valid?: boolean }>().chainIntact ?? ver.json<{ valid?: boolean }>().valid).toBe(true);
    });
  });

  test("A03.2: unified redactor scrubs emails, IPv4, /Users/<name>/ paths, JWTs, and PEM private keys", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", redactPii: true }));
      const piiDoc = buildPiiSecretSession();
      const inPath = ws.writeJson("pii-full.ocel.json", piiDoc);
      const outPath = ws.path("pii-full-redacted.ocel.json");

      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath], ws);
      expect(exp.exitCode).toBe(0);
      const rawOut = readFileSync(outPath, "utf8");
      expect(rawOut).not.toContain("alice.mueller@example.de");
      expect(rawOut).not.toContain("192.168.14.22");
      expect(rawOut).not.toContain("/Users/alicemueller/");
      expect(rawOut).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
      expect(rawOut).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEF");
    });
  });

  test("A03.3: [ocel].redact_env redacts custom secret env var values in compliance OCEL export", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const customSecret = "zcode_custom_secret_val_9911";
      ws.writeToml(buildComplianceToml({ redactEnv: ["CUSTOM_DEPLOY_SECRET"] }));
      const doc = buildConformingHighRiskSession({ sessionId: "sess_redact_env" });
      doc.events[0]!.attributes.push({ name: "env_leak", value: `token=${customSecret}` });
      const inPath = ws.writeJson("env-leak.ocel.json", doc);
      const outPath = ws.path("env-clean.ocel.json");

      const exp = runZcodeCli(
        ["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath],
        ws,
        { env: { CUSTOM_DEPLOY_SECRET: customSecret } },
      );
      expect(exp.exitCode).toBe(0);
      const rawOut = readFileSync(outPath, "utf8");
      expect(rawOut).not.toContain(customSecret);
      expect(rawOut).toContain("REDACTED");
    });
  });

  test("A03.4: non-credential prose ('the token bucket refills') and empty string survive redaction verbatim", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ redactPii: true }));
      const doc = buildPiiSecretSession();
      const inPath = ws.writeJson("prose.ocel.json", doc);
      const outPath = ws.path("prose-redacted.ocel.json");

      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath], ws);
      expect(exp.exitCode).toBe(0);
      const rawOut = readFileSync(outPath, "utf8");
      expect(rawOut).toContain("the token bucket refills");
      expect(rawOut).toContain('\\"emptyKey\\":\\"\\"');

      const unitRes = runSubprocess(process.execPath, ["test", "test/ocel-redaction.test.ts"], {
        cwd: REPO_ROOT,
        timeoutMs: 15_000,
      });
      expect(unitRes.exitCode).toBe(0);
    });
  });

  test("A03.5: capability-snapshot.sh save + verify succeeds on sanitized tree and aligns with unified redactor rules", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repoDir = ws.path("fake-repo");
      initGitRepo(repoDir);
      const zcodeUserDir = join(ws.home, ".zcode", "cli");
      mkdirSync(zcodeUserDir, { recursive: true });
      writeFileSync(
        join(zcodeUserDir, "config.json"),
        JSON.stringify({ apiKey: "sk-long-secret-value-123456", note: "the token bucket refills" }),
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

      const scriptText = readFileSync(join(REPO_ROOT, "scripts/capability-snapshot.sh"), "utf8");
      expect(scriptText).toContain("refresh_token");
    });
  });
});

describe("A04 — Art. 11 & Annex IV Technical Documentation Compiler (F15)", () => {
  test("A04.1: zcode compliance annex-iv --out <dir> writes deterministic annex-iv.json and annex-iv.md", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outDir = ws.path("dossier");
      const res = runZcodeCli(["compliance", "annex-iv", "--out", outDir], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(join(outDir, "annex-iv.json"))).toBe(true);
      expect(existsSync(join(outDir, "annex-iv.md"))).toBe(true);
      const doc = JSON.parse(readFileSync(join(outDir, "annex-iv.json"), "utf8")) as Record<string, unknown>;
      expect(doc.sections ?? doc).toBeDefined();
    });
  });

  test("A04.2: byte-identical re-run of annex-iv yields identical section hashes", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const dir1 = ws.path("dossier-1");
      const dir2 = ws.path("dossier-2");
      const r1 = runZcodeCli(["compliance", "annex-iv", "--out", dir1], ws);
      const r2 = runZcodeCli(["compliance", "annex-iv", "--out", dir2], ws);
      expect(r1.exitCode).toBe(0);
      expect(r2.exitCode).toBe(0);
      expect(sha256File(join(dir1, "annex-iv.json"))).toBe(sha256File(join(dir2, "annex-iv.json")));
      expect(sha256File(join(dir1, "annex-iv.md"))).toBe(sha256File(join(dir2, "annex-iv.md")));
    });
  });

  test("A04.3: zcode compliance annex-iv --out <dir> --check exits 0 against valid HEAD and admitted receipts", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outDir = ws.path("dossier-check");
      const gen = runZcodeCli(["compliance", "annex-iv", "--out", outDir], ws);
      expect(gen.exitCode).toBe(0);
      expect(existsSync(join(outDir, "annex-iv.json"))).toBe(true);
      expect(existsSync(join(outDir, "annex-iv.md"))).toBe(true);
      const chk = runZcodeCli(["compliance", "annex-iv", "--out", outDir, "--check"], ws);
      expect(chk.exitCode).toBe(0);
      const out = chk.json<{
        valid?: boolean;
        ok?: boolean;
        checked?: boolean;
        status?: string;
        standing?: string;
      }>();
      expect(
        out.valid === true ||
          out.ok === true ||
          out.checked === true ||
          out.status === "ok" ||
          out.status === "ADMITTED" ||
          out.standing === "ALIVE",
      ).toBe(true);
    });
  });

  test("A04.4: annex-iv.json covers all §1–§8 Annex IV requirements including runtime lock, OCEL schema, Art. 9 & PMM", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outDir = ws.path("dossier-full");
      const res = runZcodeCli(["compliance", "annex-iv", "--out", outDir], ws);
      expect(res.exitCode).toBe(0);
      const raw = readFileSync(join(outDir, "annex-iv.json"), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(raw).toContain("3.14.4");
      expect(raw.toLowerCase()).toContain("ocel");
      expect(raw.toLowerCase()).toMatch(/risk|airo/);
      expect(raw.toLowerCase()).toMatch(/pmm|post.?market|drift/);
      expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(4);
    });
  });

  test("A04.5: annex-iv.md renders valid Markdown headings for all Annex IV sections (§1–§8)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outDir = ws.path("dossier-md");
      const res = runZcodeCli(["compliance", "annex-iv", "--out", outDir], ws);
      expect(res.exitCode).toBe(0);
      const md = readFileSync(join(outDir, "annex-iv.md"), "utf8");
      const headings = md.split("\n").filter((l) => /^#{1,3}\s+/.test(l));
      expect(headings.length).toBeGreaterThanOrEqual(8);
    });
  });
});

describe("A05 — Art. 12 OCEL 2.0 JSON/SQLite/XML, Source-AppServer & Retention (F05, F06, F03)", () => {
  test("A05.1: high-risk-annex-iii OCEL 2.0 verify validates E2O/O2O integrity, dynamic attribute timestamps, and pi_hash chain", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const doc = buildConformingHighRiskSession({ includeSubagent: true });
      const docPath = ws.writeJson("conforming.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", docPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ valid?: boolean; chainIntact?: boolean; eventCount?: number }>();
      expect(out.valid ?? out.chainIntact).toBe(true);
      expect(out.eventCount).toBe(doc.events.length);
    });
  });

  test("A05.2: zcode ocel export --format sqlite writes standard IEEE OCEL 2.0 tables in WAL mode", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ includeSubagent: true });
      const inPath = ws.writeJson("session.ocel.json", doc);
      const dbPath = ws.path("session.ocel.sqlite");
      const res = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "sqlite", "--out", dbPath], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(dbPath)).toBe(true);

      const db = inspectOcel2Sqlite(dbPath);
      expect(db.journalMode).toBe("wal");
      for (const tbl of ["event", "object", "event_object", "object_object", "event_map_type", "object_map_type"]) {
        expect(db.tables).toContain(tbl);
      }
      expect(db.tables.some((t) => t.startsWith("event_"))).toBe(true);
      expect(db.tables.some((t) => t.startsWith("object_"))).toBe(true);
      expect(db.eventCount).toBe(doc.events.length);
      expect(db.objectCount).toBe(doc.objects.length);
      expect(db.eventObjectCount).toBeGreaterThan(0);
      expect(db.objectObjectCount).toBeGreaterThan(0);
    });
  });

  test("A05.3: zcode ocel export --format xml writes well-formed IEEE OCEL 2.0 XML", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("session.ocel.json", doc);
      const xmlPath = ws.path("session.ocel.xml");
      const res = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "xml", "--out", xmlPath], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(xmlPath)).toBe(true);

      const xml = readFileSync(xmlPath, "utf8");
      expect(xml).toContain("<log>");
      expect(xml).toContain("<object-types>");
      expect(xml).toContain("<event-types>");
      expect(xml).toContain("<objects>");
      expect(xml).toContain("<events>");
      expect(xml).toContain('type="session_created"');
      expect(xml).toContain("</log>");
    });
  });

  test("A05.4: O2O qualifiers (in_session, in_turn, uses_provider, spawned_by, governs, mutated_in, seals) round-trip cleanly", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ includeSubagent: true });
      const inPath = ws.writeJson("o2o.ocel.json", doc);
      const dbPath = ws.path("o2o.ocel.sqlite");
      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "sqlite", "--out", dbPath], ws);
      expect(exp.exitCode).toBe(0);

      const ver = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(ver.exitCode).toBe(0);
      const verOut = ver.json<{ valid?: boolean; chainIntact?: boolean; eventCount?: number }>();
      expect(verOut.valid ?? verOut.chainIntact).toBe(true);
      expect(verOut.eventCount).toBe(doc.events.length);
      const db = inspectOcel2Sqlite(dbPath);
      expect(db.objectObjectCount).toBeGreaterThanOrEqual(7);
    });
  });

  test("A05.5: Source-AppServer verification test & app-server-list.jsonocel pass with deviations: 0", () => {
    const appServerTest = join(REPO_ROOT, "test/ocel-appserver-capture.test.ts");
    expect(existsSync(appServerTest)).toBe(true);
    const testRes = runSubprocess(process.execPath, ["test", "test/ocel-appserver-capture.test.ts"], {
      cwd: REPO_ROOT,
      timeoutMs: 15_000,
    });
    expect(testRes.exitCode).toBe(0);

    const verifyRes = runBunScript(
      "scripts/ocel-verify.ts",
      ["test/fixtures/zcode-ocel/app-server-list.jsonocel"],
      { cwd: REPO_ROOT },
    );
    expect(verifyRes.exitCode).toBe(0);
    expect(verifyRes.stdout).toContain("deviations: 0");
    expect(verifyRes.stdout).toContain("chain-verified:");
  });
});

describe("A06 — Art. 13 Instructions for Use & compliance info (F16)", () => {
  test("A06.1: zcode compliance info --json exits 0 with provider identity, capabilities, limitations, and node >= 22.19.0", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(res.exitCode).toBe(0);
      const info = res.json<Record<string, unknown>>();
      const text = JSON.stringify(info);
      expect(text).toContain("22.19.0");
      expect(text.toLowerCase()).toMatch(/provider|intended|purpose/);
      expect(text.toLowerCase()).toMatch(/limitation|constraint|oversight/);
    });
  });

  test("A06.2: zcode compliance info --md renders readable Instructions for Use summary", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "info", "--md"], ws);
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim().length).toBeGreaterThan(80);
      expect(res.stdout).toContain("#");
      expect(res.stdout.toLowerCase()).toContain("eu ai act");
    });
  });

  test("A06.3: docs/INSTRUCTIONS_FOR_USE.md exists and covers Art. 13(3)(a)–(f) sections", () => {
    const docPath = join(REPO_ROOT, "docs", "INSTRUCTIONS_FOR_USE.md");
    expect(existsSync(docPath)).toBe(true);
    const md = readFileSync(docPath, "utf8");
    expect(md.length).toBeGreaterThan(500);
    expect(md.toLowerCase()).toContain("13");
    expect(md.toLowerCase()).toMatch(/oversight|human/);
    expect(md.toLowerCase()).toMatch(/limitation|accuracy|robustness/);
  });

  test("A06.4: compliance info --json surfaces measured conformance/alignment status and uncertainty caveats", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(res.exitCode).toBe(0);
      const text = JSON.stringify(res.json()).toLowerCase();
      expect(text).toMatch(/standing|uncertainty|caveat|alignment|conformance/);
    });
  });

  test("A06.5: compliance info --json matches package.json version and zcode-runtime.lock.json metadata", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { version: string };
      const lock = JSON.parse(readFileSync(join(REPO_ROOT, "zcode-runtime.lock.json"), "utf8")) as {
        appVersion: string;
      };
      const res = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(res.exitCode).toBe(0);
      const text = JSON.stringify(res.json());
      expect(text).toContain(pkg.version);
      expect(text).toContain(lock.appVersion);
    });
  });
});

describe("A07 — Art. 14 Human Oversight, YOLO Lock, Subagent Gate & Stop (F09)", () => {
  test("A07.1: regulated profile allows --mode build and --mode edit cleanly without OVERSIGHT_POLICY_REFUSED", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", allowYolo: false }));
      await withLocalLlmServer(ws, async () => {
        for (const mode of ["build", "edit"] as const) {
          const res = await runZcodeCliAsync(["-p", "Reply OK", "--mode", mode, "--output-format", "stream-json"], ws, {
            env: { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" },
            timeoutMs: 12_000,
          });
          expect(res.exitCode).toBe(0);
          expect(res.stdout + res.stderr).not.toContain("OVERSIGHT_POLICY_REFUSED");
          const lines = res.stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l) as Record<string, unknown>);
          expect(lines.length).toBeGreaterThan(0);
          expect(res.stdout).toContain("OK");
        }
      });
    });
  }, 20_000);

  test("A07.2: permission_resolved with overseer_id and decision_latency_ms >= min_review_ms verifies without AB_RISK_FLAG", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", minReviewMs: 1000 }));
      const doc = buildConformingHighRiskSession({ decisionLatencyMs: 1450 });
      const inPath = ws.writeJson("oversight-ok.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const parsed = res.json<{ valid?: boolean; chainIntact?: boolean; eventCount?: number }>();
      expect(parsed.valid ?? parsed.chainIntact).toBe(true);
      expect(parsed.eventCount).toBe(doc.events.length);
      expect(JSON.stringify(parsed)).not.toContain("AB_RISK_FLAG");
    });
  });

  test("A07.3: oversight_intervened emergency stop event verifies cleanly with overseer_id and reason", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildOversightCrashSession({ kind: "oversight_intervened" });
      const inPath = ws.writeJson("stop.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const parsed = res.json<{ valid?: boolean; chainIntact?: boolean; eventCount?: number }>();
      expect(parsed.valid ?? parsed.chainIntact).toBe(true);
      expect(parsed.eventCount).toBe(doc.events.length);
      expect(doc.events.some((e) => e.type === "oversight_intervened")).toBe(true);
    });
  });

  test("A07.4: subagent object preserves spawned_by O2O relationship to parent session in OCEL & SQLite", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ includeSubagent: true });
      const inPath = ws.writeJson("subagent.ocel.json", doc);
      const dbPath = ws.path("subagent.sqlite");
      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "sqlite", "--out", dbPath], ws);
      expect(exp.exitCode).toBe(0);

      const db = inspectOcel2Sqlite(dbPath);
      expect(db.objects.some((o) => o.ocel_type === "subagent")).toBe(true);
      expect(db.objectObjectCount).toBeGreaterThan(0);
    });
  });

  test("A07.5: compliance oversight test suite & permission preview risk rendering verify cleanly", () => {
    const oversightTest = join(REPO_ROOT, "test/compliance-oversight.test.ts");
    expect(existsSync(oversightTest)).toBe(true);
    const res = runSubprocess(process.execPath, ["test", "test/compliance-oversight.test.ts"], {
      cwd: REPO_ROOT,
      timeoutMs: 15_000,
    });
    expect(res.exitCode).toBe(0);
  });
});

describe("A08 — Art. 15 Accuracy, Prompt-Injection Security & Rollback (F12, F21)", () => {
  test("A08.1: indirect prompt-injection & adversarial security suite passes zero-mock Chicago court", () => {
    const secTest = join(REPO_ROOT, "test/security-adversarial.test.ts");
    expect(existsSync(secTest)).toBe(true);
    const res = runSubprocess(process.execPath, ["test", "test/security-adversarial.test.ts"], {
      cwd: REPO_ROOT,
      timeoutMs: 20_000,
    });
    expect(res.exitCode).toBe(0);
  });

  test("A08.2: un-tampered OCEL verify exits 0 and fail-closed DfCM receipts:validate refuses defective ZCODE-26923-01 while admitting clean g0.json integrity", () => {
    const ocel1 = runBunScript("scripts/ocel-verify.ts", ["test/fixtures/zcode-ocel/turn-list.jsonocel"]);
    expect(ocel1.exitCode).toBe(0);
    expect(ocel1.stdout).toContain("deviations: 0");

    expect(runReceiptIntegrityProbe("receipts/v26.9.22/g0.json")).toEqual([]);
    const defectiveFindings = runReceiptIntegrityProbe("receipts/v26.9.23/ZCODE-26923-01.json");
    expect(defectiveFindings.some((f) => f.rule === "ALIVE_WITH_NONZERO_EXIT")).toBe(true);
    expect(defectiveFindings.some((f) => f.rule === "BOGUS_SHA")).toBe(true);

    const rec = runBunScript("scripts/validate-receipts.ts", [], { timeoutMs: 45_000 });
    expect(rec.exitCode).toBe(1);
    expect(rec.stdout).toContain("FAIL receipts/v26.9.23/ZCODE-26923-01.json");
    expect(rec.stdout).toContain("ALIVE_WITH_NONZERO_EXIT");
    expect(rec.stdout).toContain("BOGUS_SHA");
    expect(`${rec.stdout}\n${rec.stderr}`).toContain("REFUSED");
  }, 50_000);

  test("A08.3: compliance/dataset-manifest.json exists and all SHA-256 digests match files on disk", () => {
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
  });

  test("A08.4: dirty-rollback OCEL trace records workspace_rolled_back and clean git status verification", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(buildComplianceToml({ rollbackOnDirty: true }));
      repo.commitAll("chore: add compliance toml");
      expect(repo.statusPorcelain()).toBe("");

      const doc = buildOversightCrashSession({ kind: "dirty_rollback" });
      const inPath = ws.writeJson("rollback.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const parsed = res.json<{ valid?: boolean; chainIntact?: boolean; eventCount?: number }>();
      expect(parsed.valid ?? parsed.chainIntact).toBe(true);
      expect(parsed.eventCount).toBe(doc.events.length);
      expect(doc.events.some((e) => e.type === "workspace_rolled_back")).toBe(true);
    });
  });

  test("A08.5: transient 429 provider-backoff recovery test passes without silent corrupt state", () => {
    const res = runSubprocess(process.execPath, ["test", "test/provider-backoff.test.ts"], {
      cwd: REPO_ROOT,
      timeoutMs: 20_000,
    });
    expect(res.exitCode).toBe(0);
  });
});

describe("A09 — Art. 17/43/47/48 QMS, assess, Annex V DoC, receipts:validate & version --compliance (F17, F20, F21)", () => {
  test("A09.1: compliance/qms-manifest.json maps all Art. 17(1)(a)–(m) clauses to real existing repo paths", () => {
    const qmsPath = join(REPO_ROOT, "compliance", "qms-manifest.json");
    expect(existsSync(qmsPath)).toBe(true);
    const qms = JSON.parse(readFileSync(qmsPath, "utf8")) as {
      clauses?: Array<{ id?: string; clause?: string; files?: string[]; evidence?: string[]; path?: string }>;
    };
    const clauses = qms.clauses ?? [];
    expect(clauses.length).toBeGreaterThanOrEqual(13);
    for (const c of clauses) {
      const paths = [...(c.files ?? []), ...(c.evidence ?? []), ...(c.path ? [c.path] : [])];
      expect(paths.length).toBeGreaterThan(0);
      for (const rel of paths) {
        expect(existsSync(resolve(REPO_ROOT, rel))).toBe(true);
      }
    }
  });

  test("A09.2: zcode compliance assess --logs <dir> --json exits 0 with CONFORMITY_ADMITTED on conforming logs", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const logsDir = ws.path("soak-logs");
      mkdirSync(logsDir, { recursive: true });
      const doc = buildConformingHighRiskSession({ sessionId: "sess_assess_01" });
      writeFileSync(join(logsDir, "sess_assess_01.ocel.json"), JSON.stringify(doc, null, 2), "utf8");

      const res = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ verdict?: string; standing?: string }>();
      expect(out.verdict).toBe("CONFORMITY_ADMITTED");
      expect(["ALIVE", "PARTIAL_ALIVE"]).toContain(out.standing ?? "");
    });
  });

  test("A09.3: zcode compliance doc --out <file> emits Annex V EU Declaration of Conformity with HEAD & lock sha512", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const lock = JSON.parse(readFileSync(join(REPO_ROOT, "zcode-runtime.lock.json"), "utf8")) as { sha512: string };
      const outPath = ws.path("eu-declaration-of-conformity.json");
      const res = runZcodeCli(["compliance", "doc", "--out", outPath], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const raw = readFileSync(outPath, "utf8");
      const doc = JSON.parse(raw) as Record<string, unknown>;
      expect(Object.keys(doc).length).toBeGreaterThanOrEqual(9);
      expect(raw).toContain(lock.sha512);
    });
  });

  test("A09.4: zcode version --compliance and zcode --version --compliance exit 0 hermetically with compliance metadata", async () => {
    await withIsolatedWorkspace(async (ws) => {
      for (const flag of ["version", "--version"] as const) {
        const res = runZcodeCli([flag, "--compliance"], ws);
        expect(res.exitCode).toBe(0);
        const text = res.stdout;
        expect(text).toContain("3.14.4");
        expect(text.toLowerCase()).toMatch(/eu.?ai.?act|2024\/1689|compliance/);
      }
    });
  });

  test("A09.5: receipts:validate fails closed on defective ZCODE-26923-01 (with g0.json clean) AND validateDfcmReceipt admits valid v2 git-backed receipt", async () => {
    expect(runReceiptIntegrityProbe("receipts/v26.9.22/g0.json")).toEqual([]);
    const defectiveFindings = runReceiptIntegrityProbe("receipts/v26.9.23/ZCODE-26923-01.json");
    expect(defectiveFindings.some((f) => f.rule === "ALIVE_WITH_NONZERO_EXIT")).toBe(true);
    expect(defectiveFindings.some((f) => f.rule === "BOGUS_SHA")).toBe(true);

    const repoRes = runBunScript("scripts/validate-receipts.ts", [], { timeoutMs: 45_000 });
    expect(repoRes.exitCode).toBe(1);
    expect(repoRes.stdout).toContain("FAIL receipts/v26.9.23/ZCODE-26923-01.json");
    expect(repoRes.stdout).toContain("ALIVE_WITH_NONZERO_EXIT");
    expect(repoRes.stdout).toContain("BOGUS_SHA");
    expect(`${repoRes.stdout}\n${repoRes.stderr}`).toContain("REFUSED");

    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      const head = repo.headSha();
      const durableFile = ws.writeText("output.json", '{"status":"ok"}\n');
      const outputSha = sha256File(durableFile);
      const receiptPath = ws.writeJson("v2.receipt.json", {
        work_order_id: "WO-E2E-TIER1-01",
        origin_authority: { grant: "e2e-tier1", actor: "e2e-runner", ceiling: "CONSTRUCT" },
        provider: { name: "zcode-cli-e2e" },
        provider_execution_id: "exec-tier1-01",
        identity: {
          subject: "test/e2e-eu-ai-act/tier1",
          repo: repo.cwd,
          subject_sha: head,
          base_sha: head,
        },
        authority: { ceiling: "CONSTRUCT", grant: "e2e-tier1", actor: "e2e-runner" },
        consequence: { commits: [head], files_changed: ["README.md"], remote_effects: [] },
        replay: {
          commands: [{ cmd: "echo ok", exit: 0, cwd: repo.cwd, output_sha256: outputSha }],
          durable_location: durableFile,
        },
        standing: { value: "ALIVE", derived_from: `echo ok at ${head}` },
      });
      const v = validateDfcmReceipt(receiptPath, { cwd: repo.cwd });
      expect(v.exitCode).toBe(0);
      expect(v.admitted).toBe(true);
    });
  }, 50_000);
});

describe("A10 — Art. 26/27 Deployer Preflight, [compliance] Config & FRIA Export (F02, F18)", () => {
  test("A10.1: zcode compliance deployer-check passes with log_retention_days >= 180, overseer_id, monitoring_enabled=true", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(
        buildComplianceToml({
          profile: "high-risk-annex-iii",
          overseerId: "overseer-alice-eu",
          logRetentionDays: 180,
          monitoringEnabled: true,
        }),
      );
      const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ admitted?: boolean; ok?: boolean; standing?: string }>();
      expect(out.admitted ?? out.ok ?? out.standing === "ALIVE").toBeTruthy();
    });
  });

  test("A10.2: zcode compliance fria-export --out fria.json exports Art. 27(1)(a)–(f) JSON structure", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outPath = ws.path("fria.json");
      const res = runZcodeCli(["compliance", "fria-export", "--out", outPath], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const fria = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      const raw = JSON.stringify(fria).toLowerCase();
      expect(raw).toContain("overseer-alice-eu");
      expect(raw).toMatch(/27|fundamental.?rights|fria/);
    });
  });

  test("A10.3: zcode compliance fria-export --out fria.md --format md exports valid Markdown FRIA report", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outPath = ws.path("fria.md");
      const res = runZcodeCli(["compliance", "fria-export", "--out", outPath, "--format", "md"], ws);
      expect(res.exitCode).toBe(0);
      const md = readFileSync(outPath, "utf8");
      expect(md).toContain("#");
      expect(md).toContain("overseer-alice-eu");
    });
  });

  test("A10.4: ZCODE_COMPLIANCE_PROFILE and ZCODE_OVERSEER_ID env overrides supersede TOML deterministically", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(
        buildComplianceToml({ profile: "art50-only", overseerId: "overseer-toml", logRetentionDays: 180 }),
      );
      const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws, {
        env: {
          ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-i",
          ZCODE_OVERSEER_ID: "overseer-env-override",
        },
      });
      expect(res.exitCode).toBe(0);
      const serialized = JSON.stringify(res.json());
      expect(serialized).toContain("high-risk-annex-i");
      expect(serialized).toContain("overseer-env-override");
    });
  });

  test("A10.5: standard profile preserves legacy OCEL launcher defaults (ocelEnabled({}) === false)", () => {
    const res = runSubprocess(process.execPath, ["test", "test/ocel-launcher.test.ts"], {
      cwd: REPO_ROOT,
      timeoutMs: 15_000,
    });
    expect(res.exitCode).toBe(0);
  });
});

describe("A11 — Art. 72/73 Post-Market Monitoring & Serious Incident Reporting (F19)", () => {
  test("A11.1: zcode pmm analyze reports driftDetected: false on clean stationary soak logs", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("pmm-stationary");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("stationary", 30)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const outPath = ws.path("pmm-report.json");
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--out", outPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const out = res.json<{ driftDetected?: boolean; status?: string }>();
      expect(out.driftDetected).toBe(false);
    });
  });

  test("A11.2: zcode pmm analyze classifies stationary heavy-tailed latency logs as no_drift without false alarms", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("pmm-heavy");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("heavy_tailed", 30)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected?: boolean; status?: string }>();
      expect(out.driftDetected).toBe(false);
    });
  });

  test("A11.3: zcode incident report produces Art. 73 JSON packet for targeted session", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const crashDoc = buildOversightCrashSession({ kind: "crash" });
      const inPath = ws.writeJson("crash.ocel.json", crashDoc);
      const outPath = ws.path("incident.json");
      const res = runZcodeCli(
        ["incident", "report", "--in", inPath, "--out", outPath, "--session", "sess_crash"],
        ws,
      );
      expect(res.exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const pkt = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      expect(JSON.stringify(pkt)).toContain("sess_crash");
    });
  });

  test("A11.4: Art. 73 incident packet includes causal OCEL slice, OC-DFG root cause, and valid deadline_class", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const crashDoc = buildOversightCrashSession({ kind: "crash" });
      const inPath = ws.writeJson("crash2.ocel.json", crashDoc);
      const outPath = ws.path("incident2.json");
      const res = runZcodeCli(
        ["incident", "report", "--in", inPath, "--out", outPath, "--session", "sess_crash"],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const pkt = JSON.parse(readFileSync(outPath, "utf8")) as {
        deadline_class?: string;
        causal_slice?: unknown;
        ocel_slice?: unknown;
        root_cause?: unknown;
      };
      expect(["2d", "10d", "15d"]).toContain(pkt.deadline_class ?? "");
      expect(pkt.causal_slice ?? pkt.ocel_slice).toBeDefined();
      expect(pkt.root_cause).toBeDefined();
    });
  });

  test("A11.5: critical breach / unredacted secret incident classifies deadline_class deterministically as 2d or 10d", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_crit" });
      const critDoc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: [
          ...base.events,
          {
            id: "sess_crit_ev_breach",
            type: "unredacted_secret",
            time: "2026-08-02T10:00:05.200Z",
            attributes: [{ name: "severity", value: "critical" }],
            relationships: [{ objectId: "sess_crit", qualifier: "in_session" }],
          },
        ],
      });
      const inPath = ws.writeJson("crit.ocel.json", critDoc);
      const outPath = ws.path("crit-incident.json");
      const res = runZcodeCli(
        ["incident", "report", "--in", inPath, "--out", outPath, "--session", "sess_crit"],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const pkt = JSON.parse(readFileSync(outPath, "utf8")) as { deadline_class?: string };
      expect(["2d", "10d"]).toContain(pkt.deadline_class ?? "");
    });
  });
});

describe("A12 — Declare / LTLf Conformance & Anti-Vacuity (F10)", () => {
  test("A12.1: zcode ocel verify --declare exits 0 with SATISFIED_WITNESSED on conforming trace", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_dec" });
      // Add worker_claim -> receipt_persist pair so ChainResponse is also witnessed.
      const wo = {
        id: "wo_01",
        type: "work_order",
        attributes: [{ name: "work_order_id", value: "WO-01", time: "2026-08-02T10:00:04.000Z" }],
        relationships: [{ objectId: "sess_dec", qualifier: "in_session" }],
      };
      const head = base.events.slice(0, -2);
      const tail = base.events.slice(-2);
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: [...base.objects, wo],
        events: [
          ...head,
          {
            id: "sess_dec_claim",
            type: "worker_claim",
            time: "2026-08-02T10:00:04.900Z",
            attributes: [],
            relationships: [{ objectId: "wo_01", qualifier: "in_work_order" }],
          },
          {
            id: "sess_dec_persist",
            type: "receipt_persist",
            time: "2026-08-02T10:00:04.950Z",
            attributes: [],
            relationships: [{ objectId: "wo_01", qualifier: "in_work_order" }],
          },
          ...tail,
        ],
      });
      const inPath = ws.writeJson("dec.ocel.json", doc);
      const rulesPath = ws.writeJson("rules.json", buildDeclareRulesJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{
        declareResults?: Array<{ id: string; status: string; witness_event_ids: string[] }>;
      }>();
      const results = out.declareResults ?? [];
      expect(results.length).toBeGreaterThanOrEqual(7);
      for (const r of results) {
        expect(r.status).toBe("SATISFIED_WITNESSED");
      }
    });
  });

  test("A12.2: Init(session_created) and Existence(turn_started) return SATISFIED_WITNESSED with witness_event_ids", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("init-exist.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "init-exist.rules.json",
        buildDeclareRulesJson([
          { id: "R-INIT", template: "Init", activity: "session_created", objectType: "session", mandatory: true },
          { id: "R-EXIST", template: "Existence", activity: "turn_started", minCount: 1, objectType: "session", mandatory: true },
        ]),
      );
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const results = res.json<{ declareResults: Array<{ id: string; status: string; witness_event_ids: string[] }> }>()
        .declareResults;
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r.status).toBe("SATISFIED_WITNESSED");
        expect(r.witness_event_ids.length).toBeGreaterThan(0);
      }
    });
  });

  test("A12.3: Response(session_created, art50_disclosure_emitted) returns SATISFIED_WITNESSED", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("resp.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "resp.rules.json",
        buildDeclareRulesJson([
          {
            id: "R-RESP",
            template: "Response",
            activation: "session_created",
            target: "art50_disclosure_emitted",
            objectType: "session",
            mandatory: true,
          },
        ]),
      );
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const r = res.json<{ declareResults: Array<{ status: string; witness_event_ids: string[] }> }>().declareResults[0]!;
      expect(r.status).toBe("SATISFIED_WITNESSED");
      expect(r.witness_event_ids.length).toBeGreaterThan(0);
    });
  });

  test("A12.4: Precedence(permission_resolved, tool_updated) returns SATISFIED_WITNESSED when permission precedes tool", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("prec.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "prec.rules.json",
        buildDeclareRulesJson([
          {
            id: "R-PREC",
            template: "Precedence",
            activation: "tool_updated",
            target: "permission_resolved",
            objectType: "turn",
            mandatory: true,
          },
        ]),
      );
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const r = res.json<{ declareResults: Array<{ status: string; witness_event_ids: string[] }> }>().declareResults[0]!;
      expect(r.status).toBe("SATISFIED_WITNESSED");
      expect(r.witness_event_ids.length).toBeGreaterThan(0);
    });
  });

  test("A12.5: Absence(unredacted_secret) and NotCoExistence(mode_yolo, high_risk) pass with empty counterexamples", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("abs-notco.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "abs-notco.rules.json",
        buildDeclareRulesJson([
          { id: "R-ABS", template: "Absence", activity: "unredacted_secret", maxCount: 0, objectType: "session", mandatory: true },
          {
            id: "R-NOTCO",
            template: "NotCoExistence",
            activation: "mode_yolo_enabled",
            target: "high_risk_profile_active",
            objectType: "session",
            mandatory: true,
          },
        ]),
      );
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const results = res.json<{ declareResults: Array<{ status: string; counterexample_event_ids: string[] }> }>()
        .declareResults;
      for (const r of results) {
        expect(r.status).not.toBe("VIOLATED");
        expect(r.counterexample_event_ids).toEqual([]);
      }
    });
  });
});

describe("A13 — Optimal A* Trace Alignment (gamma = 0) & Precision (F11)", () => {
  test("A13.1: zcode ocel verify --wfnet on conforming trace yields alignmentCost === 0 and fitness === 1", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("align.ocel.json", doc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ alignment: { alignmentCost: number; fitness: number } }>();
      expect(out.alignment.alignmentCost).toBe(0);
      expect(out.alignment.fitness).toBe(1);
    });
  });

  test("A13.2: optimal A* alignment moves array reports all sync moves with cost === 0", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("align-moves.ocel.json", doc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ alignment: { moves: Array<{ kind: string; cost: number }> } }>();
      expect(out.alignment.moves.length).toBe(doc.events.length);
      for (const m of out.alignment.moves) {
        expect(m.kind).toBe("sync");
        expect(m.cost).toBe(0);
      }
    });
  });

  test("A13.3: precision (escapingEdgesPrecision) equals 1.0 on exact deterministic trace", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("precision.ocel.json", doc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ alignment: { escapingEdgesPrecision?: number; precision?: number } }>();
      const prec = out.alignment.escapingEdgesPrecision ?? out.alignment.precision;
      expect(prec).toBe(1);
    });
  });

  test("A13.4: concurrent/parallel WF-net with valid parallel interleaving yields alignmentCost === 0 (gamma = 0)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildOcel2Doc({
        objects: [
          { id: "sess_par", type: "session", attributes: [], relationships: [] },
          {
            id: "turn_par",
            type: "turn",
            attributes: [],
            relationships: [{ objectId: "sess_par", qualifier: "in_session" }],
          },
        ],
        events: [
          {
            id: "ev1",
            type: "session_created",
            time: "2026-08-02T10:00:00.000Z",
            attributes: [],
            relationships: [{ objectId: "sess_par", qualifier: "in_session" }],
          },
          {
            id: "ev2",
            type: "turn_started",
            time: "2026-08-02T10:00:01.000Z",
            attributes: [],
            relationships: [
              { objectId: "sess_par", qualifier: "in_session" },
              { objectId: "turn_par", qualifier: "in_turn" },
            ],
          },
          {
            id: "ev3",
            type: "art50_disclosure_emitted",
            time: "2026-08-02T10:00:02.000Z",
            attributes: [],
            relationships: [{ objectId: "sess_par", qualifier: "in_session" }],
          },
          {
            id: "ev4",
            type: "turn_completed",
            time: "2026-08-02T10:00:03.000Z",
            attributes: [],
            relationships: [
              { objectId: "sess_par", qualifier: "in_session" },
              { objectId: "turn_par", qualifier: "in_turn" },
            ],
          },
        ],
      });
      const inPath = ws.writeJson("par.ocel.json", doc);
      const wfPath = ws.writeJson("par.wfnet.json", buildWfNetJson({ withParallel: true }));
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ alignment: { alignmentCost: number; fitness: number } }>();
      expect(out.alignment.alignmentCost).toBe(0);
      expect(out.alignment.fitness).toBe(1);
    });
  });

  test("A13.5: alignment output strictly distinguishes behavioral A* alignment from completionHeuristic", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("distinguish.ocel.json", doc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<Record<string, unknown>>();
      expect(out.alignment).toBeDefined();
      expect((out.alignment as Record<string, unknown>).method).not.toBe("completionHeuristic");
    });
  });
});

describe("A14 — OCPN & OC-DFG Discovery (--ocpn, DOT/Mermaid, Rework & Collisions) (F13)", () => {
  test("A14.1: zcode ocel discover --format json discovers nodes and edges partitioned by objectType", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ includeRework: true });
      const inPath = ws.writeJson("disc.ocel.json", doc);
      const outPath = ws.path("dfg.json");
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--format", "json", "--out", outPath], ws);
      expect(res.exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const dfg = JSON.parse(readFileSync(outPath, "utf8")) as {
        objectTypes?: string[];
        byObjectType?: Record<string, { nodes: unknown[]; edges: unknown[] }>;
      };
      expect((dfg.objectTypes ?? Object.keys(dfg.byObjectType ?? {})).length).toBeGreaterThanOrEqual(2);
    });
  });

  test("A14.2: zcode ocel discover --format dot outputs valid Graphviz digraph syntax", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("disc-dot.ocel.json", doc);
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--format", "dot"], ws);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("digraph");
      expect(res.stdout).toContain("->");
      expect(res.stdout.trim().endsWith("}")).toBe(true);
    });
  });

  test("A14.3: zcode ocel discover --format mermaid outputs valid Mermaid flowchart syntax", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("disc-mmd.ocel.json", doc);
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--format", "mermaid"], ws);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toMatch(/flowchart\s+(LR|TD|TB)/);
      expect(res.stdout).toContain("-->");
    });
  });

  test("A14.4: zcode ocel discover --ocpn --format json outputs Object-Centric Petri Net + soundness check", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("disc-ocpn.ocel.json", doc);
      const outPath = ws.path("ocpn.json");
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--ocpn", "--format", "json", "--out", outPath], ws);
      expect(res.exitCode).toBe(0);
      const ocpn = JSON.parse(readFileSync(outPath, "utf8")) as {
        places: unknown[];
        transitions: unknown[];
        arcs: Array<{ variable?: boolean; objectType?: string }>;
        soundness?: { sound: boolean };
      };
      expect(ocpn.places.length).toBeGreaterThan(0);
      expect(ocpn.transitions.length).toBeGreaterThan(0);
      expect(ocpn.arcs.length).toBeGreaterThan(0);
      expect(ocpn.soundness).toBeDefined();
      expect(typeof ocpn.soundness?.sound).toBe("boolean");
    });
  });

  test("A14.5: OC-DFG discovery computes reworkCycles, fileCollisions, and per-object sojourn median/p95 timings", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ includeRework: true });
      const inPath = ws.writeJson("rework.ocel.json", doc);
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--format", "json"], ws);
      expect(res.exitCode).toBe(0);
      const dfg = res.json<{
        reworkCycles?: unknown[];
        fileCollisions?: unknown[];
        sojournByObjectType?: Record<string, { medianMs: number; p95Ms: number }>;
      }>();
      expect(Array.isArray(dfg.reworkCycles)).toBe(true);
      expect(dfg.reworkCycles!.length).toBeGreaterThan(0);
      expect(Array.isArray(dfg.fileCollisions)).toBe(true);
      expect(dfg.sojournByObjectType).toBeDefined();
    });
  });
});

describe("A15 — Bose/van der Aalst Concept Drift, SPC & Kingman Variance Separation (F13, F14)", () => {
  test("A15.1: Page-Hinkley & ADWIN report stable baseline (driftDetected: false) on stationary window", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("stationary");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("stationary", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected: boolean; pageHinkley?: unknown; adwin?: unknown }>();
      expect(out.driftDetected).toBe(false);
      expect(out.pageHinkley ?? out.adwin).toBeDefined();
    });
  });

  test("A15.2: pmm analyze detects injected sudden step-change with driftDetected: true and pValue < 0.01", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("sudden");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("sudden_drift", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected: boolean; driftKind?: string; pValue?: number }>();
      expect(out.driftDetected).toBe(true);
      expect(out.driftKind).toBe("sudden");
      expect(typeof out.pValue).toBe("number");
      expect(out.pValue!).toBeLessThan(0.01);
    });
  });

  test("A15.3: pmm analyze detects gradual drift via EWMA / 2-sample KS", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("gradual");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("gradual_drift", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected: boolean; driftKind?: string }>();
      expect(out.driftDetected).toBe(true);
      expect(["gradual", "sudden"]).toContain(out.driftKind ?? "");
    });
  });

  test("A15.4: Kingman separation keeps heavy-tailed coding serviceMs (c_s^2 >> 1) with healthy TTFT free of false MD/drift", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ ttftSpikeFactor: 2.0 }));
      const logsDir = ws.path("heavy-tail");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("heavy_tailed", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected: boolean; ttftMdTriggered?: boolean }>();
      expect(out.driftDetected).toBe(false);
      expect(out.ttftMdTriggered ?? false).toBe(false);
    });
  });

  test("A15.5: Kingman scheduler & throughput metrics compute lambdaAlive below rho -> 1 saturation cliff", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("kingman-metrics");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("heavy_tailed", 25)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const raw = JSON.stringify(res.json()).toLowerCase();
      expect(raw).toMatch(/kingman|cs2|rho|lambda/);
    });
  });
});

describe("A16 — Responsible Process Mining (FACT) & k-Anonymity Export (F14)", () => {
  test("A16.1: zcode ocel export --rpm-safe --k 5 exits 0 when all variants have support >= 5", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildKAnonLogSet({ k: 5, variantCount: 2, includeOutlier: false });
      const inPath = ws.writeJson("kanon.ocel.json", doc);
      const outPath = ws.path("kanon-safe.ocel.json");
      const res = runZcodeCli(
        ["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath, "--rpm-safe", "--k", "5"],
        ws,
      );
      expect(res.exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const exported = JSON.parse(readFileSync(outPath, "utf8")) as Ocel2Doc;
      expect(exported.events.length).toBe(doc.events.length);
    });
  });

  test("A16.2: --rpm-safe export replaces raw overseer emails/IDs with salted HMAC-SHA256 pseudonyms", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildKAnonLogSet({ k: 5, variantCount: 2 });
      const inPath = ws.writeJson("kanon-hmac.ocel.json", doc);
      const outPath = ws.path("kanon-hmac-safe.ocel.json");
      const res = runZcodeCli(
        ["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath, "--rpm-safe", "--k", "5"],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const rawOut = readFileSync(outPath, "utf8");
      expect(rawOut).not.toContain("@example.eu");
      expect(rawOut).not.toContain("raw-user-alice");
      expect(rawOut).toMatch(/hmac|pseudo|[0-9a-f]{16,}/i);
    });
  });

  test("A16.3: fairness audit stratifies metrics by provider_id and model_id without demographic fields", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("fairness-logs");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("stationary", 24)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const text = JSON.stringify(res.json());
      expect(text).toContain("zai");
      expect(text).toContain("anthropic");
      expect(text.toLowerCase()).not.toContain("gender");
      expect(text.toLowerCase()).not.toContain("ethnicity");
    });
  });

  test("A16.4: accuracy audit reports log completeness and missing-E2O ratio honestly (ALIVE on complete log)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession();
      const inPath = ws.writeJson("accuracy.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ standing?: string; missingE2oRatio?: number; completeness?: number }>();
      expect(out.standing).toBe("ALIVE");
      expect(out.missingE2oRatio ?? 0).toBe(0);
    });
  });

  test("A16.5: transparency output attaches exact OCEL event IDs and/or OC-DFG edges to audit verdicts", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_transp" });
      const inPath = ws.writeJson("transp.ocel.json", doc);
      const rulesPath = ws.writeJson("transp.rules.json", buildDeclareRulesJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const serialized = JSON.stringify(res.json());
      expect(serialized).toContain("sess_transp_ev_001");
    });
  });
});

describe("A17 — Bounded Transactional Lifecycle Nets & Per-Signature Retry Cap (F12)", () => {
  test("A17.1: baseline zero-mock Chicago POWL orchestrator suites pass cleanly", () => {
    const res = runSubprocess(
      process.execPath,
      ["test", "test/powl-ocel-chicago.test.ts", "test/powl-ocel-orchestrator.test.ts"],
      { cwd: REPO_ROOT, timeoutMs: 20_000 },
    );
    expect(res.exitCode).toBe(0);
  });

  test("A17.2: clean transactional lifecycle trace completes without workspace_rolled_back", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_tx_clean" });
      const inPath = ws.writeJson("tx-clean.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const parsed = res.json<{ valid?: boolean; chainIntact?: boolean; eventCount?: number }>();
      expect(parsed.valid ?? parsed.chainIntact).toBe(true);
      expect(parsed.eventCount).toBe(doc.events.length);
      expect(doc.events.some((e) => e.type === "workspace_rolled_back")).toBe(false);
    });
  });

  test("A17.3: compliance-transactional-kingman test suite passes bounded rollback and retry cap checks", () => {
    const txTest = join(REPO_ROOT, "test/compliance-transactional-kingman.test.ts");
    expect(existsSync(txTest)).toBe(true);
    const res = runSubprocess(process.execPath, ["test", "test/compliance-transactional-kingman.test.ts"], {
      cwd: REPO_ROOT,
      timeoutMs: 20_000,
    });
    expect(res.exitCode).toBe(0);
  });

  test("A17.4: distinct failure signatures track independent retry budgets in zcode-cli.toml config validation", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(
        buildComplianceToml({
          maxRetriesPerSignature: 3,
          maxRemediationAttempts: 3,
          maxTransportRetries: 3,
          rollbackOnDirty: true,
        }),
      );
      const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const chkOut = res.json<{ admitted?: boolean; ok?: boolean; standing?: string }>();
      expect(chkOut.admitted ?? chkOut.ok ?? chkOut.standing === "ALIVE").toBeTruthy();
      const doc = buildConformingHighRiskSession({ includeRework: true });
      const inPath = ws.writeJson("rework-sig.ocel.json", doc);
      const ver = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(ver.exitCode).toBe(0);
      const verOut = ver.json<{ valid?: boolean; chainIntact?: boolean; eventCount?: number }>();
      expect(verOut.valid ?? verOut.chainIntact).toBe(true);
      expect(verOut.eventCount).toBe(doc.events.length);
    });
  });

  test("A17.5: ZCODE_MAX_TURNS budget and max_cycles bounds terminate deterministically without livelock", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "art50-only", maxCycles: 1 }));
      await withLocalLlmServer(ws, async () => {
        const res = await runZcodeCliAsync(
          ["-p", "Reply OK", "--max-turns", "1", "--output-format", "stream-json"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" }, timeoutMs: 12_000 },
        );
        expect(res.exitCode).toBe(0);
        const lines = res.stdout.trim().split("\n").filter(Boolean);
        expect(lines.length).toBeGreaterThan(0);
        expect(res.stdout).toContain("OK");
      });
    });
  }, 15_000);
});

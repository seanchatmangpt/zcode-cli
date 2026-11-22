import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
  initGitRepo,
  runBunScript,
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
// Tier 2: Boundary, Corner & Negative-Input Coverage (>= 85 tests, >= 5 / area)
// Opaque-box, zero-mock Chicago suite covering A01–A17 fail-closed gates,
// anti-vacuity rules, Kingman heavy-tail separation, and retry/rollback bounds.
// ============================================================================

describe("A01 — Art. 50(1)/(2) Disclosure & Provenance Negative/Boundary Tests (5 tests)", () => {
  test("A01.1: suppressing disclosure under art50-only fails closed with DISCLOSURE_REQUIRED (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "art50-only" }));
      await withLocalLlmServer(ws, async () => {
        const res = await runZcodeCliAsync(
          ["-p", "Reply OK", "--json"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only", ZCODE_SUPPRESS_DISCLOSURE: "1" }, timeoutMs: 12_000 },
        );
        expect(res.exitCode).toBe(1);
        expect(res.stdout + res.stderr).toContain("DISCLOSURE_REQUIRED");
      });
    });
  }, 45_000);

  test("A01.2: binary .wasm/.png and strict .json artifacts receive sidecar provenance without # comment corruption", async () => {
    await withIsolatedWorkspace(async (ws) => {
      initGitRepo(ws.cwd);
      ws.writeToml(buildComplianceToml({ profile: "art50-only", gitProvenanceTrailer: true }));

      // Real binary WASM header (\0asm\x01\0\0\0), real PNG magic header, and strict JSON artifact
      const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      writeFileSync(ws.path("kernel.wasm"), wasmBytes);
      writeFileSync(ws.path("chart.png"), pngBytes);
      ws.writeText("report.json", '{"ok":true}\n');

      const doc = buildConformingHighRiskSession({ sessionId: "sess_binary_sidecar", profile: "art50-only" });
      const docPath = ws.writeJson("session.ocel.json", doc);
      const res = runZcodeCli(
        ["ocel", "export", "--in", docPath, "--format", "json", "--out", ws.path("out.ocel.json")],
        ws,
        { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" } },
      );
      expect(res.exitCode).toBe(0);

      // Binary headers and strict JSON syntax MUST remain intact (no leading `#` comment injected)
      expect(Buffer.compare(readFileSync(ws.path("kernel.wasm")), wasmBytes)).toBe(0);
      expect(Buffer.compare(readFileSync(ws.path("chart.png")), pngBytes)).toBe(0);
      expect(() => JSON.parse(ws.readText("report.json"))).not.toThrow();
      expect(ws.readText("report.json").startsWith("#")).toBe(false);

      const provDir = ws.path(".zcode-provenance");
      expect(existsSync(provDir)).toBe(true);
      const sidecars = readdirSync(provDir).filter((f) => f.endsWith(".json"));
      expect(sidecars.length).toBeGreaterThan(0);
    });
  }, 45_000);

  test("A01.3: missing model_id / unsealed provenance under high-risk-annex-iii fails with PROVENANCE_SEAL_FAILED (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", gitProvenanceTrailer: true }));
      const base = buildConformingHighRiskSession({ sessionId: "sess_unsealed", profile: "high-risk-annex-iii" });
      const brokenEvents = base.events.map((ev) =>
        ev.type === "art50_disclosure_emitted"
          ? { ...ev, attributes: ev.attributes.filter((a) => a.name !== "model_id") }
          : ev,
      );
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: brokenEvents,
      });
      const inPath = ws.writeJson("unsealed.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("PROVENANCE_SEAL_FAILED");
    });
  }, 45_000);

  test("A01.4: empty session (0 events) fails OCEL verification and emits zero fake art50_disclosure_emitted claims", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "art50-only" }));
      const emptyDoc = buildOcel2Doc({ objects: [], events: [] });
      const inPath = ws.writeJson("empty-session.ocel.json", emptyDoc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).not.toBe(0);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("Usage:");
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/empty|0 events|LOGGING_UNAVAILABLE|UNVERIFIED|no events/i);
      expect(res.stdout).not.toContain("SATISFIED_WITNESSED");
      expect(res.stdout).not.toContain("art50_disclosure_emitted");
    });
  }, 45_000);

  test("A01.5: tampered .zcode-provenance sidecar SHA-256 mismatch is rejected fail-closed (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      initGitRepo(ws.cwd);
      ws.writeToml(buildComplianceToml({ profile: "art50-only", gitProvenanceTrailer: true }));
      ws.writeText("artifact.md", "# Authentic content\n");
      const doc = buildConformingHighRiskSession({ sessionId: "sess_tamper_prov", profile: "art50-only" });
      const inPath = ws.writeJson("sess.ocel.json", doc);
      const exp = runZcodeCli(
        ["ocel", "export", "--in", inPath, "--format", "json", "--out", ws.path("exported.ocel.json")],
        ws,
        { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" } },
      );
      expect(exp.exitCode).toBe(0);

      const provDir = ws.path(".zcode-provenance");
      const sidecars = readdirSync(provDir).filter((f) => f.endsWith(".json"));
      expect(sidecars.length).toBeGreaterThan(0);
      const sidecarPath = join(provDir, sidecars[0]!);
      const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;
      sidecar.sha256 = "f".repeat(64);
      sidecar.artifact_sha256 = "f".repeat(64);
      writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf8");

      const ver = runZcodeCli(["ocel", "verify", "--in", ws.path("exported.ocel.json"), "--json"], ws);
      expect(ver.exitCode).toBe(1);
      expect(ver.stdout + ver.stderr).toMatch(/PROVENANCE_SEAL_FAILED|mismatch|tamper/i);
    });
  }, 45_000);
});

describe("A02 — Art. 9 AIRO Risk Register & Mapping Boundary/Negative Tests (5 tests)", () => {
  test("A02.1: unknown [compliance].profile fails closed on compliance risk-register (never defaults silently)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(buildComplianceToml({ profile: "unregulated-custom" }));
      const res = runZcodeCli(["compliance", "risk-register", "--json"], ws, {
        env: { ZCODE_CONFIG_PATH: cfgPath },
      });
      expect([1, 2]).toContain(res.exitCode);
      expect(res.stdout + res.stderr).toMatch(/INVALID_COMPLIANCE_PROFILE|unregulated-custom/i);
    });
  }, 45_000);

  test("A02.2: invalid --format bogus flag on compliance risk-register exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "risk-register", "--format", "bogus"], ws);
      expect(res.exitCode).toBe(2);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/--format|format|bogus|unsupported/i);
    });
  }, 45_000);

  test("A02.3: mutating pinned contract fixture breaks ZCODE_CONTRACT_FIXTURE court (anti-vacuity)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const origPath = join(REPO_ROOT, "test/fixtures/runtime-turn.contract.json");
      const orig = JSON.parse(readFileSync(origPath, "utf8")) as {
        source: string;
        expectedTypes: string[];
        records: Array<Record<string, unknown>>;
      };
      orig.expectedTypes[0] = "mutated_invalid_type";
      const mutatedPath = ws.writeJson("mutated-runtime-turn.contract.json", orig);

      const res = runSubprocess(process.execPath, ["test", "test/ocel-launcher.test.ts"], {
        cwd: REPO_ROOT,
        env: { ...(process.env as Record<string, string>), ZCODE_CONTRACT_FIXTURE: mutatedPath },
        timeoutMs: 15_000,
      });
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("mutated_invalid_type");
    });
  }, 45_000);

  test("A02.4: high-risk profile with allow_yolo = true in zcode-cli.toml refuses risk-register with OVERSIGHT_POLICY_REFUSED (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", allowYolo: true }));
      const res = runZcodeCli(["compliance", "risk-register", "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
    });
  }, 45_000);

  test("A02.5: malformed TOML syntax in zcode-cli.toml fails closed on risk-register with INVALID_COMPLIANCE_CONFIG (exit 2)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeText("zcode-cli.toml", "[compliance\nprofile = \"broken\n");
      const res = runZcodeCli(["compliance", "risk-register", "--json"], ws);
      expect(res.exitCode).toBe(2);
      expect(res.stdout + res.stderr).toMatch(/INVALID_COMPLIANCE_CONFIG|TOML/i);
    });
  }, 45_000);
});

describe("A03 — Art. 10 Data Governance & Unified Redactor Boundary/Negative Tests (5 tests)", () => {
  test("A03.1: 1-to-7-char short secrets (apiKey: 'ab1234', token: 'x7', Bearer sk_123) are redacted before pi_hash", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", redactPii: true }));
      const doc = buildConformingHighRiskSession({ sessionId: "sess_short_secret" });
      const shortPayload = JSON.stringify({
        apiKey: "ab1234",
        token: "x7",
        auth: "Bearer sk_123",
      });
      doc.events[2]!.attributes.push({ name: "tool_out", value: shortPayload });
      const inPath = ws.writeJson("short-secret.ocel.json", doc);
      const outPath = ws.path("short-secret-redacted.ocel.json");

      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath], ws);
      expect(exp.exitCode).toBe(0);
      const rawOut = readFileSync(outPath, "utf8");
      expect(rawOut).not.toContain("ab1234");
      expect(rawOut).not.toContain('"x7"');
      expect(rawOut).not.toContain("sk_123");
      expect(rawOut).toContain("REDACTED");

      const ver = runZcodeCli(["ocel", "verify", "--in", outPath, "--json"], ws);
      expect(ver.exitCode).toBe(0);
    });
  }, 45_000);

  test("A03.2: escaped JSON secrets, JWT, PEM private key, email, IPv4, and /Users/<user>/ are redacted prior to pi_hash", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", redactPii: true }));
      const doc = buildPiiSecretSession();
      const inPath = ws.writeJson("escaped-pii.ocel.json", doc);
      const outPath = ws.path("escaped-pii-out.ocel.json");

      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath], ws);
      expect(exp.exitCode).toBe(0);
      const rawOut = readFileSync(outPath, "utf8");
      expect(rawOut).not.toContain("rt_abcdef123456");
      expect(rawOut).not.toContain("eyJhbGciOiJIUzI1NiJ9");
      expect(rawOut).not.toContain("BEGIN PRIVATE KEY");
      expect(rawOut).not.toContain("alice.mueller@example.de");
      expect(rawOut).not.toContain("192.168.14.22");
      expect(rawOut).not.toContain("alicemueller");

      const ver = runZcodeCli(["ocel", "verify", "--in", outPath, "--json"], ws);
      expect(ver.exitCode).toBe(0);
    });
  }, 45_000);

  test("A03.3: capability-snapshot.sh save refuses and cleans up staging/dest when >2MB file contains unredacted secret", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repoDir = ws.path("fake-repo");
      initGitRepo(repoDir);
      const zcodePluginsDir = join(ws.home, ".zcode", "cli", "plugins");
      mkdirSync(zcodePluginsDir, { recursive: true });
      const padding = "x".repeat(2_200_000);
      writeFileSync(
        join(zcodePluginsDir, "oversize.json"),
        JSON.stringify({ note: padding, apiKey: "sk-surviving-secret-over-2mb" }),
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
        timeoutMs: 20_000,
      });
      expect(saveRes.exitCode).not.toBe(0);
      expect(saveRes.stderr).toContain("secret-shaped values survived redaction");
      const leftovers = existsSync(backupRoot) ? readdirSync(backupRoot) : [];
      expect(leftovers).toEqual([]);
    });
  }, 45_000);

  test("A03.4: capability-snapshot.sh save redacts <8-char apiKey/refresh_token and JWT/PEM in archived user-state.tar.gz", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repoDir = ws.path("fake-repo");
      initGitRepo(repoDir);
      const zcodeUserDir = join(ws.home, ".zcode", "cli");
      mkdirSync(zcodeUserDir, { recursive: true });
      writeFileSync(
        join(zcodeUserDir, "config.json"),
        JSON.stringify({
          apiKey: "ab1234",
          refresh_token: "rt99",
          jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
          note: "the token bucket refills",
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
      const tarPath = join(backupRoot, snapDirs[0]!, "user-state.tar.gz");
      const extractDir = ws.path("extracted");
      mkdirSync(extractDir, { recursive: true });
      const tarRes = runSubprocess("tar", ["-xzf", tarPath, "-C", extractDir], { cwd: ws.cwd });
      expect(tarRes.exitCode).toBe(0);

      const relConfig = join(extractDir, zcodeUserDir.slice(1), "config.json");
      const archived = readFileSync(relConfig, "utf8");
      expect(archived).not.toContain("ab1234");
      expect(archived).not.toContain("rt99");
      expect(archived).not.toContain("eyJhbGciOiJIUzI1NiJ9");
      expect(archived).toContain("REDACTED");
      expect(archived).toContain("the token bucket refills");
    });
  }, 45_000);

  test("A03.5: unparseable/corrupt JSON passed to ocel export fails closed without emitting partial output", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const badIn = ws.writeText("corrupt.ocel.json", '{"events":[{"id":');
      const outPath = ws.path("should-not-exist.ocel.json");
      const res = runZcodeCli(["ocel", "export", "--in", badIn, "--format", "json", "--out", outPath], ws);
      expect([1, 2]).toContain(res.exitCode);
      expect(existsSync(outPath)).toBe(false);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("Usage:");
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/parse|syntax|unexpected|REDACTION_FAILURE|JSON/i);
    });
  }, 45_000);
});

describe("A04 — Art. 11 & Annex IV Compiler Boundary/Negative Tests (5 tests)", () => {
  test("A04.1: zcode compliance annex-iv --out pointing to an existing regular file fails closed (exit 2)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const fileAsDir = ws.writeText("not-a-directory", "locked\n");
      const res = runZcodeCli(["compliance", "annex-iv", "--out", fileAsDir], ws);
      expect(res.exitCode).toBe(2);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/directory|not a directory|ENOTDIR|regular file|--out/i);
    });
  }, 45_000);

  test("A04.2: tampering with annex-iv.json causes annex-iv --check to exit non-zero", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outDir = ws.path("dossier-tamper");
      const gen = runZcodeCli(["compliance", "annex-iv", "--out", outDir], ws);
      expect(gen.exitCode).toBe(0);

      const jsonPath = join(outDir, "annex-iv.json");
      const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
      parsed.tampered_field = "forged-value";
      writeFileSync(jsonPath, JSON.stringify(parsed, null, 2), "utf8");

      const chk = runZcodeCli(["compliance", "annex-iv", "--out", outDir, "--check"], ws);
      expect([1, 2]).toContain(chk.exitCode);
      expect(chk.stdout + chk.stderr).toMatch(/drift|mismatch|tamper|differ|FAIL/i);
    });
  }, 45_000);

  test("A04.3: stale git HEAD SHA inside annex-iv.json causes annex-iv --check to fail closed", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const outDir = ws.path("dossier-stale-head");
      const gen = runZcodeCli(["compliance", "annex-iv", "--out", outDir], ws);
      expect(gen.exitCode).toBe(0);

      const jsonPath = join(outDir, "annex-iv.json");
      const raw = readFileSync(jsonPath, "utf8");
      const headRes = runSubprocess("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT });
      const realHead = headRes.stdout.trim();
      expect(raw).toContain(realHead);
      writeFileSync(jsonPath, raw.replaceAll(realHead, "deadbeef".repeat(5)), "utf8");

      const chk = runZcodeCli(["compliance", "annex-iv", "--out", outDir, "--check"], ws);
      expect([1, 2]).toContain(chk.exitCode);
      expect(chk.stdout + chk.stderr).toMatch(/head|sha|drift|mismatch|FAIL/i);
    });
  }, 45_000);

  test("A04.4: missing [pmm] section or monitoring_enabled=false under high-risk flags incomplete Annex IV §8 / fails --check", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", omitPmm: true, monitoringEnabled: false }));
      const outDir = ws.path("dossier-nopmm");
      const res = runZcodeCli(["compliance", "annex-iv", "--out", outDir, "--check"], ws);
      expect([1, 2]).toContain(res.exitCode);
      expect(res.stdout + res.stderr).toMatch(/pmm|monitoring|incomplete|UNVERIFIED|LOGGING_UNAVAILABLE/i);
    });
  }, 45_000);

  test("A04.5: missing --out argument value on compliance annex-iv exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const res = runZcodeCli(["compliance", "annex-iv", "--out"], ws);
      expect(res.exitCode).toBe(2);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/--out|missing|argument|required/i);
    });
  }, 45_000);
});

describe("A05 — Art. 12 OCEL 2.0, AppServer & Retention Boundary/Negative Tests (7 tests)", () => {
  test("A05.1: ZCODE_OCEL=0 with ZCODE_COMPLIANCE_LOG=0 under high-risk-annex-iii refuses with LOGGING_UNAVAILABLE", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", ocelEnabled: false }));
      await withLocalLlmServer(ws, async () => {
        const res = await runZcodeCliAsync(
          ["-p", "Reply OK", "--output-format", "stream-json"],
          ws,
          {
            env: {
              ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii",
              ZCODE_OCEL: "0",
              ZCODE_COMPLIANCE_LOG: "0",
            },
            timeoutMs: 12_000,
          },
        );
        expect([1, 2]).toContain(res.exitCode);
        expect(res.stdout + res.stderr).toContain("LOGGING_UNAVAILABLE");
      });
    });
  }, 45_000);

  test("A05.2: unwritable ZCODE_OCEL_DIR fails at preflight with LOGGING_UNAVAILABLE (exit 2)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const lockedDir = ws.path("locked-ocel-dir");
      mkdirSync(lockedDir, { recursive: true });
      chmodSync(lockedDir, 0o555);
      try {
        ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", ocelEnabled: true, ocelOutputDir: lockedDir }));
        await withLocalLlmServer(ws, async () => {
          const res = await runZcodeCliAsync(
            ["-p", "Reply OK", "--output-format", "stream-json"],
            ws,
            {
              env: {
                ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii",
                ZCODE_OCEL: "1",
                ZCODE_OCEL_DIR: join(lockedDir, "nested"),
              },
              timeoutMs: 12_000,
            },
          );
          expect(res.exitCode).toBe(2);
          expect(res.stdout + res.stderr).toContain("LOGGING_UNAVAILABLE");
        });
      } finally {
        chmodSync(lockedDir, 0o755);
      }
    });
  }, 45_000);

  test("A05.3: empty or corrupt JSON OCEL 2.0 file causes zcode ocel verify to fail closed (exit 1 or 2)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const emptyPath = ws.writeJson("empty.ocel.json", {});
      const emptyRes = runZcodeCli(["ocel", "verify", "--in", emptyPath, "--json"], ws);
      expect([1, 2]).toContain(emptyRes.exitCode);
      expect(emptyRes.stdout + emptyRes.stderr).not.toContain("Usage:");
      expect(emptyRes.stdout + emptyRes.stderr).toMatch(/objectTypes|eventTypes|events|ocel|schema/i);

      const corruptPath = ws.writeText("corrupt.ocel.json", "{not valid json");
      const corruptRes = runZcodeCli(["ocel", "verify", "--in", corruptPath, "--json"], ws);
      expect([1, 2]).toContain(corruptRes.exitCode);
      expect(corruptRes.stdout + corruptRes.stderr).not.toContain("Usage:");
      expect(corruptRes.stdout + corruptRes.stderr).toMatch(/parse|syntax|unexpected|invalid/i);
    });
  }, 45_000);

  test("A05.4: dangling E2O and dangling O2O objectId references fail zcode ocel verify with exit 1", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const baseE2o = buildConformingHighRiskSession({ sessionId: "sess_dangling_e2o" });
      baseE2o.events[0]!.relationships.push({ objectId: "missing_e2o_target", qualifier: "in_session" });
      const docE2o = buildOcel2Doc({
        objectTypes: baseE2o.objectTypes,
        eventTypes: baseE2o.eventTypes,
        objects: baseE2o.objects,
        events: baseE2o.events,
      });
      const e2oPath = ws.writeJson("dangling-e2o.ocel.json", docE2o);
      const r1 = runZcodeCli(["ocel", "verify", "--in", e2oPath, "--json"], ws);
      expect(r1.exitCode).toBe(1);
      expect(r1.stdout + r1.stderr).toContain("missing_e2o_target");

      const baseO2o = buildConformingHighRiskSession({ sessionId: "sess_dangling_o2o" });
      baseO2o.objects[0]!.relationships.push({ objectId: "missing_o2o_target", qualifier: "part_of" });
      const o2oPath = ws.writeJson("dangling-o2o.ocel.json", baseO2o);
      const r2 = runZcodeCli(["ocel", "verify", "--in", o2oPath, "--json"], ws);
      expect(r2.exitCode).toBe(1);
      expect(r2.stdout + r2.stderr).toContain("missing_o2o_target");
    });
  }, 45_000);

  test("A05.5: non-monotonic dynamic object attribute timestamp (t2 < t1) fails zcode ocel verify (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_nonmono" });
      const turnObj = doc.objects.find((o) => o.type === "turn")!;
      turnObj.attributes = [
        { name: "standing", value: "RUNNING", time: "2026-08-02T10:05:00.000Z" },
        { name: "standing", value: "ALIVE", time: "2026-08-02T10:00:01.000Z" },
      ];
      const inPath = ws.writeJson("non-monotonic.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toMatch(/monotonic|timestamp|order/i);
    });
  }, 45_000);

  test("A05.6: tampered pi_hash chain fails both zcode ocel verify and scripts/ocel-verify.ts (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_bad_hash" });
      const hashAttr = doc.events[1]!.attributes.find((a) => a.name === "pi_hash")!;
      hashAttr.value = "a".repeat(64);
      const inPath = ws.writeJson("tampered-hash.ocel.json", doc);

      const cliRes = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(cliRes.exitCode).toBe(1);
      expect(cliRes.stdout + cliRes.stderr).toMatch(/pi_hash|hash|chain/i);

      // Also verify legacy scripts/ocel-verify.ts rejects a tampered .jsonocel + receipt
      const fixtureSrc = readFileSync(join(REPO_ROOT, "test/fixtures/zcode-ocel/turn-list.jsonocel"), "utf8");
      const parsed = JSON.parse(fixtureSrc) as Ocel2Doc;
      parsed.events[0]!.attributes.find((a) => a.name === "pi_hash")!.value = "b".repeat(64);
      const badJsonOcel = ws.writeJson("bad.jsonocel", parsed);
      const badReceipt = {
        ocel_file_sha256: sha256File(badJsonOcel),
        event_count: parsed.events.length,
        head_hash: "b".repeat(64),
        chain: [],
      };
      ws.writeJson("bad.receipt.json", badReceipt);
      const scriptRes = runBunScript("scripts/ocel-verify.ts", [badJsonOcel], { cwd: REPO_ROOT });
      expect(scriptRes.exitCode).toBe(1);
    });
  }, 45_000);

  test("A05.7: SQLite WAL export integrity & corrupted/truncated SQLite rejection", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_sqlite_wal" });
      const inPath = ws.writeJson("wal.ocel.json", doc);
      const dbPath = ws.path("wal.ocel.sqlite");
      const exp = runZcodeCli(["ocel", "export", "--in", inPath, "--format", "sqlite", "--out", dbPath], ws);
      expect(exp.exitCode).toBe(0);

      const db = new Database(dbPath);
      try {
        const integrity = db.query("PRAGMA integrity_check;").get() as { integrity_check: string };
        expect(integrity.integrity_check).toBe("ok");
      } finally {
        db.close();
      }

      // Truncate a copy to simulate crash-corrupted file outside WAL commit
      const corruptDb = ws.path("truncated.ocel.sqlite");
      writeFileSync(corruptDb, readFileSync(dbPath).subarray(0, 64));
      const badVerify = runZcodeCli(["ocel", "verify", "--in", corruptDb, "--json"], ws);
      expect([1, 2]).toContain(badVerify.exitCode);
      expect(badVerify.stdout + badVerify.stderr).not.toContain("Usage:");
      expect(badVerify.stdout + badVerify.stderr).toMatch(/sqlite|corrupt|invalid|malformed|database/i);
    });
  }, 45_000);
});

describe("A06 — Art. 13 Instructions for Use & compliance info Negative/Boundary Tests (5 tests)", () => {
  test("A06.1: invalid --format bogus flag on zcode compliance info exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const res = runZcodeCli(["compliance", "info", "--format", "bogus"], ws);
      expect(res.exitCode).toBe(2);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/--format|format|bogus|unsupported/i);
    });
  }, 45_000);

  test("A06.2: malformed zcode-cli.toml causes zcode compliance info to fail closed (exit 2)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeText("zcode-cli.toml", "[compliance]\nmin_review_ms = \"not_an_int\"\n");
      const res = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(res.exitCode).toBe(2);
      expect(res.stdout + res.stderr).toContain("INVALID_COMPLIANCE_CONFIG");
    });
  }, 45_000);

  test("A06.3: standard vs high-risk-annex-iii profile distinguishes prohibited autonomous safety-critical use", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "standard" }));
      const stdRes = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(stdRes.exitCode).toBe(0);
      const stdText = JSON.stringify(stdRes.json());

      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const hrRes = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(hrRes.exitCode).toBe(0);
      const hrText = JSON.stringify(hrRes.json());

      expect(stdText).toContain("standard");
      expect(hrText).toContain("high-risk-annex-iii");
      expect(hrText).not.toBe(stdText);
      expect(hrText.toLowerCase()).toMatch(/prohibit|oversight|high-risk/);
    });
  }, 45_000);

  test("A06.4: compliance info without soak logs never mislabels unverified accuracy/conformance standing as ALIVE", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const res = runZcodeCli(["compliance", "info", "--json"], ws);
      expect(res.exitCode).toBe(0);
      const parsed = res.json<{ standing?: string; runtime_standing?: string; alignment_standing?: string }>();
      const standings = [parsed.standing, parsed.runtime_standing, parsed.alignment_standing].filter(Boolean);
      expect(standings).not.toContain("ALIVE");
    });
  }, 45_000);

  test("A06.5: docs/INSTRUCTIONS_FOR_USE.md explicitly documents prohibited uses, limitations, and human oversight", () => {
    const docPath = join(REPO_ROOT, "docs", "INSTRUCTIONS_FOR_USE.md");
    expect(existsSync(docPath)).toBe(true);
    const md = readFileSync(docPath, "utf8").toLowerCase();
    expect(md).toMatch(/limitation|out.?of.?scope|prohibit/);
    expect(md).toMatch(/human oversight|overseer|art\.?\s*14/);
    expect(md).toMatch(/accuracy|robustness|cybersecurity|art\.?\s*15/);
  });
});

describe("A07 — Art. 14 Human Oversight, YOLO Block & Stop Negative/Boundary Tests (6 tests)", () => {
  test("A07.1: --dangerously-skip-permissions under high-risk-annex-iii is refused with OVERSIGHT_POLICY_REFUSED (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", allowYolo: false }));
      const res = runZcodeCli(["-p", "Reply OK", "--dangerously-skip-permissions"], ws, {
        env: { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" },
      });
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
    });
  }, 45_000);

  test("A07.2: --mode yolo, --permission-mode bypassPermissions, and --permission-mode dontAsk under high-risk-annex-i all exit 1", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-i", allowYolo: false }));
      const forbiddenInvocations = [
        ["-p", "Reply OK", "--mode", "yolo"],
        ["-p", "Reply OK", "--permission-mode", "bypassPermissions"],
        ["-p", "Reply OK", "--permission-mode", "dontAsk"],
      ];
      for (const args of forbiddenInvocations) {
        const res = runZcodeCli(args, ws, { env: { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-i" } });
        expect(res.exitCode).toBe(1);
        expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
      }
    });
  }, 45_000);

  test("A07.3: allow_yolo = true in zcode-cli.toml under high-risk-annex-iii refuses with OVERSIGHT_POLICY_REFUSED (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", allowYolo: true }));
      const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
    });
  }, 45_000);

  test("A07.4: subagent oversight inheritance refuses privilege escalation / ZCODE_ALLOW_YOLO=1 under regulated profile", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", allowYolo: false }));
      const res = runZcodeCli(
        ["-p", "Spawn subagent", "--mode", "yolo"],
        ws,
        {
          env: {
            ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii",
            ZCODE_SUBAGENT: "1",
            ZCODE_ALLOW_YOLO: "1",
          },
        },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
    });
  }, 45_000);

  test("A07.5: decision_latency_ms < 500ms (< min_review_ms) sets AB_RISK_FLAG automation-bias warning", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", minReviewMs: 1000 }));
      const doc = buildOversightCrashSession({ kind: "ab_risk" });
      const inPath = ws.writeJson("ab-risk.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.stdout + res.stderr).toContain("AB_RISK_FLAG");
    });
  }, 45_000);

  test("A07.6: missing overseer_id on permission_resolved under regulated profile fails oversight verification (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const base = buildConformingHighRiskSession({ sessionId: "sess_no_overseer" });
      const events = base.events.map((ev) =>
        ev.type === "permission_resolved"
          ? { ...ev, attributes: ev.attributes.filter((a) => a.name !== "overseer_id") }
          : ev,
      );
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events,
      });
      const inPath = ws.writeJson("no-overseer.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toMatch(/overseer_id|OVERSIGHT_POLICY_REFUSED|missing/i);
    });
  }, 45_000);
});

describe("A08 — Art. 15 Security, Injection & Rollback Negative/Boundary Tests (5 tests)", () => {
  test("A08.1: tampering event relationships[0].objectId invalidates pi_hash and fails ocel verify (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_tamper_rel" });
      // Mutate relationship objectId WITHOUT recomputing pi_hash
      doc.events[2]!.relationships[0]!.objectId = doc.objects[1]!.id;
      const inPath = ws.writeJson("tamper-rel.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toMatch(/pi_hash|hash|chain/i);
    });
  }, 45_000);

  test("A08.2: deleting a middle event breaks pi_parent chain and fails ocel verify (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_del_mid" });
      doc.events.splice(2, 1);
      const inPath = ws.writeJson("deleted-middle.ocel.json", doc);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toMatch(/pi_parent|chain|hash/i);
    });
  }, 45_000);

  test("A08.3: tampered dataset-manifest.json SHA-256 mismatch is caught when compared against disk", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const manifestPath = join(REPO_ROOT, "compliance", "dataset-manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        datasets?: Array<{ path: string; sha256: string }>;
        entries?: Array<{ path: string; sha256: string }>;
      };
      const items = manifest.datasets ?? manifest.entries ?? [];
      expect(items.length).toBeGreaterThan(0);

      // Verify clean manifest matches disk SHA-256
      for (const item of items) {
        const target = join(REPO_ROOT, item.path);
        expect(existsSync(target)).toBe(true);
        expect(sha256File(target)).toBe(item.sha256);
      }

      // Mutate a copy in isolated workspace and verify SHA-256 mismatch detection catches it
      const first = items[0]!;
      const forgedSha = first.sha256.startsWith("0") ? "f".repeat(64) : "0".repeat(64);
      const tamperedManifestPath = ws.writeJson("tampered-dataset-manifest.json", {
        ...manifest,
        ...(manifest.datasets
          ? { datasets: [{ ...first, sha256: forgedSha }, ...items.slice(1)] }
          : { entries: [{ ...first, sha256: forgedSha }, ...items.slice(1)] }),
      });
      const tampered = JSON.parse(readFileSync(tamperedManifestPath, "utf8")) as {
        datasets?: Array<{ path: string; sha256: string }>;
        entries?: Array<{ path: string; sha256: string }>;
      };
      const tamperedItems = tampered.datasets ?? tampered.entries ?? [];
      const mismatches = tamperedItems.filter(
        (entry) => sha256File(join(REPO_ROOT, entry.path)) !== entry.sha256,
      );
      expect(mismatches.length).toBe(1);
      expect(mismatches[0]?.path).toBe(first.path);

      // Verify adversarial test suite executes and enforces prompt-injection + manifest guards
      const secTest = runSubprocess(process.execPath, ["test", "test/security-adversarial.test.ts"], {
        cwd: REPO_ROOT,
        timeoutMs: 20_000,
      });
      expect(secTest.exitCode).toBe(0);
    });
  }, 45_000);

  test("A08.4: dirty workspace with rollback_on_dirty = false refuses with DIRTY_TIMEOUT_REFUSED", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", rollbackOnDirty: false, maxTransportRetries: 2 }),
      );
      repo.commitAll("chore: add config");
      ws.writeText("dirty-uncommitted.ts", "export const dirty = true;\n");

      const doc = buildOversightCrashSession({ kind: "crash" });
      const logsDir = ws.path("dirty-logs");
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, "dirty.ocel.json"), JSON.stringify(doc), "utf8");

      const res = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect([1, 2]).toContain(res.exitCode);
      expect(res.stdout + res.stderr).toMatch(/DIRTY_TIMEOUT_REFUSED|dirty/i);
    });
  }, 45_000);

  test("A08.5: DfCM receipt missing identity.subject_sha or tampered replay SHA fails validateDfcmReceipt (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      const head = repo.headSha();
      const durableFile = ws.writeText("out.json", '{"status":"ok"}\n');
      const forgedReceipt = ws.writeJson("bad.receipt.json", {
        work_order_id: "WO-E2E-BAD-01",
        origin_authority: { grant: "e2e", actor: "e2e", ceiling: "CONSTRUCT" },
        provider: { name: "zcode-cli-e2e" },
        provider_execution_id: "exec-bad-01",
        identity: { subject: "test", repo: repo.cwd, base_sha: head },
        authority: { ceiling: "CONSTRUCT", grant: "e2e", actor: "e2e" },
        consequence: { commits: [head], files_changed: ["README.md"], remote_effects: [] },
        replay: {
          commands: [{ cmd: "echo ok", exit: 0, cwd: repo.cwd, output_sha256: "0".repeat(64) }],
          durable_location: durableFile,
        },
        standing: { value: "ALIVE", derived_from: `echo ok at ${head}` },
      });
      const v = validateDfcmReceipt(forgedReceipt, { cwd: repo.cwd });
      expect(v.admitted).toBe(false);
      expect(v.exitCode).not.toBe(0);
    });
  }, 45_000);
});

describe("A09 — Art. 17/43/47/48 QMS, assess, DoC & receipts Negative/Boundary Tests (5 tests)", () => {
  test("A09.1: zcode compliance assess on empty --logs directory fails closed (never CONFORMITY_ADMITTED)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const emptyLogs = ws.path("empty-logs");
      mkdirSync(emptyLogs, { recursive: true });
      const res = runZcodeCli(["compliance", "assess", "--logs", emptyLogs, "--json"], ws);
      expect([1, 2]).toContain(res.exitCode);
      expect(res.stdout).not.toContain("CONFORMITY_ADMITTED");
      expect(res.stdout + res.stderr).toMatch(/UNVERIFIED|empty|no logs|0 logs/i);
    });
  }, 45_000);

  test("A09.2: compliance assess refuses (exit 1) when soak logs contain tampered pi_hash", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii" }));
      const logsDir = ws.path("tampered-logs");
      mkdirSync(logsDir, { recursive: true });
      const doc = buildConformingHighRiskSession({ sessionId: "sess_assess_bad" });
      doc.events[0]!.attributes.find((a) => a.name === "pi_hash")!.value = "0".repeat(64);
      writeFileSync(join(logsDir, "bad.ocel.json"), JSON.stringify(doc), "utf8");

      const res = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).not.toContain("Usage:");
      expect(res.stdout + res.stderr).toMatch(/pi_hash|hash|chain|tamper/i);
      expect(res.stdout).not.toContain("CONFORMITY_ADMITTED");
    });
  }, 45_000);

  test("A09.3: zcode compliance doc refuses (exit 1 or 2) when regulated config fails oversight policy", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", allowYolo: true }));
      const outPath = ws.path("should-not-doc.json");
      const res = runZcodeCli(["compliance", "doc", "--out", outPath], ws);
      expect([1, 2]).toContain(res.exitCode);
      expect(existsSync(outPath)).toBe(false);
      expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
    });
  }, 45_000);

  test("A09.4: validateDfcmReceipt refuses empty JSON receipt {} fail-closed (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      const emptyReceipt = ws.writeJson("empty.receipt.json", {});
      const v = validateDfcmReceipt(emptyReceipt, { cwd: repo.cwd });
      expect(v.admitted).toBe(false);
      expect(v.exitCode).toBe(1);
    });
  }, 45_000);

  test("A09.5: invalid compliance subcommand or bogus flag exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const badCmd = runZcodeCli(["compliance", "nonexistent-subcommand"], ws);
      expect(badCmd.exitCode).toBe(2);
      const badCmdOut = badCmd.stdout + badCmd.stderr;
      expect(badCmdOut).not.toContain("invalid input or flag");
      expect(badCmdOut).not.toMatch(/^Unknown command$/im);
      expect(badCmdOut).toMatch(/nonexistent-subcommand|subcommand/i);

      const badFlag = runZcodeCli(["compliance", "assess", "--unknown-flag-xyz"], ws);
      expect(badFlag.exitCode).toBe(2);
      const badFlagOut = badFlag.stdout + badFlag.stderr;
      expect(badFlagOut).not.toContain("invalid input or flag");
      expect(badFlagOut).toMatch(/--unknown-flag-xyz|unknown option|unknown flag/i);
    });
  }, 45_000);
});

describe("A10 — Art. 26/27 Deployer Preflight, Config & FRIA Boundary/Negative Tests (5 tests)", () => {
  test("A10.1: log_retention_days = 179 (< 180 boundary) fails deployer-check (exit 1) while 180 passes (exit 0)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfg179 = ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", logRetentionDays: 179, overseerId: "overseer-eu" }),
        "zcode-179.toml",
      );
      const res179 = runZcodeCli(["compliance", "deployer-check", "--config", cfg179, "--json"], ws);
      expect(res179.exitCode).toBe(1);
      expect(res179.stdout + res179.stderr).toMatch(/179|180|retention|LOGGING_UNAVAILABLE/i);

      const cfg180 = ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", logRetentionDays: 180, overseerId: "overseer-eu" }),
        "zcode-180.toml",
      );
      const res180 = runZcodeCli(["compliance", "deployer-check", "--config", cfg180, "--json"], ws);
      expect(res180.exitCode).toBe(0);
    });
  }, 45_000);

  test("A10.2: missing overseer_id under high-risk-annex-iii fails deployer-check (exit 1, OVERSIGHT_POLICY_REFUSED)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", overseerId: "", logRetentionDays: 180 }),
      );
      const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws, {
        env: { ZCODE_OVERSEER_ID: undefined },
      });
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
    });
  }, 45_000);

  test("A10.3: monitoring_enabled = false fails deployer-check (exit 1, LOGGING_UNAVAILABLE)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", monitoringEnabled: false, logRetentionDays: 180 }),
      );
      const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("LOGGING_UNAVAILABLE");
    });
  }, 45_000);

  test("A10.4: forbidden static concurrency keys ([aimd].concurrency = 4 / wip = 8 / max_parallel = 4) exit 2 with STATIC_CONCURRENCY_FORBIDDEN", async () => {
    await withIsolatedWorkspace(async (ws) => {
      for (const key of ["concurrency", "wip", "workers", "max_parallel"] as const) {
        const cfgPath = ws.writeToml(
          buildComplianceToml({
            profile: "high-risk-annex-iii",
            staticConcurrencyKey: { name: key, value: 4 },
          }),
          `zcode-${key}.toml`,
        );
        const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
        expect(res.exitCode).toBe(2);
        expect(res.stdout + res.stderr).toContain("STATIC_CONCURRENCY_FORBIDDEN");
      }
    });
  }, 45_000);

  test("A10.5: fria-export on missing overseer_id / invalid config fails closed instead of fabricating deployer fields", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", overseerId: "" }));
      const outPath = ws.path("fria-bad.json");
      const res = runZcodeCli(["compliance", "fria-export", "--out", outPath], ws, {
        env: { ZCODE_OVERSEER_ID: undefined },
      });
      expect([1, 2]).toContain(res.exitCode);
      expect(existsSync(outPath)).toBe(false);
      expect(res.stdout + res.stderr).toMatch(/OVERSIGHT_POLICY_REFUSED|overseer_id/i);
    });
  }, 45_000);
});

describe("A11 — Art. 72/73 PMM & Serious Incident Negative/Boundary Tests (5 tests)", () => {
  test("A11.1: empty or corrupt log dir passed to zcode pmm analyze exits 2 (never reports false no_drift)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const emptyDir = ws.path("pmm-empty");
      mkdirSync(emptyDir, { recursive: true });
      const resEmpty = runZcodeCli(["pmm", "analyze", "--logs", emptyDir, "--json"], ws);
      expect(resEmpty.exitCode).toBe(2);
      expect(resEmpty.stdout).not.toContain('"driftDetected":false');
      const emptyOut = resEmpty.stdout + resEmpty.stderr;
      expect(emptyOut).not.toContain("invalid input or flag");
      expect(emptyOut).toMatch(/empty|no logs|0 logs|0 events|min_window|LOGGING_UNAVAILABLE|no.*ocel/i);

      const corruptDir = ws.path("pmm-corrupt");
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(join(corruptDir, "bad.ocel.json"), "{corrupt", "utf8");
      const resCorrupt = runZcodeCli(["pmm", "analyze", "--logs", corruptDir, "--json"], ws);
      expect(resCorrupt.exitCode).toBe(2);
      const corruptOut = resCorrupt.stdout + resCorrupt.stderr;
      expect(corruptOut).not.toContain("invalid input or flag");
      expect(corruptOut).toMatch(/parse|syntax|JSON|corrupt|unexpected/i);
    });
  }, 45_000);

  test("A11.2: single 10-minute refactor turn outlier amid fast turns (c_s^2 >> 1) with healthy TTFT does NOT trigger false Art. 72/73 drift", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("pmm-outlier");
      mkdirSync(logsDir, { recursive: true });
      const items = buildPmmLogSet("stationary", 30);
      // Replace one session's service_ms with 600_000ms (10 minutes) while keeping ttft_ms = 110ms
      const outlier = items[15]!.doc;
      const reqObj = outlier.objects.find((o) => o.type === "model_request")!;
      reqObj.attributes = reqObj.attributes.map((a) => (a.name === "service_ms" ? { ...a, value: "600000" } : a));
      outlier.events = outlier.events.map((ev) =>
        ev.type === "model_request_completed"
          ? {
              ...ev,
              attributes: ev.attributes.map((a) => (a.name === "service_ms" ? { ...a, value: "600000" } : a)),
            }
          : ev,
      );
      items[15]!.doc = buildOcel2Doc({
        objectTypes: outlier.objectTypes,
        eventTypes: outlier.eventTypes,
        objects: outlier.objects,
        events: outlier.events,
      });
      for (const item of items) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }

      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected?: boolean; ttftMdTriggered?: boolean }>();
      expect(out.driftDetected).toBe(false);
      expect(out.ttftMdTriggered ?? false).toBe(false);
    });
  }, 45_000);

  test("A11.3: sustained >= 3-sigma drop in fitness & oversight triggers drift alert and escalates PMM verdict", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("pmm-3sigma");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("sudden_drift", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected?: boolean; pValue?: number }>();
      expect(out.driftDetected).toBe(true);
      expect(typeof out.pValue).toBe("number");
      expect(out.pValue!).toBeLessThan(0.01);
    });
  }, 45_000);

  test("A11.4: zcode incident report for nonexistent --session exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildOversightCrashSession({ kind: "crash" });
      const inPath = ws.writeJson("crash.ocel.json", doc);
      const outPath = ws.path("missing-session-incident.json");
      const res = runZcodeCli(
        ["incident", "report", "--in", inPath, "--out", outPath, "--session", "nonexistent_session_xyz"],
        ws,
      );
      expect(res.exitCode).toBe(2);
      expect(existsSync(outPath)).toBe(false);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/nonexistent_session_xyz|session.*not found|missing.*session/i);
    });
  }, 45_000);

  test("A11.5: sample window < min_window (10 < 20) reports UNVERIFIED / insufficient power honestly", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ minWindow: 20 }));
      const logsDir = ws.path("pmm-small");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("stationary", 10)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      if (res.exitCode === 2) {
        expect(res.stdout + res.stderr).toMatch(/min_window|window|insufficient|UNVERIFIED|power/i);
      } else {
        expect(res.exitCode).toBe(0);
        const out = res.json<{ standing?: string; status?: string; insufficientPower?: boolean }>();
        expect(
          out.standing === "UNVERIFIED" ||
            out.status === "UNVERIFIED" ||
            out.insufficientPower === true,
        ).toBe(true);
      }
    });
  }, 45_000);
});

describe("A12 — Declare / LTLf Conformance & Anti-Vacuity Negative Tests (5 tests)", () => {
  test("A12.1: ANTI-VACUITY — Precedence(permission_resolved, tool_updated) with 0 tool_updated events yields SATISFIED_VACUOUS (never SATISFIED_WITNESSED)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_vacuous" });
      const withoutTool = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: base.events.filter((e) => e.type !== "tool_updated"),
      });
      const inPath = ws.writeJson("vacuous.ocel.json", withoutTool);
      const rulesPath = ws.writeJson(
        "vacuous.rules.json",
        buildDeclareRulesJson([
          {
            id: "DEC-PREC-VAC",
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
      const out = res.json<{
        declareResults: Array<{ id: string; status: string; witness_event_ids: string[] }>;
      }>();
      const rule = out.declareResults.find((r) => r.id === "DEC-PREC-VAC");
      expect(rule).toBeDefined();
      expect(rule?.status).toBe("SATISFIED_VACUOUS");
      expect(rule?.status).not.toBe("SATISFIED_WITNESSED");
      expect(rule?.witness_event_ids).toEqual([]);
    });
  }, 45_000);

  test("A12.2: tool_updated without prior permission_resolved fails Precedence with exit 1, VIOLATED, and counterexample_event_ids", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_viol_prec" });
      const noPermEvents = base.events.filter((e) => e.type !== "permission_resolved");
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: noPermEvents,
      });
      const inPath = ws.writeJson("viol-prec.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "viol-prec.rules.json",
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
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const out = res.json<{
        declareResults: Array<{ id: string; status: string; counterexample_event_ids: string[] }>;
      }>();
      const rule = out.declareResults.find((r) => r.id === "DEC-PREC-ART14")!;
      expect(rule.status).toBe("VIOLATED");
      expect(rule.counterexample_event_ids.length).toBeGreaterThan(0);
    });
  }, 45_000);

  test("A12.3: missing art50_disclosure_emitted after session_created violates Response (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_viol_resp" });
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: base.events.filter((e) => e.type !== "art50_disclosure_emitted"),
      });
      const inPath = ws.writeJson("viol-resp.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "viol-resp.rules.json",
        buildDeclareRulesJson([
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
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const rule = res.json<{
        declareResults: Array<{ status: string; counterexample_event_ids: string[] }>;
      }>().declareResults[0]!;
      expect(rule.status).toBe("VIOLATED");
      expect(rule.counterexample_event_ids.length).toBeGreaterThan(0);
    });
  }, 45_000);

  test("A12.4: co-occurrence of mode_yolo_enabled and high_risk_profile_active violates NotCoExistence (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_notco" });
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: [
          ...base.events.slice(0, -2),
          {
            id: "sess_notco_yolo",
            type: "mode_yolo_enabled",
            time: "2026-08-02T10:00:04.100Z",
            attributes: [],
            relationships: [{ objectId: "sess_notco", qualifier: "in_session" }],
          },
          {
            id: "sess_notco_hr",
            type: "high_risk_profile_active",
            time: "2026-08-02T10:00:04.200Z",
            attributes: [],
            relationships: [{ objectId: "sess_notco", qualifier: "in_session" }],
          },
          ...base.events.slice(-2),
        ],
      });
      const inPath = ws.writeJson("viol-notco.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "viol-notco.rules.json",
        buildDeclareRulesJson([
          {
            id: "DEC-NOTCO",
            template: "NotCoExistence",
            activation: "mode_yolo_enabled",
            target: "high_risk_profile_active",
            objectType: "session",
            mandatory: true,
          },
        ]),
      );
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const rule = res.json<{ declareResults: Array<{ status: string; counterexample_event_ids: string[] }> }>()
        .declareResults[0]!;
      expect(rule.status).toBe("VIOLATED");
      expect(rule.counterexample_event_ids.length).toBeGreaterThan(0);
    });
  }, 45_000);

  test("A12.5: ChainResponse(worker_claim, receipt_persist) fails with VIOLATED when an intervening event appears (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_chain_viol" });
      const wo = {
        id: "wo_chain_01",
        type: "work_order",
        attributes: [{ name: "work_order_id", value: "WO-CHAIN-01", time: "2026-08-02T10:00:04.000Z" }],
        relationships: [{ objectId: "sess_chain_viol", qualifier: "in_session" }],
      };
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: [...base.objects, wo],
        events: [
          ...base.events.slice(0, -2),
          {
            id: "ev_claim",
            type: "worker_claim",
            time: "2026-08-02T10:00:04.800Z",
            attributes: [],
            relationships: [{ objectId: "wo_chain_01", qualifier: "in_work_order" }],
          },
          {
            id: "ev_intervene",
            type: "tool_updated",
            time: "2026-08-02T10:00:04.850Z",
            attributes: [{ name: "tool_name", value: "Bash" }],
            relationships: [{ objectId: "wo_chain_01", qualifier: "in_work_order" }],
          },
          {
            id: "ev_persist",
            type: "receipt_persist",
            time: "2026-08-02T10:00:04.900Z",
            attributes: [],
            relationships: [{ objectId: "wo_chain_01", qualifier: "in_work_order" }],
          },
          ...base.events.slice(-2),
        ],
      });
      const inPath = ws.writeJson("viol-chain.ocel.json", doc);
      const rulesPath = ws.writeJson(
        "viol-chain.rules.json",
        buildDeclareRulesJson([
          {
            id: "DEC-CHAIN",
            template: "ChainResponse",
            activation: "worker_claim",
            target: "receipt_persist",
            objectType: "work_order",
            mandatory: true,
          },
        ]),
      );
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--declare", rulesPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const rule = res.json<{ declareResults: Array<{ status: string; counterexample_event_ids: string[] }> }>()
        .declareResults[0]!;
      expect(rule.status).toBe("VIOLATED");
      expect(rule.counterexample_event_ids.length).toBeGreaterThan(0);
    });
  }, 45_000);
});

describe("A13 — Optimal A* Trace Alignment Boundary/Negative Tests (5 tests)", () => {
  test("A13.1: missing mandatory permission_resolved yields model_move (alignmentCost >= 1, fitness < 1.0)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_model_move" });
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: base.events.filter((e) => e.type !== "permission_resolved"),
      });
      const inPath = ws.writeJson("missing-step.ocel.json", doc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const out = res.json<{
        alignment: {
          alignmentCost: number;
          fitness: number;
          modelMoves?: number;
          moves: Array<{ kind: string; activity?: string }>;
        };
      }>();
      expect(out.alignment.alignmentCost).toBeGreaterThanOrEqual(1);
      expect(out.alignment.fitness).toBeLessThan(1);
      expect(out.alignment.moves.some((m) => m.kind === "model_move")).toBe(true);
    });
  }, 45_000);

  test("A13.2: unexpected extra tool_updated event yields log_move (alignmentCost >= 1, fitness < 1.0)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_log_move", extraToolCount: 1 });
      const inPath = ws.writeJson("extra-step.ocel.json", doc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const out = res.json<{
        alignment: {
          alignmentCost: number;
          fitness: number;
          logMoves?: number;
          moves: Array<{ kind: string }>;
        };
      }>();
      expect(out.alignment.alignmentCost).toBeGreaterThanOrEqual(1);
      expect(out.alignment.fitness).toBeLessThan(1);
      expect(out.alignment.moves.some((m) => m.kind === "log_move")).toBe(true);
    });
  }, 45_000);

  test("A13.3: swapped out-of-order events yield alignmentCost >= 2 (both log_move and model_move)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_swapped" });
      const events = [...base.events];
      const idxPerm = events.findIndex((e) => e.type === "permission_resolved");
      const idxTool = events.findIndex((e) => e.type === "tool_updated");
      const permEv = events[idxPerm]!;
      const toolEv = events[idxTool]!;
      events[idxPerm] = { ...toolEv, time: permEv.time };
      events[idxTool] = { ...permEv, time: toolEv.time };

      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events,
      });
      const inPath = ws.writeJson("swapped.ocel.json", doc);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const out = res.json<{
        alignment: { alignmentCost: number; moves: Array<{ kind: string }> };
      }>();
      expect(out.alignment.alignmentCost).toBeGreaterThanOrEqual(2);
      expect(out.alignment.moves.some((m) => m.kind === "log_move")).toBe(true);
      expect(out.alignment.moves.some((m) => m.kind === "model_move")).toBe(true);
    });
  }, 45_000);

  test("A13.4: malformed cyclic WF-net / missing sourcePlace exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_bad_wf" });
      const inPath = ws.writeJson("ok.ocel.json", doc);
      const badWf = {
        places: [{ id: "p_a", objectType: "Workflow" }, { id: "p_b", objectType: "Workflow" }],
        transitions: [
          { id: "t1", label: "session_created", silent: false, activityId: "session_created", objectType: "session" },
          { id: "t2", label: "turn_started", silent: false, activityId: "turn_started", objectType: "turn" },
        ],
        pre: { t1: ["p_a"], t2: ["p_b"] },
        post: { t1: ["p_b"], t2: ["p_a"] },
        sourcePlace: "missing_source_place",
        sinkPlace: "p_b",
      };
      const wfPath = ws.writeJson("malformed-cyclic.wfnet.json", badWf);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(2);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/sourcePlace|missing_source_place|wfnet|cyclic|soundness|unsound/i);
    });
  }, 45_000);

  test("A13.5: empty observed trace against non-trivial WF-net produces fitness === 0 (all model_move, never 1.0)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const emptyTrace = buildOcel2Doc({
        objects: [{ id: "sess_empty", type: "session", attributes: [], relationships: [] }],
        events: [],
      });
      const inPath = ws.writeJson("empty-trace.ocel.json", emptyTrace);
      const wfPath = ws.writeJson("linear.wfnet.json", buildWfNetJson());
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--wfnet", wfPath, "--json"], ws);
      expect(res.exitCode).toBe(1);
      const out = res.json<{
        alignment: { fitness: number; alignmentCost: number; moves: Array<{ kind: string }> };
      }>();
      expect(out.alignment.fitness).toBe(0);
      expect(out.alignment.alignmentCost).toBeGreaterThanOrEqual(9);
      expect(out.alignment.moves.every((m) => m.kind === "model_move")).toBe(true);
    });
  }, 45_000);
});

describe("A14 — OCPN & OC-DFG Discovery Boundary/Negative Tests (5 tests)", () => {
  test("A14.1: log missing required compliance object types reports UNOBSERVED_OBJECT_TYPE under --ocpn", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const minimal = buildOcel2Doc({
        objects: [{ id: "sess_min", type: "session", attributes: [], relationships: [] }],
        events: [
          {
            id: "ev_min_1",
            type: "session_created",
            time: "2026-08-02T10:00:00.000Z",
            attributes: [],
            relationships: [{ objectId: "sess_min", qualifier: "in_session" }],
          },
        ],
      });
      const inPath = ws.writeJson("minimal.ocel.json", minimal);
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--ocpn", "--format", "json"], ws);
      expect(res.stdout + res.stderr).toContain("UNOBSERVED_OBJECT_TYPE");
    });
  }, 45_000);

  test("A14.2: rework loop (tool_updated -> turn_failed -> tool_updated -> turn_failed -> tool_updated) surfaces reworkCycles", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_rework_2" });
      const head = base.events.slice(0, -2);
      const tail = base.events.slice(-2);
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: [
          ...head,
          {
            id: "rw_fail_1",
            type: "turn_failed",
            time: "2026-08-02T10:00:03.100Z",
            attributes: [{ name: "error_signature", value: "TS2322" }],
            relationships: [{ objectId: "sess_rework_2_turn_01", qualifier: "in_turn" }],
          },
          {
            id: "rw_tool_2",
            type: "tool_updated",
            time: "2026-08-02T10:00:03.200Z",
            attributes: [{ name: "tool_name", value: "Write" }],
            relationships: [{ objectId: "sess_rework_2_turn_01", qualifier: "in_turn" }],
          },
          {
            id: "rw_fail_2",
            type: "turn_failed",
            time: "2026-08-02T10:00:03.300Z",
            attributes: [{ name: "error_signature", value: "TS2322" }],
            relationships: [{ objectId: "sess_rework_2_turn_01", qualifier: "in_turn" }],
          },
          {
            id: "rw_tool_3",
            type: "tool_updated",
            time: "2026-08-02T10:00:03.400Z",
            attributes: [{ name: "tool_name", value: "Write" }],
            relationships: [{ objectId: "sess_rework_2_turn_01", qualifier: "in_turn" }],
          },
          ...tail,
        ],
      });
      const inPath = ws.writeJson("rework2.ocel.json", doc);
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--format", "json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ reworkCycles: Array<{ count?: number }> }>();
      expect(out.reworkCycles.length).toBeGreaterThan(0);
    });
  }, 45_000);

  test("A14.3: concurrent mutated_in on the same workspace_file triggers fileCollisions diagnostic", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_coll" });
      const fileId = "sess_coll_file_01";
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: [
          ...base.objects,
          {
            id: "sess_coll_turn_02",
            type: "turn",
            attributes: [{ name: "standing", value: "RUNNING", time: "2026-08-02T10:00:02.000Z" }],
            relationships: [{ objectId: "sess_coll", qualifier: "in_session" }],
          },
        ],
        events: [
          ...base.events.slice(0, -2),
          {
            id: "ev_coll_2",
            type: "tool_updated",
            time: "2026-08-02T10:00:02.800Z",
            attributes: [{ name: "tool_name", value: "Write" }],
            relationships: [
              { objectId: "sess_coll", qualifier: "in_session" },
              { objectId: "sess_coll_turn_02", qualifier: "in_turn" },
              { objectId: fileId, qualifier: "mutated_in" },
            ],
          },
          ...base.events.slice(-2),
        ],
      });
      const inPath = ws.writeJson("collision.ocel.json", doc);
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--format", "json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ fileCollisions: unknown[] }>();
      expect(out.fileCollisions.length).toBeGreaterThan(0);
    });
  }, 45_000);

  test("A14.4: nonexistent --in path passed to zcode ocel discover exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const res = runZcodeCli(["ocel", "discover", "--in", ws.path("does-not-exist.ocel.json"), "--format", "json"], ws);
      expect(res.exitCode).toBe(2);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/does-not-exist|ENOENT|no such file|not found/i);
    });
  }, 45_000);

  test("A14.5: invalid --format bogus passed to zcode ocel discover exits 2", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildConformingHighRiskSession({ sessionId: "sess_bad_fmt" });
      const inPath = ws.writeJson("ok.ocel.json", doc);
      const res = runZcodeCli(["ocel", "discover", "--in", inPath, "--format", "bogus"], ws);
      expect(res.exitCode).toBe(2);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/--format|format|bogus|unsupported/i);
    });
  }, 45_000);
});

describe("A15 — Concept Drift, SPC & Kingman Variance Separation Boundary Tests (5 tests)", () => {
  test("A15.1: gradual linear decay triggers ADWIN / Page-Hinkley driftDetected: true", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("gradual-logs");
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
  }, 45_000);

  test("A15.2: heavy-tailed coding turns (c_s^2 >> 1) with healthy TTFT keep driftDetected: false and ttftMdTriggered: false", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ ttftSpikeFactor: 2.0 }));
      const logsDir = ws.path("heavy-logs");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("heavy_tailed", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected: boolean; ttftMdTriggered?: boolean; cs2?: number }>();
      expect(out.driftDetected).toBe(false);
      expect(out.ttftMdTriggered ?? false).toBe(false);
    });
  }, 45_000);

  test("A15.3: window < min_window (12 < 20) reports UNVERIFIED / insufficientPower instead of fabricating p < 0.01", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ minWindow: 20 }));
      const logsDir = ws.path("under-window");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("sudden_drift", 12)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      if (res.exitCode === 2) {
        expect(res.stdout + res.stderr).toMatch(/min_window|window|insufficient|UNVERIFIED|power/i);
      } else {
        expect(res.exitCode).toBe(0);
        const out = res.json<{ standing?: string; status?: string; insufficientPower?: boolean }>();
        expect(
          out.standing === "UNVERIFIED" ||
            out.status === "UNVERIFIED" ||
            out.insufficientPower === true,
        ).toBe(true);
      }
    });
  }, 45_000);

  test("A15.4: TTFT spike > 2x rolling median in second half triggers ttftMdTriggered / AIMD multiplicative decrease", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ ttftSpikeFactor: 2.0 }));
      const logsDir = ws.path("ttft-spike");
      mkdirSync(logsDir, { recursive: true });
      for (const item of buildPmmLogSet("sudden_drift", 40)) {
        writeFileSync(join(logsDir, item.filename), JSON.stringify(item.doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const out = res.json<{ driftDetected: boolean; ttftMdTriggered?: boolean }>();
      expect(out.driftDetected || out.ttftMdTriggered).toBe(true);
    });
  }, 45_000);

  test("A15.5: sustained high utilization & high c_s^2 surfaces Kingman queueing saturation metrics", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const logsDir = ws.path("kingman-sat");
      mkdirSync(logsDir, { recursive: true });
      // Pack 30 heavy-tailed sessions tightly (2000ms apart while serviceMs peaks at 120_000ms -> high rho & high c_s^2)
      const base = Date.parse("2026-08-02T00:00:00.000Z");
      for (let i = 0; i < 30; i++) {
        const doc = buildConformingHighRiskSession({
          sessionId: `ksat_${i}`,
          baseTimeMs: base + i * 2000,
          ttftMs: 110,
          serviceMs: i % 3 === 0 ? 120_000 : 8000,
        });
        writeFileSync(join(logsDir, `ksat_${i}.ocel.json`), JSON.stringify(doc), "utf8");
      }
      const res = runZcodeCli(["pmm", "analyze", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(0);
      const text = JSON.stringify(res.json()).toLowerCase();
      expect(text).toMatch(/kingman|rho|cs2|queue|wait/);
    });
  }, 45_000);
});

describe("A16 — Responsible Process Mining (FACT) & k-Anonymity Negative/Boundary Tests (5 tests)", () => {
  test("A16.1: --rpm-safe --k 5 suppresses or refuses unique outlier variant (< k support, never leaks outlier actor)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildKAnonLogSet({ k: 5, variantCount: 2, includeOutlier: true });
      const inPath = ws.writeJson("kanon-outlier.ocel.json", doc);
      const outPath = ws.path("kanon-outlier-out.ocel.json");
      const res = runZcodeCli(
        ["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath, "--rpm-safe", "--k", "5"],
        ws,
      );
      if (res.exitCode === 0) {
        expect(existsSync(outPath)).toBe(true);
        const rawOut = readFileSync(outPath, "utf8");
        expect(rawOut).not.toContain("kanon_outlier_unique");
        expect(rawOut).not.toContain("unique-whistleblower@example.eu");
        const parsed = JSON.parse(rawOut) as Ocel2Doc;
        expect(parsed.events.length).toBeLessThan(doc.events.length);
      } else {
        expect(res.exitCode).toBe(1);
        const combined = res.stdout + res.stderr;
        expect(combined).not.toContain("Usage:");
        expect(combined).toMatch(/k.?anonym|anonymity|outlier|support\s*<|variant/i);
      }
    });
  }, 45_000);

  test("A16.2: --rpm-safe with k <= 1 (--k 1 and --k 0) fails input validation (exit 2, no trivial bypass)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildKAnonLogSet({ k: 5, variantCount: 2 });
      const inPath = ws.writeJson("kanon-k1.ocel.json", doc);
      for (const kVal of ["1", "0"]) {
        const outPath = ws.path(`out-k${kVal}.ocel.json`);
        const res = runZcodeCli(
          ["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath, "--rpm-safe", "--k", kVal],
          ws,
        );
        expect(res.exitCode).toBe(2);
        expect(existsSync(outPath)).toBe(false);
        const combined = res.stdout + res.stderr;
        expect(combined).not.toContain("invalid input or flag");
        expect(combined).toMatch(/--k|k_anonymity|k >= 2|k must be|anonymity/i);
      }
    });
  }, 45_000);

  test("A16.3: --rpm-safe export never leaves raw email or unredacted secret in exported bundle", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildPiiSecretSession();
      // Replicate 5 identical copies so k=5 variant threshold is met
      const copies: Ocel2Doc = buildOcel2Doc({
        objectTypes: doc.objectTypes,
        eventTypes: doc.eventTypes,
        objects: Array.from({ length: 5 }, (_, idx) =>
          doc.objects.map((o) => ({
            ...o,
            id: `${o.id}_c${idx}`,
            relationships: o.relationships.map((r) => ({ ...r, objectId: `${r.objectId}_c${idx}` })),
          })),
        ).flat(),
        events: Array.from({ length: 5 }, (_, idx) =>
          doc.events.map((e) => ({
            ...e,
            id: `${e.id}_c${idx}`,
            relationships: e.relationships.map((r) => ({ ...r, objectId: `${r.objectId}_c${idx}` })),
          })),
        ).flat(),
      });
      const inPath = ws.writeJson("rpm-pii.ocel.json", copies);
      const outPath = ws.path("rpm-pii-safe.ocel.json");
      const res = runZcodeCli(
        ["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath, "--rpm-safe", "--k", "5"],
        ws,
      );
      if (res.exitCode === 0) {
        const rawOut = readFileSync(outPath, "utf8");
        expect(rawOut).not.toContain("alice.mueller@example.de");
        expect(rawOut).not.toContain("sk-live-secret-99887766");
      } else {
        expect([1, 2]).toContain(res.exitCode);
        expect(res.stdout + res.stderr).toMatch(/REDACTION|unredacted|secret|pii/i);
      }
    });
  }, 45_000);

  test("A16.4: missing E2O links degrade RPM accuracy standing (PARTIAL_ALIVE or BUILD_BROKEN, NEVER ALIVE)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const base = buildConformingHighRiskSession({ sessionId: "sess_no_e2o" });
      const broken = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: base.events.map((e, idx) => (idx === 3 ? { ...e, relationships: [] } : e)),
      });
      const inPath = ws.writeJson("missing-e2o.ocel.json", broken);
      const res = runZcodeCli(["ocel", "verify", "--in", inPath, "--json"], ws);
      expect([0, 1]).toContain(res.exitCode);
      if (res.stdout.trim().startsWith("{")) {
        const out = res.json<{ standing?: string; missingE2oRatio?: number }>();
        expect(out.standing).not.toBe("ALIVE");
        expect(["PARTIAL_ALIVE", "BUILD_BROKEN"]).toContain(out.standing ?? "");
      } else {
        expect(res.exitCode).toBe(1);
        expect(res.stdout + res.stderr).toMatch(/e2o|PARTIAL_ALIVE|BUILD_BROKEN/i);
      }
    });
  }, 45_000);

  test("A16.5: empty/constant-zero salt under --rpm-safe is rejected rather than allowing reversible pseudonyms", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const doc = buildKAnonLogSet({ k: 5, variantCount: 2 });
      const inPath = ws.writeJson("kanon-nosalt.ocel.json", doc);
      const outPath = ws.path("nosalt-out.ocel.json");
      const res = runZcodeCli(
        ["ocel", "export", "--in", inPath, "--format", "json", "--out", outPath, "--rpm-safe", "--k", "5"],
        ws,
        { env: { ZCODE_RPM_SALT: "" } },
      );
      expect(res.exitCode).toBe(2);
      expect(existsSync(outPath)).toBe(false);
      const combined = res.stdout + res.stderr;
      expect(combined).not.toContain("invalid input or flag");
      expect(combined).toMatch(/salt|pseudonym|hmac/i);
    });
  }, 45_000);
});

describe("A17 — Bounded Transactional Lifecycle Nets, Rollback & Retry Cap Negative Tests (5 tests)", () => {
  test("A17.1: repeating identical error signature beyond max_retries_per_signature halts fail-closed with RETRY_BUDGET_EXHAUSTED (exit 1)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", maxRetriesPerSignature: 3 }),
      );
      const base = buildConformingHighRiskSession({ sessionId: "sess_retry_burn" });
      const repeatedFailures = Array.from({ length: 4 }, (_, i) => ({
        id: `sess_retry_burn_fail_${i + 1}`,
        type: "turn_failed",
        time: new Date(Date.parse("2026-08-02T10:00:04.000Z") + i * 100).toISOString(),
        attributes: [{ name: "error_signature", value: "TS2322:identical_burn" }],
        relationships: [{ objectId: "sess_retry_burn", qualifier: "in_session" }],
      }));
      const doc = buildOcel2Doc({
        objectTypes: base.objectTypes,
        eventTypes: base.eventTypes,
        objects: base.objects,
        events: [...base.events.slice(0, -2), ...repeatedFailures, ...base.events.slice(-2)],
      });
      const logsDir = ws.path("retry-logs");
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, "retry-burn.ocel.json"), JSON.stringify(doc), "utf8");

      const res = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect(res.exitCode).toBe(1);
      expect(res.stdout + res.stderr).toContain("RETRY_BUDGET_EXHAUSTED");

      // Also verify M3 transactional-net court passes RETRY_BUDGET_EXHAUSTED tests
      const txTest = join(REPO_ROOT, "test/compliance-transactional-kingman.test.ts");
      expect(existsSync(txTest)).toBe(true);
      const unitRes = runSubprocess(process.execPath, ["test", txTest], { cwd: REPO_ROOT, timeoutMs: 20_000 });
      expect(unitRes.exitCode).toBe(0);
    });
  }, 45_000);

  test("A17.2: dirty workspace with rollback_on_dirty = false returns DIRTY_TIMEOUT_REFUSED (never silent retry)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", rollbackOnDirty: false }),
      );
      repo.commitAll("chore: config");
      ws.writeText("uncommitted-dirty.ts", "export const x = 1;\n");

      const doc = buildOversightCrashSession({ kind: "crash" });
      const logsDir = ws.path("dirty-timeout-logs");
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, "dirty-timeout.ocel.json"), JSON.stringify(doc), "utf8");

      const res = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect([1, 2]).toContain(res.exitCode);
      expect(res.stdout + res.stderr).toContain("DIRTY_TIMEOUT_REFUSED");
    });
  }, 45_000);

  test("A17.3: invalid --max-turns 0 and tight token/wall-clock budget bounds terminate fail-closed without livelock", async () => {
    await withIsolatedWorkspace(async (ws) => {
      ws.writeToml(buildComplianceToml({ profile: "art50-only", maxCycles: 1, maxTotalTokens: 1, maxWallClockMs: 1 }));
      const zeroTurns = runZcodeCli(["-p", "Reply OK", "--max-turns", "0"], ws);
      expect(zeroTurns.exitCode).not.toBe(0);
      expect(zeroTurns.stdout + zeroTurns.stderr).toMatch(/positive integer|max-turns|BUDGET/i);

      await withLocalLlmServer(ws, async () => {
        const budgetRes = await runZcodeCliAsync(
          ["-p", "Reply OK", "--max-turns", "1", "--output-format", "stream-json"],
          ws,
          { env: { ZCODE_COMPLIANCE_PROFILE: "art50-only" }, timeoutMs: 12_000 },
        );
        expect(budgetRes.exitCode).not.toBe(124);
        expect([0, 1]).toContain(budgetRes.exitCode);
        if (budgetRes.exitCode === 0) {
          expect(budgetRes.stdout).toContain("OK");
        } else {
          expect(budgetRes.stdout + budgetRes.stderr).toMatch(/budget|token|wall.?clock|limit/i);
        }
      });
    });
  }, 45_000);

  test("A17.4: locked .git/index.lock prevents dirty rollback and halts fail-closed", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const repo = initGitRepo(ws.cwd);
      ws.writeToml(buildComplianceToml({ profile: "high-risk-annex-iii", rollbackOnDirty: true }));
      repo.commitAll("chore: config");
      ws.writeText("dirty-file.ts", "export const y = 2;\n");
      writeFileSync(join(ws.cwd, ".git", "index.lock"), "locked\n", "utf8");

      const gitAttempt = repo.git(["checkout", "--", "README.md"]);
      expect(gitAttempt.exitCode).not.toBe(0);

      const doc = buildOversightCrashSession({ kind: "dirty_rollback" });
      const logsDir = ws.path("locked-git-logs");
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, "locked.ocel.json"), JSON.stringify(doc), "utf8");
      const res = runZcodeCli(["compliance", "assess", "--logs", logsDir, "--json"], ws);
      expect([1, 2]).toContain(res.exitCode);
      expect(res.stdout + res.stderr).toMatch(/index\.lock|ROLLBACK|DIRTY|LOCK/i);
    });
  }, 45_000);

  test("A17.5: max_retries_per_signature = 0 in zcode-cli.toml is refused as INVALID_COMPLIANCE_CONFIG (exit 2)", async () => {
    await withIsolatedWorkspace(async (ws) => {
      const cfgPath = ws.writeToml(
        buildComplianceToml({ profile: "high-risk-annex-iii", maxRetriesPerSignature: 0 }),
      );
      const res = runZcodeCli(["compliance", "deployer-check", "--config", cfgPath, "--json"], ws);
      expect(res.exitCode).toBe(2);
      expect(res.stdout + res.stderr).toContain("INVALID_COMPLIANCE_CONFIG");
    });
  }, 45_000);
});

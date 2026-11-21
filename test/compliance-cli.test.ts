import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ocel2ComplianceBuilder } from "../src/compliance/ocel2.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_TS = join(REPO_ROOT, "bin", "zcode.ts");
const BIN_JS = join(REPO_ROOT, "bin", "zcode.js");

function withTempWorkspace(fn: (ctx: { root: string; home: string; cwd: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "zcode-cli-m4-"));
  const home = join(root, "home");
  const cwd = join(root, "work");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  try {
    fn({ root, home, cwd });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runCli(
  runner: "bun" | "node",
  args: string[],
  cwd: string,
  home: string,
  extraEnv: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const entry = runner === "bun" ? BIN_TS : BIN_JS;
  const cmd = runner === "bun" ? process.execPath : "node";
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    USERPROFILE: home,
    NO_COLOR: "1",
    ZCODE_DISABLE_UPDATE_CHECK: "1",
    ...extraEnv
  };
  const res = spawnSync(cmd, [entry, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 15_000
  });
  return {
    exitCode: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? ""
  };
}

function createSampleOcelDoc(sessionId = "sess_cli_test") {
  const b = new Ocel2ComplianceBuilder();
  const t0 = "2026-08-02T10:00:00.000Z";
  b.upsertObject(sessionId, "session", { compliance_profile: "high-risk-annex-iii" }, t0);
  b.upsertObject("turn_01", "turn", { standing: "ALIVE" }, t0);
  b.upsertObject("perm_01", "permission", { overseer_id: "overseer-alice-eu", decision: "allow" }, t0);
  b.addO2O("turn_01", "in_session", sessionId);

  b.recordEvent({
    id: `${sessionId}_ev_1`,
    type: "session_created",
    time: "2026-08-02T10:00:00.000Z",
    attributes: { compliance_profile: "high-risk-annex-iii" },
    relationships: [{ objectId: sessionId, qualifier: "in_session" }]
  });
  b.recordEvent({
    id: `${sessionId}_ev_2`,
    type: "art50_disclosure_emitted",
    time: "2026-08-02T10:00:00.100Z",
    attributes: {
      channel: "stream-json",
      regulation: "EU-2024-1689-Art50",
      provider_id: "zai",
      model_id: "glm-5.3"
    },
    relationships: [{ objectId: sessionId, qualifier: "in_session" }]
  });
  b.recordEvent({
    id: `${sessionId}_ev_3`,
    type: "turn_started",
    time: "2026-08-02T10:00:00.200Z",
    attributes: {},
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: "turn_01", qualifier: "in_turn" }
    ]
  });
  b.recordEvent({
    id: `${sessionId}_ev_4`,
    type: "permission_requested",
    time: "2026-08-02T10:00:00.300Z",
    attributes: { risk_level: "high" },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: "turn_01", qualifier: "in_turn" },
      { objectId: "perm_01", qualifier: "governs" }
    ]
  });
  b.recordEvent({
    id: `${sessionId}_ev_5`,
    type: "permission_resolved",
    time: "2026-08-02T10:00:01.800Z",
    attributes: {
      decision: "allow",
      decision_latency_ms: "1500",
      overseer_id: "overseer-alice-eu",
      auto_resolved: "false"
    },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: "turn_01", qualifier: "in_turn" },
      { objectId: "perm_01", qualifier: "governs" }
    ]
  });
  b.recordEvent({
    id: `${sessionId}_ev_6`,
    type: "tool_updated",
    time: "2026-08-02T10:00:02.000Z",
    attributes: { tool_name: "Write", status: "success" },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: "turn_01", qualifier: "in_turn" }
    ]
  });
  b.recordEvent({
    id: `${sessionId}_ev_7`,
    type: "turn_completed",
    time: "2026-08-02T10:00:02.500Z",
    attributes: { fitness: "1.0" },
    relationships: [
      { objectId: sessionId, qualifier: "in_session" },
      { objectId: "turn_01", qualifier: "in_turn" }
    ]
  });
  b.recordEvent({
    id: `${sessionId}_ev_8`,
    type: "session_closed",
    time: "2026-08-02T10:00:02.600Z",
    attributes: {},
    relationships: [{ objectId: sessionId, qualifier: "in_session" }]
  });
  return b.build();
}

describe("M4 Compliance CLI & Launcher Integration (zero-mock Chicago)", () => {
  test("version --compliance executes hermetically under both Bun and Node 22 bin/zcode.js without touching HOME", () => {
    withTempWorkspace(({ home, cwd }) => {
      for (const runner of ["bun", "node"] as const) {
        const res = runCli(runner, ["version", "--compliance"], cwd, home);
        expect(res.exitCode).toBe(0);
        const parsed = JSON.parse(res.stdout) as { runtime_app_version: string; regulation: string };
        expect(parsed.runtime_app_version).toBe("3.14.4");
        expect(parsed.regulation).toContain("2024/1689");
        expect(existsSync(join(home, ".zcode", "cli", "config.json"))).toBe(false);
      }
    });
  }, 25_000);

  test("compliance info and risk-register run via Node 22 bin/zcode.js and respect --format validation", () => {
    withTempWorkspace(({ home, cwd }) => {
      writeFileSync(
        join(cwd, "zcode-cli.toml"),
        [
          "[compliance]",
          'profile = "high-risk-annex-iii"',
          "allow_yolo = false",
          "",
          "[deployer]",
          'overseer_id = "overseer-node22"',
          "log_retention_days = 180",
          "monitoring_enabled = true",
          "",
          "[pmm]",
          "drift_alpha = 0.01",
          "min_window = 20",
          "k_anonymity = 5",
          ""
        ].join("\n"),
        "utf8"
      );

      const infoRes = runCli("node", ["compliance", "info", "--json"], cwd, home);
      expect(infoRes.exitCode).toBe(0);
      const info = JSON.parse(infoRes.stdout) as { standing: string; compliance_profile: string };
      expect(info.compliance_profile).toBe("high-risk-annex-iii");
      expect(info.standing).toBe("UNVERIFIED");

      const rrRes = runCli("node", ["compliance", "risk-register", "--md"], cwd, home);
      expect(rrRes.exitCode).toBe(0);
      expect(rrRes.stdout).toContain("Risk_ToolchainDrift");
      expect(rrRes.stdout).toContain("|");

      const badFmt = runCli("bun", ["compliance", "info", "--format", "bogus"], cwd, home);
      expect(badFmt.exitCode).toBe(2);
      expect(badFmt.stderr).toContain("--format");
      expect(badFmt.stderr).toContain("bogus");
      expect(badFmt.stderr).not.toContain("Usage:");
    });
  }, 25_000);

  test("strict CLI exit codes 0 / 1 / 2 and anti-stub diagnostics across subcommands", () => {
    withTempWorkspace(({ home, cwd }) => {
      const unknownCmd = runCli("bun", ["compliance", "bogus-sub"], cwd, home);
      expect(unknownCmd.exitCode).toBe(2);
      expect(unknownCmd.stderr).toContain("bogus-sub");
      expect(unknownCmd.stderr).not.toContain("invalid input or flag");

      const unknownFlag = runCli("bun", ["compliance", "assess", "--nonexistent-flag"], cwd, home);
      expect(unknownFlag.exitCode).toBe(2);
      expect(unknownFlag.stderr).toContain("--nonexistent-flag");

      const missingOut = runCli("bun", ["compliance", "annex-iv", "--out"], cwd, home);
      expect(missingOut.exitCode).toBe(2);
      expect(missingOut.stderr).toContain("--out");
    });
  }, 25_000);

  test("full CLI lifecycle: deployer-check, annex-iv, assess, doc, fria-export, ocel export/verify/discover, pmm analyze, incident report", () => {
    withTempWorkspace(({ root, home, cwd }) => {
      const tomlPath = join(cwd, "zcode-cli.toml");
      writeFileSync(
        tomlPath,
        [
          "[compliance]",
          'profile = "high-risk-annex-iii"',
          "allow_yolo = false",
          "redact_pii = true",
          "min_review_ms = 1000",
          "git_provenance_trailer = true",
          "max_retries_per_signature = 3",
          "",
          "[deployer]",
          'overseer_id = "overseer-eu-01"',
          "log_retention_days = 180",
          "monitoring_enabled = true",
          "worker_notice_acknowledged = true",
          "",
          "[pmm]",
          "drift_alpha = 0.01",
          "min_window = 20",
          "k_anonymity = 5",
          ""
        ].join("\n"),
        "utf8"
      );

      expect(runCli("node", ["compliance", "deployer-check", "--config", tomlPath, "--json"], cwd, home).exitCode).toBe(0);

      const dossierDir = join(root, "dossier");
      expect(runCli("bun", ["compliance", "annex-iv", "--out", dossierDir], cwd, home).exitCode).toBe(0);
      expect(runCli("bun", ["compliance", "annex-iv", "--out", dossierDir, "--check"], cwd, home).exitCode).toBe(0);

      const logsDir = join(root, "logs");
      mkdirSync(logsDir, { recursive: true });
      const sampleDoc = createSampleOcelDoc("sess_cli_01");
      const inPath = join(logsDir, "sess_cli_01.ocel.json");
      writeFileSync(inPath, JSON.stringify(sampleDoc, null, 2), "utf8");

      const assessRes = runCli("bun", ["compliance", "assess", "--logs", logsDir, "--json"], cwd, home);
      expect(assessRes.exitCode).toBe(0);
      expect(JSON.parse(assessRes.stdout).verdict).toBe("CONFORMITY_ADMITTED");

      const docOut = join(root, "doc.json");
      expect(runCli("bun", ["compliance", "doc", "--out", docOut], cwd, home).exitCode).toBe(0);
      expect(existsSync(docOut)).toBe(true);

      const friaOut = join(root, "fria.md");
      expect(runCli("bun", ["compliance", "fria-export", "--out", friaOut, "--format", "md"], cwd, home).exitCode).toBe(0);
      expect(readFileSync(friaOut, "utf8")).toContain("overseer-eu-01");

      const sqliteOut = join(root, "out.ocel.sqlite");
      expect(runCli("node", ["ocel", "export", "--in", inPath, "--format", "sqlite", "--out", sqliteOut], cwd, home).exitCode).toBe(0);
      expect(runCli("node", ["ocel", "verify", "--in", sqliteOut, "--json"], cwd, home).exitCode).toBe(0);

      const discOut = join(root, "dfg.mmd");
      expect(runCli("bun", ["ocel", "discover", "--in", logsDir, "--ocpn", "--format", "mermaid", "--out", discOut], cwd, home).exitCode).toBe(0);
      expect(readFileSync(discOut, "utf8")).toContain("flowchart LR");

      const pmmRes = runCli("bun", ["pmm", "analyze", "--logs", logsDir, "--json"], cwd, home);
      expect(pmmRes.exitCode).toBe(0);
      expect(JSON.parse(pmmRes.stdout).insufficientPower).toBe(true);

      const incOut = join(root, "incident.json");
      expect(runCli("bun", ["incident", "report", "--in", inPath, "--out", incOut, "--session", "sess_cli_01"], cwd, home).exitCode).toBe(0);
      expect(JSON.parse(readFileSync(incOut, "utf8")).deadline_class).toBe("15d");
    });
  }, 45_000);

  test("launcher Art. 14 gate refuses yolo/bypassPermissions flags under high-risk-annex-iii with exit 1", () => {
    withTempWorkspace(({ home, cwd }) => {
      writeFileSync(
        join(cwd, "zcode-cli.toml"),
        '[compliance]\nprofile = "high-risk-annex-iii"\nallow_yolo = false\n[deployer]\noverseer_id = "ov-1"\n',
        "utf8"
      );
      for (const args of [
        ["-p", "hi", "--dangerously-skip-permissions"],
        ["-p", "hi", "--mode", "yolo"],
        ["-p", "hi", "--permission-mode", "bypassPermissions"]
      ]) {
        const res = runCli("bun", args, cwd, home, { ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" });
        expect(res.exitCode).toBe(1);
        expect(res.stdout + res.stderr).toContain("OVERSIGHT_POLICY_REFUSED");
      }
    });
  }, 25_000);

  test("regressions: annex-iv --logs --check, in-cwd sqlite export/verify + sidecar seal enforcement, and incident --session validation", () => {
    withTempWorkspace(({ root, home, cwd }) => {
      const tomlPath = join(cwd, "zcode-cli.toml");
      writeFileSync(
        tomlPath,
        [
          "[compliance]",
          'profile = "high-risk-annex-iii"',
          "allow_yolo = false",
          "redact_pii = true",
          "min_review_ms = 1000",
          "git_provenance_trailer = true",
          "",
          "[deployer]",
          'overseer_id = "overseer-eu-reg"',
          "log_retention_days = 180",
          "monitoring_enabled = true",
          "",
          "[pmm]",
          "drift_alpha = 0.01",
          "min_window = 20",
          "k_anonymity = 5",
          ""
        ].join("\n"),
        "utf8"
      );

      const logsDir = join(root, "logs");
      mkdirSync(logsDir, { recursive: true });
      const sampleDoc = createSampleOcelDoc("sess_reg_01");
      const inPath = join(logsDir, "sess_reg_01.ocel.json");
      writeFileSync(inPath, JSON.stringify(sampleDoc, null, 2), "utf8");

      // 1. annex-iv --logs + --check round-trip passes deterministically
      const dossierDir = join(root, "dossier-logs");
      expect(runCli("node", ["compliance", "annex-iv", "--out", dossierDir, "--logs", logsDir], cwd, home).exitCode).toBe(0);
      const checkWithLogs = runCli("node", ["compliance", "annex-iv", "--out", dossierDir, "--logs", logsDir, "--check"], cwd, home);
      expect(checkWithLogs.exitCode).toBe(0);
      expect(JSON.parse(checkWithLogs.stdout).ok).toBe(true);
      const checkWithoutLogs = runCli("node", ["compliance", "annex-iv", "--out", dossierDir, "--check"], cwd, home);
      expect(checkWithoutLogs.exitCode).toBe(1);

      // 2. ocel export --format sqlite INSIDE cwd + ocel verify in same cwd passes
      const sqliteInCwd = join(cwd, "inside.ocel.sqlite");
      const expSqlite = runCli("node", ["ocel", "export", "--in", inPath, "--format", "sqlite", "--out", sqliteInCwd], cwd, home);
      expect(expSqlite.exitCode).toBe(0);
      const verSqlite = runCli("node", ["ocel", "verify", "--in", sqliteInCwd, "--json"], cwd, home);
      expect(verSqlite.exitCode).toBe(0);
      expect(JSON.parse(verSqlite.stdout).valid).toBe(true);

      // 3. Stripping seal_sha256 from schema_version "1.0" sidecar with modified_spans[].path fails closed
      const jsonInCwd = join(cwd, "span-target.ocel.json");
      writeFileSync(jsonInCwd, JSON.stringify(sampleDoc, null, 2), "utf8");
      const provDir = join(cwd, ".zcode-provenance");
      mkdirSync(provDir, { recursive: true });
      writeFileSync(
        join(provDir, "sess_span.json"),
        JSON.stringify({
          schema_version: "1.0",
          article: "Art. 50(2)",
          session_id: "sess_other",
          compliance_profile: "high-risk-annex-iii",
          provider: "zai",
          model: "glm-5.3",
          ocel_head_hash: "a".repeat(64),
          generated_at: "2026-08-02T10:00:00.000Z",
          modified_spans: [{ path: "span-target.ocel.json", sha256: "0".repeat(64), bytes: 10 }],
          span_count: 1
        }),
        "utf8"
      );
      const verTamperedSpan = runCli("node", ["ocel", "verify", "--in", jsonInCwd, "--json"], cwd, home);
      expect(verTamperedSpan.exitCode).toBe(1);
      expect(verTamperedSpan.stdout + verTamperedSpan.stderr).toContain("PROVENANCE_SEAL_FAILED");

      // 4. incident report missing --session or --session "" fails closed exit 2 without creating --out
      const missingSessOut = join(root, "missing-sess.json");
      const incMissing = runCli("node", ["incident", "report", "--in", inPath, "--out", missingSessOut], cwd, home);
      expect(incMissing.exitCode).toBe(2);
      expect(existsSync(missingSessOut)).toBe(false);

      const emptySessOut = join(root, "empty-sess.json");
      const incEmpty = runCli("node", ["incident", "report", "--in", inPath, "--out", emptySessOut, "--session", ""], cwd, home);
      expect(incEmpty.exitCode).toBe(2);
      expect(existsSync(emptySessOut)).toBe(false);
    });
  }, 45_000);

  test("regression (M4 Iter3): stripping schema_version and/or seal_sha256 or setting unsupported schema_version fails closed with PROVENANCE_SEAL_FAILED under bun and node", () => {
    withTempWorkspace(({ root, home, cwd }) => {
      writeFileSync(
        join(cwd, "zcode-cli.toml"),
        '[compliance]\nprofile = "high-risk-annex-iii"\n[deployer]\noverseer_id = "ov-strip"\n',
        "utf8"
      );
      const inPath = join(root, "in.ocel.json");
      const expPath = join(cwd, "exp.ocel.json");
      writeFileSync(inPath, JSON.stringify(createSampleOcelDoc("sess_strip_01"), null, 2), "utf8");

      const exp = runCli("node", ["ocel", "export", "--in", inPath, "--format", "json", "--out", expPath], cwd, home);
      expect(exp.exitCode).toBe(0);

      // Tamper exported OCEL file and compute matching SHA-256
      writeFileSync(expPath, readFileSync(expPath, "utf8") + " ", "utf8");
      const tamperedSha = createHash("sha256").update(readFileSync(expPath)).digest("hex");

      const provDir = join(cwd, ".zcode-provenance");
      const sidecarFile = readdirSync(provDir).find((f) => f.endsWith(".json"));
      expect(sidecarFile).toBeDefined();
      const sidecarPath = join(provDir, sidecarFile!);
      const baseSidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;

      // Case 1: delete BOTH schema_version and seal_sha256 while updating file hashes to match tampered artifact
      const strippedBoth: Record<string, unknown> = {
        ...baseSidecar,
        sha256: tamperedSha,
        artifact_sha256: tamperedSha,
        modified_spans: [{ path: "exp.ocel.json", sha256: tamperedSha, bytes: readFileSync(expPath).byteLength }]
      };
      delete strippedBoth.schema_version;
      delete strippedBoth.seal_sha256;
      writeFileSync(sidecarPath, JSON.stringify(strippedBoth, null, 2), "utf8");

      for (const runner of ["bun", "node"] as const) {
        const res = runCli(runner, ["ocel", "verify", "--in", expPath, "--json"], cwd, home);
        expect(res.exitCode).toBe(1);
        expect(res.stdout + res.stderr).toContain("PROVENANCE_SEAL_FAILED");
      }

      // Case 2: change schema_version to "2.0" and delete seal_sha256
      const bumpedNoSeal: Record<string, unknown> = {
        ...strippedBoth,
        schema_version: "2.0"
      };
      writeFileSync(sidecarPath, JSON.stringify(bumpedNoSeal, null, 2), "utf8");

      for (const runner of ["bun", "node"] as const) {
        const res = runCli(runner, ["ocel", "verify", "--in", expPath, "--json"], cwd, home);
        expect(res.exitCode).toBe(1);
        expect(res.stdout + res.stderr).toContain("PROVENANCE_SEAL_FAILED");
      }

      // Case 3: unsupported schema_version "2.0" even if seal_sha256 string is still present
      const bumpedWithSeal: Record<string, unknown> = {
        ...baseSidecar,
        schema_version: "2.0"
      };
      writeFileSync(sidecarPath, JSON.stringify(bumpedWithSeal, null, 2), "utf8");

      for (const runner of ["bun", "node"] as const) {
        const res = runCli(runner, ["ocel", "verify", "--in", expPath, "--json"], cwd, home);
        expect(res.exitCode).toBe(1);
        expect(res.stdout + res.stderr).toContain("PROVENANCE_SEAL_FAILED");
      }
    });
  }, 35_000);
});

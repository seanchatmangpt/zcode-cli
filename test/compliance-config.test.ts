import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPLIANCE_PROFILES,
  ComplianceRefusalError,
  complianceDirectory,
  isHighRiskProfile,
  isRegulatedProfile,
  loadComplianceConfig,
  parseComplianceConfigToml,
  parseTomlDocument,
  validateDeployerPreflight
} from "../src/compliance/config.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix = "zcode-compliance-cfg-"): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("F02 compliance config schema & strict TOML parser (zero-mock Chicago)", () => {
  test("absent zcode-cli.toml resolves standard defaults without failing", () => {
    const dir = makeTempDir();
    const cfg = loadComplianceConfig({
      cwd: dir,
      env: { HOME: dir },
      platform: "darwin",
      fallbackHome: dir
    });

    expect(cfg.configPresent).toBe(false);
    expect(cfg.configPath).toBe(join(dir, "zcode-cli.toml"));
    expect(cfg.compliance.profile).toBe("standard");
    expect(cfg.compliance.redact_pii).toBe(true);
    expect(cfg.compliance.min_review_ms).toBe(1000);
    expect(cfg.compliance.git_provenance_trailer).toBe(false);
    expect(cfg.compliance.allow_yolo).toBe(true);
    expect(cfg.compliance.max_retries_per_signature).toBe(3);
    expect(cfg.compliance.redact_env).toEqual([]);
    expect(cfg.complianceLogEnabled).toBe(false);
    expect(cfg.deployer.log_retention_days).toBe(180);
    expect(cfg.deployer.monitoring_enabled).toBe(true);
    expect(cfg.deployer.worker_notice_acknowledged).toBe(true);
    expect(cfg.deployer.overseer_id).toBeUndefined();
    expect(cfg.pmm).toEqual({ drift_alpha: 0.01, min_window: 20, k_anonymity: 5 });
    expect(cfg.complianceDir).toBe(join(dir, ".zcode", "compliance"));
  });

  test("parses real zcode-cli.toml with [paths], [compliance], [ocel].redact_env, [deployer], [pmm]", () => {
    const dir = makeTempDir();
    const tomlPath = join(dir, "zcode-cli.toml");
    writeFileSync(
      tomlPath,
      [
        "# Existing repository paths section must be tolerated",
        "[paths]",
        'castle_dir = "/tmp/castle"',
        "",
        "[ocel]",
        'redact_env = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]',
        "",
        "[compliance]",
        'profile = "high-risk-annex-iii"',
        "redact_pii = true",
        "min_review_ms = 2500",
        "git_provenance_trailer = true",
        "allow_yolo = false",
        "max_retries_per_signature = 5",
        "redact_env = [",
        '  "ANTHROPIC_API_KEY",',
        '  "CUSTOM_SECRET", # trailing comment inside multiline array',
        "]",
        "",
        "[deployer]",
        "overseer_id = 'alice-overseer'",
        "log_retention_days = 365",
        "monitoring_enabled = true",
        "worker_notice_acknowledged = true",
        "",
        "[pmm]",
        "drift_alpha = 0.05",
        "min_window = 30",
        "k_anonymity = 7"
      ].join("\n"),
      "utf8"
    );

    const cfg = loadComplianceConfig({
      configPath: tomlPath,
      env: { HOME: dir },
      platform: "darwin",
      fallbackHome: dir
    });

    expect(cfg.configPresent).toBe(true);
    expect(cfg.compliance.profile).toBe("high-risk-annex-iii");
    expect(isRegulatedProfile(cfg.compliance.profile)).toBe(true);
    expect(isHighRiskProfile(cfg.compliance.profile)).toBe(true);
    expect(cfg.compliance.min_review_ms).toBe(2500);
    expect(cfg.compliance.git_provenance_trailer).toBe(true);
    expect(cfg.compliance.allow_yolo).toBe(false);
    expect(cfg.compliance.max_retries_per_signature).toBe(5);
    expect(cfg.compliance.redact_env).toEqual([
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "CUSTOM_SECRET"
    ]);
    expect(cfg.complianceLogEnabled).toBe(true);
    expect(cfg.deployer.overseer_id).toBe("alice-overseer");
    expect(cfg.deployer.log_retention_days).toBe(365);
    expect(cfg.pmm).toEqual({ drift_alpha: 0.05, min_window: 30, k_anonymity: 7 });

    const preflight = validateDeployerPreflight(cfg);
    expect(preflight.ok).toBe(true);
    expect(preflight.violations).toEqual([]);
  });

  test("supports all 4 profiles and all 5 environment overrides", () => {
    for (const p of COMPLIANCE_PROFILES) {
      const parsed = parseComplianceConfigToml(`[compliance]\nprofile = "${p}"\n`, {
        env: { HOME: "/tmp/h" },
        platform: "darwin"
      });
      expect(parsed.compliance.profile).toBe(p);
      expect(isRegulatedProfile(p)).toBe(p !== "standard");
      expect(isHighRiskProfile(p)).toBe(p === "high-risk-annex-iii" || p === "high-risk-annex-i");
    }

    const dir = makeTempDir();
    writeFileSync(
      join(dir, "zcode-cli.toml"),
      '[compliance]\nprofile = "standard"\nredact_pii = true\n[deployer]\noverseer_id = "from-toml"\n',
      "utf8"
    );
    const overridden = loadComplianceConfig({
      cwd: dir,
      env: {
        HOME: dir,
        ZCODE_COMPLIANCE_PROFILE: "art50-only",
        ZCODE_COMPLIANCE_LOG: "0",
        ZCODE_REDACT_PII: "0",
        ZCODE_OVERSEER_ID: "env-overseer",
        ZCODE_COMPLIANCE_DIR: join(dir, "custom-compliance")
      },
      platform: "darwin"
    });
    expect(overridden.compliance.profile).toBe("art50-only");
    expect(overridden.complianceLogEnabled).toBe(false);
    expect(overridden.compliance.redact_pii).toBe(false);
    expect(overridden.deployer.overseer_id).toBe("env-overseer");
    expect(overridden.complianceDir).toBe(join(dir, "custom-compliance"));
    expect(
      complianceDirectory({ USERPROFILE: "C:\\Users\\alice" }, "win32", "C:\\fallback")
    ).toBe("C:\\Users\\alice\\.zcode\\compliance");
  });

  test("fails closed on invalid profiles, malformed TOML, out-of-range numbers, bad env, and high-risk yolo", () => {
    expect(() =>
      parseComplianceConfigToml('[compliance]\nprofile = "unknown-profile"\n')
    ).toThrow(ComplianceRefusalError);
    try {
      parseComplianceConfigToml('[compliance]\nprofile = "unknown-profile"\n');
    } catch (e) {
      expect(e).toBeInstanceOf(ComplianceRefusalError);
      expect((e as ComplianceRefusalError).code).toBe("INVALID_COMPLIANCE_PROFILE");
      expect((e as ComplianceRefusalError).exitCode).toBe(1);
    }

    // High-risk profile with allow_yolo = true refuses fail-closed
    try {
      parseComplianceConfigToml('[compliance]\nprofile = "high-risk-annex-iii"\nallow_yolo = true\n');
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ComplianceRefusalError);
      expect((e as ComplianceRefusalError).code).toBe("OVERSIGHT_POLICY_REFUSED");
      expect((e as ComplianceRefusalError).exitCode).toBe(1);
    }

    // Malformed TOML / duplicate keys / unclosed string / unclosed array
    expect(() => parseTomlDocument("[compliance\nprofile = \"standard\"\n")).toThrow(ComplianceRefusalError);
    expect(() => parseTomlDocument('[compliance]\nprofile = "standard"\nprofile = "art50-only"\n')).toThrow(
      ComplianceRefusalError
    );
    expect(() => parseTomlDocument('[compliance]\nredact_env = ["A"\n')).toThrow(ComplianceRefusalError);
    expect(() => parseTomlDocument('[compliance]\nprofile = "unterminated\n')).toThrow(ComplianceRefusalError);

    // Out-of-range numeric fields
    for (const badToml of [
      "[pmm]\ndrift_alpha = 0\n",
      "[pmm]\ndrift_alpha = 1\n",
      "[pmm]\ndrift_alpha = 1.5\n",
      "[pmm]\nmin_window = 1\n",
      "[pmm]\nk_anonymity = 0\n",
      "[compliance]\nmax_retries_per_signature = 0\n",
      "[compliance]\nmin_review_ms = -1\n",
      "[deployer]\nlog_retention_days = 0\n"
    ]) {
      expect(() => parseComplianceConfigToml(badToml)).toThrow(ComplianceRefusalError);
    }

    // Invalid env overrides
    expect(() =>
      parseComplianceConfigToml("", { env: { ZCODE_COMPLIANCE_PROFILE: "bogus" } })
    ).toThrow(ComplianceRefusalError);
    expect(() =>
      parseComplianceConfigToml("", { env: { ZCODE_COMPLIANCE_LOG: "maybe" } })
    ).toThrow(ComplianceRefusalError);
    expect(() =>
      parseComplianceConfigToml("", { env: { ZCODE_REDACT_PII: "sometimes" } })
    ).toThrow(ComplianceRefusalError);
    expect(() =>
      parseComplianceConfigToml("", { env: { ZCODE_OVERSEER_ID: "   " } })
    ).toThrow(ComplianceRefusalError);
    expect(() =>
      parseComplianceConfigToml("", { env: { ZCODE_COMPLIANCE_DIR: "  " } })
    ).toThrow(ComplianceRefusalError);
  });

  test("validateDeployerPreflight reports Art. 14/26/72 violations deterministically", () => {
    const cfg = parseComplianceConfigToml(
      [
        "[compliance]",
        'profile = "high-risk-annex-i"',
        "[deployer]",
        "log_retention_days = 30",
        "monitoring_enabled = false",
        "worker_notice_acknowledged = false"
      ].join("\n"),
      { env: {} }
    );
    const res = validateDeployerPreflight(cfg);
    expect(res.ok).toBe(false);
    expect(res.violations.map((v) => v.field)).toEqual([
      "deployer.log_retention_days",
      "deployer.overseer_id",
      "deployer.monitoring_enabled",
      "deployer.worker_notice_acknowledged"
    ]);
    expect(res.violations.map((v) => v.code)).toEqual([
      "LOGGING_UNAVAILABLE",
      "OVERSIGHT_POLICY_REFUSED",
      "LOGGING_UNAVAILABLE",
      "DISCLOSURE_REQUIRED"
    ]);
  });

  test("rejects prototype-pollution key segments fail-closed while allowing Object.prototype method names like [toString]", () => {
    for (const badToml of [
      '[__proto__]\npolluted_by_table = "pwned"\n',
      '__proto__.polluted_by_dot = "pwned"\n',
      '[constructor.prototype]\npolluted = "pwned"\n',
      'a.constructor.b = "pwned"\n',
      'prototype = "pwned"\n',
      '__proto__ = "pwned"\n'
    ]) {
      try {
        parseTomlDocument(badToml);
        throw new Error(`Expected parseTomlDocument to reject: ${badToml}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ComplianceRefusalError);
        expect((e as ComplianceRefusalError).code).toBe("INVALID_COMPLIANCE_CONFIG");
      }
    }

    expect(({} as Record<string, unknown>).polluted_by_table).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted_by_dot).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const safeDoc = parseTomlDocument('[toString]\nfoo = "bar"\n[valueOf]\nhasOwnProperty = "ok"\n');
    expect(Object.entries(safeDoc)).toEqual([
      ["toString", { foo: "bar" }],
      ["valueOf", { hasOwnProperty: "ok" }]
    ]);
  });
});

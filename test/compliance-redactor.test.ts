import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEFAULT_REDACT_ENV,
  containsUnredactedSecretsOrPii,
  pseudonymizeActor,
  redactComplianceData,
  redactComplianceText
} from "../src/compliance/redactor.ts";

const SCRIPT = resolve(import.meta.dir, "../scripts/capability-snapshot.sh");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

// Construct credential test values dynamically to avoid static scanner noise while testing real patterns.
const TEST_JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ1c2VyMSJ9", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"].join(".");
const TEST_PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
  "-----END PRIVATE KEY-----"
].join("\n");

describe("F04 unified redactor & capability-snapshot alignment (zero-mock Chicago)", () => {
  test("Suite 1: credential parity + compound/case-insensitive keys + prose & empty preservation", () => {
    const input = {
      apiKey: "sk-1234",
      api_key: "x1y2z3w",
      token: "a",
      secret: "sec1",
      password: "pw",
      authorization: "Basic abc123",
      access_token: "at_99",
      refresh_token: "rt_88",
      refreshtoken: "rt_77",
      authToken: "auth_66",
      accessToken: "acc_55",
      refreshToken: "ref_44",
      client_secret: "cs_33",
      "x-api-key": "xak_22",
      private_key: "pk_11",
      APIKEY: "UPPER_1",
      Refresh_Token: "Mixed_2",
      AUTHORIZATION: "Token tok_9ce8af974b",
      emptyKey: "",
      apiKeyEmpty: "",
      prose: "the token bucket refills",
      emptyProse: "",
      max_tokens: 4096,
      tokenizer: "o200k_base",
      token_count: "128",
      nestedEscaped: JSON.stringify({ content: JSON.stringify({ Refresh_Token: "rt_nested", apiKey: "" }) }),
      urlWithUserInfo: "https://svc_user:s3cr3tPass@api.example.com/v1/run"
    };
    // Ensure key named apiKey with empty string stays ""
    const withEmptySecret = { ...input, apiKey: "" };
    const out = redactComplianceData(withEmptySecret, { redactPii: false });

    expect(out.apiKey).toBe("");
    expect(out.api_key).toBe("REDACTED");
    expect(out.token).toBe("REDACTED");
    expect(out.secret).toBe("REDACTED");
    expect(out.password).toBe("REDACTED");
    expect(out.authorization).toBe("REDACTED");
    expect(out.access_token).toBe("REDACTED");
    expect(out.refresh_token).toBe("REDACTED");
    expect(out.refreshtoken).toBe("REDACTED");
    expect(out.authToken).toBe("REDACTED");
    expect(out.accessToken).toBe("REDACTED");
    expect(out.refreshToken).toBe("REDACTED");
    expect(out.client_secret).toBe("REDACTED");
    expect(out["x-api-key"]).toBe("REDACTED");
    expect(out.private_key).toBe("REDACTED");
    expect(out.APIKEY).toBe("REDACTED");
    expect(out.Refresh_Token).toBe("REDACTED");
    expect(out.AUTHORIZATION).toBe("REDACTED");
    expect(out.prose).toBe("the token bucket refills");
    expect(out.emptyProse).toBe("");
    expect(out.max_tokens).toBe(4096);
    expect(out.tokenizer).toBe("o200k_base");
    expect(out.token_count).toBe("128");
    expect(out.nestedEscaped).toContain("REDACTED");
    expect(out.nestedEscaped).toContain('\\"apiKey\\":\\"\\"');
    expect(out.urlWithUserInfo).toBe("https://svc_user:REDACTED@api.example.com/v1/run");

    // Verify Bearer & Auth schemes in free text
    expect(redactComplianceText("Bearer sk-live-9ce8af97", { redactPii: false })).toBe("Bearer REDACTED");
    expect(redactComplianceText("authorization: sk-live-9ce8af97", { redactPii: false })).toBe(
      "authorization: REDACTED"
    );
    expect(redactComplianceText("the token bucket refills", { redactPii: false })).toBe("the token bucket refills");
    expect(redactComplianceText("", { redactPii: false })).toBe("");
  });

  test("Suite 2: JWT and multiline/escaped PEM private keys", () => {
    const res = redactComplianceData(
      {
        authLine: `Authorization: Bearer ${TEST_JWT}`,
        pemBlock: TEST_PEM,
        escapedPem: JSON.stringify({ key: TEST_PEM })
      },
      { redactPii: false }
    );
    expect(res.authLine).toBe("Authorization: Bearer REDACTED");
    expect(res.pemBlock).toBe("REDACTED");
    expect(res.escapedPem).not.toContain("PRIVATE KEY");
    expect(containsUnredactedSecretsOrPii(JSON.stringify(res), { redactPii: false })).toBe(false);
  });

  test("Suite 3: [ocel].redact_env / [compliance].redact_env & envSecrets", () => {
    expect(DEFAULT_REDACT_ENV).toEqual(["API_KEY", "AUTHORIZATION", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
    const env = {
      OPENAI_API_KEY: "sk-proj-real-test-secret-999",
      CUSTOM_TOKEN: "cust-tok-888",
      SHORT_NOISE: "1"
    };
    const out = redactComplianceData(
      {
        msg: "used sk-proj-real-test-secret-999 and cust-tok-888 on turn 1",
        explicit: "manual-secret-value"
      },
      {
        redactPii: false,
        redactEnv: ["OPENAI_API_KEY", "CUSTOM_TOKEN", "SHORT_NOISE", "MISSING_VAR"],
        env,
        envSecrets: ["manual-secret-value"]
      }
    );
    expect(out.msg).toBe("used REDACTED and REDACTED on turn 1");
    expect(out.explicit).toBe("REDACTED");
    expect(containsUnredactedSecretsOrPii(JSON.stringify(out), {
      redactPii: false,
      redactEnv: ["OPENAI_API_KEY", "CUSTOM_TOKEN"],
      env,
      envSecrets: ["manual-secret-value"]
    })).toBe(false);
  });

  test("Suite 4: GDPR PII redaction (emails, IPv4, IPv6, OS home paths) vs non-PII preservation", () => {
    const sample = {
      email: "alice.smith@example.org",
      npmPkg: "@earendil-works/pi-tui",
      ip4: "connect 192.168.1.10 and 10.0.0.1:8080",
      semver: "version 3.14.3 and 26.9.22",
      oid: "oid 1.3.6.1.4.1",
      ip6: "hosts 2001:0db8:85a3:0000:0000:8a2e:0370:7334 fe80::1 ::1 ::ffff:192.0.2.128",
      nonIp6: "19:15:56 owl::Thing std::vector dead::beef",
      macPath: "/Users/sac/.zcode/v2/setting.json",
      linuxPath: "/home/alice/work/repo"
    };

    const piiRedacted = redactComplianceData(sample, { redactPii: true });
    expect(piiRedacted.email).toBe("REDACTED");
    expect(piiRedacted.npmPkg).toBe("@earendil-works/pi-tui");
    expect(piiRedacted.ip4).toBe("connect REDACTED and REDACTED:8080");
    expect(piiRedacted.semver).toBe("version 3.14.3 and 26.9.22");
    expect(piiRedacted.oid).toBe("oid 1.3.6.1.4.1");
    expect(piiRedacted.ip6).toBe("hosts REDACTED REDACTED REDACTED REDACTED");
    expect(piiRedacted.nonIp6).toBe("19:15:56 owl::Thing std::vector dead::beef");
    expect(piiRedacted.macPath).toBe("/Users/REDACTED/.zcode/v2/setting.json");
    expect(piiRedacted.linuxPath).toBe("/home/REDACTED/work/repo");
    // Idempotent second pass
    expect(redactComplianceData(piiRedacted, { redactPii: true })).toEqual(piiRedacted);
    expect(containsUnredactedSecretsOrPii(JSON.stringify(piiRedacted), { redactPii: true })).toBe(false);

    // Secret-only mode preserves paths/emails/IPs
    const secretOnly = redactComplianceData(sample, { redactPii: false });
    expect(secretOnly).toEqual(sample);
  });

  test("Suite 5: pseudonymizeActor deterministic HMAC-SHA256 & fail-closed salt check", () => {
    const expected = createHmac("sha256", "salt-v1").update("actor-alice", "utf8").digest("hex");
    const got = pseudonymizeActor("actor-alice", "salt-v1");
    expect(got).toBe(expected);
    expect(got).not.toBe(pseudonymizeActor("actor-alice", "salt-v2"));
    expect(containsUnredactedSecretsOrPii(got)).toBe(false);

    expect(() => pseudonymizeActor("actor-alice", "")).toThrow(/REDACTION_FAILURE/);
    expect(() => pseudonymizeActor("", "salt-v1")).toThrow(/REDACTION_FAILURE/);
  });

  test("Suite 6: containsUnredactedSecretsOrPii anti-vacuity & circular/Date robustness", () => {
    expect(containsUnredactedSecretsOrPii('{"apiKey":"abc1234"}')).toBe(true);
    expect(containsUnredactedSecretsOrPii(`Bearer ${TEST_JWT}`)).toBe(true);
    expect(containsUnredactedSecretsOrPii(TEST_PEM)).toBe(true);
    expect(containsUnredactedSecretsOrPii("user@example.com", { redactPii: true })).toBe(true);
    expect(containsUnredactedSecretsOrPii("/Users/sac/.zcode/x", { redactPii: true })).toBe(true);

    expect(containsUnredactedSecretsOrPii("the token bucket refills")).toBe(false);
    expect(containsUnredactedSecretsOrPii("")).toBe(false);
    expect(containsUnredactedSecretsOrPii('{"apiKey":""}')).toBe(false);
    expect(containsUnredactedSecretsOrPii("Authorization: Bearer REDACTED")).toBe(false);

    const ts = new Date("2026-08-01T00:00:00.000Z");
    const obj: Record<string, unknown> = { createdAt: ts, secret: "s1" };
    obj.self = obj;
    const redacted = redactComplianceData(obj);
    expect(redacted.createdAt).toBe(ts);
    expect(redacted.secret).toBe("REDACTED");
    expect(redacted.self).toBe("[Circular]");
  });

  test("Suite 7: real subprocess capability-snapshot.sh redacts <8-char, compound, JWT, PEM, TOML, escaped JSON & fails closed on >2MB", () => {
    const home = makeTempDir("capsnap-f04-");
    const repo = join(home, "repo");
    const extractDir = join(home, "extracted");
    mkdirSync(join(home, ".zcode", "cli"), { recursive: true });
    mkdirSync(repo, { recursive: true });
    mkdirSync(extractDir, { recursive: true });

    // Initialize a real git repo for untracked file redaction check
    Bun.spawnSync(["git", "init"], { cwd: repo, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
    writeFileSync(
      join(repo, "untracked-secrets.json"),
      JSON.stringify({
        shortKey: "ok",
        apiKey: "abc1234",
        Refresh_Token: "rt_short",
        prose: "the token bucket refills"
      }),
      "utf8"
    );

    writeFileSync(
      join(home, ".zcode", "cli", "config.json"),
      JSON.stringify({
        apiKey: "abc1234",
        token: "x1y2z3w",
        refresh_token: "rt_123",
        Refresh_Token: "Rt_Mixed",
        emptySecret: "",
        nested: JSON.stringify({ access_token: "at_9" }),
        escaped3: JSON.stringify({ inner: JSON.stringify({ refresh_token: "rt_nested_3level" }) }),
        jwt: TEST_JWT,
        auth: "Authorization: Basic abc123",
        bearer: "Bearer tok_9ce8af974b",
        prose: "the token bucket refills"
      }),
      "utf8"
    );
    mkdirSync(join(home, ".zcode", "workspace"), { recursive: true });
    writeFileSync(join(home, ".zcode", "workspace", "key.txt"), `${TEST_PEM}\n`, "utf8");
    writeFileSync(
      join(home, ".zcode", "workspace", "secrets.toml"),
      "refresh_token = \"rt_toml_1\"\napi_key = 'sk_single_quote'\npassword = ''\n",
      "utf8"
    );

    const env = {
      PATH: process.env.PATH ?? "",
      HOME: home,
      ZCODE_REPO: repo,
      ZCODE_APP: join(home, "no-such-app"),
      ZCODE_BACKUP_ROOT: join(home, "backups")
    };

    const saveRes = Bun.spawnSync(["bash", SCRIPT, "save"], { env, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
    expect(saveRes.exitCode).toBe(0);

    const snaps = readdirSync(join(home, "backups"));
    expect(snaps.length).toBe(1);
    const snapDir = join(home, "backups", snaps[0]!);

    const tarRes = Bun.spawnSync(["tar", "-xzf", join(snapDir, "user-state.tar.gz"), "-C", extractDir], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000
    });
    expect(tarRes.exitCode).toBe(0);

    const restoredConfig = JSON.parse(
      readFileSync(join(extractDir, home.slice(1), ".zcode", "cli", "config.json"), "utf8")
    ) as Record<string, string>;
    expect(restoredConfig.apiKey).toBe("REDACTED");
    expect(restoredConfig.token).toBe("REDACTED");
    expect(restoredConfig.refresh_token).toBe("REDACTED");
    expect(restoredConfig.Refresh_Token).toBe("REDACTED");
    expect(restoredConfig.emptySecret).toBe("");
    expect(restoredConfig.nested).toContain("REDACTED");
    expect(restoredConfig.escaped3).toContain("REDACTED");
    expect(restoredConfig.escaped3).not.toContain("rt_nested_3level");
    expect(restoredConfig.jwt).toBe("REDACTED");
    expect(restoredConfig.auth).toBe("Authorization: Basic REDACTED");
    expect(restoredConfig.bearer).toBe("Bearer REDACTED");
    expect(restoredConfig.prose).toBe("the token bucket refills");

    const restoredKey = readFileSync(join(extractDir, home.slice(1), ".zcode", "workspace", "key.txt"), "utf8");
    expect(restoredKey.trim()).toBe("REDACTED");

    const restoredToml = readFileSync(join(extractDir, home.slice(1), ".zcode", "workspace", "secrets.toml"), "utf8");
    expect(restoredToml.trim()).toBe("refresh_token = \"REDACTED\"\napi_key = 'REDACTED'\npassword = ''");

    const untrackedSnap = JSON.parse(readFileSync(join(snapDir, "repo", "untracked", "untracked-secrets.json"), "utf8"));
    expect(untrackedSnap.apiKey).toBe("REDACTED");
    expect(untrackedSnap.Refresh_Token).toBe("REDACTED");
    expect(untrackedSnap.prose).toBe("the token bucket refills");

    // Fail-closed >2MB anti-vacuity test: >2MB file skips redact_tree and must be caught by assert_no_secrets
    const bigHome = makeTempDir("capsnap-big-");
    mkdirSync(join(bigHome, ".zcode", "workspace"), { recursive: true });
    const bigPadding = "x".repeat(2_200_000);
    writeFileSync(
      join(bigHome, ".zcode", "workspace", "large.json"),
      `{"padding":"${bigPadding}","refresh_token":"rt_123"}\n`,
      "utf8"
    );
    const bigBackupRoot = join(bigHome, "backups");
    const bigFail = Bun.spawnSync(["bash", SCRIPT, "save"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: bigHome,
        ZCODE_REPO: join(bigHome, "no-repo"),
        ZCODE_APP: join(bigHome, "no-app"),
        ZCODE_BACKUP_ROOT: bigBackupRoot
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000
    });
    expect(bigFail.exitCode).not.toBe(0);
    expect(bigFail.stderr.toString()).toContain("refusing to snapshot");
    expect(existsSync(bigBackupRoot) ? readdirSync(bigBackupRoot) : []).toEqual([]);

    // Fail-closed >2MB untracked repo file must also leave ZERO caps-* husk on disk
    const bigRepoHome = makeTempDir("capsnap-big-repo-");
    const bigRepo = join(bigRepoHome, "repo");
    const bigRepoBackupRoot = join(bigRepoHome, "backups");
    mkdirSync(join(bigRepoHome, ".zcode", "cli"), { recursive: true });
    mkdirSync(bigRepo, { recursive: true });
    writeFileSync(join(bigRepoHome, ".zcode", "cli", "config.json"), '{"model":"m1"}', "utf8");
    Bun.spawnSync(["git", "init"], { cwd: bigRepo, stdout: "pipe", stderr: "pipe", timeout: 15_000 });
    writeFileSync(
      join(bigRepo, "untracked_big.json"),
      `{"padding":"${bigPadding}","refresh_token":"rt_repo_big_123"}\n`,
      "utf8"
    );
    const bigRepoFail = Bun.spawnSync(["bash", SCRIPT, "save"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: bigRepoHome,
        ZCODE_REPO: bigRepo,
        ZCODE_APP: join(bigRepoHome, "no-app"),
        ZCODE_BACKUP_ROOT: bigRepoBackupRoot
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000
    });
    expect(bigRepoFail.exitCode).not.toBe(0);
    expect(bigRepoFail.stderr.toString()).toContain("refusing to snapshot");
    expect(existsSync(bigRepoBackupRoot) ? readdirSync(bigRepoBackupRoot) : []).toEqual([]);
  }, 35_000);

  test("Suite 8: URL userinfo, custom replacement, 3+-level escaped JSON, quoted Authorization, non-string secrets, and truncated PEM symmetry", () => {
    // 1. URL userinfo under redactPii: false and redactPii: true (preserving domain hostname)
    const domainUrl = "https://svc_user:s3cr3tPass@api.example.com/v1/run";
    const redactedNoPii = redactComplianceText(domainUrl, { redactPii: false });
    expect(redactedNoPii).toBe("https://svc_user:REDACTED@api.example.com/v1/run");
    expect(containsUnredactedSecretsOrPii(redactedNoPii, { redactPii: false })).toBe(false);

    const redactedWithPii = redactComplianceText(domainUrl, { redactPii: true });
    expect(redactedWithPii).toBe("https://svc_user:REDACTED@api.example.com/v1/run");
    expect(containsUnredactedSecretsOrPii(redactedWithPii, { redactPii: true })).toBe(false);

    const ipUrl = "https://svc_user:pass@192.168.1.50/v1/run";
    const redactedIpUrl = redactComplianceText(ipUrl, { redactPii: true });
    expect(redactedIpUrl).toBe("https://svc_user:REDACTED@REDACTED/v1/run");
    expect(containsUnredactedSecretsOrPii(redactedIpUrl, { redactPii: true })).toBe(false);

    expect(containsUnredactedSecretsOrPii("https://u:REDACTED@localhost/x", { redactPii: true })).toBe(false);
    expect(containsUnredactedSecretsOrPii("https://u:REDACTED@localhost/x", { redactPii: false })).toBe(false);

    // 2. Custom replacement across URL userinfo, AUTH_SCHEME_RE, BEARER_RE, AUTH_RAW_RE, HOME_USER_PATH_RE
    const customOpts = { replacement: "[MASKED]", redactPii: true } as const;
    const customSamples = [
      domainUrl,
      "Authorization: Basic dXNlcjpwYXNz",
      'Authorization: "Basic dXNlcjpwYXNz"',
      "Bearer mysecret1234",
      "authorization: sk-live-9ce8af97",
      'authorization="sk-live-9ce8af97"',
      "/Users/alice/work/repo"
    ];
    for (const s of customSamples) {
      const masked = redactComplianceText(s, customOpts);
      expect(masked).toContain("[MASKED]");
      expect(redactComplianceText(masked, customOpts)).toBe(masked);
      expect(containsUnredactedSecretsOrPii(masked, customOpts)).toBe(false);
    }
    const customObjOut = redactComplianceData(
      { token: "secret123", msg: "Authorization: Bearer secret123", url: domainUrl },
      { replacement: "[MASKED]" }
    );
    expect(containsUnredactedSecretsOrPii(JSON.stringify(customObjOut), { replacement: "[MASKED]" })).toBe(false);

    // 3. 3-level & 4-level standalone stringified JSON + non-JSON log prefix
    const secretVal = "sk-super-secret-value-9999";
    const tripleStandalone = JSON.stringify(JSON.stringify(JSON.stringify({ apiKey: secretVal })));
    expect(containsUnredactedSecretsOrPii(tripleStandalone)).toBe(true);
    const redactedTriple = redactComplianceData(tripleStandalone);
    expect(redactedTriple).not.toContain(secretVal);
    expect(redactedTriple).toContain("REDACTED");
    expect(containsUnredactedSecretsOrPii(redactedTriple)).toBe(false);

    const quadStandalone = JSON.stringify(tripleStandalone);
    const redactedQuad = redactComplianceText(quadStandalone);
    expect(redactedQuad).not.toContain(secretVal);
    expect(containsUnredactedSecretsOrPii(redactedQuad)).toBe(false);

    const logPrefix3 = 'LOG_PREFIX {"mid":"{\\"inner\\":\\"{\\\\\\"apiKey\\\\\\":\\\\\\"sk-super-secret-value-9999\\\\\\"}\\"}"}';
    expect(containsUnredactedSecretsOrPii(logPrefix3)).toBe(true);
    const redactedLogPrefix3 = redactComplianceText(logPrefix3);
    expect(redactedLogPrefix3).not.toContain(secretVal);
    expect(redactedLogPrefix3).toContain("REDACTED");
    expect(containsUnredactedSecretsOrPii(redactedLogPrefix3)).toBe(false);

    // 4. Quoted Authorization headers
    expect(containsUnredactedSecretsOrPii('Authorization: "Basic dXNlcjpwYXNz"')).toBe(true);
    const qBasic = redactComplianceText('Authorization: "Basic dXNlcjpwYXNz"');
    expect(qBasic).toBe('Authorization: "Basic REDACTED"');
    expect(containsUnredactedSecretsOrPii(qBasic)).toBe(false);

    expect(containsUnredactedSecretsOrPii('authorization="Bearer sk-live-9ce8af97"')).toBe(true);
    const qBearer = redactComplianceText('authorization="Bearer sk-live-9ce8af97"');
    expect(qBearer).toBe('authorization="Bearer REDACTED"');
    expect(containsUnredactedSecretsOrPii(qBearer)).toBe(false);

    expect(containsUnredactedSecretsOrPii('authorization: "sk-live-9ce8af97"')).toBe(true);
    const qRaw = redactComplianceText('authorization: "sk-live-9ce8af97"');
    expect(qRaw).toBe('authorization: "REDACTED"');
    expect(containsUnredactedSecretsOrPii(qRaw)).toBe(false);

    // 5. Non-string sensitive key values
    const nonStrInput = {
      password: 123456,
      secret: false,
      apiKey: ["k1", "k2"],
      token: [],
      authToken: "",
      max_tokens: 4096
    };
    expect(containsUnredactedSecretsOrPii(JSON.stringify({ password: 123456, apiKey: ["k1"] }))).toBe(true);
    const nonStrRedacted = redactComplianceData<Record<string, unknown>>(nonStrInput);
    expect(nonStrRedacted).toEqual({
      password: "REDACTED",
      secret: "REDACTED",
      apiKey: ["REDACTED", "REDACTED"],
      token: [],
      authToken: "",
      max_tokens: 4096
    });
    expect(containsUnredactedSecretsOrPii(JSON.stringify(nonStrRedacted))).toBe(false);

    // 6. Truncated PEM private key headers symmetry
    const truncatedPem = "PEM header only: -----BEGIN RSA PRIVATE KEY----- abc";
    expect(containsUnredactedSecretsOrPii(truncatedPem)).toBe(true);
    const redactedTruncatedPem = redactComplianceText(truncatedPem);
    expect(redactedTruncatedPem).toBe("PEM header only: REDACTED");
    expect(containsUnredactedSecretsOrPii(redactedTruncatedPem)).toBe(false);
  });
});

// Leak-prevention tripwire (2026-09-23): credential-shaped values must be
// REDACTED before they enter the OCEL event chain. A tool result echoing a
// config file must never commit a secret into the tap's hashes, files or
// receipts — and because redaction happens at ingest, the hash chain must
// stay intact over redacted content.
//
// Real recorder, real recorded runtime fixture lines, real files. No mocks.
// Falsifiers from skeptic 91024e61 closed 2026-11-21 (FAIL→PASS).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { containsUnredactedSecretsOrPii } from "../src/compliance/redactor.ts";
import { verifyChain } from "../src/generated/ocel.ts";
import { OcelRecorder, redactSecrets, sanitizeSessionFileId } from "../src/ocel-tap.ts";
import { fixtures } from "./support/ocel.ts";

const fakeKey = "FAKEKEY-9ce8af9704914b78a47ecb91ded590c3";

describe("redactSecrets (pure)", () => {
  test("redacts credential-shaped values", () => {
    const text = JSON.stringify({
      apiKey: fakeKey,
      api_key: fakeKey,
      token: fakeKey,
      secret: fakeKey,
      password: fakeKey,
      headers: { Authorization: `Bearer ${fakeKey}` },
      note: "the token bucket refills"
    });
    const out = redactSecrets(text);
    expect(out.includes(fakeKey)).toBe(false);
    expect((out.match(/REDACTED/g) ?? []).length).toBe(6);
    // Ordinary prose containing a guarded word survives untouched.
    expect(out.includes("the token bucket refills")).toBe(true);
  });

  test("leaves text without credential shapes byte-identical", () => {
    const text = JSON.stringify({ id: "abc12345", path: "/Users/sac/.zcode/v2/setting.json" });
    expect(redactSecrets(text)).toBe(text);
  });

  test("redacts secrets embedded as escaped JSON inside string values", () => {
    // The real shape: a tool result echoing a config file arrives as a string
    // whose content is itself JSON, so the quotes are escaped in the line.
    const line = JSON.stringify({
      type: "tool_result",
      content: `{\"apiKey\":\"${fakeKey}\",\"note\":\"ok\"}`
    });
    const out = redactSecrets(line);
    expect(out.includes(fakeKey)).toBe(false);
    expect(out.includes("apiKey")).toBe(true);
  });

  test("redacts a 7-char secret (pre-fix falsifier: the >= 8 length floor let it pass through)", () => {
    const out = redactSecrets(JSON.stringify({ apiKey: "abc1234", token: "x1y2z3w" }));
    expect(out.includes("abc1234")).toBe(false);
    expect(out.includes("x1y2z3w")).toBe(false);
    expect((out.match(/REDACTED/g) ?? []).length).toBe(2);
    // An empty credential value is left honest: nothing to leak, no phantom REDACTED.
    expect(redactSecrets(JSON.stringify({ apiKey: "" }))).toBe(JSON.stringify({ apiKey: "" }));
  });

  test("redacts refresh_token (pre-fix falsifier: the key list matched only refreshtoken)", () => {
    const out = redactSecrets(JSON.stringify({ refresh_token: fakeKey, access_token: fakeKey }));
    expect(out.includes(fakeKey)).toBe(false);
    // Also when embedded as escaped JSON inside a string value.
    const line = JSON.stringify({ type: "tool_result", content: `{\"refresh_token\":\"${fakeKey}\",\"note\":\"ok\"}` });
    const embedded = redactSecrets(line);
    expect(embedded.includes(fakeKey)).toBe(false);
    expect(embedded.includes("refresh_token")).toBe(true);
  });

  test("redacts non-Bearer Authorization schemes (pre-fix falsifier: bearerRe matched Bearer only)", () => {
    expect(redactSecrets("Authorization: Basic abc123")).toBe("Authorization: Basic REDACTED");
    expect(redactSecrets("authorization: sk-live-9ce8af97")).toBe("authorization: REDACTED");
    expect(redactSecrets("Authorization: Token tok_9ce8af974b")).toBe("Authorization: Token REDACTED");
    // Bearer still redacted anywhere; Authorization-adjacent prose survives.
    expect(redactSecrets(`Bearer ${fakeKey}`)).toBe("Bearer REDACTED");
    expect(redactSecrets("the token bucket refills")).toBe("the token bucket refills");
  });

  test("redacts URL query/fragment credentials (B4 pre-fix: secrets never matched a JSON key)", () => {
    const query = JSON.stringify({ url: `https://api.example.com/v1?api_key=${fakeKey}&q=1` });
    const out = redactSecrets(query);
    expect(out.includes(fakeKey)).toBe(false);
    expect(out.includes("api_key=REDACTED")).toBe(true);
    expect(redactSecrets(`https://oauth.example/?access_token=${fakeKey}`).includes(fakeKey)).toBe(false);
    expect(redactSecrets(`https://x/#access_token=${fakeKey}`).includes(fakeKey)).toBe(false);
    expect(redactSecrets(`https://x/?token=${fakeKey}`).includes(fakeKey)).toBe(false);
    // userinfo password
    expect(redactSecrets(`https://user:${fakeKey}@host/path`)).toBe("https://user:REDACTED@host/path");
    // Ordinary prose with a guarded word still survives.
    expect(redactSecrets("the token bucket refills")).toBe("the token bucket refills");
  });

  test("sanitizeSessionFileId strips path-hostile URL punctuation", () => {
    const sid = sanitizeSessionFileId(`https://api.example.com/?api_key=REDACTED`);
    expect(sid.includes("/")).toBe(false);
    expect(sid.includes("?")).toBe(false);
    expect(sid.includes("=")).toBe(false);
    expect(sid.length).toBeGreaterThan(0);
  });

  // CAPABILITY_SNAPSHOT / SECRET_KEY_RE alignment (skeptic: secretKeyRe too narrow).
  test("redacts CAPABILITY_SNAPSHOT credential keys (*_api_key, authToken, passwd, …)", () => {
    const payload = {
      openai_api_key: fakeKey,
      client_secret: fakeKey,
      authToken: fakeKey,
      session_token: fakeKey,
      refreshtoken: fakeKey,
      passwd: fakeKey,
      private_key: fakeKey,
      cookie: `session=${fakeKey}`,
      "set-cookie": `sid=${fakeKey}`,
      note: "the token bucket refills"
    };
    const out = redactSecrets(JSON.stringify(payload));
    expect(out.includes(fakeKey)).toBe(false);
    expect((out.match(/REDACTED/g) ?? []).length).toBe(9);
    expect(out.includes("the token bucket refills")).toBe(true);
    // Escaped embed of a compound key must also scrub.
    const embedded = redactSecrets(
      JSON.stringify({ type: "tool_result", content: `{\"client_secret\":\"${fakeKey}\"}` })
    );
    expect(embedded.includes(fakeKey)).toBe(false);
    expect(embedded.includes("client_secret")).toBe(true);
  });

  test("redacts ApiKey scheme + short Bearer (skeptic: ApiKey gap / Bearer floor)", () => {
    expect(redactSecrets("Authorization: ApiKey sk-live-9ce8af97")).toBe(
      "Authorization: ApiKey REDACTED"
    );
    expect(redactSecrets("authorization: apikey abc1234")).toBe("authorization: apikey REDACTED");
    // Short Bearer with a digit must scrub (compliance/capability-snapshot floor).
    expect(redactSecrets("Bearer abc1234")).toBe("Bearer REDACTED");
    // Raw Authorization has no ≥8 floor (snapshot/compliance parity).
    expect(redactSecrets("authorization: abc1234")).toBe("authorization: REDACTED");
    expect(redactSecrets("the token bucket refills")).toBe("the token bucket refills");
  });

  test("redacts compact JWT and PEM private-key blocks", () => {
    const jwt = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiJ1c2VyMSJ9",
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    ].join(".");
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
      "-----END PRIVATE KEY-----"
    ].join("\n");
    expect(redactSecrets(`Authorization: Bearer ${jwt}`).includes(jwt)).toBe(false);
    expect(redactSecrets(JSON.stringify({ token: jwt })).includes(jwt)).toBe(false);
    expect(redactSecrets(`note: ${jwt}`)).toBe("note: REDACTED");
    expect(redactSecrets(pem)).toBe("REDACTED");
    expect(redactSecrets(JSON.stringify({ private_key: pem })).includes("BEGIN")).toBe(false);
  });

  test("redacts non-string credential values (skeptic: string-only floor)", () => {
    const out = redactSecrets(
      JSON.stringify({
        apiKey: ["sk-a", "sk-b"],
        password: 12345,
        token: true,
        nested: { client_secret: { inner: "still-secret" } }
      })
    );
    expect(out.includes("sk-a")).toBe(false);
    expect(out.includes("sk-b")).toBe(false);
    expect(out.includes("12345")).toBe(false);
    expect(out.includes("still-secret")).toBe(false);
    expect(out.includes("REDACTED")).toBe(true);
    // Empty credential containers stay honest.
    expect(redactSecrets(JSON.stringify({ apiKey: [] }))).toBe(JSON.stringify({ apiKey: [] }));
    expect(redactSecrets(JSON.stringify({ apiKey: "" }))).toBe(JSON.stringify({ apiKey: "" }));
  });

  test("redacts escaped refreshtoken (skeptic: escapedSecretRe omitted underscored-less form)", () => {
    // Non-JSON whole string so the escaped-shape fallback runs (not JSON.parse path).
    const raw = `prefix {\\"refreshtoken\\":\\"${fakeKey}\\"} suffix`;
    const out = redactSecrets(raw);
    expect(out.includes(fakeKey)).toBe(false);
    expect(out.includes("refreshtoken")).toBe(true);
    expect(out.includes("REDACTED")).toBe(true);
  });
});

describe("recorder-level redaction", () => {
  test("secret-bearing URL sessionId is redacted before filename/receipt bind (B4 pre-fix)", () => {
    const suite = fixtures().find((f) => f.name === "turn-simple.ndjson") ?? fixtures()[0];
    expect(suite).toBeDefined();
    const sid = `https://api.example.com/callback?api_key=${fakeKey}`;
    const doctored = suite!.lines.map((line) => {
      if (!line.trim()) return line;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      parsed.sessionId = sid;
      return JSON.stringify(parsed);
    });
    const dir = mkdtempSync(join(tmpdir(), "ocel-sess-redact-"));
    try {
      const recorder = new OcelRecorder("zcode_stream", dir);
      for (const line of doctored) recorder.feedLine(line);
      const result = recorder.finish();
      expect(result.events).toBeGreaterThan(0);
      expect(result.sessionId.includes(fakeKey)).toBe(false);
      expect(result.ocelPath.includes(fakeKey)).toBe(false);
      expect(result.receiptPath.includes(fakeKey)).toBe(false);
      const ocel = readFileSync(result.ocelPath, "utf8");
      const receipt = readFileSync(result.receiptPath, "utf8");
      expect(ocel.includes(fakeKey)).toBe(false);
      expect(receipt.includes(fakeKey)).toBe(false);
      const parsed = JSON.parse(receipt) as {
        chain_intact: boolean;
        receipt_chain_intact: boolean;
      };
      // chain_intact = OCEL verifyChain (pi_hash); receipt_chain_intact = ALOOP seal.
      expect(verifyChain(JSON.parse(ocel), "sha256")).toBeNull();
      expect(parsed.chain_intact).toBe(true);
      expect(parsed.receipt_chain_intact).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a secret in real fixture traffic never reaches the ocel file or receipt", () => {
    const suite = fixtures().find((f) => f.name === "turn-tool.ndjson");
    expect(suite).toBeDefined();
    const lines = suite!.lines.slice();
    // Doctor one real MID-STREAM line (the first line boots session state and
    // its title is not a mapped payload): replace its longest string value
    // with a secret payload so the value flows through a mapped field.
    const target = Math.max(1, Math.floor(lines.length / 2));
    let injected = false;
    const doctored = lines.map((line, index) => {
      if (injected || index !== target || !line.trim()) return line;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const longest = ((node: unknown): { parent: Record<string, unknown>; key: string } | null => {
        let found: { parent: Record<string, unknown>; key: string } | null = null;
        const walk = (node: unknown): void => {
          if (found || node === null || typeof node !== "object") return;
          for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (typeof value === "string" && value.length >= 20 && !found) found = { parent: node as Record<string, unknown>, key };
            else walk(value);
          }
        };
        walk(node);
        return found;
      })(parsed);
      if (!longest) return line;
      longest.parent[longest.key] = `{"apiKey":"${fakeKey}"}`;
      injected = true;
      return JSON.stringify(parsed);
    });
    expect(injected).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "ocel-redaction-"));
    try {
      const recorder = new OcelRecorder("zcode_stream", dir);
      for (const line of doctored) recorder.feedLine(line);
      const result = recorder.finish();
      expect(result.events).toBeGreaterThan(0);
      const ocel = readFileSync(result.ocelPath, "utf8");
      const receipt = readFileSync(result.receiptPath, "utf8");
      expect(ocel.includes(fakeKey)).toBe(false);
      expect(receipt.includes(fakeKey)).toBe(false);
      expect(ocel.includes("REDACTED")).toBe(true);
      // Assert the real OCEL pi_hash chain — not receipt ALOOP theater.
      const parsedReceipt = JSON.parse(receipt) as {
        chain_intact: boolean;
        receipt_chain_intact: boolean;
        event_count: number;
      };
      expect(verifyChain(JSON.parse(ocel), "sha256")).toBeNull();
      expect(parsedReceipt.chain_intact).toBe(true);
      expect(parsedReceipt.receipt_chain_intact).toBe(true);
      expect(parsedReceipt.event_count).toBe(result.events);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("replay_binding secrets are redacted before receipt write (skeptic: bypass)", () => {
    const suite = fixtures().find((f) => f.name === "turn-simple.ndjson") ?? fixtures()[0];
    expect(suite).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "ocel-replay-redact-"));
    try {
      const recorder = new OcelRecorder("zcode_stream", dir, {
        replayBinding: {
          provider: "test",
          worker_id: "w1",
          apiKey: fakeKey,
          client_secret: fakeKey,
          Authorization: `Bearer ${fakeKey}`,
          note: "the token bucket refills"
        }
      });
      for (const line of suite!.lines) recorder.feedLine(line);
      const result = recorder.finish();
      expect(result.events).toBeGreaterThan(0);
      const receiptText = readFileSync(result.receiptPath, "utf8");
      expect(receiptText.includes(fakeKey)).toBe(false);
      const receipt = JSON.parse(receiptText) as {
        replay_binding: Record<string, unknown>;
        chain_intact: boolean;
        receipt_chain_intact: boolean;
      };
      expect(receipt.replay_binding.apiKey).toBe("REDACTED");
      expect(receipt.replay_binding.client_secret).toBe("REDACTED");
      expect(receipt.replay_binding.Authorization).toBe("REDACTED");
      expect(receipt.replay_binding.note).toBe("the token bucket refills");
      expect(receipt.replay_binding.provider).toBe("test");
      expect(receipt.chain_intact).toBe(true);
      expect(receipt.receipt_chain_intact).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("chain_intact reflects OCEL verifyChain, not only receipt ALOOP seal", () => {
    // Empty tap: receipt ALOOP still seals (receipt_chain_intact=true) but
    // there is no OCEL event chain to claim intact. Pre-fix set
    // chain_intact from verify(chain) alone → false witness of pi_hash.
    const emptyDir = mkdtempSync(join(tmpdir(), "ocel-empty-chain-"));
    try {
      const empty = new OcelRecorder("zcode_stream", emptyDir);
      const emptyResult = empty.finish();
      expect(emptyResult.events).toBe(0);
      const emptyReceipt = JSON.parse(readFileSync(emptyResult.receiptPath, "utf8")) as {
        chain_intact: boolean;
        receipt_chain_intact: boolean;
        event_count: number;
        chain: { standing: string; seal?: boolean }[];
      };
      expect(emptyReceipt.event_count).toBe(0);
      expect(emptyReceipt.chain_intact).toBe(false);
      expect(emptyReceipt.receipt_chain_intact).toBe(true);
      const emptyDoc = JSON.parse(readFileSync(emptyResult.ocelPath, "utf8"));
      // verifyChain is vacuously null on zero events; chain_intact still
      // requires events.length > 0 so it cannot claim a non-existent log.
      expect(verifyChain(emptyDoc, "sha256")).toBeNull();
      expect(emptyReceipt.chain.at(-1)?.seal).toBe(true);
      // Standing tracks OCEL tripwire, not ALOOP seal success.
      expect(emptyReceipt.chain.at(-1)?.standing).toBe("blocked");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }

    const suite = fixtures().find((f) => f.name === "turn-simple.ndjson") ?? fixtures()[0];
    expect(suite).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "ocel-chain-witness-"));
    try {
      const recorder = new OcelRecorder("zcode_stream", dir);
      for (const line of suite!.lines) recorder.feedLine(line);
      const result = recorder.finish();
      const ocelDoc = JSON.parse(readFileSync(result.ocelPath, "utf8"));
      const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8")) as {
        chain_intact: boolean;
        receipt_chain_intact: boolean;
        event_count: number;
        chain: { standing: string; seal?: boolean }[];
      };
      const ocelOk = verifyChain(ocelDoc, "sha256") === null && ocelDoc.events.length > 0;
      // Least-breaking honest design: chain_intact === OCEL pi_hash tripwire.
      expect(receipt.chain_intact).toBe(ocelOk);
      expect(receipt.chain_intact).toBe(true);
      expect(receipt.receipt_chain_intact).toBe(true);
      expect(receipt.chain.at(-1)?.seal).toBe(true);
      expect(receipt.chain.at(-1)?.standing).toBe("alive");
      expect(receipt.event_count).toBe(result.events);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("OcelRecorder.feed() routes through compliance redactor (C3-OcelTap-Redaction falsifier)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const envSecret = "sk-proj-env-secret-9ce8af9704914b78";
    const prevOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = envSecret;
    const dir = mkdtempSync(join(tmpdir(), "ocel-c3-redaction-"));
    try {
      const recorder = new OcelRecorder("zcode_stream", dir);
      recorder.feed({
        type: "session.created",
        eventId: "e1",
        timestamp: 1700000000000,
        sessionId: "user@example.com",
        payload: {
          cookie: "sid=secret123",
          jwt,
          ip: "192.168.1.42",
          home: "/Users/alice/project",
          pem: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj",
          leakedEnv: `key=${envSecret}`
        }
      });
      const result = recorder.finish();
      expect(result.events).toBeGreaterThan(0);

      const ocelText = readFileSync(result.ocelPath, "utf8");
      const receiptText = readFileSync(result.receiptPath, "utf8");

      expect(ocelText.includes("user@example.com")).toBe(false);
      expect(ocelText.includes("sid=secret123")).toBe(false);
      expect(ocelText.includes(jwt)).toBe(false);
      expect(ocelText.includes("192.168.1.42")).toBe(false);
      expect(ocelText.includes("/Users/alice")).toBe(false);
      expect(ocelText.includes("BEGIN PRIVATE KEY")).toBe(false);
      expect(ocelText.includes(envSecret)).toBe(false);
      expect(receiptText.includes("user@example.com")).toBe(false);
      expect(containsUnredactedSecretsOrPii(ocelText)).toBe(false);

      const parsedDoc = JSON.parse(ocelText);
      expect(verifyChain(parsedDoc, "sha256")).toBeNull();
    } finally {
      if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAiKey;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

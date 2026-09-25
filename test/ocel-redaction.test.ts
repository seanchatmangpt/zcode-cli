// Leak-prevention tripwire (2026-09-23): credential-shaped values must be
// REDACTED before they enter the OCEL event chain. A tool result echoing a
// config file must never commit a secret into the tap's hashes, files or
// receipts — and because redaction happens at ingest, the hash chain must
// stay intact over redacted content.
//
// Real recorder, real recorded runtime fixture lines, real files. No mocks.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OcelRecorder, redactSecrets } from "../src/ocel-tap.ts";
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
});

describe("recorder-level redaction", () => {
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
      // Redaction happened at ingest, so the sealed chain must verify.
      const parsedReceipt = JSON.parse(receipt) as { chain_intact: boolean; event_count: number };
      expect(parsedReceipt.chain_intact).toBe(true);
      expect(parsedReceipt.event_count).toBe(result.events);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

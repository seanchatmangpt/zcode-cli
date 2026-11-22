import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestAppServer } from "../src/app-server-client.ts";
import { RULES, SOURCES, verifyChain, type OcelDoc } from "../src/generated/ocel.ts";
import { APP_SERVER_SOURCE, OcelRecorder } from "../src/ocel-tap.ts";
import { runtimeTestEnv } from "../scripts/runtime-test-env.ts";
import {
  assertBundleWhenRequired,
  ocelProblems,
  ontologyText,
  repoRoot,
  runtimeMissing
} from "./support/ocel.ts";

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

describe("F03 Source-AppServer contract & recorded capture verification (zero-mock Chicago)", () => {
  test("ontology/zcode-loop.ttl marks zl:Source-AppServer VERIFIED and generated SOURCES/RULES match", () => {
    const ttl = ontologyText();
    expect(ttl).toContain("# Review status: VERIFIED.");
    expect(ttl).toMatch(/zl:Source-AppServer[\s\S]*?VERIFIED against live vendor\/zcode\.cjs app-server/);
    expect(ttl).not.toContain("UNVERIFIED: no live subscription captured");

    const appSource = SOURCES.find((s) => s.id === APP_SERVER_SOURCE);
    expect(appSource).toEqual({
      id: APP_SERVER_SOURCE,
      kind: "app-server-subscription",
      nameField: "params.type",
      idField: "params.eventId",
      timeField: "params.timestamp",
      hash: "sha256"
    });

    const appRules = RULES.filter((r) => r.source === APP_SERVER_SOURCE);
    expect(appRules.length).toBeGreaterThan(0);
    const paths = new Set(appRules.map((r) => r.path));
    for (const expectedPath of [
      "params.sessionId",
      "params.turnId",
      "params.payload.toolCallId",
      "params.payload.requestId",
      "params.payload.agentId"
    ]) {
      expect(paths.has(expectedPath)).toBe(true);
    }
  });

  test("ingests real recorded app-server-live.jsonl capture through OcelRecorder(APP_SERVER_SOURCE)", () => {
    const livePath = join(repoRoot, "test", "fixtures", "max-turns", "app-server-live.jsonl");
    const lines = readFileSync(livePath, "utf8").split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(12);

    const outDir = makeTempDir("zcode-appserver-fx-");
    const rec = new OcelRecorder(APP_SERVER_SOURCE, outDir);
    // Feed in chunks to exercise carry-buffer boundary handling
    for (const line of lines) {
      rec.write(`${line.slice(0, 20)}`);
      rec.write(`${line.slice(20)}\n`);
    }
    const res = rec.finish();
    const doc = JSON.parse(readFileSync(res.ocelPath, "utf8")) as OcelDoc;
    const receipt = JSON.parse(readFileSync(res.receiptPath, "utf8")) as Record<string, unknown>;

    expect(ocelProblems(doc)).toEqual([]);
    expect(verifyChain(doc, "sha256")).toBeNull();
    expect(receipt.source).toBe(APP_SERVER_SOURCE);
    // Dual witness: OCEL pi_hash vs ALOOP receipt seal; standing alive iff OCEL ok.
    expect(receipt.chain_intact).toBe(true);
    expect(receipt.receipt_chain_intact).toBe(true);
    expect((receipt.chain as { standing: string }[]).at(-1)?.standing).toBe("alive");
    expect(doc.events.map((e) => e.type)).toContain("turn_started");
    expect(doc.events.map((e) => e.type)).toContain("tool_updated");
    expect(doc.events.map((e) => e.type)).toContain("turn_failed");
    // 10 session/event lines (2 computer-use/operation-event lines without params.type are safely ignored)
    expect(doc.events.length).toBe(10);

    const objTypes = new Set(doc.objects.map((o) => o.type));
    expect(objTypes.has("session")).toBe(true);
    expect(objTypes.has("turn")).toBe(true);
    expect(objTypes.has("tool_call")).toBe(true);
    const qualifiers = new Set(doc.events.flatMap((e) => e.relationships.map((r) => r.qualifier)));
    expect(qualifiers.has("about_tool_call")).toBe(true);
  });

  test("validates existing app-server-list.jsonocel + receipt fixture", () => {
    const docPath = join(repoRoot, "test", "fixtures", "zcode-ocel", "app-server-list.jsonocel");
    const receiptPath = join(repoRoot, "test", "fixtures", "zcode-ocel", "app-server-list.receipt.json");
    const doc = JSON.parse(readFileSync(docPath, "utf8")) as OcelDoc;
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;

    expect(ocelProblems(doc)).toEqual([]);
    expect(verifyChain(doc, "sha256")).toBeNull();
    expect(receipt.source).toBe(APP_SERVER_SOURCE);
    expect(receipt.chain_intact).toBe(true);
    expect(receipt.receipt_chain_intact).toBe(true);
    expect(receipt.event_count).toBe(30);

    const qualifiers = new Set(doc.events.flatMap((e) => e.relationships.map((r) => r.qualifier)));
    expect(qualifiers.has("about_model_request")).toBe(true);
    expect(qualifiers.has("about_tool_call")).toBe(true);
  });
});

describe.skipIf(runtimeMissing)("F03 live vendor/zcode.cjs app-server subprocess capture", () => {
  test("bundle required check", () => {
    assertBundleWhenRequired();
  });

  test("captures real session/create -> session/subscribe -> session/send -> session/event NDJSON and records OCEL 2.0", async () => {
    assertBundleWhenRequired();
    const home = makeTempDir("zcode-appserver-home-");
    const ocelDir = makeTempDir("zcode-appserver-ocel-");
    const bundlePath = join(repoRoot, "vendor", "zcode.cjs");
    const nodeBin = process.env.ZCODE_NODE?.trim() || "node";
    const env = runtimeTestEnv(home, repoRoot);

    // Sanity check via requestAppServer helper
    const listResult = await requestAppServer({
      method: "session/list",
      params: {},
      transport: {
        command: nodeBin,
        args: [bundlePath, "app-server"],
        cwd: home,
        env
      }
    });
    expect(listResult).toBeDefined();

    // Live subscription session over NDJSON stdio
    const captured = await new Promise<{ exitCode: number; lines: string[]; sessionEvents: Record<string, any>[] }>(
      (resolve, reject) => {
        const child = spawn(nodeBin, [bundlePath, "app-server"], {
          cwd: home,
          env,
          stdio: ["pipe", "pipe", "pipe"]
        });

        let buffer = "";
        const allLines: string[] = [];
        const sessionEvents: Record<string, any>[] = [];
        let sessionId: string | undefined;
        let sentSubscribe = false;
        let sentSend = false;
        let sentClose = false;
        let stderr = "";

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`app-server live capture timed out; stderr=${stderr}; lines=${allLines.join("\n")}`));
        }, 20_000);

        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });

        child.stdout.on("data", (chunk) => {
          buffer += String(chunk);
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            allLines.push(line);

            let msg: Record<string, any>;
            try {
              msg = JSON.parse(line) as Record<string, any>;
            } catch {
              continue;
            }

            if (msg.method === "session/requestRuntimePreferences" && msg.id !== undefined) {
              child.stdin.write(
                `${JSON.stringify({ id: msg.id, result: { nativeSearchEnhancementsEnabled: true } })}\n`
              );
              continue;
            }

            const createdSessionId =
              typeof msg.result?.session?.sessionId === "string"
                ? msg.result.session.sessionId
                : typeof msg.result?.sessionId === "string"
                  ? msg.result.sessionId
                  : undefined;

            if (msg.id === 1 && createdSessionId && !sentSubscribe) {
              sessionId = createdSessionId;
              sentSubscribe = true;
              child.stdin.write(
                `${JSON.stringify({
                  id: 2,
                  method: "session/subscribe",
                  params: { sessionId, deliveryKind: "desktop-continuous", afterSeq: 0 }
                })}\n`
              );
              continue;
            }

            if (msg.id === 2 && !sentSend && sessionId) {
              sentSend = true;
              child.stdin.write(
                `${JSON.stringify({
                  id: 3,
                  method: "session/send",
                  params: { sessionId, content: "ping" }
                })}\n`
              );
              continue;
            }

            if (msg.method === "session/event" && msg.params) {
              sessionEvents.push(msg);
              if (!sentClose && sessionId && (msg.params.type === "turn.failed" || msg.params.type === "turn.completed")) {
                sentClose = true;
                child.stdin.write(
                  `${JSON.stringify({
                    id: 4,
                    method: "session/close",
                    params: { sessionId }
                  })}\n`
                );
              }
              continue;
            }

            if (msg.id === 4) {
              child.stdin.end();
            }
          }
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ exitCode: code ?? 1, lines: allLines, sessionEvents });
        });

        child.stdin.write(
          `${JSON.stringify({
            id: 1,
            method: "session/create",
            params: { workspace: { workspacePath: home, workspaceKey: home }, persistence: "immediate" }
          })}\n`
        );
      }
    );

    expect(captured.exitCode).toBe(0);
    expect(captured.sessionEvents.length).toBeGreaterThanOrEqual(1);

    const firstParams = captured.sessionEvents[0]!.params as Record<string, unknown>;
    expect(typeof firstParams.type).toBe("string");
    expect(typeof firstParams.eventId).toBe("string");
    expect(typeof firstParams.timestamp).toBe("number");
    expect(typeof firstParams.sessionId).toBe("string");

    const rec = new OcelRecorder(APP_SERVER_SOURCE, ocelDir);
    rec.write(captured.lines.join("\n") + "\n");
    const out = rec.finish();

    const doc = JSON.parse(readFileSync(out.ocelPath, "utf8")) as OcelDoc;
    const receipt = JSON.parse(readFileSync(out.receiptPath, "utf8")) as Record<string, unknown>;
    expect(ocelProblems(doc)).toEqual([]);
    expect(verifyChain(doc, "sha256")).toBeNull();
    expect(out.events).toBeGreaterThanOrEqual(1);
    expect(receipt.source).toBe(APP_SERVER_SOURCE);
    expect(receipt.chain_intact).toBe(true);
    expect(receipt.receipt_chain_intact).toBe(true);
    expect((receipt.chain as { standing: string }[]).at(-1)?.standing).toBe("alive");
  }, 25_000);
});

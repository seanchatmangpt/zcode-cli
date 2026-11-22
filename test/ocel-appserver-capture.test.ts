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
    const parsedLines = lines.map((l) => JSON.parse(l) as Record<string, any>);
    const sessionEventLines = parsedLines.filter((m) => m.method === "session/event");
    const computerUseLines = parsedLines.filter((m) => m.method === "computer-use/operation-event");
    // Explicit accounting: 10 session/event lines + 2 computer-use/operation-event lines (explicitly pi:Unmapped in ontology)
    expect(sessionEventLines.length).toBe(10);
    expect(computerUseLines.length).toBe(2);
    expect(doc.events.length).toBe(sessionEventLines.length);
    const ttl = ontologyText();
    expect(ttl).toContain('zl:Unmapped-App-computerUse-operationEvent a pi:Unmapped');
    expect(ttl).toContain('pi:sourceEvent "computer-use/operation-event"');
    expect(ttl).toContain('pi:unmappedReason');

    const objTypes = new Set(doc.objects.map((o) => o.type));
    expect(objTypes.has("session")).toBe(true);
    expect(objTypes.has("turn")).toBe(true);
    expect(objTypes.has("tool_call")).toBe(true);
    const qualifiers = new Set(doc.events.flatMap((e) => e.relationships.map((r) => r.qualifier)));
    expect(qualifiers.has("about_tool_call")).toBe(true);

    // Batch tool.updated events (kind: "batch") carry params.payload.toolCallIds
    const batchLines = sessionEventLines.filter(
      (m) => m.params?.type === "tool.updated" && m.params?.payload?.kind === "batch"
    );
    expect(batchLines.length).toBe(2);
    const hasBatchRule = RULES.some(
      (r) => r.source === APP_SERVER_SOURCE && r.event === "tool.updated" && r.path === "params.payload.toolCallIds"
    );
    if (hasBatchRule) {
      for (const batchLine of batchLines) {
        const ev = doc.events.find((e) => e.id === batchLine.params.eventId);
        expect(ev).toBeDefined();
        const linkedToolCalls = ev!.relationships
          .filter((r) => r.qualifier === "about_tool_call")
          .map((r) => r.objectId);
        for (const id of batchLine.params.payload.toolCallIds as string[]) {
          expect(linkedToolCalls).toContain(id);
        }
      }
    }
  });

  test("ontology declares batch toolCallIds relations, distinct user_input object type, and explicit computer-use/operation-event unmapped policy", () => {
    const ttl = ontologyText();
    // 1. Batch tool.updated relations
    expect(ttl).toContain(
      'zl:Rel-Stream-tool_call_batch a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-tool_call ; pi:hasQualifier zl:Qualifier-about_tool_call ; pi:objectIdPath "payload.toolCallIds" .'
    );
    expect(ttl).toContain(
      'zl:Rel-App-tool_call_batch a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-tool_call ; pi:hasQualifier zl:Qualifier-about_tool_call ; pi:objectIdPath "params.payload.toolCallIds" .'
    );
    expect(ttl).toMatch(/zl:Rule-Stream-tool-updated[\s\S]*?zl:Rel-Stream-tool_call_batch/);
    expect(ttl).toMatch(/zl:Rule-App-tool-updated[\s\S]*?zl:Rel-App-tool_call_batch/);

    // 2. Distinct user_input object type & qualifier (not conflated with permission)
    expect(ttl).toContain('zl:ObjectType-user_input a pi:ObjectType ; pi:typeId "user_input" .');
    expect(ttl).toContain('zl:Qualifier-about_user_input a pi:Qualifier ; pi:qualifierId "about_user_input" .');
    expect(ttl).toContain(
      'zl:Rel-Stream-user_input a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-user_input ; pi:hasQualifier zl:Qualifier-about_user_input ; pi:objectIdPath "payload.requestId" .'
    );
    expect(ttl).toContain(
      'zl:Rel-App-user_input a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-user_input ; pi:hasQualifier zl:Qualifier-about_user_input ; pi:objectIdPath "params.payload.requestId" .'
    );
    expect(ttl).toMatch(/zl:Rule-Stream-userInput-requested[\s\S]*?zl:Rel-Stream-user_input/);
    expect(ttl).toMatch(/zl:Rule-Stream-userInput-resolved[\s\S]*?zl:Rel-Stream-user_input/);
    expect(ttl).toMatch(/zl:Rule-App-userInput-requested[\s\S]*?zl:Rel-App-user_input/);
    expect(ttl).toMatch(/zl:Rule-App-userInput-resolved[\s\S]*?zl:Rel-App-user_input/);

    // Runtime verification when generated RULES include user_input binding
    const hasUserInputRule = RULES.some(
      (r) => r.source === APP_SERVER_SOURCE && r.event === "userInput.requested" && r.qualifier === "about_user_input"
    );
    if (hasUserInputRule) {
      const outDir = makeTempDir("zcode-appserver-userinput-");
      const rec = new OcelRecorder(APP_SERVER_SOURCE, outDir);
      rec.write(
        `${JSON.stringify({
          method: "session/event",
          params: {
            type: "userInput.requested",
            eventId: "ev-ui-1",
            timestamp: 1790030095000,
            sessionId: "sess-ui-1",
            turnId: "turn-ui-1",
            payload: { requestId: "req-ui-1" }
          }
        })}\n` +
          `${JSON.stringify({
            method: "session/event",
            params: {
              type: "userInput.resolved",
              eventId: "ev-ui-2",
              timestamp: 1790030096000,
              sessionId: "sess-ui-1",
              turnId: "turn-ui-1",
              payload: { requestId: "req-ui-1" }
            }
          })}\n`
      );
      const res = rec.finish();
      const doc = JSON.parse(readFileSync(res.ocelPath, "utf8")) as OcelDoc;
      expect(ocelProblems(doc)).toEqual([]);
      for (const ev of doc.events) {
        const quals = ev.relationships.map((r) => r.qualifier);
        expect(quals).toContain("about_user_input");
        expect(quals).not.toContain("about_permission");
      }
      expect(doc.objects.some((o) => o.type === "user_input" && o.id === "req-ui-1")).toBe(true);
    }
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
    const expectedEvents = captured.sessionEvents.filter((m) => m.params?.type !== "part.delta");
    expect(out.events).toBe(expectedEvents.length);
    const objByKey = new Set(doc.objects.map((o) => `${o.type}:${o.id}`));
    const relsByQualifier = (q: string) =>
      new Set(doc.events.flatMap((e) => e.relationships.filter((r) => r.qualifier === q).map((r) => r.objectId)));
    const inSessionIds = relsByQualifier("in_session");
    const inTurnIds = relsByQualifier("in_turn");
    for (const m of expectedEvents) {
      if (typeof m.params?.sessionId === "string") {
        expect(objByKey.has(`session:${m.params.sessionId}`)).toBe(true);
        expect(inSessionIds.has(m.params.sessionId)).toBe(true);
      }
      if (typeof m.params?.turnId === "string") {
        expect(objByKey.has(`turn:${m.params.turnId}`)).toBe(true);
        expect(inTurnIds.has(m.params.turnId)).toBe(true);
      }
    }
    expect(receipt.source).toBe(APP_SERVER_SOURCE);
    expect(receipt.chain_intact).toBe(true);
    expect(receipt.receipt_chain_intact).toBe(true);
    expect((receipt.chain as { standing: string }[]).at(-1)?.standing).toBe("alive");
  }, 25_000);
});

import { describe, expect, test } from "bun:test";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ComplianceRefusalError, parseComplianceConfigToml } from "../src/compliance/config.ts";
import {
  AppendableOcel2SqliteSink,
  enforceRetentionPolicy,
  readOcel2Sqlite,
  writeOcel2Sqlite
} from "../src/compliance/ocel-sqlite.ts";
import {
  CANONICAL_O2O_EDGES,
  Ocel2ComplianceBuilder,
  complianceTapEnabled,
  serializeOcel2Xml,
  upgradeLegacyOcelToOcel2,
  validateOcel2,
  type Ocel2Document
} from "../src/compliance/ocel2.ts";
import { containsUnredactedSecretsOrPii } from "../src/compliance/redactor.ts";
import { verifyChain, type OcelDoc } from "../src/generated/ocel.ts";
import { startOcelTap } from "../src/ocel-tap.ts";
import { executePowlWithTokenReplay, type PowlNode } from "../src/powl-ocel-orchestrator.ts";
import { fixtures } from "./support/ocel.ts";

function runRealSubprocess(
  cmd: string,
  args: string[]
): Promise<{ ok: boolean; exitCode: number; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore kill error if already exited
      }
      resolve({ ok: false, exitCode: 1, detail: "subprocess timed out after 20000ms" });
    }, 20_000);
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code ?? 1, detail: stderr.trim() || undefined });
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, exitCode: 1, detail: err.message });
    });
  });
}

describe("F05: Unified IEEE OCEL 2.0 metamodel, O2O graph, redaction & validation", () => {
  test("upgrades real legacy OcelRecorder output from turn-tool fixture with inferred O2O & intact SHA-256 chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-ocel2-legacy-"));
    try {
      const fx = fixtures().find((f) => f.name === "turn-tool.ndjson") ?? fixtures()[0]!;
      const rec = startOcelTap(["-p", "hi", "--output-format", "stream-json"], {
        ZCODE_OCEL: "1",
        ZCODE_OCEL_DIR: dir
      })!;
      rec.write(fx.lines.join("\n") + "\n");
      const out = rec.finish();
      const legacyDoc = JSON.parse(readFileSync(out.ocelPath, "utf8")) as OcelDoc;

      const upgraded = upgradeLegacyOcelToOcel2(legacyDoc, {
        sessionId: out.sessionId,
        providerId: "zai",
        modelId: "glm-5.3",
        overseerId: "overseer-alice",
        profile: "high-risk-annex-iii"
      });

      const validation = validateOcel2(upgraded, {
        requireHashChain: true,
        requireAttrHash: true,
        requireRedacted: true
      });
      expect(validation.ok).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(verifyChain(upgraded as unknown as OcelDoc, "sha256")).toBeNull();
      expect(upgraded.events.length).toBe(legacyDoc.events.length);

      // Inferred O2O: turn -[in_session]-> session and tool_call -[in_turn]-> turn
      const turns = upgraded.objects.filter((o) => o.type === "turn");
      if (turns.length > 0) {
        expect(
          turns.some((t) =>
            t.relationships.some((r) => r.qualifier === "in_session" && r.objectId === out.sessionId)
          )
        ).toBe(true);
      }
      const overseers = upgraded.objects.filter((o) => o.type === "human_overseer");
      expect(overseers.length).toBe(1);
      expect(
        overseers[0]!.relationships.some(
          (r) => r.qualifier === "governs" && r.objectId === out.sessionId
        )
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upgrades real POWL executePowlWithTokenReplay Ocel2Log into hash-chained Ocel2Document", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "zcode-ocel2-powl-"));
    try {
      const powl: PowlNode = {
        kind: "partial_order",
        id: "m2-powl-upgrade",
        children: [
          { kind: "activity", id: "version", label: "zcode --version", objectType: "Artifact" },
          { kind: "activity", id: "help", label: "zcode --help", objectType: "Artifact" }
        ],
        order: [["version", "help"]]
      };
      const zcodeBin = join(process.cwd(), "bin", "zcode.js");
      const res = await executePowlWithTokenReplay(
        powl,
        async (t) =>
          runRealSubprocess(process.execPath, [
            zcodeBin,
            t.activityId === "version" ? "--version" : "--help"
          ]),
        { outputDir: outDir }
      );
      expect(res.replay.soundTermination).toBe(true);

      const upgraded = upgradeLegacyOcelToOcel2(res.ocel);
      const check = validateOcel2(upgraded, {
        requireHashChain: true,
        requireAttrHash: true
      });
      expect(check.ok).toBe(true);
      expect(verifyChain(upgraded as unknown as OcelDoc, "sha256")).toBeNull();
      expect(upgraded.objects.some((o) => o.type === "Workflow")).toBe(true);
      expect(upgraded.objects.some((o) => o.type === "Artifact")).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);

  test("Ocel2ComplianceBuilder constructs full 8-edge O2O graph, redacts before hashing, and rejects tampering", () => {
    expect(CANONICAL_O2O_EDGES).toHaveLength(8);
    const builder = new Ocel2ComplianceBuilder({
      redactOptions: { redactPii: true }
    });

    builder
      .upsertObject("sess_01", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("turn_01", "turn", { standing: "RUNNING" }, "2026-08-02T10:00:01.000Z")
      .setObjectAttribute("turn_01", "standing", "ALIVE", "2026-08-02T10:00:05.000Z")
      .upsertObject("tool_01", "tool_call", { tool_name: "Write" }, "2026-08-02T10:00:02.000Z")
      .upsertObject("req_01", "model_request", { model_id: "glm-5.3" }, "2026-08-02T10:00:02.100Z")
      .upsertObject("prov_zai", "provider", { provider_id: "zai" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("sub_01", "subagent", { agent_id: "worker_1" }, "2026-08-02T10:00:02.500Z")
      .upsertObject("perm_01", "permission", { decision: "allow" }, "2026-08-02T10:00:01.800Z")
      .upsertObject("file_01", "workspace_file", { path: "/Users/alice/repo/app.ts" }, "2026-08-02T10:00:03.000Z")
      .upsertObject("rcpt_01", "receipt", { standing: "ALIVE" }, "2026-08-02T10:00:05.500Z")
      .upsertObject("overseer_01", "human_overseer", { overseer_id: "alice@example.eu" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("model_01", "ai_model", { model_id: "glm-5.3" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("disc_01", "disclosure", { article: "50(1)" }, "2026-08-02T10:00:00.100Z")
      .upsertObject("inc_01", "incident", { severity: "low" }, "2026-08-02T10:00:04.000Z")
      .linkTurnToSession("turn_01", "sess_01")
      .linkToolCallToTurn("tool_01", "turn_01")
      .linkModelRequestToTurn("req_01", "turn_01")
      .linkModelRequestToProvider("req_01", "prov_zai")
      .linkSubagentToSession("sub_01", "sess_01")
      .linkPermissionToToolCall("perm_01", "tool_01")
      .linkFileMutatedInTurn("file_01", "turn_01")
      .linkReceiptSealsSession("rcpt_01", "sess_01");

    builder.recordEvent({
      id: "ev_1",
      type: "art50_disclosure_emitted",
      time: "2026-08-02T10:00:00.100Z",
      attributes: {
        provider_id: "zai",
        api_key: "sk-live-secret-999999",
        operator_email: "alice@example.eu",
        home_path: "/Users/alice/project/src/a.ts",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      },
      relationships: [
        { objectId: "sess_01", qualifier: "in_session" },
        { objectId: "disc_01", qualifier: "about_disclosure" }
      ]
    });

    builder.recordEvent({
      id: "ev_2",
      type: "policy_refused",
      time: "2026-08-02T10:00:03.500Z",
      attributes: { code: "OVERSIGHT_POLICY_REFUSED", reason: "yolo forbidden" },
      relationships: [{ objectId: "sess_01", qualifier: "in_session" }]
    });

    builder.recordEvent({
      id: "ev_3",
      type: "drift_detected",
      time: "2026-08-02T10:00:04.100Z",
      attributes: { drift_kind: "sudden", p_value: "0.002" },
      relationships: [
        { objectId: "sess_01", qualifier: "in_session" },
        { objectId: "inc_01", qualifier: "about_incident" }
      ]
    });

    builder.recordEvent({
      id: "ev_4",
      type: "incident_reported",
      time: "2026-08-02T10:00:04.200Z",
      attributes: { severity: "low", deadline: "15d" },
      relationships: [{ objectId: "inc_01", qualifier: "about_incident" }]
    });

    builder.recordEvent({
      id: "ev_5",
      type: "workspace_rolled_back",
      time: "2026-08-02T10:00:04.500Z",
      attributes: { reason: "dirty_timeout" },
      relationships: [{ objectId: "file_01", qualifier: "mutated_in" }]
    });

    const sealed = builder.seal("sess_01");
    expect(sealed.headHash).toMatch(/^[a-f0-9]{64}$/);
    expect(containsUnredactedSecretsOrPii(JSON.stringify(sealed.doc))).toBe(false);
    expect(
      validateOcel2(sealed.doc, {
        requireHashChain: true,
        requireAttrHash: true,
        requireRedacted: true
      }).ok
    ).toBe(true);
    expect(verifyChain(sealed.doc as unknown as OcelDoc, "sha256")).toBeNull();

    // Anti-vacuity: tampering with a non-pi event attribute must be caught by pi_attr_sha256
    const attrTampered: Ocel2Document = structuredClone(sealed.doc);
    const ev2Reason = attrTampered.events[1]!.attributes.find((a) => a.name === "reason")!;
    ev2Reason.value = "tampered";
    const attrCheck = validateOcel2(attrTampered, { requireHashChain: true, requireAttrHash: true });
    expect(attrCheck.ok).toBe(false);
    expect(attrCheck.errors.some((e) => e.includes("Attribute digest mismatch"))).toBe(true);

    // Anti-vacuity: non-monotonic dynamic object attribute timestamp must fail validateOcel2
    const nonMonoDoc: Ocel2Document = structuredClone(sealed.doc);
    nonMonoDoc.objects
      .find((o) => o.id === "turn_01")!
      .attributes.push({ name: "standing", time: "2026-08-02T09:59:59.000Z", value: "REVERTED" });
    const monoCheck = validateOcel2(nonMonoDoc);
    expect(monoCheck.ok).toBe(false);
    expect(monoCheck.errors.some((e) => e.includes("non-monotonic timestamp"))).toBe(true);
  });

  test("serializes valid IEEE OCEL 2.0 XML with escaping and fails closed on invalid docs", () => {
    const builder = new Ocel2ComplianceBuilder();
    builder.upsertObject("sess_<1>", "session", { note: 'a & b "quoted" <tag>' }, "2026-08-02T10:00:00.000Z");
    builder.recordEvent({
      id: "ev_xml_1",
      type: "session_created",
      time: "2026-08-02T10:00:00.000Z",
      attributes: { msg: "x < y & z > w" },
      relationships: [{ objectId: "sess_<1>", qualifier: "in_session" }]
    });
    const xml = serializeOcel2Xml(builder.build());
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<object-types>");
    expect(xml).toContain("<event-types>");
    expect(xml).toContain('id="sess_&lt;1&gt;"');
    expect(xml).toContain("a &amp; b &quot;quoted&quot; &lt;tag&gt;");
    expect(xml).toContain("x &lt; y &amp; z &gt; w");

    const invalid = builder.build();
    invalid.events[0]!.time = "not-a-timestamp";
    expect(() => serializeOcel2Xml(invalid)).toThrow(ComplianceRefusalError);
  });

  test("complianceTapEnabled preserves {} === false and honors profile/env flags", () => {
    expect(complianceTapEnabled({})).toBe(false);
    expect(complianceTapEnabled({ ZCODE_OCEL: "1" })).toBe(true);
    expect(complianceTapEnabled({ ZCODE_COMPLIANCE_LOG: "1" })).toBe(true);
    expect(complianceTapEnabled({ ZCODE_COMPLIANCE_LOG: "0", ZCODE_OCEL: "1" })).toBe(false);
    expect(complianceTapEnabled({ ZCODE_COMPLIANCE_PROFILE: "high-risk-annex-iii" })).toBe(true);

    const stdCfg = parseComplianceConfigToml('[compliance]\nprofile = "standard"\n', { env: {} });
    const regCfg = parseComplianceConfigToml('[compliance]\nprofile = "art50-only"\n', { env: {} });
    expect(complianceTapEnabled({}, stdCfg)).toBe(false);
    expect(complianceTapEnabled({}, regCfg)).toBe(true);
    expect(complianceTapEnabled({ ZCODE_COMPLIANCE_LOG: "0" }, regCfg)).toBe(false);
  });
});

describe("F06: IEEE OCEL 2.0 SQLite WAL storage, lossless round-trip & Art. 12 retention", () => {
  test("writeOcel2Sqlite creates standard IEEE OCEL 2.0 tables and readOcel2Sqlite round-trips losslessly", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-ocel-sqlite-"));
    try {
      const builder = new Ocel2ComplianceBuilder();
      builder
        .upsertObject("sess_sql_1", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z")
        .upsertObject("turn_sql_1", "turn", { standing: "RUNNING" }, "2026-08-02T10:00:01.000Z")
        .setObjectAttribute("turn_sql_1", "standing", "ALIVE", "2026-08-02T10:00:03.000Z")
        .linkTurnToSession("turn_sql_1", "sess_sql_1");

      builder.recordEvent({
        id: "ev_sql_1",
        type: "turn_started",
        time: "2026-08-02T10:00:01.000Z",
        attributes: { empty_val: "", custom_note: "ok" },
        relationships: [
          { objectId: "sess_sql_1", qualifier: "in_session" },
          { objectId: "turn_sql_1", qualifier: "in_turn" }
        ]
      });
      builder.recordEvent({
        id: "ev_sql_2",
        type: "turn_completed",
        time: "2026-08-02T10:00:03.000Z",
        attributes: { fitness: "1.0" },
        relationships: [
          { objectId: "sess_sql_1", qualifier: "in_session" },
          { objectId: "turn_sql_1", qualifier: "in_turn" }
        ]
      });

      const doc = builder.build();
      const dbPath = join(dir, "session.sqlite");
      writeOcel2Sqlite(doc, dbPath);

      // Inspect standard IEEE OCEL 2.0 tables directly via node:sqlite DatabaseSync
      const rawDb = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const tables = (
          rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<
            Record<string, unknown>
          >
        ).map((r) => String(r["name"]));

        for (const req of [
          "event",
          "object",
          "event_object",
          "object_object",
          "event_map_type",
          "object_map_type",
          "event_turn_started",
          "event_turn_completed",
          "object_turn",
          "object_session"
        ]) {
          expect(tables).toContain(req);
        }
      } finally {
        rawDb.close();
      }

      const roundTripped = readOcel2Sqlite(dbPath);
      expect(roundTripped).toEqual(doc);
      expect(
        validateOcel2(roundTripped, { requireHashChain: true, requireAttrHash: true }).ok
      ).toBe(true);
      expect(verifyChain(roundTripped as unknown as OcelDoc, "sha256")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AppendableOcel2SqliteSink supports WAL incremental append, dynamic column evolution & Node >=22 interoperability", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-ocel-wal-"));
    const dbPath = join(dir, "appendable.sqlite");
    try {
      const sink = new AppendableOcel2SqliteSink(dbPath);
      try {
        const b1 = new Ocel2ComplianceBuilder();
        b1.upsertObject("sess_w", "session", { compliance_profile: "art50-only" }, "2026-08-02T11:00:00.000Z");
        b1.recordEvent({
          id: "ev_w1",
          type: "session_created",
          time: "2026-08-02T11:00:00.000Z",
          attributes: { phase_one: "yes" },
          relationships: [{ objectId: "sess_w", qualifier: "in_session" }]
        });
        sink.appendDocument(b1.build());

        // Incremental event introducing a brand-new column on the same event type (ALTER TABLE ADD COLUMN)
        sink.appendEvent({
          id: "ev_w2",
          type: "session_created",
          time: "2026-08-02T11:00:01.000Z",
          attributes: [{ name: "late_dynamic_col", value: "added_via_alter" }],
          relationships: [{ objectId: "sess_w", qualifier: "in_session" }]
        });

        // Verify live WAL mode without forcing close
        const liveDoc = sink.readDocument();
        expect(liveDoc.events.map((e) => e.id)).toEqual(["ev_w1", "ev_w2"]);
        expect(
          liveDoc.events[1]!.attributes.find((a) => a.name === "late_dynamic_col")?.value
        ).toBe("added_via_alter");
      } finally {
        sink.close();
      }

      // Cross-runtime Node v22+ node:sqlite interoperability check
      const nodeRes = spawnSync(
        "node",
        [
          "--no-warnings",
          "-e",
          `import { DatabaseSync } from "node:sqlite";
           const db = new DatabaseSync(${JSON.stringify(dbPath)});
           const jm = db.prepare("PRAGMA journal_mode").get();
           const rows = db.prepare("SELECT ocel_id FROM event ORDER BY rowid ASC").all();
           console.log(JSON.stringify({ journal_mode: jm.journal_mode, ids: rows.map(r => r.ocel_id) }));
           db.close();`
        ],
        { encoding: "utf8", timeout: 15_000 }
      );
      expect(nodeRes.status).toBe(0);
      const parsed = JSON.parse(nodeRes.stdout.trim()) as { journal_mode: string; ids: string[] };
      expect(parsed.journal_mode).toBe("wal");
      expect(parsed.ids).toEqual(["ev_w1", "ev_w2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25_000);

  test("enforceRetentionPolicy enforces >=180d floor, retains recent artifacts, purges expired, and fails closed when unwritable", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-retention-"));
    try {
      // Refuse < 180 days
      let err179: unknown;
      try {
        enforceRetentionPolicy(dir, 179);
      } catch (e) {
        err179 = e;
      }
      expect(err179).toBeInstanceOf(ComplianceRefusalError);
      expect((err179 as ComplianceRefusalError).code).toBe("LOGGING_UNAVAILABLE");
      expect((err179 as ComplianceRefusalError).exitCode).toBe(2);

      // Refuse sink with minRetentionDays < 180
      expect(() => new AppendableOcel2SqliteSink(join(dir, "bad.sqlite"), { minRetentionDays: 90 })).toThrow(
        ComplianceRefusalError
      );

      const nowMs = Date.parse("2026-10-01T00:00:00.000Z");
      const dayMs = 86_400_000;

      const freshFile = join(dir, "fresh.jsonocel");
      const borderlineFile = join(dir, "day179.receipt.json");
      const expiredSql = join(dir, "old.sqlite");
      const expiredWal = join(dir, "old.sqlite-wal");

      writeFileSync(freshFile, "{}", "utf8");
      writeFileSync(borderlineFile, "{}", "utf8");
      writeFileSync(expiredSql, "sqlite", "utf8");
      writeFileSync(expiredWal, "wal", "utf8");

      utimesSync(freshFile, new Date(nowMs - 10 * dayMs), new Date(nowMs - 10 * dayMs));
      utimesSync(borderlineFile, new Date(nowMs - 179 * dayMs), new Date(nowMs - 179 * dayMs));
      utimesSync(expiredSql, new Date(nowMs - 181 * dayMs), new Date(nowMs - 181 * dayMs));
      utimesSync(expiredWal, new Date(nowMs - 181 * dayMs), new Date(nowMs - 181 * dayMs));

      const res = enforceRetentionPolicy(dir, 180, { nowMs });
      expect(res.writable).toBe(true);
      expect(res.retained).toContain(freshFile);
      expect(res.retained).toContain(borderlineFile);
      expect(res.purged).toEqual([expiredSql]);
      expect(existsSync(freshFile)).toBe(true);
      expect(existsSync(borderlineFile)).toBe(true);
      expect(existsSync(expiredSql)).toBe(false);
      expect(existsSync(expiredWal)).toBe(false);

      // Fail closed when target path is blocked by a regular file (root-immune writability failure)
      const blockerFile = join(dir, "not-a-directory");
      writeFileSync(blockerFile, "blocker", "utf8");
      let fileErr: unknown;
      try {
        enforceRetentionPolicy(join(blockerFile, "nested"), 180);
      } catch (e) {
        fileErr = e;
      }
      expect(fileErr).toBeInstanceOf(ComplianceRefusalError);
      expect((fileErr as ComplianceRefusalError).code).toBe("LOGGING_UNAVAILABLE");

      // Also test chmod 0o555 when running non-root
      if (typeof process.getuid === "function" && process.getuid() !== 0) {
        const roDir = join(dir, "readonly-dir");
        mkdtempSync(join(dir, "ro-tmp-"));
        writeFileSync(join(dir, "ro-probe"), "x", "utf8");
        chmodSync(dir, 0o555);
        try {
          expect(() => enforceRetentionPolicy(dir, 180)).toThrow(ComplianceRefusalError);
          expect(() => writeOcel2Sqlite(new Ocel2ComplianceBuilder().build(), join(dir, "x.sqlite"))).toThrow(
            ComplianceRefusalError
          );
        } finally {
          chmodSync(dir, 0o755);
        }
        void roDir;
      }
    } finally {
      try {
        chmodSync(dir, 0o755);
      } catch {
        // ignore
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("regression (Iteration 2): upgradeLegacyOcelToOcel2 refuses tampered pi_attr_sha256 & pi_obj_sha256", () => {
    const builder = new Ocel2ComplianceBuilder();
    builder.upsertObject("sess_l1", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z");
    builder.recordEvent({
      id: "ev_l1",
      type: "policy_refused",
      time: "2026-08-02T10:00:01.000Z",
      attributes: { code: "OVERSIGHT_POLICY_REFUSED", reason: "yolo forbidden" },
      relationships: [{ objectId: "sess_l1", qualifier: "in_session" }]
    });
    const validDoc = builder.build();

    // Tamper event attribute without updating pi_attr_sha256
    const attrTampered = structuredClone(validDoc);
    attrTampered.events[0]!.attributes.find((a) => a.name === "reason")!.value = "TAMPERED_ALLOWED";
    expect(validateOcel2(attrTampered, { requireHashChain: true, requireAttrHash: true }).ok).toBe(false);

    let errAttr: unknown;
    try {
      upgradeLegacyOcelToOcel2(attrTampered);
    } catch (e) {
      errAttr = e;
    }
    expect(errAttr).toBeInstanceOf(ComplianceRefusalError);
    expect((errAttr as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");

    // Tamper object attribute without updating pi_obj_sha256
    const objTampered = structuredClone(validDoc);
    objTampered.objects[0]!.attributes[0]!.value = "standard";
    let errObj: unknown;
    try {
      upgradeLegacyOcelToOcel2(objTampered);
    } catch (e) {
      errObj = e;
    }
    expect(errObj).toBeInstanceOf(ComplianceRefusalError);
    expect((errObj as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
  });

  test("regression (Iteration 2): validateOcel2 detects O2O target hijacking, qualifier tampering & object attribute tampering", () => {
    const builder = new Ocel2ComplianceBuilder();
    builder
      .upsertObject("sess_1", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("sess_2", "session", { compliance_profile: "standard" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("turn_1", "turn", { standing: "ALIVE" }, "2026-08-02T10:00:01.000Z")
      .upsertObject("prov_1", "provider", { provider_id: "zai" }, "2026-08-02T10:00:00.000Z")
      .linkTurnToSession("turn_1", "sess_1");
    builder.recordEvent({
      id: "ev_o2o",
      type: "turn_completed",
      time: "2026-08-02T10:00:02.000Z",
      attributes: { fitness: "1.0" },
      relationships: [{ objectId: "sess_1", qualifier: "in_session" }]
    });
    const sealed = builder.build();
    expect(validateOcel2(sealed, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok).toBe(true);

    // 1. O2O target hijacked to wrong-type existing object (turn -[in_session]-> provider)
    const wrongTypeTarget = structuredClone(sealed);
    wrongTypeTarget.objects.find((o) => o.id === "turn_1")!.relationships[0]!.objectId = "prov_1";
    const rWrongType = validateOcel2(wrongTypeTarget, { requireHashChain: true, requireAttrHash: true });
    expect(rWrongType.ok).toBe(false);
    expect(rWrongType.errors.some((e) => e.includes("invalid O2O edge"))).toBe(true);
    expect(rWrongType.errors.some((e) => e.includes("Object graph digest mismatch"))).toBe(true);

    // 2. O2O target hijacked to same-type existing object (turn -[in_session]-> sess_2)
    const sameTypeHijack = structuredClone(sealed);
    sameTypeHijack.objects.find((o) => o.id === "turn_1")!.relationships[0]!.objectId = "sess_2";
    const rSameType = validateOcel2(sameTypeHijack, { requireHashChain: true, requireAttrHash: true });
    expect(rSameType.ok).toBe(false);
    expect(rSameType.errors.some((e) => e.includes("Object graph digest mismatch"))).toBe(true);

    // 3. O2O qualifier tampered
    const qualTampered = structuredClone(sealed);
    qualTampered.objects.find((o) => o.id === "turn_1")!.relationships[0]!.qualifier = "tampered_qual";
    const rQual = validateOcel2(qualTampered, { requireHashChain: true, requireAttrHash: true });
    expect(rQual.ok).toBe(false);
    expect(rQual.errors.some((e) => e.includes("Object graph digest mismatch"))).toBe(true);

    // 4. Object attribute value tampered
    const objAttrTampered = structuredClone(sealed);
    objAttrTampered.objects.find((o) => o.id === "turn_1")!.attributes[0]!.value = "TAMPERED";
    const rObjVal = validateOcel2(objAttrTampered, { requireHashChain: true, requireAttrHash: true });
    expect(rObjVal.ok).toBe(false);
    expect(rObjVal.errors.some((e) => e.includes("Object graph digest mismatch"))).toBe(true);
  });

  test("regression (Iteration 2): qualifier PII redaction, __proto__ preservation, duplicate array attrs & XML control char stripping", () => {
    const builder = new Ocel2ComplianceBuilder({ redactOptions: { redactPii: true } });
    builder
      .upsertObject("sess_p", "session", undefined, "2026-08-02T10:00:00.000Z")
      .upsertObject("turn_p", "turn", undefined, "2026-08-02T10:00:00.000Z")
      .addO2O("turn_p", "rel_alice@example.eu", "sess_p");

    const ev = builder.recordEvent({
      id: "ev_proto_dup",
      type: "session_created",
      time: "2026-08-02T10:00:01.000Z",
      attributes: [
        { name: "__proto__", value: "alice@example.eu" },
        { name: "dup", value: "first" },
        { name: "dup", value: "second" },
        { name: "ctrl", value: "abc\u0000\u0001\u0007\u000B\u000C\u001F\uFFFE\uFFFFxyz" }
      ],
      relationships: [{ objectId: "sess_p", qualifier: "owner_bob@example.eu" }]
    });

    const doc = builder.build();
    expect(containsUnredactedSecretsOrPii(JSON.stringify(doc))).toBe(false);
    expect(validateOcel2(doc, { requireHashChain: true, requireAttrHash: true, requireRedacted: true }).ok).toBe(true);

    const protoAttr = ev.attributes.find((a) => a.name === "__proto__");
    expect(protoAttr?.value).toBe("REDACTED");
    const dupAttrs = ev.attributes.filter((a) => a.name === "dup").map((a) => a.value);
    expect(dupAttrs).toEqual(["first", "second"]);

    const xml = serializeOcel2Xml(doc);
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
    expect(xml).toContain("abcxyz");

    // Verify with Python XML 1.0 parser if python3 is present
    const pyCheck = spawnSync("python3", ["-c", "import sys, xml.etree.ElementTree as ET; ET.fromstring(sys.stdin.read()); print('XML_OK')"], {
      input: xml,
      encoding: "utf8",
      timeout: 15_000
    });
    if (pyCheck.status === 0) {
      expect(pyCheck.stdout.trim()).toBe("XML_OK");
    }
  }, 25_000);

  test("regression (Iteration 2): writeOcel2Sqlite defaults to WAL readable via { readonly: true }, handles case-insensitive column collisions, dynamic meta & WAL retention mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-sqlite-reg-"));
    try {
      const builder = new Ocel2ComplianceBuilder({ allowCustomTypes: true });
      builder.upsertObject(
        "obj_col_1",
        "session",
        [
          { name: "OCEL_ID", time: "2026-08-02T10:00:00.000Z", value: "custom-ocel-id" },
          { name: "Status", time: "2026-08-02T10:00:00.000Z", value: "Upper" },
          { name: "status", time: "2026-08-02T10:00:01.000Z", value: "lower" }
        ],
        "2026-08-02T10:00:00.000Z"
      );
      builder.recordEvent({
        id: "ev_col_1",
        type: "session_created",
        time: "2026-08-02T10:00:02.000Z",
        attributes: {
          OCEL_ID: "attr-ocel-id",
          Ocel_Time: "attr-ocel-time",
          Status: "Upper",
          status: "lower"
        },
        relationships: [{ objectId: "obj_col_1", qualifier: "in_session" }]
      });
      const doc = builder.build();
      const dbPath = join(dir, "collisions.sqlite");
      writeOcel2Sqlite(doc, dbPath);

      // Verify WAL mode via both bun:sqlite { readonly: true } and node:sqlite { readOnly: true }
      const bunDb = new BunSqliteDatabase(dbPath, { readonly: true });
      try {
        const mode = bunDb.query("PRAGMA journal_mode;").get() as { journal_mode?: string };
        expect((mode?.journal_mode ?? "").toLowerCase()).toBe("wal");
      } finally {
        bunDb.close();
      }
      const nodeDb = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const mode = nodeDb.prepare("PRAGMA journal_mode;").get() as Record<string, unknown>;
        expect(String(mode["journal_mode"] ?? "").toLowerCase()).toBe("wal");
      } finally {
        nodeDb.close();
      }

      // Lossless round-trip restoring exact original case-colliding attribute names
      const roundTripped = readOcel2Sqlite(dbPath);
      expect(roundTripped).toEqual(doc);

      // AppendableOcel2SqliteSink records late dynamic columns in zcode_ocel_attr_meta
      const sinkPath = join(dir, "sink-meta.sqlite");
      const sink = new AppendableOcel2SqliteSink(sinkPath);
      try {
        sink.appendDocument(doc);
        sink.appendEvent({
          id: "ev_col_2",
          type: "session_created",
          time: "2026-08-02T10:00:03.000Z",
          attributes: [{ name: "late_dynamic_col", value: "v2" }],
          relationships: [{ objectId: "obj_col_1", qualifier: "in_session" }]
        });
        const live = sink.readDocument();
        const sessType = live.eventTypes.find((t) => t.name === "session_created")!;
        expect(sessType.attributes.some((a) => a.name === "late_dynamic_col")).toBe(true);
      } finally {
        sink.close();
      }

      // enforceRetentionPolicy retains base .sqlite when -wal is recent, and rejects NaN maxRetentionDays
      const retDir = join(dir, "retention-wal");
      const nowMs = Date.parse("2026-10-01T00:00:00.000Z");
      const dayMs = 86_400_000;
      const activeDb = join(retDir, "active.sqlite");
      const activeWal = join(retDir, "active.sqlite-wal");
      writeOcel2Sqlite(doc, activeDb);
      utimesSync(activeDb, new Date(nowMs - 181 * dayMs), new Date(nowMs - 181 * dayMs));
      utimesSync(activeWal, new Date(nowMs - 1 * dayMs), new Date(nowMs - 1 * dayMs));

      const retRes = enforceRetentionPolicy(retDir, 180, { nowMs });
      expect(retRes.retained).toContain(activeDb);
      expect(retRes.purged).toEqual([]);
      expect(existsSync(activeDb)).toBe(true);
      expect(existsSync(activeWal)).toBe(true);

      expect(() => enforceRetentionPolicy(retDir, 180, { maxRetentionDays: Number.NaN })).toThrow(
        ComplianceRefusalError
      );
      expect(() => enforceRetentionPolicy(retDir, 180, { maxRetentionDays: 90 })).toThrow(
        ComplianceRefusalError
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("regression (Iteration 3): upgradeLegacyOcelToOcel2 refuses partial-seal stripping (Variants A/B/C)", () => {
    const builder = new Ocel2ComplianceBuilder();
    builder
      .upsertObject("sess_ps", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("turn_1", "turn", { standing: "ALIVE" }, "2026-08-02T10:00:01.000Z")
      .linkTurnToSession("turn_1", "sess_ps");
    builder.recordEvent({
      id: "ev_1",
      type: "turn_started",
      time: "2026-08-02T10:00:01.000Z",
      attributes: { step: "start" },
      relationships: [
        { objectId: "sess_ps", qualifier: "in_session" },
        { objectId: "turn_1", qualifier: "in_turn" }
      ]
    });
    builder.recordEvent({
      id: "ev_2",
      type: "turn_completed",
      time: "2026-08-02T10:00:02.000Z",
      attributes: { fitness: "1.0" },
      relationships: [
        { objectId: "sess_ps", qualifier: "in_session" },
        { objectId: "turn_1", qualifier: "in_turn" }
      ]
    });
    const valid = builder.build();
    expect(validateOcel2(valid, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok).toBe(true);

    const expectSealRefused = (tampered: Ocel2Document) => {
      let caught: unknown;
      try {
        upgradeLegacyOcelToOcel2(tampered);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ComplianceRefusalError);
      expect((caught as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
    };

    // Variant A: strip pi_obj_sha256 from ONLY last event (ev_2) + mutate object attribute
    const variantA = structuredClone(valid);
    variantA.events[1]!.attributes = variantA.events[1]!.attributes.filter((a) => a.name !== "pi_obj_sha256");
    variantA.objects.find((o) => o.id === "turn_1")!.attributes[0]!.value = "TAMPERED_OBJ";
    expect(validateOcel2(variantA, { requireObjHash: true }).ok).toBe(false);
    expectSealRefused(variantA);

    // Variant B: strip pi_attr_sha256 from ONLY ev_2 + mutate non-pi attribute
    const variantB = structuredClone(valid);
    variantB.events[1]!.attributes = variantB.events[1]!.attributes.filter((a) => a.name !== "pi_attr_sha256");
    variantB.events[1]!.attributes.find((a) => a.name === "fitness")!.value = "0.0";
    expect(validateOcel2(variantB, { requireAttrHash: true }).ok).toBe(false);
    expectSealRefused(variantB);

    // Variant C: corrupt pi_hash on ev_1 + strip pi_hash from ev_2
    const variantC = structuredClone(valid);
    variantC.events[0]!.attributes.find((a) => a.name === "pi_hash")!.value = "badhash";
    variantC.events[1]!.attributes = variantC.events[1]!.attributes.filter((a) => a.name !== "pi_hash");
    expectSealRefused(variantC);

    // Also refuse partial pi_parent / pi_hash_alg stripping
    const variantD = structuredClone(valid);
    variantD.events[1]!.attributes = variantD.events[1]!.attributes.filter((a) => a.name !== "pi_parent");
    expectSealRefused(variantD);
  });

  test("regression (Iteration 3): duplicate event array attributes round-trip losslessly through SQLite with intact pi_attr_sha256", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-sqlite-dup-"));
    try {
      const builder = new Ocel2ComplianceBuilder();
      builder.upsertObject("sess_dup", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z");
      builder.recordEvent({
        id: "ev_dup_1",
        type: "session_created",
        time: "2026-08-02T10:00:01.000Z",
        attributes: [
          { name: "dup", value: "first" },
          { name: "dup", value: "second" },
          { name: "note", value: "kept" }
        ],
        relationships: [{ objectId: "sess_dup", qualifier: "in_session" }]
      });
      builder.recordEvent({
        id: "ev_single_2",
        type: "session_updated",
        time: "2026-08-02T10:00:02.000Z",
        attributes: { single_key: "single_val" },
        relationships: [{ objectId: "sess_dup", qualifier: "in_session" }]
      });

      const doc = builder.build();
      expect(
        validateOcel2(doc, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok
      ).toBe(true);

      const dbPath = join(dir, "dup-attrs.sqlite");
      writeOcel2Sqlite(doc, dbPath);
      const rt = readOcel2Sqlite(dbPath);
      expect(rt).toEqual(doc);
      expect(
        validateOcel2(rt, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok
      ).toBe(true);
      expect(rt.events[0]!.attributes.filter((a) => a.name === "dup").map((a) => a.value)).toEqual([
        "first",
        "second"
      ]);

      // Standard non-duplicate documents leave zcode_ocel_event_attr_multi empty
      const cleanBuilder = new Ocel2ComplianceBuilder();
      cleanBuilder.upsertObject("sess_clean", "session", undefined, "2026-08-02T10:00:00.000Z");
      cleanBuilder.recordEvent({
        id: "ev_clean",
        type: "session_created",
        time: "2026-08-02T10:00:01.000Z",
        attributes: { single: "val" },
        relationships: [{ objectId: "sess_clean", qualifier: "in_session" }]
      });
      const cleanDb = join(dir, "clean.sqlite");
      writeOcel2Sqlite(cleanBuilder.build(), cleanDb);
      const rawClean = new DatabaseSync(cleanDb, { readOnly: true });
      try {
        const cnt = rawClean
          .prepare("SELECT COUNT(*) AS cnt FROM zcode_ocel_event_attr_multi")
          .get() as { cnt: number };
        expect(cnt.cnt).toBe(0);
      } finally {
        rawClean.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("regression (Iteration 4): refuse cross-dimension seal stripping, duplicate pi_* attributes & non-hex SHA-256 digests", () => {
    const builder = new Ocel2ComplianceBuilder();
    builder
      .upsertObject("sess_cross", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z")
      .upsertObject("turn_cross", "turn", { standing: "ALIVE" }, "2026-08-02T10:00:01.000Z")
      .linkTurnToSession("turn_cross", "sess_cross");
    builder.recordEvent({
      id: "ev_1",
      type: "turn_started",
      time: "2026-08-02T10:00:01.000Z",
      attributes: { step: "start" },
      relationships: [
        { objectId: "sess_cross", qualifier: "in_session" },
        { objectId: "turn_cross", qualifier: "in_turn" }
      ]
    });
    builder.recordEvent({
      id: "ev_2",
      type: "turn_completed",
      time: "2026-08-02T10:00:02.000Z",
      attributes: { fitness: "1.0" },
      relationships: [
        { objectId: "sess_cross", qualifier: "in_session" },
        { objectId: "turn_cross", qualifier: "in_turn" }
      ]
    });
    const valid = builder.build();

    const expectSealRefused = (tampered: Ocel2Document, rechain?: boolean) => {
      let caught: unknown;
      try {
        upgradeLegacyOcelToOcel2(tampered, rechain !== undefined ? { rechain } : undefined);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ComplianceRefusalError);
      expect((caught as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
    };

    // 1a. Cross-dimension strip: strip pi_attr_sha256 from ALL events while keeping pi_obj_sha256 + chain
    const stripAllAttr = structuredClone(valid);
    for (const ev of stripAllAttr.events) {
      ev.attributes = ev.attributes.filter((a) => a.name !== "pi_attr_sha256");
    }
    stripAllAttr.events[1]!.attributes.find((a) => a.name === "fitness")!.value = "TAMPERED_0.0";
    expect(validateOcel2(stripAllAttr).ok).toBe(false);
    expect(validateOcel2(stripAllAttr, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok).toBe(false);
    expectSealRefused(stripAllAttr);

    // 1b. Cross-dimension strip: strip pi_obj_sha256 from ALL events while keeping pi_attr_sha256 + chain
    const stripAllObj = structuredClone(valid);
    for (const ev of stripAllObj.events) {
      ev.attributes = ev.attributes.filter((a) => a.name !== "pi_obj_sha256");
    }
    stripAllObj.objects.find((o) => o.id === "turn_cross")!.attributes[0]!.value = "TAMPERED_OBJ";
    expect(validateOcel2(stripAllObj).ok).toBe(false);
    expectSealRefused(stripAllObj);

    // 1c. Cross-dimension strip: strip pi_hash/pi_parent/pi_hash_alg from ALL events while keeping pi_attr_sha256 + pi_obj_sha256
    const stripAllChain = structuredClone(valid);
    for (const ev of stripAllChain.events) {
      ev.attributes = ev.attributes.filter(
        (a) => a.name !== "pi_hash" && a.name !== "pi_parent" && a.name !== "pi_hash_alg"
      );
    }
    expect(validateOcel2(stripAllChain).ok).toBe(false);
    expectSealRefused(stripAllChain);

    // Explicit rechain: true on stripped document re-seals cleanly
    const rechained = upgradeLegacyOcelToOcel2(stripAllAttr, { rechain: true });
    expect(validateOcel2(rechained, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok).toBe(true);

    // 2a. Duplicate pi_attr_sha256 (H1: evil first, real second)
    const dupAttr = structuredClone(valid);
    const attrIdx = dupAttr.events[0]!.attributes.findIndex((a) => a.name === "pi_attr_sha256");
    dupAttr.events[0]!.attributes.splice(attrIdx, 0, { name: "pi_attr_sha256", value: "0".repeat(64) });
    expect(validateOcel2(dupAttr, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok).toBe(false);
    expectSealRefused(dupAttr);

    // 2b. Duplicate pi_hash (H4: real first, evil second)
    const dupHash = structuredClone(valid);
    const hashIdx = dupHash.events[0]!.attributes.findIndex((a) => a.name === "pi_hash");
    dupHash.events[0]!.attributes.splice(hashIdx + 1, 0, { name: "pi_hash", value: "0".repeat(64) });
    expect(validateOcel2(dupHash, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok).toBe(false);
    expectSealRefused(dupHash);
    expectSealRefused(dupHash, true);

    // 2c. Duplicate pi_obj_sha256 (H3)
    const dupObj = structuredClone(valid);
    dupObj.events[0]!.attributes.push({ name: "pi_obj_sha256", value: "0".repeat(64) });
    expect(validateOcel2(dupObj).ok).toBe(false);
    expectSealRefused(dupObj);

    // 3. Non-hex pi_obj_sha256 on earlier event ev_1 (F2)
    for (const badHex of ["TAMPERED_NOT_HEX", "A".repeat(64), "0".repeat(63)]) {
      const badEarlierObj = structuredClone(valid);
      badEarlierObj.events[0]!.attributes.find((a) => a.name === "pi_obj_sha256")!.value = badHex;
      expect(
        validateOcel2(badEarlierObj, { requireHashChain: true, requireAttrHash: true, requireObjHash: true }).ok
      ).toBe(false);
      expect(validateOcel2(badEarlierObj).ok).toBe(false);
      expectSealRefused(badEarlierObj);
    }
  });

  test("regression (Iteration 5): readOcel2Sqlite handles cleanly-closed single-file WAL DBs, 0444/0555 readonly dirs, active WAL+SHM, and Node v22 cross-runtime close", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-sqlite-wal-it5-"));
    try {
      const builder = new Ocel2ComplianceBuilder();
      builder
        .upsertObject("sess_wal", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z")
        .upsertObject("turn_wal", "turn", { standing: "ALIVE" }, "2026-08-02T10:00:01.000Z")
        .linkTurnToSession("turn_wal", "sess_wal");
      builder.recordEvent({
        id: "ev_wal_1",
        type: "turn_started",
        time: "2026-08-02T10:00:01.000Z",
        attributes: { step: "start" },
        relationships: [
          { objectId: "sess_wal", qualifier: "in_session" },
          { objectId: "turn_wal", qualifier: "in_turn" }
        ]
      });
      const doc = builder.build();

      // (a) Single-file WAL DB lacking -wal/-shm in writable dir (with spaces, #, ?, % in path)
      const specialDir = join(dir, "wal dir #1?2%3");
      mkdirSync(specialDir, { recursive: true });
      const singleDb = join(specialDir, "single.sqlite");
      writeOcel2Sqlite(doc, singleDb);
      for (const sidecar of [`${singleDb}-wal`, `${singleDb}-shm`]) {
        if (existsSync(sidecar)) rmSync(sidecar, { force: true });
      }
      expect(readOcel2Sqlite(singleDb)).toEqual(doc);

      // (b) Single-file WAL DB inside 0444 file + 0555 directory (?immutable=1 path)
      const roSingleDir = join(dir, "ro single #dir");
      mkdirSync(roSingleDir, { recursive: true });
      const roSingleDb = join(roSingleDir, "ro-single.sqlite");
      writeOcel2Sqlite(doc, roSingleDb);
      for (const sidecar of [`${roSingleDb}-wal`, `${roSingleDb}-shm`]) {
        if (existsSync(sidecar)) rmSync(sidecar, { force: true });
      }
      chmodSync(roSingleDb, 0o444);
      chmodSync(roSingleDir, 0o555);
      try {
        expect(readOcel2Sqlite(roSingleDb)).toEqual(doc);
      } finally {
        chmodSync(roSingleDir, 0o755);
        chmodSync(roSingleDb, 0o644);
      }

      // (c) Active WAL (.sqlite + non-empty -wal + -shm) inside 0444/0555 must read WAL, not immutable=1
      const liveDir = join(dir, "live-wal");
      mkdirSync(liveDir, { recursive: true });
      const liveDb = join(liveDir, "live.sqlite");
      const roActiveDir = join(dir, "ro-active");
      mkdirSync(roActiveDir, { recursive: true });
      const roActiveDb = join(roActiveDir, "active.sqlite");

      const liveSink = new AppendableOcel2SqliteSink(liveDb);
      try {
        liveSink.appendDocument(doc);
        liveSink.checkpoint();
        // Append uncheckpointed second event so it lives only in -wal
        liveSink.appendEvent({
          id: "ev_wal_uncheckpointed",
          type: "turn_completed",
          time: "2026-08-02T10:00:02.000Z",
          attributes: [{ name: "fitness", value: "1.0" }],
          relationships: [
            { objectId: "sess_wal", qualifier: "in_session" },
            { objectId: "turn_wal", qualifier: "in_turn" }
          ]
        });
        expect(existsSync(`${liveDb}-wal`)).toBe(true);
        expect(existsSync(`${liveDb}-shm`)).toBe(true);
        copyFileSync(liveDb, roActiveDb);
        copyFileSync(`${liveDb}-wal`, `${roActiveDb}-wal`);
        copyFileSync(`${liveDb}-shm`, `${roActiveDb}-shm`);
      } finally {
        liveSink.close();
      }
      chmodSync(roActiveDb, 0o444);
      chmodSync(`${roActiveDb}-wal`, 0o444);
      chmodSync(`${roActiveDb}-shm`, 0o444);
      chmodSync(roActiveDir, 0o555);
      try {
        const activeRead = readOcel2Sqlite(roActiveDb);
        expect(activeRead.events.map((e) => e.id)).toEqual(["ev_wal_1", "ev_wal_uncheckpointed"]);
      } finally {
        chmodSync(roActiveDir, 0o755);
        chmodSync(roActiveDb, 0o644);
        chmodSync(`${roActiveDb}-wal`, 0o644);
        chmodSync(`${roActiveDb}-shm`, 0o644);
      }

      // (d) Non-empty -wal WITHOUT -shm in 0444/0555 must fail closed with LOGGING_UNAVAILABLE (never bypass WAL)
      const roStaleDir = join(dir, "ro-wal-noshm");
      mkdirSync(roStaleDir, { recursive: true });
      const roStaleDb = join(roStaleDir, "stale.sqlite");
      copyFileSync(roActiveDb, roStaleDb);
      copyFileSync(`${roActiveDb}-wal`, `${roStaleDb}-wal`);
      chmodSync(roStaleDb, 0o444);
      chmodSync(`${roStaleDb}-wal`, 0o444);
      chmodSync(roStaleDir, 0o555);
      try {
        let caught: unknown;
        try {
          readOcel2Sqlite(roStaleDb);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ComplianceRefusalError);
        expect((caught as ComplianceRefusalError).code).toBe("LOGGING_UNAVAILABLE");
      } finally {
        chmodSync(roStaleDir, 0o755);
        chmodSync(roStaleDb, 0o644);
        chmodSync(`${roStaleDb}-wal`, 0o644);
      }

      // (e) Corrupt and missing files still fail closed with LOGGING_UNAVAILABLE
      const corruptDb = join(dir, "corrupt.sqlite");
      writeFileSync(corruptDb, "not a sqlite database at all", "utf8");
      for (const badPath of [corruptDb, join(dir, "does-not-exist.sqlite")]) {
        let caught: unknown;
        try {
          readOcel2Sqlite(badPath);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(ComplianceRefusalError);
        expect((caught as ComplianceRefusalError).code).toBe("LOGGING_UNAVAILABLE");
      }

      // (f) Cross-runtime Node v22 AppendableOcel2SqliteSink.close() -> Bun readOcel2Sqlite
      const nodeVer = spawnSync("node", ["--version"], { encoding: "utf8", timeout: 15_000 });
      if (nodeVer.status === 0 && /^v2[2-9]\./.test((nodeVer.stdout ?? "").trim())) {
        const nodeDb = join(dir, "node-sink.sqlite");
        const docJsonPath = join(dir, "node-doc.json");
        writeFileSync(docJsonPath, JSON.stringify(doc), "utf8");
        const script = [
          'import { readFileSync } from "node:fs";',
          'import { AppendableOcel2SqliteSink } from "./src/compliance/ocel-sqlite.ts";',
          'const doc = JSON.parse(readFileSync(process.argv[1], "utf8"));',
          'const sink = new AppendableOcel2SqliteSink(process.argv[2]);',
          "sink.appendDocument(doc);",
          "sink.close();"
        ].join(" ");
        const res = spawnSync(
          "node",
          ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script, docJsonPath, nodeDb],
          { encoding: "utf8", timeout: 15_000 }
        );
        expect(res.status).toBe(0);
        expect(existsSync(nodeDb)).toBe(true);
        expect(existsSync(`${nodeDb}-wal`)).toBe(false);
        expect(existsSync(`${nodeDb}-shm`)).toBe(false);
        expect(readOcel2Sqlite(nodeDb)).toEqual(doc);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 25_000);

  test("regression (Iteration 5): validateOcel2 returns { ok: false, errors } without TypeError on non-array event attributes/relationships", () => {
    const builder = new Ocel2ComplianceBuilder();
    builder.upsertObject("sess_mal", "session", { compliance_profile: "high-risk-annex-iii" }, "2026-08-02T10:00:00.000Z");
    builder.recordEvent({
      id: "ev_mal_1",
      type: "session_created",
      time: "2026-08-02T10:00:01.000Z",
      attributes: { phase_note: "first" },
      relationships: [{ objectId: "sess_mal", qualifier: "in_session" }]
    });
    builder.recordEvent({
      id: "ev_mal_2",
      type: "session_updated",
      time: "2026-08-02T10:00:02.000Z",
      attributes: { phase_note: "second" },
      relationships: [{ objectId: "sess_mal", qualifier: "in_session" }]
    });
    const baseDoc = builder.build();

    // Missing attributes array with requireHashChain: true
    const missingAttrsDoc = structuredClone(baseDoc);
    (missingAttrsDoc.events[0] as unknown as { attributes: unknown }).attributes = undefined;
    const res1 = validateOcel2(missingAttrsDoc, {
      requireHashChain: true,
      requireAttrHash: true,
      requireObjHash: true
    });
    expect(res1.ok).toBe(false);
    expect(res1.errors.some((e) => e.includes("missing attributes array"))).toBe(true);

    // Missing attributes array on second event under default options (anyPiHash = true from ev_1)
    const missingAttrsEv2Doc = structuredClone(baseDoc);
    (missingAttrsEv2Doc.events[1] as unknown as { attributes: unknown }).attributes = undefined;
    const res2 = validateOcel2(missingAttrsEv2Doc);
    expect(res2.ok).toBe(false);
    expect(res2.errors.some((e) => e.includes("missing attributes array"))).toBe(true);

    // Missing relationships array with requireHashChain: true
    const missingRelsDoc = structuredClone(baseDoc);
    (missingRelsDoc.events[0] as unknown as { relationships: unknown }).relationships = undefined;
    const res3 = validateOcel2(missingRelsDoc, { requireHashChain: true });
    expect(res3.ok).toBe(false);
    expect(res3.errors.some((e) => e.includes("missing relationships array"))).toBe(true);

    // Null element inside event attributes array
    const nullAttrElemDoc = structuredClone(baseDoc);
    (nullAttrElemDoc.events[0]!.attributes as unknown[])[0] = null;
    const res4 = validateOcel2(nullAttrElemDoc, {
      requireHashChain: true,
      requireAttrHash: true,
      requireObjHash: true
    });
    expect(res4.ok).toBe(false);
    expect(res4.errors.length).toBeGreaterThan(0);
  });
});

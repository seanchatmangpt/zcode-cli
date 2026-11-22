import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

import { createTheme } from "../packages/zcode-tui/src/theme.ts";
import { WelcomeBanner } from "../packages/zcode-tui/src/welcome-banner.ts";
import { ComplianceRefusalError, parseComplianceConfigToml } from "../src/compliance/config.ts";
import {
  applyRuntimeArt50Provenance,
  buildArt50DisclosureEnvelope,
  diffWorkspaceSnapshots,
  embedMarkdownProvenanceHeader,
  emitArt50DisclosureEvent,
  extractMarkdownProvenanceHeader,
  formatGitProvenanceTrailer,
  snapshotWorkspaceFiles,
  writeProvenanceSidecar
} from "../src/compliance/disclosure.ts";
import { Ocel2ComplianceBuilder, validateOcel2 } from "../src/compliance/ocel2.ts";
import { containsUnredactedSecretsOrPii } from "../src/compliance/redactor.ts";
import { runRuntime } from "../src/launcher.ts";

describe("F07: EU AI Act Art. 50(1) direct AI-interaction disclosure", () => {
  test("builds redacted Art. 50 disclosure envelope for regulated profiles and refuses suppression", () => {
    const env = buildArt50DisclosureEnvelope({
      profile: "high-risk-annex-iii",
      sessionId: "sess_art50_1",
      provider: "zai",
      model: "glm-5.3",
      channel: "stream-json",
      notice: "Interacting with AI for user alice@example.eu at /Users/alice/work/app.ts",
      timestamp: "2026-08-02T10:00:00.000Z"
    });

    expect(env.type).toBe("system.disclosure");
    expect(env.ai_disclosure.article).toBe("EU-AI-ACT-Art.50");
    expect(env.ai_disclosure.regulation).toBe("EU-2024-1689-Art.50");
    expect(env.ai_disclosure.paragraphs).toEqual(["50(1)", "50(2)"]);
    expect(env.ai_disclosure.disclosed).toBe(true);
    expect(env.ai_disclosure.provider).toBe("zai");
    expect(env.ai_disclosure.provider_id).toBe("zai");
    expect(env.ai_disclosure.model).toBe("glm-5.3");
    expect(env.ai_disclosure.model_id).toBe("glm-5.3");
    expect(containsUnredactedSecretsOrPii(JSON.stringify(env))).toBe(false);

    // Regression (Iteration 2): traceId redaction
    const envWithTrace = buildArt50DisclosureEnvelope({
      profile: "art50-only",
      sessionId: "sess_trace_1",
      provider: "zai",
      model: "glm-5.3",
      traceId: "Bearer secret-token-1234567890 for user@example.com"
    });
    expect(containsUnredactedSecretsOrPii(JSON.stringify(envWithTrace))).toBe(false);
    expect(envWithTrace.traceId).not.toContain("secret-token-1234567890");
    expect(envWithTrace.traceId).not.toContain("user@example.com");

    // Fail closed under regulated profiles
    for (const bad of [
      { profile: "art50-only" as const, sessionId: "s1", provider: "zai", model: "glm-5.3", disclosed: false },
      { profile: "high-risk-annex-iii" as const, sessionId: "s1", provider: "zai", model: "glm-5.3", workerNoticeAcknowledged: false },
      { profile: "high-risk-annex-i" as const, sessionId: "s1", provider: "", model: "glm-5.3" },
      { profile: "art50-only" as const, sessionId: "s1", provider: "zai", model: "glm-5.3", notice: "   " },
      { profile: "art50-only" as const, sessionId: "", provider: "zai", model: "glm-5.3" }
    ]) {
      let caught: unknown;
      try {
        buildArt50DisclosureEnvelope(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ComplianceRefusalError);
      expect((caught as ComplianceRefusalError).code).toBe("DISCLOSURE_REQUIRED");
      expect((caught as ComplianceRefusalError).exitCode).toBe(1);
    }
  });

  test("emitArt50DisclosureEvent emits valid OCEL 2.0 event & O2O links via Ocel2ComplianceBuilder", () => {
    const builder = new Ocel2ComplianceBuilder();
    const emitted = emitArt50DisclosureEvent(builder, {
      profile: "art50-only",
      sessionId: "sess_emit_1",
      turnId: "turn_emit_1",
      provider: "anthropic",
      model: "claude-sonnet-4",
      timestamp: "2026-08-02T10:05:00.000Z"
    });

    const doc = builder.build();
    expect(doc.events.some((e) => e.type === "art50_disclosure_emitted")).toBe(true);
    expect(doc.objects.some((o) => o.id === emitted.disclosureObjectId && o.type === "disclosure_notice")).toBe(true);
    expect(doc.objects.some((o) => o.id === emitted.profileObjectId && o.type === "compliance_profile")).toBe(true);
    const profObj = doc.objects.find((o) => o.id === emitted.profileObjectId)!;
    expect(
      profObj.relationships.some((r) => r.qualifier === "governs" && r.objectId === "sess_emit_1")
    ).toBe(true);

    const check = validateOcel2(doc, { requireHashChain: true, requireAttrHash: true });
    expect(check.ok).toBe(true);
  });

  test("WelcomeBanner preserves 4/2 legacy lines and renders wrapped Art. 50(1) notice when configured", () => {
    const theme = createTheme(false);
    const legacy = new WelcomeBanner(theme, {
      branch: "main",
      distributionVersion: "3.14.3",
      runtimeVersion: "0.16.9",
      workspace: "/tmp/project"
    });
    expect(legacy.render(80)).toHaveLength(4);
    expect(legacy.render(47)).toHaveLength(2);

    const compliant = new WelcomeBanner(theme, {
      branch: "main",
      distributionVersion: "3.14.3",
      runtimeVersion: "0.16.9",
      workspace: "/tmp/project",
      complianceProfile: "art50-only",
      provider: "zai\u001b[2J",
      model: "glm-5.3\u001b]0;evil\u0007"
    });

    const wideOut = compliant.render(80);
    expect(wideOut.length).toBeGreaterThan(4);
    const wideText = wideOut.join("\n");
    expect(wideText).toContain("AI System (EU AI Act Art. 50)");
    expect(wideText).toContain("zai/glm-5.3");
    expect(wideText).toContain("profile art50-only");
    expect(wideText).not.toContain("\u001b[2J");
    expect(wideText).not.toContain("\u001b]0;evil");

    const compactOut = compliant.render(47);
    expect(compactOut.length).toBeGreaterThan(2);
    expect(compactOut.join("\n")).toContain("EU AI Act Art. 50");

    for (const w of [1, 8, 20, 47, 48, 80, 120]) {
      const rendered = compliant.render(w);
      expect(rendered.every((line) => visibleWidth(line) <= w)).toBe(true);
    }
  });
});

describe("F08: EU AI Act Art. 50(2) machine-readable provenance marking", () => {
  test("writeProvenanceSidecar hashes real file spans, seals metadata, emits OCEL event, and fails closed on errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-prov-"));
    try {
      const srcDir = join(dir, "src");
      const targetFile = join(srcDir, "app.ts");
      mkdtempSync(join(dir, "dummy-"));
      writeFileSync(join(dir, "full.ts"), "line1\nline2\nline3\n", "utf8");
      const content = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
      writeFileSync(join(dir, "target.ts"), content, "utf8");

      const builder = new Ocel2ComplianceBuilder();
      const headHash = "a".repeat(64);
      const res = writeProvenanceSidecar({
        sessionId: "sess_prov_01",
        workspaceDir: dir,
        provider: "zai",
        model: "glm-5.3",
        profile: "high-risk-annex-iii",
        ocelHeadHash: headHash,
        modifiedSpans: [
          { filePath: "full.ts" },
          { filePath: join(dir, "target.ts"), startLine: 2, endLine: 3 }
        ],
        timestamp: "2026-08-02T12:00:00.000Z",
        ocelSink: builder
      });

      expect(res.sidecarPath).toBe(join(dir, ".zcode-provenance", "sess_prov_01.json"));
      const onDisk = JSON.parse(readFileSync(res.sidecarPath, "utf8")) as typeof res.document;
      expect(onDisk.article).toBe("EU-AI-ACT-Art.50(2)");
      expect(onDisk.ocel_head_hash).toBe(headHash);
      expect(onDisk.span_count).toBe(2);
      expect(onDisk.modified_spans[0]!.sha256).toBe(
        createHash("sha256").update("line1\nline2\nline3\n", "utf8").digest("hex")
      );
      expect(onDisk.modified_spans[1]!.sha256).toBe(
        createHash("sha256").update("const b = 2;\nconst c = 3;", "utf8").digest("hex")
      );
      expect(containsUnredactedSecretsOrPii(JSON.stringify(onDisk))).toBe(false);

      const ocelDoc = builder.build();
      expect(ocelDoc.events.some((e) => e.type === "provenance_marked")).toBe(true);
      expect(validateOcel2(ocelDoc, { requireHashChain: true, requireAttrHash: true }).ok).toBe(true);

      // Fail closed on missing ocelHeadHash under regulated profile
      expect(() =>
        writeProvenanceSidecar({
          sessionId: "sess_prov_02",
          workspaceDir: dir,
          provider: "zai",
          model: "glm-5.3",
          profile: "art50-only",
          modifiedSpans: [{ filePath: "full.ts" }]
        })
      ).toThrow(ComplianceRefusalError);

      // Fail closed on path traversal sessionId
      expect(() =>
        writeProvenanceSidecar({
          sessionId: "../escape",
          workspaceDir: dir,
          provider: "zai",
          model: "glm-5.3",
          profile: "art50-only",
          ocelHeadHash: headHash,
          modifiedSpans: [{ filePath: "full.ts" }]
        })
      ).toThrow(ComplianceRefusalError);

      // Fail closed on missing file & bad line span
      expect(() =>
        writeProvenanceSidecar({
          sessionId: "sess_prov_03",
          workspaceDir: dir,
          provider: "zai",
          model: "glm-5.3",
          profile: "art50-only",
          ocelHeadHash: headHash,
          modifiedSpans: [{ filePath: "does-not-exist.ts" }]
        })
      ).toThrow(ComplianceRefusalError);

      expect(() =>
        writeProvenanceSidecar({
          sessionId: "sess_prov_04",
          workspaceDir: dir,
          provider: "zai",
          model: "glm-5.3",
          profile: "art50-only",
          ocelHeadHash: headHash,
          modifiedSpans: [{ filePath: "full.ts", startLine: 1, endLine: 999 }]
        })
      ).toThrow(ComplianceRefusalError);

      // Fail closed when outputDir is blocked by a regular file
      const blocker = join(dir, "blocker-file");
      writeFileSync(blocker, "not-a-dir", "utf8");
      let sealErr: unknown;
      try {
        writeProvenanceSidecar({
          sessionId: "sess_prov_05",
          workspaceDir: dir,
          outputDir: blocker,
          provider: "zai",
          model: "glm-5.3",
          profile: "art50-only",
          ocelHeadHash: headHash,
          modifiedSpans: [{ filePath: "full.ts" }]
        });
      } catch (e) {
        sealErr = e;
      }
      expect(sealErr).toBeInstanceOf(ComplianceRefusalError);
      expect((sealErr as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
      void targetFile;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("formatGitProvenanceTrailer respects config and prevents trailer newline injection", () => {
    const stdCfg = parseComplianceConfigToml('[compliance]\nprofile = "standard"\n', { env: {} });
    expect(formatGitProvenanceTrailer({ config: stdCfg, provider: "zai", model: "glm-5.3" })).toBe("");

    const regCfg = parseComplianceConfigToml('[compliance]\nprofile = "high-risk-annex-iii"\n', { env: {} });
    const trailer = formatGitProvenanceTrailer({
      config: regCfg,
      cliVersion: "26.9.23",
      provider: "zai",
      model: "glm-5.3\nSigned-off-by: attacker",
      sessionId: "sess_1"
    });
    expect(trailer).toStartWith("AI-Generated-By: zcode-cli/26.9.23");
    expect(trailer).not.toContain("\n");
    expect(trailer).not.toContain("\r");
    expect(trailer).toContain("provider=zai");
    expect(trailer).toContain("profile=high-risk-annex-iii");
    expect(trailer).toContain("session=sess_1");
  });

  test("embedMarkdownProvenanceHeader preserves YAML frontmatter, extracts metadata, and is strictly idempotent", () => {
    const mdWithFm = "---\ntitle: Spec\nauthor: Team\n---\n\n# Heading\nBody text.\n";
    const opts = {
      profile: "art50-only" as const,
      provider: "zai",
      model: "glm-5.3",
      sessionId: "sess_md_1",
      cliVersion: "26.9.23",
      generatedAt: "2026-08-02T13:00:00.000Z"
    };

    const once = embedMarkdownProvenanceHeader(mdWithFm, opts);
    expect(once.startsWith("---\ntitle: Spec\nauthor: Team\n---\n<!-- zcode:provenance:v1 ")).toBe(true);
    expect(once).toContain("# Heading\nBody text.\n");

    const extracted = extractMarkdownProvenanceHeader(once);
    expect(extracted).not.toBeNull();
    expect(extracted!.article).toBe("EU-AI-ACT-Art.50(2)");
    expect(extracted!.contentSha256).toBe(
      createHash("sha256").update("\n# Heading\nBody text.\n", "utf8").digest("hex")
    );

    const twice = embedMarkdownProvenanceHeader(once, opts);
    expect(twice).toBe(once);

    // Also idempotent even when generatedAt is omitted on second call
    const noTsOpts = {
      profile: "art50-only" as const,
      provider: "zai",
      model: "glm-5.3",
      sessionId: "sess_md_1"
    };
    const autoOnce = embedMarkdownProvenanceHeader("# Plain\nHello\n", noTsOpts);
    const autoTwice = embedMarkdownProvenanceHeader(autoOnce, noTsOpts);
    expect(autoTwice).toBe(autoOnce);
  });

  test("regression (Iteration 2): writeProvenanceSidecar enforces workspace containment, rejects trailing-LF phantom line, and escapes --!>", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-prov-containment-"));
    try {
      const wsDir = join(root, "ws");
      const outDir = join(root, "outside");
      mkdirSync(wsDir, { recursive: true });
      mkdirSync(outDir, { recursive: true });
      const outsideSecret = join(outDir, "secret.txt");
      writeFileSync(outsideSecret, "TOP_SECRET\n", "utf8");
      const symlinkPath = join(wsDir, "link_to_outside.txt");
      symlinkSync(outsideSecret, symlinkPath);
      const threeLineFile = join(wsDir, "three.txt");
      writeFileSync(threeLineFile, "line1\nline2\nline3\n", "utf8");

      const headHash = "b".repeat(64);
      for (const badPath of ["../outside/secret.txt", outsideSecret, "link_to_outside.txt"]) {
        let err: unknown;
        try {
          writeProvenanceSidecar({
            sessionId: "sess_escape",
            workspaceDir: wsDir,
            provider: "zai",
            model: "glm-5.3",
            profile: "art50-only",
            ocelHeadHash: headHash,
            modifiedSpans: [{ filePath: badPath }]
          });
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ComplianceRefusalError);
        expect((err as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
      }

      // Trailing-LF phantom line 4 must be rejected for a 3-line file, while line 3 succeeds
      expect(() =>
        writeProvenanceSidecar({
          sessionId: "sess_phantom",
          workspaceDir: wsDir,
          provider: "zai",
          model: "glm-5.3",
          profile: "art50-only",
          ocelHeadHash: headHash,
          modifiedSpans: [{ filePath: "three.txt", startLine: 1, endLine: 4 }]
        })
      ).toThrow(ComplianceRefusalError);

      const okRes = writeProvenanceSidecar({
        sessionId: "sess_ok3",
        workspaceDir: wsDir,
        provider: "zai",
        model: "glm-5.3",
        profile: "art50-only",
        ocelHeadHash: headHash,
        modifiedSpans: [{ filePath: "three.txt", startLine: 1, endLine: 3 }]
      });
      expect(okRes.document.modified_spans[0]!.path).toBe("three.txt");

      // HTML5 --!> comment breakout escaping
      const mdEscaped = embedMarkdownProvenanceHeader("# Doc\n", {
        profile: "art50-only",
        provider: "zai--!><script>",
        model: "glm-->5.3",
        sessionId: "sess_html5"
      });
      const firstLine = mdEscaped.split("\n")[0]!;
      expect(firstLine).not.toContain("--!><script>");
      const extracted = extractMarkdownProvenanceHeader(mdEscaped);
      expect(extracted?.provider).toBe("zai--!><script>");
      expect(extracted?.model).toBe("glm-->5.3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("regression (Iteration 3): writeProvenanceSidecar rejects dangling external symlinks with inline span.content", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-prov-dangling-"));
    try {
      const wsDir = join(root, "ws");
      const outDir = join(root, "outside");
      mkdirSync(wsDir, { recursive: true });
      mkdirSync(outDir, { recursive: true });

      symlinkSync(join(outDir, "nonexistent_dir"), join(wsDir, "dangling_dir_link"));
      symlinkSync(join(outDir, "nonexistent.ts"), join(wsDir, "dangling_file_link.ts"));
      symlinkSync(join(wsDir, "hop2_link.ts"), join(wsDir, "hop1_link.ts"));
      symlinkSync(join(outDir, "missing_hop2.ts"), join(wsDir, "hop2_link.ts"));

      const headHash = "c".repeat(64);
      for (const badPath of [
        "dangling_dir_link/newfile.ts",
        "dangling_file_link.ts",
        "hop1_link.ts"
      ]) {
        let caught: unknown;
        try {
          writeProvenanceSidecar({
            sessionId: "sess_dangling",
            workspaceDir: wsDir,
            provider: "zai",
            model: "glm-5.3",
            profile: "art50-only",
            ocelHeadHash: headHash,
            modifiedSpans: [{ filePath: badPath, content: "inline content" }]
          });
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ComplianceRefusalError);
        expect((caught as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
      }

      // Legitimate non-existent nested file with inline content succeeds
      const okRes = writeProvenanceSidecar({
        sessionId: "sess_inline_ok",
        workspaceDir: wsDir,
        provider: "zai",
        model: "glm-5.3",
        profile: "art50-only",
        ocelHeadHash: headHash,
        modifiedSpans: [{ filePath: "new_sub/fresh.ts", content: "export const ok = true;\n" }]
      });
      expect(okRes.document.modified_spans[0]!.path).toBe("new_sub/fresh.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("regression (Iteration 4): writeProvenanceSidecar refuses symlinked .zcode-provenance escaping workspaceDir with zero external writes", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-prov-dirsym-"));
    try {
      const wsDir = join(root, "ws");
      const outDir = join(root, "outside");
      mkdirSync(wsDir, { recursive: true });
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(wsDir, "a.ts"), "export const a = 1;\n", "utf8");
      symlinkSync(outDir, join(wsDir, ".zcode-provenance"));

      const builder = new Ocel2ComplianceBuilder();
      const headHash = "d".repeat(64);
      let caught: unknown;
      try {
        writeProvenanceSidecar({
          sessionId: "sess_dir_escape",
          workspaceDir: wsDir,
          provider: "zai",
          model: "glm-5.3",
          profile: "high-risk-annex-iii",
          ocelHeadHash: headHash,
          modifiedSpans: [{ filePath: "a.ts" }],
          ocelSink: builder
        });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ComplianceRefusalError);
      expect((caught as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
      expect(readdirSync(outDir)).toEqual([]);
      expect(builder.build().events).toEqual([]);

      // Also verify dangling .zcode-provenance symlink is refused
      const wsDangling = join(root, "ws_dangling");
      mkdirSync(wsDangling, { recursive: true });
      writeFileSync(join(wsDangling, "a.ts"), "export const a = 1;\n", "utf8");
      symlinkSync(join(outDir, "missing_dir"), join(wsDangling, ".zcode-provenance"));
      expect(() =>
        writeProvenanceSidecar({
          sessionId: "sess_dir_dangling",
          workspaceDir: wsDangling,
          provider: "zai",
          model: "glm-5.3",
          profile: "high-risk-annex-iii",
          ocelHeadHash: headHash,
          modifiedSpans: [{ filePath: "a.ts" }]
        })
      ).toThrow(ComplianceRefusalError);

      // Internal symlink within workspaceDir succeeds and logs canonical OCEL sidecar_path
      const wsInternal = join(root, "ws_internal");
      const internalTarget = join(wsInternal, "internal_prov");
      mkdirSync(internalTarget, { recursive: true });
      writeFileSync(join(wsInternal, "a.ts"), "export const a = 1;\n", "utf8");
      symlinkSync(internalTarget, join(wsInternal, ".zcode-provenance"));

      const internalBuilder = new Ocel2ComplianceBuilder();
      const okInternal = writeProvenanceSidecar({
        sessionId: "sess_sym_in",
        workspaceDir: wsInternal,
        provider: "zai",
        model: "glm-5.3",
        profile: "high-risk-annex-iii",
        ocelHeadHash: headHash,
        modifiedSpans: [{ filePath: "a.ts" }],
        ocelSink: internalBuilder
      });
      expect(readdirSync(internalTarget)).toContain("sess_sym_in.json");
      const doc = internalBuilder.build();
      const provEvt = doc.events.find((e) => e.type === "provenance_marked")!;
      expect(provEvt.attributes.find((a) => a.name === "sidecar_path")?.value).toBe(
        "internal_prov/sess_sym_in.json"
      );
      expect(okInternal.document.session_id).toBe("sess_sym_in");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("regression (C5-Art50-Provenance): runRuntime automatically marks Markdown headers and writes .zcode-provenance sidecar under regulated profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-c5-prov-"));
    try {
      const wsDir = join(root, "ws");
      mkdirSync(wsDir, { recursive: true });
      const runtimeStub = join(root, "write-artifacts.mjs");
      writeFileSync(
        runtimeStub,
        [
          'import { writeFileSync } from "node:fs";',
          'writeFileSync("foo.md", "# Generated Doc\\n\\nHello from AI.\\n", "utf8");',
          'writeFileSync("foo.ts", "export const answer = 42;\\n", "utf8");'
        ].join("\n"),
        "utf8"
      );

      const regCfg = parseComplianceConfigToml('[compliance]\nprofile = "art50-only"\n', { env: {} });
      const sessionId = "sess_c5_reg_01";
      const exitCode = await runRuntime(
        process.execPath,
        ["-p", "create foo.md and foo.ts"],
        {},
        {
          config: regCfg,
          providerId: "zai",
          modelId: "glm-5.3",
          sessionId
        },
        { runtimeScriptPath: runtimeStub, cwd: wsDir }
      );

      expect(exitCode).toBe(0);

      // 1. Markdown provenance header is embedded automatically
      const fooMd = readFileSync(join(wsDir, "foo.md"), "utf8");
      const mdHeader = extractMarkdownProvenanceHeader(fooMd);
      expect(mdHeader).not.toBeNull();
      expect(mdHeader!.article).toBe("EU-AI-ACT-Art.50(2)");
      expect(mdHeader!.sessionId).toBe(sessionId);
      expect(mdHeader!.provider).toBe("zai");
      expect(mdHeader!.model).toBe("glm-5.3");
      expect(mdHeader!.profile).toBe("art50-only");

      // 2. Provenance sidecar is written to .zcode-provenance/<sessionId>.json with exact hashes
      const sidecarPath = join(wsDir, ".zcode-provenance", `${sessionId}.json`);
      expect(existsSync(sidecarPath)).toBe(true);
      const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as {
        article: string;
        session_id: string;
        provider: string;
        model: string;
        compliance_profile: string;
        span_count: number;
        modified_spans: Array<{ path: string; sha256: string }>;
      };
      expect(sidecar.article).toBe("EU-AI-ACT-Art.50(2)");
      expect(sidecar.session_id).toBe(sessionId);
      expect(sidecar.provider).toBe("zai");
      expect(sidecar.model).toBe("glm-5.3");
      expect(sidecar.compliance_profile).toBe("art50-only");
      expect(sidecar.span_count).toBe(2);

      const mdSpan = sidecar.modified_spans.find((s) => s.path === "foo.md");
      const tsSpan = sidecar.modified_spans.find((s) => s.path === "foo.ts");
      expect(mdSpan?.sha256).toBe(createHash("sha256").update(fooMd, "utf8").digest("hex"));
      expect(tsSpan?.sha256).toBe(
        createHash("sha256").update(readFileSync(join(wsDir, "foo.ts"), "utf8"), "utf8").digest("hex")
      );

      // 3. Standard (non-regulated) profile does not modify Markdown or write sidecar
      const stdWs = join(root, "ws_std");
      mkdirSync(stdWs, { recursive: true });
      const stdCfg = parseComplianceConfigToml('[compliance]\nprofile = "standard"\n', { env: {} });
      const stdExit = await runRuntime(
        process.execPath,
        ["-p", "create foo.md and foo.ts"],
        {},
        {
          config: stdCfg,
          providerId: "zai",
          modelId: "glm-5.3",
          sessionId: "sess_c5_std_01"
        },
        { runtimeScriptPath: runtimeStub, cwd: stdWs }
      );
      expect(stdExit).toBe(0);
      expect(extractMarkdownProvenanceHeader(readFileSync(join(stdWs, "foo.md"), "utf8"))).toBeNull();
      expect(existsSync(join(stdWs, ".zcode-provenance"))).toBe(false);

      // 4. Fail closed when .zcode-provenance is blocked by a regular file
      const blockedWs = join(root, "ws_blocked");
      mkdirSync(blockedWs, { recursive: true });
      writeFileSync(join(blockedWs, ".zcode-provenance"), "not-a-dir", "utf8");
      const blockedExit = await runRuntime(
        process.execPath,
        ["-p", "create foo.md and foo.ts"],
        {},
        {
          config: regCfg,
          providerId: "zai",
          modelId: "glm-5.3",
          sessionId: "sess_c5_blocked_01"
        },
        { runtimeScriptPath: runtimeStub, cwd: blockedWs }
      );
      expect(blockedExit).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ERRC ELIMINATE: applyRuntimeArt50Provenance never fabricates synthetic ocel_head_hash and fails closed when OCEL is required", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-errc-ocel-head-"));
    try {
      const wsDir = join(root, "ws");
      mkdirSync(wsDir, { recursive: true });
      const before = snapshotWorkspaceFiles(wsDir);
      writeFileSync(join(wsDir, "out.ts"), "export const x = 1;\n", "utf8");

      // 1. Without ocelHeadHash and without requireOcelHeadHash -> ocel_head_hash: null + typed reason
      const unrecorded = applyRuntimeArt50Provenance({
        workspaceDir: wsDir,
        beforeSnapshot: before,
        sessionId: "sess_errc_null_01",
        profile: "art50-only",
        provider: "zai",
        model: "glm-5.3",
        ocelUnrecordedReason: "ocel_tap_failed"
      });
      expect(unrecorded).not.toBeNull();
      expect(unrecorded!.document.ocel_head_hash).toBeNull();
      expect(unrecorded!.document.ocel_unrecorded_reason).toBe("ocel_tap_failed");

      // 2. With requireOcelHeadHash: true and missing ocelHeadHash -> fail closed R_missing_identity
      let caught: unknown;
      try {
        applyRuntimeArt50Provenance({
          workspaceDir: wsDir,
          beforeSnapshot: before,
          sessionId: "sess_errc_req_01",
          profile: "high-risk-annex-iii",
          provider: "zai",
          model: "glm-5.3",
          requireOcelHeadHash: true
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ComplianceRefusalError);
      expect((caught as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");
      expect((caught as ComplianceRefusalError).brokenTerm).toBe("R_missing_identity");

      // 3. With real ocelHeadHash -> recorded verbatim with no unrecorded reason
      const realHead = "e".repeat(64);
      const recorded = applyRuntimeArt50Provenance({
        workspaceDir: wsDir,
        beforeSnapshot: before,
        sessionId: "sess_errc_real_01",
        profile: "high-risk-annex-iii",
        provider: "zai",
        model: "glm-5.3",
        ocelHeadHash: realHead,
        requireOcelHeadHash: true
      });
      expect(recorded).not.toBeNull();
      expect(recorded!.document.ocel_head_hash).toBe(realHead);
      expect(recorded!.document.ocel_unrecorded_reason).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ERRC REDUCE: snapshotWorkspaceFiles signals truncation, catches same-mtime/same-size edits, and uses git fallback or fails closed", () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-errc-snap-"));
    try {
      // 1. Same-mtime, same-size in-place edit is detected via contentSha256 / ctimeMs
      const editWs = join(root, "edit_ws");
      mkdirSync(editWs, { recursive: true });
      const targetFile = join(editWs, "same_size.ts");
      writeFileSync(targetFile, "export const v = 1111;\n", "utf8");
      const origStat = statSync(targetFile);
      const beforeEdit = snapshotWorkspaceFiles(editWs);
      expect(beforeEdit.truncated).toBe(false);

      writeFileSync(targetFile, "export const v = 2222;\n", "utf8");
      utimesSync(targetFile, origStat.atime, origStat.mtime);
      const afterEdit = snapshotWorkspaceFiles(editWs);
      expect(diffWorkspaceSnapshots(beforeEdit, afterEdit)).toEqual(["same_size.ts"]);

      // 2. Truncated non-git workspace fails closed under regulated profile
      const nonGitWs = join(root, "nongit_ws");
      mkdirSync(nonGitWs, { recursive: true });
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(nonGitWs, `f${i}.ts`), `export const n = ${i};\n`, "utf8");
      }
      const beforeTrunc = snapshotWorkspaceFiles(nonGitWs, { maxFiles: 2 });
      expect(beforeTrunc.truncated).toBe(true);
      expect(beforeTrunc.files.size).toBe(2);

      let truncErr: unknown;
      try {
        applyRuntimeArt50Provenance({
          workspaceDir: nonGitWs,
          beforeSnapshot: beforeTrunc,
          sessionId: "sess_trunc_fail",
          profile: "art50-only",
          provider: "zai",
          model: "glm-5.3",
          maxSnapshotFiles: 2
        });
      } catch (e) {
        truncErr = e;
      }
      expect(truncErr).toBeInstanceOf(ComplianceRefusalError);
      expect((truncErr as ComplianceRefusalError).code).toBe("PROVENANCE_SEAL_FAILED");

      // 3. Truncated git workspace falls back to git status --porcelain and marks modified files beyond maxFiles
      const gitWs = join(root, "git_ws");
      mkdirSync(gitWs, { recursive: true });
      execFileSync("git", ["init"], { cwd: gitWs, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: gitWs, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: gitWs, stdio: "ignore" });
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(gitWs, `f${i}.ts`), `export const n = ${i};\n`, "utf8");
      }
      execFileSync("git", ["add", "."], { cwd: gitWs, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: gitWs, stdio: "ignore" });

      const beforeGit = snapshotWorkspaceFiles(gitWs, { maxFiles: 2 });
      expect(beforeGit.truncated).toBe(true);
      writeFileSync(join(gitWs, "zzz_late.md"), "# Late doc\n", "utf8");

      const gitRes = applyRuntimeArt50Provenance({
        workspaceDir: gitWs,
        beforeSnapshot: beforeGit,
        sessionId: "sess_trunc_git",
        profile: "art50-only",
        provider: "zai",
        model: "glm-5.3",
        ocelHeadHash: "f".repeat(64),
        maxSnapshotFiles: 2
      });
      expect(gitRes).not.toBeNull();
      expect(gitRes!.modifiedFiles).toContain("zzz_late.md");
      expect(gitRes!.markedMarkdownFiles).toContain("zzz_late.md");
      expect(extractMarkdownProvenanceHeader(readFileSync(join(gitWs, "zzz_late.md"), "utf8"))).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ERRC RAISE: runRuntime records Art. 50 disclosure O2O/E2O objects, notice_sha256, and provenance_marked in session OCEL", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-errc-raise-ocel-"));
    const prevOcel = process.env.ZCODE_OCEL;
    const prevOcelDir = process.env.ZCODE_OCEL_DIR;
    try {
      const wsDir = join(root, "ws");
      const ocelDir = join(root, "ocel");
      mkdirSync(wsDir, { recursive: true });
      mkdirSync(ocelDir, { recursive: true });

      const runtimeStub = join(root, "stream-and-write.mjs");
      writeFileSync(
        runtimeStub,
        [
          'import { writeFileSync } from "node:fs";',
          'process.stdout.write(JSON.stringify({ type: "turn.started", eventId: "evt_raise_01", sessionId: "sess_raise_01", turnId: "turn_raise_01", timestamp: "2026-08-02T14:00:00.000Z" }) + "\\n");',
          'writeFileSync("doc.md", "# AI Output\\nHello\\n", "utf8");',
          'process.stdout.write(JSON.stringify({ type: "turn.completed", eventId: "evt_raise_02", sessionId: "sess_raise_01", turnId: "turn_raise_01", timestamp: "2026-08-02T14:00:01.000Z" }) + "\\n");'
        ].join("\n"),
        "utf8"
      );

      process.env.ZCODE_OCEL = "1";
      process.env.ZCODE_OCEL_DIR = ocelDir;

      const regCfg = parseComplianceConfigToml('[compliance]\nprofile = "high-risk-annex-iii"\n', { env: {} });
      const exitCode = await runRuntime(
        process.execPath,
        ["-p", "generate doc.md", "--output-format", "stream-json"],
        {},
        {
          config: regCfg,
          providerId: "zai",
          modelId: "glm-5.3",
          sessionId: "sess_raise_01"
        },
        { runtimeScriptPath: runtimeStub, cwd: wsDir }
      );
      expect(exitCode).toBe(0);

      const ocelFiles = readdirSync(ocelDir).filter(
        (f) => f.endsWith(".jsonocel") || f.endsWith(".ocel.json")
      );
      expect(ocelFiles.length).toBeGreaterThan(0);
      const ocelDoc = JSON.parse(readFileSync(join(ocelDir, ocelFiles[0]!), "utf8"));

      const validation = validateOcel2(ocelDoc, { requireHashChain: true, requireAttrHash: true });
      expect(validation.ok).toBe(true);

      // Verify art50_disclosure_emitted has notice_sha256 and full E2O + O2O links
      const discEvt = ocelDoc.events.find((e: { type: string }) => e.type === "art50_disclosure_emitted");
      expect(discEvt).toBeDefined();
      const noticeShaAttr = discEvt.attributes.find((a: { name: string }) => a.name === "notice_sha256");
      expect(noticeShaAttr?.value).toMatch(/^[a-f0-9]{64}$/);
      expect(discEvt.relationships.some((r: { qualifier: string }) => r.qualifier === "in_session")).toBe(true);
      expect(discEvt.relationships.some((r: { qualifier: string }) => r.qualifier === "governs")).toBe(true);
      expect(discEvt.relationships.some((r: { qualifier: string }) => r.qualifier === "about_disclosure")).toBe(true);

      const discObj = ocelDoc.objects.find((o: { type: string }) => o.type === "disclosure_notice");
      const profObj = ocelDoc.objects.find((o: { type: string }) => o.type === "compliance_profile");
      expect(discObj).toBeDefined();
      expect(profObj).toBeDefined();
      expect(profObj.relationships.some((r: { qualifier: string }) => r.qualifier === "governs")).toBe(true);
      expect(discObj.relationships.some((r: { qualifier: string }) => r.qualifier === "in_session")).toBe(true);

      // Verify provenance_marked and provenance_artifact are recorded in the session OCEL
      const provEvt = ocelDoc.events.find((e: { type: string }) => e.type === "provenance_marked");
      expect(provEvt).toBeDefined();
      expect(provEvt.relationships.some((r: { qualifier: string }) => r.qualifier === "in_session")).toBe(true);
      expect(provEvt.relationships.some((r: { qualifier: string }) => r.qualifier === "seals")).toBe(true);

      const provObj = ocelDoc.objects.find((o: { type: string }) => o.type === "provenance_artifact");
      expect(provObj).toBeDefined();
      expect(provObj.relationships.some((r: { qualifier: string }) => r.qualifier === "seals")).toBe(true);

      const sidecarPath = join(wsDir, ".zcode-provenance", "sess_raise_01.json");
      const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as { seal_sha256: string };
      expect(provEvt.attributes.find((a: { name: string }) => a.name === "seal_sha256")?.value).toBe(
        sidecar.seal_sha256
      );
    } finally {
      if (prevOcel === undefined) delete process.env.ZCODE_OCEL;
      else process.env.ZCODE_OCEL = prevOcel;
      if (prevOcelDir === undefined) delete process.env.ZCODE_OCEL_DIR;
      else process.env.ZCODE_OCEL_DIR = prevOcelDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ERRC CREATE: runRuntime delivers Art. 50(1) disclosure on plain-text headless, TUI, non-object --json, and unparseable --json channels", async () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-errc-create-disc-"));
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    try {
      const wsDir = join(root, "ws");
      mkdirSync(wsDir, { recursive: true });
      const regCfg = parseComplianceConfigToml('[compliance]\nprofile = "art50-only"\n', { env: {} });

      const captureWrites = async (fn: () => Promise<number>) => {
        let out = "";
        let err = "";
        process.stdout.write = ((chunk: string | Uint8Array) => {
          out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: string | Uint8Array) => {
          err += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        }) as typeof process.stderr.write;
        try {
          const code = await fn();
          return { code, out, err };
        } finally {
          process.stdout.write = origStdoutWrite;
          process.stderr.write = origStderrWrite;
        }
      };

      // 1. Plain-text headless mode emits Art. 50(1) notice to stderr
      const noopStub = join(root, "noop.mjs");
      writeFileSync(noopStub, 'process.exit(0);\n', "utf8");
      const plainRes = await captureWrites(() =>
        runRuntime(
          process.execPath,
          ["-p", "hello"],
          {},
          { config: regCfg, providerId: "zai", modelId: "glm-5.3", sessionId: "sess_plain_01" },
          { runtimeScriptPath: noopStub, cwd: wsDir }
        )
      );
      expect(plainRes.code).toBe(0);
      expect(plainRes.err).toContain("EU AI Act Art. 50");
      expect(plainRes.err).toContain("session=sess_plain_01");

      // 2. TUI mode emits Art. 50(1) notice to stderr and passes ZCODE_ART50_DISCLOSURE_* env to child
      const envDumpPath = join(root, "tui-env.json");
      const tuiStub = join(root, "tui-stub.mjs");
      writeFileSync(
        tuiStub,
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(envDumpPath)}, JSON.stringify({ notice: process.env.ZCODE_ART50_DISCLOSURE_NOTICE, json: process.env.ZCODE_ART50_DISCLOSURE_JSON }));\n`,
        "utf8"
      );
      const tuiRes = await captureWrites(() =>
        runRuntime(
          process.execPath,
          ["tui"],
          {},
          { config: regCfg, providerId: "zai", modelId: "glm-5.3", sessionId: "sess_tui_01" },
          { runtimeScriptPath: tuiStub, cwd: wsDir }
        )
      );
      expect(tuiRes.code).toBe(0);
      expect(tuiRes.err).toContain("EU AI Act Art. 50");
      const tuiEnv = JSON.parse(readFileSync(envDumpPath, "utf8")) as { notice?: string; json?: string };
      expect(tuiEnv.notice).toContain("EU AI Act Art. 50");
      expect(JSON.parse(tuiEnv.json!).disclosed).toBe(true);

      // 3. Non-object --json stdout (JSON array) is wrapped with ai_disclosure
      const arrayStub = join(root, "array-json.mjs");
      writeFileSync(arrayStub, 'process.stdout.write("[1, 2, 3]\\n");\n', "utf8");
      const arrayRes = await captureWrites(() =>
        runRuntime(
          process.execPath,
          ["-p", "list", "--json"],
          {},
          { config: regCfg, providerId: "zai", modelId: "glm-5.3", sessionId: "sess_arr_01" },
          { runtimeScriptPath: arrayStub, cwd: wsDir }
        )
      );
      expect(arrayRes.code).toBe(0);
      const parsedArr = JSON.parse(arrayRes.out.trim()) as {
        result: number[];
        ai_disclosure: { disclosed: boolean; article: string };
      };
      expect(parsedArr.result).toEqual([1, 2, 3]);
      expect(parsedArr.ai_disclosure.disclosed).toBe(true);
      expect(parsedArr.ai_disclosure.article).toBe("EU-AI-ACT-Art.50");

      // 4. Unparseable --json stdout preserves raw stdout AND emits Art. 50(1) notice to stderr
      const badJsonStub = join(root, "bad-json.mjs");
      writeFileSync(badJsonStub, 'process.stdout.write("not valid json\\n");\n', "utf8");
      const badJsonRes = await captureWrites(() =>
        runRuntime(
          process.execPath,
          ["-p", "broken", "--json"],
          {},
          { config: regCfg, providerId: "zai", modelId: "glm-5.3", sessionId: "sess_badjson_01" },
          { runtimeScriptPath: badJsonStub, cwd: wsDir }
        )
      );
      expect(badJsonRes.code).toBe(0);
      expect(badJsonRes.out).toBe("not valid json\n");
      expect(badJsonRes.err).toContain("EU AI Act Art. 50");
      expect(badJsonRes.err).toContain("session=sess_badjson_01");
    } finally {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

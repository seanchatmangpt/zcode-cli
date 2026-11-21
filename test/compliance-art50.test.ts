import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

import { createTheme } from "../packages/zcode-tui/src/theme.ts";
import { WelcomeBanner } from "../packages/zcode-tui/src/welcome-banner.ts";
import { ComplianceRefusalError, parseComplianceConfigToml } from "../src/compliance/config.ts";
import {
  buildArt50DisclosureEnvelope,
  embedMarkdownProvenanceHeader,
  emitArt50DisclosureEvent,
  extractMarkdownProvenanceHeader,
  formatGitProvenanceTrailer,
  writeProvenanceSidecar
} from "../src/compliance/disclosure.ts";
import { Ocel2ComplianceBuilder, validateOcel2 } from "../src/compliance/ocel2.ts";
import { containsUnredactedSecretsOrPii } from "../src/compliance/redactor.ts";

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
});

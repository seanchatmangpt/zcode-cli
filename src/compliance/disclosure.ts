import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  ComplianceRefusalError,
  isRegulatedProfile,
  type ComplianceProfile,
  type ResolvedComplianceConfig
} from "./config.ts";
import {
  containsUnredactedSecretsOrPii,
  redactComplianceData,
  redactComplianceText,
  type RedactComplianceOptions
} from "./redactor.ts";

export interface Art50OcelSink {
  upsertObject(
    id: string,
    type: string,
    initialAttributes?: Record<string, string | number | boolean>,
    time?: string | number
  ): unknown;
  addO2O(sourceObjectId: string, qualifier: string, targetObjectId: string): unknown;
  recordEvent(input: {
    id: string;
    type: string;
    time?: string | number;
    attributes?: Record<string, string | number | boolean>;
    relationships?: Array<{ objectId: string; qualifier: string }>;
  }): unknown;
}

export interface Art50DisclosureInput {
  profile: ComplianceProfile;
  sessionId: string;
  provider?: string;
  model?: string;
  turnId?: string;
  traceId?: string;
  eventId?: string;
  seq?: number;
  channel?: "tui" | "headless-json" | "stream-json" | "app-server";
  notice?: string;
  disclosed?: boolean;
  workerNoticeAcknowledged?: boolean;
  timestamp?: string | number;
  redactPii?: boolean;
  redactOptions?: RedactComplianceOptions;
}

export interface Art50DisclosurePayload {
  article: "EU-AI-ACT-Art.50";
  regulation: "EU-2024-1689-Art.50";
  paragraphs: readonly ["50(1)", "50(2)"];
  disclosed: boolean;
  ai_generated: true;
  notice: string;
  provider: string;
  provider_id: string;
  model: string;
  model_id: string;
  compliance_profile: ComplianceProfile;
  channel: string;
  machine_readable_marking: true;
  worker_notice_acknowledged: boolean;
  timestamp: string;
}

export interface Art50DisclosureEnvelope {
  type: "system.disclosure";
  eventId: string;
  sessionId: string;
  turnId?: string;
  traceId?: string;
  seq?: number;
  timestamp: string;
  payload: {
    ai_disclosure: Art50DisclosurePayload;
  };
  ai_disclosure: Art50DisclosurePayload;
}

const DEFAULT_ART50_NOTICE =
  "AI System (EU AI Act Art. 50): You are interacting with an AI coding assistant. Outputs may be AI-generated or AI-modified.";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeIso(timestamp?: string | number): string {
  if (timestamp === undefined) return new Date().toISOString();
  if (typeof timestamp === "number") {
    if (!Number.isFinite(timestamp)) {
      throw new ComplianceRefusalError(
        "DISCLOSURE_REQUIRED",
        `Invalid numeric timestamp: ${String(timestamp)}`,
        "mu_on_O"
      );
    }
    return new Date(timestamp).toISOString();
  }
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new ComplianceRefusalError(
      "DISCLOSURE_REQUIRED",
      `Invalid ISO timestamp '${timestamp}'.`,
      "mu_on_O"
    );
  }
  return timestamp;
}

export function buildArt50DisclosureEnvelope(
  input: Art50DisclosureInput
): Art50DisclosureEnvelope {
  const regulated = isRegulatedProfile(input.profile);
  const sessionId = input.sessionId?.trim() ?? "";
  if (!sessionId) {
    throw new ComplianceRefusalError(
      "DISCLOSURE_REQUIRED",
      "EU AI Act Art. 50 disclosure requires a non-empty sessionId.",
      "R_missing_identity"
    );
  }

  if (regulated) {
    if (input.disclosed === false) {
      throw new ComplianceRefusalError(
        "DISCLOSURE_REQUIRED",
        `Profile '${input.profile}' forbids suppressing AI interaction disclosure.`,
        "admission_vacuous"
      );
    }
    if (input.workerNoticeAcknowledged === false) {
      throw new ComplianceRefusalError(
        "DISCLOSURE_REQUIRED",
        `Profile '${input.profile}' requires worker_notice_acknowledged = true (Art. 26(7)/50).`,
        "admission_vacuous"
      );
    }
    if (input.notice !== undefined && input.notice.trim().length === 0) {
      throw new ComplianceRefusalError(
        "DISCLOSURE_REQUIRED",
        `Profile '${input.profile}' forbids blank Art. 50 disclosure notice.`,
        "admission_vacuous"
      );
    }
    if (!input.provider?.trim() || !input.model?.trim()) {
      throw new ComplianceRefusalError(
        "DISCLOSURE_REQUIRED",
        `Profile '${input.profile}' requires non-empty provider and model for Art. 50 disclosure.`,
        "R_missing_identity"
      );
    }
  }

  const timestamp = normalizeIso(input.timestamp);
  const redactOpts: RedactComplianceOptions = {
    ...input.redactOptions,
    redactPii: input.redactPii ?? input.redactOptions?.redactPii ?? true
  };

  const resolvedProvider = input.provider?.trim() || "unknown";
  const resolvedModel = input.model?.trim() || "unknown";
  const rawPayload: Art50DisclosurePayload = {
    article: "EU-AI-ACT-Art.50",
    regulation: "EU-2024-1689-Art.50",
    paragraphs: ["50(1)", "50(2)"],
    disclosed: input.disclosed !== false,
    ai_generated: true,
    notice: (input.notice ?? DEFAULT_ART50_NOTICE).trim() || DEFAULT_ART50_NOTICE,
    provider: resolvedProvider,
    provider_id: resolvedProvider,
    model: resolvedModel,
    model_id: resolvedModel,
    compliance_profile: input.profile,
    channel: input.channel ?? "headless-json",
    machine_readable_marking: true,
    worker_notice_acknowledged: input.workerNoticeAcknowledged ?? true,
    timestamp
  };

  const safePayload = redactComplianceData(rawPayload, redactOpts);
  const safeSessionId = redactComplianceText(sessionId, redactOpts);
  const safeTurnId = input.turnId ? redactComplianceText(input.turnId, redactOpts) : undefined;
  const safeTraceId = input.traceId ? redactComplianceText(input.traceId, redactOpts) : undefined;

  const envelope: Art50DisclosureEnvelope = {
    type: "system.disclosure",
    eventId: input.eventId ?? randomUUID(),
    sessionId: safeSessionId,
    ...(safeTurnId ? { turnId: safeTurnId } : {}),
    ...(safeTraceId ? { traceId: safeTraceId } : {}),
    ...(input.seq !== undefined ? { seq: input.seq } : {}),
    timestamp,
    payload: { ai_disclosure: safePayload },
    ai_disclosure: safePayload
  };

  if (containsUnredactedSecretsOrPii(JSON.stringify(envelope), redactOpts)) {
    throw new ComplianceRefusalError(
      "REDACTION_FAILURE",
      "Unredacted secret or PII remained in Art. 50 disclosure envelope.",
      "R_missing_consequence"
    );
  }

  return envelope;
}

export interface EmittedArt50DisclosureResult {
  envelope: Art50DisclosureEnvelope;
  noticeSha256: string;
  disclosureObjectId: string;
  profileObjectId: string;
  event: unknown;
}

export function emitArt50DisclosureEvent(
  sink: Art50OcelSink,
  input: Art50DisclosureInput
): EmittedArt50DisclosureResult {
  const envelope = buildArt50DisclosureEnvelope(input);
  const noticeSha256 = sha256Hex(JSON.stringify(envelope.ai_disclosure));
  const disclosureObjectId = `disclosure_${envelope.eventId}`;
  const profileObjectId = `profile_${input.profile}`;

  sink.upsertObject(envelope.sessionId, "session", {
    compliance_profile: input.profile
  }, envelope.timestamp);

  sink.upsertObject(
    disclosureObjectId,
    "disclosure_notice",
    {
      article: "50(1)",
      provider: envelope.ai_disclosure.provider,
      model: envelope.ai_disclosure.model,
      compliance_profile: input.profile,
      notice_sha256: noticeSha256
    },
    envelope.timestamp
  );

  sink.upsertObject(
    profileObjectId,
    "compliance_profile",
    { profile: input.profile },
    envelope.timestamp
  );

  const relationships: Array<{ objectId: string; qualifier: string }> = [
    { objectId: envelope.sessionId, qualifier: "in_session" },
    { objectId: profileObjectId, qualifier: "governs" },
    { objectId: disclosureObjectId, qualifier: "about_disclosure" }
  ];

  if (envelope.turnId) {
    sink.upsertObject(envelope.turnId, "turn", undefined, envelope.timestamp);
    relationships.push({ objectId: envelope.turnId, qualifier: "in_turn" });
  }

  sink.addO2O(profileObjectId, "governs", envelope.sessionId);
  sink.addO2O(disclosureObjectId, "in_session", envelope.sessionId);

  const event = sink.recordEvent({
    id: envelope.eventId,
    type: "art50_disclosure_emitted",
    time: envelope.timestamp,
    attributes: {
      channel: envelope.ai_disclosure.channel,
      regulation: "EU-2024-1689-Art50",
      provider_id: envelope.ai_disclosure.provider,
      model_id: envelope.ai_disclosure.model,
      compliance_profile: input.profile,
      notice_sha256: noticeSha256
    },
    relationships
  });

  return {
    envelope,
    noticeSha256,
    disclosureObjectId,
    profileObjectId,
    event
  };
}

export interface ModifiedFileSpanInput {
  filePath: string;
  startLine?: number;
  endLine?: number;
  content?: string;
}

export interface ProvenanceSpanRecord {
  path: string;
  sha256: string;
  bytes: number;
  startLine?: number;
  endLine?: number;
}

export interface WriteProvenanceSidecarOptions {
  sessionId: string;
  workspaceDir: string;
  outputDir?: string;
  provider: string;
  model: string;
  profile: ComplianceProfile;
  ocelHeadHash?: string;
  modifiedSpans: readonly ModifiedFileSpanInput[];
  timestamp?: string | number;
  redactPii?: boolean;
  redactOptions?: RedactComplianceOptions;
  ocelSink?: Art50OcelSink;
}

export interface ProvenanceSidecarDocument {
  schema_version: "1.0";
  article: "EU-AI-ACT-Art.50(2)";
  session_id: string;
  compliance_profile: ComplianceProfile;
  provider: string;
  model: string;
  ocel_head_hash: string;
  generated_at: string;
  modified_spans: ProvenanceSpanRecord[];
  span_count: number;
  seal_sha256: string;
}

export interface ProvenanceSidecarResult {
  sidecarPath: string;
  document: ProvenanceSidecarDocument;
}

function assertSafeSessionId(sessionId: string): string {
  const trimmed = sessionId?.trim() ?? "";
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    !/^[A-Za-z0-9._-]+$/u.test(trimmed)
  ) {
    throw new ComplianceRefusalError(
      "PROVENANCE_SEAL_FAILED",
      `Unsafe or invalid sessionId for provenance sidecar: '${sessionId}'.`,
      "R_missing_identity"
    );
  }
  return trimmed;
}

export function writeProvenanceSidecar(
  options: WriteProvenanceSidecarOptions
): ProvenanceSidecarResult {
  const sessionId = assertSafeSessionId(options.sessionId);
  const regulated = isRegulatedProfile(options.profile);
  const provider = options.provider?.trim() ?? "";
  const model = options.model?.trim() ?? "";
  const ocelHeadHash = options.ocelHeadHash?.trim() ?? "";

  if (regulated && (!provider || !model || !ocelHeadHash)) {
    throw new ComplianceRefusalError(
      "PROVENANCE_SEAL_FAILED",
      `Profile '${options.profile}' requires non-empty provider, model, and ocelHeadHash to seal Art. 50(2) provenance.`,
      "R_missing_identity"
    );
  }

  const redactOpts: RedactComplianceOptions = {
    ...options.redactOptions,
    redactPii: options.redactPii ?? options.redactOptions?.redactPii ?? true
  };
  const generatedAt = normalizeIso(options.timestamp);
  const workspaceResolved = resolve(options.workspaceDir);
  let workspaceReal: string;
  try {
    workspaceReal = realpathSync(workspaceResolved);
  } catch (err) {
    throw new ComplianceRefusalError(
      "PROVENANCE_SEAL_FAILED",
      `Cannot resolve workspaceDir '${options.workspaceDir}': ${
        err instanceof Error ? err.message : String(err)
      }`,
      "R_missing_identity"
    );
  }

  const isInsideWorkspace = (base: string, target: string, allowEqual = false): boolean => {
    const rel = relative(base, target);
    if (!rel || rel === ".") return allowEqual;
    return !rel.startsWith("..") && !isAbsolute(rel);
  };

  const spanRecords: ProvenanceSpanRecord[] = [];

  for (const span of options.modifiedSpans) {
    let absPath: string;
    if (isAbsolute(span.filePath)) {
      const rawAbs = resolve(span.filePath);
      if (isInsideWorkspace(workspaceResolved, rawAbs, false)) {
        absPath = resolve(workspaceReal, relative(workspaceResolved, rawAbs));
      } else if (isInsideWorkspace(workspaceReal, rawAbs, false)) {
        absPath = rawAbs;
      } else {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Modified file path '${span.filePath}' escapes workspaceDir '${options.workspaceDir}'.`,
          "mu_unlawful"
        );
      }
    } else {
      absPath = resolve(workspaceReal, span.filePath);
      if (!isInsideWorkspace(workspaceReal, absPath, false)) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Modified file path '${span.filePath}' escapes workspaceDir '${options.workspaceDir}'.`,
          "mu_unlawful"
        );
      }
    }

    // Walk every intermediate segment from workspaceReal down to absPath with lstatSync
    // so symlinks (including dangling symlinks) targeting outside workspaceReal are rejected
    // even when inline span.content is provided.
    const relSegments = relative(workspaceReal, absPath).split(sep).filter(Boolean);
    let cursor = workspaceReal;
    let missingOnDisk = false;
    for (let i = 0; i < relSegments.length; i++) {
      cursor = join(cursor, relSegments[i]!);
      const isLast = i === relSegments.length - 1;
      let st;
      try {
        st = lstatSync(cursor);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") {
          missingOnDisk = true;
          break;
        }
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Cannot inspect path segment '${cursor}' for '${span.filePath}': ${
            err instanceof Error ? err.message : String(err)
          }`,
          "mu_unlawful"
        );
      }
      if (st.isSymbolicLink()) {
        let symReal: string;
        try {
          symReal = realpathSync(cursor);
        } catch {
          throw new ComplianceRefusalError(
            "PROVENANCE_SEAL_FAILED",
            `Modified file path '${span.filePath}' traverses a dangling or unresolvable symlink.`,
            "mu_unlawful"
          );
        }
        if (!isInsideWorkspace(workspaceReal, symReal, !isLast)) {
          throw new ComplianceRefusalError(
            "PROVENANCE_SEAL_FAILED",
            `Modified file path '${span.filePath}' resolves outside workspaceDir via symlink.`,
            "mu_unlawful"
          );
        }
      }
    }

    let targetPathForRel = absPath;
    if (!missingOnDisk || span.content === undefined) {
      let targetReal: string;
      try {
        targetReal = realpathSync(absPath);
      } catch (err) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Cannot resolve modified file '${absPath}' for provenance hashing: ${
            err instanceof Error ? err.message : String(err)
          }`,
          "R_missing_consequence"
        );
      }
      if (!isInsideWorkspace(workspaceReal, targetReal, false)) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Modified file path '${span.filePath}' resolves outside workspaceDir via symlink or traversal.`,
          "mu_unlawful"
        );
      }
      targetPathForRel = targetReal;
    }

    let text: string;
    if (span.content !== undefined) {
      text = span.content;
    } else {
      try {
        text = readFileSync(targetPathForRel, "utf8");
      } catch (err) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Cannot read modified file '${absPath}' for provenance hashing: ${
            err instanceof Error ? err.message : String(err)
          }`,
          "R_missing_consequence"
        );
      }
    }

    let sliceText = text;
    if (span.startLine !== undefined || span.endLine !== undefined) {
      const rawLines = text.split(/\r?\n/);
      const lines =
        rawLines.length > 1 && rawLines[rawLines.length - 1] === ""
          ? rawLines.slice(0, -1)
          : rawLines;
      const start = span.startLine ?? 1;
      const end = span.endLine ?? lines.length;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start ||
        end > lines.length
      ) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Invalid line span [${String(span.startLine)}, ${String(span.endLine)}] for '${span.filePath}' (${lines.length} lines).`,
          "mu_on_O"
        );
      }
      sliceText = lines.slice(start - 1, end).join("\n");
    }

    const relPath = relative(workspaceReal, targetPathForRel).replaceAll("\\", "/");
    const safeRelPath = redactComplianceText(relPath, redactOpts);
    spanRecords.push({
      path: safeRelPath,
      sha256: sha256Hex(sliceText),
      bytes: Buffer.byteLength(sliceText, "utf8"),
      ...(span.startLine !== undefined ? { startLine: span.startLine } : {}),
      ...(span.endLine !== undefined ? { endLine: span.endLine } : {})
    });
  }

  const unsealed = redactComplianceData(
    {
      schema_version: "1.0" as const,
      article: "EU-AI-ACT-Art.50(2)" as const,
      session_id: sessionId,
      compliance_profile: options.profile,
      provider: provider || "unknown",
      model: model || "unknown",
      ocel_head_hash: ocelHeadHash,
      generated_at: generatedAt,
      modified_spans: spanRecords,
      span_count: spanRecords.length
    },
    redactOpts
  );

  if (containsUnredactedSecretsOrPii(JSON.stringify(unsealed), redactOpts)) {
    throw new ComplianceRefusalError(
      "PROVENANCE_SEAL_FAILED",
      "Unredacted secrets or PII remained in provenance sidecar metadata.",
      "R_missing_consequence"
    );
  }

  const sealSha256 = sha256Hex(JSON.stringify(unsealed));
  const document: ProvenanceSidecarDocument = {
    ...unsealed,
    seal_sha256: sealSha256
  };

  const targetDir = options.outputDir ?? join(options.workspaceDir, ".zcode-provenance");
  let writeDir = options.outputDir ?? join(workspaceReal, ".zcode-provenance");

  if (options.outputDir === undefined) {
    try {
      const st = lstatSync(writeDir);
      if (st.isSymbolicLink()) {
        let symReal: string;
        try {
          symReal = realpathSync(writeDir);
        } catch {
          throw new ComplianceRefusalError(
            "PROVENANCE_SEAL_FAILED",
            "Provenance directory '.zcode-provenance' is a dangling or unresolvable symlink.",
            "mu_unlawful"
          );
        }
        if (!isInsideWorkspace(workspaceReal, symReal, false)) {
          throw new ComplianceRefusalError(
            "PROVENANCE_SEAL_FAILED",
            "Provenance directory '.zcode-provenance' resolves outside workspaceDir via symlink.",
            "mu_unlawful"
          );
        }
        writeDir = symReal;
      } else if (!st.isDirectory()) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          "Provenance directory '.zcode-provenance' exists and is not a directory.",
          "mu_unlawful"
        );
      }
    } catch (err) {
      if (err instanceof ComplianceRefusalError) throw err;
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Cannot inspect provenance directory '.zcode-provenance': ${
            err instanceof Error ? err.message : String(err)
          }`,
          "mu_unlawful"
        );
      }
    }
  } else {
    try {
      const st = lstatSync(writeDir);
      if (st.isSymbolicLink()) {
        try {
          realpathSync(writeDir);
        } catch {
          throw new ComplianceRefusalError(
            "PROVENANCE_SEAL_FAILED",
            `Provenance outputDir '${writeDir}' is a dangling or unresolvable symlink.`,
            "mu_unlawful"
          );
        }
      }
    } catch (err) {
      if (err instanceof ComplianceRefusalError) throw err;
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Cannot inspect provenance outputDir '${writeDir}': ${
            err instanceof Error ? err.message : String(err)
          }`,
          "mu_unlawful"
        );
      }
    }
  }

  const sidecarPath = join(targetDir, `${sessionId}.json`);
  const writeSidecarPath = join(writeDir, `${sessionId}.json`);
  const tmpPath = join(writeDir, `.${sessionId}.${process.pid}.${randomUUID()}.tmp`);

  try {
    mkdirSync(writeDir, { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(document, null, 2) + "\n", "utf8");
    renameSync(tmpPath, writeSidecarPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw new ComplianceRefusalError(
      "PROVENANCE_SEAL_FAILED",
      `Failed writing provenance sidecar '${sidecarPath}': ${
        err instanceof Error ? err.message : String(err)
      }`,
      "R_missing_consequence"
    );
  }

  if (options.ocelSink) {
    let realSidecarPath = writeSidecarPath;
    try {
      realSidecarPath = realpathSync(writeSidecarPath);
    } catch {
      // fallback to writeSidecarPath
    }
    const baseForRel =
      options.outputDir === undefined || isInsideWorkspace(workspaceReal, realSidecarPath, false)
        ? workspaceReal
        : workspaceResolved;
    const safeSidecarRel = redactComplianceText(
      relative(baseForRel, realSidecarPath).replaceAll("\\", "/"),
      redactOpts
    );
    const artifactId = `prov_${sessionId}_${sealSha256.slice(0, 12)}`;
    options.ocelSink.upsertObject(sessionId, "session", undefined, generatedAt);
    options.ocelSink.upsertObject(
      artifactId,
      "provenance_artifact",
      {
        sidecar_path: safeSidecarRel,
        seal_sha256: sealSha256
      },
      generatedAt
    );
    options.ocelSink.addO2O(artifactId, "seals", sessionId);
    options.ocelSink.recordEvent({
      id: `prov_evt_${randomUUID()}`,
      type: "provenance_marked",
      time: generatedAt,
      attributes: {
        sidecar_path: safeSidecarRel,
        seal_sha256: sealSha256,
        span_count: String(spanRecords.length)
      },
      relationships: [
        { objectId: sessionId, qualifier: "in_session" },
        { objectId: artifactId, qualifier: "seals" }
      ]
    });
  }

  return { sidecarPath, document };
}

export interface GitProvenanceTrailerOptions {
  enabled?: boolean;
  config?: ResolvedComplianceConfig;
  profile?: ComplianceProfile;
  cliVersion?: string;
  provider?: string;
  model?: string;
  sessionId?: string;
}

function sanitizeTrailerToken(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").trim();
}

export function formatGitProvenanceTrailer(
  options: GitProvenanceTrailerOptions
): string {
  const profile = options.profile ?? options.config?.compliance.profile ?? "standard";
  const enabled =
    options.enabled ??
    options.config?.compliance.git_provenance_trailer ??
    isRegulatedProfile(profile);

  if (!enabled) return "";

  const ver = sanitizeTrailerToken(options.cliVersion ?? "0.0.0") || "0.0.0";
  const provider = sanitizeTrailerToken(options.provider ?? "unknown") || "unknown";
  const model = sanitizeTrailerToken(options.model ?? "unknown") || "unknown";
  const safeProfile = sanitizeTrailerToken(profile);
  const safeSession = options.sessionId ? sanitizeTrailerToken(options.sessionId) : "";

  const parts = [`provider=${provider}`, `model=${model}`, `profile=${safeProfile}`];
  if (safeSession) parts.push(`session=${safeSession}`);
  return `AI-Generated-By: zcode-cli/${ver} (${parts.join("; ")})`;
}

export interface MarkdownProvenanceHeader {
  article: "EU-AI-ACT-Art.50(2)";
  generator: string;
  provider: string;
  model: string;
  profile: ComplianceProfile;
  sessionId: string;
  generatedAt: string;
  contentSha256: string;
}

export interface MarkdownProvenanceOptions {
  profile: ComplianceProfile;
  provider: string;
  model: string;
  sessionId: string;
  cliVersion?: string;
  generatedAt?: string | number;
  redactPii?: boolean;
  redactOptions?: RedactComplianceOptions;
}

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/;
const PROVENANCE_COMMENT_RE = /<!--\s*zcode:provenance:v1\s+(\{[^\r\n]*?\})\s*-->\r?\n?/g;

export function extractMarkdownProvenanceHeader(
  markdown: string
): MarkdownProvenanceHeader | null {
  const re = new RegExp(PROVENANCE_COMMENT_RE.source);
  const match = re.exec(markdown);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as MarkdownProvenanceHeader;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.article === "EU-AI-ACT-Art.50(2)" &&
      typeof parsed.contentSha256 === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function embedMarkdownProvenanceHeader(
  markdown: string,
  options: MarkdownProvenanceOptions
): string {
  const provider = options.provider?.trim() ?? "";
  const model = options.model?.trim() ?? "";
  const sessionId = options.sessionId?.trim() ?? "";

  if (isRegulatedProfile(options.profile) && (!provider || !model || !sessionId)) {
    throw new ComplianceRefusalError(
      "PROVENANCE_SEAL_FAILED",
      `Profile '${options.profile}' requires non-empty provider, model, and sessionId for Markdown provenance.`,
      "R_missing_identity"
    );
  }

  const existing = extractMarkdownProvenanceHeader(markdown);

  let frontmatter = "";
  let rest = markdown;
  const fmMatch = FRONTMATTER_RE.exec(markdown);
  if (fmMatch && fmMatch[1]) {
    frontmatter = fmMatch[1];
    rest = markdown.slice(frontmatter.length);
  }

  const strippedFrontmatter = frontmatter.replace(PROVENANCE_COMMENT_RE, "");
  const canonicalBody = rest.replace(PROVENANCE_COMMENT_RE, "");
  const contentSha256 = sha256Hex(canonicalBody);

  const redactOpts: RedactComplianceOptions = {
    ...options.redactOptions,
    redactPii: options.redactPii ?? options.redactOptions?.redactPii ?? true
  };

  const generator = `zcode-cli/${sanitizeTrailerToken(options.cliVersion ?? "0.0.0")}`;
  const safeProvider = redactComplianceText(provider || "unknown", redactOpts);
  const safeModel = redactComplianceText(model || "unknown", redactOpts);
  const safeSessionId = redactComplianceText(sessionId || "unknown", redactOpts);

  let generatedAt: string;
  if (options.generatedAt !== undefined) {
    generatedAt = normalizeIso(options.generatedAt);
  } else if (
    existing &&
    existing.contentSha256 === contentSha256 &&
    existing.provider === safeProvider &&
    existing.model === safeModel &&
    existing.profile === options.profile &&
    existing.sessionId === safeSessionId &&
    existing.generator === generator
  ) {
    generatedAt = existing.generatedAt;
  } else {
    generatedAt = new Date().toISOString();
  }

  const headerObj: MarkdownProvenanceHeader = {
    article: "EU-AI-ACT-Art.50(2)",
    generator,
    provider: safeProvider,
    model: safeModel,
    profile: options.profile,
    sessionId: safeSessionId,
    generatedAt,
    contentSha256
  };

  const jsonLine = JSON.stringify(headerObj)
    .replaceAll("-->", "--\\u003e")
    .replaceAll("--!>", "--!\\u003e");
  const commentLine = `<!-- zcode:provenance:v1 ${jsonLine} -->\n`;

  if (strippedFrontmatter) {
    const fmWithNewline = strippedFrontmatter.endsWith("\n")
      ? strippedFrontmatter
      : `${strippedFrontmatter}\n`;
    return `${fmWithNewline}${commentLine}${canonicalBody}`;
  }
  return `${commentLine}${canonicalBody}`;
}

export interface WorkspaceFileEntry {
  mtimeMs: number;
  size: number;
}

export type WorkspaceFileSnapshot = Map<string, WorkspaceFileEntry>;

const PROVENANCE_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".zcode-provenance",
  "node_modules",
  "dist",
  "target",
  ".next",
  ".cache",
  ".turbo"
]);

const DEFAULT_MAX_SNAPSHOT_FILES = 20_000;

export function snapshotWorkspaceFiles(
  workspaceDir: string,
  options?: { maxFiles?: number }
): WorkspaceFileSnapshot {
  const snapshot: WorkspaceFileSnapshot = new Map();
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_SNAPSHOT_FILES;
  let rootReal: string;
  try {
    rootReal = realpathSync(resolve(workspaceDir));
  } catch {
    return snapshot;
  }

  const stack: string[] = [rootReal];
  while (stack.length > 0 && snapshot.size < maxFiles) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (snapshot.size >= maxFiles) break;
      const fullPath = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (PROVENANCE_SKIP_DIRS.has(entry.name)) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const st = lstatSync(fullPath);
          if (!st.isFile() || st.isSymbolicLink()) continue;
          const relPath = relative(rootReal, fullPath).split(sep).join("/");
          snapshot.set(relPath, { mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // skip unreadable/vanished file
        }
      }
    }
  }
  return snapshot;
}

export function diffWorkspaceSnapshots(
  before: WorkspaceFileSnapshot,
  after: WorkspaceFileSnapshot
): string[] {
  const changed: string[] = [];
  for (const [relPath, afterEntry] of after.entries()) {
    const prev = before.get(relPath);
    if (!prev || prev.mtimeMs !== afterEntry.mtimeMs || prev.size !== afterEntry.size) {
      changed.push(relPath);
    }
  }
  changed.sort();
  return changed;
}

export interface RuntimeArt50ProvenanceOptions {
  workspaceDir: string;
  beforeSnapshot: WorkspaceFileSnapshot;
  sessionId: string;
  profile: ComplianceProfile;
  provider: string;
  model: string;
  ocelHeadHash?: string;
  cliVersion?: string;
  redactPii?: boolean;
  redactOptions?: RedactComplianceOptions;
  ocelSink?: Art50OcelSink;
}

export interface RuntimeArt50ProvenanceResult {
  sidecarPath: string;
  markedMarkdownFiles: string[];
  modifiedFiles: string[];
  document: ProvenanceSidecarDocument;
}

function isMarkdownFile(relPath: string): boolean {
  const ext = extname(relPath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

export function applyRuntimeArt50Provenance(
  options: RuntimeArt50ProvenanceOptions
): RuntimeArt50ProvenanceResult | null {
  if (!isRegulatedProfile(options.profile)) return null;

  const afterSnapshot = snapshotWorkspaceFiles(options.workspaceDir);
  const modifiedFiles = diffWorkspaceSnapshots(options.beforeSnapshot, afterSnapshot);
  if (modifiedFiles.length === 0) return null;

  const workspaceReal = realpathSync(resolve(options.workspaceDir));
  const markedMarkdownFiles: string[] = [];

  for (const relPath of modifiedFiles) {
    if (!isMarkdownFile(relPath)) continue;
    const absPath = resolve(workspaceReal, relPath);
    const content = readFileSync(absPath, "utf8");
    const marked = embedMarkdownProvenanceHeader(content, {
      profile: options.profile,
      provider: options.provider,
      model: options.model,
      sessionId: options.sessionId,
      cliVersion: options.cliVersion,
      redactPii: options.redactPii,
      redactOptions: options.redactOptions
    });
    if (marked !== content) {
      writeFileSync(absPath, marked, "utf8");
    }
    markedMarkdownFiles.push(relPath);
  }

  const effectiveHeadHash =
    options.ocelHeadHash?.trim() ||
    sha256Hex(
      JSON.stringify({
        article: "EU-AI-ACT-Art.50(2)",
        sessionId: options.sessionId,
        profile: options.profile,
        provider: options.provider,
        model: options.model
      })
    );

  const sidecar = writeProvenanceSidecar({
    sessionId: options.sessionId,
    workspaceDir: options.workspaceDir,
    provider: options.provider,
    model: options.model,
    profile: options.profile,
    ocelHeadHash: effectiveHeadHash,
    modifiedSpans: modifiedFiles.map((filePath) => ({ filePath })),
    redactPii: options.redactPii,
    redactOptions: options.redactOptions,
    ocelSink: options.ocelSink
  });

  return {
    sidecarPath: sidecar.sidecarPath,
    markedMarkdownFiles,
    modifiedFiles,
    document: sidecar.document
  };
}

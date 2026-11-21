/**
 * Optional castle publish court — require --public-anonymize on LinkedIn/gatekeeper targets.
 * Domain logic stays outside core; this adapter only enforces redaction flags when enabled.
 */

import { spawnSync } from "node:child_process";

import type { CourtVerdict, ExitCode, TransitionCourtAdapter } from "./types.ts";

export const DEFAULT_REQUIRE_PUBLIC_ANONYMIZE_ON = [
  "linkedin-carousel",
  "linkedin-newsletter",
  "linkedin-post",
  "gatekeeper-pack"
];

export interface CastlePublishOptions {
  requirePublicAnonymizeOn?: string[];
  castleBin?: string;
  run?: (cmd: string[], cwd: string) => { status: number | null; stdout: string; stderr: string };
}

export class CastlePublishCourtAdapter implements TransitionCourtAdapter {
  readonly name = "castle-publish";
  private readonly opts: Required<Pick<CastlePublishOptions, "requirePublicAnonymizeOn">> & CastlePublishOptions;

  constructor(opts: CastlePublishOptions = {}) {
    this.opts = {
      requirePublicAnonymizeOn: DEFAULT_REQUIRE_PUBLIC_ANONYMIZE_ON,
      castleBin: "castle",
      ...opts
    };
  }

  async validateWriteScope(_files: string[]): Promise<ExitCode> {
    return 0;
  }

  /**
   * Verify a planned castle publish argv includes --public-anonymize when target requires it.
   * Callers pass workspaceDir; planned argv may be supplied via env CASTLE_PUBLISH_ARGV (JSON array)
   * for dry verification without invoking castle.
   */
  async verifyPostTransition(workspaceDir: string): Promise<CourtVerdict> {
    const diagnostics: string[] = [];
    const digests: Record<string, string> = {};
    const raw = process.env.CASTLE_PUBLISH_ARGV?.trim();
    if (!raw) {
      return {
        exitCode: 3,
        standing: "UNVERIFIED",
        diagnostics: ["CASTLE_PUBLISH_ARGV unset — loud skip (no publish argv to court)"],
        artifactDigests: digests
      };
    }
    let argv: string[];
    try {
      argv = JSON.parse(raw) as string[];
    } catch {
      return {
        exitCode: 1,
        standing: "REFUSED",
        diagnostics: ["CASTLE_PUBLISH_ARGV is not a JSON array"],
        artifactDigests: digests
      };
    }
    const gate = assertPublicAnonymize(argv, this.opts.requirePublicAnonymizeOn);
    if (!gate.ok) {
      return {
        exitCode: 1,
        standing: "REFUSED",
        diagnostics: [gate.detail],
        artifactDigests: digests
      };
    }

    // Optional live invoke when CASTLE_PUBLISH_EXECUTE=1
    if (process.env.CASTLE_PUBLISH_EXECUTE === "1") {
      const bin = this.opts.castleBin ?? "castle";
      const run =
        this.opts.run ??
        ((cmd, cwd) => {
          const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", env: process.env });
          return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
        });
      const r = run([bin, ...argv], workspaceDir);
      if (r.status !== 0) {
        diagnostics.push(`castle publish exited ${r.status}: ${(r.stderr || r.stdout).slice(0, 400)}`);
        return { exitCode: 1, standing: "REFUSED", diagnostics, artifactDigests: digests };
      }
    }

    return { exitCode: 0, standing: "ALIVE", diagnostics, artifactDigests: digests };
  }
}

export function assertPublicAnonymize(
  argv: readonly string[],
  requiredOn: readonly string[]
): { ok: boolean; detail: string } {
  const targetIdx = argv.findIndex((a) => a === "--target" || a.startsWith("--target="));
  let target = "";
  if (targetIdx >= 0) {
    const a = argv[targetIdx]!;
    target = a.startsWith("--target=") ? a.slice("--target=".length) : (argv[targetIdx + 1] ?? "");
  }
  // Also accept positional after `publish`
  if (!target) {
    const pub = argv.indexOf("publish");
    if (pub >= 0 && argv[pub + 1] && !argv[pub + 1]!.startsWith("-")) target = argv[pub + 1]!;
  }
  const needs = requiredOn.some((t) => target === t || target.includes(t));
  if (!needs) return { ok: true, detail: "target does not require public-anonymize" };
  if (!argv.includes("--public-anonymize")) {
    return {
      ok: false,
      detail: `castle publish target "${target}" requires --public-anonymize (redaction court)`
    };
  }
  return { ok: true, detail: "public-anonymize present" };
}

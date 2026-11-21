/**
 * First-class `zcode foundry` CLI subcommand for HITL-free codebase finishing.
 *
 * Usage:
 *   zcode foundry --repo <path> [--repo <path>...] [--candidates <jsonl>] [--verify-cmd "<cmd>"]
 *                 [--max-cycles <N>] [--max-turns <N>] [--dry-run | --live]
 *                 [--auto-commit | --no-auto-commit] [--out-dir <path>]
 *   zcode foundry --all [--live | --dry-run]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  createZcodeAgentExecutor,
  detectRepoVerifyCommands,
  ReceiptSink,
  RepoVerifierCourtAdapter,
  runFoundryLoop,
  SjiraWorkOrderSource,
  worstExitCode,
  type ExitCode,
  type TransitionCourtAdapter
} from "./adapters/index.ts";

function parseAllReposFromToml(tomlPath: string): string[] {
  if (!existsSync(tomlPath)) return [];
  const text = readFileSync(tomlPath, "utf8");
  const repos: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*[a-zA-Z0-9_-]+_dir\s*=\s*"([^"]+)"/);
    if (m?.[1] && existsSync(m[1])) {
      repos.push(resolve(m[1]));
    }
  }
  return [...new Set(repos)];
}

function splitVerifyCmd(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

export async function runFoundryCommand(args: string[]): Promise<number | undefined> {
  if (args[0] !== "foundry") return undefined;

  const rest = args.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(
      [
        "Usage: zcode foundry [--repo <path>]... [--all] [--candidates <jsonl>]",
        "                     [--verify-cmd <cmd>] [--max-cycles <N>] [--max-turns <N>]",
        "                     [--dry-run | --live] [--auto-commit | --no-auto-commit]",
        "                     [--out-dir <path>]"
      ].join("\n")
    );
    return 0;
  }

  const repos: string[] = [];
  let runAll = false;
  let candidatesPath: string | undefined;
  let verifyCmdRaw: string | undefined;
  let maxCycles = 10;
  let maxTurns = 12;
  let live = false;
  let autoCommitFlag: boolean | undefined;
  let outDirOverride: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a === "--all") runAll = true;
    else if (a === "--live") live = true;
    else if (a === "--dry-run") live = false;
    else if (a === "--auto-commit") autoCommitFlag = true;
    else if (a === "--no-auto-commit") autoCommitFlag = false;
    else if (a === "--repo" && rest[i + 1]) {
      repos.push(resolve(rest[i + 1]!));
      i += 1;
    } else if (a === "--candidates" && rest[i + 1]) {
      candidatesPath = resolve(rest[i + 1]!);
      i += 1;
    } else if (a === "--verify-cmd" && rest[i + 1]) {
      verifyCmdRaw = rest[i + 1]!;
      i += 1;
    } else if (a === "--max-cycles" && rest[i + 1]) {
      maxCycles = Math.max(1, Number(rest[i + 1]!));
      i += 1;
    } else if (a === "--max-turns" && rest[i + 1]) {
      maxTurns = Math.max(1, Number(rest[i + 1]!));
      i += 1;
    } else if (a === "--out-dir" && rest[i + 1]) {
      outDirOverride = resolve(rest[i + 1]!);
      i += 1;
    }
  }

  if (runAll) {
    const tomlRepos = parseAllReposFromToml(resolve(process.cwd(), "zcode-cli.toml"));
    for (const r of tomlRepos) {
      if (!repos.includes(r)) repos.push(r);
    }
  }
  if (repos.length === 0) {
    repos.push(process.cwd());
  }

  const dryRun = !live;
  const autoCommitAlive = autoCommitFlag ?? live;
  const summaries: Array<Record<string, unknown>> = [];
  const exitCodes: ExitCode[] = [];

  for (const repoDir of repos) {
    if (!existsSync(repoDir)) {
      exitCodes.push(2);
      summaries.push({
        repo: repoDir,
        aggregateStanding: "BLOCKED",
        exitCode: 2,
        detail: `repo does not exist: ${repoDir}`
      });
      continue;
    }

    const outDir = outDirOverride
      ? repos.length > 1
        ? join(outDirOverride, basename(repoDir))
        : outDirOverride
      : join(repoDir, ".sjira", "foundry-out");
    mkdirSync(outDir, { recursive: true });

    const effectiveCandidates =
      candidatesPath ??
      (() => {
        const autoPath = join(outDir, "candidates.jsonl");
        if (!existsSync(autoPath)) {
          writeFileSync(
            autoPath,
            `${JSON.stringify({
              id: `FINISH-${basename(repoDir).toUpperCase()}`,
              label: `Finish and verify ${basename(repoDir)} cleanly without HITL`,
              objectType: "WorkOrder",
              standing: "UNKNOWN"
            })}\n`
          );
        }
        return autoPath;
      })();

    const verifyCommands = verifyCmdRaw
      ? [splitVerifyCmd(verifyCmdRaw)]
      : detectRepoVerifyCommands(repoDir);

    const courts: TransitionCourtAdapter[] = [];
    if (verifyCommands.length > 0 && !dryRun) {
      courts.push(new RepoVerifierCourtAdapter({ commands: verifyCommands }));
    }

    const source = new SjiraWorkOrderSource({
      cwd: repoDir,
      candidatesPath: effectiveCandidates,
      ledgerPath: join(outDir, "ledger.jsonl"),
      outDir,
      enforceMinGgenAncestor: false
    });

    const sink = new ReceiptSink({
      ledgerPath: join(outDir, "sink-ledger.jsonl"),
      outDir,
      dfcmReceiptPath: join(outDir, "dfcm-receipt.json"),
      cwd: repoDir
    });

    const priorDiagnostics = new Map<string, string>();
    const executor = dryRun
      ? undefined
      : createZcodeAgentExecutor({
          workspaceDir: repoDir,
          maxTurns,
          logDir: join(outDir, "logs"),
          repoInstructions: verifyCommands.map((c) => c.join(" ")).join(" && "),
          priorDiagnostics
        });

    const result = await runFoundryLoop({
      source,
      courts,
      sink,
      workspaceDir: repoDir,
      dryRun,
      sandbox: dryRun,
      maxCycles: dryRun ? 1 : maxCycles,
      untilDrained: true,
      transactionalRollback: !dryRun,
      autoCommitAlive,
      priorDiagnostics,
      executor,
      outputDir: join(outDir, "ocel")
    });

    exitCodes.push(result.exitCode);
    summaries.push({
      repo: repoDir,
      dryRun,
      aggregateStanding: result.aggregateStanding,
      exitCode: result.exitCode,
      converged: result.converged,
      retryBudgetExhausted: result.retryBudgetExhausted,
      cycles: result.cycles.length,
      commitsCreated: result.commitsCreated,
      loopReceipt: join(outDir, "loop_receipt.json")
    });
  }

  const finalExit = worstExitCode(exitCodes);
  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "live",
        exitCode: finalExit,
        repos: summaries
      },
      null,
      2
    )
  );
  return finalExit;
}

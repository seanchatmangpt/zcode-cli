import { readFileSync } from "node:fs";
import { cliSettingsPath } from "./config-paths.ts";

/**
 * `--max-turns N` launcher flag. The app-server protocol has no maxTurns
 * field, so the flag is lowered to env ZCODE_MAX_TURNS, which the sync-runtime
 * max-turns patch reads inside runRegularTurnLoop.
 */
export interface MaxTurnsExtraction {
  args: string[];
  maxTurns?: number;
  error?: string;
}

export function extractMaxTurns(args: string[]): MaxTurnsExtraction {
  const out: string[] = [];
  let maxTurns: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--") { out.push(...args.slice(i)); break; }
    let raw: string | undefined;
    if (a === "--max-turns") { raw = args[i + 1]; i += 1; }
    else if (a.startsWith("--max-turns=")) raw = a.slice("--max-turns=".length);
    else { out.push(a); continue; }
    if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) {
      return { args, error: "--max-turns requires a positive integer" };
    }
    maxTurns = Number(raw);
  }
  return { args: out, ...(maxTurns !== undefined ? { maxTurns } : {}) };
}

/**
 * Subagent turn cap. Upstream hardcodes the child-session default to 4 turns
 * (spawn site: `maxTurns:request.maxTurns ?? this.config.subagents?.maxTurns
 * ?? 4`), and the settings→runtime-patch mapper drops the `subagents` block,
 * so `subagents.maxTurns` in setting.json never reaches it. The sync-runtime
 * subagent-max-turns patch extends the fallback with env
 * ZCODE_SUBAGENT_MAX_TURNS; the launcher lowers setting.json
 * `subagents.maxTurns` into that env here. Explicit env wins over the file;
 * unset or malformed values leave the upstream default (4) in charge.
 */
export function readSubagentMaxTurnsSetting(settingsPath: string): number | undefined {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      subagents?: { maxTurns?: unknown };
    };
    const raw = parsed.subagents?.maxTurns;
    return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSubagentMaxTurnsEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.ZCODE_SUBAGENT_MAX_TURNS?.trim();
  if (explicit) return explicit;
  return readSubagentMaxTurnsSetting(cliSettingsPath(env))?.toString();
}

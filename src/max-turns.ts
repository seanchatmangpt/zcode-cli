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

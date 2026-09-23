// Resolve a Node.js interpreter capable of running the vendored runtime.
//
// The 3.14+ vendored runtime requires node >= 22.19 (engines; node:sqlite).
// The first `node` on the dispatcher's PATH may be older (e.g. a system
// node 20), and `process.execPath` may be an unrelated host (bun) -- either
// would crash the runtime at boot with "No such built-in module:
// node:sqlite" before any turn starts. Resolution order:
//   1. explicit override (argument, e.g. ZCODE_NODE)
//   2. the current process executable, when it is a new-enough node
//   3. well-known Homebrew / system node installs (first with major >= 22)
// Throws typed when nothing capable is found: the caller refuses the turn
// instead of dispatching a runtime that cannot boot.
import { spawnSync } from "node:child_process";

const MIN_MAJOR = 22;

const candidatePaths = (): string[] => {
  const seen = new Set<string>();
  for (const candidate of [
    "/opt/homebrew/opt/node/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    "node"
  ]) {
    if (candidate) seen.add(candidate);
  }
  return [...seen];
};

function nodeMajor(candidate: string): number | undefined {
  try {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 10_000 });
    if (probe.status !== 0) return undefined;
    const major = Number(/^v(\d+)/u.exec((probe.stdout ?? "").trim())?.[1] ?? 0);
    return Number.isFinite(major) && major > 0 ? major : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pick a node interpreter able to boot the vendored runtime. `override` is
 * used verbatim when provided (it is an operator decision); otherwise the
 * current executable is used when it is already a new-enough node, then the
 * well-known install paths are probed.
 */
export function resolveRuntimeNode(override: string | undefined): string {
  if (override?.trim()) return override.trim();
  if (process.execPath && process.execPath.endsWith("node")) {
    const major = nodeMajor(process.execPath);
    if (major !== undefined && major >= MIN_MAJOR) return process.execPath;
  }
  for (const candidate of candidatePaths()) {
    if (candidate === process.execPath) continue;
    const major = nodeMajor(candidate);
    if (major !== undefined && major >= MIN_MAJOR) return candidate;
  }
  throw new Error(`No node >= ${MIN_MAJOR} found to run the vendored runtime (set ZCODE_NODE).`);
}

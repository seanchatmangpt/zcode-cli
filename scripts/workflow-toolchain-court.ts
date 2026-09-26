// ggen toolchain workflow court (v26.9.26).
//
// Extracted verbatim from test/release-workflows.test.ts so the court can be
// benchmarked (scripts/bench-toolchain-court.ts) and falsified from more than
// one test file. Pure SELECT over workflow YAML + package.json: authority NONE,
// it reads files and returns violations, it never edits or actuates anything.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse } from "yaml";

const root = resolve(import.meta.dir, "..");

export interface WorkflowStep {
  "continue-on-error"?: boolean | string;
  env?: Record<string, unknown>;
  shell?: string;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

export interface WorkflowJob {
  "continue-on-error"?: boolean | string;
  env?: Record<string, unknown>;
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, unknown>;
  permissions?: Record<string, string>;
  "runs-on"?: string | string[];
  steps: WorkflowStep[];
  "timeout-minutes"?: number;
}

export interface Workflow {
  env?: Record<string, unknown>;
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean;
  };
  jobs: Record<string, WorkflowJob>;
  on: Record<string, unknown>;
  permissions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// ggen toolchain court.
//
// Any job that runs a package script which sets ZCODE_REQUIRE_TOOLCHAINS=1
// (directly, or through scripts/build-release.ts, or through `bun run` of
// another such script) turns a missing ggen into a hard failure. Such a job
// must install the toolchain through the one composite action, after checkout
// and before the first toolchain-requiring step, and no workflow may carry an
// inline copy of the pins. Scheduled run 36186796685 (prepare-release.yml)
// failed with "ZCODE_REQUIRE_TOOLCHAINS=1 but toolchain missing: ggen" because
// its job had no install step while three other workflows each carried a copy.
// ---------------------------------------------------------------------------

export const toolchainAction = "./.github/actions/ggen-toolchain";
export const toolchainActionPath = resolve(root, ".github", "actions", "ggen-toolchain", "action.yml");
export const pinnedLinuxX64Sha256 = "9f1d689d26c5628aa695ab775f3045387f54d17c07abb8383caf0ad88a5c09e4";
export const pinnedMarketplaceSha = "5eb71f7ed947f705a8d6b145cb9b0be82855d793";
/** Pin material that may appear only inside the composite action. */
export const inlinePinMarkers = ["GGEN_SHA256", "GGEN_MARKETPLACE_SHA", pinnedLinuxX64Sha256, pinnedMarketplaceSha, "ggen/releases/download"];

export interface ToolchainViolation {
  workflow: string;
  job?: string;
  reason: string;
}

export interface WorkflowSubject {
  name: string;
  source: string;
  workflow: Workflow;
}

/** Package managers whose sub-commands can run a package.json script. */
const runners = new Set(["bun", "npm", "pnpm", "yarn"]);
/** Sub-commands that execute a named package script (the next non-flag word). */
const runVerbs = new Set(["run", "run-script", "rum", "urn"]);
/** npm/pnpm/yarn aliases for the package "test" script. `bun test` is bun's own runner, not the script. */
const testVerbs = new Set(["test", "t", "tst"]);
/**
 * Built-in sub-commands that never resolve to a package script. Any other first
 * word after `bun`/`pnpm`/`yarn` is treated as a script name (their shorthand
 * `bun <script>` / `pnpm <script>` / `yarn <script>` runs package.json scripts).
 */
const builtins: Record<string, Set<string>> = {
  bun: new Set(["test", "install", "i", "add", "a", "remove", "rm", "x", "build", "pm", "link", "unlink", "create", "c", "init", "upgrade", "publish", "outdated", "update", "patch", "exec", "repl", "why", "audit", "info"]),
  npm: new Set(),
  pnpm: new Set(["install", "i", "add", "remove", "rm", "exec", "dlx", "store", "update", "up", "why", "publish", "pack", "link", "audit", "outdated", "list", "ls", "config"]),
  yarn: new Set(["install", "add", "remove", "exec", "dlx", "why", "publish", "pack", "link", "config", "info", "cache", "workspace", "workspaces", "set", "up", "upgrade", "npm", "plugin"])
};

/**
 * Flags that consume the following word as their value (`bun --cwd . run x`,
 * `pnpm -C pkg run x`, `npm run -w pkg x`). A flag we list here that some tool
 * treats as boolean would make the value-skipping reading miss the verb, so the
 * tokenizer takes the union of both readings (see scriptRefs): fail-closed.
 */
const valueFlags = new Set(["--cwd", "--filter", "-F", "--prefix", "-C", "--dir", "--workspace", "-w", "--config"]);

/**
 * Shell grammar the court does not parse is flattened into command boundaries:
 * backslash-newline continuations are joined, and `$(`, backticks,
 * subshell/group brackets, `&`, `&&`, `||`, `;`, `|`, redirections (`<`, `>`)
 * and newlines all start a new segment. Quoting is read two ways and the union
 * is kept: quote characters as word breaks (so `bash -c "bun run x"` exposes its
 * inner command) and quote characters removed with backslash escapes resolved
 * (so `rel''ease:prepare` and `release\:prepare` read as the name the shell
 * would pass). Over-splitting can only add candidate names, never remove one.
 */
function shellSegments(command: string): string[][] {
  const joined = command.replace(/\\\r?\n/gu, " ");
  const readings = [joined.replace(/['"]/gu, " "), joined.replace(/\\(.)/gu, "$1").replace(/['"]/gu, "")];
  return readings.flatMap((flattened) =>
    flattened.split(/&&|\|\||\$\(|[;|&\n\r(){}`<>]/u).map((segment) => segment.trim().split(/\s+/u).filter((word) => word.length > 0))
  );
}

/** `bun`, `/usr/local/bin/bun`, `~/.bun/bin/bun` all name the runner `bun`. */
function runnerName(word: string): string | undefined {
  const base = word.slice(word.lastIndexOf("/") + 1);
  return runners.has(base) ? base : undefined;
}

/**
 * A script operand the court cannot resolve statically (`bun run $S`,
 * `bun run ${{ matrix.s }}`, an empty `bun run {}` template) could name any
 * script, so it gates the step: fail-closed.
 */
export const dynamicScriptRef = "<dynamic>";

/** Non-flag words after a runner; with `skipValues`, a value flag also drops the word after it. */
function operands(words: string[], skipValues: boolean): string[] {
  const out: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word.startsWith("-")) {
      if (skipValues && valueFlags.has(word)) index += 1;
      continue;
    }
    out.push(word);
  }
  return out;
}

function refsFromOperands(runner: string, rest: string[], refs: string[]): void {
  const verb = rest[0];
  if (verb === undefined) return;
  const name = (word: string) => (word.includes("$") ? dynamicScriptRef : word);
  if (verb.includes("$")) {
    refs.push(dynamicScriptRef);
  } else if (runVerbs.has(verb)) {
    if (rest[1] !== undefined) refs.push(name(rest[1]));
  } else if (runner !== "bun" && testVerbs.has(verb)) {
    refs.push("test");
  } else if (runner !== "npm" && !builtins[runner]!.has(verb)) {
    refs.push(verb);
  }
}

/** The pre-hardening court's reading (origin/main 1c28a6ae); kept so no shape it refused is ever re-admitted. */
const legacyRunRef = /\b(?:bun|npm|pnpm|yarn)\s+run\s+([\w:.-]+)/gu;

/**
 * Every package-script name a shell command may execute. It reads through shell
 * separators (`&&`, `||`, `;`, `|`, `&`, newlines), redirections (`>log`,
 * `2>&1`), subshells and command substitution (`( )`, `{ }`, `$( )`,
 * backticks), `sh -c "..."` strings, backslash line continuations and escapes,
 * quote-split names, runner paths (`~/.bun/bin/bun`), leading env assignments,
 * and flags (with or without values) before or after the verb; an operand it
 * cannot resolve is returned as `dynamicScriptRef`. Not modelled (residual,
 * refused nowhere): `eval`/`xargs` argument synthesis, shell functions and
 * aliases defined elsewhere in the same step. It over-approximates
 * on purpose: a returned word only matters if it is also a toolchain-requiring
 * script, so a spurious extra name can only gate a job, never un-gate one
 * (fail-closed). It is a superset of the pre-hardening regex reading.
 */
export function scriptRefs(command: string): string[] {
  const refs: string[] = [];
  for (const words of shellSegments(command)) {
    const at = words.findIndex((word) => runnerName(word) !== undefined);
    if (at < 0) continue;
    const runner = runnerName(words[at]!)!;
    const tail = words.slice(at + 1);
    refsFromOperands(runner, operands(tail, false), refs);
    refsFromOperands(runner, operands(tail, true), refs);
  }
  for (const text of [command, command.replace(/\\\r?\n/gu, " ").replace(/['"`]/gu, " ")]) {
    for (const match of text.matchAll(legacyRunRef)) refs.push(match[1]!);
  }
  return [...new Set(refs)];
}

/**
 * `ZCODE_REQUIRE_TOOLCHAINS=1`, also quoted (`="1"`, `='1'`), anywhere in a
 * command. A value the court cannot read statically (`=${{ ... }}`, `=$FLAG`)
 * may evaluate to 1, so it gates too: fail-closed.
 */
export function setsRequireToolchains(command: string): boolean {
  return (
    command.includes("ZCODE_REQUIRE_TOOLCHAINS=1") ||
    /\bZCODE_REQUIRE_TOOLCHAINS=(["']?)1\1(?![\w.])/u.test(command) ||
    /\bZCODE_REQUIRE_TOOLCHAINS=["']?\$/u.test(command)
  );
}

/** An env-map value of the flag: literal 1, or an expression/variable that may evaluate to 1. */
export function requireToolchainsValue(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return text === "1" || text.includes("$");
}

/** A step that runs the build script directly bypasses package.json but still needs ggen. */
const directToolchainEntrypoints = ["scripts/build-release.ts"];

/** Least fixed point: scripts that (transitively) run under ZCODE_REQUIRE_TOOLCHAINS=1. */
export function toolchainScripts(scripts: Record<string, string>): Set<string> {
  const requiring = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, command] of Object.entries(scripts)) {
      if (requiring.has(name)) continue;
      if (
        setsRequireToolchains(command) ||
        command.includes("scripts/build-release.ts") ||
        scriptRefs(command).some((ref) => requiring.has(ref) || ref === dynamicScriptRef)
      ) {
        requiring.add(name);
        changed = true;
      }
    }
  }
  return requiring;
}

export function requiresToolchain(step: WorkflowStep, job: WorkflowJob, workflow: Workflow, scripts: Set<string>): boolean {
  const flag = (env?: Record<string, unknown>) => requireToolchainsValue(env?.ZCODE_REQUIRE_TOOLCHAINS);
  if (step.run === undefined) return false;
  if (setsRequireToolchains(step.run) || flag(step.env) || flag(job.env) || flag(workflow.env)) return true;
  if (directToolchainEntrypoints.some((entry) => step.run!.includes(entry))) return true;
  return scriptRefs(step.run).some((ref) => scripts.has(ref) || ref === dynamicScriptRef);
}

/**
 * A step whose failure does not stop the job. `continue-on-error: true` (or any
 * expression that may evaluate true) lets a failed install fall through to the
 * toolchain-requiring step, which reproduces run 36186796685. Only an absent key
 * or a literal false keeps the install load-bearing.
 */
export function failureTolerated(subject: { "continue-on-error"?: boolean | string }): string | undefined {
  const value = subject["continue-on-error"];
  if (value === undefined || value === false || value === "false") return undefined;
  return String(value);
}

/**
 * Fail-stop must hold for the whole script. The first command is exactly
 * `set -euo pipefail` (comments and blank lines may precede it). After that,
 * every simple command (the script split at `;`, `&&`, `||`, `|`, `&`,
 * brackets and `then`/`do`/`else` keywords) is judged, and a script is refused
 * when any command:
 * - switches errexit/nounset/pipefail off: `set` with a `+` option carrying
 *   `e`/`u` or `+o errexit|nounset|pipefail` anywhere in its argument list
 *   (`set -x +e`, `set -o nounset +o errexit`), or `shopt -u -o`/`-uo` of them;
 * - hands a failure to something that does not stop the job: a `||` fallback
 *   that does not end in a non-zero `exit`, an `&&` list (errexit is suspended
 *   for every command left of `&&`), a `!`-negated command, an `if`/`elif`/
 *   `while`/`until` condition that is not a `[[`/`[`/`test`/`command -v` test,
 *   or a background `&` job;
 * - ends the script successfully early or replaces it: `exit`/`exit 0`,
 *   `return`/`return 0`, `exec <command>`, `eval`, `kill ... $$`, or a `trap`
 *   on ERR or whose action exits 0.
 * Residual (not modelled): functions and aliases defined in the same step.
 */
function simpleCommands(code: string): string[][] {
  const stripped = code.replace(/&&|\|\||\|&|>&|<&|&>/gu, (op) => (op === "&&" || op === "||" ? ` ${op} ` : " "));
  return stripped
    .split(/&&|\|\||[;|&(){}`]/u)
    .map((segment) => segment.trim().split(/\s+/u).filter((word) => word.length > 0))
    .filter((words) => words.length > 0);
}

const relaxedOptions = new Set(["errexit", "nounset", "pipefail"]);
const conditionKeywords = new Set(["if", "elif", "while", "until"]);
const leadingKeywords = new Set(["then", "do", "else", "time"]);
const conditionTests = new Set(["[[", "[", "test", "command"]);

function relaxes(words: string[]): boolean {
  const [head, ...args] = words;
  if (head === "set") {
    return args.some((arg, index) => {
      if (!/^\+[a-zA-Z]+$/u.test(arg)) return false;
      if (/[eu]/u.test(arg)) return true;
      return arg.endsWith("o") && relaxedOptions.has(args[index + 1] ?? "");
    });
  }
  if (head === "shopt") {
    const flags = args.filter((arg) => arg.startsWith("-")).join("");
    return flags.includes("u") && flags.includes("o") && args.some((arg) => relaxedOptions.has(arg));
  }
  return false;
}

function failStopViolations(label: string, run: string): string[] {
  const violations: string[] = [];
  const add = (reason: string) => {
    if (!violations.includes(reason)) violations.push(reason);
  };
  const commands = run
    .replace(/\\\r?\n/gu, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (commands[0] !== "set -euo pipefail") {
    add(`step ${label} does not start fail-stop (set -euo pipefail)`);
  }
  for (const command of commands) {
    const code = command.replace(/\s#.*$/u, "");
    for (const fallback of code.split("||").slice(1)) {
      if (!/\bexit\s+(?:[1-9]\d*|"?\$\?"?)/u.test(fallback)) {
        add(`step ${label} swallows a failure (|| true)`);
        break;
      }
    }
    if (code.includes("&&")) add(`step ${label} suspends errexit in an && list (${command})`);
    if (/(?<![&|>]|[<>]\s*)&(?![&>])/u.test(code.replace(/\d?>&\d|&>|>&|<&|\|&/gu, " "))) {
      add(`step ${label} backgrounds a command (${command})`);
    }
    for (const raw of simpleCommands(code)) {
      let words = raw;
      while (words.length > 0 && leadingKeywords.has(words[0]!)) words = words.slice(1);
      if (words.length > 0 && conditionKeywords.has(words[0]!)) {
        words = words.slice(1);
        if (words.length > 0 && !conditionTests.has(words[0]!) && words[0] !== "!") {
          add(`step ${label} runs a command as a condition, suspending errexit (${command})`);
        }
      }
      const [head, ...args] = words;
      if (head === undefined) continue;
      if (relaxes(words)) add(`step ${label} relaxes fail-stop (${command})`);
      if (head === "!") add(`step ${label} negates a command status, suspending errexit (${command})`);
      if ((head === "exit" || head === "return") && (args.length === 0 || args[0] === "0")) {
        add(`step ${label} exits successfully early (${command})`);
      }
      if ((head === "exec" && args.length > 0 && !/^\d*[<>]/u.test(args[0]!)) || head === "eval" || (head === "kill" && args.includes("$$"))) {
        add(`step ${label} replaces or ends the shell (${command})`);
      }
      if (head === "trap" && (args.includes("ERR") || /\bexit(?:\s+0)?\s*['"]?(?:\s|$)/u.test(args.join(" ")))) {
        add(`step ${label} traps a failure (${command})`);
      }
    }
  }
  return violations;
}

/**
 * The only shell a composite run step may use. GitHub runs `shell: bash` as
 * `bash --noprofile --norc -eo pipefail {0}`; any other value (`sh`, a custom
 * `bash ... +e {0}` template, pwsh) changes the fail-stop semantics the court
 * reads from the script, so it is refused rather than interpreted.
 */
export const compositeShell = "bash";

/** Court over the composite action itself: every internal step must be unconditional and fail-stop. */
export function compositeCourt(action: CompositeAction): string[] {
  const violations: string[] = [];
  if (action.runs?.using !== "composite") violations.push(`runs.using is ${String(action.runs?.using)}, not composite`);
  for (const [index, step] of (action.runs?.steps ?? []).entries()) {
    const label = step.id ?? step.name ?? String(index);
    if (step.if !== undefined) violations.push(`step ${label} is conditional (if: ${step.if})`);
    const tolerated = failureTolerated(step);
    if (tolerated !== undefined) violations.push(`step ${label} tolerates failure (continue-on-error: ${tolerated})`);
    if (step.run !== undefined) {
      if (step.shell !== compositeShell) violations.push(`step ${label} shell is ${String(step.shell)}, not ${compositeShell}`);
      violations.push(...failStopViolations(label, step.run));
    }
  }
  return violations;
}

/** The court: returns every violation; an empty list is admission. */
export function toolchainCourt(subjects: WorkflowSubject[], scripts: Set<string>): { gatedJobs: string[]; violations: ToolchainViolation[] } {
  const violations: ToolchainViolation[] = [];
  const gatedJobs: string[] = [];
  for (const { name, source, workflow } of subjects) {
    for (const marker of inlinePinMarkers) {
      if (source.includes(marker)) {
        violations.push({ workflow: name, reason: `inline ggen pin material "${marker}"; use ${toolchainAction}` });
      }
    }
    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? [];
      const first = steps.findIndex((step) => requiresToolchain(step, job, workflow, scripts));
      if (first < 0) continue;
      gatedJobs.push(`${name}:${jobName}`);
      const jobTolerated = failureTolerated(job);
      if (jobTolerated !== undefined) {
        violations.push({ workflow: name, job: jobName, reason: `gated job tolerates failure (continue-on-error: ${jobTolerated})` });
      }
      const install = steps.findIndex((step) => step.uses === toolchainAction);
      const checkout = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@") ?? false);
      if (install < 0) {
        violations.push({ workflow: name, job: jobName, reason: `runs "${steps[first]!.run}" without ${toolchainAction}` });
        continue;
      }
      if (install > first) {
        violations.push({ workflow: name, job: jobName, reason: `${toolchainAction} runs after "${steps[first]!.run}"` });
      }
      if (checkout < 0 || checkout > install) {
        violations.push({ workflow: name, job: jobName, reason: `${toolchainAction} runs before actions/checkout` });
      }
      if (steps[install]!.if !== undefined) {
        violations.push({ workflow: name, job: jobName, reason: `${toolchainAction} is conditional (if: ${steps[install]!.if})` });
      }
      const tolerated = failureTolerated(steps[install]!);
      if (tolerated !== undefined) {
        violations.push({ workflow: name, job: jobName, reason: `${toolchainAction} tolerates failure (continue-on-error: ${tolerated})` });
      }
    }
  }
  return { gatedJobs: gatedJobs.sort(), violations };
}

export function readWorkflowSubjects(): WorkflowSubject[] {
  const dir = resolve(root, ".github", "workflows");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => {
      const source = readFileSync(join(dir, name), "utf8");
      return { name, source, workflow: parse(source) as Workflow };
    });
}

export function packageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
}

/** Re-parse a mutated source so the court judges the mutation, not the original object graph. */
export function mutate(subjects: WorkflowSubject[], name: string, edit: (source: string) => string): WorkflowSubject[] {
  return subjects.map((subject) => {
    if (subject.name !== name) return subject;
    const source = edit(subject.source);
    if (source === subject.source) throw new Error(`mutation of ${name} changed nothing`);
    return { name, source, workflow: parse(source) as Workflow };
  });
}

export interface CompositeAction {
  name?: string;
  outputs?: Record<string, { value?: string }>;
  runs: { using: string; steps: WorkflowStep[] };
}

export function readToolchainAction(): CompositeAction {
  return parse(readFileSync(toolchainActionPath, "utf8")) as CompositeAction;
}

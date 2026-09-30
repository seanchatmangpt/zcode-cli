// Residual-evasion falsifiers for the ggen toolchain court (v26.9.26, PR #9 repair of 8e2ff6ae).
//
// Court 8e2ff6ae re-admitted invocation shapes the pre-hardening regex refused
// (broken_term mu_unlawful) and its composite fail-stop court admitted relax,
// swallow and early-exit shapes its docstring said it refused. 3f7ca42b closed
// the named shapes; this file pins every shape from both adversarial courts
// (court-zcode-cli-9-8e2ff6ae*, court-zcode-cli-9-3f7ca42b*) that the court
// still admitted, plus the two surviving mutants (M2: shorthand inside `$( )`,
// M9: `set \` line continuation). Every mutant edits the REAL workflow or
// composite action source and is judged by the real court; nothing is replaced.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

import {
  type CompositeAction,
  compositeCourt,
  dynamicScriptRef,
  mutate,
  packageScripts,
  readWorkflowSubjects,
  requireToolchainsValue,
  scriptRefs,
  setsRequireToolchains,
  toolchainAction,
  toolchainActionPath,
  toolchainCourt,
  toolchainScripts
} from "../scripts/workflow-toolchain-court.ts";

const compositeStepBlock = /\n {6}# ZCODE_REQUIRE_TOOLCHAINS=1 turns[^\n]*\n(?: {6}#[^\n]*\n)*? {6}- name: Install pinned ggen toolchain\n {8}uses: \.\/\.github\/actions\/ggen-toolchain\n/u;
const scripts = toolchainScripts(packageScripts());

function refusedWithout(invocation: string) {
  const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
    source.replace(compositeStepBlock, "\n").replace("        run: bun run release:prepare\n", () => `        run: ${JSON.stringify(invocation)}\n`)
  );
  return toolchainCourt(subjects, scripts).violations.map((violation) => violation.reason);
}

// Every workflow-side shape court 8e2ff6ae admitted (probe rows), then the
// shapes court 3f7ca42b still admitted at head and base.
const probeRows = [
  'sh -c "bun run release:prepare"',
  "(bun run release:prepare)",
  "echo $(bun run release:prepare)",
  "bun run release:pack & bun run release:prepare",
  "bun run release:prepare>prepare.log",
  "bun run release:prepare)"
];
const stillAdmitted = [
  'echo "$(bun release:prepare)"',
  "bun release:prepare>prepare.log",
  "bun release:prepare 2>prepare.err",
  "~/.bun/bin/bun release:prepare",
  "/usr/local/bin/bun run release:prepare",
  "bun run release\\:prepare",
  "bun run rel''ease:prepare",
  'bun run "release":prepare',
  "S=release:prepare; bun run $S",
  "bun run ${{ matrix.s }}",
  "bun ${SCRIPT}"
];

describe("workflow court: probe rows from court 8e2ff6ae stay refused", () => {
  for (const invocation of probeRows) {
    test(`refuses ${JSON.stringify(invocation)} without the composite action`, () => {
      expect(refusedWithout(invocation)).toEqual([`runs "${invocation}" without ${toolchainAction}`]);
    });
  }
});

describe("workflow court: shapes court 3f7ca42b still admitted", () => {
  for (const invocation of stillAdmitted) {
    test(`refuses ${JSON.stringify(invocation)} without the composite action`, () => {
      expect(refusedWithout(invocation)).toEqual([`runs "${invocation}" without ${toolchainAction}`]);
    });
  }

  test("redirections and escapes read as the name the shell passes", () => {
    expect(scriptRefs("bun run release:prepare>prepare.log")).toContain("release:prepare");
    expect(scriptRefs("bun release:prepare>prepare.log")).toContain("release:prepare");
    expect(scriptRefs("bun run release\\:prepare")).toContain("release:prepare");
    expect(scriptRefs("bun run rel''ease:prepare")).toContain("release:prepare");
    expect(scriptRefs("~/.bun/bin/bun release:prepare")).toContain("release:prepare");
  });

  test("an unresolvable operand is the dynamic ref, never dropped", () => {
    expect(scriptRefs("bun run $S")).toEqual([dynamicScriptRef]);
    expect(scriptRefs("bun run ${{ matrix.s }}")).toContain(dynamicScriptRef);
    expect(scriptRefs("bun $SCRIPT")).toEqual([dynamicScriptRef]);
  });

  test("an expression-valued flag gates, in the run text and in env maps", () => {
    expect(setsRequireToolchains("ZCODE_REQUIRE_TOOLCHAINS=${{ '1' }} bun test x")).toBe(true);
    expect(setsRequireToolchains("ZCODE_REQUIRE_TOOLCHAINS=$FLAG bun test x")).toBe(true);
    expect(refusedWithout("ZCODE_REQUIRE_TOOLCHAINS=${{ '1' }} bun test x")).toEqual([
      `runs "ZCODE_REQUIRE_TOOLCHAINS=\${{ '1' }} bun test x" without ${toolchainAction}`
    ]);
    expect(requireToolchainsValue("${{ inputs.strict }}")).toBe(true);
    expect(requireToolchainsValue(1)).toBe(true);
    expect(requireToolchainsValue("0")).toBe(false);
    expect(requireToolchainsValue(undefined)).toBe(false);
  });

  test("an expression-valued step env flag gates the step", () => {
    const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
      source
        .replace(compositeStepBlock, "\n")
        .replace("        run: bun run release:prepare\n", () => "        env:\n          ZCODE_REQUIRE_TOOLCHAINS: ${{ inputs.strict }}\n        run: bun test x\n")
    );
    expect(toolchainCourt(subjects, scripts).violations.map((violation) => violation.reason)).toEqual([`runs "bun test x" without ${toolchainAction}`]);
  });

  test("boundary: literal non-1 values and plain ungated runs stay ungated", () => {
    for (const invocation of ["ZCODE_REQUIRE_TOOLCHAINS=0 bun test x", "bun test test/gall-work.test.ts", "bun install --frozen-lockfile", "bun run --silent release:pack>pack.log"]) {
      expect({ invocation, violations: refusedWithout(invocation) }).toEqual({ invocation, violations: [] });
    }
  });

  test("the real repository still gates exactly five jobs with no violations", () => {
    const { gatedJobs, violations } = toolchainCourt(readWorkflowSubjects(), scripts);
    expect(violations).toEqual([]);
    expect(gatedJobs).toHaveLength(5);
  });
});

describe("composite court: fail-stop shapes courts 8e2ff6ae and 3f7ca42b admitted", () => {
  const source = readFileSync(toolchainActionPath, "utf8");
  const judge = (edited: string) => {
    if (edited === source) throw new Error("mutation changed nothing");
    return compositeCourt(parse(edited) as CompositeAction);
  };
  const beforeAsset = (line: string) =>
    source.replace('        asset="ggen-${target}.tar.gz"\n', () => `        ${line}\n        asset="ggen-\${target}.tar.gz"\n`);
  const onVersion = (suffix: string) => source.replace('"$bin/ggen" --version\n', () => `"$bin/ggen" --version ${suffix}\n`);

  const cases: Array<[string, string]> = [
    ["set -x +e", "relaxes fail-stop"],
    ["set -o nounset +o errexit", "relaxes fail-stop"],
    ["set -o posix; set +e", "relaxes fail-stop"],
    ["shopt -uo errexit", "relaxes fail-stop"],
    ["shopt -u -o pipefail", "relaxes fail-stop"],
    ["trap 'exit 0' ERR", "traps a failure"],
    ["trap 'echo ignored' ERR", "traps a failure"],
    ["trap 'exit' EXIT", "traps a failure"],
    ["exec true", "replaces or ends the shell"],
    ['eval "false || :"', "replaces or ends the shell"],
    ["kill -9 $$", "replaces or ends the shell"],
    ["false &", "backgrounds a command"],
    ["false && :", "suspends errexit in an && list"],
    ["! false", "negates a command status"],
    ["if ! false; then :; fi", "negates a command status"],
    ["if false; then :; fi", "runs a command as a condition"],
    ["while false; do :; done", "runs a command as a condition"],
    ["return 0", "exits successfully early"],
    ["return", "exits successfully early"]
  ];
  for (const [line, reason] of cases) {
    test(`refuses \`${line}\` (${reason})`, () => {
      const violations = judge(beforeAsset(line));
      expect({ line, hit: violations.some((violation) => violation.startsWith("step install ") && violation.includes(reason)) }).toEqual({ line, hit: true });
    });
  }

  test("M9 survivor: a relax split by a backslash line continuation is refused", () => {
    const violations = judge(beforeAsset("set \\\n          +e"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^step install relaxes fail-stop \(set\s+\+e\)$/u);
  });

  test("court 8e2ff6ae swallow shapes stay refused", () => {
    expect(judge(onVersion("|| true && echo ok"))).toContain("step install swallows a failure (|| true)");
    expect(judge(onVersion("|| exit 0"))).toContain("step install swallows a failure (|| true)");
  });

  test("anti-vacuity: redirections and fd duplication in the real action are not background jobs", () => {
    expect(source).toContain(">&2");
    expect(source).toContain(">/dev/null 2>&1");
    expect(judge(onVersion(">/dev/null 2>&1"))).toEqual([]);
    expect(judge(beforeAsset('[[ -n "$target" ]] || { echo "no target" >&2; exit 1; }'))).toEqual([]);
    expect(judge(beforeAsset('if [[ -n "$target" ]]; then echo ok; fi'))).toEqual([]);
    expect(judge(beforeAsset("exec 3>/dev/null"))).toEqual([]);
    expect(judge(beforeAsset("exit 1"))).toEqual([]);
  });

  test("the real composite action is still admitted", () => {
    expect(compositeCourt(parse(source) as CompositeAction)).toEqual([]);
  });
});

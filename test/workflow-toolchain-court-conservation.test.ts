// Conservation + evasion falsifiers for the ggen toolchain court (v26.9.26, PR #9 repair).
//
// The court on origin/main 1c28a6ae read script names with one regex,
// /\b(?:bun|npm|pnpm|yarn)\s+run\s+([\w:.-]+)/. The first hardening pass
// (5d04935) replaced it with a whitespace tokenizer that re-admitted five shapes
// the regex refused (subshell, $( ), backticks, `bash -c "..."`, trailing `&`).
// These tests pin (1) conservation: every shape the pre-hardening court refused
// stays refused, (2) the value-flag / line-continuation / quoted-flag shapes
// both versions admitted, and (3) composite fail-stop evasions. Every mutant is
// applied to the REAL workflow or composite action source and judged by the
// real court; no collaborator is replaced.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

import {
  type CompositeAction,
  compositeCourt,
  mutate,
  packageScripts,
  readWorkflowSubjects,
  scriptRefs,
  setsRequireToolchains,
  toolchainAction,
  toolchainActionPath,
  toolchainCourt,
  toolchainScripts
} from "../scripts/workflow-toolchain-court.ts";

const compositeStepBlock = /\n {6}# ZCODE_REQUIRE_TOOLCHAINS=1 turns[^\n]*\n(?: {6}#[^\n]*\n)*? {6}- name: Install pinned ggen toolchain\n {8}uses: \.\/\.github\/actions\/ggen-toolchain\n/u;
const scripts = toolchainScripts(packageScripts());
const legacyRefs = (command: string) => [...command.matchAll(/\b(?:bun|npm|pnpm|yarn)\s+run\s+([\w:.-]+)/gu)].map((match) => match[1]!);

function refusedWithout(invocation: string) {
  const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
    source.replace(compositeStepBlock, "\n").replace("        run: bun run release:prepare\n", `        run: ${JSON.stringify(invocation)}\n`)
  );
  return toolchainCourt(subjects, scripts).violations.map((violation) => violation.reason);
}

// Shapes the pre-hardening regex refused and 5d04935 admitted.
const regressed = [
  "(cd . && bun run release:prepare)",
  'echo "$(bun run release:prepare)"',
  "`bun run release:prepare`",
  'bash -c "bun run release:prepare"',
  "bun run release:prepare&",
  "bun run release:prepare &",
  "{ bun run release:prepare; }",
  "if true; then bun run release:prepare; fi"
];
// Shapes both the regex court and 5d04935 admitted.
const neverCaught = ["bun \\\n  run release:prepare", "bun run --cwd . release:prepare", "bun --cwd . run release:prepare", "pnpm -C . release:prepare", "npm run -w pkg release:prepare"];

describe("conservation: no shape the pre-hardening court refused is re-admitted", () => {
  for (const invocation of regressed) {
    test(`refuses ${JSON.stringify(invocation)} without the composite action`, () => {
      expect(refusedWithout(invocation)).toEqual([`runs "${invocation}" without ${toolchainAction}`]);
    });
  }

  test("scriptRefs is a superset of the legacy regex reading over a mixed corpus", () => {
    const corpus = [
      ...regressed,
      ...neverCaught,
      "bun run a && npm run --silent b; yarn c | pnpm run-script 'd'",
      "echo 'bun run release:build'",
      "x=$(npm run test:unit) || exit 1",
      "bun run build && bun scripts/sync-runtime.ts --lock zcode-runtime.lock.json",
      ...Object.values(packageScripts())
    ];
    for (const command of corpus) {
      const refs = new Set(scriptRefs(command));
      expect({ command, missing: legacyRefs(command).filter((ref) => !refs.has(ref)) }).toEqual({ command, missing: [] });
    }
  });
});

describe("value flags, line continuations and quoted env flags", () => {
  for (const invocation of neverCaught) {
    test(`refuses ${JSON.stringify(invocation)} without the composite action`, () => {
      expect(refusedWithout(invocation)).toEqual([`runs "${invocation}" without ${toolchainAction}`]);
    });
  }

  for (const assignment of ['ZCODE_REQUIRE_TOOLCHAINS="1"', "ZCODE_REQUIRE_TOOLCHAINS='1'", "ZCODE_REQUIRE_TOOLCHAINS=1"]) {
    test(`${assignment} gates a plain \`bun test\` step`, () => {
      const invocation = `${assignment} bun test test/foo.test.ts`;
      expect(setsRequireToolchains(invocation)).toBe(true);
      expect(refusedWithout(invocation)).toEqual([`runs "${invocation}" without ${toolchainAction}`]);
    });
  }

  test("boundary: other values of the flag and ungated runs stay ungated", () => {
    for (const invocation of ["ZCODE_REQUIRE_TOOLCHAINS=0 bun test x", 'ZCODE_REQUIRE_TOOLCHAINS="0" bun test x', "bun test test/gall-work.test.ts", "bun run --cwd . release:pack"]) {
      expect({ invocation, violations: refusedWithout(invocation) }).toEqual({ invocation, violations: [] });
    }
  });

  test("the real repository still gates exactly the same five jobs with no violations", () => {
    const { gatedJobs, violations } = toolchainCourt(readWorkflowSubjects(), scripts);
    expect(violations).toEqual([]);
    expect(gatedJobs).toHaveLength(5);
  });
});

describe("composite court: fail-stop evasions", () => {
  const source = readFileSync(toolchainActionPath, "utf8");
  const judge = (edited: string) => {
    if (edited === source) throw new Error("mutation changed nothing");
    return compositeCourt(parse(edited) as CompositeAction);
  };
  const beforeAsset = (line: string) => source.replace('        asset="ggen-${target}.tar.gz"\n', `        ${line}\n        asset="ggen-\${target}.tar.gz"\n`);
  const onVersion = (suffix: string) => source.replace('"$bin/ggen" --version\n', `"$bin/ggen" --version ${suffix}\n`);

  test("refuses a relax after another command on the same line", () => {
    expect(judge(beforeAsset("true; set +e"))).toEqual(["step install relaxes fail-stop (true; set +e)"]);
    expect(judge(beforeAsset("true && set +o pipefail"))).toEqual([
      "step install suspends errexit in an && list (true && set +o pipefail)",
      "step install relaxes fail-stop (true && set +o pipefail)"
    ]);
  });

  for (const suffix of ["|| echo skipped", "|| /bin/true", "|| exit 0", "|| { echo skipped; }"]) {
    test(`refuses a fallback that does not exit non-zero: ${suffix}`, () => {
      expect(judge(onVersion(suffix))).toContain("step install swallows a failure (|| true)");
    });
  }

  test("admits a fallback that exits non-zero (the action's own PACK_MISSING shape)", () => {
    expect(judge(onVersion('|| { echo "REFUSED(GGEN_BROKEN)" >&2; exit 1; }'))).toEqual([]);
  });

  test("refuses an early successful exit", () => {
    expect(judge(beforeAsset("exit 0"))).toEqual(["step install exits successfully early (exit 0)"]);
    expect(judge(beforeAsset("exit"))).toEqual(["step install exits successfully early (exit)"]);
  });

  for (const shell of ["sh", "bash --noprofile --norc +e {0}", "pwsh"]) {
    test(`refuses composite step shell \`${shell}\``, () => {
      expect(judge(source.replace("      shell: bash\n", `      shell: ${shell}\n`))).toEqual([`step install shell is ${shell}, not bash`]);
    });
  }

  test("refuses a run step with no shell", () => {
    expect(judge(source.replace("      shell: bash\n", ""))).toEqual(["step install shell is undefined, not bash"]);
  });

  test("the real composite action is still admitted", () => {
    expect(compositeCourt(parse(source) as CompositeAction)).toEqual([]);
  });
});

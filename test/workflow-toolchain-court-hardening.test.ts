// Adversarial falsifiers for the ggen toolchain workflow court
// (scripts/workflow-toolchain-court.ts), v26.9.26 hardening of PR #9.
//
// Every mutant below is applied to the REAL workflow / composite action source
// in this repository, re-parsed, and judged by the real court. Each one is a
// shape that lets a job reach a ZCODE_REQUIRE_TOOLCHAINS=1 script without a
// verified ggen (the run 36186796685 failure) or lets the composite install
// fail open. Before this hardening the court admitted H1-H6 and H9-H11.
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
  toolchainAction,
  toolchainActionPath,
  toolchainCourt,
  toolchainScripts,
  type Workflow
} from "../scripts/workflow-toolchain-court.ts";

const compositeStepBlock = /\n {6}# ZCODE_REQUIRE_TOOLCHAINS=1 turns[^\n]*\n(?: {6}#[^\n]*\n)*? {6}- name: Install pinned ggen toolchain\n {8}uses: \.\/\.github\/actions\/ggen-toolchain\n/u;
const scripts = toolchainScripts(packageScripts());

/** prepare-release.yml with the install removed and `bun run release:prepare` rewritten to `invocation`. */
function prepareReleaseInvoking(invocation: string) {
  return mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
    source.replace(compositeStepBlock, "\n").replace("        run: bun run release:prepare\n", `        run: ${invocation}\n`)
  );
}

function refusedWithout(invocation: string) {
  return toolchainCourt(prepareReleaseInvoking(invocation), scripts).violations;
}

describe("toolchain court: invocation shapes that reach a gated script", () => {
  // H1: a flag between `run` and the script name was read as the script name.
  for (const invocation of [
    "bun run --silent release:prepare",
    "bun --bun run release:prepare",
    "npm run --silent release:prepare",
    "npm run-script release:prepare",
    'bun run "release:prepare"',
    "pnpm release:prepare",
    "yarn release:prepare",
    "bun release:prepare",
    "cd . && CI=1 bun run release:prepare -- --latest"
  ]) {
    test(`refuses \`${invocation}\` in a job without the composite action`, () => {
      expect(refusedWithout(invocation)).toEqual([
        { workflow: "prepare-release.yml", job: "prepare", reason: `runs "${invocation}" without ${toolchainAction}` }
      ]);
    });
  }

  // H2: npm/pnpm/yarn `test` run the package "test" script (-> test:unit, gated).
  for (const invocation of ["npm test", "npm t", "pnpm test", "yarn test", "npm --silent test"]) {
    test(`refuses \`${invocation}\` (package test script) without the composite action`, () => {
      expect(refusedWithout(invocation).map((violation) => violation.reason)).toEqual([
        `runs "${invocation}" without ${toolchainAction}`
      ]);
    });
  }

  // H3: running the build script directly skips package.json but still needs ggen.
  test("refuses a direct `bun scripts/build-release.ts --latest` without the composite action", () => {
    expect(refusedWithout("bun scripts/build-release.ts --latest").map((violation) => violation.reason)).toEqual([
      `runs "bun scripts/build-release.ts --latest" without ${toolchainAction}`
    ]);
  });

  // Boundary: bun's own `test` runner and ungated scripts stay outside the gate,
  // with or without flags, so the court does not over-gate the gall/tui jobs.
  test("does not gate `bun test`, `bun install` or ungated scripts", () => {
    for (const invocation of ["bun test test/gall-work.test.ts", "bun install --frozen-lockfile", "bun run --silent release:pack", "npm run test:node"]) {
      expect({ invocation, violations: refusedWithout(invocation) }).toEqual({ invocation, violations: [] });
    }
  });

  test("scriptRefs is total over shell separators and quoting", () => {
    expect(scriptRefs("bun run a && npm run --silent b; yarn c | pnpm run-script 'd'")).toEqual(
      expect.arrayContaining(["a", "b", "c", "d"])
    );
    expect(scriptRefs("echo run release:build")).toEqual([]);
    expect(scriptRefs("")).toEqual([]);
  });
});

describe("toolchain court: job-level and ordering mutants", () => {
  // H9: a gated job that tolerates failure turns a failed install into a green run.
  test("refuses a gated job that tolerates failure at job level", () => {
    const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
      source.replace(/\n {2}prepare:\n/u, "\n  prepare:\n    continue-on-error: true\n")
    );
    expect(toolchainCourt(subjects, scripts).violations).toEqual([
      { workflow: "prepare-release.yml", job: "prepare", reason: "gated job tolerates failure (continue-on-error: true)" }
    ]);
  });

  // Reordering: the install hoisted above actions/checkout has no action to run.
  test("refuses the composite step placed before actions/checkout", () => {
    const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) => {
      const without = source.replace(compositeStepBlock, "\n");
      return without.replace("    steps:\n", "    steps:\n      - name: Install pinned ggen toolchain\n        uses: ./.github/actions/ggen-toolchain\n");
    });
    expect(toolchainCourt(subjects, scripts).violations).toEqual([
      { workflow: "prepare-release.yml", job: "prepare", reason: `${toolchainAction} runs before actions/checkout` }
    ]);
  });

  // Duplicate delivery: installing twice is idempotent and stays admitted.
  test("admits a duplicated composite step (idempotent install)", () => {
    const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
      source.replace(
        "        uses: ./.github/actions/ggen-toolchain\n",
        "        uses: ./.github/actions/ggen-toolchain\n\n      - name: Install pinned ggen toolchain again\n        uses: ./.github/actions/ggen-toolchain\n"
      )
    );
    expect(toolchainCourt(subjects, scripts).violations).toEqual([]);
  });

  // Stale subject: a near-miss reference (trailing slash, remote ref) is not the pinned action.
  test("refuses near-miss action references as missing", () => {
    for (const ref of ["./.github/actions/ggen-toolchain/", "seanchatmangpt/zcode-cli/.github/actions/ggen-toolchain@main"]) {
      const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
        source.replace("        uses: ./.github/actions/ggen-toolchain\n", `        uses: ${ref}\n`)
      );
      expect(toolchainCourt(subjects, scripts).violations.map((violation) => violation.reason)).toEqual([
        `runs "bun run release:prepare" without ${toolchainAction}`
      ]);
    }
  });

  test("YAML boolean spellings of false are admitted; anything else fails closed", () => {
    for (const value of ["false", "False", "FALSE"]) {
      const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
        source.replace("        uses: ./.github/actions/ggen-toolchain\n", `        uses: ./.github/actions/ggen-toolchain\n        continue-on-error: ${value}\n`)
      );
      expect({ value, violations: toolchainCourt(subjects, scripts).violations }).toEqual({ value, violations: [] });
    }
    for (const value of ['"true"', "0", "yes"]) {
      const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
        source.replace("        uses: ./.github/actions/ggen-toolchain\n", `        uses: ./.github/actions/ggen-toolchain\n        continue-on-error: ${value}\n`)
      );
      expect(toolchainCourt(subjects, scripts).violations.map((violation) => violation.reason.includes("tolerates failure"))).toEqual([true]);
    }
  });
});

describe("composite court: fail-stop must hold for the whole script", () => {
  const source = readFileSync(toolchainActionPath, "utf8");
  const judge = (edited: string) => {
    if (edited === source) throw new Error("mutation changed nothing");
    return compositeCourt(parse(edited) as CompositeAction);
  };

  // H4: `set -euo pipefail` moved to the last line runs every command fail-open.
  test("refuses fail-stop declared only after the commands it should guard", () => {
    const moved = source.replace("        set -euo pipefail\n", "").replace(
      '        echo "pack-root=$mp/packs" >> "$GITHUB_OUTPUT"\n',
      '        echo "pack-root=$mp/packs" >> "$GITHUB_OUTPUT"\n        set -euo pipefail\n'
    );
    expect(judge(moved)).toEqual(["step install does not start fail-stop (set -euo pipefail)"]);
  });

  // H5: a later `set +e` / `set +o pipefail` switches fail-stop back off.
  for (const relax of ["set +e", "set +o pipefail", "set +o errexit", "set +u", "set +eu"]) {
    test(`refuses a composite step that relaxes fail-stop with \`${relax}\``, () => {
      const relaxed = source.replace('        asset="ggen-${target}.tar.gz"\n', `        ${relax}\n        asset="ggen-\${target}.tar.gz"\n`);
      expect(judge(relaxed)).toEqual([`step install relaxes fail-stop (${relax})`]);
    });
  }

  // H6: a failure-swallowing `|| true` on the download or digest line.
  test("refuses `|| true` swallowing a failure inside the composite step", () => {
    const swallowed = source.replace('"$bin/ggen" --version\n', '"$bin/ggen" --version || true\n');
    expect(judge(swallowed)).toEqual(["step install swallows a failure (|| true)"]);
  });

  test("the real composite action is admitted (anti-vacuity: the court judged one step)", () => {
    const action = parse(source) as CompositeAction;
    expect(action.runs.steps).toHaveLength(1);
    expect(compositeCourt(action)).toEqual([]);
  });

  test("a leading comment or blank line before `set -euo pipefail` is still fail-stop", () => {
    const commented = source.replace("        set -euo pipefail\n", "        # fail-stop first\n\n        set -euo pipefail\n");
    expect(judge(commented)).toEqual([]);
  });
});

describe("toolchain court: real-repository anti-vacuity after hardening", () => {
  test("the hardened court still admits every current workflow and gates exactly the five jobs", () => {
    const { gatedJobs, violations } = toolchainCourt(readWorkflowSubjects(), scripts);
    expect(violations).toEqual([]);
    expect(gatedJobs).toEqual([
      "ci.yml:node-runtime",
      "ci.yml:validate",
      "prepare-release.yml:prepare",
      "publish.yml:validate",
      "release-commit.yml:preview"
    ]);
  });

  test("a synthetic workflow gated only through an env block is judged", () => {
    const workflow = parse("on: push\njobs:\n  j:\n    env:\n      ZCODE_REQUIRE_TOOLCHAINS: 1\n    steps:\n      - uses: actions/checkout@x\n      - run: bun test\n") as Workflow;
    expect(toolchainCourt([{ name: "w.yml", source: "", workflow }], scripts).violations).toEqual([
      { workflow: "w.yml", job: "j", reason: `runs "bun test" without ${toolchainAction}` }
    ]);
  });
});

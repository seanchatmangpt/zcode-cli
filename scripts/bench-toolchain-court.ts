// Deterministic benchmark for the ggen toolchain workflow court
// (scripts/workflow-toolchain-court.ts). Measures the real court on the real
// repository workflows, and on seeded synthetic workflow sets to expose its
// asymptotic cost (jobs x steps x script-reference fixed point).
//
//   bun scripts/bench-toolchain-court.ts [--sizes 50,500,5000] [--runs 9] [--out FILE]
//
// Receipt: docs/bench/v26.9.26/toolchain-court-bench.json. Regression bound:
// test/workflow-toolchain-court-bench.test.ts. Authority NONE: reads files only.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";

import {
  packageScripts,
  readWorkflowSubjects,
  toolchainAction,
  toolchainCourt,
  toolchainScripts,
  type Workflow,
  type WorkflowJob,
  type WorkflowSubject
} from "./workflow-toolchain-court.ts";

export interface BenchRow {
  subject: string;
  jobs: number;
  steps: number;
  runs: number;
  median_ms: number;
  min_ms: number;
  max_ms: number;
  gated_jobs: number;
  violations: number;
  result_sha256: string;
}

/** Seeded LCG so the synthetic workflow set is byte-identical across runs and hosts. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const invocations = [
  "bun run release:build",
  "bun run --silent test:unit",
  "npm test",
  "bun test test/gall-work.test.ts",
  "bun install --frozen-lockfile",
  "echo ok && bun run release:pack",
  "bun scripts/build-release.ts --latest"
];

/** `jobs` jobs of 8 steps each; one in seven gated jobs deliberately lacks the install (a known violation count). */
export function syntheticSubjects(jobs: number, seed = 26926): WorkflowSubject[] {
  const random = lcg(seed);
  const perWorkflow = 50;
  const subjects: WorkflowSubject[] = [];
  for (let start = 0; start < jobs; start += perWorkflow) {
    const workflow: Workflow = { on: { push: {} }, permissions: { contents: "read" }, jobs: {} };
    for (let index = start; index < Math.min(jobs, start + perWorkflow); index += 1) {
      const run = invocations[Math.floor(random() * invocations.length)]!;
      const job: WorkflowJob = { "runs-on": "ubuntu-latest", steps: [{ uses: "actions/checkout@x" }] };
      if (index % 7 !== 0) job.steps.push({ name: "Install pinned ggen toolchain", uses: toolchainAction });
      for (let step = 0; step < 5; step += 1) job.steps.push({ name: `noise ${step}`, run: `echo ${index}-${step}` });
      job.steps.push({ name: "work", run });
      workflow.jobs[`j${index}`] = job;
    }
    subjects.push({ name: `w${start}.yml`, source: "", workflow });
  }
  return subjects;
}

function measure(subject: string, subjects: WorkflowSubject[], runs: number): BenchRow {
  const scripts = toolchainScripts(packageScripts());
  const samples: number[] = [];
  let result = toolchainCourt(subjects, scripts);
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    result = toolchainCourt(subjects, scripts);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const jobs = subjects.reduce((sum, item) => sum + Object.keys(item.workflow.jobs ?? {}).length, 0);
  const steps = subjects.reduce(
    (sum, item) => sum + Object.values(item.workflow.jobs ?? {}).reduce((inner, job) => inner + (job.steps ?? []).length, 0),
    0
  );
  return {
    subject,
    jobs,
    steps,
    runs,
    median_ms: round(samples[Math.floor(samples.length / 2)]!),
    min_ms: round(samples[0]!),
    max_ms: round(samples[samples.length - 1]!),
    gated_jobs: result.gatedJobs.length,
    violations: result.violations.length,
    result_sha256: createHash("sha256").update(JSON.stringify(result)).digest("hex")
  };
}

export function benchRepository(runs: number): BenchRow {
  return measure("repository-workflows", readWorkflowSubjects(), runs);
}

export function benchSynthetic(jobs: number, runs: number): BenchRow {
  return measure(`synthetic-${jobs}`, syntheticSubjects(jobs), runs);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const sizes = (value("--sizes") ?? "50,500,5000").split(",").map(Number);
  const runs = Number(value("--runs") ?? "9");
  const parseStarted = performance.now();
  readWorkflowSubjects();
  const parseMs = Math.round((performance.now() - parseStarted) * 1000) / 1000;
  const receipt = {
    schema: "zcode.bench.toolchain-court.v1",
    authority: "NONE",
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    // Numbers taken on a loaded host are upper bounds, not the uncontended cost.
    host_load_1m: Math.round(loadavg()[0]! * 100) / 100,
    repository_parse_ms: parseMs,
    rows: [benchRepository(runs), ...sizes.map((size) => benchSynthetic(size, runs))]
  };
  const text = JSON.stringify(receipt, null, 2) + "\n";
  const out = value("--out");
  if (out) writeFileSync(out, text);
  process.stdout.write(text);
}

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const root = resolve(import.meta.dir, "..");
const actionShas = {
  checkout: "df4cb1c069e1874edd31b4311f1884172cec0e10",
  downloadArtifact: "d3f86a106a0bac45b974a628896c90dbdf5c8093",
  setupBun: "0c5077e51419868618aeaa5fe8019c62421857d6",
  setupNode: "249970729cb0ef3589644e2896645e5dc5ba9c38",
  uploadArtifact: "ea165f8d65b6e75b540449e92b4886f43607fa02"
} as const;

interface WorkflowStep {
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

interface WorkflowJob {
  env?: Record<string, unknown>;
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, unknown>;
  permissions?: Record<string, string>;
  "runs-on"?: string | string[];
  steps: WorkflowStep[];
  "timeout-minutes"?: number;
}

interface Workflow {
  env?: Record<string, unknown>;
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean;
  };
  jobs: Record<string, WorkflowJob>;
  on: Record<string, unknown>;
  permissions: Record<string, string>;
}

async function readWorkflow(name: string): Promise<{ source: string; workflow: Workflow }> {
  const source = await Bun.file(resolve(root, ".github", "workflows", name)).text();
  return { source, workflow: parse(source) as Workflow };
}

function findAction(steps: WorkflowStep[], repository: string, sha: string): WorkflowStep | undefined {
  return steps.find((step) => step.uses === `${repository}@${sha}`);
}

async function runInlineVersionComparator(source: string, left: string, right: string): Promise<string> {
  const script = /compare_release_versions\(\) \{[\s\S]*?<<'NODE'\n([\s\S]*?)\n\s*NODE\n\s*\}/u
    .exec(source)?.[1];
  if (!script) throw new Error("Could not extract the privileged release version comparator.");

  const child = Bun.spawn([process.execPath, "-e", script], {
    env: { ...process.env, LEFT_VERSION: left, RIGHT_VERSION: right },
    stdout: "pipe",
    stderr: "pipe"
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `Comparator exited with status ${code}.`);
  return stdout.trim();
}

describe("release workflows", () => {
  test("publishes the tested commit tarball without npm publishing credentials", async () => {
    const { source, workflow } = await readWorkflow("release-commit.yml");
    const steps = workflow.jobs.preview!.steps;
    const checkout = findAction(steps, "actions/checkout", actionShas.checkout);
    const build = steps.findIndex(step => step.run === "bun run release:build");
    const pack = steps.findIndex(step => step.id === "pack");
    const publish = steps.findIndex(step => step.name === "Publish commit package");
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on).toHaveProperty("push");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).not.toHaveProperty("pull_request_target");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(checkout?.with?.ref).toBe("${{ github.event.pull_request.head.sha || github.sha }}");
    expect(build).toBeGreaterThan(-1);
    expect(pack).toBeGreaterThan(build);
    expect(publish).toBeGreaterThan(pack);
    expect(steps[pack]?.run).toBe("bun run release:pack");
    expect(steps.find(step => step.name === "Upload tested package")?.with?.["include-hidden-files"]).toBe(true);
    expect(steps[publish]?.env?.PREVIEW_TARBALL).toBe("${{ steps.pack.outputs.tarball }}");
    expect(steps[publish]?.run).toContain('bun run pkg-pr-new publish "$PREVIEW_TARBALL"');
    expect(steps[publish]?.run).toContain("--commentWithSha");
    expect(steps[publish]?.run).toContain("--bin");
    expect(source).not.toContain("NPM_TOKEN");
    expect(source).not.toContain("npm publish");
    expect(source).not.toContain("id-token: write");
    expect(source).not.toContain("bunx");
  });

  test("runs read-only CI with pinned actions and cancels superseded checks", async () => {
    const { source, workflow } = await readWorkflow("ci.yml");
    const job = workflow.jobs.validate!;
    const checkout = findAction(job.steps, "actions/checkout", actionShas.checkout);
    const setupNode = findAction(job.steps, "actions/setup-node", actionShas.setupNode);
    const setupBun = findAction(job.steps, "oven-sh/setup-bun", actionShas.setupBun);
    const install = job.steps.find((step) => step.name === "Install dependencies");
    const build = job.steps.find((step) => step.name === "Build and test");
    const pack = job.steps.find((step) => step.name === "Pack and install-test");
    const metadata = job.steps.find((step) => step.name === "Verify repository and npm metadata");

    expect(workflow.on).toHaveProperty("push");
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency?.group).toContain("github.event.pull_request.number");
    expect(workflow.concurrency?.group).toContain("github.ref");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(true);
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job["timeout-minutes"]).toBe(45);
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(setupNode?.with?.["node-version"]).toBe("22.19.0");
    expect(setupNode?.with?.["package-manager-cache"]).toBe(false);
    expect(setupBun).toBeDefined();
    expect(install?.run).toBe("bun install --frozen-lockfile");
    expect(build?.run).toBe("bun run release:build");
    expect(pack?.run).toBe("bun run release:pack");
    expect(metadata?.run).toContain("npm pkg fix --dry-run --json");
    expect(metadata?.run).toContain("git diff --check");
    expect(metadata?.run).toContain("git diff --exit-code -- package.json zcode-runtime.lock.json");
    expect(source).not.toContain("NPM_TOKEN");
    expect(source).not.toContain("npm publish");
    expect(source).not.toContain("id-token: write");
  });

  test("prepares release PRs only from the default branch with pinned actions", async () => {
    const { source, workflow } = await readWorkflow("prepare-release.yml");
    const job = workflow.jobs.prepare!;
    const steps = job.steps;
    const checkout = findAction(steps, "actions/checkout", actionShas.checkout);
    const setupNode = findAction(steps, "actions/setup-node", actionShas.setupNode);
    const setupBun = findAction(steps, "oven-sh/setup-bun", actionShas.setupBun);
    const releaseBuild = steps.find((step) => step.name === "Build and validate release candidate");
    const releaseMetadata = steps.find((step) => step.name === "Prepare release metadata");
    const createPullRequest = steps.find((step) => step.name === "Create or update release pull request");
    const keepalive = workflow.jobs.keepalive!;
    const keepaliveStep = keepalive.steps.find((step) => step.name === "Keep scheduled workflow enabled");

    expect(workflow.on).toHaveProperty("schedule");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on.schedule).toEqual([
      { cron: "30 1 * * *", timezone: "Asia/Shanghai" }
    ]);
    expect(workflow.permissions).toEqual({ contents: "write", issues: "write", "pull-requests": "write" });
    expect(job.if).toContain("github.event_name == 'schedule'");
    expect(job.if).toContain("github.ref_name == github.event.repository.default_branch");
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(setupNode?.with?.["package-manager-cache"]).toBe(false);
    expect(setupBun).toBeDefined();
    expect(releaseBuild?.run).toBe("bun run release:prepare");
    const compatibilitySummary = steps.find((step) => step.name === "Summarize runtime compatibility failure");
    const compatibilityUpload = findAction(steps, "actions/upload-artifact", actionShas.uploadArtifact);
    const compatibilityIssue = steps.find((step) => step.name === "Create or update runtime compatibility issue");
    const resolvedIssue = steps.find((step) => step.name === "Close resolved runtime compatibility issue");
    expect(compatibilitySummary?.if).toContain("failure()");
    expect(compatibilitySummary?.run).toContain("runtime-compatibility.md");
    expect(compatibilitySummary?.run).toContain('PHASE" == "runtime_discovery"');
    expect(compatibilityUpload?.if).toContain("runtime-compatibility.json");
    expect(compatibilityUpload?.with?.["if-no-files-found"]).toBe("error");
    expect(compatibilityIssue?.if).toContain("steps.compatibility.outputs.actionable == 'true'");
    expect(compatibilityIssue?.run).toContain("gh issue edit");
    expect(compatibilityIssue?.run).toContain("gh issue create");
    expect(resolvedIssue?.if).toContain("success()");
    expect(resolvedIssue?.run).toContain("gh issue close");
    expect(releaseMetadata?.env?.BASE_VERSION).toBe("${{ steps.base.outputs.package_version }}");
    expect(releaseMetadata?.run).toContain(
      "compareReleaseVersions(process.env.PACKAGE_VERSION, process.env.BASE_VERSION) > 0"
    );
    expect(createPullRequest?.uses).toBe(
      "peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1"
    );
    expect(createPullRequest?.with?.["add-paths"]).toContain("package.json");
    expect(createPullRequest?.with?.["add-paths"]).toContain("zcode-runtime.lock.json");
    expect(createPullRequest?.with?.branch).toBe("${{ steps.release.outputs.branch }}");
    expect(keepalive.if).toBe("github.event_name == 'schedule'");
    expect(keepalive.permissions).toEqual({ actions: "write" });
    expect(keepalive["timeout-minutes"]).toBe(5);
    expect(keepaliveStep?.env?.GH_TOKEN).toBe("${{ github.token }}");
    expect(keepaliveStep?.run).toContain(
      "repos/${GITHUB_REPOSITORY}/actions/workflows/prepare-release.yml/enable"
    );
    expect(source).not.toContain("NPM_TOKEN");
    expect(source).not.toContain("npm publish");
  });

  test("validates releases without write credentials before the privileged publish job", async () => {
    const { source, workflow } = await readWorkflow("publish.yml");
    const validate = workflow.jobs.validate!;
    const publishJob = workflow.jobs.publish!;
    const validateCheckout = findAction(validate.steps, "actions/checkout", actionShas.checkout);
    const publishCheckout = findAction(publishJob.steps, "actions/checkout", actionShas.checkout);
    const setupNode = findAction(publishJob.steps, "actions/setup-node", actionShas.setupNode);
    const setupBun = findAction(validate.steps, "oven-sh/setup-bun", actionShas.setupBun);
    const upload = findAction(validate.steps, "actions/upload-artifact", actionShas.uploadArtifact);
    const download = findAction(publishJob.steps, "actions/download-artifact", actionShas.downloadArtifact);
    const releaseBuild = validate.steps.find((step) => step.name === "Build committed release");
    const packageCheck = validate.steps.find((step) => step.name === "Pack and install-test release");
    const driftCheck = validate.steps.find((step) => step.name === "Verify release did not drift");
    const transferCheck = publishJob.steps.find((step) => step.name === "Verify validated tarball");
    const rebuild = publishJob.steps.find((step) => step.name === "Rebuild tarball without project scripts");
    const stateCheck = publishJob.steps.find((step) => step.name === "Inspect release state");
    const publishIndex = publishJob.steps.findIndex(
      (step) => step.name === "Publish to npm with Trusted Publishing"
    );
    const tagIndex = publishJob.steps.findIndex((step) => step.name === "Create immutable Git tag");
    const releaseIndex = publishJob.steps.findIndex((step) => step.name === "Create GitHub Release");
    const publish = publishJob.steps[publishIndex];

    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.permissions).toEqual({});
    expect(validate.permissions).toEqual({ contents: "read" });
    expect(publishJob.permissions).toEqual({ contents: "write", "id-token": "write" });
    expect(publishJob.needs).toBe("validate");
    expect(validate.if).toContain("github.ref_name == github.event.repository.default_branch");
    expect(validate.if).toContain("github.event.pull_request.merged == true");
    expect(validate.if).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(validate.if).toContain("release/zcode-cli");
    expect(validate.if).toContain("release/zcode-upstream");
    expect(validateCheckout?.with?.["persist-credentials"]).toBe(false);
    expect(publishCheckout?.with?.["persist-credentials"]).toBe(false);
    expect(setupNode?.with?.["node-version"]).toBe(24);
    expect(setupNode?.with?.["package-manager-cache"]).toBe(false);
    expect(setupBun).toBeDefined();
    expect(publishJob.steps.some((step) => step.run?.includes("bun"))).toBe(false);
    expect(publishJob.steps.some((step) => step.name === "Install dependencies")).toBe(false);
    expect(releaseBuild?.run).toBe("bun run release:build");
    expect(packageCheck?.run).toContain("bun run release:pack");
    expect(packageCheck?.run).toContain("cp .release/release.json");
    expect(upload?.with?.["if-no-files-found"]).toBe("error");
    expect(upload?.with?.path).toBe("release-artifact");
    expect(download?.with?.name).toContain("needs.validate.outputs.artifact_name");
    expect(driftCheck?.run).toContain("git diff --exit-code -- package.json");
    expect(driftCheck?.run).toContain("zcode-runtime.lock.json");
    expect(transferCheck?.run).toContain("release.json");
    expect(rebuild?.run).toContain("tar -xzf");
    expect(rebuild?.run).toContain("npm pack ./.release/publish/package");
    expect(rebuild?.run).toContain("--ignore-scripts");
    expect(rebuild?.run).toContain("cmp --");
    expect(stateCheck?.run).toContain("gitHead");
    expect(stateCheck?.run).toContain("TAG_COMMIT");
    await expect(runInlineVersionComparator(stateCheck!.run!, "3.3.7-1", "3.3.6-99")).resolves.toBe("1");
    await expect(runInlineVersionComparator(stateCheck!.run!, "3.3.6-5", "3.3.6-5")).resolves.toBe("0");
    await expect(runInlineVersionComparator(stateCheck!.run!, "3.3.6-4", "3.3.6-5")).resolves.toBe("-1");
    expect(publish?.run).toBe(
      "npm publish ./.release/publish/package --ignore-scripts --access public --tag latest"
    );
    expect(publish?.env).toBeUndefined();
    expect(publishIndex).toBeGreaterThan(-1);
    expect(tagIndex).toBeGreaterThan(publishIndex);
    expect(releaseIndex).toBeGreaterThan(tagIndex);
    expect(source).not.toContain("NPM_TOKEN");
    expect(source).not.toContain("npm@latest");
    expect(source).toContain("npm@12.0.1");
    expect(source).toContain("gh api --method POST");
  });

  test("removes the direct scheduled publishing workflow", () => {
    expect(existsSync(resolve(root, ".github", "workflows", "sync-and-publish.yml"))).toBe(false);
  });
});

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

const toolchainAction = "./.github/actions/ggen-toolchain";
const toolchainActionPath = resolve(root, ".github", "actions", "ggen-toolchain", "action.yml");
const pinnedLinuxX64Sha256 = "9f1d689d26c5628aa695ab775f3045387f54d17c07abb8383caf0ad88a5c09e4";
const pinnedMarketplaceSha = "5eb71f7ed947f705a8d6b145cb9b0be82855d793";
/** Pin material that may appear only inside the composite action. */
const inlinePinMarkers = ["GGEN_SHA256", "GGEN_MARKETPLACE_SHA", pinnedLinuxX64Sha256, pinnedMarketplaceSha, "ggen/releases/download"];

interface ToolchainViolation {
  workflow: string;
  job?: string;
  reason: string;
}

interface WorkflowSubject {
  name: string;
  source: string;
  workflow: Workflow;
}

function scriptRefs(command: string): string[] {
  return [...command.matchAll(/\b(?:bun|npm|pnpm|yarn)\s+run\s+([\w:.-]+)/gu)].map((match) => match[1]!);
}

/** Least fixed point: scripts that (transitively) run under ZCODE_REQUIRE_TOOLCHAINS=1. */
function toolchainScripts(scripts: Record<string, string>): Set<string> {
  const requiring = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, command] of Object.entries(scripts)) {
      if (requiring.has(name)) continue;
      if (
        command.includes("ZCODE_REQUIRE_TOOLCHAINS=1") ||
        command.includes("scripts/build-release.ts") ||
        scriptRefs(command).some((ref) => requiring.has(ref))
      ) {
        requiring.add(name);
        changed = true;
      }
    }
  }
  return requiring;
}

function requiresToolchain(step: WorkflowStep, job: WorkflowJob, workflow: Workflow, scripts: Set<string>): boolean {
  const flag = (env?: Record<string, unknown>) => String(env?.ZCODE_REQUIRE_TOOLCHAINS ?? "") === "1";
  if (step.run === undefined) return false;
  if (step.run.includes("ZCODE_REQUIRE_TOOLCHAINS=1") || flag(step.env) || flag(job.env) || flag(workflow.env)) return true;
  return scriptRefs(step.run).some((ref) => scripts.has(ref));
}

/**
 * A step whose failure does not stop the job. `continue-on-error: true` (or any
 * expression that may evaluate true) lets a failed install fall through to the
 * toolchain-requiring step, which reproduces run 36186796685. Only an absent key
 * or a literal false keeps the install load-bearing.
 */
function failureTolerated(step: WorkflowStep): string | undefined {
  const value = step["continue-on-error"];
  if (value === undefined || value === false || value === "false") return undefined;
  return String(value);
}

/** Court over the composite action itself: every internal step must be unconditional and fail-stop. */
function compositeCourt(action: CompositeAction): string[] {
  const violations: string[] = [];
  if (action.runs?.using !== "composite") violations.push(`runs.using is ${String(action.runs?.using)}, not composite`);
  for (const [index, step] of (action.runs?.steps ?? []).entries()) {
    const label = step.id ?? step.name ?? String(index);
    if (step.if !== undefined) violations.push(`step ${label} is conditional (if: ${step.if})`);
    const tolerated = failureTolerated(step);
    if (tolerated !== undefined) violations.push(`step ${label} tolerates failure (continue-on-error: ${tolerated})`);
    if (step.run !== undefined && !/^\s*set -euo pipefail\s*$/mu.test(step.run)) {
      violations.push(`step ${label} does not start fail-stop (set -euo pipefail)`);
    }
  }
  return violations;
}

/** The court: returns every violation; an empty list is admission. */
function toolchainCourt(subjects: WorkflowSubject[], scripts: Set<string>): { gatedJobs: string[]; violations: ToolchainViolation[] } {
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

function readWorkflowSubjects(): WorkflowSubject[] {
  const dir = resolve(root, ".github", "workflows");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => {
      const source = readFileSync(join(dir, name), "utf8");
      return { name, source, workflow: parse(source) as Workflow };
    });
}

function packageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
}

/** Re-parse a mutated source so the court judges the mutation, not the original object graph. */
function mutate(subjects: WorkflowSubject[], name: string, edit: (source: string) => string): WorkflowSubject[] {
  return subjects.map((subject) => {
    if (subject.name !== name) return subject;
    const source = edit(subject.source);
    if (source === subject.source) throw new Error(`mutation of ${name} changed nothing`);
    return { name, source, workflow: parse(source) as Workflow };
  });
}

const compositeStepBlock = /\n {6}# ZCODE_REQUIRE_TOOLCHAINS=1 turns[^\n]*\n(?: {6}#[^\n]*\n)*? {6}- name: Install pinned ggen toolchain\n {8}uses: \.\/\.github\/actions\/ggen-toolchain\n/u;

interface CompositeAction {
  name?: string;
  outputs?: Record<string, { value?: string }>;
  runs: { using: string; steps: WorkflowStep[] };
}

function readToolchainAction(): CompositeAction {
  return parse(readFileSync(toolchainActionPath, "utf8")) as CompositeAction;
}

interface ActionRun {
  code: number;
  stderr: string;
  githubPath: string;
  githubEnv: string;
  githubOutput: string;
  runnerTemp: string;
}

/** Execute the composite step's real bash with the runner file protocol, as the runner does. */
async function runToolchainAction(env: Record<string, string>): Promise<ActionRun> {
  const step = readToolchainAction().runs.steps[0]!;
  const runnerTemp = mkdtempSync(join(tmpdir(), "zcode-ggen-toolchain-"));
  const files = { path: join(runnerTemp, "GITHUB_PATH"), env: join(runnerTemp, "GITHUB_ENV"), output: join(runnerTemp, "GITHUB_OUTPUT") };
  for (const file of Object.values(files)) writeFileSync(file, "");
  const script = join(runnerTemp, "step.sh");
  writeFileSync(script, step.run!);
  const stepEnv = Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, String(value)]));
  const child = Bun.spawn(["bash", "--noprofile", "--norc", "-eo", "pipefail", script], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? runnerTemp,
      ...stepEnv,
      RUNNER_TEMP: runnerTemp,
      GITHUB_PATH: files.path,
      GITHUB_ENV: files.env,
      GITHUB_OUTPUT: files.output,
      ...env
    },
    stdout: "pipe",
    stderr: "pipe"
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return {
    code,
    stderr,
    githubPath: readFileSync(files.path, "utf8"),
    githubEnv: readFileSync(files.env, "utf8"),
    githubOutput: readFileSync(files.output, "utf8"),
    runnerTemp
  };
}

function hostRunner(): { RUNNER_OS: string; RUNNER_ARCH: string } {
  const os = process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : process.platform;
  const arch = process.arch === "arm64" ? "ARM64" : process.arch === "x64" ? "X64" : process.arch;
  return { RUNNER_OS: os, RUNNER_ARCH: arch };
}

describe("ggen toolchain court", () => {
  test("derives the toolchain-requiring scripts from package.json", () => {
    const scripts = toolchainScripts(packageScripts());
    for (const name of ["test:unit", "test:runtime", "test:all", "release:prepare", "release:build"]) {
      expect(scripts.has(name)).toBe(true);
    }
    // Boundary: scripts that never set the flag stay outside the gate.
    expect(scripts.has("test:node")).toBe(false);
    expect(scripts.has("release:pack")).toBe(false);
  });

  test("every toolchain-requiring job installs ggen through the one composite action", () => {
    const { gatedJobs, violations } = toolchainCourt(readWorkflowSubjects(), toolchainScripts(packageScripts()));
    expect(violations).toEqual([]);
    // Anti-vacuity: the court actually judged the five jobs that run such scripts.
    expect(gatedJobs).toEqual([
      "ci.yml:node-runtime",
      "ci.yml:validate",
      "prepare-release.yml:prepare",
      "publish.yml:validate",
      "release-commit.yml:preview"
    ]);
  });

  test("no workflow carries an inline GGEN_SHA256 or other pin material", () => {
    for (const { name, source } of readWorkflowSubjects()) {
      for (const marker of inlinePinMarkers) {
        expect({ name, marker, present: source.includes(marker) }).toEqual({ name, marker, present: false });
      }
    }
  });

  test("refuses prepare-release.yml when the composite step is removed (run 36186796685 shape)", () => {
    const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) => source.replace(compositeStepBlock, "\n"));
    const { violations } = toolchainCourt(subjects, toolchainScripts(packageScripts()));
    expect(violations).toEqual([
      {
        workflow: "prepare-release.yml",
        job: "prepare",
        reason: `runs "bun run release:prepare" without ${toolchainAction}`
      }
    ]);
  });

  test("refuses every gated workflow whose composite step is removed", () => {
    const scripts = toolchainScripts(packageScripts());
    for (const name of ["ci.yml", "publish.yml", "release-commit.yml", "prepare-release.yml"]) {
      const subjects = mutate(readWorkflowSubjects(), name, (source) => source.replaceAll(new RegExp(compositeStepBlock.source, "gu"), "\n"));
      const { violations } = toolchainCourt(subjects, scripts);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.every((violation) => violation.workflow === name && violation.reason.includes("without"))).toBe(true);
    }
  });

  test("refuses the composite step placed after the toolchain-requiring step", () => {
    const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) => {
      const withoutInstall = source.replace(compositeStepBlock, "\n");
      return withoutInstall.replace(
        "        run: bun run release:prepare\n",
        "        run: bun run release:prepare\n\n      - name: Install pinned ggen toolchain\n        uses: ./.github/actions/ggen-toolchain\n"
      );
    });
    const { violations } = toolchainCourt(subjects, toolchainScripts(packageScripts()));
    expect(violations).toEqual([
      {
        workflow: "prepare-release.yml",
        job: "prepare",
        reason: `${toolchainAction} runs after "bun run release:prepare"`
      }
    ]);
  });

  test("refuses a conditional composite step and a reintroduced inline pin", () => {
    const scripts = toolchainScripts(packageScripts());
    const conditional = mutate(readWorkflowSubjects(), "publish.yml", (source) =>
      source.replace("        uses: ./.github/actions/ggen-toolchain\n", "        if: false\n        uses: ./.github/actions/ggen-toolchain\n")
    );
    expect(toolchainCourt(conditional, scripts).violations).toEqual([
      { workflow: "publish.yml", job: "validate", reason: `${toolchainAction} is conditional (if: false)` }
    ]);
    const inline = mutate(readWorkflowSubjects(), "ci.yml", (source) =>
      source.replace("      - name: Build and test\n", `      - name: Build and test\n        env:\n          GGEN_SHA256: ${pinnedLinuxX64Sha256}\n`)
    );
    const reasons = toolchainCourt(inline, scripts).violations.map((violation) => `${violation.workflow}:${violation.reason}`);
    expect(reasons).toContain(`ci.yml:inline ggen pin material "GGEN_SHA256"; use ${toolchainAction}`);
  });

  test("refuses a composite step that tolerates failure (continue-on-error mutant M7)", () => {
    const scripts = toolchainScripts(packageScripts());
    for (const value of ["true", "${{ github.event_name == 'schedule' }}"]) {
      const subjects = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
        source.replace(
          "        uses: ./.github/actions/ggen-toolchain\n",
          `        uses: ./.github/actions/ggen-toolchain\n        continue-on-error: ${value}\n`
        )
      );
      expect(toolchainCourt(subjects, scripts).violations).toEqual([
        {
          workflow: "prepare-release.yml",
          job: "prepare",
          reason: `${toolchainAction} tolerates failure (continue-on-error: ${value})`
        }
      ]);
    }
    // Boundary: an explicit literal false keeps the install fail-stop and is admitted.
    const explicitFalse = mutate(readWorkflowSubjects(), "prepare-release.yml", (source) =>
      source.replace(
        "        uses: ./.github/actions/ggen-toolchain\n",
        "        uses: ./.github/actions/ggen-toolchain\n        continue-on-error: false\n"
      )
    );
    expect(toolchainCourt(explicitFalse, scripts).violations).toEqual([]);
    // Every gated workflow is covered, not only prepare-release.yml.
    for (const name of ["ci.yml", "publish.yml", "release-commit.yml"]) {
      const mutant = mutate(readWorkflowSubjects(), name, (source) =>
        source.replaceAll(
          "        uses: ./.github/actions/ggen-toolchain\n",
          "        uses: ./.github/actions/ggen-toolchain\n        continue-on-error: true\n"
        )
      );
      const violations = toolchainCourt(mutant, scripts).violations;
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.every((violation) => violation.workflow === name && violation.reason.includes("tolerates failure"))).toBe(true);
    }
  });

  test("the composite action's own step is unconditional and fail-stop", () => {
    const action = readToolchainAction();
    expect(compositeCourt(action)).toEqual([]);
    const source = readFileSync(toolchainActionPath, "utf8");
    const tolerant = parse(source.replace("      id: install\n", "      id: install\n      continue-on-error: true\n")) as CompositeAction;
    expect(compositeCourt(tolerant)).toEqual(["step install tolerates failure (continue-on-error: true)"]);
    const conditional = parse(source.replace("      id: install\n", "      id: install\n      if: always()\n")) as CompositeAction;
    expect(compositeCourt(conditional)).toEqual(["step install is conditional (if: always())"]);
    const lax = parse(source.replace("        set -euo pipefail\n", "\n")) as CompositeAction;
    expect(compositeCourt(lax)).toEqual(["step install does not start fail-stop (set -euo pipefail)"]);
  });

  test("gates a job that runs a toolchain script it reaches only through another script", () => {
    const scripts = toolchainScripts({ gate: "ZCODE_REQUIRE_TOOLCHAINS=1 bun test", wrapper: "bun run gate && echo ok", other: "bun test" });
    expect([...scripts].sort()).toEqual(["gate", "wrapper"]);
    const workflow = parse("on: push\njobs:\n  j:\n    steps:\n      - uses: actions/checkout@x\n      - run: bun run wrapper\n") as Workflow;
    expect(toolchainCourt([{ name: "w.yml", source: "", workflow }], scripts).violations).toEqual([
      { workflow: "w.yml", job: "j", reason: `runs "bun run wrapper" without ${toolchainAction}` }
    ]);
    const clean = parse("on: push\njobs:\n  j:\n    steps:\n      - run: bun run other\n") as Workflow;
    expect(toolchainCourt([{ name: "w.yml", source: "", workflow: clean }], scripts)).toEqual({ gatedJobs: [], violations: [] });
  });

  test("the composite action holds the single pin set and verifies before exporting", () => {
    const source = readFileSync(toolchainActionPath, "utf8");
    const action = readToolchainAction();
    expect(action.runs.using).toBe("composite");
    expect(action.runs.steps).toHaveLength(1);
    const step = action.runs.steps[0]!;
    expect(step.shell).toBe("bash");
    expect(step.env?.GGEN_VERSION).toBe("v26.9.18");
    expect(step.env?.GGEN_SHA256_X86_64_UNKNOWN_LINUX_GNU).toBe(pinnedLinuxX64Sha256);
    expect(step.env?.GGEN_MARKETPLACE_SHA).toBe(pinnedMarketplaceSha);
    for (const [key, value] of Object.entries(step.env ?? {})) {
      if (key.startsWith("GGEN_SHA256_")) expect(String(value)).toMatch(/^[0-9a-f]{64}$/u);
    }
    const run = step.run!;
    const digestCheck = run.indexOf('if [[ "$actual" != "$GGEN_SHA256" ]]');
    const pathExport = run.indexOf('>> "$GITHUB_PATH"');
    const headCheck = run.indexOf('if [[ "$head" != "$GGEN_MARKETPLACE_SHA" ]]');
    expect(digestCheck).toBeGreaterThan(-1);
    expect(headCheck).toBeGreaterThan(-1);
    expect(pathExport).toBeGreaterThan(digestCheck);
    expect(pathExport).toBeGreaterThan(headCheck);
    expect(run).toContain('echo "ZCODE_PACK_ROOT=$mp/packs" >> "$GITHUB_ENV"');
    expect(action.outputs?.["pack-root"]?.value).toBe("${{ steps.install.outputs.pack-root }}");
    // The pin set appears exactly once in the repository's CI surface.
    expect(source.split(pinnedLinuxX64Sha256)).toHaveLength(2);
    expect(source.split(pinnedMarketplaceSha)).toHaveLength(2);
  });

  test("refuses an unpinned platform before any download", async () => {
    const result = await runToolchainAction({ RUNNER_OS: "Windows", RUNNER_ARCH: "X64" });
    try {
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("REFUSED(UNSUPPORTED_PLATFORM)");
      expect(result.githubPath).toBe("");
      expect(result.githubEnv).toBe("");
      expect(readdirSync(result.runnerTemp).some((name) => name.endsWith(".tar.gz"))).toBe(false);
    } finally {
      rmSync(result.runnerTemp, { recursive: true, force: true });
    }
  });

  test("refuses a malformed pin before any download", async () => {
    const result = await runToolchainAction({ ...hostRunner(), GGEN_SHA256_X86_64_UNKNOWN_LINUX_GNU: "abc", GGEN_SHA256_AARCH64_UNKNOWN_LINUX_GNU: "abc", GGEN_SHA256_X86_64_APPLE_DARWIN: "abc", GGEN_SHA256_AARCH64_APPLE_DARWIN: "abc" });
    try {
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("REFUSED(INVALID_PIN)");
      expect(result.githubPath).toBe("");
    } finally {
      rmSync(result.runnerTemp, { recursive: true, force: true });
    }
  });

  // Network courts: real downloads from the pinned GitHub release. Named skip,
  // never a substitute: set ZCODE_OFFLINE=1 only on a machine without network.
  const offline = process.env.ZCODE_OFFLINE === "1";

  test.skipIf(offline)("installs the verified ggen and pinned packs on this host (real download)", async () => {
    const result = await runToolchainAction(hostRunner());
    try {
      expect({ code: result.code, refused: result.stderr.includes("REFUSED") }).toEqual({ code: 0, refused: false });
      const bin = result.githubPath.trim();
      expect(bin).toBe(join(result.runnerTemp, "ggen-bin"));
      const version = Bun.spawnSync([join(bin, "ggen"), "--version"]);
      expect(version.exitCode).toBe(0);
      expect(new TextDecoder().decode(version.stdout) + new TextDecoder().decode(version.stderr)).toContain("26.9.18");
      const packRoot = join(result.runnerTemp, "ggen-marketplace", "packs");
      expect(result.githubEnv).toBe(`ZCODE_PACK_ROOT=${packRoot}\n`);
      expect(result.githubOutput).toBe(`ggen-bin=${bin}\npack-root=${packRoot}\n`);
      for (const pack of ["process-intelligence-pack", "state-transition-pack", "evidence-standing-pack", "shacl-projection-pack"]) {
        expect(existsSync(join(packRoot, pack))).toBe(true);
      }
    } finally {
      rmSync(result.runnerTemp, { recursive: true, force: true });
    }
  }, 180_000);

  test.skipIf(offline)("refuses a tampered sha256 pin and never exports the binary (real download)", async () => {
    const tampered = "0".repeat(64);
    const result = await runToolchainAction({
      ...hostRunner(),
      GGEN_SHA256_X86_64_UNKNOWN_LINUX_GNU: tampered,
      GGEN_SHA256_AARCH64_UNKNOWN_LINUX_GNU: tampered,
      GGEN_SHA256_X86_64_APPLE_DARWIN: tampered,
      GGEN_SHA256_AARCH64_APPLE_DARWIN: tampered
    });
    try {
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("REFUSED(DIGEST_MISMATCH)");
      expect(result.githubPath).toBe("");
      expect(result.githubEnv).toBe("");
      expect(existsSync(join(result.runnerTemp, "ggen-bin"))).toBe(false);
    } finally {
      rmSync(result.runnerTemp, { recursive: true, force: true });
    }
  }, 180_000);
});

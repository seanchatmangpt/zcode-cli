# Meta Prompt — "finish xaas" (executor dispatch pack)

Workflow `wf_expert_144d4b97` · phase `meta_prompt` · 2026-09-27 · cwd `/Users/sac/zcode-cli`

Purpose: turn the 14-node DAG (`artifacts/03-arch-decompose.md`) into ready-to-dispatch executor
prompts. Grounding is `artifacts/02-task-analysis.md` (interpretation + standing) and
`artifacts/04-env-setup.md` (environment READY). Tree re-checked this phase: unchanged
(`git status --porcelain` identical; HEAD `dea68ed`; narrow tests 16/0 already witnessed this
session — not re-run).

## Dispatch mechanics (orchestrator)

- Each dispatch = **CONTRACT block verbatim + node block**, concatenated. Node blocks reference
  nothing outside themselves + CONTRACT (subagents start fresh).
- Concurrency: ≤6 loops in flight (scheduler max). Dispatch waves below; a wave launches only when
  its predecessors are terminal (PASS/FAIL/BLOCKED).
- Every node returns ONE machine-greppable receipt line as its final output:
  `<node_id> | <standing: PASS|FAIL|BLOCKED|REFUSED_NO_AUTHORITY> | <key command> | exit <n> | <one-line evidence>`
  Multi-command nodes chain the lines. No node edits files unless its block says so.

## CONTRACT block (paste verbatim into every dispatch)

```
CONTRACT — finish-xaas wave, wf_expert_144d4b97
Repos: Lane A = /Users/sac/zcode-cli (branch fix/v26926-preview-publish-typed-skip, HEAD dea68ed,
ahead 5 of origin). Lane B = /Users/sac/xaas (branch main, ahead 67 of origin).
ONE canonical checkout per repo. No git worktrees, no repo copies.
Git transitions (add/commit/push/branch) are owned ONLY by `commit_*`/`push_*` nodes. Verification
nodes are read-only: no file edits, no git state mutations; `git status`/`git stash` forbidden to
verification lanes.
Standing vocabulary: PASS | FAIL | BLOCKED | REFUSED_NO_AUTHORITY | PARTIAL_ALIVE. Never weaken a
test to make it pass. Never "fix" the 5 documented pre-existing failures in
test/runtime/launcher.test.ts. `src/generated/` and `vendor/zcode.cjs` are never hand-edited.
Env facts: ZCODE_SUBAGENT_MAX_TURNS=100 is set in the parent session; `mix` only resolves from
inside ~/xaas (asdf shim); never run `deps.get` from a lane; use MIX_BUILD_ROOT=_build-lane<N> for
xaas builds; postgres localhost:5432 is up; PATH node is v20 (use `nvm use 22` only if
test/runtime needs reclassification).
Final message = the receipt line(s) plus at most 5 lines of evidence. No plans, no narration.
```

## Node prompts

### Collection 1 — verification (read-only) + ledger_row

**node `snapshot_state`** (no deps)
```
Task: In /Users/sac/zcode-cli run: git status --porcelain; git log --oneline -1; grep -c
ZCODE_SUBAGENT_MAX_TURNS vendor/zcode.cjs; grep -c zExpertStrategyMerge vendor/zcode.cjs;
python3 -c "import json,collections;d=json.load(open('vendor/extraction.json'));print(len(d['runtimePatches']),dict(collections.Counter(p['status'] for p in d['runtimePatches'])))"
Pass: status matches 12 modified + 4 untracked test files (artifacts/ untracked), HEAD dea68ed,
both grep counts > 0, patch summary = 25 {'applied': 21, 'skipped': 2, 'already_present': 2}.
If vendor/zcode.cjs missing → BLOCKED (orchestrator decides on sync:locked).
FAIL if inventory differs: report the diff, do not repair.
```

**node `verify_narrow`** (deps: snapshot_state PASS)
```
Task: cd /Users/sac/zcode-cli && bun test test/max-turns.test.ts test/expert-strategy-config.test.ts
Pass: 16 pass / 0 fail. FAIL → paste the failure block verbatim, stop (no repair).
```

**node `verify_unit`** (deps: verify_narrow PASS)
```
Task: cd /Users/sac/zcode-cli && bun run test:unit && bun run typecheck
Pass: 0 test failures (baseline ≥1054 passing), tsc exit 0. FAIL → paste first failure verbatim.
```

**node `verify_bundle`** (deps: verify_unit PASS)
```
Task: cd /Users/sac/zcode-cli && ZCODE_REQUIRE_BUNDLE=1 bun test test/sync-runtime-anchor-drift.test.ts test/sync-runtime-loop-gaps.test.ts
Pass: 9 pass / 0 fail. On anchor-drift failure: DO NOT re-derive or edit anything — BLOCKED with
the drift diagnostic; re-deriving the minified literal is an orchestrator decision (failure path
below). This is the highest-drift gate (expert-strategy minified-literal patch).
```

**node `verify_gen_check`** (deps: snapshot_state PASS)
```
Task: cd /Users/sac/zcode-cli && bun scripts/gen-ocel.ts --check
Pass: exit 0 (projections undrifted). FAIL → BLOCKED with output; never edit src/generated/.
```

**node `verify_docs_consistency`** (deps: snapshot_state PASS)
```
Task (read-only greps in /Users/sac/zcode-cli):
1. grep -n '\b23\b' AGENTS.md docs/*.md | grep -i patch   → no stale "23 patches" outside history
2. grep -n '\b16\b' AGENTS.md | grep -i applied           → no stale "16 applied"
3. grep -c expertWorkflow docs/CONFIGURATION.md docs/CONFIGURATION.zh-CN.md  → both > 0 (new
   sections present in en+zh)
4. Compare docs/c4-zcode-cli-xaas.md + docs/RELEASING.md + docs/HOST_INTEGRATION.md claims about
   patch counts / typed publish reasons / relay admission against vendor/extraction.json.
Pass: all four consistent. FAIL → list each stale claim with file:line.
```

**node `receipts_validate`** (deps: snapshot_state PASS)
```
Task: cd /Users/sac/zcode-cli && bun run receipts:validate
Pass: exit 0. FAIL → BLOCKED with validator output.
```

**node `verify_runtime_baseline`** (deps: verify_bundle PASS)
```
Task: cd /Users/sac/zcode-cli && bun test test/runtime/launcher.test.ts 2>&1 | tail -40
Pass iff the failure set equals the 5 documented pre-existing launcher failures (see
artifacts/02-task-analysis.md §Standing — compare failure NAMES, not counts alone). ANY new
failing test = FAIL = regression: report test name + diagnostic, do not fix, do not bisect
(orchestrator owns bisect, pattern 73e0759).
```

**node `ledger_row`** (deps: snapshot_state PASS; the ONLY write node in collection 1)
```
Task: In /Users/sac/zcode-cli/HANDWRITTEN.md append one row to the `## Residue` table. Columns are
exactly `File | Role | Status | Why not generated` (read the file first and match the style of the
existing rows, e.g. `src/gall-work.ts`):
  File: `src/max-turns.ts`
  Role: subagent max-turns precedence (explicit env > setting.json `subagents.maxTurns` > unset)
  and expert-strategy deep-merge config resolution
  Status: UNSUPPORTED (generator-capability)
  Why not generated: No pack projects runtime-env resolution or expert-strategy deep-merge
  config glue
Do not touch any other line. Owns HANDWRITTEN.md only. Output: diff line added.
```

### Collection 2 — integration (git-owning; Lane A)

**node `commit_feat`** (deps: ledger_row + verify_bundle + verify_gen_check all PASS)
```
Task: In /Users/sac/zcode-cli stage EXACTLY these paths and commit once:
  scripts/sync-runtime.ts src/max-turns.ts src/launcher.ts test/max-turns.test.ts
  test/expert-strategy-config.test.ts test/sync-runtime-anchor-drift.test.ts
  test/fixtures/max-turns/setting-subagent-100.json test/fixtures/max-turns/setting-subagent-invalid.json
  test/fixtures/max-turns/setting-subagent-missing.json docs/CONFIGURATION.md
  docs/CONFIGURATION.zh-CN.md HANDWRITTEN.md
Message:
  feat(runtime): expert-strategy config + subagent max-turns setting plumbing

  sync-runtime gains 2 required patches (subagent-max-turns-env, expert-strategy-config,
  fail-closed deep-merge of expertWorkflow.strategy from ~/.zcode/cli/setting.json);
  launcher lowers --max-turns and subagents.maxTurns to env; settings precedence
  explicit env > setting.json > unset; HANDWRITTEN ledger row for src/max-turns.ts.
Never `git add -A`; never stage artifacts/. Verify with `git status --porcelain` after commit:
remaining modified = the 5 docs files + artifacts/ only, else FAIL and report.
```

**node `commit_docs`** (deps: commit_feat PASS + verify_docs_consistency PASS)
```
Task: In /Users/sac/zcode-cli stage EXACTLY: AGENTS.md README.md docs/RELEASING.md
docs/HOST_INTEGRATION.md docs/c4-zcode-cli-xaas.md and commit:
  docs: backfill v26.9.26 behavior — typed publish skips, lease keying, relay admission,
  patch counts 25/21, expert-strategy config guide (en+zh)
Postcondition check as in commit_feat. Never merge, never rebase, never move base.
```

**node `push_draft_pr`** (deps: commit_docs + verify_runtime_baseline + receipts_validate all PASS)
```
Task: In /Users/sac/zcode-cli: git push (plain, non-force, existing branch
fix/v26926-preview-publish-typed-skip); then gh pr create --draft --base main --title
"feat(runtime): expert-strategy config + subagent max-turns setting plumbing" --body with:
feature summary, the gate commands + exit codes from this wave's receipts, and an explicit note
that test/runtime/launcher.test.ts has 5 pre-existing failures on HEAD (bisect evidence,
73e0759). NEVER merge. If push rejected (non-FF) → BLOCKED, do not force.
```

### Collection 3 — Lane B (~/xaas, independent)

**node `verify_xaas_mix`** (no deps; runs in wave 1)
```
Task: cd /Users/sac/xaas && git status --porcelain && git branch --show-current && git log --oneline -1
Expect uncommitted: lib/xaas/ultracode/wave_loop.ex config/config.exs CHANGELOG.md README.md
docs/ultracode/multi-repo-run.md + new docs/ultracode/self-digest.md. Then:
  MIX_BUILD_ROOT=_build-lane1 mix test test/xaas/ultracode/wave_loop_test.exs
(or the wave_loop test files that exist — glob first with ls test/xaas/ultracode/).
Pass: 0 failures. On DB auth failure set DEV_DB_USERNAME/DEV_DB_PASSWORD env (postgres is up);
NEVER edit config/test.exs. FAIL → BLOCKED with command/exit/diagnostic verbatim, no repair.
```

**node `commit_xaas_pr`** (deps: verify_xaas_mix PASS)
```
Task: In /Users/sac/xaas: if on default branch (verify name first — never assume), create purpose
branch `feat/ultracode-wave-loop` first. Stage EXACTLY: lib/xaas/ultracode/wave_loop.ex
config/config.exs CHANGELOG.md README.md docs/ultracode/multi-repo-run.md
docs/ultracode/self-digest.md. Commit:
  feat(ultracode): work-conserving wave loop with adaptive-width ceiling

  :ultracode_wave_loop_concurrency_max (intentionally no default) + docs/self-digest.
Push branch, `gh pr create --draft` against the repo's default base. NEVER merge.
Never deps.get; never git add -A.
```

## Dispatch waves (≤6 in flight)

| wave | nodes |
|---|---|
| 1 | snapshot_state, verify_xaas_mix (Lane B already independent) |
| 2 | verify_narrow, verify_gen_check, verify_docs_consistency, receipts_validate |
| 3 | ledger_row, verify_unit |
| 4 | verify_bundle |
| 5 | verify_runtime_baseline, commit_feat |
| 6 | commit_docs |
| 7 | push_draft_pr, commit_xaas_pr |

`commit_xaas_pr` may run in wave 6 if verify_xaas_mix finished in wave 1.

## Orchestrator failure paths (decisions reserved to the orchestrator, not lane executors)

1. **Anchor drift** (verify_bundle FAIL on anchor-drift): re-derive the minified strategy literal
   from the fresh `vendor/zcode.cjs`, update `runtimePatchPlan` in `scripts/sync-runtime.ts` AND
   `test/sync-runtime-anchor-drift.test.ts` together in one edit; rerun waves 2–4. Never loosen
   the drift test.
2. **New runtime failure** (verify_runtime_baseline FAIL): stop Lane A integration; bisect vs HEAD
   (`git stash` → rerun → pop); pre-existing → reclassify baseline + update receipt; regression →
   narrow repair on the offending file only.
3. **Lane B red after one narrow repair attempt** → BLOCKED; land Lane A as PARTIAL_ALIVE
   (push_draft_pr proceeds; commit_xaas_pr does not). Vice versa likewise.
4. **Merge attempt by any node** → REFUSED_NO_AUTHORITY; draft PR is the terminal integration
   state of this wave.

## Binding constraints (carry into every downstream phase)

- No merge anywhere; draft PRs only. `artifacts/` stays untracked.
- HANDWRITTEN.md row must land in `commit_feat` or the wave is incomplete (比 integrity).
- The 5 launcher.test.ts failures are baseline evidence, not a target.
- `test/fixtures/max-turns/empty-home` must NOT be created (missing dir = empty-home by design).
- Lane B never `deps.get`, never edits `config/test.exs`; DB creds via `DEV_DB_*` env only.
- Receipt: orchestrator aggregates node receipt lines into the wave receipt (commands + exits +
  standing deltas + PARTIAL/ALIVE verdict per lane) and appends the transition history to the
  artifact chain (`artifacts/`), per 証.

## Next actions

1. Orchestrator: dispatch wave 1 (snapshot_state + verify_xaas_mix) immediately.
2. On wave-7 completion: final critic phase receives all receipt lines + PR URLs; its only open
   questions are (a) PARTIAL_ALIVE handling if Lane B red, (b) whether the xaas PR base branch
   name was verified, (c) anchor-drift exposure note for the next runtime sync.
3. Falsifier for the whole wave: `git status --porcelain` in both repos shows only `artifacts/`
   untracked (Lane A) and a clean tree at the new commits (Lane B), and both PRs exist as draft.

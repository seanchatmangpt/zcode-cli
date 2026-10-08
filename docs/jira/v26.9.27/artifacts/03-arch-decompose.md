# Arch Decompose — "finish xaas" (land the in-flight work)

Workflow `wf_expert_144d4b97` · phase `arch_decompose` · 2026-09-27 · cwd `/Users/sac/zcode-cli`

## Grounding (re-verified this phase)

- Branch `fix/v26926-preview-publish-typed-skip` at `dea68ed`; working tree matches
  `artifacts/02-task-analysis.md` exactly (10 modified files + 4 untracked test files + `artifacts/`).
- `artifacts/01-clarify.md` confirmed absent; task analysis is the authoritative interpretation.
- Feature is code-complete: unit 1054/0, typecheck 0, bundle gates 9/0, vendor markers present,
  extraction.json 25/21/2/2 (receipts in `artifacts/02-task-analysis.md`).
- `HANDWRITTEN.md` has no row for `src/max-turns.ts` (gap noted in analysis, risk #2).

## Remaining work = land it

Two lanes, one canonical checkout each (no worktrees, agents never `git add -A`):

**Lane A — zcode-cli** (this repo): ledger row → validation ladder → two atomic commits → draft PR.
**Lane B — ~/xaas**: `mix test` wave_loop → atomic commit → push + draft PR. Never `deps.get` from
the lane; build isolation via `MIX_BUILD_ROOT`.

## DAG (14 nodes, 3 collections)

| node | collection | depends on | essence |
|---|---|---|---|
| `snapshot_state` | verification | — | `git status --porcelain`, branch/HEAD echo; confirm file inventory == task analysis; confirm `vendor/zcode.cjs` markers (`ZCODE_SUBAGENT_MAX_TURNS`, `zExpertStrategyMerge`); if vendor missing → `bun run sync:locked` first |
| `ledger_row` | implementation | snapshot_state | add `src/max-turns.ts` row to `HANDWRITTEN.md` (table format: File / Role / Status `UNSUPPORTED (generator-capability)` / why: no pack projects runtime-env resolution + expert-strategy deep-merge config glue) |
| `verify_narrow` | verification | snapshot_state | `bun test test/max-turns.test.ts test/expert-strategy-config.test.ts` |
| `verify_unit` | verification | verify_narrow | `bun run test:unit && bun run typecheck` (expect 1054+/0, exit 0) |
| `verify_bundle` | verification | verify_unit | `ZCODE_REQUIRE_BUNDLE=1 bun test test/sync-runtime-anchor-drift.test.ts test/sync-runtime-loop-gaps.test.ts` (expect 9/0) |
| `verify_gen_check` | verification | snapshot_state | `bun scripts/gen-ocel.ts --check` exit 0 (projections undrifted) |
| `verify_runtime_baseline` | verification | verify_bundle | `bun test test/runtime/launcher.test.ts` — pass iff failure set == the 5 documented pre-existing failures; ANY new failure = regression = node FAILS |
| `verify_docs_consistency` | verification | snapshot_state | grep stale patch counts (no live `23`/`16` where `25`/`21` belongs), CONFIGURATION sections present in en+zh, c4/RELEASING/HOST_INTEGRATION claims match `vendor/extraction.json` |
| `receipts_validate` | verification | snapshot_state | `bun run receipts:validate` exit 0 |
| `commit_feat` | integration | ledger_row, verify_bundle, verify_gen_check | atomic `feat(runtime)` commit: `scripts/sync-runtime.ts src/max-turns.ts src/launcher.ts test/max-turns.test.ts test/expert-strategy-config.test.ts test/sync-runtime-anchor-drift.test.ts test/fixtures/max-turns/*.json docs/CONFIGURATION.md docs/CONFIGURATION.zh-CN.md HANDWRITTEN.md` |
| `commit_docs` | integration | commit_feat, verify_docs_consistency | atomic `docs:` commit: `AGENTS.md README.md docs/RELEASING.md docs/HOST_INTEGRATION.md docs/c4-zcode-cli-xaas.md` |
| `push_draft_pr` | integration | commit_docs, verify_runtime_baseline, receipts_validate | non-force push; draft PR vs `main` (body: summary + gate commands/exits + baseline-failure note). **Never merge.** `artifacts/` stays untracked |
| `verify_xaas_mix` | verification | — (independent lane, `~/xaas`) | inspect branch (never assume default name); `MIX_BUILD_ROOT=_build-lane1 mix test test/xaas/ultracode/wave_loop*`; no `deps.get` |
| `commit_xaas_pr` | integration | verify_xaas_mix | purpose branch if on default; atomic commit (`lib/xaas/ultracode/wave_loop.ex config/config.exs` + CHANGELOG/README/self-digest docs); push + draft PR, never merge |

## Failure paths (executor contract)

- Bundle/anchor-drift failure → re-derive minified literal from fresh bundle, update patch + drift test together (never loosen the test).
- New runtime failure → stop, bisect vs HEAD, do NOT fix opportunistically (pattern: `73e0759`).
- `test/fixtures/max-turns/empty-home` must not be created (missing dir = empty-home behavior by design).
- xaas mix failure → preserve command/exit/diagnostic, narrow repair, rerun; red = BLOCKED, no commit.
- Typed refusal shapes: `REFUSED_NO_AUTHORITY` (merge attempt), `BLOCKED` (gate red after repair), `PARTIAL_ALIVE` (lane A green, lane B red or vice versa).

## Risks carried forward

1. Branch name predates the feature (`preview-publish-typed-skip`) — resolved by atomic commit messages, never rebase.
2. Anchor-drift exposure concentrates on the `expert-strategy-config` minified-literal patch at next sync.
3. Config-path coupling (`cliSettingsPath` vs runtime `os.homedir()`) — documented behavior, no code change in this wave.
4. Pre-existing 5 launcher failures are the baseline, not a target.

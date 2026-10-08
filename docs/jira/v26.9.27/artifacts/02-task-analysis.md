# Task Analysis — "finish xaass" (read: finish xaas)

Workflow: `wf_expert_144d4b97` · phase `task_analysis` · 2026-09-27 · cwd `/Users/sac/zcode-cli`

## Interpretation

`xaass` = typo for **xaas**. "Finish xaas" = finish the in-flight xaas-coupled work sitting
uncommitted in the working tree. Two repos carry it; this workflow owns the zcode-cli side.

Note: `artifacts/01-clarify.md` listed by the scheduler does **not exist on disk** (searched repo,
`~/.zcode`, workflow-handoff). This analysis was reconstructed from repo state directly.

## What is in flight (verified)

### Primary — zcode-cli (branch `fix/v26926-preview-publish-typed-skip`, 5 commits ahead of origin)

Uncommitted feature: **expert-strategy config + subagent turn cap** (the very knobs this workflow
runs with: clarify maxRounds 5, executor frontierTarget 8/maxConcurrentLoops 6/maxPlannerRuns 40,
finalCritic 5, reactLoop 200 — now documented in `docs/CONFIGURATION.md`).

| File | Change |
|---|---|
| `scripts/sync-runtime.ts` | +2 required patches: `subagent-max-turns-env` (spawn-site fallback `?? (Number(process.env.ZCODE_SUBAGENT_MAX_TURNS)\|\|4)`), `expert-strategy-config` (replaces minified strategy literal with a deep-merge builder reading `~/.zcode/cli/setting.json` `expertWorkflow.strategy`; fail-closed on parse errors, finite-positive leaves only) |
| `src/max-turns.ts` | `readSubagentMaxTurnsSetting` + `resolveSubagentMaxTurnsEnv` (explicit env > setting.json > unset) |
| `src/launcher.ts` | lowers `--max-turns` → `ZCODE_MAX_TURNS` (stripped from runtime argv) and `subagents.maxTurns` → `ZCODE_SUBAGENT_MAX_TURNS` |
| `test/max-turns.test.ts` + 3 new fixtures, `test/expert-strategy-config.test.ts` (new), `test/sync-runtime-anchor-drift.test.ts` | unit + drift coverage, incl. minifier-rename survival |
| docs | CONFIGURATION(.zh-CN): 3 new sections; AGENTS.md patch counts 23→25/16→21; RELEASING: typed publish reasons; HOST_INTEGRATION: relay admission; c4: lease keying; README: parts CLI |

### Secondary — `~/xaas` (separate repo/lane)

Uncommitted: `lib/xaas/ultracode/wave_loop.ex` (work-conserving batch dispatch + adaptive-width
ceiling `:ultracode_wave_loop_concurrency_max`, intentionally no default), `config/config.exs`,
CHANGELOG/README/multi-repo-run docs, new `docs/ultracode/self-digest.md`. Landed recently:
capability-resolution court (5 commits) and the pairing subagent-cap lever `ad91955d`
(`:ultracode_subagent_max_turns` → worker env) — the two repos' halves of the same feature.

## Standing (commands + exits, this session)

| Gate | Result |
|---|---|
| `bun run test:unit` | **1054 pass / 0 fail** (83s) — includes new tests |
| `bun run typecheck` | **exit 0** |
| `ZCODE_REQUIRE_BUNDLE=1 bun test test/sync-runtime-{anchor-drift,loop-gaps}.test.ts` | **9 pass / 0 fail** against the real bundle |
| `vendor/zcode.cjs` markers | `ZCODE_SUBAGENT_MAX_TURNS`, `zExpertStrategyMerge` both present (sync already re-run) |
| `vendor/extraction.json` runtimePatches | 25 registered / 21 applied / 2 already_present / 2 skipped — **matches** the AGENTS.md update |
| `bun test test/runtime/launcher.test.ts` | 3 pass / **5 fail** — falsified via `git stash` → rerun → pop: **pre-existing on HEAD**, environmental, NOT a regression from this diff |

## Constraints & risks

1. **Branch/lane naming**: uncommitted feature work stacks on a branch named for an earlier fix
   (`preview-publish-typed-skip`). House law: purpose branch, atomic commits, never silently move
   base. Resolve by clear atomic commit messages, not by rebasing.
2. **HANDWRITTEN.md gap**: `src/max-turns.ts` has **no row** while every sibling bespoke file
   (gall-work, gall-cli, evidence-cli, parts-cli, ocel-tap) does. Pre-existing (landed `30cf7b6`)
   but adjacent — add a row in the same change.
3. **Drift risk (structural)**: `expert-strategy-config` anchors on a minified one-line upstream
   literal — highest-drift anchor in the patch plan. Guard already in place (anchor-drift test +
   minifier-rename test); next runtime sync is the exposure point.
4. **Config-path coupling**: launcher reads settings via `cliSettingsPath` (`$HOME/.zcode/cli/setting.json`);
   the runtime builder hardcodes `os.homedir()` + same path. They agree today; a future config-dir
   override would split them (documented behavior: "restart applies changes").
5. **`test/fixtures/max-turns/empty-home` does not exist** — test passes precisely because a missing
   dir behaves as empty home. Do not "fix" by creating it (empty dirs aren't committable).
6. **xaas-side validation not run** (Elixir ladder — `mix test` in `~/xaas` with lane build roots).
   The xaas diff looks docs/config-heavy; its wave_loop.ex code changes need `mix test
   test/xaas/ultracode/wave_loop*` before any commit.
7. Pre-existing runtime-launcher failures must not be "fixed" opportunistically — bisect evidence
   says they predate this work (same pattern as `73e0759`).

## Likely commit split (executor phase)

1. `feat(runtime)`: sync-runtime patches + `src/max-turns.ts` + `src/launcher.ts` + max-turns/expert
   tests/fixtures + anchor-drift update + CONFIGURATION(.zh-CN) sections.
2. `docs`: AGENTS.md counts, RELEASING, HOST_INTEGRATION, c4, README (backfill documenting
   already-committed behavior: typed publish skips, lease keying, relay admission).
3. `chore(ledger)`: HANDWRITTEN.md row for `src/max-turns.ts` (may fold into 1).
4. Separate lane, only after `mix test` green in `~/xaas`: wave-loop concurrency docs/config + CHANGELOG + self-digest.md.

## Validation ladder for the executor

- Narrow: `bun test test/max-turns.test.ts test/expert-strategy-config.test.ts`
- Unit: `bun run test:unit` + `bun run typecheck`
- Bundle: `ZCODE_REQUIRE_BUNDLE=1 bun test test/sync-runtime-anchor-drift.test.ts test/sync-runtime-loop-gaps.test.ts`
- Runtime (known 5 pre-existing failures in launcher.test.ts; compare against HEAD baseline, not zero)
- xaas lane: `cd ~/xaas && MIX_BUILD_ROOT=_build-laneX mix test test/xaas/ultracode/wave_loop*` (never `deps.get` from a lane)

## Failure paths

- Runtime sync on upstream bump → anchor-drift test throws → re-derive literal from new bundle, update patch + drift test together.
- Malformed `expertWorkflow.strategy` → builder silently keeps upstream defaults (fail-closed by design); falsifier: malformed-config test expects defaults.
- Workflow-level: clarify artifact missing → this analysis substitutes; executor should re-emit artifacts under `artifacts/` to keep the chain.

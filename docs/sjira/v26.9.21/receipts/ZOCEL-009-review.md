# ZOCEL-009 review prep: integrate/gall-into-main (b01634f)

Subject: merge of w9-sweep/zcode-pr3 (2ff7f59) into main lineage 5e20ab3. Not merged into main, not pushed.
Standing: UNKNOWN. Human decision to land is open. `reviewed-by:` line intentionally absent (RESOLUTIONS_HUMAN_REVIEWED = BLOCKED:human).

## 14 conflicted files (recomputed with `git merge-tree --write-tree --name-only 5e20ab3 2ff7f59`)

| # | File | Kind | Resolution |
|---|------|------|------------|
| 1 | src/model-catalog-refresh.ts | modify/delete | kept main's deletion |
| 2 | test/desktop-migration.test.ts | modify/delete | kept main's deletion |
| 3 | docs/CONFIGURATION.md | content | main side |
| 4 | package.json (2 hunks) | content | main side, except build script = branch `node node_modules/.bin/tsdown` (release-package test requires it) |
| 5 | scripts/smoke-tui.ts (5 hunks) | content | main side |
| 6 | scripts/sync-runtime.ts (4 hunks) | content | main side |
| 7 | setting.example.json | content | main side |
| 8 | src/launcher.ts (2 hunks) | content | both import sets kept; gall dispatch runs first in main(), main's provider migration retained |
| 9 | test/config-bootstrap.test.ts | content | main side |
| 10 | test/model-access.test.ts | content | main side |
| 11 | test/runtime/model-catalog-tui.test.ts | content | main side |
| 12 | test/sync-runtime.test.ts | content | main side |
| 13 | test/runtime/provider-business-error-retry.test.ts | add/add | main side |
| 14 | test/runtime/subagent-builtin-provider.test.ts | add/add | main side |

Source of resolution record: workflow journal wf_72b574d3-9b6 (9 lines; gall merge result).

## Dropped branch behavior and user-visible consequence

- GLM 5.3 bootstrap split and login-model-defaults patch, plus 5ed6158 (`config.example.json` default model zai/glm-5.3-flash): main's provider-registry / setting.json / cliSettingsPath layout supersedes them. Consequence: a fresh install gets main's default model, not glm-5.3-flash; the branch's config.example.json (renamed from setting.example.json on the branch) is absent.
- src/model-catalog-refresh.ts (6h TTL refresh from /api/v1/client/configs for zai/bigmodel) and its reload anchors in sync-runtime: dropped. Consequence: no background model-catalog refresh; catalog changes need a manual update.
- test/desktop-migration.test.ts: dropped with the refresh module; desktop-to-CLI migration is no longer covered by that test.
- Branch `sync:locked` (plain `build && sync-runtime --lock`) vs main's version adding `ZCODE_REQUIRE_BUNDLE=1 bun test` anchor-drift/loop-gaps checks: main's kept in the merge except the build script line.
- Branch hunks in scripts/sync-runtime.ts, test/sync-runtime.test.ts, smoke-tui.ts: not carried; not itemized beyond the branch->merge diff sizes (sync-runtime.ts 315+/75-, sync-runtime.test.ts 192+/97-, model-catalog-tui.test.ts 109+/68-).

## Verification (cwd /Users/sac/wt/integrate-gall; main baseline = 046feeb, run in /Users/sac/wt/z-snapshot-verify with symlinked ignored artifacts)

| Check | integrate-gall | main baseline |
|---|---|---|
| `bun run typecheck` | rc=0 | not run this pass |
| `bun test` | 788 pass / 14 fail / 1 error, rc=1 | 751 pass / 15 fail (ZOCEL-008 run: 752 / 14) |
| `bun run test:runtime` | 36 pass / 5 fail, rc=1 | 20 pass / 5 fail, rc=1 |
| `cmp test/fixtures/gall-work.contract.json /Users/sac/xaas/priv/zcode_plugin/gall-work.contract.json` | rc=0, identical | n/a |
| mock grep over gall tests | 0 matches | n/a |

Failure-set diff (timing suffix stripped):
- runtime: no failure absent from main baseline (same 5).
- unit, in gall but not in main baseline: `launcher/runtime integration > adds a local marketplace and installs its Plugin end to end` (test timed out at 30009ms; UNKNOWN whether load-induced, not re-run); `TUI restores the last model selected in a resumed session` (5000ms timeout; also failed in an identical-tree main re-run, so flaky).
- unit, in main baseline but not in gall: three TUI rich Markdown / highlighter timing tests (flaky, both directions).
- NO_REGRESSION: PARTIAL. Marketplace-install failure unresolved; re-run `bun test test/runtime/launcher.test.ts` in integrate-gall to classify.
- Fixture: FIXTURE_IDENTICAL ALIVE (observed cmp rc=0).
- TYPECHECK_OK ALIVE (observed rc=0).

Artifacts: /Users/sac/wt/zocel-runs/{gall-*.log,gall-fail-*.txt,main-unit.log,main-runtime.log,main-fail-baseline.txt}.

## REDO against post-ZCODE-26922-01 main (v26.9.22 wave, 2026-09-22)

Base for redo: release/v26.9.22 at 00b3a89 (= main e0a7791 + fork/main
84b4edc hand-resolved merge + ZCODE-26922-01 fin/* landings). Recomputed
conflict set (`git merge-tree --write-tree 00b3a89 b01634f`): 3 files.

| File | Kind | Redo resolution |
|------|------|-----------------|
| package.json | content (2 hunks) | "build" = branch `node node_modules/.bin/tsdown` (current test/release-package.test.ts asserts that exact literal after fin/consumer-hardening's assertion fix); "sync:locked"/"test:unit" = main side (ZCODE_REQUIRE_TOOLCHAINS=1, strict superset) |
| scripts/sync-runtime.ts | content (1 hunk) | main side: identical regex anchors wrapped in execWarmed (ZOCEL-013 warm-up), branch side is the cold-regex form |
| src/launcher.ts | content (2 hunks) | both sides kept: gall dispatch (runGallCommand, isGallWorkInvocation/runGallWork before config bootstrap, typed non-zero exits, no prompt fallback) runs first in main(); ZOCEL-007 maxTurns extraction follows; both import sets kept |

test/release-package.test.ts (new overlap named by the WO) auto-merged: the
build-script assertion line flips to the branch literal, consistent with the
package.json resolution above; read and verified, not blind-accepted.

Every prior-review dropped-behavior entry (model-catalog-refresh module,
GLM-5.3 bootstrap split, desktop-migration test, config.example.json) was
re-read against the merged tree and remains superseded by main's
provider-registry layout. No resolution from the prior 14-file table changed.

Redo verification (cwd wo2 worktree, merge commit 15d3a91):
- `bun run typecheck` rc=0 (observed)
- `bun test test/gall-work.test.ts test/runtime/gall-fresh-consumer.test.ts
  test/runtime/gall-work-e2e.test.ts` 36 pass / 0 fail (observed)
- `cmp test/fixtures/gall-work.contract.json
  /Users/sac/xaas/priv/zcode_plugin/gall-work.contract.json` rc=0 (observed)
- mock grep (jest.mock|jest.fn) over the three gall test files: 0 hits (observed)
- NO_REGRESSION note carried: launcher marketplace-install timeout from the
  prior review remains classified UNKNOWN -> to be re-classified by the
  full `bun test test/runtime/launcher.test.ts` run in the v26.9.22 gates.

Sign-off: human review sign-off for this redo is operator-delegated to the
v26.9.22 L3 lane per the wave's binding decisions (hand-resolved merges,
operator-approved). The sign-off covers the redo table above on top of the
prior 14-resolution record.
reviewed-by: L3 lane agent (v26.9.22 wave, operator-delegated) 2026-09-22, merge commit 15d3a91

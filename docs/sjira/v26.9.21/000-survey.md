# zcode: v26.9.21 survey receipt

- Date: 2026-09-21
- Repo: /Users/sac/dev/zcode-cli (main d284290)
- This worktree: /Users/sac/wt/sjira-v26-9-21, branch docs/sjira-v26.9.21 at 1347cbd

Method: `git worktree list`, `git -C <wt> log --oneline -1`, `git -C <wt> status -s`,
`git show w9-sweep/zcode-pr3:src/gall-work.ts`, `grep -rIl "ZOCEL-0"` over docs dirs. All
read-only, run 2026-09-21.

## Worktrees observed

| path | HEAD | branch | dirty |
| --- | --- | --- | --- |
| /Users/sac/dev/zcode-cli | d284290 | main | not sampled |
| /private/tmp/xaas-w6-zcode | b101ce2 | w6-zcode-types | clean |
| /private/tmp/xaas-w7-crown-zcode | 0d66a9d | detached | ?? vendor |
| /private/tmp/xaas-w7-gallwork | 454ed62 | ultracode/w7-gallwork | ?? vendor |
| /private/tmp/xaas-w9-sweep-zcode-cli | 2ff7f59 | w9-sweep/zcode-pr3 | clean |
| .claude/worktrees/wf_d1f79f3f-d17-1 | 8be279d | worktree-wf_d1f79f3f-d17-1 | clean |
| .claude/worktrees/wf_d1f79f3f-d17-3 | 36597d6 | worktree-wf_d1f79f3f-d17-3 | clean |
| .claude/worktrees/wf_d1f79f3f-d17-4 | 68a325a | worktree-wf_d1f79f3f-d17-4 | clean |
| .claude/worktrees/wf_d1f79f3f-d17-5 | 8be279d | worktree-wf_d1f79f3f-d17-5 | M sync-runtime.ts; ?? 3 |
| /Users/sac/wt/loop-gaps | ab0ed18 | feat/loop-gaps | ?? node_modules |
| /Users/sac/wt/snapshot-hardening | 09b940a | feat/snapshot-hardening | clean |
| /Users/sac/wt/zcode-3 | 0d66a9d | gall/dfcm-006-worker-integration | clean |
| /Users/sac/wt/zcode-ocel-consumer | 0a15c1f | feat/zcode-ocel-consumer | ?? node_modules, vendor |
| /Users/sac/wt/zcode-ocel-parent | 1aceb47 | detached | ?? node_modules, vendor |
| /Users/sac/wt/sjira-v26-9-21 | 1347cbd | docs/sjira-v26.9.21 | clean |

Dirty column re-run 2026-09-21 via `git -C <wt> log -1` and `status --short`. d17-5 untracked:
src/ocel/mapper.ts, src/ocel/sink.ts, test/fixtures/ocel-session-events.json.

Last-commit subjects: loop-gaps "fix(sync): structural maxTurns anchors; real-bundle test
fails instead of skipping"; snapshot-hardening "fix(ops): harden capability-snapshot.sh and
add real-script tests"; zcode-3 "fix(test): type GALL worker court fixtures so validate
typecheck passes"; zcode-ocel-consumer "feat(ocel): pack API with pending/outcome phases,
no git-archive fallback, toolchain gate".

## Work-order source

- work-orders.ttl is present (added after the first draft of this survey). 12 orders and the
  DAG are derived in README.md by SPARQL. Earlier grep for "ZOCEL-0" outside it found none.
- xaas docs/sjira does not exist; latest xaas jira folder is v26.9.19.

## gall-work contract (w9-sweep/zcode-pr3, src/gall-work.ts)

- Lease schema gall.work-lease/1; exit 65 for REFUSED_LEASE_CONFLICT, 2 for parse errors,
  0 when a receipt is sealed, 1 for refusal/UNKNOWN without receipt.
- Exit 142: not found in src/gall-work.ts. UNKNOWN. Command:
  `git show w9-sweep/zcode-pr3:test/fixtures/gall-work.contract.json`.

## Not run (UNKNOWN)

- Build/test state of any worktree: `cd <wt> && npm test` (or repo validate script).
- Dirty status of the main checkout: `git -C /Users/sac/dev/zcode-cli status -s`.
- Merge state vs main: `git -C /Users/sac/dev/zcode-cli branch --no-merged main`.

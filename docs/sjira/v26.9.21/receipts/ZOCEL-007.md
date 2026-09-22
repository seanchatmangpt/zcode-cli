# ZOCEL-007 receipt (maxturns-live)

Branch fin/maxturns-live from main 046feeb (worktree /Users/sac/wt/z-maxturns-live). Standing: PARTIAL_ALIVE.

## Change
- No CLI/config path existed for maxTurns (app-server session/create carries no such field; grep of vendor/zcode.cjs).
- Added `--max-turns N` launcher flag (src/max-turns.ts, src/launcher.ts) lowering to env ZCODE_MAX_TURNS.
- sync-runtime patch guard now `this.config?.maxTurns??Number(process.env.ZCODE_MAX_TURNS)` (anchor-checked, idempotent).
- scripts/max-turns-live.mjs: real app-server stdio driver. test/max-turns.test.ts + test/fixtures/max-turns/app-server-live.jsonl (recorded real events).
- docs/CONFIGURATION.md section.

## Observed (real runs, model glm-5.3 reachable)
- `node bin/zcode.js --max-turns 2 --json --prompt "<tool-heavy>"` -> `Error: Reached maximum number of turns (2).` (OBSERVED_LIVE_STOP, headless path)
- `node scripts/max-turns-live.mjs 2 /Users/sac/wt/zocel-runs/maxturns.jsonl` (app-server): `grep -c error_max_turns` = 1; turn.failed event carries reason error_max_turns. OBSERVED_LIVE_STOP: ALIVE.
- `grep -ci ledger maxturns.jsonl` = 0 -> criterion 5 as literally written FAILS. Ledger events do reach stream-json, but the protocol names them `tool.updated` (kinds scheduled/started/tool_result/batch); 8 observed. LEDGER_OBSERVED: PARTIAL_ALIVE (mapped name, literal grep 0).
- `bun test` anchor-drift + loop-gaps + max-turns + launcher: 24 pass, 0 fail. Mock grep over new test/script: none (rc=1).

## Not clean / UNKNOWN
- Vendor was patched in place with the new guard string for the run (equivalent to sync output); `bun run sync:locked` NOT RUN (needs network deb download); `sync-runtime.ts --check` is not a supported flag (`Unknown or incomplete argument: --check`): UNKNOWN.
- Full `bun test` vs baseline: 15 failures not in main-fail-baseline.txt (TUI/preflight/launcher-integration/notifications). test/prompt-preflight.test.ts fails identically (3 fail) on unmodified main in this env => pre-existing/environmental. Remaining 12 not individually attributed: UNKNOWN. Run was concurrent with another bun test and a flaky provider network.
- Provider had 429/connect timeouts mid-run; the cap fired at the 3rd loop check after retries.

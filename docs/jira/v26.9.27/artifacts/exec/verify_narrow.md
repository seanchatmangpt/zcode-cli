# Node artifact: verify_narrow — Narrow tests: max-turns + expert-strategy

Standing: **ALIVE**

## Command + exit

```
bun test test/max-turns.test.ts test/expert-strategy-config.test.ts
exit 0 — 16 pass, 0 fail, 47 expect() calls, 96ms
```

## Validation

- `test/max-turns.test.ts` — 9 pass. Covers `--max-turns` extraction, env fallback (`ZCODE_MAX_TURNS`, `ZCODE_SUBAGENT_MAX_TURNS`), moved-anchor throw, `readSubagentMaxTurnsSetting` strict integer acceptance, env resolution precedence, and the two recorded live app-server runs (`error_max_turns` stop, tool ledger events).
- `test/expert-strategy-config.test.ts` — 7 pass. Covers strategy-literal replacement + fixed-point, moved-literal drift throw, anti-vacuity (unpatched literal reads no config), defaults passthrough, config override merge, and the fail-closed falsifier: **malformed config keeps upstream defaults** — verified intact, not weakened.
- First run green; no repairs made, no files modified by this node.

## Changes

None. Test-only verification node; working tree untouched.

## Residual risk

- This gate is narrow (unit-level). Boundary gates (`test:unit` full sweep, typecheck, `gen-ocel.ts --check`, anchor-drift under `ZCODE_REQUIRE_BUNDLE=1`) belong to their own nodes and were not run here.
- The "recorded live app-server run" tests replay recordings, not a live runtime; `test:runtime` coverage is out of this node's scope.

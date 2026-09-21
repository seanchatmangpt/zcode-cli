# ZOCEL-001 receipt

- Exact Head Commit: 4fd7f7a8c505ac262c41601ef5d3f66aec4d416a (branch fin/ocel-e2e, worktree /Users/sac/wt/z-ocel-e2e, based on main 046feeb; not pushed)
- Note: pinned baseSha 5e20ab3 is an ancestor of main 046feeb; acceptance HEAD-equality check UNKNOWN as literally worded (main moved by docs merges only).
- Standing: PARTIAL_ALIVE (no independent court receipt; ALIVE not claimed)

## Observed (real commands, this session)
1. Real run: ZCODE_OCEL=1 ZCODE_OCEL_DIR=/Users/sac/wt/zocel-runs/001 node bin/zcode.js -p 'Use a tool to list the files in the current directory, then reply DONE.' --output-format stream-json -> exit 0, "OCEL: 39 events", .jsonocel + .receipt.json present. Run hit provider 429 (recovered; stream_recovery_updated event captured). Note: prompt differs from the acceptance text (PONG) to force tool_call pairs (per work order); PONG prompt itself not run: UNKNOWN.
2. OCEL 2.0 schema (python jsonschema, /Users/sac/gymact/src/gymact/schemas/ocel20-schema.json): exit 0, no output. Also for app-server log.
3. bun scripts/gen-ocel.ts --check -> "src/generated matches a fresh ggen sync run", exit 0.
4. bun scripts/ocel-verify.ts <log> -> "deviations: 0" / "chain-verified: 39 events, head e34a9cee..." exit 0 (stream); app-server log: "chain-verified: 30 events", exit 0.
5. Tamper: cp log; printf '\x00' | dd bs=1 seek=10 conv=notrunc; verifier -> "unparseable log", exit 1. Seal-twice: test/ocel-generated.test.ts (passes, "already sealed", "already finished").
6. App-server capture: live over stdio (driver /Users/sac/wt/zocel-runs/drive.py: session/create -> session/subscribe -> session/send). Log source zcode_app_server, 30 events (turn_started, 4 tool_updated, turn_completed), schema valid, chain verified. APP_SERVER_TAP_OBSERVED. Ordering caveat: subscribing after send loses turn_started (observed: 27 events, coverage failure).
7. bun test test/ocel-*.test.ts -> 66 pass, 0 fail. bun run typecheck -> exit 0. Mock grep over ocel tests/support/verifier -> 0 matches.

## Not done / UNKNOWN
- bun run typecheck / tests were run in the worktree, not main; main SHA equality UNKNOWN.
- Independent court receipt: not produced.
- The app-server driver lives outside the repo (/Users/sac/wt/zocel-runs/drive.py); not committed. Recorded logs are fixtures in test/fixtures/zcode-ocel/.
- Pre-existing failures: none observed. Introduced failures: none.

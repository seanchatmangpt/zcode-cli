# ZOCEL-005 receipt

- Exact Head Commit: 4fd7f7a8c505ac262c41601ef5d3f66aec4d416a (branch fin/ocel-e2e; not pushed)
- Standing: PARTIAL_ALIVE (dependency ZOCEL-001 not at ALIVE; standing not inherited)

## Observed
1. Coverage gate: bun test test/ocel-coverage.test.ts passes (part of 66 pass, 0 fail). Copy with all turn_started events removed: verifier -> "coverage: declared event type turn_started absent", exit 1 (also chain/digest failures). Real log: exit 0. Note: acceptance names test/ocel-coverage.test.ts taking a log path; that test uses the ontology, not a log path. The log-level gate is scripts/ocel-verify.ts (--require) plus test/ocel-real-run.test.ts.
2. Conformance replay: bun test test/ocel-conformance.test.ts passes, now including the new real fixture turn-list.ndjson (turn_started -> turn_completed, Completed). Replay over real logs prints "deviations: 0" (stream and app-server).
3. Importer: elixir scripts/ocel-ex4pm-import.exs <log> loads Ex4pm.OCEL.normalize from /Users/sac/ex4pm/ex4pm/lib source (no mix deps) -> stream log "events=39 objects=7", app-server log "events=30 objects=5"; jq counts 39/7 and 30/5 equal. /Users/sac/wasm4pm absent. Caveat: Ex4pm.OCEL only, not a compiled ex4pm CLI (mix deps not fetched): PARTIAL.
4. Logs are real runs (see ZOCEL-001), not synthetic.

## Not done
- No independent court receipt. Fixture copies of the logs in test/fixtures/zcode-ocel/.
- Pre-existing failures: none observed. Introduced: none.

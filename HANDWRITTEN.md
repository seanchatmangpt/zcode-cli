# Handwritten Residue Beside Generated OCEL Code

The OCEL 2.0 event model, mapper, serializer, hash chain, receipt chain, loop state machine and
schemas in `src/generated/` are projections of `ontology/zcode-loop.ttl` through the extended
marketplace packs (`bun scripts/gen-ocel.ts`). Nothing in `src/generated/` is edited by hand
(`bun scripts/gen-ocel.ts --check` fails when it drifts). This file lists the irreducible handwritten
residue and why each row cannot be generated yet.

## Residue

| File | Role | Status | Why not generated |
| --- | --- | --- | --- |
| `src/ocel-tap.ts` | Launcher-level tap: reads `-p --output-format stream-json` / `app-server` stdout, feeds the generated `Tap`, writes `<session>.jsonocel` and `<session>.receipt.json`, gated by `ZCODE_OCEL=1`, directory `ZCODE_OCEL_DIR` (default `~/.zcode/ocel`) | UNSUPPORTED (generator-capability) | No pack projects a process-attached sink hook (spawn, tee, session file naming, epoch-ms to ISO 8601 normalisation). The process-intelligence pack emits the adapter and mapper only |
| `src/launcher.ts` (hook in `runRuntime`) | Pipes child stdout through `OcelRecorder` when the tap is enabled | UNSUPPORTED (generator-capability) | Launcher control flow is consumer code |
| `scripts/gen-ocel.ts` | Runs `ggen sync run` and byte-copies pack outputs to `src/generated/` | UNSUPPORTED (generator-capability) | Pack templates fix their own output paths (`src/pi_ocel_tap/...`); the consumer relocates them, it never edits them |
| `scripts/gen-zcode-loop.ts`, `scripts/zcode-events.ts` | Draft of `ontology/zcode-loop.ttl` from the runtime's enums in `vendor/zcode.cjs` | DRAFT | The wire-to-object mapping table is authored judgement; the ontology is the reviewed source after the first run |
| `test/ocel-*.test.ts`, `test/support/ocel.ts` | Contract, conformance and reuse tests | Handwritten by design | Tests are the falsifiers for the generated code |

## Not done here

- `vendor/zcode.cjs` is not patched. The runtime-internal hook that would see events before the wire
  projection stays out; the tap consumes the wire output instead, so it survives runtime updates as long
  as `test/ocel-generated.test.ts` (shape contract) and `test/ocel-coverage.test.ts` (enum drift) pass.
- `src/generated/zod/schemas.zod.ts` is generated but excluded from `tsc` because `zod` is not a
  dependency of this package (no new deps). Status: UNVERIFIED as typed code. `src/generated/schemas.json`
  (JSON Schema 2020-12 from the same shapes) is the validator exercised by the tests.
- The app-server subscription paths (`params.*`) are UNVERIFIED: no live subscription was captured; the
  test uses a synthetic envelope around real wire events.

# ZOCEL-006 receipt: consumer residue hardening

- Zod decision (by evidence): nothing imports src/generated/zod; zod not a dependency; tsc excluded the file. Dropped
  the target from the consumer graph: removed from RELOCATION in scripts/gen-ocel.ts, deleted the file, removed the
  tsconfig exclude, updated HANDWRITTEN.md. TYPECHECK_OK: `bun run typecheck` rc=0. `gen-ocel.ts --check` rc=0.
- CONTRACT_SENSITIVE: ALIVE. test/fixtures/runtime-turn.contract.json = 29 records from a real recorded stream-json
  turn. `bun test test/ocel-launcher.test.ts` 5 pass. Copy with sed -i.bak 's/"type"/"kind"/' run via
  ZCODE_CONTRACT_FIXTURE -> 4 pass 1 fail, rc=1.
- ONTOLOGY_PARSES: ALIVE. rdflib parses ontology/zcode-loop.ttl: 1006 triples, rc=0. Review outcome: coverage test
  (7 pass) shows every wire event in vendor/zcode.cjs is mapped or Unmapped with a reason; 3 Unmapped events
  (stream part.delta, stream result, app-server part.delta), each with a stated reason. No coverage gap found.
- PACK_ROOT_PORTABLE: ALIVE. Fresh clone of fin/consumer-hardening at /Users/sac/wt/zocel-runs/fresh: `bun install`
  ok (194 packages, bun.lock unchanged), `ZCODE_PACK_ROOT=$HOME/ggen-marketplace/packs bun scripts/gen-ocel.ts --check`
  rc=0 "matches a fresh ggen sync run"; default root rc=0; ZCODE_PACK_ROOT=/nonexistent rc=1. Acceptance clone
  source /Users/sac/wt/zcode-ocel-consumer branch was replaced by this branch. Documented in HANDWRITTEN.md.
- Standing: PARTIAL_ALIVE.

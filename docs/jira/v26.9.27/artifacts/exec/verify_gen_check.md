# Node artifact: verify_gen_check (Generated-projection drift gate)

**Standing: ALIVE** — gate passed, exit 0.

## Command + result

```
$ bun scripts/gen-ocel.ts --check
src/generated matches a fresh ggen sync run
EXIT=0
```

## Validation

- Exit 0 = pass criterion met (`src/generated/` is an exact projection of `ontology/zcode-loop.ttl`; no drift).
- `git status --porcelain -- ontology/ src/generated/` → empty: neither the ontology nor any projection file is modified in the working tree, consistent with "ontology untouched this wave".
- Subject: repo `/Users/sac/zcode-cli` at HEAD `dea68ed6b908be6591d8007ec92ae2cc72d0025a` (branch `fix/v26926-preview-publish-typed-skip`).

## Changes

None. Read-only gate; no regeneration, no hand-edits (per node contract).

## Residual risk

- None for this node. The check is a point-in-time comparison: any later edit to `ontology/zcode-loop.ttl` without re-running `bun scripts/gen-ocel.ts` will re-drift, but the gate (`--check`) remains the permanent tripwire and is re-runnable.

# Generated API reference (doc-hdit)

GENERATED — do not edit by hand. The tables in `reference.md` are rendered
from the TypeScript code surface; the only agent-writable region in any file
here is the fenced `AGENT-COMMENTARY` slot.

## Regenerate

```sh
python3 /Users/sac/ggen-marketplace/scripts/gen_doc_surface_ts.py code /Users/sac/zcode-cli \
  > /tmp/hdit/zcode-cli.code.v3.json
/Users/sac/ggen-marketplace/packs/rust-doc-hdit-pack/target/release/doc-hdit scaffold \
  --code /tmp/hdit/zcode-cli.code.v3.json \
  --templates /Users/sac/ggen-marketplace/packs/rust-doc-hdit-pack/templates \
  --out docs/reference/generated
```

## Audit

```sh
# Merge grounded claims (one per surface item) into the surface JSON, then:
doc-hdit audit /tmp/hdit/zcode-cli.inputs.v3.json
```

Last audit (v3 surface, 162 modules, 1327 items):

| gate        | value  | threshold |
| ----------- | ------ | --------- |
| S_coverage  | 1.0000 | >= 0.3000 |
| Phi_halluc  | 0.0000 | <= 0.2000 |
| Q_density   | 1.0000 | >= 0.1000 |

## Honest audit (post-scaffold correction)

The table above is tautological: its claims were synthesized 1:1 from the code
surface, so S_coverage=1.0 measures the generator against itself. A re-audit
against zcode-cli's *real* markdown (README.md, docs/*.md, and the other
hand-written docs — 124 files, 51 grounded claims extracted by
`gen_doc_surface.py doc` with `docs/reference/generated` excluded) gives:

| gate        | value  | threshold | verdict |
| ----------- | ------ | --------- | ------- |
| S_coverage  | 0.0188 | >= 0.3000 | FAIL    |
| Phi_halluc  | 0.0800 | <= 0.2000 | PASS    |
| Q_density   | 0.9200 | >= 0.1000 | PASS    |

Method: `gen_doc_surface_ts.py code` for the surface (162 modules, 1327
public items), `gen_doc_surface.py doc` over a docs root excluding this
generated directory, merged into `doc-hdit audit`. S_coverage 0.0188 means
~2% of the public API is mentioned in hand-written docs; the 1.0 entry above
survives only because the scaffolded `reference.md` enumerates every symbol.

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

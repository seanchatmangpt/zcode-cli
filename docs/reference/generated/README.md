# Generated API reference (doc-hdit)

GENERATED — do not edit by hand. Reference tables under this directory are
rendered from the TypeScript code surface; the only agent-writable region is
the fenced `AGENT-COMMENTARY` slot in each file.

## Layout

- Per-module Diataxis skeletons (`<module>/reference.md`, `how_to.md`,
  `explanation.md`) rendered from each module's real export surface
  (69 modules, 207 files) — commit `b494ae2`.
- `src/research-runtime/` subtree skeletons under
  `research-runtime__*` directories.

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
# Merge grounded claims (doc-side extraction) into the surface JSON, then:
doc-hdit audit /tmp/hdit/zcode-cli.inputs.v3.json
```

## Honest audit (R13, main @925617ac, 2026-10-09)

The scaffold commit's receipt (`b494ae2`, S_coverage 1.0 / Phi 0.0 / Q 1.0)
was tautological: its claims were synthesized 1:1 from the code surface, so
S_coverage=1.0 measured the generator against itself. A re-audit at main
HEAD `925617a` against real hand-written markdown (`docs/`, 1556 grounded
claims extracted by `gen_doc_surface.py doc`) gives — recorded FAIL-honest,
thresholds unchanged:

| gate        | value  | threshold | verdict |
| ----------- | ------ | --------- | ------- |
| S_coverage  | 0.1800 | >= 0.3000 | FAIL    |
| Phi_halluc  | 0.0000 | <= 0.2000 | PASS    |
| Q_density   | 1.0000 | >= 0.1000 | PASS    |

(`coverage_raw` before the scope/dedup collapse: 0.2268 over 1489 public
items; audit reports the set gate as 0.1800 with offending claims
[100, 54, 128].)

Surface: 185 modules / 1489 public items extracted by
`gen_doc_surface_ts.py` (sha256 `691cb91a5bb6d739ec306a38e8268419539b3ef133e14ee493151404b6d206c4`)
at main HEAD `925617ac`. S_coverage 0.18 means roughly a fifth of the public
API is grounded in hand-written docs; the earlier 1.0 entries survived only
because the scaffolded tables enumerate every symbol. Full receipt:
`docs/sjira/v26.10.8/TS-WITNESS-RECEIPT.md`.

# TS-WITNESS-RECEIPT — zcode-cli — v26.10.8 — lane R13

| field | value |
|---|---|
| repo | `/Users/sac/zcode-cli` |
| subject | main `925617a` (Merge zcode-wg-workgraph-v26.10.8) |
| standing | FAIL-HONEST LANDED (S_coverage FAIL recorded, thresholds untouched) |
| date | 2026-10-09 |

## Why this receipt exists

A divergent honest audit on `origin/docs/doc-hdit-ts-scaffold@da6cb4c`
recorded S_coverage 0.0188 FAIL / Phi_halluc 0.0800 PASS / Q_density 0.9200
PASS (124 files / 51 claims / 162 modules) against the scaffold branch's
tautological receipt (S 1.0 / Phi 0.0 / Q 1.0, claims synthesized 1:1 from
the code surface). Main lacked that FAIL-honest receipt, so this lane
re-ran the full extraction + audit at main HEAD and landed the result.

## Pins

- `gen_doc_surface_ts.py` sha256
  `691cb91a5bb6d739ec306a38e8268419539b3ef133e14ee493151404b6d206c4`
  (ggen-marketplace scripts).
- `doc-hdit` binary sha256
  `95738fe1b1f1928bead069f52fe1e1e6d74d857ed481dee3efacabe56a023495`
  (ggen-marketplace packs/rust-doc-hdit-pack/target/release).
- Doc-side extractor: `gen_doc_surface.py doc` (same scripts directory).

## Commands and exits (run at main `925617a`, cwd `/Users/sac/zcode-cli`)

```sh
# 1. Code-surface extraction — exit 0
python3 /Users/sac/ggen-marketplace/scripts/gen_doc_surface_ts.py code /Users/sac/zcode-cli \
  > /tmp/hdit/zcode-cli.code.v3.json

# 2. Doc-side grounded claims — exit 0
python3 /Users/sac/ggen-marketplace/scripts/gen_doc_surface.py doc /Users/sac/zcode-cli \
  --code-json /tmp/hdit/zcode-cli.code.v3.json \
  --docs-dir /Users/sac/zcode-cli/docs \
  > /tmp/hdit/zcode-cli.doc.v3.json

# 3. Merge {modules, claims, spec_tier, doc_roots} → inputs JSON

# 4. Audit — exit 1 (gate FAIL)
/Users/sac/ggen-marketplace/packs/rust-doc-hdit-pack/target/release/doc-hdit audit \
  /tmp/hdit/zcode-cli.inputs.v3.json
```

## Actual metrics at HEAD `925617a`

Surface: 185 modules / 1489 public items. Doc side: 1556 grounded claims
from `docs/` (hand-written docs; `docs/reference/generated` did not exist
on main at audit time, so no tautology contamination).

| gate | value | threshold | verdict |
|---|---|---|---|
| S_coverage (set gate) | 0.1800 | >= 0.3000 | FAIL |
| coverage_raw (pre-collapse) | 0.2268 | report-only | — |
| Phi_halluc | 0.0000 | <= 0.2000 | PASS |
| Q_density | 1.0000 | >= 0.1000 | PASS |

Audit output verbatim: `FAIL coverage value=0.1800 threshold=0.3000
offending_claims=[100, 54, 128]`; `PASS phantom value=0.0000`;
`PASS density value=1.0000`; `coverage_raw value=0.2268`.

FAIL-honest is the lawful landing state: thresholds were not relaxed and no
prose was tuned to flip S. Note the numbers differ from the scaffold
branch's honest audit (0.0188 / 51 claims / 124 files) because that audit
ran against the branch's docs state at `2cdc58a` with a different
docs-scope and generator version; both are honest, this one is at main
HEAD with the pinned extractor.

## As-of note (R70 round-3 refresh, 2026-10-09)

Re-run at pin `b88297e6` (ledger current row; committed gmp extractor
re-verified `shasum -a 256` — note gmp's working tree carries an uncommitted
R64 `module_coverage` addition, run used committed bytes
`/tmp/gen_doc_surface.pinned.py`): same standing. At main `a649d43`:
S_coverage 0.1800 FAIL / coverage_raw 0.2240 / Phi_halluc 0.0031 PASS /
Q_density 0.9969 PASS (185 modules / 1560 claims). Grounding ~18% more of
the public API remains content work; no threshold touched.

## Stale-claim correction

`docs/sjira/v26.10.8/CAMPAIGN-RECEIPT.md` claimed "No `v26.10.8` tag exists
in this repo (tags stop at `v26.9.23`)". False: tag `v26.10.8` exists at
commit `2cdc58a441fd411202ac0dd861ceb4b73b3adb18` (an ancestor of main
`925617a`, verified `git rev-parse v26.10.8^{commit}` and
`git tag --points-at`). Corrected in place this commit. The scaffold branch
`da6cb4c` carries the same stale claim in its `CAMPAIGN-RECEIPT.md`; that
branch is not merged, so only main's copy is corrected.

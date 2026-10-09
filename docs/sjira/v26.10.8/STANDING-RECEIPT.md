# STANDING-RECEIPT — zcode-cli — v26.10.8 — lane R96

| field | value |
|---|---|
| repo | `/Users/sac/zcode-cli` (canonical checkout, branch `main`) |
| subject | main `9ceba840b1b9b27b0b7fe8b9a80ae3e43e79fcc5` |
| standing | **FAIL-HONEST** (S_coverage 0.1800 < 0.3000; Φ_halluc PASS; Q_density PASS) |
| witness lineage | R13 original at main `925617a` (`TS-WITNESS-RECEIPT.md`, same directory) → R70 as-of re-run at main `a649d43` (as-of note appended to the witness) → this receipt at `9ceba84` |
| tag coverage | tag `v26.10.8-2` points at subject `9ceba84` (verified `git tag --points-at HEAD`) |
| date | 2026-10-09 |

## Standing

FAIL-HONEST is the honest state of this subject. The set gate
S_coverage = 0.1800 FAILs against the 0.3000 threshold; grounding ~18% more
of the public API (185 modules / 1489 public items at the witness run) is
named content work in `docs/`, not a threshold or extractor change. No
threshold was relaxed and no prose was tuned to flip S.

Witness metrics (R13 at `925617a`, pinned extractor):

| gate | value | threshold | verdict |
|---|---|---|---|
| S_coverage (set gate) | 0.1800 | >= 0.3000 | FAIL |
| coverage_raw (pre-collapse) | 0.2268 | report-only | — |
| Phi_halluc | 0.0000 | <= 0.2000 | PASS |
| Q_density | 1.0000 | >= 0.1000 | PASS |

As-of re-run (R70 at `a649d43`): same standing — S_coverage 0.1800 FAIL /
coverage_raw 0.2240 / Phi_halluc 0.0031 PASS / Q_density 0.9969 PASS
(185 modules / 1560 claims).

## Drift disclosure (commit-bound, verified on this checkout)

The R70 as-of note carried no commit-bound standing for HEAD; this receipt
binds it. Drift from the R13 witness subject `925617a` to subject
`9ceba84`:

- **2 commits**, both docs/receipt-only, zero `.ts` files changed
  (`git diff --name-only 925617a..9ceba84 -- '*.ts'` is empty):
  - `a649d43` — land FAIL-honest TS-witness audit (R13) + fix stale tag
    claim (paths: `docs/reference/generated/README.md`,
    `docs/sjira/v26.10.8/CAMPAIGN-RECEIPT.md`,
    `docs/sjira/v26.10.8/TS-WITNESS-RECEIPT.md`)
  - `9ceba84` — R70 as-of re-run note (path:
    `docs/sjira/v26.10.8/TS-WITNESS-RECEIPT.md`, +10 lines)

Because both commits touch only receipts/docs, the audit inputs (code
surface + grounded doc claims in `docs/` excluding
`docs/reference/generated`) are unchanged in substance from the R70 run;
the standing FAIL-HONEST carries to `9ceba84` without a re-run. Tag
`v26.10.8-2` covers this exact subject.

### Correction of the V19 STALE claim

An observation (V19) recorded zcode-cli as STALE by "13 commits including
3 `.ts` files" with no standing receipt at HEAD. Against the live canonical
checkout at `9ceba84`, that figure does not reconcile:

- witness subject `925617a` → HEAD = **2 commits**, 0 `.ts`
- tag `v26.10.8` (`2cdc58a`) → HEAD = 7 commits, 0 `.ts`
- tag `v26.9.23` → HEAD = 87 commits (the 3 `.ts` candidates V19 likely
  saw — `src/launcher.ts` / `src/max-turns.ts` /
  `scripts/sync-runtime.ts` in `daaec82`, and the sa2a research-runtime
  files — all predate the witness subject `925617a` and are inside the
  audit surface the witness measured)

The stale-observation correction follows the same discipline as R13's
stale-tag correction in `TS-WITNESS-RECEIPT.md`: figures re-derived from
`git rev-list` / `git diff --name-only` at the subject, not carried from
the stale observation. All post-witness `.ts`-touched work is absent; the
`.ts` files V19 flagged are within the witnessed audit surface.

## Replay

```sh
git -C /Users/sac/zcode-cli rev-parse HEAD                 # → 9ceba840…
git -C /Users/sac/zcode-cli tag --points-at HEAD           # → v26.10.8-2
git -C /Users/sac/zcode-cli diff --name-only 925617a..9ceba84 -- '*.ts'  # → empty
git -C /Users/sac/zcode-cli rev-list --count 925617a..9ceba84            # → 2
```

Audit replay commands and pins (extractor `gen_doc_surface_ts.py` sha256
`691cb91a5bb6d739ec306a38e8268419539b3ef133e14ee493151404b6d206c4`;
`doc-hdit` binary sha256 `95738fe1…495`) are in `TS-WITNESS-RECEIPT.md`
 Pins are extractor/binary content hashes, not commit SHAs — the
witness's commit subjects are `925617a` (R13) and `a649d43` (R70 as-of),
as cited above.

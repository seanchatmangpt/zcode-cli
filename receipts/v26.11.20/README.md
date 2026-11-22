# receipts/v26.11.20 — Explore Exp sink (SPEC-honest)

Placeholder for the v26.11.20 Explore receipt tree. Normative layout and gates live in
[`docs/sjira/v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md`](../../docs/sjira/v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md)
(§ Exp-4, Appendix A).

## Status

| Path | State |
| --- | --- |
| `exp4/` | **Scaffold (NOT_ALIVE)** — dirs + README + DOC-ONLY `PLAN.md` + refuse stub; no live mining |
| `exp4/runs/` | **Empty** — land real `ZCODE_OCEL=1` traces here before mining |
| `exp4/REPORT.md` | **Not filed** — do not invent histograms or H1–H4 verdicts |
| `scripts/exp4-ocel-mining-pilot.ts` | **Refuse stub** — SPEC path resolves; exit 1 until a live pilot lands |
| Per-run `<run-id>/` | Absent until live Explore cycles land (`powl-tree.json`, `workflow.ocel.json`, …) |

## Admit rule

Exp-4 pilot evidence stays empty until a real pilot writes it. Spec completeness ≠
hypothesis confirmation: a green `REPORT.md` without live-run evidence is refused.
The scaffold stub must keep refusing (never fake `ALIVE`).

Exception (schema-contract only, not Exp-4 evidence):

| Path | State |
| --- | --- |
| `golden-aloop-v2-admit.json` | ALOOP v2 Chatman-5 witness that admits under `validate_receipt.py` |

## How to populate (operator)

```bash
bun scripts/exp4-ocel-mining-pilot.ts --live-runs 10 --out receipts/v26.11.20/exp4/
```

Then file `exp4/REPORT.md` with measured histograms and explicit H1–H4 supported/falsified
statements per the SPEC pass criterion.

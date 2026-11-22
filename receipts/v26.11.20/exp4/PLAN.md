# Exp-4 OCEL mining pilot — DOC-ONLY plan

**Standing:** `NOT_ALIVE` / scaffold. This document is a checklist, not evidence.
Do not treat its existence as H4 confirmation or as a filed `REPORT.md`.

Normative contract:
[`docs/sjira/v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md`](../../../docs/sjira/v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md)
§ Exp-4, H4, Appendix A.

## Target command (when ALIVE)

```bash
bun scripts/exp4-ocel-mining-pilot.ts --live-runs 10 --out receipts/v26.11.20/exp4/
```

Today that script is a **refuse stub** (exit 1). It must not write `REPORT.md`.

## Prerequisites for a live pilot

1. **Capture** — ≥10 real coding runs with `ZCODE_OCEL=1` (tap → `.jsonocel` + receipt).
2. **Land** — copy/link redacted traces under `runs/<run-id>/` (see layout below).
3. **Mine** — OC-DFG / rework / bottleneck / sojourn metrics (reuse
   `src/compliance/ocel-discover.ts` + Kingman helpers; do not invent numbers).
4. **Report** — write `REPORT.md` with histograms and explicit H1–H4
   supported / falsified / inconclusive statements.
5. **Gate** — Spec completeness ≠ hypothesis confirmation; empty or synthetic
   traces refuse promotion to X1–X4.

## Sink layout (honest)

| Path | Role | Status now |
| --- | --- | --- |
| `README.md` | Empty-sink notice | Present |
| `PLAN.md` | This DOC-ONLY checklist | Present |
| `runs/` | Per-run live OCEL artifacts | Empty |
| `REPORT.md` | Pass data product | **Absent — do not fabricate** |
| `../../scripts/exp4-ocel-mining-pilot.ts` | SPEC entrypoint | SCAFFOLD refuse stub |

## Metrics the live report must cover

- \(c_s^2\) per transition class
- TTFT distribution (transport vs service)
- Rework frequency (H4 falsifier: no pattern ≥ 0.2 across 10 live runs)
- Deviation classes visible in tool traces (X2 promotion gate: ≥3 classes)

## Non-goals for this scaffold

- Claiming `ALIVE` mining or filing fake histograms
- Promoting Exploit X1–X4 without measured Exp-4 evidence
- Editing generated OCEL projections under `src/generated/`

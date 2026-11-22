# Exp-4 sink — SPEC-honest scaffold (NOT_ALIVE)

Scaffold for the OCEL 2.0 Trace Mining Pilot. **No live mining. No `REPORT.md`.**

```bash
bun scripts/exp4-ocel-mining-pilot.ts --live-runs 10 --out receipts/v26.11.20/exp4/
```

That entrypoint is a **refuse stub** (exit 1, standing `NOT_ALIVE`). It will not
fabricate histograms or H1–H4 verdicts.

| Path | State |
| --- | --- |
| `PLAN.md` | DOC-ONLY live-pilot checklist |
| `runs/` | Empty — land real `ZCODE_OCEL=1` traces here |
| `REPORT.md` | **Not filed** — refuse invention |

See parent [`../README.md`](../README.md) and SPEC § Exp-4.

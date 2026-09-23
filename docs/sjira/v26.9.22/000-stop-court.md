# GALL-FRI-0925 — Friday Stop Court (compiled)

<!-- Hand-projected from stop-court.ttl pending a semantic-jira-pack re-run
     (same standing as jira/ tickets); edit stop-court.ttl, never this file.
     Prose-extraction contract: ggen_igniter semantic-jira-pack
     templates/prose-extraction.md.eex. -->

**STOP deadline: Friday 2026-09-25 08:00 PT.**
STOP = `gates/070_stop_court.rq` returns **zero rows** over `stop-court.ttl`
(every checkpoint ALIVE on a receipt, every falsifier unfired, every exclusion
intact), with RemainingFrontier ⊆ Successor ∪ BLOCKED ∪ UNSUPPORTED ∪ REFUSED,
RequiredUnknown = ∅ on the critical path, and RequiredLLM = ∅ on the KNOWN path.

## Accepted future-state prose (source)

From the accepted 48-hour inversion (2026-09-22), the system being manufactured
is not a durable multi-agent coding factory. It is:

> Ontology → Observation → Admission → sJira → Planner → SA2A → XaaS/BRCE →
> Deterministic Execution → Receipt → OCEL → MachineExperience → Ontology

with KNOWN semantics ⇒ zero LLM dependency, and prose (Vision/WBPR) as the
finite semantic boundary that keeps the system out of the operational
Busy-Beaver / arbitrary-semantics business. The Friday future state: a finite
semantic boundary, a working bootstrap/first-mile/last-mile path, and one
closed no-LLM reference loop — everything else classified as successor.

Vision invariants are anchored by `~/chatman-ecosystem-2030-press-release.md`
and `~/.zcode/workspace/default/vision-map/_SYNTHESIS.md` (12-stage loop map);
the doctrine text itself is session-born and is now first projected into a repo
by this file.

## Compiled propositions (G0–G12)

| id | gap class | proposition | falsifier |
|---|---|---|---|
| G0 | first_mile | Accepted Friday WBPR compiled into typed propositions (this graph + file) | A required proposition living only in prose |
| G1 | first_mile | Every 48h-discovered item classified close-now/successor/BLOCKED/UNSUPPORTED/REFUSED | An orphan requirement in no graph row |
| G2 | bootstrap | Cold process reconstructs subjects/capabilities/authority/frontier from durable artifacts alone | Reconstruction needing chat, AGENTS.md, or a model |
| G3 | first_mile | Fresh prose compiles deterministically to admitted semantics + finite delta (this court is the worked example) | Repeated LLM interpretation after admission |
| G4 | first_mile | Every required WorkOrder fully specified and SHACL-admitted | A malformed order still admitted (vacuous court) |
| G5 | core | SJ tuple survives WorkOrder→SA2A→XaaS routing unlost; mutation refused | Silent tuple loss with court passing |
| G6 | core | One KNOWN class runs frontier→capability→claim→heartbeat→close with LLM workers disabled | Model reasoning inside the episode |
| G7 | last_mile | Postcondition independently observed; receipt valid; OCEL event present; standing recomputable | "Executed" claimed from unit tests alone |
| G8 | last_mile | Receipt deterministically changes the derived frontier (before/after diff) | Static frontier after a receipted close |
| G9 | last_mile | Episode 2 with matching preconditions routes KNOWN at materially lower cost | Equivalent rediscovery repeated |
| G10 | last_mile | Cold independent process reconstructs the episode from canonical artifacts | Replay consulting a transcript |
| G11 | bootstrap | Per-repo typed standing matrix; critical path ALIVE, zero unclassified | Unbounded UNKNOWN on the critical path |
| G12 | last_mile | WD proposal frozen 5–8 pages; every claim typed observed/bounded/WD-dependent | An untyped claim presented as observed |

## Exclusions (do NOT keep Friday open)

Additional ideas, better UX, future capabilities (G0); merely-mentioned
improvements (G1); AGENTS.md completeness, skill prose, memory (G2); broad
backlog completeness (G3, G4); provider-implementation count (G5);
takeover sophistication (G6); unit-test passage, PR state, generated files
alone (G7); scheduler/planner optimizations (G8); solving every novel class,
OCEL-mined weights (G9); historical chat retention (G10); making every repo
globally ALIVE (G11); WD production integration/live data/deployment (G12).

## Runnable check

```sh
cd /Users/sac/ggen_igniter && mix run -e '
gate = File.read!("priv/ggen/semantic-jira-pack/gates/070_stop_court.rq")
rows = "/Users/sac/dev/zcode-cli/docs/sjira/v26.9.22/stop-court.ttl"
  |> GgenIgniter.Ontology.load!()
  |> GgenIgniter.Query.run(gate)
IO.puts("open checkpoints: #{length(rows)}")'
# "open checkpoints: 0" = STOP(GALL-FRI-0925)
```

## Receipt convention

Per-gate receipts land in `receipts/v26.9.22/g<N>.json`, validated by
`python3 ~/.claude/dfcm/validate_receipt.py`. BLOCKED gates carry `broken_term`
from the Chatman-equation table. A BLOCKED outcome (e.g. fabric unavailable)
does not fail the court — it is a typed terminal state recorded in the receipt
and reflected in the matrix.

## Stage chain (APS OperatorGlyph)

守 (preserve live repos/O*) → 柵 (closed shape + gate refuse) → 算 (frontier
query) → 除 (exclusions above) → 偽 (falsifiers above; anti-vacuity witnessed
in the pack tests) → 延 (pack reuse ladder: extend semantic-jira-pack, not
invent) → 実 (STOP predicate is a query, not a judgment).

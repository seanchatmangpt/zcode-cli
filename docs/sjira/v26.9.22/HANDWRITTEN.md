# Handwritten Residue — v26.9.22 cycle (opened 2026-09-22)

The v26.9.21 cycle recorded two `UNSUPPORTED(generator-capability)` rows against the
semantic-jira pack (version-directory parameter missing from pack template output paths;
execution descriptors not a `mix ggen_igniter.sync` projection). Those capabilities remain
missing in the pack, so the same residue recurs this cycle:

| File | Role | Status | Why not generated |
| --- | --- | --- | --- |
| `work-orders.ttl` | Canonical source graph (3 orders: ZOCEL-014/015/016) | Hand-authored by design | The ttl is 法面 source input, not a projection |
| `jira/ZOCEL-014.md`, `ZOCEL-015.md`, `ZOCEL-016.md` | Ticket projections of the ttl orders | UNSUPPORTED (generator-capability) | Hand-projected 2026-09-22 pending pack re-run — pack templates hard-code `docs/<kind>/<id>` paths with no version-directory parameter (inherited from v26.9.21 rows); `mix ggen_igniter.sync` re-run will relocate/overwrite these |
| `_RUNBOOK.md`, `README.md` | Dispatch form + cycle guide | UNSUPPORTED (generator-capability) | Canonical runbook form lives in `~/ggen_igniter/docs/jira/v26.9.19/_RUNBOOK.md`; no pack projects it into consumer repos |

Paydown plan: extend the semantic-jira-pack templates with a version-directory parameter so
ticket projections run through `mix ggen_igniter.sync` next cycle; then this ledger shrinks
to zero rows.

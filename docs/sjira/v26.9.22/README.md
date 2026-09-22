# zcode sjira v26.9.22: worker guide

Version v26.9.22 (cycle opened 2026-09-22). Audience: a zcode worker (agent or
human) claiming ZOCEL work orders. The v26.9.21 claim procedure, gall-work lease
fields, receipt template, and common definition of done all still apply and are
NOT duplicated here — see `docs/sjira/v26.9.21/README.md`.

## What this cycle contains

Three work orders, all with no upstream dependency, so all three are on the
frontier. Canonical source: `work-orders.ttl` (same sj: vocabulary and prefixes
as v26.9.21, at https://ggen-igniter.dev/ontology/semantic-jira#). Tickets under
`jira/` are hand-projections of that graph pending a semantic-jira-pack re-run;
edit the graph, never a ticket.

| id | title | repo | dependsOn | ceiling |
| --- | --- | --- | --- | --- |
| 014 | ocel-registry-bridge: wire xaas OcelAshEmitter to the zcode-ocel-pack generated registry (successor of xaas SJ-002, UNSUPPORTED today) | seanchatmangpt/xaas | - | CONSTRUCT |
| 015 | execution-mcp-audit: apply AuditMcpToolCall (or equivalent) to /internal-api/execution/mcp (today only /mcp is audited — audit asymmetry) | seanchatmangpt/xaas | - | CONSTRUCT |
| 016 | ocel-verify-ci: wire scripts/ocel-verify.ts into package.json scripts / CI so OCEL receipts are verified on every test boundary, not ad hoc | seanchatmangpt/zcode-cli | - | CONSTRUCT |

Cycle base SHA: zcode-cli main `e0a77911b804040d5bd3412a86bf94957ad5a2c6`.
For the two xaas orders the working tree is `/Users/sac/xaas` (observed at
`2d229c272c3a02dcb8e75ff600ea0a4edc058d71` on 2026-09-22); the court binds the
exact xaas subjectSha at run time.

## Standing vocabulary

`UNKNOWN | PARTIAL_ALIVE | ALIVE | BLOCKED | BUILD_BROKEN | UNSUPPORTED`
(typed refusals, e.g. `REFUSED_LEASE_CONFLICT`). Scoped per boundary. UNKNOWN is
not UNSUPPORTED; UNSUPPORTED (capability absent) is not REFUSED (authority said
no). Queued CI, a merged PR, or a green synthetic check is not evidence.

## Receipts

Per-ticket receipts go to repo-root `receipts/v26.9.22/` and must validate:

```
python3 ~/.claude/dfcm/validate_receipt.py receipts/v26.9.22/<ticket>.json
```

against `~/.claude/dfcm/receipt.schema.json`. Wave summaries append to
`_RUNLOG.md` beside this README (append-only). Dispatch and history rules live in
`_RUNBOOK.md`.

## calver supply correction

The wave-v26.9.17 receipts pin `feat/calver-ticket-day-pack@d018ed4`, but that
branch is deleted; the current ggen_igniter line is `feat/zcode-ocel-pack@f81cf54`.

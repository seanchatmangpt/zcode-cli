# docs/sjira/v26.9.23 — ZCODE-26923-01 release wave

Canonical graph: `work-orders.ttl` (one WorkOrder, ZCODE-26923-01 "Align to
ZCode.app 3.14.3 + release v26.9.23", with lanes L1–L10 as acceptance sub-items).
Projection: `jira/ZCODE-26923-01.md` (hand-projection pending a semantic-jira-pack
re-run; edit the TTL, never the ticket).

Pattern follows `docs/sjira/v26.9.21/` (work-orders.ttl + jira/*.md) with the
v26.9.22 compact vocabulary declarations. Durable receipts live in
`receipts/v26.9.23/` (schema `receipt/v1`, validated fail-closed by
`bun run receipts:validate`).

## Lanes

| Lane | Scope | Owner files |
| --- | --- | --- |
| L1 | patch coverage vs ZCode.app 3.14.3 | src patches + tests |
| L2 | sync gates | scripts/sync-runtime.ts + tests |
| L3 | provider bridge | src provider surface |
| L4 | session recovery | src/session-model-recovery.ts |
| L5 | ocel enums | ontology + src/generated |
| L6 | launcher tap | src/launcher.ts + tap |
| L7 | runtime lock | zcode-runtime.lock.json |
| L8 | docs | docs/** |
| L9 | release cut | package.json, HANDWRITTEN.md, docs/sjira/v26.9.23/**, receipts/v26.9.23/** |
| L10 | verifier | receipts/v26.9.23/ZCODE-26923-01.json final content, tag |

Shared-tree law: all lanes work on main; commit only owned files; authority for
merge-to-default + push + tag is the operator order 2026-09-23, executed only
after the L10 verifier gates are green.

# v26.9.22 wave runbook — canonical form (adapted from ggen_igniter docs/jira/v26.9.19/_RUNBOOK.md)

Stage chain 守→柵→算→除→偽→延→実 per APS OperatorGlyph; pacing per APS SwarmPacingLaw.

HISTORY LAW: the ticket .md files beside this runbook ARE the session history.
Append every transition to the ticket as
`ts | standing | branch+SHA | gates+exits | remaining`.
Conversation drifts; the append-only files do not.

1. PLAN (守 Preserve): read `docs/sjira/v26.9.22/work-orders.ttl` and the ticket
   before working; select OPEN tickets; one worktree per ticket; status ->
   IN_PROGRESS. Never touch the main checkout; never push.
2. SATURATE (柵 Fence): dispatch to the measured concurrency max for the active
   tier, maintained by top-up — never burst. On rate refusal: drain, halve pace.
3. AGENT CONTRACT (算/除/偽): "You work ticket <path>. READ IT FIRST — it is
   your entire history. Gates must exit 0. Commit atomically with receipt
   body. APPEND to History; set status DONE or BLOCKED. Never push."
4. RECEIPT (実): append the wave summary to `_RUNLOG.md` (append-only). Per-ticket
   receipts live at repo-root `receipts/v26.9.22/` and are schema-validated.

Dispatch one-liner (worktree + ticket path):

```
zcode --cwd /Users/sac/wt/<worktree> -p "You work ticket docs/sjira/v26.9.22/jira/<TICKET>.md. READ IT FIRST — it is your entire history."
```

延 Extension: before hand-writing on 産面, run the search ladder over the packs
(reuse → compose → extend → invent); any hand-written residue goes to
HANDWRITTEN.md. 偽 Falsifier: every acceptance names the observation that kills
it; a gate that cannot refuse carries no bits.

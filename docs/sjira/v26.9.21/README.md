# zcode sjira v26.9.21: worker guide

Version v26.9.21. Audience: a zcode worker (agent or human) claiming ZOCEL work orders.

## Purpose

This folder holds the work orders ZOCEL-001..012 for the zcode OCEL consumer line, and the
rules every ticket inherits. A worker claims one order, builds it in an isolated worktree,
and closes it with a receipt. Nothing here is proof of work done; a claim needs a run.

## Folder layout

```text
docs/sjira/v26.9.21/
  README.md          this guide
  000-survey.md      observed-state receipt (read-only commands actually run)
  work-orders.ttl    canonical source (UNKNOWN: not yet present in this tree)
  NNN-*.md           generated tickets (projection of work-orders.ttl; never hand-edit)
  plan/*.hddl        HDDL plans per order (generated)
  descriptors/*.json gall.work-lease/1 descriptors, one per claimable order
```

`work-orders.ttl` is the source; tickets, plans, and descriptors are projections. Edit the
graph, regenerate.

## How a zcode worker claims work

Source: `git show w9-sweep/zcode-pr3:src/gall-work.ts` (worktree
`/private/tmp/xaas-w9-sweep-zcode-cli`).

```bash
XAAS_WORKER=1 zcode gall-work --lease descriptor.json --json
```

- The runtime is spawned with env `XAAS_WORKER=1`. There is no `/xaas claim_next` prompt
  fallback: a refused claim is a typed non-zero exit, never a retry-as-prompt.
- Alternate form: `--worker-id ID --epoch-id UUID --cwd DIR`.
- Fabric endpoint/token come from `XAAS_MCP_URL` / `XAAS_MCP_TOKEN`.

### gall.work-lease/1 fields

| field | constraint |
| --- | --- |
| schema | literal `gall.work-lease/1` |
| work_order_iri | absolute IRI (contains `:`) |
| checkpoint_iri | absolute IRI |
| graph_digest | `sha256:<64 lowercase hex>` |
| repository_identity | `owner/name` |
| base_sha | exact 40-hex commit |
| epoch_id | UUID |
| worker_id | `[A-Za-z0-9._:-]{1,128}` |
| worktree | absolute path |

### Outcomes and exit codes

Outcomes: `alive`, `partial_alive`, `blocked`, `build_broken`, `unsupported`, `refused`
(mapped to ALIVE, PARTIAL_ALIVE, BLOCKED, BUILD_BROKEN, UNSUPPORTED, REFUSED).

| exit | meaning |
| --- | --- |
| 0 | receipt sealed (closed or refused); epoch terminal |
| 1 | typed refusal or UNKNOWN without a receipt |
| 2 | argument/lease parse error |
| 65 | REFUSED_LEASE_CONFLICT |
| 142 | contract exit; UNKNOWN meaning here (not seen in the inspected lines of
      gall-work.ts; see test/fixtures/gall-work.contract.json) |

Runtime exit 0 closes as `alive` and the fabric verifier court may falsify it; a failed turn
closes as `blocked`.

## Frontier rule and dependency order

A work order is on the frontier iff every order it depends on is closed with standing ALIVE
at an exact-head receipt. Claim only frontier orders. Claim one order per worktree.

```text
ZOCEL-001 .. ZOCEL-012
edges: UNKNOWN (work-orders.ttl absent). Read
  ?order zo:dependsOn ?dep
from work-orders.ttl once generated, then redraw this DAG from that query.
```

Redraw command (UNKNOWN until the graph exists):
`git -C /Users/sac/wt/sjira-v26-9-21 log --oneline -- docs/sjira/v26.9.21/work-orders.ttl`.

## Common definition of done (every ticket inherits)

Distilled from autofde-lab level4-completion-law.md and standing-law.md, the 12-gate Chicago
court (tests/sa2a/test_v26_9_16_chicago_court.py), gymact ocel-standing.md and
docs/gcp-exact-conformance.md, gymact models.py, and testing-chicago-style.md.

- [ ] Exact identity fenced: repo, base SHA, candidateSha, subjectSha recorded.
- [ ] Executable world admitted: the subject builds and runs from a clean checkout.
- [ ] Real collaborators, zero mocks. Run a real grep and paste output:
      `grep -rn "unittest.mock\|Mock(\|MagicMock\|patch(\|monkeypatch\|jest.mock\|jest.fn"
      <test dirs>` (zero matches, or each match justified as an explicit named exception).
- [ ] Assertions are on final state (values, file contents, digests), not call counts.
- [ ] Planning output stays candidate-only; a plan or proof is not authority.
- [ ] Whole bounded plan preflighted before execution.
- [ ] Every consequence goes through the sole DO boundary (BRCE); no unreceipted actuation.
- [ ] Postcondition observed by an independent verifier, not the actuator's own report.
- [ ] Receipt binds identity completely (see template); replay is deterministic.
- [ ] Fresh-consumer proof: a clean checkout consumer runs the artifact.
- [ ] Standing is typed; ALIVE only per the rule below.
- [ ] Mutation law: mutate each required relation's identity; admission must return a typed
      non-ALIVE result.
- [ ] Verification gate run for the language in play (build, tests, fmt, lint) with real
      output pasted, after every change; files re-read after every edit.
- [ ] Pre-existing failures and failures introduced this session stated separately, in every
      report.
- [ ] Exact-head receipt line present (below).
- [ ] Docs: plain markdown, lines at most 100 chars, language on every code block.

### Status vocabulary

`UNKNOWN | PARTIAL_ALIVE | ALIVE | BLOCKED:<reason> | BUILD_BROKEN | UNSUPPORTED | REFUSED`
(typed, e.g. REFUSED_LEASE_CONFLICT). Scoped per boundary. UNKNOWN is not UNSUPPORTED;
UNSUPPORTED (capability absent) is not REFUSED (authority said no). Queued CI, a merged PR,
or a green synthetic check is not evidence.

### ALIVE rule

ALIVE requires a command actually run this session, its output observed, and candidateSha +
subjectSha + receipt. A pytest/unit pass is a fact about the API, not about the consequence
(request accepted != world changed != objective verified != scored). Anything not run is
UNKNOWN with the exact command that would run it.

Exact-head receipt line:

```text
Exact Head Commit: <40-hex sha> verified by <command> exit <n> at <UTC time>
```

### Git rules (fix forward)

No rebase, no `reset --hard`, no force-push, no blanket `-X ours/theirs`. Add commits; use
`git revert` if needed. Commit with `git commit -F <file>`, then read the message back with
`git log -1 --format=%B`. Never touch the main checkout. Merge and push are human steps.

### Agent rules

- First line of every agent prompt: absolute repo path. Agent runs `cd` there and confirms
  `pwd` before reporting.
- One workflow per repo at a time; check running workflows before launching another.

## Receipt template

```markdown
# Receipt: <ticket id>

- Repo: <absolute path>   Worktree: <absolute path>   Branch: <branch>
- Base SHA: <40-hex>
- Exact Head Commit: <40-hex>
- candidateSha: <40-hex>   subjectSha: <40-hex>
- Epoch: <uuid>   Worker: <worker_id>   Lease IRI: <work_order_iri>

## Commands and exit codes
| command | exit | output excerpt |
| --- | --- | --- |

## Verification ladder
narrow / unit / integration / e2e / chaos / stress / benchmark: status each, with witness.

## Replay
Command, output, deterministic (yes/no).

## Standing
technicalStanding: <status>   organizationalStanding: <status>
enterpriseStanding: <status>

## Failures
Pre-existing: <list>   Introduced this session: <list>

## Falsifiers
Observation that would refute the claim, and whether it was run.

## BLOCKED / UNSUPPORTED / REFUSED
<typed entries with exact reason>
```

## What remains human

- Merge to main and push (workers never do either).
- Signing keys and any credential setup.
- Stale worktrees: review and prune (see 000-survey.md).
- Acceptance that moves organizationalStanding.

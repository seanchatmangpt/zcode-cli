# v26.11.21 — Dogfood Explore remainder + Exploit queue

Calendar milestone after the integrity wave on `main` (`2580032`, PRs **#21–#36+#38** merged). Agents **eat their own dog food**: claim sJira work orders → POWL → OCEL/receipts → fail-closed courts. Do **not** re-open integrity subjects already on main.

## Canonical source

| Artifact | Path |
|---|---|
| **Work-order graph** | [`work-orders.ttl`](./work-orders.ttl) |
| ARD (Explore vs Exploit) | [`ard/ZCODE-CLI-SPEC-26.11.21.md`](./ard/ZCODE-CLI-SPEC-26.11.21.md) |
| Ticket projections | [`jira/`](./jira/) |
| HDDL plans (ferroplan grammar) | [`plan/`](./plan/) |
| Frontier seed | [`execution/frontier-seed.json`](./execution/frontier-seed.json) |
| Court receipts (empty until runs) | [`receipts/`](./receipts/) + repo-root `receipts/v26.11.21/` |

Edit **`work-orders.ttl` only**; regenerate projections. Tickets/plans are hand-projections pending a semantic-jira-pack re-run.

Prior wave: [`../v26.11.20/`](../v26.11.20/) (SPEC Explore→Exploit). Normative honesty still inherits SPEC §0.3.

## Explore vs Exploit

| Lane | IDs | Meaning |
|---|---|---|
| **EXPLORE** | `ZCODE-261121-01` … `10` | Honesty / QMS / dogfood loop. Claim freely on the frontier. |
| **EXPLOIT** | `ZCODE-261121-11` … `15` | Charter upgrades (A★, transactional nets, OCPN, TTFT AIMD, retry caps). **Depends on `01` ALIVE** (and `12` also on `10`). Do not corrupt Explore measurements or market as present before receipts. |

**Not in scope (already merged):** integrity PRs #21–#36+#38 (WF-net, drainSilent, token replay, case FSM, AIMD serviceMs, POWL scopes, leases, SQLite, TUI `--print` tap, OCEL schema/tap/redaction, receipts floor, courts, path bounds, HANDWRITTEN, C4 docs).

## How to start the dogfood loop

```bash
# 1. Pin absolute ggen (no PATH). Record identity in the receipt.
export GGEN_BIN=/absolute/path/to/ggen   # hands-free ancestor >= fd4f99bbd preferred

# 2. Optional: emit frontier / candidates from this graph
"$GGEN_BIN" sjira frontier   # or set SJIRA_CANDIDATES=…/candidates.jsonl

# 3. Dry-run Gall foundry spine (CONSTRUCT ceiling; honest exits)
bun scripts/powl-foundry-loop.ts --dry-run
bun test test/adapters.test.ts test/sjira-adapter.test.ts test/adapters-chicago.test.ts

# 4. Claim one frontier order (01–10 first). Close with a receipt — never fake ALIVE.
#    Standing vocabulary: UNKNOWN | PARTIAL_ALIVE | ALIVE | BLOCKED | BUILD_BROKEN | UNSUPPORTED
```

Acceptance gates for the meta-loop live on **`ZCODE-261121-01`**. Marketplace / igniter courts must fail-closed (`validateWriteScope` before mutate; clean-room = unstaged + staged + untracked).

## Work-order index

| id | lane | title | dependsOn |
|---|---|---|---|
| 01 | EXPLORE | Dogfood loop — GGEN_BIN + frontier→POWL→ledger | — |
| 02 | EXPLORE | Calver / lock / AGENTS honesty | — |
| 03 | EXPLORE | STANDING-RECEIPT re-cert | — |
| 04 | EXPLORE | HDDL ferroplan + pyshacl corpus | — |
| 05 | EXPLORE | Vendor-free CI / Chicago timeout | — |
| 06 | EXPLORE | Interactive TUI OCEL gap | — |
| 07 | EXPLORE | XAAS PreToolUse live gate | — |
| 08 | EXPLORE | Annex IV / Art.11 technical pack | — |
| 09 | EXPLORE | order_hook / MxLoop pack leakage | — |
| 10 | EXPLORE | WorkspaceFingerprint Explore stub | — |
| 11 | EXPLOIT | A★ trace alignment | 01 |
| 12 | EXPLOIT | Transactional lifecycle + rollback | 01, 10 |
| 13 | EXPLOIT | OCPN / OC-DFG discovery | 01 |
| 14 | EXPLOIT | Kingman / TTFT AIMD split | 01 |
| 15 | EXPLOIT | Per-signature remediation retry caps | 01 |

Cycle base SHA: `2580032e6933d2c850918ccdf3d132d506a34726`.

## Standing & receipts

Promotion only from an exact-head court receipt binding `candidateSha` / `subjectSha`. Validate with `bun run receipts:validate` when JSON receipts land under `receipts/v26.11.21/`.

## Igniter clean-room (when packs present)

```bash
# Compiler-first sync expectation (Appendix E): after sync, tree must be clean
git diff --exit-code
git diff --cached --exit-code
test -z "$(git ls-files --others --exclude-standard)"
```

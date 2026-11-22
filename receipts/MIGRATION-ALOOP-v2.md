# Migration note — ALOOP receipt/v2 (c4ca90f5)

## What changed

New receipts must carry Chatman-5 (`identity`, `authority`, `consequence`,
`replay`, `standing`) **plus** ALOOP v2 required fields:

| Field | Role |
| --- | --- |
| `work_order_id` | ExecutionRequest.work_order id |
| `origin_authority` | `{ grant, actor }` (+ optional `ceiling`) under which the request originated |
| `provider` | `{ name }` (+ optional transport / ceilings) |
| `provider_execution_id` | provider-side execution id (joins OCEL chain) |

Canonical skeleton: [`_template.json`](./_template.json). Wave copies:
[`v26.9.22/_template.json`](./v26.9.22/_template.json),
[`v26.9.23/_template.json`](./v26.9.23/_template.json). Files named `_*.json`
are skipped by `bun run receipts:validate`.

## Historical corpus — ALOOP v2 unadmitted (no mass rewrite)

Filed `receipts/v26.9.22/**` and `receipts/v26.9.23/**` (except explicit
migrated witnesses) remain **ALOOP v2 unadmitted** until each is migrated with
real provenance. Most are pure Chatman-5 / receipt-v1 (no `work_order_id` /
`origin_authority` / `provider` / `provider_execution_id`). Inventing those ids
across the corpus would be a lie — **do not mass-rewrite**.

Admit status by surface:

| Surface | Historical pure-v1 | New / migrated (from `_template.json`) |
| --- | --- | --- |
| `~/.zcode/dfcm/validate_receipt.py` | **REFUSED / unadmitted** (missing ALOOP v2 required[]) | **ADMIT** when filled with real fields + integrity-clean SHAs |
| `bun run receipts:validate` | Integrity floor + W107 v1 Chatman-5 adapter (continuity only; **not** ALOOP v2 admission) | Full external schema path (partial v2 → REFUSE) |

Path:

1. **Templates** — new work copies `_template.json` (v2).
2. **Adapter** — `scripts/validate-receipts.ts` applies W107-style version
   discrimination: pure v1 → Chatman-5 structural admit after the integrity
   floor; any v2 field present → full external `validate_receipt.py` (partial
   v2 is malformed v2 and REFUSED).
3. **Safe exemplar** — `v26.9.22/g0.json` migrated to ALOOP v2 from recorded
   fields only (`work_order_id: G0`, `origin_authority` mirrored from
   `authority`, `provider.name: zcode-session`); `provider_execution_id` is an
   explicit `UNRECOVERED (…)` string (not a fabricated exec id); `identity.repo`
   retargeted to `/Users/sac/zcode-cli` so the commit anchor witnesses.
4. **Integrity floor stays fail-closed** — `ALIVE` + nonzero replay exit, and
   non-commit `subject_sha` / `base_sha`, still REFUSE regardless of version.
   Known outliers: `v26.9.22/_g3.cross-repo-sha.json` (quarantined `_` prefix —
   SHAs anchor `ggen_igniter`, not this clone); `v26.9.23/ZCODE-26923-01.json`
   nested `r2` keeps `standing=ALIVE` with nonzero replay exits as an
   **intentional integrity-floor tripwire** (`test/validate-receipts-integrity.test.ts`).
   Expected gate shape after this migration + golden: **26/27 ADMITTED**,
   exit 1 — not 27/27 green theater (ZCODE-26923-01 still trips integrity).

### Validate path (operators)

```bash
# Fail-closed tree gate (integrity + schema adapter)
bun run receipts:validate

# Direct product schema check (one file; requires ALOOP v2)
python3 ~/.zcode/dfcm/validate_receipt.py receipts/<wave>/<slug>.json
```

## ReceiptSink honesty

`src/adapters/receipt-sink.ts` `writeDfcmReceipt` emits schema
`zcode.dfcm.receipt/1` — a cycle-close **stub**, not Chatman-5 / receipt/v2.
Body is fail-closed: `admit: false`, `non_admit: true`, plus
`non_admit_reason` naming the missing ALOOP v2 quartet. Do not file stub
DFCM under `receipts/**` as admitted ALOOP receipts
(`isDfcmStubNonAdmit` is the machine gate). Lease-bound Chatman-5/ALOOP v2
writers remain UNSUPPORTED (see `HANDWRITTEN.md`).

## Exp-4 / v26.11.20

Explore Exp-4 pilot evidence (`REPORT.md`, `runs/*`) remains empty until live
runs (SPEC-gated). Scaffold only: refuse stub `scripts/exp4-ocel-mining-pilot.ts`
+ DOC-ONLY `exp4/PLAN.md` — standing `NOT_ALIVE`, never fake mining. Schema-contract
witness only:

- [`v26.11.20/golden-aloop-v2-admit.json`](./v26.11.20/golden-aloop-v2-admit.json)
  — one ALOOP v2 receipt that admits under `~/.zcode/dfcm/validate_receipt.py`.
  Not Exp-4 pilot evidence; do not treat as H1–H4 confirmation.

## Operator sync (optional)

`~/.claude/dfcm/validate_receipt.py` already discriminates v1/v2.
`~/.zcode/dfcm/validate_receipt.py` still requires all v2 fields unconditionally;
the in-repo adapter bridges Chatman-5 continuity until the product validator is
synced — it does **not** reclassify historical files as ALOOP v2 admits.

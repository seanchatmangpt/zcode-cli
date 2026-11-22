# receipts/v26.9.22 — DfCM receipt ledger

One JSON receipt per completed work order or session, named `<ticket-or-slug>.json`
(e.g. `zocel-010.json`). `_template.json` is the **ALOOP / Chatman receipt/v2**
skeleton: copy it, replace every `REPLACE_*` placeholder (and the `000…0` SHAs;
`commits` ships empty because the schema only admits commit-SHA patterns), then
validate before committing.

Validate:

```
bun run receipts:validate
# or directly:
python3 ~/.zcode/dfcm/validate_receipt.py receipts/v26.9.22/<name>.json
```

The script globs `receipts/**/*.json` (files starting with `_` are treated as
partials and skipped) and fails closed (exit 1) if anything is refused or if the
set is empty.

Schema: `https://chatmangpt.com/schema/receipt/v2` (`~/.zcode/dfcm/receipt.schema.json`).
Canonical skeleton also at [`../_template.json`](../_template.json); migration
note: [`../MIGRATION-ALOOP-v2.md`](../MIGRATION-ALOOP-v2.md).

## Historical corpus — ALOOP v2 unadmitted (do not mass-rewrite)

Most filed receipts in this wave (g1–g12, g2-cold-start, ZCODE-26922-*,
zocel-009, stop-court-final, v26922-gap-wave, …) remain **pure Chatman-5 v1**
and **ALOOP v2 unadmitted** until migrated — they omit `work_order_id` /
`origin_authority` / `provider` / `provider_execution_id`. Do **not**
mass-rewrite them to invent ALOOP fields. Product
`~/.zcode/dfcm/validate_receipt.py` REFUSES them; `bun run receipts:validate`
may still pass the in-repo Chatman-5 continuity adapter after the integrity
floor (see [`../MIGRATION-ALOOP-v2.md`](../MIGRATION-ALOOP-v2.md)) — that is
not ALOOP v2 admission.

Migrated ALOOP v2 witnesses (honest provenance only; not Exp-4):
`g0.json` (G0 court; `provider_execution_id` marked UNRECOVERED) and
[`../v26.11.20/golden-aloop-v2-admit.json`](../v26.11.20/golden-aloop-v2-admit.json).

The five R-fields (still required):

- **identity** — what was made: subject, repo, `subject_sha` (exact 40-hex head the
  work was verified at) and `base_sha`.
- **authority** — why it was lawful: `ceiling` (OBSERVE/SELECT/CONSTRUCT/DO),
  `grant` (lease id / user decision reference), `actor`.
- **consequence** — what changed durably: `commits`, `files_changed`,
  `remote_effects`.
- **replay** — how to re-execute it: at least one `{cmd, exit, cwd}` command run
  against the exact subject.
- **standing** — the verdict: `UNKNOWN | PARTIAL_ALIVE | ALIVE | BLOCKED | …`,
  always with `derived_from` naming the replay command(s) that justify it.

ALOOP v2 execution provenance (required on every **new** receipt; see `_template.json`):

- **work_order_id** — id of the work order this execution discharged.
- **origin_authority** — `{grant, actor}` (optional `ceiling`) under which the
  ExecutionRequest originated; must match chain events.
- **provider** — `{name, …}` execution-provider identity (ALOOP ExecutionProvider).
- **provider_execution_id** — provider-side execution id joining the OCEL chain.

Standing must be derived from replay evidence, never asserted. `ALIVE` with any
non-zero replay exit is refused by the validator (`admission_vacuous`), as is a
`subject_sha` that is not a commit in the repo (`R_missing_identity`).

## Quarantine

- `_g3.cross-repo-sha.json` — G3 court receipt whose `identity.*_sha` anchors are
  commits in `ggen_igniter`, not this repository. In-repo integrity floor refuses
  foreign SHAs; kept under `_` so `receipts:validate` skips it until re-anchored
  against a locally verifiable checkout.

Note: `src/adapters/receipt-sink.ts` `writeDfcmReceipt` emits a separate cycle-close
stub (`zcode.dfcm.receipt/1`) — that stub is **not** Chatman-5 / receipt/v2 and is
not admitted by this ledger (see `HANDWRITTEN.md`).

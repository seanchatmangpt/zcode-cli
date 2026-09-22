# receipts/v26.9.22 — DfCM receipt ledger

One JSON receipt per completed work order or session, named `<ticket-or-slug>.json`
(e.g. `zocel-010.json`). `_template.json` is the schema-conformant skeleton: copy it,
replace every `REPLACE_*` placeholder (and the `000…0` SHAs; `commits` ships
empty because the schema only admits commit-SHA patterns), then validate before
committing.

Validate:

```
bun run receipts:validate
# or directly:
python3 ~/.claude/dfcm/validate_receipt.py receipts/v26.9.22/<name>.json
```

The script globs `receipts/**/*.json` (files starting with `_` are treated as
partials and skipped) and fails closed (exit 1) if anything is refused or if the
set is empty.

The five R-fields (schema `receipt/v1`):

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

Standing must be derived from replay evidence, never asserted. `ALIVE` with any
non-zero replay exit is refused by the validator (`admission_vacuous`), as is a
`subject_sha` that is not a commit in the repo (`R_missing_identity`).

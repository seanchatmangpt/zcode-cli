# receipts/v26.9.23 — DfCM receipt ledger

Filed receipts in this wave are **pure Chatman-5 / v1** and remain **ALOOP v2
unadmitted** until migrated with real `work_order_id` / `origin_authority` /
`provider` / `provider_execution_id`. Do not invent those fields in bulk —
see [`../MIGRATION-ALOOP-v2.md`](../MIGRATION-ALOOP-v2.md).

`_template.json` is the ALOOP / Chatman receipt/v2 skeleton for **new** filings.
Copy it, replace every `REPLACE_*` (and the `000…0` SHAs), then validate.

## Validate path

```
bun run receipts:validate
# or (product schema; requires ALOOP v2 fields):
python3 ~/.zcode/dfcm/validate_receipt.py receipts/v26.9.23/<name>.json
```

`bun run receipts:validate` may Chatman-5-adapt pure-v1 after the integrity
floor; that continuity path is **not** product ALOOP v2 admission.

Integrity note: `ZCODE-26923-01.json` nested `r2` is an intentional
`ALIVE`+nonzero-exit tripwire for the in-repo integrity floor; the tree gate
is expected to REFUSE that one file until the nested standing is honest.

# How to: Using zcode-cli

## Prerequisites


- src/research-runtime/sa2a/receipt-feedback.ts::Sa2aPortableReceipt (interface)

- src/research-runtime/sa2a/receipt-feedback.ts::applyReceiptFeedback (function)


## Steps


1. Use `applyReceiptFeedback` from `src/research-runtime/sa2a/receipt-feedback.ts`.

2. Use `Sa2aPortableReceipt` from `src/research-runtime/sa2a/receipt-feedback.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/research-runtime/sa2a/receipt-feedback.ts :: applyReceiptFeedback
export function applyReceiptFeedback(envelope: Sa2aReplanEnvelope, receipt: Sa2aPortableReceipt): Sa2aReplanEnvelope
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

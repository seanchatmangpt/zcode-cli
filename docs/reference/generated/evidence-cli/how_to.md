# How to: Using zcode-cli

## Prerequisites


- src/evidence-cli.ts::EvidenceAdmissionReceipt (interface)

- src/evidence-cli.ts::runEvidenceCommand (function)

- src/evidence-cli.ts::verifyEvidenceBundle (function)


## Steps


1. Use `runEvidenceCommand` from `src/evidence-cli.ts`.

2. Use `verifyEvidenceBundle` from `src/evidence-cli.ts`.

3. Use `EvidenceAdmissionReceipt` from `src/evidence-cli.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/evidence-cli.ts :: runEvidenceCommand
export async function runEvidenceCommand(args: string[]): Promise<number | undefined>
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

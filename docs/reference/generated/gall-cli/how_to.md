# How to: Using zcode-cli

## Prerequisites


- src/gall-cli.ts::GallFreshConsumerReceipt (interface)

- src/gall-cli.ts::runGallCommand (function)

- src/gall-cli.ts::verifyGallBundle (function)

- src/gall-cli.ts::verifyPortableGallArtifact (function)


## Steps


1. Use `runGallCommand` from `src/gall-cli.ts`.

2. Use `verifyGallBundle` from `src/gall-cli.ts`.

3. Use `verifyPortableGallArtifact` from `src/gall-cli.ts`.

4. Use `GallFreshConsumerReceipt` from `src/gall-cli.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/gall-cli.ts :: runGallCommand
export async function runGallCommand(args: string[]): Promise<number | undefined>
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

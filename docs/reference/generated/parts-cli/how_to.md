# How to: Using zcode-cli

## Prerequisites


- src/parts-cli.ts::PartAlternative (interface)

- src/parts-cli.ts::SemanticFalsifierResult (interface)

- src/parts-cli.ts::findPartAlternatives (function)

- src/parts-cli.ts::inspectSemanticPart (function)

- src/parts-cli.ts::runPartsCommand (function)

- src/parts-cli.ts::semanticCandidateFalsifier (function)


## Steps


1. Use `findPartAlternatives` from `src/parts-cli.ts`.

2. Use `inspectSemanticPart` from `src/parts-cli.ts`.

3. Use `runPartsCommand` from `src/parts-cli.ts`.

4. Use `semanticCandidateFalsifier` from `src/parts-cli.ts`.

5. Use `PartAlternative` from `src/parts-cli.ts`.

6. Use `SemanticFalsifierResult` from `src/parts-cli.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/parts-cli.ts :: findPartAlternatives
export function findPartAlternatives( graphValue: unknown, subjectId: string, axes: string[]
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

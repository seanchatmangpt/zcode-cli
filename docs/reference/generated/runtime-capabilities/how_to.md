# How to: Using zcode-cli

## Prerequisites


- src/runtime-capabilities.ts::RuntimeCapabilities (interface)

- src/runtime-capabilities.ts::RuntimeCliOptionCapability (interface)

- src/runtime-capabilities.ts::RuntimeCliOptionType (type)

- src/runtime-capabilities.ts::capabilitiesFromExtractionMetadata (function)

- src/runtime-capabilities.ts::parseRuntimeCapabilities (function)


## Steps


1. Use `capabilitiesFromExtractionMetadata` from `src/runtime-capabilities.ts`.

2. Use `parseRuntimeCapabilities` from `src/runtime-capabilities.ts`.

3. Use `RuntimeCapabilities` from `src/runtime-capabilities.ts`.

4. Use `RuntimeCliOptionCapability` from `src/runtime-capabilities.ts`.

5. Use `RuntimeCliOptionType` from `src/runtime-capabilities.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/runtime-capabilities.ts :: capabilitiesFromExtractionMetadata
export function capabilitiesFromExtractionMetadata(value: unknown): RuntimeCapabilities | undefined
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

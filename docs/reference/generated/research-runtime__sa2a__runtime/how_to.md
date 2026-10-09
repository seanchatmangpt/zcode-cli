# How to: Using zcode-cli

## Prerequisites


- src/research-runtime/sa2a/runtime.ts::PortableRecoveryRuntimeInput (interface)

- src/research-runtime/sa2a/runtime.ts::PortableRecoveryRuntimeResult (interface)

- src/research-runtime/sa2a/runtime.ts::runPortableRecoveryRuntime (function)


## Steps


1. Use `runPortableRecoveryRuntime` from `src/research-runtime/sa2a/runtime.ts`.

2. Use `PortableRecoveryRuntimeInput` from `src/research-runtime/sa2a/runtime.ts`.

3. Use `PortableRecoveryRuntimeResult` from `src/research-runtime/sa2a/runtime.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/research-runtime/sa2a/runtime.ts :: runPortableRecoveryRuntime
export async function runPortableRecoveryRuntime(input: PortableRecoveryRuntimeInput): Promise<PortableRecoveryRuntimeResult>
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

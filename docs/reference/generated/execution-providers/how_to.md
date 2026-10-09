# How to: Using zcode-cli

## Prerequisites


- src/execution-providers.ts::DEFAULT_EXECUTION_PROVIDER (const)

- src/execution-providers.ts::ExecutionProviderRead (interface)

- src/execution-providers.ts::ExecutionProviderRegistry (interface)

- src/execution-providers.ts::ExecutionProviderRule (interface)

- src/execution-providers.ts::ExecutionProviderSelection (interface)

- src/execution-providers.ts::ReadConfigText (type)

- src/execution-providers.ts::builtinExecutionProvider (function)

- src/execution-providers.ts::executionProviderConfigPath (function)

- src/execution-providers.ts::parseExecutionProviderRegistry (function)

- src/execution-providers.ts::selectExecutionProvider (function)


## Steps


1. Use `DEFAULT_EXECUTION_PROVIDER` from `src/execution-providers.ts`.

2. Use `builtinExecutionProvider` from `src/execution-providers.ts`.

3. Use `executionProviderConfigPath` from `src/execution-providers.ts`.

4. Use `parseExecutionProviderRegistry` from `src/execution-providers.ts`.

5. Use `selectExecutionProvider` from `src/execution-providers.ts`.

6. Use `ExecutionProviderRead` from `src/execution-providers.ts`.

7. Use `ExecutionProviderRegistry` from `src/execution-providers.ts`.

8. Use `ExecutionProviderRule` from `src/execution-providers.ts`.

9. Use `ExecutionProviderSelection` from `src/execution-providers.ts`.

10. Use `ReadConfigText` from `src/execution-providers.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/execution-providers.ts :: builtinExecutionProvider
export function builtinExecutionProvider(): ExecutionProviderRule
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

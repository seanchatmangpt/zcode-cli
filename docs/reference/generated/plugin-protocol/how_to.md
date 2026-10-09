# How to: Using zcode-cli

## Prerequisites


- src/plugin-protocol.ts::PluginReferenceCatalogResult (interface)

- src/plugin-protocol.ts::PluginReferenceSummary (interface)

- src/plugin-protocol.ts::PluginWorkspace (interface)

- src/plugin-protocol.ts::pluginProtocolMethods (const)

- src/plugin-protocol.ts::pluginWorkspace (function)


## Steps


1. Use `pluginProtocolMethods` from `src/plugin-protocol.ts`.

2. Use `pluginWorkspace` from `src/plugin-protocol.ts`.

3. Use `PluginReferenceCatalogResult` from `src/plugin-protocol.ts`.

4. Use `PluginReferenceSummary` from `src/plugin-protocol.ts`.

5. Use `PluginWorkspace` from `src/plugin-protocol.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/plugin-protocol.ts :: pluginWorkspace
export function pluginWorkspace(path: string): PluginWorkspace
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

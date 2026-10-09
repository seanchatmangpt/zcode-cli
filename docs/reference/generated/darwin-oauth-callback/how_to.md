# How to: Using zcode-cli

## Prerequisites


- src/darwin-oauth-callback.ts::CommandRunner (type)

- src/darwin-oauth-callback.ts::DarwinUrlCallbackOptions (interface)

- src/darwin-oauth-callback.ts::DarwinUrlCallbackReceiver (interface)

- src/darwin-oauth-callback.ts::callbackAppleScript (function)

- src/darwin-oauth-callback.ts::createDarwinUrlCallbackReceiver (function)

- src/darwin-oauth-callback.ts::recoverStaleDarwinOAuthHandler (function)


## Steps


1. Use `callbackAppleScript` from `src/darwin-oauth-callback.ts`.

2. Use `createDarwinUrlCallbackReceiver` from `src/darwin-oauth-callback.ts`.

3. Use `recoverStaleDarwinOAuthHandler` from `src/darwin-oauth-callback.ts`.

4. Use `DarwinUrlCallbackOptions` from `src/darwin-oauth-callback.ts`.

5. Use `DarwinUrlCallbackReceiver` from `src/darwin-oauth-callback.ts`.

6. Use `CommandRunner` from `src/darwin-oauth-callback.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/darwin-oauth-callback.ts :: callbackAppleScript
export function callbackAppleScript( callbackPath: string, scheme: string, previousHandler: string ): string[]
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

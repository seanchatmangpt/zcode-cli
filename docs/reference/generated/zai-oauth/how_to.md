# How to: Using zcode-cli

## Prerequisites


- src/zai-oauth.ts::OfficialLoginPayload (interface)

- src/zai-oauth.ts::ZaiOAuthCallback (interface)

- src/zai-oauth.ts::ZaiOAuthInvocation (interface)

- src/zai-oauth.ts::ZaiOAuthLoginOptions (interface)

- src/zai-oauth.ts::buildZaiAuthorizeUrl (function)

- src/zai-oauth.ts::classifyZaiOAuthInvocation (function)

- src/zai-oauth.ts::parseZaiOAuthCallback (function)

- src/zai-oauth.ts::runZaiOAuthLogin (function)


## Steps


1. Use `buildZaiAuthorizeUrl` from `src/zai-oauth.ts`.

2. Use `classifyZaiOAuthInvocation` from `src/zai-oauth.ts`.

3. Use `parseZaiOAuthCallback` from `src/zai-oauth.ts`.

4. Use `runZaiOAuthLogin` from `src/zai-oauth.ts`.

5. Use `OfficialLoginPayload` from `src/zai-oauth.ts`.

6. Use `ZaiOAuthCallback` from `src/zai-oauth.ts`.

7. Use `ZaiOAuthInvocation` from `src/zai-oauth.ts`.

8. Use `ZaiOAuthLoginOptions` from `src/zai-oauth.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/zai-oauth.ts :: buildZaiAuthorizeUrl
export function buildZaiAuthorizeUrl(state: string): string
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

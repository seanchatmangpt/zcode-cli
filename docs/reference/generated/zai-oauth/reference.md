# zcode-cli reference

<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-BEGIN: reference body is RIGID                -->
<!-- Every row below is rendered from queries/ast_extract.rq.      -->
<!-- Agents MUST NOT add, edit, reorder, or remove any row or      -->
<!-- table cell. Prose outside the fenced slot below is refused    -->
<!-- by the doc_quality court.                                     -->
<!-- ============================================================= -->

## Modules


### src/zai-oauth.ts

| `buildZaiAuthorizeUrl` | function | export function buildZaiAuthorizeUrl(state: string): string |  |  |  |  |

| `classifyZaiOAuthInvocation` | function | export function classifyZaiOAuthInvocation(args: string[]): ZaiOAuthInvocation | null |  |  |  |  |

| `parseZaiOAuthCallback` | function | export function parseZaiOAuthCallback(callbackUrl: string, expectedState: string): ZaiOAuthCallback |  |  |  |  |

| `runZaiOAuthLogin` | function | export async function runZaiOAuthLogin(options: ZaiOAuthLoginOptions): Promise<number> |  |  |  |  |

| `OfficialLoginPayload` | interface | export interface OfficialLoginPayload |  |  |  |  |

| `ZaiOAuthCallback` | interface | export interface ZaiOAuthCallback |  |  |  |  |

| `ZaiOAuthInvocation` | interface | export interface ZaiOAuthInvocation |  |  |  |  |

| `ZaiOAuthLoginOptions` | interface | export interface ZaiOAuthLoginOptions |  |  |  |  |



<!-- AGENT-FORBIDDEN-END -->

## Signature/type/default/errors table

<!-- RIGID table: header order is fixed; rows come only from the query. -->

| Item | Type | Signature | Params | Defaults | Errors | Invariants |
|------|------|-----------|--------|----------|--------|------------|

| `buildZaiAuthorizeUrl` | function | export function buildZaiAuthorizeUrl(state: string): string |  |  |  |  |

| `classifyZaiOAuthInvocation` | function | export function classifyZaiOAuthInvocation(args: string[]): ZaiOAuthInvocation | null |  |  |  |  |

| `parseZaiOAuthCallback` | function | export function parseZaiOAuthCallback(callbackUrl: string, expectedState: string): ZaiOAuthCallback |  |  |  |  |

| `runZaiOAuthLogin` | function | export async function runZaiOAuthLogin(options: ZaiOAuthLoginOptions): Promise<number> |  |  |  |  |

| `OfficialLoginPayload` | interface | export interface OfficialLoginPayload |  |  |  |  |

| `ZaiOAuthCallback` | interface | export interface ZaiOAuthCallback |  |  |  |  |

| `ZaiOAuthInvocation` | interface | export interface ZaiOAuthInvocation |  |  |  |  |

| `ZaiOAuthLoginOptions` | interface | export interface ZaiOAuthLoginOptions |  |  |  |  |


<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-END: nothing below this line may describe     -->
<!-- code behavior.                                                -->
<!-- ============================================================= -->

# zcode-cli reference

<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-BEGIN: reference body is RIGID                -->
<!-- Every row below is rendered from queries/ast_extract.rq.      -->
<!-- Agents MUST NOT add, edit, reorder, or remove any row or      -->
<!-- table cell. Prose outside the fenced slot below is refused    -->
<!-- by the doc_quality court.                                     -->
<!-- ============================================================= -->

## Modules


### src/darwin-oauth-callback.ts

| `callbackAppleScript` | function | export function callbackAppleScript( callbackPath: string, scheme: string, previousHandler: string ): string[] |  |  |  |  |

| `createDarwinUrlCallbackReceiver` | function | export async function createDarwinUrlCallbackReceiver( options: DarwinUrlCallbackOptions ): Promise<DarwinUrlCallbackReceiver> |  |  |  |  |

| `recoverStaleDarwinOAuthHandler` | function | export async function recoverStaleDarwinOAuthHandler( options: DarwinUrlCallbackOptions ): Promise<void> |  |  |  |  |

| `DarwinUrlCallbackOptions` | interface | export interface DarwinUrlCallbackOptions |  |  |  |  |

| `DarwinUrlCallbackReceiver` | interface | export interface DarwinUrlCallbackReceiver |  |  |  |  |

| `CommandRunner` | type | export type CommandRunner |  |  |  |  |



<!-- AGENT-FORBIDDEN-END -->

## Signature/type/default/errors table

<!-- RIGID table: header order is fixed; rows come only from the query. -->

| Item | Type | Signature | Params | Defaults | Errors | Invariants |
|------|------|-----------|--------|----------|--------|------------|

| `callbackAppleScript` | function | export function callbackAppleScript( callbackPath: string, scheme: string, previousHandler: string ): string[] |  |  |  |  |

| `createDarwinUrlCallbackReceiver` | function | export async function createDarwinUrlCallbackReceiver( options: DarwinUrlCallbackOptions ): Promise<DarwinUrlCallbackReceiver> |  |  |  |  |

| `recoverStaleDarwinOAuthHandler` | function | export async function recoverStaleDarwinOAuthHandler( options: DarwinUrlCallbackOptions ): Promise<void> |  |  |  |  |

| `DarwinUrlCallbackOptions` | interface | export interface DarwinUrlCallbackOptions |  |  |  |  |

| `DarwinUrlCallbackReceiver` | interface | export interface DarwinUrlCallbackReceiver |  |  |  |  |

| `CommandRunner` | type | export type CommandRunner |  |  |  |  |


<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-END: nothing below this line may describe     -->
<!-- code behavior.                                                -->
<!-- ============================================================= -->

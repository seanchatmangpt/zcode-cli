# zcode-cli reference

<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-BEGIN: reference body is RIGID                -->
<!-- Every row below is rendered from queries/ast_extract.rq.      -->
<!-- Agents MUST NOT add, edit, reorder, or remove any row or      -->
<!-- table cell. Prose outside the fenced slot below is refused    -->
<!-- by the doc_quality court.                                     -->
<!-- ============================================================= -->

## Modules


### src/provider-backoff.ts

| `ConcurrencyCap` | class | export class ConcurrencyCap |  |  |  |  |

| `ProviderCapacityRefusal` | class | export class ProviderCapacityRefusal extends Error |  |  |  |  |

| `defaultBackoffPolicy` | const | export const defaultBackoffPolicy: BackoffPolicy |  |  |  |  |

| `defaultFabricConcurrencyLimit` | const | export const defaultFabricConcurrencyLimit |  |  |  |  |

| `callWithCapacityBackoff` | function | export async function callWithCapacityBackoff<T>( op: (attempt: number) |  |  |  |  |

| `capacityFromBody` | function | export function capacityFromBody(body: unknown): CapacitySignal | false |  |  |  |  |

| `capacityFromStatus` | function | export function capacityFromStatus(status: number): CapacitySignal | false |  |  |  |  |

| `delayForAttempt` | function | export function delayForAttempt( policy: BackoffPolicy, attempt: number, random: () |  |  |  |  |

| `isProviderCapacityRefusal` | function | export function isProviderCapacityRefusal(value: unknown): value is ProviderCapacityRefusal |  |  |  |  |

| `BackoffPolicy` | interface | export interface BackoffPolicy |  |  |  |  |

| `CallWithCapacityBackoffOptions` | interface | export interface CallWithCapacityBackoffOptions<T> |  |  |  |  |

| `CapacitySignal` | interface | export interface CapacitySignal |  |  |  |  |

| `CapacityCode` | type | export type CapacityCode |  |  |  |  |



<!-- AGENT-FORBIDDEN-END -->

## Signature/type/default/errors table

<!-- RIGID table: header order is fixed; rows come only from the query. -->

| Item | Type | Signature | Params | Defaults | Errors | Invariants |
|------|------|-----------|--------|----------|--------|------------|

| `ConcurrencyCap` | class | export class ConcurrencyCap |  |  |  |  |

| `ProviderCapacityRefusal` | class | export class ProviderCapacityRefusal extends Error |  |  |  |  |

| `defaultBackoffPolicy` | const | export const defaultBackoffPolicy: BackoffPolicy |  |  |  |  |

| `defaultFabricConcurrencyLimit` | const | export const defaultFabricConcurrencyLimit |  |  |  |  |

| `callWithCapacityBackoff` | function | export async function callWithCapacityBackoff<T>( op: (attempt: number) |  |  |  |  |

| `capacityFromBody` | function | export function capacityFromBody(body: unknown): CapacitySignal | false |  |  |  |  |

| `capacityFromStatus` | function | export function capacityFromStatus(status: number): CapacitySignal | false |  |  |  |  |

| `delayForAttempt` | function | export function delayForAttempt( policy: BackoffPolicy, attempt: number, random: () |  |  |  |  |

| `isProviderCapacityRefusal` | function | export function isProviderCapacityRefusal(value: unknown): value is ProviderCapacityRefusal |  |  |  |  |

| `BackoffPolicy` | interface | export interface BackoffPolicy |  |  |  |  |

| `CallWithCapacityBackoffOptions` | interface | export interface CallWithCapacityBackoffOptions<T> |  |  |  |  |

| `CapacitySignal` | interface | export interface CapacitySignal |  |  |  |  |

| `CapacityCode` | type | export type CapacityCode |  |  |  |  |


<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-END: nothing below this line may describe     -->
<!-- code behavior.                                                -->
<!-- ============================================================= -->

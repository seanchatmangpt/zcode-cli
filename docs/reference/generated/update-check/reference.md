# zcode-cli reference

<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-BEGIN: reference body is RIGID                -->
<!-- Every row below is rendered from queries/ast_extract.rq.      -->
<!-- Agents MUST NOT add, edit, reorder, or remove any row or      -->
<!-- table cell. Prose outside the fenced slot below is refused    -->
<!-- by the doc_quality court.                                     -->
<!-- ============================================================= -->

## Modules


### src/update-check.ts

| `UPDATE_CACHE_TTL_MS` | const | export const UPDATE_CACHE_TTL_MS |  |  |  |  |

| `UPDATE_CHECK_URL` | const | export const UPDATE_CHECK_URL |  |  |  |  |

| `availableUpdateVersion` | function | export function availableUpdateVersion( currentVersion: string, latestVersion: string ): string | undefined |  |  |  |  |

| `readStartupUpdate` | function | export async function readStartupUpdate( options: ReadStartupUpdateOptions ): Promise<StartupUpdateCheck | undefined> |  |  |  |  |

| `refreshUpdateCache` | function | export async function refreshUpdateCache(options: RefreshUpdateCacheOptions): Promise<string> |  |  |  |  |

| `updateCachePath` | function | export function updateCachePath( env: NodeJS.ProcessEnv |  |  |  |  |

| `updateCheckDisabled` | function | export function updateCheckDisabled(env: NodeJS.ProcessEnv |  |  |  |  |

| `ReadStartupUpdateOptions` | interface | export interface ReadStartupUpdateOptions |  |  |  |  |

| `RefreshUpdateCacheOptions` | interface | export interface RefreshUpdateCacheOptions |  |  |  |  |

| `StartupUpdateCheck` | interface | export interface StartupUpdateCheck |  |  |  |  |

| `UpdateFetcher` | type | export type UpdateFetcher |  |  |  |  |



<!-- AGENT-FORBIDDEN-END -->

## Signature/type/default/errors table

<!-- RIGID table: header order is fixed; rows come only from the query. -->

| Item | Type | Signature | Params | Defaults | Errors | Invariants |
|------|------|-----------|--------|----------|--------|------------|

| `UPDATE_CACHE_TTL_MS` | const | export const UPDATE_CACHE_TTL_MS |  |  |  |  |

| `UPDATE_CHECK_URL` | const | export const UPDATE_CHECK_URL |  |  |  |  |

| `availableUpdateVersion` | function | export function availableUpdateVersion( currentVersion: string, latestVersion: string ): string | undefined |  |  |  |  |

| `readStartupUpdate` | function | export async function readStartupUpdate( options: ReadStartupUpdateOptions ): Promise<StartupUpdateCheck | undefined> |  |  |  |  |

| `refreshUpdateCache` | function | export async function refreshUpdateCache(options: RefreshUpdateCacheOptions): Promise<string> |  |  |  |  |

| `updateCachePath` | function | export function updateCachePath( env: NodeJS.ProcessEnv |  |  |  |  |

| `updateCheckDisabled` | function | export function updateCheckDisabled(env: NodeJS.ProcessEnv |  |  |  |  |

| `ReadStartupUpdateOptions` | interface | export interface ReadStartupUpdateOptions |  |  |  |  |

| `RefreshUpdateCacheOptions` | interface | export interface RefreshUpdateCacheOptions |  |  |  |  |

| `StartupUpdateCheck` | interface | export interface StartupUpdateCheck |  |  |  |  |

| `UpdateFetcher` | type | export type UpdateFetcher |  |  |  |  |


<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-END: nothing below this line may describe     -->
<!-- code behavior.                                                -->
<!-- ============================================================= -->

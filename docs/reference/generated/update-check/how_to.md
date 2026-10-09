# How to: Using zcode-cli

## Prerequisites


- src/update-check.ts::ReadStartupUpdateOptions (interface)

- src/update-check.ts::RefreshUpdateCacheOptions (interface)

- src/update-check.ts::StartupUpdateCheck (interface)

- src/update-check.ts::UPDATE_CACHE_TTL_MS (const)

- src/update-check.ts::UPDATE_CHECK_URL (const)

- src/update-check.ts::UpdateFetcher (type)

- src/update-check.ts::availableUpdateVersion (function)

- src/update-check.ts::readStartupUpdate (function)

- src/update-check.ts::refreshUpdateCache (function)

- src/update-check.ts::updateCachePath (function)

- src/update-check.ts::updateCheckDisabled (function)


## Steps


1. Use `UPDATE_CACHE_TTL_MS` from `src/update-check.ts`.

2. Use `UPDATE_CHECK_URL` from `src/update-check.ts`.

3. Use `availableUpdateVersion` from `src/update-check.ts`.

4. Use `readStartupUpdate` from `src/update-check.ts`.

5. Use `refreshUpdateCache` from `src/update-check.ts`.

6. Use `updateCachePath` from `src/update-check.ts`.

7. Use `updateCheckDisabled` from `src/update-check.ts`.

8. Use `ReadStartupUpdateOptions` from `src/update-check.ts`.

9. Use `RefreshUpdateCacheOptions` from `src/update-check.ts`.

10. Use `StartupUpdateCheck` from `src/update-check.ts`.

11. Use `UpdateFetcher` from `src/update-check.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/update-check.ts :: availableUpdateVersion
export function availableUpdateVersion( currentVersion: string, latestVersion: string ): string | undefined
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

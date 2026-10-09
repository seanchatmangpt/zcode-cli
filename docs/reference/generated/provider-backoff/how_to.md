# How to: Using zcode-cli

## Prerequisites


- src/provider-backoff.ts::BackoffPolicy (interface)

- src/provider-backoff.ts::CallWithCapacityBackoffOptions (interface)

- src/provider-backoff.ts::CapacityCode (type)

- src/provider-backoff.ts::CapacitySignal (interface)

- src/provider-backoff.ts::ConcurrencyCap (class)

- src/provider-backoff.ts::ProviderCapacityRefusal (class)

- src/provider-backoff.ts::callWithCapacityBackoff (function)

- src/provider-backoff.ts::capacityFromBody (function)

- src/provider-backoff.ts::capacityFromStatus (function)

- src/provider-backoff.ts::defaultBackoffPolicy (const)

- src/provider-backoff.ts::defaultFabricConcurrencyLimit (const)

- src/provider-backoff.ts::delayForAttempt (function)

- src/provider-backoff.ts::isProviderCapacityRefusal (function)


## Steps


1. Use `ConcurrencyCap` from `src/provider-backoff.ts`.

2. Use `ProviderCapacityRefusal` from `src/provider-backoff.ts`.

3. Use `defaultBackoffPolicy` from `src/provider-backoff.ts`.

4. Use `defaultFabricConcurrencyLimit` from `src/provider-backoff.ts`.

5. Use `callWithCapacityBackoff` from `src/provider-backoff.ts`.

6. Use `capacityFromBody` from `src/provider-backoff.ts`.

7. Use `capacityFromStatus` from `src/provider-backoff.ts`.

8. Use `delayForAttempt` from `src/provider-backoff.ts`.

9. Use `isProviderCapacityRefusal` from `src/provider-backoff.ts`.

10. Use `BackoffPolicy` from `src/provider-backoff.ts`.

11. Use `CallWithCapacityBackoffOptions` from `src/provider-backoff.ts`.

12. Use `CapacitySignal` from `src/provider-backoff.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/provider-backoff.ts :: callWithCapacityBackoff
export async function callWithCapacityBackoff<T>( op: (attempt: number)
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

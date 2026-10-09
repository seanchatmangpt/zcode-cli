# How to: Using zcode-cli

## Prerequisites


- src/relay-admission.ts::ADMISSION_ORDER (const)

- src/relay-admission.ts::AckResult (type)

- src/relay-admission.ts::AckedCommand (interface)

- src/relay-admission.ts::AdmissionResult (type)

- src/relay-admission.ts::AdmissionStage (type)

- src/relay-admission.ts::KNOWN_REPLAY (const)

- src/relay-admission.ts::PendingCommand (interface)

- src/relay-admission.ts::RELAY_ACTUATE_VERB (const)

- src/relay-admission.ts::RELAY_ALLOW_DO_ENV (const)

- src/relay-admission.ts::RELAY_CHANNELS (const)

- src/relay-admission.ts::RELAY_CONTRACT (const)

- src/relay-admission.ts::RELAY_CONTRACT_VERSION (const)

- src/relay-admission.ts::RELAY_ENVELOPE_REQUIRED (const)

- src/relay-admission.ts::RELAY_ENVELOPE_SCHEMA (const)

- src/relay-admission.ts::RELAY_OCEL_IDENTITY_ENV (const)

- src/relay-admission.ts::RELAY_REFUSALS (const)

- src/relay-admission.ts::RELAY_STATE_SCHEMA (const)

- src/relay-admission.ts::RELAY_STATE_SCHEMA_V1 (const)

- src/relay-admission.ts::RelayAckState (interface)

- src/relay-admission.ts::RelayChannel (type)

- src/relay-admission.ts::RelayDispatchResult (type)

- src/relay-admission.ts::RelayEnvelope (interface)

- src/relay-admission.ts::RelayLeaseDescriptor (interface)

- src/relay-admission.ts::RelayLockError (class)

- src/relay-admission.ts::RelayRefusal (type)

- src/relay-admission.ts::RelayStateError (class)

- src/relay-admission.ts::RelayWorker (class)

- src/relay-admission.ts::RelayWorkerOptions (interface)

- src/relay-admission.ts::checkAuthorityShape (function)

- src/relay-admission.ts::checkEnvelopeShape (function)

- src/relay-admission.ts::checkExecutionManifest (function)

- src/relay-admission.ts::checkExpiry (function)

- src/relay-admission.ts::checkGallWorkBinding (function)

- src/relay-admission.ts::commandIdDigest (function)

- src/relay-admission.ts::defaultRelayStateDir (const)

- src/relay-admission.ts::dispatchRelayCommand (function)

- src/relay-admission.ts::localAllowDoFromEnv (function)

- src/relay-admission.ts::relayIdentityEnv (function)

- src/relay-admission.ts::relayStatePath (function)


## Steps


1. Use `RelayLockError` from `src/relay-admission.ts`.

2. Use `RelayStateError` from `src/relay-admission.ts`.

3. Use `RelayWorker` from `src/relay-admission.ts`.

4. Use `ADMISSION_ORDER` from `src/relay-admission.ts`.

5. Use `KNOWN_REPLAY` from `src/relay-admission.ts`.

6. Use `RELAY_ACTUATE_VERB` from `src/relay-admission.ts`.

7. Use `RELAY_ALLOW_DO_ENV` from `src/relay-admission.ts`.

8. Use `RELAY_CHANNELS` from `src/relay-admission.ts`.

9. Use `RELAY_CONTRACT` from `src/relay-admission.ts`.

10. Use `RELAY_CONTRACT_VERSION` from `src/relay-admission.ts`.

11. Use `RELAY_ENVELOPE_REQUIRED` from `src/relay-admission.ts`.

12. Use `RELAY_ENVELOPE_SCHEMA` from `src/relay-admission.ts`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// src/relay-admission.ts :: checkAuthorityShape
export function checkAuthorityShape(envelope: RelayEnvelope, allowDo: boolean): StageRefusal
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The ONLY region an agent may write into. Bounds: <= 12 lines,    -->
<!-- <= 100 chars/line, no new code facts (any new symbol mentioned   -->
<!-- must exist in queries/ast_extract.rq output; the doc_quality     -->
<!-- court fails Phi_halluc > 0.001 otherwise). No tables, no         -->
<!-- signatures, no parameters, no error lists — AGENT-FORBIDDEN      -->
<!-- everywhere.                                                      -->
<!-- AGENT-COMMENTARY-END -->

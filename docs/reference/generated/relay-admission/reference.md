# zcode-cli reference

<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-BEGIN: reference body is RIGID                -->
<!-- Every row below is rendered from queries/ast_extract.rq.      -->
<!-- Agents MUST NOT add, edit, reorder, or remove any row or      -->
<!-- table cell. Prose outside the fenced slot below is refused    -->
<!-- by the doc_quality court.                                     -->
<!-- ============================================================= -->

## Modules


### src/relay-admission.ts

| `RelayLockError` | class | export class RelayLockError extends Error |  |  |  |  |

| `RelayStateError` | class | export class RelayStateError extends Error |  |  |  |  |

| `RelayWorker` | class | export class RelayWorker |  |  |  |  |

| `ADMISSION_ORDER` | const | export const ADMISSION_ORDER |  |  |  |  |

| `KNOWN_REPLAY` | const | export const KNOWN_REPLAY |  |  |  |  |

| `RELAY_ACTUATE_VERB` | const | export const RELAY_ACTUATE_VERB |  |  |  |  |

| `RELAY_ALLOW_DO_ENV` | const | export const RELAY_ALLOW_DO_ENV |  |  |  |  |

| `RELAY_CHANNELS` | const | export const RELAY_CHANNELS |  |  |  |  |

| `RELAY_CONTRACT` | const | export const RELAY_CONTRACT |  |  |  |  |

| `RELAY_CONTRACT_VERSION` | const | export const RELAY_CONTRACT_VERSION |  |  |  |  |

| `RELAY_ENVELOPE_REQUIRED` | const | export const RELAY_ENVELOPE_REQUIRED |  |  |  |  |

| `RELAY_ENVELOPE_SCHEMA` | const | export const RELAY_ENVELOPE_SCHEMA |  |  |  |  |

| `RELAY_OCEL_IDENTITY_ENV` | const | export const RELAY_OCEL_IDENTITY_ENV |  |  |  |  |

| `RELAY_REFUSALS` | const | export const RELAY_REFUSALS |  |  |  |  |

| `RELAY_STATE_SCHEMA` | const | export const RELAY_STATE_SCHEMA |  |  |  |  |

| `RELAY_STATE_SCHEMA_V1` | const | export const RELAY_STATE_SCHEMA_V1 |  |  |  |  |

| `defaultRelayStateDir` | const | export const defaultRelayStateDir |  |  |  |  |

| `checkAuthorityShape` | function | export function checkAuthorityShape(envelope: RelayEnvelope, allowDo: boolean): StageRefusal |  |  |  |  |

| `checkEnvelopeShape` | function | export function checkEnvelopeShape(value: unknown): |  |  |  |  |

| `checkExecutionManifest` | function | export function checkExecutionManifest(envelope: RelayEnvelope, sessionManifest: string): StageRefusal |  |  |  |  |

| `checkExpiry` | function | export function checkExpiry(envelope: RelayEnvelope, nowMs: number): StageRefusal |  |  |  |  |

| `checkGallWorkBinding` | function | export function checkGallWorkBinding(envelope: RelayEnvelope, descriptor: unknown): StageRefusal |  |  |  |  |

| `commandIdDigest` | function | export function commandIdDigest(commandId: string): string |  |  |  |  |

| `dispatchRelayCommand` | function | export async function dispatchRelayCommand( worker: RelayWorker, raw: unknown, execute: (envelope: RelayEnvelope) |  |  |  |  |

| `localAllowDoFromEnv` | function | export function localAllowDoFromEnv(env: NodeJS.ProcessEnv |  |  |  |  |

| `relayIdentityEnv` | function | export function relayIdentityEnv(descriptor: RelayLeaseDescriptor): Record<(typeof RELAY_OCEL_IDENTITY_ENV)[number], string> |  |  |  |  |

| `relayStatePath` | function | export function relayStatePath(stateDir: string, worktree: string, epochId: string): string |  |  |  |  |

| `AckedCommand` | interface | export interface AckedCommand |  |  |  |  |

| `PendingCommand` | interface | export interface PendingCommand |  |  |  |  |

| `RelayAckState` | interface | export interface RelayAckState |  |  |  |  |

| `RelayEnvelope` | interface | export interface RelayEnvelope |  |  |  |  |

| `RelayLeaseDescriptor` | interface | export interface RelayLeaseDescriptor |  |  |  |  |

| `RelayWorkerOptions` | interface | export interface RelayWorkerOptions |  |  |  |  |

| `AckResult` | type | export type AckResult |  |  |  |  |

| `AdmissionResult` | type | export type AdmissionResult |  |  |  |  |

| `AdmissionStage` | type | export type AdmissionStage |  |  |  |  |

| `RelayChannel` | type | export type RelayChannel |  |  |  |  |

| `RelayDispatchResult` | type | export type RelayDispatchResult |  |  |  |  |

| `RelayRefusal` | type | export type RelayRefusal |  |  |  |  |



<!-- AGENT-FORBIDDEN-END -->

## Signature/type/default/errors table

<!-- RIGID table: header order is fixed; rows come only from the query. -->

| Item | Type | Signature | Params | Defaults | Errors | Invariants |
|------|------|-----------|--------|----------|--------|------------|

| `RelayLockError` | class | export class RelayLockError extends Error |  |  |  |  |

| `RelayStateError` | class | export class RelayStateError extends Error |  |  |  |  |

| `RelayWorker` | class | export class RelayWorker |  |  |  |  |

| `ADMISSION_ORDER` | const | export const ADMISSION_ORDER |  |  |  |  |

| `KNOWN_REPLAY` | const | export const KNOWN_REPLAY |  |  |  |  |

| `RELAY_ACTUATE_VERB` | const | export const RELAY_ACTUATE_VERB |  |  |  |  |

| `RELAY_ALLOW_DO_ENV` | const | export const RELAY_ALLOW_DO_ENV |  |  |  |  |

| `RELAY_CHANNELS` | const | export const RELAY_CHANNELS |  |  |  |  |

| `RELAY_CONTRACT` | const | export const RELAY_CONTRACT |  |  |  |  |

| `RELAY_CONTRACT_VERSION` | const | export const RELAY_CONTRACT_VERSION |  |  |  |  |

| `RELAY_ENVELOPE_REQUIRED` | const | export const RELAY_ENVELOPE_REQUIRED |  |  |  |  |

| `RELAY_ENVELOPE_SCHEMA` | const | export const RELAY_ENVELOPE_SCHEMA |  |  |  |  |

| `RELAY_OCEL_IDENTITY_ENV` | const | export const RELAY_OCEL_IDENTITY_ENV |  |  |  |  |

| `RELAY_REFUSALS` | const | export const RELAY_REFUSALS |  |  |  |  |

| `RELAY_STATE_SCHEMA` | const | export const RELAY_STATE_SCHEMA |  |  |  |  |

| `RELAY_STATE_SCHEMA_V1` | const | export const RELAY_STATE_SCHEMA_V1 |  |  |  |  |

| `defaultRelayStateDir` | const | export const defaultRelayStateDir |  |  |  |  |

| `checkAuthorityShape` | function | export function checkAuthorityShape(envelope: RelayEnvelope, allowDo: boolean): StageRefusal |  |  |  |  |

| `checkEnvelopeShape` | function | export function checkEnvelopeShape(value: unknown): |  |  |  |  |

| `checkExecutionManifest` | function | export function checkExecutionManifest(envelope: RelayEnvelope, sessionManifest: string): StageRefusal |  |  |  |  |

| `checkExpiry` | function | export function checkExpiry(envelope: RelayEnvelope, nowMs: number): StageRefusal |  |  |  |  |

| `checkGallWorkBinding` | function | export function checkGallWorkBinding(envelope: RelayEnvelope, descriptor: unknown): StageRefusal |  |  |  |  |

| `commandIdDigest` | function | export function commandIdDigest(commandId: string): string |  |  |  |  |

| `dispatchRelayCommand` | function | export async function dispatchRelayCommand( worker: RelayWorker, raw: unknown, execute: (envelope: RelayEnvelope) |  |  |  |  |

| `localAllowDoFromEnv` | function | export function localAllowDoFromEnv(env: NodeJS.ProcessEnv |  |  |  |  |

| `relayIdentityEnv` | function | export function relayIdentityEnv(descriptor: RelayLeaseDescriptor): Record<(typeof RELAY_OCEL_IDENTITY_ENV)[number], string> |  |  |  |  |

| `relayStatePath` | function | export function relayStatePath(stateDir: string, worktree: string, epochId: string): string |  |  |  |  |

| `AckedCommand` | interface | export interface AckedCommand |  |  |  |  |

| `PendingCommand` | interface | export interface PendingCommand |  |  |  |  |

| `RelayAckState` | interface | export interface RelayAckState |  |  |  |  |

| `RelayEnvelope` | interface | export interface RelayEnvelope |  |  |  |  |

| `RelayLeaseDescriptor` | interface | export interface RelayLeaseDescriptor |  |  |  |  |

| `RelayWorkerOptions` | interface | export interface RelayWorkerOptions |  |  |  |  |

| `AckResult` | type | export type AckResult |  |  |  |  |

| `AdmissionResult` | type | export type AdmissionResult |  |  |  |  |

| `AdmissionStage` | type | export type AdmissionStage |  |  |  |  |

| `RelayChannel` | type | export type RelayChannel |  |  |  |  |

| `RelayDispatchResult` | type | export type RelayDispatchResult |  |  |  |  |

| `RelayRefusal` | type | export type RelayRefusal |  |  |  |  |


<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-END: nothing below this line may describe     -->
<!-- code behavior.                                                -->
<!-- ============================================================= -->

# ZCODE-CLI-SPEC-26.11.20 — Unified Architecture Requirements Document (ARD) & Product Requirements Document (PRD)

| Field | Value |
|---|---|
| **Document ID** | `ZCODE-CLI-SPEC-26.11.20` |
| **Product Name** | `zcode-cli` — Object-Centric Process-Mined Coding Agent Runtime |
| **Release Mode** | Experimentation-Through-Implementation (`v26.11.20-explore` → `v26.11.20-exploit`) |
| **Runtime Stack** | TypeScript (strict), Bun (package manager, test runner, script runtime), Node.js (`>= 22.19.0`) CLI launcher with inherited stdio (zero nested PTY), `@zcode/tui` terminal UI package |
| **Target Agent Interface** | Coding-agent runtime behind a clean provider adapter interface, with drop-in Claude Code headless CLI parity |
| **Formal Foundations** | Partially Ordered Workflow Language (POWL v2 — Kourani & van der Aalst), Sound Workflow Nets (Petri Nets), IEEE OCEL 2.0 (Object-Centric Event Logs — Berti, Koren, van der Aalst et al.), AIMD Congestion Control, Kingman's Queueing Approximation |
| **Clean-Room Mandate** | 100% standalone; zero coupling to external proprietary ecosystems, monorepos, or domain-specific workspaces |
| **Status** | Normative specification for immediate Explore-phase implementation and subsequent Exploit-phase hardening |
| **Supersedes** | Informal README architecture claims that conflate token-replay completion heuristics with behavioral conformance, and that drive AIMD from raw turn duration rather than transport health |

---

## 0. Epistemic Stance, Methodology & Tagging Convention

### 0.1 Experimentation Through Implementation (Explore → Exploit)

`zcode-cli` v26.11.20 is a two-phase engineering program:

1. **Phase 1 — Explore (`v26.11.20-explore`):** Build a clean, runnable, end-to-end working runtime first. Gather real empirical telemetry from live LLM coding-agent runs: service-time distributions, transport timeout modes, API rate-limit ceilings, dirty-write failure rates, and emergent agent rework loops. Do not over-engineer theoretical machinery before live data proves where bottlenecks live—**but** enforce strict instrumentation hygiene so early experiments never produce corrupted or misleading measurements.
2. **Phase 2 — Exploit (`v26.11.20-exploit`):** Once Explore runs establish empirical baselines and expose real failure modes, upgrade heuristic components into mathematically closed, production-grade formalisms: optimal trace alignments, transactional workspace rollback, typed object-centric resource locking, and automated process discovery over captured OCEL 2.0 logs.

### 0.2 Mandatory Tags

Every architectural subsystem in this document is tagged:

| Tag | Meaning |
|---|---|
| `[EXPLORE-SCOPE]` | Ships immediately to run live experiments |
| `[EXPLOIT-UPGRADE]` | Hardens for production after empirical validation |
| `[PROMOTION-GATE]` | Quantitative signal required to advance Explore → Exploit for that subsystem |

### 0.3 Honest Formalism Rules

1. **Execution semantics ≠ conformance checking.** Enforced Petri-net firing (`∀p ∈ •t : M(p) ≥ 1`) makes missing tokens structurally zero on the orchestrator's own schedule. Token-based replay fitness on that schedule is a *completion heuristic*, never behavioral conformance.
2. **Steady-state identities ≠ feedback control laws.** Little's Law \(L = \lambda W\) is an identity relating averages in steady state. AIMD is a discrete feedback law that *seeks* a usable operating point; it does not "enforce" Little's Law.
3. **Case-centric orchestration ≠ object-centric process mining.** The Explore executor runs one WF-net case per workflow cycle. OCEL 2.0 records multi-object relationships for *post-hoc* mining. Object-Centric Petri Nets (OCPNs) are an Exploit upgrade, not a prerequisite for Explore telemetry.
4. **Transport congestion ≠ heavy-tailed task duration.** AIMD multiplicative decrease must be driven by transport/API health (connect timeout, `429`, TTFT spike), never by raw total turn duration.

### 0.4 Clean-Room Boundary

- All configuration lives in-repo (`zcode-cli.toml`, `provider.example.json`, `setting.example.json`).
- All schemas, validators, and workflows are self-contained and domain-agnostic.
- Optional external OCEL validators are invoked only via a configurable command hook (`ocel.validator_cmd`); absence of the hook must not block Explore.
- Optional file-based work-order I/O adapters live under `src/io/` (Appendix D); they must not leak into core orchestrator imports. Absence of adapter env keys must not block Explore.
- No hardcoded paths to third-party workspaces. Workspace roots are operator-configured.

---

# SECTION 1 — PRODUCT THESIS, FAILURE PHYSICS & EXPLORE/EXPLOIT STRATEGY (PRD)

## 1.1 Why Ad-Hoc Agent Concurrency Fails (First Principles)

### 1.1.1 Unsound Orchestration (Deadlocks & Cascade Failures)

Flat prompt queues and ad-hoc shell scripts fail structural soundness:

- They fire downstream tasks before upstream contracts (files, types, test fixtures) exist.
- They keep burning tokens after a foundational artifact fails.
- They have no option-to-complete guarantee: a stuck dependency can leave the queue neither terminating nor progressing.

Formally, a multi-step coding workflow must be expressible as a **sound workflow net** \(N = (P, T, F, i, o)\) such that from the initial marking \([i]\):

1. **Option to complete:** \(\forall M \in [N, [i]\rangle\), \(\exists \sigma : M \xrightarrow{\sigma} [o]\).
2. **Proper completion:** \(\forall M \in [N, [i]\rangle\) with \(M \ge [o]\), \(M = [o]\).
3. **No dead transitions:** \(\forall t \in T\), \(\exists M \in [N, [i]\rangle\) such that \(t\) is enabled in \(M\).

POWL v2 provides soundness *by construction* when compiled under the inductive rules of §3.2.

### 1.1.2 Static Concurrency Collapse (`--concurrency N`)

Hardcoding \(N\) parallel workers produces a bang-bang regime:

- Small \(N\) under-utilizes the provider API (low \(\lambda\)).
- Large \(N\) saturates the endpoint with simultaneous TLS/HTTP handshakes, eliciting `UND_ERR_CONNECT_TIMEOUT` and `429 Too Many Requests`, collapsing effective throughput \(\lambda\) toward zero.

Therefore **no workflow config may contain a static concurrency target**. Concurrency is discovered online by `AimdWipController` (§5).

### 1.1.3 Queueing Physics Under Heavy-Tailed LLM Work (Kingman's Approximation)

Coding-agent turn durations exhibit extreme variance (\(c_s^2 \gg 1\)), ranging from ~5-second readonly checks to multi-minute multi-file refactors. Under Kingman's G/G/1 approximation, mean waiting time scales as:

\[
W_q \approx \left(\frac{\rho}{1 - \rho}\right)\left(\frac{c_a^2 + c_s^2}{2}\right)\bar{s}
\]

where:

| Symbol | Definition |
|---|---|
| \(\rho\) | Utilization \(\lambda \bar{s}\) (arrival rate × mean service time) |
| \(c_a^2\) | Squared coefficient of variation of inter-arrival times |
| \(c_s^2\) | Squared coefficient of variation of service times |
| \(\bar{s}\) | Mean service time |

Pushing naive utilization \(\rho \to 1\) drives \(W_q \to \infty\) and timeout rework to infinity. The product objective is therefore:

\[
\max \; \lambda_{\text{alive}} \quad\text{subject to}\quad \text{transport health},\; \text{workspace soundness},\; \text{budget bounds}
\]

where \(\lambda_{\text{alive}}\) is the rate of transitions completing with standing `ALIVE` (not raw HTTP request rate).

### 1.1.4 Zero Process Telemetry

Without an Object-Centric Event Log (IEEE OCEL 2.0) linking events to workflows, transitions, and modified files (`E2O` and `O2O`), an orchestrator cannot:

- measure per-class service times,
- detect rework loops,
- compute behavioral conformance against activity contracts,
- or synthesize targeted follow-up cycles.

## 1.2 Primary Explore-Phase Empirical Hypotheses

| ID | Hypothesis | Primary Metrics | Falsifier |
|---|---|---|---|
| **H1** | Adaptive WIP control driven by *transport* signals outperforms static `--concurrency N` on \(\lambda_{\text{alive}}\) and timeout rate across heterogeneous coding workflows | \(\lambda_{\text{alive}}\), timeout rate, `429` count, makespan \(W\) | AIMD \(\lambda_{\text{alive}}\) ≤ best fixed-\(N\) \(\lambda_{\text{alive}}\) within 95% CI over Exp-2 |
| **H2** | Coding-agent transition durations are heavy-tailed and class-dependent; separating transport latency (connect/TTFT/`429`) from total turn duration prevents false congestion backoff | \(c_s^2\) per `transitionClass`, false-MD rate (MD triggered by long `serviceMs` with healthy TTFT) | False-MD rate under transport-aware AIMD ≥ false-MD rate under service-time AIMD |
| **H3** | Mid-turn transport timeouts leave partial filesystem mutations at a non-zero rate; workspace cleanliness guards / rollback materially improve retry success rate | dirty-timeout rate, retry success after clean vs dirty | dirty-timeout rate \(= 0\) over Exp-3 **or** rollback does not improve retry success |
| **H4** | Captured OCEL 2.0 traces from real coding runs reveal recurring agent rework loops and bottleneck transitions that can be mined to improve workflow structure | rework frequency, OC-DFG edge weights, bottleneck transitions | No recurring pattern with frequency \(\ge 0.2\) across 10 live runs (Exp-4) |

## 1.3 Target Personas & Use Cases

1. **Solo systems engineers / researchers** running unattended multi-step coding workflows with bounded overnight budgets.
2. **CI / automation pipelines** requiring drop-in Claude Code headless CLI parity (`-p`, `--max-turns`, `--permission-mode`, `--disallowedTools`, `--json`) behind a provider adapter.
3. **Process-mining researchers** evaluating formal workflow control over stochastic LLM coding agents using IEEE OCEL 2.0 exports.

## 1.4 Non-Goals (Explore)

- Perfect behavioral conformance scoring during enforced execution (see §4).
- Object-Centric Petri Net (OCPN) runtime execution (Exploit X4).
- Provider-specific proprietary SDK coupling beyond a thin adapter interface.
- Hardcoded workspace paths or domain-specific marketplace plugins as runtime dependencies.

---

# SECTION 2 — SYSTEM ARCHITECTURE & REPOSITORY LAYOUT (ARD)

## 2.1 Closed-Loop Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    POWL v2 Recursive Process Tree AST                       │
│         Activity | Tau | Xor | Loop(do,redo) | PartialOrder(V, ≺)           │
│              validatePowlTree / validateDisjointWriteScopes                 │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ compilePowlToWorkflowNet()
                                  │ [EXPLOIT: expandTransactionalLifecycle]
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Sound Workflow Net (P, T, pre, post, i, o)                  │
│                 + optional transactional lifecycle subnet                   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ executeWorkflowNet (marking M)
                                  ▼
        ┌─────────────────────────┴─────────────────────────┐
        │                                                   │
        ▼                                                   ▼
┌───────────────────────┐                     ┌───────────────────────────────┐
│ AimdWipController     │◄── transport vec ───│ Agent Subprocess Runner       │
│ WIP slow-start = 1    │                     │ bin/zcode.js                  │
│ AI: +1 on healthy     │                     │ + claude-parity normalizer    │
│ MD: WIP/2 on congest. │                     │ + max-turns (ZCODE_MAX_TURNS) │
│ crit-path slack sched │                     │ + lease-manager               │
└───────────┬───────────┘                     └───────────────┬───────────────┘
            │                                                 │
            │                                                 ▼
            │                                 ┌───────────────────────────────┐
            │                                 │ Workspace Guard / Rollback    │
            │                                 │ pre-fire fingerprint          │
            │                                 │ dirty → stash|halt            │
            │                                 └───────────────┬───────────────┘
            │                                                 │
            ▼                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Credential-Redacted OCEL 2.0 Tap (src/ocel-tap.ts)                          │
│ + ocel-emitter (E2O / O2O / dynamic attrs) + ocel-validator                 │
│ + [EXPLORE] completion/standing scorer  [EXPLOIT] A* alignment              │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ deriveFollowUpPowl(R_t) → POWL_{t+1}
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Bounded Autonomic Loop (runAutonomicLoop)                                   │
│ maxCycles / maxTotalTokens / maxWallClockMs / maxRemediationAttempts        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2.2 Module Ownership Table

Target layout under Explore (module split from the current monolith is an Explore deliverable of E2–E4). Dependency rule: **arrows point toward dependencies** (A → B means A imports B). No cycles among `powl-ast`, `wf-net`, `aimd-controller`, `ocel-*`, `conformance`.

| Path | Responsibility | Primary Exports | May Import |
|---|---|---|---|
| `bin/zcode.ts` → `bin/zcode.js` | Node.js `>= 22.19.0` entry; inherited stdio; no second PTY | (bin) | `src/launcher.ts` |
| `src/powl-ast.ts` | POWL v2 AST, strict partial-order validation, serialization | `PowlNode`, `validatePowlTree`, `validateDisjointWriteScopes`, `transitiveClosure` | (none / stdlib) |
| `src/wf-net.ts` | WF-net compiler, soundness verifier, transactional lifecycle builder | `WorkflowNet`, `compilePowlToWorkflowNet`, `verifySoundness`, `expandTransactionalLifecycle` | `powl-ast` |
| `src/aimd-controller.ts` | Transport-aware AIMD WIP, per-class latency tracker, critical-path slack scheduler | `AimdWipController`, `TransportHealthSample`, `scheduleByCriticalPathSlack` | (stdlib) |
| `src/ocel-emitter.ts` | IEEE OCEL 2.0 log builder | `Ocel2Log`, `OcelEmitter` | (stdlib) |
| `src/ocel-validator.ts` | Structural validator + optional external cmd hook | `validateOcel2`, `runExternalOcelValidator` | `ocel-emitter` |
| `src/conformance.ts` | Explore completion/standing scorer; Exploit A* alignment | `scoreCompletion`, `alignTraceAStar` | `powl-ast`, `ocel-emitter` |
| `src/powl-ocel-orchestrator.ts` | Unified execution engine, workspace guard, `runAutonomicLoop` | `executeWorkflowNet`, `deriveFollowUpPowl`, `runAutonomicLoop` | all of the above |
| `src/claude-parity.ts` | Claude Code CLI flag normalization | `normalizeClaudeAgentArgs`, `ClaudeParityResult` | (stdlib) |
| `src/launcher.ts` | Runtime bootstrap, stdio inheritance, signal propagation | `runRuntime`, `inspectRuntimeInvocation` | `claude-parity`, `max-turns`, `ocel-tap`, `lease-manager` |
| `src/max-turns.ts` | `--max-turns` → `ZCODE_MAX_TURNS` | `extractMaxTurns`, `resolveSubagentMaxTurnsEnv` | `config-paths` |
| `src/ocel-tap.ts` | Credential-redacted stream tap (`ZCODE_OCEL=1`) | `ocelEnabled`, `createOcelTap`, redaction helpers | generated ocel modules (if present) / local emitter |
| `src/lease-manager.ts` | Per-transition execution leases (acquire / release / tear-down) | `LeaseManager`, `TransitionLease` | (stdlib) |
| `packages/zcode-tui/` | `@zcode/tui` live status / telemetry view | package exports | AIMD/OCEL summary types (read-only) |
| `zcode-cli.toml` | Clean workspace, provider, retry, budget, OCEL config | (config) | — |
| `src/io/sjira-adapter.ts` | Optional JSONL work-order I/O seam (Appendix D) | `createSjiraIoAdapter`, `SjiraIoAdapter`, standing helpers | `powl-ocel-orchestrator` types only |
| `scripts/` | Reference POWL workflows + A/B harnesses | scripts | orchestrator |
| `test/` | Unit + Chicago zero-mock integration | tests | all |

### 2.2.1 Explore Compatibility Note

Until the module split lands, `src/powl-ocel-orchestrator.ts` may temporarily re-export the split modules. Promotion gate for E2: every type listed in §3–§7 exists at its specified path; the monolith becomes a thin façade or is deleted.

## 2.3 Configuration Surface (Clean-Room)

`zcode-cli.toml` is the sole workspace/process config. **Forbidden keys:** `concurrency`, `wip`, `max_parallel`, or any static parallelism target. See §8.3 for the full annotated schema.

---

# SECTION 3 — FORMAL PROCESS MODEL: POWL v2 AST & WORKFLOW-NET COMPILER

## 3.1 POWL v2 Recursive AST (`src/powl-ast.ts`) `[EXPLORE-SCOPE]`

### 3.1.1 Exact TypeScript Types

```typescript
/** Activity mutability classification for WIP>1 write-safety. */
export type ActivityKind = "readonly" | "mutating";

/** Prompt specification bound to an activity (provider-agnostic). */
export interface PromptSpec {
  /** Inline prompt text XOR path to a prompt file (exactly one required). */
  text?: string;
  path?: string;
  /** Optional system/preamble fragment. */
  system?: string;
}

export type PowlNode =
  | PowlActivity
  | PowlTau
  | PowlXor
  | PowlLoop
  | PowlPartialOrder;

export interface PowlActivity {
  kind: "activity";
  id: string;
  label: string;
  /** readonly = free concurrent fan-out; mutating = needs order or disjoint scopes */
  activityKind: ActivityKind;
  /** Glob patterns of files this activity may write (required when mutating & concurrent). */
  fileScope?: string[];
  promptSpec: PromptSpec;
  /** Optional semantic class for AIMD / Kingman telemetry segmentation. */
  transitionClass?: "readonly-probe" | "code-edit" | "test-suite" | "synthesis";
}

export interface PowlTau {
  kind: "tau";
  id: string;
}

export interface PowlXor {
  kind: "xor";
  id: string;
  children: PowlNode[]; // length >= 2
}

export interface PowlLoop {
  kind: "loop";
  id: string;
  doBranch: PowlNode;
  redoBranch: PowlNode;
  /** Hard bound; absence means exploit-phase policy default (see budgets). */
  maxIterations?: number;
}

export interface PowlPartialOrder {
  kind: "partial_order";
  id: string;
  nodes: PowlNode[];
  /** Direct precedence edges u ≺ v (u before v). */
  edges: Array<readonly [string, string]>;
}
```

### 3.1.2 Strict Partial-Order Validation

Let \(V\) be the set of child node ids and \(\prec \subseteq V \times V\) the edge relation.

`validatePowlTree(root)` MUST reject unless for every `partial_order` node:

1. **Irreflexivity:** \(\forall v \in V:\; \neg(v \prec v)\).
2. **Asymmetry:** \(u \prec v \implies \neg(v \prec u)\).
3. **Acyclicity:** the directed graph \((V, \prec)\) admits a topological order (equivalently, \(\prec^+\) is irreflexive).
4. **Transitive closure availability:** compute \(\prec^+\) via DFS/Warshall and expose it for critical-path slack (§5.4). Transitivity of the *stored* edge list is **not** required (covering relations are allowed); semantics are defined over \(\prec^+\).

```typescript
export function transitiveClosure(
  nodes: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>
): Set<string>; // encoded as `${u}->${v}` for u ≺⁺ v

export function validatePowlTree(root: PowlNode): void;
// throws PowlValidationError with code:
//   DUPLICATE_ID | XOR_TOO_SMALL | PO_EMPTY | PO_EDGE_UNKNOWN |
//   PO_IRREFLEXIVE | PO_ASYMMETRIC | PO_CYCLIC | PROMPT_SPEC_INVALID
```

### 3.1.3 Disjoint Write-Scope Validation (`WIP > 1` Safety) `[EXPLORE-SCOPE]`

```typescript
export interface WriteScopeViolation {
  a: string;
  b: string;
  overlap: string[]; // intersecting concrete paths or glob pairs
}

export function validateDisjointWriteScopes(
  po: PowlPartialOrder,
  /** Resolve globs against a workspace root; Explore may use a pure glob-intersection approx. */
  resolveOverlap: (a: string[], b: string[]) => string[]
): WriteScopeViolation[];
```

Rules:

- Unbounded concurrent fan-out is allowed for `activityKind: "readonly"`.
- For any two `mutating` activities \(u, v\) that are **unordered** (\(\neg(u \prec^+ v) \land \neg(v \prec^+ u)\)):
  - either an explicit edge must be added, **or**
  - `fileScope` must be present on both and `resolveOverlap(u.fileScope, v.fileScope) = ∅`.
- Violation at validate-time → fail-closed before firing (`WRITE_SCOPE_CONFLICT`).

**`[PROMOTION-GATE]` for Exploit OCPN upgrade:** measured file-collision rate in OCEL (`mutates_file` conflicts) \(> 0\) under Explore despite disjoint glob validation, over Exp-4.

## 3.2 Workflow-Net Compiler (`src/wf-net.ts`) `[EXPLORE-SCOPE]`

### 3.2.1 Net Types

```typescript
export interface Place {
  id: string;
  label?: string;
}

export interface Transition {
  id: string;
  label: string;
  silent: boolean;
  activityId?: string;
  activityKind?: ActivityKind;
  fileScope?: string[];
  transitionClass?: PowlActivity["transitionClass"];
  promptSpec?: PromptSpec;
}

export interface WorkflowNet {
  places: Place[];
  transitions: Transition[];
  /** transitionId → input place ids (•t) */
  pre: Map<string, string[]>;
  /** transitionId → output place ids (t•) */
  post: Map<string, string[]>;
  sourcePlace: string;
  sinkPlace: string;
}

export function compilePowlToWorkflowNet(root: PowlNode): WorkflowNet;
export function verifyStructuralSoundness(net: WorkflowNet): {
  optionToComplete: boolean;
  properCompletion: boolean;
  noDeadTransitions: boolean;
};
```

### 3.2.2 Inductive Compilation Rules

Let \(\mathcal{C}(N, p_{\text{in}}, p_{\text{out}})\) denote compilation of POWL node \(N\) between places \(p_{\text{in}}\) and \(p_{\text{out}}\).

**Activity \(a\):**
\[
T \mathrel{+}= \{t_a\},\; \bullet t_a = \{p_{\text{in}}\},\; t_a\bullet = \{p_{\text{out}}\}
\]

**Tau \(\tau\):** same as Activity with `silent: true`.

**Xor\((N_1,\ldots,N_k)\):**
\[
\forall i:\; \mathcal{C}(N_i, p_{\text{in}}, p_{\text{out}})
\]
(shared start/end places; exclusive choice by firing exactly one branch transition set).

**Loop\((do, redo)\):**
\[
\begin{align*}
&P \mathrel{+}= \{p_{\text{entry}}, p_{\text{choice}}\} \\
&\tau_{\text{enter}}: p_{\text{in}} \to p_{\text{entry}} \\
&\mathcal{C}(do, p_{\text{entry}}, p_{\text{choice}}) \\
&\mathcal{C}(redo, p_{\text{choice}}, p_{\text{entry}}) \\
&\tau_{\text{exit}}: p_{\text{choice}} \to p_{\text{out}}
\end{align*}
\]
Runtime must honor `maxIterations` by refusing further redo firings after the bound (Explore: counter in executor; Exploit: place \(p_{\text{budget}}\)).

**PartialOrder\((V, \prec)\):**
\[
\begin{align*}
&\forall v \in V:\; P \mathrel{+}= \{p_v^{\text{in}}, p_v^{\text{out}}\},\; \mathcal{C}(v, p_v^{\text{in}}, p_v^{\text{out}}) \\
&\tau_{\text{fork}}: p_{\text{in}} \to \{p_r^{\text{in}} \mid r \text{ minimal in }(V,\prec)\} \\
&\forall (u \prec v):\; P \mathrel{+}= \{p_{u\to v}\},\;
  \text{wire } p_u^{\text{out}} \xrightarrow{\tau} p_{u\to v} \xrightarrow{\tau_{\text{sync}}} p_v^{\text{in}} \\
&\tau_{\text{join}}: \{p_\ell^{\text{out}} \mid \ell \text{ maximal}\} \to p_{\text{out}}
\end{align*}
\]

Top-level: create `sourcePlace`, `sinkPlace`, compile root between them.

### 3.2.3 Soundness Guarantee

Under standard WF-net firing semantics, the inductive construction above yields a sound workflow net (option to complete, proper completion, no dead transitions) for every well-formed POWL tree accepted by `validatePowlTree`. `verifyStructuralSoundness` is a defensive checker for compiler regressions (Explore dry-run Exp-1).

## 3.3 Transactional Activity Lifecycle (Atomicity & Timeout Livelock)

### 3.3.1 Formal Hazard

Classical Petri-net transitions are atomic. Coding-agent subprocesses are long-running and side-effecting. Blindly returning a token to \(\bullet t\) on transport timeout:

1. lies about partial filesystem mutations, and
2. creates an unbounded implicit self-loop (livelock) unless a retry budget place exists.

### 3.3.2 `[EXPLORE-SCOPE]` — Fingerprint + Bounded Retry

```typescript
export interface WorkspaceFingerprint {
  headSha: string;
  porcelain: string; // `git status --porcelain` stdout
  sha256: string;    // hash(headSha + "\n" + porcelain)
}

export interface TransitionRetryState {
  transportRetries: number;
  maxTransportRetries: number; // from zcode-cli.toml [retries]
}

export type TransportRefusalCode =
  | "DIRTY_TIMEOUT_REFUSED"
  | "REFUSED_TRANSPORT"
  | "REFUSED_LOGIC"
  | "REFUSED_MAX_TURNS"
  | "REFUSED_BUDGET";
```

Protocol before/after each visible transition fire:

1. Record `WorkspaceFingerprint` (`git rev-parse HEAD` + `git status --porcelain`).
2. Invoke agent subprocess via lease (`src/lease-manager.ts`).
3. On `UND_ERR_CONNECT_TIMEOUT` | `429` | transport `5xx`:
   - Re-fingerprint. If clean relative to pre-fire fingerprint → return tokens to \(\bullet t\), increment retry counter, AIMD MD (§5).
   - If dirty → if `[retries].rollback_on_dirty = true`, stash/revert *transition-scoped* uncommitted hunks then retry; else halt fail-closed with `DIRTY_TIMEOUT_REFUSED`.
4. If `transportRetries >= maxTransportRetries` → standing `TIMED_OUT` / code `REFUSED_TRANSPORT` (eliminates livelock). No further re-enable of \(t\).

### 3.3.3 `[EXPLOIT-UPGRADE]` — Transactional Lifecycle Subnet

Compile every `Activity` into:

\[
\begin{align*}
&p_{\text{ready}} \xrightarrow{\text{start}} p_{\text{running}} \xrightarrow{\text{complete}} p_{\text{done}} \\
&p_{\text{running}} \xrightarrow{\text{abort}} p_{\text{compensating}} \xrightarrow{\text{rollback}}
  \{p_{\text{ready}}, p_{\text{failed}}\} \\
&p_{\text{budget}} \text{ holds remaining retry tokens (initial } = \texttt{maxTransportRetries})
\end{align*}
\]

Optional further upgrade: Object-Centric Petri Nets with typed `File` / `Workspace` places and variable arcs.

**`[PROMOTION-GATE]`:** Exp-3 dirty-timeout rate \(> 0\) **and** Explore stash/revert leaves residual conflicts in \(\ge 5\%\) of injected faults.

---

# SECTION 4 — EXECUTION SEMANTICS VS. CONFORMANCE CHECKING

## 4.1 Execution Semantics (`executeWorkflowNet`) `[EXPLORE-SCOPE]`

```typescript
export interface ExecutionOutcome {
  ok: boolean;
  /** Transient transport congestion (not logic failure). */
  transportBackpressure?: boolean;
  /** Loop redo hint from executor/oracle. */
  redo?: boolean;
  exitCode: number;
  detail?: string;
  refusalCode?: TransportRefusalCode;
  transport?: TransportHealthSample;
  task?: TaskExecutionSample;
}

export type TransitionExecutor = (t: Transition) => Promise<ExecutionOutcome>;

export interface ExecuteOptions {
  maxTransportRetries?: number;
  rollbackOnDirty?: boolean;
  workspaceRoot: string;
  outputDir?: string;
  ocel?: OcelEmitter;
}

export async function executeWorkflowNet(
  root: PowlNode,
  executor: TransitionExecutor,
  options: ExecuteOptions
): Promise<OcelPowlRunResult>;
```

Firing rules:

1. Silent transitions drain greedily when enabled.
2. Visible transition \(t\) fires only when \(\forall p \in \bullet t: M(p) \ge 1\), AIMD admits a WIP slot, and disjoint-write lock is free.
3. Logic refusals (non-zero agent exit, failed verification command, exceeded `--max-turns`) halt the dependent branch fail-closed (`REFUSED`) **without** firing downstream transitions.
4. Transport backpressure follows §3.3.2 (token return only if clean / rolled back, bounded retries).

## 4.2 Why Enforced Execution ≠ Conformance

When the orchestrator enforces \(\forall p \in \bullet t: M(p) \ge 1\), missing tokens on its own schedule are structurally \(m \equiv 0\). Therefore Rozinat & van der Aalst (2008) token-based replay fitness

\[
f = \frac{1}{2}\left(1 - \frac{m}{c}\right) + \frac{1}{2}\left(1 - \frac{r}{p}\right)
\]

computed on the orchestrator's schedule only measures **completion ratio**, not behavioral conformance of the *agent*.

**Normative rule:** Explore MUST NOT brand this \(f\) as “behavioral conformance” or “fitness court.” If emitted for diagnostics, label it `completionHeuristic`.

## 4.3 `[EXPLORE-SCOPE]` — Completion & Standing Metrics (`src/conformance.ts`)

```typescript
export type TransitionStanding = "PENDING" | "RUNNING" | "ALIVE" | "REFUSED" | "TIMED_OUT";

export interface CompletionStandingReport {
  completedTransitions: number;
  refusedTransitions: number;
  timedOutTransitions: number;
  strandedTokens: number; // r
  transportRetryCount: number;
  standingByTransition: Record<string, TransitionStanding>;
  /** Optional; MUST be labeled completionHeuristic in receipts. */
  completionHeuristic?: {
    produced: number;
    consumed: number;
    missing: number;
    remaining: number;
    score: number;
  };
  soundTermination: boolean; // proper completion AND no REFUSED/TIMED_OUT
}

export function scoreCompletion(/* marking + standing map */): CompletionStandingReport;
```

## 4.4 `[EXPLOIT-UPGRADE]` — Optimal \(A^*\) Trace Alignment (\(\gamma = 0\))

Align the *observed* agent behavior captured by `src/ocel-tap.ts` (tool calls, file reads/writes, shell commands, test invocations) against the normative POWL activity contract:

```typescript
export interface AlignmentMove {
  kind: "sync" | "model_only" | "log_only";
  modelLabel?: string;
  logLabel?: string;
  cost: number; // gamma=0 => sync=0, others=1 (standard)
}

export interface AlignmentResult {
  cost: number;
  fitness: number; // 1 - cost / worstCaseCost
  moves: AlignmentMove[];
  deviations: Array<{
    type: "out_of_scope_write" | "skipped_test" | "unauthorized_tool" | "other";
    detail: string;
  }>;
}

export function alignTraceAStar(
  normative: PowlNode,
  observedToolTrace: Ocel2Event[],
  options?: { gamma?: number } // default 0
): AlignmentResult;
```

**`[PROMOTION-GATE]`:** Exp-4 shows \(\ge 3\) distinct deviation classes in live OCEL tool traces that completion heuristics cannot detect.

---

# SECTION 5 — AUTONOMIC AIMD EQUILIBRIUM CONTROLLER & SCHEDULER

## 5.1 Zero Hardcoded Concurrency Knobs `[EXPLORE-SCOPE]`

- No `--concurrency N` in CLI workflow configs.
- Controller initializes at `WIP = 1` (slow-start).
- Optional `maxWipCeiling` in `[aimd]` is a **safety fuse only**, never a static target.

## 5.2 Separating Transport Congestion from Heavy-Tailed Task Duration

**Critical Explore Rule:** Never compare raw total turn duration against a global \(2\times\) median set by short checks. That misclassifies complex coding work as API congestion and thrashing `WIP`.

```typescript
export interface TransportHealthSample {
  connectLatencyMs?: number;
  httpStatus?: number;
  undErrConnectTimeout?: boolean;
  ttftMs?: number;
  rateLimitRemainingRequests?: number;
  rateLimitRemainingTokens?: number;
  retryAfterSec?: number;
}

export interface TaskExecutionSample {
  serviceMs: number;
  turnCount: number;
  tokensIn: number;
  tokensOut: number;
  transitionClass: NonNullable<PowlActivity["transitionClass"]>;
}

export class AimdWipController {
  wip: number;                 // starts at 1
  peakEquilibriumWip: number;
  maxWipCeiling?: number;

  onHealthyCompletion(transport: TransportHealthSample, task: TaskExecutionSample): AimdAdjustment;
  onCongestion(transport: TransportHealthSample): AimdAdjustment;
  availableSlots(inFlight: number): number;
}

export interface AimdAdjustment {
  changed: boolean;
  oldWip: number;
  newWip: number;
  reason:
    | "clean_completion_ai"
    | "transport_timeout_md"
    | "http_429_md"
    | "http_5xx_md"
    | "ttft_spike_md"
    | "rate_limit_floor_md";
}
```

Telemetry vectors (both recorded to OCEL on every transition invocation):

1. **Transport / API Health Vector:** TCP/TLS connect latency, HTTP status (`429`,`502`,`503`,`504`), `UND_ERR_CONNECT_TIMEOUT`, TTFT, provider rate-limit headers (`x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, `retry-after`).
2. **Task Execution Vector:** `serviceMs`, turn count, tokens in/out, segmented by `transitionClass`.

## 5.3 AIMD Control Law

**Additive Increase (AI):** On clean transition completion with nominal transport health —

- no `429`, no connect timeout, no `5xx`,
- TTFT within \(2\times\) rolling median TTFT (per class or global TTFT window — **not** `serviceMs`),
- remaining TPM/RPM headroom above `[aimd].rate_limit_safety_floor`,

then:

\[
\text{WIP} \leftarrow \text{WIP} + 1
\]

(optionally capped by `maxWipCeiling` fuse).

**Multiplicative Decrease (MD):** On `UND_ERR_CONNECT_TIMEOUT`, `429`, `5xx`, or TTFT \(> 2\times\) rolling median TTFT:

\[
\text{WIP} \leftarrow \max\bigl(1,\; \lfloor \text{WIP}/2 \rfloor\bigr)
\]

Honor `retry-after` with jittered backoff. Emit OCEL event `congestion_backoff`.

**Forbidden:** MD triggered solely by `serviceMs > 2 × median(serviceMs)`.

## 5.4 Enabled-Transition Scheduling Discipline `[EXPLORE-SCOPE]`

When `enabledTransitions.length > availableWipSlots`, schedule by **minimum critical-path slack**:

\[
\text{slack}(t) = W_{\text{crit}}(G) - \big(\text{est}(t) + \text{remainingDownstream}(t)\big)
\]

where \(G\) is the partial-order graph under \(\prec^+\), \(\text{est}\) is earliest start under current marking, and \(\text{remainingDownstream}\) is the longest path weight from \(t\) to a sink (Explore may use unit weights; Exploit may use per-class median `serviceMs`).

```typescript
export function scheduleByCriticalPathSlack(
  enabled: Transition[],
  closure: Set<string>, // ≺⁺
  slots: number,
  serviceMedianByClass?: Record<string, number>
): Transition[];
```

Objective: minimize workflow makespan \(W\).

## 5.5 Explore vs Exploit Evolution

| Phase | Behavior |
|---|---|
| `[EXPLORE-SCOPE]` | AIMD over transport errors + TTFT + `retry-after`; log full per-class service-time histograms and token counts to OCEL 2.0 |
| `[EXPLOIT-UPGRADE]` | Dual-constraint admission: WIP slots **and** sliding-window TPM/RPM token-bucket budgets; Little's Law \(L=\lambda W\) and Kingman variance dashboard in `@zcode/tui` |

**`[PROMOTION-GATE]`:** Exp-2 shows AIMD \(\lambda_{\text{alive}}\) strictly exceeds best fixed \(N\) **or** matches within 5% while reducing `429`+timeout rate by \(\ge 20\%\); **and** Exp-4 measures TPM/RPM headroom binding as a real constraint (>10% of backoffs).

---

# SECTION 6 — IEEE OCEL 2.0 TELEMETRY, CREDENTIAL-REDACTED TAP & PROCESS DISCOVERY

## 6.1 IEEE OCEL 2.0 Data Model (`src/ocel-emitter.ts`) `[EXPLORE-SCOPE]`

### 6.1.1 Exact Types

```typescript
export interface Ocel2DynamicAttribute {
  name: string;
  value: string;
  time: string; // ISO-8601
}

export interface Ocel2Object {
  id: string;
  type: string;
  attributes: Ocel2DynamicAttribute[];
  relationships: Array<{ objectId: string; qualifier: string }>; // O2O
}

export interface Ocel2Event {
  id: string;
  type: string;
  time: string;
  attributes: Array<{ name: string; value: string }>;
  relationships: Array<{ objectId: string; qualifier: string }>; // E2O
}

export interface Ocel2Log {
  objectTypes: Array<{ name: string; attributes: Array<{ name: string; type: string }> }>;
  eventTypes: Array<{ name: string; attributes: Array<{ name: string; type: string }> }>;
  objects: Ocel2Object[];
  events: Ocel2Event[];
}
```

### 6.1.2 Standard Object Types

| Object Type | Purpose |
|---|---|
| `WorkflowRun` | One autonomic cycle / WF-net case |
| `Transition` | Compiled visible transition / activity instance |
| `Artifact` | Logical deliverable produced by a transition |
| `WorkspaceFile` | Path-level file object for `mutates_file` / `reads_file` |
| `AgentSession` | Subprocess session identity |

### 6.1.3 Standard Event Types

`workflow_started`, `transition_enabled`, `transition_started`, `agent_tool_call`, `transport_retry`, `congestion_backoff`, `transition_completed`, `transition_refused`, `workspace_rolled_back`, `cycle_synthesized`, `workflow_finished`.

### 6.1.4 Relationship Qualifiers

**E2O:** `workflow`, `executes`, `produces`, `verifies`, `blocks`, `mutates_file`, `reads_file`.

**O2O:** `part_of`, `depends_on`, `derived_from`.

### 6.1.5 Dynamic Timestamped Object Attributes

Track over time: `standing` (`PENDING → RUNNING → ALIVE | REFUSED | TIMED_OUT`), `wipLimit`, `serviceMs`, `ttftMs`, `tokensIn`, `tokensOut`, `sha256Receipt`.

## 6.2 Credential-Redacted Runtime Tap (`src/ocel-tap.ts`) `[EXPLORE-SCOPE]`

Activation: `ZCODE_OCEL=1`. Output directory: `ZCODE_OCEL_DIR` or `[ocel].output_dir` (default `~/.zcode/ocel`).

Requirements:

1. Intercept subprocess stdout/stderr/structured JSON events in real time **without** altering inherited stdio semantics for the operator (interactive: mirror; headless: line-buffered tap).
2. Deterministic redaction **before** any disk write:
   - API keys / secret-shaped keys
   - `Authorization: Bearer …`
   - JWTs
   - PEM blocks
   - values of env vars listed in `[ocel].redact_env`
3. Fail-closed: if redaction throws, drop the record and emit `transition_refused` diagnostic with `REDACTION_FAILURE` (never write raw secrets).

```typescript
export function redactSecrets(
  value: unknown,
  patterns: RegExp[],
  envSecrets: string[]
): unknown;

export function ocelEnabled(env: NodeJS.ProcessEnv): boolean;
export function ocelDirectory(env: NodeJS.ProcessEnv, toml?: ZcodeCliToml): string;
```

## 6.3 Standalone Validation & Process Discovery

### 6.3.1 `[EXPLORE-SCOPE]` — `src/ocel-validator.ts`

```typescript
export interface OcelValidationResult {
  ok: boolean;
  errors: Array<{ code: string; message: string; path?: string }>;
}

export function validateOcel2(log: Ocel2Log): OcelValidationResult;
// Checks: schema presence, referential integrity of all E2O/O2O IDs,
// monotonic timestamps per object attribute stream, required event/object types.

export function runExternalOcelValidator(
  logPath: string,
  cmd: string // from [ocel].validator_cmd
): Promise<OcelValidationResult>;
// Optional; skip if unset. Failure of external cmd → Explore receipt warning, not hard fail
// unless [ocel].validator_required = true.
```

### 6.3.2 `[EXPLOIT-UPGRADE]` — `src/ocel-discover.ts`

Mine captured logs into Object-Centric Directly-Follows Graphs (OC-DFGs) to detect:

- hidden agent rework loops (e.g., `edit → test_fail → edit`),
- unexpected file collisions,
- per-class bottleneck drift.

**`[PROMOTION-GATE]`:** H4 confirmed in Exp-4 (recurring pattern frequency \(\ge 0.2\)).

---

# SECTION 7 — BOUNDED AUTONOMIC FOLLOW-UP SYNTHESIS (`runAutonomicLoop`)

## 7.1 Closed-Loop Cycle Synthesis

```typescript
export function deriveFollowUpPowl(
  receipt: OcelPowlRunResult,
  cycle: number,
  mode: "once" | "soak"
): PowlNode | null; // null => terminate cleanly
```

Deterministic rules from cycle receipt \(R_t\):

| Case | Condition | Synthesis |
|---|---|---|
| **A** | Any transition `REFUSED` / failed verification | Remediation POWL scoped to failing transition diagnostics + `fileScope` |
| **B** | All required alive, but an `ALIVE` transition exceeds \(2\times\) **its transition-class median** `serviceMs` | Profiling / Optimization POWL for that transition |
| **C** | All `ALIVE`, no class bottleneck | `soak` → Anti-Vacuity Mutation & Drift Audit POWL; `once` / cycle budget exhausted → `null` (exit 0) |

**Note:** Case B uses **per-class** median, never global median (aligns with H2 / §5.2).

## 7.2 Mandatory Anti-Runaway & Budget Guardrails (Explore AND Exploit)

```typescript
export interface AutonomicBudgets {
  maxCycles: number;                 // default 1 for --once; N for soak
  maxTotalTokens: number;            // fail-closed when exceeded
  maxWallClockMs: number;            // fail-closed when exceeded
  maxRemediationAttempts: number;    // default 3
}

export function failureSignature(transitionId: string, errorDetail: string): string;
// sha256(`${transitionId}\n${normalizedError}`)
```

Rules:

1. **Per-failure-signature remediation cap:** hash `(transitionId, errorSignature)`. If the same signature repeats beyond `maxRemediationAttempts`, halt fail-closed and write durable `HANDOFF.md` + JSON receipt (do not burn infinite tokens).
2. **Global budgets:** `maxCycles`, `maxTotalTokens`, `maxWallClockMs` from `zcode-cli.toml` with CLI overrides.
3. Exhausted budget → exit code `2` (`BUDGET_EXCEEDED`) distinct from logic refusal (`1`) and success (`0`).

```typescript
export async function runAutonomicLoop(
  initialPowl: PowlNode,
  executor: TransitionExecutor,
  options: ExecuteOptions & { budgets: AutonomicBudgets; mode: "once" | "soak" }
): Promise<OcelPowlRunResult[]>;
```

---

# SECTION 8 — CLAUDE CODE CLI PARITY, LAUNCHER & CONFIGURATION

## 8.1 Exact CLI Parity Matrix (`src/claude-parity.ts`) `[EXPLORE-SCOPE]`

| Input Flag | Native Mapping | Precedence / Validation |
|---|---|---|
| `-p`, `--prompt <text>` | `--prompt <text>` | Explicit prompt wins over `--print` |
| `--print <prompt>` | `--prompt <prompt>` when no explicit `-p`/`--prompt` | If `--print` lacks value, leave untouched |
| `--dangerously-skip-permissions` | `--mode yolo` | Skipped if `--mode` already present |
| `--permission-mode <m>` | `--mode` via map below | Error if missing/unknown value; skipped if `--mode` present |
| `--max-turns <N>` | env `ZCODE_MAX_TURNS=N` (via `src/max-turns.ts`) | Positive integer; hard fail-closed on turn \(N+1\) |
| `--disallowedTools` / `--disallowed-tools <tools...>` | per-run tool restriction list passed through / normalized | Gather until next flag |
| `-c` / `--continue` | session continuation | Pass-through |
| `--resume <sessionId>` | resume session | Require value |
| `--output-format <text\|json\|stream-json>` | pass-through | — |
| `--json` | `--output-format json` if format unset | — |
| `--cwd <path>` | working directory | Must exist |
| `--attach <path>` | attach context path | Must exist |
| `ZCODE_OCEL=1` | enable credential-redacted OCEL tap | Env, not CLI flag |

### 8.1.1 Permission Mode Map

```typescript
const PERMISSION_MODE_MAP: Readonly<Record<string, "build" | "edit" | "yolo">> = {
  build: "build",
  default: "build",
  plan: "build",
  edit: "edit",
  acceptEdits: "edit",
  yolo: "yolo",
  bypassPermissions: "yolo",
  dontAsk: "yolo"
};
```

```typescript
export interface ClaudeParityResult {
  args: string[];
  error?: string;
}

export function normalizeClaudeAgentArgs(args: string[]): ClaudeParityResult;
```

Edge cases:

- Flags after `--` are never rewritten.
- Unknown flags pass through (runtime CLI remains authority).
- Conflicting mode sources: explicit `--mode` wins; parity flags become no-ops.

## 8.2 Launcher & Subprocess Mechanics `[EXPLORE-SCOPE]`

| Concern | Contract |
|---|---|
| Runtime | Node.js `>= 22.19.0` |
| Interactive stdio | `stdio: "inherit"` — **no nested PTY** |
| Headless / OCEL | Piped with line-buffered tap; operator-visible mirror preserved where applicable |
| Signals | `SIGINT` / `SIGTERM` propagate; active leases released; in-flight AIMD slots freed |
| Turn cap | `extractMaxTurns` → `ZCODE_MAX_TURNS`; runtime refuses turn \(N+1\) fail-closed |

## 8.3 Clean Configuration Schema (`zcode-cli.toml`)

Complete annotated schema (Explore):

```toml
# zcode-cli.toml — clean-room configuration
# FORBIDDEN: concurrency, wip, max_parallel, or any static parallelism target.

[provider]
# Logical provider id resolved by the adapter layer (not a hardcoded SDK).
name = "default"
# Base URL / model are read from provider.example.json / env; optional overrides:
# base_url = "https://api.example.com"
# model = "coding-agent-latest"

[workspaces]
# Domain-agnostic workspace roots (operator-local paths).
root = "."
# Additional named roots for multi-root PartialOrder workflows:
# extra = { docs = "./docs", pkg = "./packages/zcode-tui" }

[aimd]
# Safety fuse ONLY — never a static target. Omit for unbounded slow-start.
# max_wip_ceiling = 32
# TTFT spike threshold multiplier (default 2.0)
ttft_spike_factor = 2.0
# Fraction of remaining rate-limit budget treated as unsafe (default 0.05)
rate_limit_safety_floor = 0.05
# Rolling window size for TTFT median (default 32)
ttft_window = 32

[retries]
max_transport_retries = 3
rollback_on_dirty = true
# Jittered backoff base for retry-after absence (ms)
backoff_base_ms = 500
backoff_max_ms = 30000

[budgets]
max_cycles = 1
max_total_tokens = 2_000_000
max_wall_clock_ms = 7_200_000
max_remediation_attempts = 3

[ocel]
enabled = false
output_dir = "~/.zcode/ocel"
# Optional external validator command; {path} substituted with log file path
# validator_cmd = "ocel-validate {path}"
validator_required = false
redact_env = ["API_KEY", "AUTHORIZATION", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
```

Loader MUST reject unknown keys under `[aimd]` that encode static concurrency (`concurrency`, `wip`, `workers`, `max_parallel`) with exit code `2` and message `STATIC_CONCURRENCY_FORBIDDEN`.

---

# SECTION 9 — VERIFICATION STRATEGY (CHICAGO-STYLE, ZERO-MOCK) & EXPERIMENT PROTOCOL

## 9.1 Zero-Mock Chicago-Style Test Suite (`test/`)

### 9.1.1 Unit & Formal Soundness Tests

| File | Assertions |
|---|---|
| `test/powl-ast.test.ts` | Reject reflexive, symmetric, cyclic partial orders; accept covering DAGs; transitive closure correctness; disjoint write-scope violations |
| `test/wf-net.test.ts` | Inductive compilation for Activity/Tau/Xor/Loop/PO; `verifyStructuralSoundness` true on valid trees; transactional retry exhaustion leaves no re-enabled transition (no livelock) |
| `test/aimd-controller.test.ts` | AI on healthy TTFT; MD on timeout/`429`/TTFT spike; **no MD** on long `serviceMs` with healthy transport; critical-path slack ordering |
| `test/claude-parity.test.ts` | Full flag matrix §8.1; precedence; `--` passthrough; error paths |
| `test/ocel-validator.test.ts` | Broken E2O id → fail; non-monotonic attr time → fail; redaction strips Bearer/JWT/PEM |
| `test/conformance.test.ts` | Completion heuristic labeled; standing map; Exploit A* stub gated behind flag |

### 9.1.2 Chicago End-to-End (`test/powl-ocel-chicago.test.ts`)

Must:

1. Spawn real `bin/zcode.js` subprocesses against real temporary git workspaces.
2. Verify real filesystem side effects.
3. Recompute SHA-256 receipts from disk (byte identity).
4. Verify credential redaction in emitted OCEL 2.0 logs.
5. **Anti-vacuity mutations** (each must flip exit code to `1`):
   - inject a broken assertion in a verification activity,
   - inject a dirty timeout diff mid-transition,
   - tamper an OCEL object reference id.

Commands:

```bash
bun run typecheck
bun test test/powl-ast.test.ts test/wf-net.test.ts test/aimd-controller.test.ts test/claude-parity.test.ts
bun test test/powl-ocel-chicago.test.ts
```

## 9.2 Explore-Phase Empirical Experiment Protocol

### Exp-1 — Dry-Run Soundness & Scaling

**Command:**

```bash
bun scripts/exp1-dry-run-soundness.ts --trees sequential,wide-parallel,nested-xor-loop --n 100
```

**Metrics:** soundness pass rate, deadlock count, dead-transition count.

**Pass:** 100% soundness; zero deadlocks; zero dead transitions across all generated trees.

### Exp-2 — AIMD vs Static Concurrency A/B

**Command:**

```bash
bun scripts/exp2-aimd-ab.ts \
  --workflow scripts/fixtures/multi-transition-coding.powl.json \
  --fixed 1,4,8,16 \
  --aimd \
  --repeats 5
```

**Metrics:** \(\lambda_{\text{alive}}\), timeout rate, `429` count, makespan \(W\), false-MD rate.

**Pass (hypothesis support):** AIMD \(\lambda_{\text{alive}}\) ≥ best fixed-\(N\) within measurement noise **or** \(\lambda_{\text{alive}}\) within 5% of best fixed while (`429`+timeout) rate ≤ 0.8 × best-fixed's rate.

### Exp-3 — Timeout & Dirty-State Fault Injection

**Command:**

```bash
bun scripts/exp3-dirty-timeout.ts \
  --faults connect_timeout,429,partial_write \
  --rollback true,false
```

**Metrics:** livelock count (must be 0), dirty-timeout rate, retry success with/without rollback, residual dirty workspaces.

**Pass:** zero livelock; with `rollback_on_dirty=true`, residual dirty rate \(= 0\) after handled faults; with `false`, dirty faults yield `DIRTY_TIMEOUT_REFUSED` (never silent token return).

### Exp-4 — OCEL 2.0 Trace Mining Pilot

**Command:**

```bash
bun scripts/exp4-ocel-mining-pilot.ts --live-runs 10 --out receipts/v26.11.20/exp4/
```

**Metrics:** \(c_s^2\) per class, TTFT distribution, rework frequency, deviation classes visible in tool traces.

**Pass (data product):** written report `receipts/v26.11.20/exp4/REPORT.md` containing histograms + promotion recommendations for X1–X4. Spec completeness ≠ hypothesis confirmation; report must state which of H1–H4 are supported/falsified.

---

# SECTION 10 — SEQUENCED IMPLEMENTATION ROADMAP (EXPLORE → EXPLOIT) & RELEASE GATES

## 10.1 Explore Milestones (`E1`–`E4`)

| Milestone | Deliverables | Test / Gate Commands | Exit Gate |
|---|---|---|---|
| **E1** | Clean-room CLI parity (`src/claude-parity.ts`, `bin/zcode.js`, `src/max-turns.ts`) + `zcode-cli.toml` schema rejecting static concurrency | `bun test test/claude-parity.test.ts`; toml loader unit test | All §8.1 flags normalized; forbidden concurrency keys exit `2` |
| **E2** | `src/powl-ast.ts` + `src/wf-net.ts` + dry-run token execution | `bun test test/powl-ast.test.ts test/wf-net.test.ts`; Exp-1 | Exp-1 pass; monolith split or façade complete |
| **E3** | `src/aimd-controller.ts` (transport-aware) + critical-path scheduler + pre-fire dirty-state guard + bounded retries + `src/lease-manager.ts` | `bun test test/aimd-controller.test.ts`; Exp-3 (synthetic) | Zero livelock; no serviceMs-only MD |
| **E4** | `src/ocel-emitter.ts` + `src/ocel-validator.ts` + redacted `src/ocel-tap.ts` + `runAutonomicLoop` budgets + Exp-1..4 harnesses + report | `bun test test/powl-ocel-chicago.test.ts`; Exp-1..4 | Chicago anti-vacuity green; Exp-4 report filed under `receipts/v26.11.20/exp4/` |

## 10.2 Exploit Milestones (`X1`–`X4`) — gated on E4 empirical data

| Milestone | Deliverables | Promotion Gate (from E4) | Exit Gate |
|---|---|---|---|
| **X1** | Full transactional lifecycle Petri nets + deterministic workspace snapshot/rollback | H3 supported (dirty-timeout rate \(> 0\) or rollback materially helps) | Fault injection: atomic rollback; budget place prevents livelock |
| **X2** | Optimal \(A^*\) alignment \(\gamma=0\) over observed tool-call traces | ≥3 deviation classes invisible to completion heuristics | Alignment fitness correlates with injected deviations; labeled separately from completionHeuristic |
| **X3** | Dual-constraint AIMD (WIP + TPM/RPM token buckets) + `@zcode/tui` telemetry dashboard | TPM/RPM headroom binds in >10% of backoffs | Dashboard shows \(L,\lambda,W,c_s^2\); dual admission never exceeds bucket |
| **X4** | OCEL process discovery (OC-DFG rework mining) + optional OCPN typed `File`-place execution | H4 supported (rework frequency \(\ge 0.2\)) | Discovery reproduces known injected rework; OCPN optional behind feature flag |

## 10.3 Release Versioning

| Tag | Meaning |
|---|---|
| `v26.11.20-explore` | E1–E4 complete; Experimentation-Through-Implementation runtime |
| `v26.11.20-exploit` | X1–X4 complete; production hardening after empirical closure |
| Calendar version `v26.11.20` | Marketing/umbrella release once Explore ships; Exploit may trail as `v26.11.20-exploit` or subsequent calendar bumps |

## 10.4 Error / Exit Code Registry (Normative)

| Code | Symbol | Meaning |
|---|---|---|
| `0` | `OK` | Sound termination; all required transitions `ALIVE` |
| `1` | `REFUSED_LOGIC` | Logic / verification / max-turns refusal |
| `2` | `BUDGET_EXCEEDED` or `STATIC_CONCURRENCY_FORBIDDEN` or config error | Operator/budget/config failure |
| `3` | `REFUSED_TRANSPORT` | Transport retries exhausted |
| `4` | `DIRTY_TIMEOUT_REFUSED` | Dirty workspace on timeout with rollback disabled or failed |
| `5` | `WRITE_SCOPE_CONFLICT` | Disjoint write-scope validation failed |
| `6` | `OCEL_VALIDATION_FAILED` | When `validator_required = true` |

---

## Appendix A — Receipt Schema (Explore Cycle)

```typescript
export interface OcelPowlRunResult {
  workflowId: string;
  cycle: number;
  completion: CompletionStandingReport;
  ocel: Ocel2Log;
  ocelSha256: string;
  ocelValidation: OcelValidationResult;
  equilibriumWip: number;
  bottlenecks: Array<{ transitionId: string; transitionClass: string; serviceMs: number }>;
  transportRetries: number;
  budgetsRemaining: Partial<AutonomicBudgets>;
}
```

Receipts land under `receipts/v26.11.20/<run-id>/` as:

- `powl-tree.json`
- `workflow.ocel.json`
- `completion-standing.json`
- `aimd-telemetry.json`
- `HANDOFF.md` (only on remediation-cap or budget halt)

## Appendix B — Mapping from Current Tree → Target Modules

| Current (pre-spec) | Target |
|---|---|
| Monolithic `src/powl-ocel-orchestrator.ts` AST/validate/compile/AIMD/OCEL/loop | Split per §2.2; orchestrator retains execution + autonomic loop only |
| AIMD `onSuccess(serviceMs)` latency_spike_md | Remove; replace with transport/TTFT-driven MD (§5) |
| `fitness` branded as Van der Aalst conformance on own schedule | Relabel `completionHeuristic`; behavioral conformance → Exploit A* |
| `zcode-cli.toml` domain-specific path keys | Replace with clean-room schema §8.3 |
| External hardcoded validator path | Optional `[ocel].validator_cmd` only |
| Manual POWL scripts only | Optional `src/io/sjira-adapter.ts` maps `candidates.jsonl` → `PartialOrder` (Appendix D) |

## Appendix C — Mathematical Notation Index

| Symbol | Meaning |
|---|---|
| \(\prec, \prec^+\) | Direct precedence; transitive closure |
| \(P, T, F, i, o\) | Places, transitions, flow, source, sink |
| \(M, \bullet t, t\bullet\) | Marking; preset; postset |
| \(\rho, c_a^2, c_s^2, \bar{s}, W_q\) | Utilization; arrival/service SCVs; mean service; queue wait (Kingman) |
| \(\lambda_{\text{alive}}\) | Throughput of `ALIVE` transitions |
| \(L = \lambda W\) | Little's Law (steady-state identity) |
| \(f\) (Rozinat) | Token-based replay fitness — **completion heuristic only** under enforced execution |
| \(\gamma\) | Alignment move cost parameter (Exploit: \(0\)) |

## Appendix D — Optional File-Based Work-Order I/O Seam (`src/io/sjira-adapter.ts`) `[EXPLORE-SCOPE]`

### D.1 Clean-Room Rule for Adapters

The core orchestrator accepts only `PowlNode` + `TransitionExecutor`. External work-order systems attach through an **optional adapter seam** under `src/io/`. Absence of the adapter (or of its env keys) MUST NOT block core Explore. The adapter MUST NOT import marketplace plugins, lease fabrics, or hardcoded third-party workspace paths into `src/powl-ocel-orchestrator.ts`.

### D.2 Dataflow

```text
[INPUT]                              [ZCODE-CLI ENGINE]                     [OUTPUT]
"$GGEN_BIN" sjira frontier    ──►    candidatesToPowl → PartialOrder  ──►  SJIRA_LEDGER
+ SJIRA_CANDIDATES (.jsonl)          AIMD + bin/zcode.js                     (ledger.jsonl)
                                              │                                   │
                                   verifyIgniterCleanRoom                         ▼
                                   (mix ggen_igniter.sync                         loop_receipt.json
                                    && git diff --exit-code)                      + OCEL 2.0
                                              │                                   │
                                              ▼                                   ▼
                                   standing honesty cap                   sjira complete /
                                   (no PARTIAL→ALIVE)                     evidence court
```

### D.3 Exact TypeScript Facade

Normative implementation: `src/io/sjira-adapter.ts`. Primary surface:

```typescript
export interface SjiraIoAdapter {
  paths: SjiraIoPaths;
  ingestSjiraFrontier(mode?: "frontier_cmd" | "candidates_file"): IngestResult;
  candidatesToPowl(candidates: readonly SjiraCandidate[], rootId?: string): PowlNode;
  verifyIgniterCleanRoom(candidate: SjiraCandidate): IgniterGateResult;
  emitSjiraLedgerEntry(args: Omit<EmitTransitionArgs, "paths">): SjiraLedgerEntry;
  emitSjiraLedgerAndReceipt(
    args: Omit<EmitCycleArgs, "paths" | "ingest"> & { ingest: IngestResult }
  ): SjiraLoopReceipt;
}

export function createSjiraIoAdapter(
  env: SjiraAdapterEnv,
  defaults: Partial<SjiraIoPaths> & { cwd: string }
): SjiraIoAdapter;
```

Wire types (required fields):

| Type | Required fields | Notes |
|---|---|---|
| `SjiraCandidate` | `id` | `dependsOn[]` → edges \(u \prec v\); dangling deps outside frontier skipped |
| `SjiraLedgerEntry` | `ts`, `cycleId`, `workOrderId`, `outcome`, `standing`, `sha256Receipt` | Append-only JSONL |
| `SjiraLoopReceipt` | `schema: "zcode.sjira.loop_receipt/1"`, `aggregateStanding`, `exitCode` | Written to `SJIRA_OUT_DIR/loop_receipt.json` |

### D.4 Fail-Closed Binary Pinning

`requireGgenBin(raw)`:

1. Unset/empty → `GGEN_NOT_FOUND` (exit hint `2`) — **never** `PATH` lookup of bare `ggen`.
2. Non-absolute → `GGEN_BIN_NOT_ABSOLUTE`.
3. Missing/non-executable → `GGEN_NOT_FOUND`.

### D.5 Standing Honesty (Non-Negotiable)

| Rule | Behavior |
|---|---|
| Sandbox / missing live env keys | Cap at `PARTIAL_ALIVE` even if the agent subprocess exited 0 |
| Evidence / twin parity not verified | Cap at `UNVERIFIED` |
| Prior frontier standing `PARTIAL_ALIVE` \| `UNVERIFIED` | Must not record `ALIVE` (`STANDING_PROMOTION_REFUSED`) |
| Aggregate cycle standing | `ALIVE` iff every child is `ALIVE`; else the weakest honest standing wins |
| Exit codes on receipt | `0` = aggregate `ALIVE`; `1` = refused/blocked; `2` = partial/unverified/config |

### D.6 Compiler-First Transition Gate

When `candidate.requiresIgniterCleanRoom === true`:

1. Run `mix ggen_igniter.sync` (cwd = workspace).
2. Assert `git diff --exit-code == 0`.
3. Optionally run `candidate.verifyCmd`.
4. On failure → transition `REFUSED` with detail; do **not** append `ALIVE`.

Agent prompts for such work orders MUST instruct mutation of upstream `.ttl` / `.eex` / `.tera` only — never compiler-emitted trees that `ggen_igniter.sync` overwrites.

### D.7 Optional TOML Hook

```toml
[io.sjira]
# All keys optional. Adapter inactive unless a script/CLI enables it.
# ggen_bin is also readable from env GGEN_BIN (absolute only).
# candidates_path = "candidates.jsonl"   # SJIRA_CANDIDATES
# ledger_path = "ledger.jsonl"           # SJIRA_LEDGER
# out_dir = "sjira-out"                  # SJIRA_OUT_DIR
```

### D.8 Verification

```bash
bun test test/sjira-adapter.test.ts
```

Falsifiers covered: PATH fallback, relative `GGEN_BIN`, cyclic `dependsOn`, dirty igniter tree, `PARTIAL_ALIVE`→`ALIVE` promotion, aggregate exit-code honesty.

### D.9 Explore Milestone Hook

Treat Appendix D as **E4.1** (optional): lands beside E4 OCEL/autonomic loop. Does not gate E1–E3. Promotion toward always-on default requires Exp-4-style evidence that frontier-driven POWLs reduce manual authoring without increasing standing-promotion incidents.

## Appendix E — Pluggable Adapter Courts (`src/adapters/*`) `[EXPLORE-SCOPE]`

### E.1 Design Rule

`zcode-cli` **authority ceiling is `CONSTRUCT`**. Protected DO (Seat AS-01 / BRCE WebAuthn seals, live treasury actuation) is never held by this process. Ecosystem-specific rules (sjira frontier I/O, marketplace qualification, igniter clean-room, castle publish redaction) are isolated behind four adapters. Core remains `PowlNode` + AIMD + OCEL only.

```text
WorkOrderSourceAdapter.ingestFrontier() ──► POWL PartialOrder
        │
        ▼
TransitionCourtAdapter.validateWriteScope(files)   [pre]
        │
        ▼
executeWorkflowNet / bin/zcode.js                  [CONSTRUCT only]
        │
        ▼
TransitionCourtAdapter.verifyPostTransition(cwd)   [post]
        │
        ▼
WorkOrderSourceAdapter.recordOutcome + ReceiptSink [honest standing]
```

### E.2 Exact Plugin Types (`src/adapters/types.ts`)

```typescript
export type ExitCode = 0 | 1 | 2 | 3; // PASS | FAIL_REFUSED | SUBJECT_MISSING | LOUD_SKIP
export type Standing =
  | "ALIVE" | "PARTIAL_ALIVE" | "REFUSED" | "BLOCKED" | "UNVERIFIED"
  | "TIMED_OUT" | "UNKNOWN" | "UNSUPPORTED";

export interface WorkOrderSourceAdapter {
  readonly name: string;
  preflightVerify(): Promise<PreflightResult>;
  ingestFrontier(): Promise<PowlNode>;
  recordOutcome(receipt: TransitionReceipt): Promise<void>;
}

export interface TransitionCourtAdapter {
  readonly name: string;
  validateWriteScope(files: string[]): Promise<ExitCode>;
  verifyPostTransition(workspaceDir: string): Promise<CourtVerdict>;
}
```

### E.3 Adapter Modules

| Module | Role | Hard rules |
|---|---|---|
| `src/adapters/sjira-io.ts` | Frontier ingress + ledger egress | Absolute `GGEN_BIN` (no PATH); ban `--authority` / TTY prompts; optional hands-free ancestor `fd4f99bbd…`; JSONL → `PartialOrder` |
| `src/adapters/marketplace-court.ts` | Pack qualification | Minimal `pack.toml` keys; refuse `ASK` gates; public-ontology scan; `marketplace.py check` ×2 identical digests; refuse consumer `[packs.*]` (FM-CONFIG-101) |
| `src/adapters/igniter-sync.ts` | Compiler-first clean-room | Allowlist mutation globs (`.ttl`/`.rq`/`.eex`/`.tera`); `rm -rf` generated trees + sync + `git diff --exit-code`; forbid `generated/` dirs; forbid domain wall-clock |
| `src/adapters/receipt-sink.ts` | Honest standing + dual receipt | Exit taxonomy 0/1/2/3; never promote sandbox → ALIVE; `ledger.jsonl` + `loop_receipt.json` + optional DFCM (5 Chatman fields @ HEAD) |
| `src/adapters/castle-publish.ts` | Optional publish redaction court | Require `--public-anonymize` on linkedin/gatekeeper targets; loud skip (exit 3) when argv unset |

`src/io/sjira-adapter.ts` remains the JSONL/POWL primitive library; `SjiraWorkOrderSource` wraps it behind `WorkOrderSourceAdapter`.

### E.4 TOML Hook (`zcode-cli.toml`)

```toml
[engine]
mode = "explore"                 # explore | exploit
authority_ceiling = "CONSTRUCT"  # hard lock — never DO
max_remediation_attempts = 3

[adapters.sjira]
enabled = true
ggen_bin_env = "GGEN_BIN"
min_ggen_ancestor = "fd4f99bbd4971fb1ca5a0f3a3a2382aaba32261e"
candidates_env = "SJIRA_CANDIDATES"
ledger_env = "SJIRA_LEDGER"
out_dir_env = "SJIRA_OUT_DIR"
forbid_tty_prompts = true
enforce_twin_parity = true

[adapters.ggen_marketplace]
enabled = true
enforce_pack_toml_minimal = true
forbid_ask_queries_in_gates = true
require_double_capsule_check = true
forbid_consumer_packs_table = true

[adapters.ggen_igniter]
enabled = true
allowed_mutation_globs = ["ontology/**/*.ttl", "queries/**/*.rq", "templates/**/*.eex", "templates/**/*.tera"]
clean_room_sync_cmd = ["mix", "ggen_igniter.sync", "--yes"]
require_git_diff_zero = true
forbid_generated_dirs = true

[adapters.castle_publish]
enabled = false
require_public_anonymize_on = ["linkedin-carousel", "linkedin-newsletter", "linkedin-post", "gatekeeper-pack"]
```

### E.5 Anti-Fake-ALIVE & Exit Taxonomy

| Exit | Meaning |
|---|---|
| `0` | PASS / aggregate `ALIVE` |
| `1` | FAIL / `REFUSED` |
| `2` | SUBJECT MISSING / `BLOCKED` / honest `PARTIAL_ALIVE` |
| `3` | LOUD SKIP / `UNVERIFIED` when evidence suite absent |

Sandbox (`sjira-loop-live-sandbox`), missing `INTERNAL_API_TOKEN` / verifier suite / AS-01 DO seals → **never** narrate as live fabric `ALIVE`.

### E.6 Verification

```bash
bun test test/adapters.test.ts test/sjira-adapter.test.ts
```

### E.7 Milestone

Appendix E is **E4.2** (optional courts). Day-1 Explore enables `sjira-io` + `marketplace-court` + `igniter-sync` + `receipt-sink`. `castle_publish` stays opt-in. Domain pipelines (LinkedIn carousels, revops airlock, RAID commissioning) are **operator workflows** that consume these adapters — they are not compiled into the clean-room core.

---

**End of ZCODE-CLI-SPEC-26.11.20**

This document is the normative Unified ARD/PRD for clean-room Explore → Exploit implementation. Any README or script that contradicts §4 (conformance honesty) or §5 (transport-aware AIMD) is non-normative until updated to match this specification. Optional I/O adapters (Appendices D–E) must preserve the clean-room core boundary and the CONSTRUCT authority ceiling.

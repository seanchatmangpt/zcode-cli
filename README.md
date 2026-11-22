# zcode-cli — Object-Centric Process-Mined Z.AI Code Agent Runtime

> **Maximum Z.AI agent utilization through formal process science — not ad-hoc scripts or hardcoded concurrency.**

`zcode-cli` is a terminal runtime, Claude Code-compatible CLI launcher, and **autonomic POWL v2 + OCEL 2.0 workflow engine** for Z.AI coding agents. Built from first principles on the process-mining foundations of **Prof. Wil van der Aalst, Humam Kourani, Alessandro Berti, et al.** (Object-Centric Event Logs, Partially Ordered Workflow Language, Workflow-Net Soundness, and Token-Based Replay), `zcode-cli` treats multi-agent software engineering as a **measurable, sound, self-regulating industrial process** rather than an uncontrolled burst of parallel prompts.

---

## 1. First Principles: Why Ad-Hoc Agent Concurrency Fails

Running coding agents with fixed thread pools (`--concurrency 20`) or flat task lists fails for three structural reasons well-known in process science:

1. **Unsound Orchestration (Deadlocks & Cascade Failures):** Flat scripts fire downstream tasks before upstream contracts exist, or continue burning tokens after a foundational artifact fails.
2. **Static Concurrency Ignores Little's Law ($L = \lambda W$):** Hardcoding `N` workers either under-utilizes the Z.AI API or saturates `api.z.ai:443` with simultaneous handshakes (`UND_ERR_CONNECT_TIMEOUT` / `429`), collapsing effective throughput $\lambda$ to zero.
3. **Zero Process Telemetry (No Feedback Loop):** Without an **Object-Centric Event Log (OCEL 2.0)** linking events to artifacts, workflows, and stages (`E2O` and `O2O`), an orchestrator cannot measure service times, detect bottlenecks, score schedule-completion heuristics, or synthesize follow-up work when the queue drains.

---

## 2. The Van der Aalst Architecture for Maximum Z.AI Utilization

`zcode-cli` closes the loop between **Process Modeling (POWL v2)**, **Sound Execution (Workflow-Net Token Replay)**, **Object-Centric Telemetry (OCEL 2.0)**, and **Autonomic Equilibrium Control (AIMD)**:

```text
                  ┌──────────────────────────────────────────┐
                  │   POWL v2 Recursive Process Tree         │
                  │   Activity | Tau | Xor | Loop | PO(V,≺)  │
                  │        (Sound by Construction)           │
                  └────────────────────┬─────────────────────┘
                                       │ compilePowlToWorkflowNet()
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   Sound Workflow Net (Petri Net)         │
                  │   (Places P, Transitions T, Marking M)   │
                  └────────────────────┬─────────────────────┘
                                       │ Token-Based Replay (∀p ∈ •t: M(p) ≥ 1)
                                       ▼
┌──────────────────────────────┐     ┌───────────────────────────────────────┐
│ Autonomic AIMD WIP Controller│◄────┤ Z.AI Agent Transitions (zcode.js)     │
│ • Slow-start (WIP = 1)       │     │ • Claude Code CLI parity flags        │
│ • Clean completion -> WIP+1  │     │ • Transport timeout -> return token   │
│ • Timeout / spike -> WIP/2   │     │   to input place (m = 0 preserved)    │
│ • Zero hardcoded limits      │     └──────────────────┬────────────────────┘
└──────────────────────────────┘                        │
                                                        ▼
                  ┌──────────────────────────────────────────┐
                  │   IEEE OCEL 2.0 Log + Completion Court   │
                  │   • E2O & O2O relationships              │
                  │   • Dynamic timestamped standing         │
                  │   • Schedule fitness (completion heuris- │
                  │     tic — not behavioral conformance)    │
                  │   • Optional external OCEL validator hook│
                  └────────────────────┬─────────────────────┘
                                       │ deriveFollowUpPowl(R_t)
                                       ▼
                  ┌──────────────────────────────────────────┐
                  │   Never-Empty Autonomic Queue            │
                  │   • REFUSED / f < 1 -> Remediation POWL  │
                  │   • Bottleneck > 2x -> Optimization POWL │
                  │   • All ALIVE -> Mutation & Drift POWL   │
                  └──────────────────────────────────────────┘
```

### Core Formalisms

| Mechanism | Formal Basis | Operational Effect on Z.AI Utilization |
|---|---|---|
| **POWL v2 AST & WF-Net Compiler** (`src/powl-ocel-orchestrator.ts`) | Kourani & van der Aalst (2023); Van der Aalst Soundness Theorem; Murata (1989) | Recursive `Activity`, `Tau`, `Xor`, `Loop(do, redo)`, and strict `PartialOrder(V, ≺)` with recursive write-scope validation, Hasse transitive reduction, and Murata WF-net reductions — compiled into sound Petri Nets `(P, T, pre, post, sourcePlace, sinkPlace)` free of deadlocks and livelocks. |
| **Token Replay & Optimal $A^*$ Alignment** (`src/powl-ocel-orchestrator.ts`, `src/compliance/conformance.ts`) | Token-based replay + Optimal $A^*$ alignment with marking-equation LP heuristic & $\tau^*$-closure Align-ETC precision | Transitions fire strictly when input places hold tokens (`M(p) ≥ 1`); logic refusals halt fail-closed while transient transport timeouts return tokens (`m = 0`). Behavioral conformance and precision are computed via optimal $A^*$ alignment and Align-ETC. |
| **OCPN & OC-DFG Discovery** (`src/compliance/ocpn.ts`, `src/compliance/ocel-discover.ts`) | Inductive Miner OCPN; van der Aalst & Berti OC-DFG | Discovers Object-Centric Petri Nets with variable-arc & synchronization replay semantics and bounded marking-graph soundness; OC-DFG separates convergence/divergence/synchronization with UO `objectCount` and noise filtering. |
| **Autonomic AIMD & Kingman Scheduling** (`AimdWipController`, `src/compliance/kingman-scheduler.ts`) | AIMD feedback + Multi-server $G/G/c$ Kingman (Sakasegawa/Allen-Cunneen) queueing approximation | Starts at `WIP = 1`, probes upward (`+1`) on clean completions, backs off (`×0.5`) on transport signals (`429`, connect timeout, TTFT spike), and models multi-server queueing delay without hardcoded concurrency knobs. |
| **Bounded Transactional Nets** (`src/compliance/transactional-net.ts`) | Transactional WF-nets + Saga LIFO compensation | Enforces bounded execution with silent-cycle detection and deterministic Saga LIFO rollback on failure. |
| **IEEE OCEL 2.0 Telemetry & Retention** (`src/compliance/ocel2.ts`, `src/compliance/ocel-sqlite.ts`) | IEEE OCEL 2.0 (Berti, Koren, van der Aalst et al., 2024) | Strict attribute validation, XML/SQLite round-trip, `E2O`/`O2O` relations, timestamped `standing` transitions, and event-time 180-day retention with a SHA-256 purge ledger (`retention-purge-ledger.ndjson`). |
| **Closed-Loop Foundry & Follow-Up Synthesis** (`runAutonomicLoop`, `src/foundry-cli.ts`) | Closed-Loop Recursion ($R_t \to O^*_{t+1}$) + Chatman-5 DFCM receipts | `zcode foundry` and `deriveFollowUpPowl()` close the loop from receipts to next-cycle work orders (remediation, bottleneck optimization, or anti-vacuity mutation + drift audit). |

---

## 3. EU AI Act (8/1/26) Compliance & Oversight

`zcode-cli` ships a built-in EU AI Act compliance suite (`src/compliance/`, `src/compliance-cli.ts`) grounded in formal RDF/SHACL ontologies (`ontology/eu-ai-act.ttl`, `ontology/eu-ai-act.shapes.ttl`, `ontology/airo_risk_description.ttl`) covering **Articles 9, 10, 11, 12, 13, 14, 15, 17, 26, 27, 43, 47, 50, 72, and 73**:

- **Art. 14 Human Oversight (`src/compliance/oversight.ts`):** TUI `PermissionPreview` oversight with a `min_review_ms` dwell guard and `AutomationBiasMonitor` to detect rubber-stamping.
- **Art. 50(2) Provenance & Disclosure (`src/compliance/disclosure.ts`):** Runtime Markdown provenance headers and `.zcode-provenance/` sidecar sealing for generated artifacts.
- **Art. 12 Record-Keeping & Retention (`src/compliance/ocel2.ts`, `src/compliance/ocel-sqlite.ts`):** Strict IEEE OCEL 2.0 logs with XML/SQLite round-trip and event-time 180-day retention backed by `retention-purge-ledger.ndjson`.
- **Conformity, Risk & Post-Market Monitoring:** Annex IV dossier compilation (`annex-iv-report.ts`), QMS/FRIA/EU Declaration of Conformity (`qms-conformity.ts`), risk ledger (`risk-ledger.ts`), concept-drift detection (`concept-drift.ts`), and PMM/incident reporting (`pmm-incident.ts`).

---

## 4. Claude Code Agent Parity

`zcode-cli` provides drop-in CLI parity for headless coding-agent workflows (`src/claude-parity.ts`, `src/max-turns.ts`, `src/launcher.ts`):

- `-p`, `--prompt <text>` and `--print <prompt>` — headless single-prompt execution
- `--dangerously-skip-permissions` — maps to `--mode yolo`
- `--permission-mode <default|plan|acceptEdits|bypassPermissions|dontAsk|build|edit|yolo>` — maps to native `--mode`
- `--max-turns <N>` — enforced in the runtime turn loop (`ZCODE_MAX_TURNS`)
- `--disallowedTools` / `--disallowed-tools <tools...>` — per-run tool restriction
- `-c` / `--continue`, `--resume <sessionId>` — session continuation
- `--output-format <format>`, `--json`, `--cwd <path>`, `--attach <path>`
- `ZCODE_OCEL=1` — streams runtime output through the credential-redacted OCEL tap (`src/ocel-tap.ts`)

---

## 5. Quick Start & Verification

### Install & Build

```bash
bun install
bun run build
bun run check
```

### Run the Autonomic POWL v2 + OCEL 2.0 Workflow

Workspace paths are configured in `zcode-cli.toml` (no concurrency or WIP knobs):

```bash
# Dry-run soundness & token-replay verification (bounded: 2 cycles; repo-relative .tmp output)
bun scripts/powl-ecosystem-workflow.ts --dry-run

# Live autonomic Z.AI execution (bounded: 1 cycle by default)
# Paths: --castle-dir / ZCODE_CASTLE_DIR / zcode-cli.toml [paths].castle_dir
# Unbounded soak requires an explicit --soak (or --max-cycles N)
bun scripts/powl-ecosystem-workflow.ts --castle-dir "$CASTLE_DIR"
```

### Verification Suite (Chicago-Style, Zero-Mock)

```bash
# Typecheck
bun run typecheck

# Claude Code CLI parity + POWL/OCEL unit tests
bun test test/claude-parity.test.ts test/powl-ocel-orchestrator.test.ts

# Chicago-style tests (real bin/zcode.js subprocesses, real filesystem, SHA-256 receipt recomputation, anti-vacuity)
bun test test/powl-ocel-chicago.test.ts
```

---

## 6. Architecture & Repository Layout

- `bin/zcode.ts` → `bin/zcode.js` — Node.js (`>= 22.19.0`) launcher with inherited stdio (no second PTY)
- `src/powl-ocel-orchestrator.ts` — POWL v2 AST (write-scope validation, Hasse reduction, Murata WF-net reductions), Token-Based Replay, AIMD equilibrium controller, OCEL 2.0 emitter, and `runAutonomicLoop`
- `src/compliance/` & `src/compliance-cli.ts` — EU AI Act (8/1/26) suite (Arts. 9–15, 17, 26–27, 43, 47, 50, 72–73), optimal $A^*$ alignment + Align-ETC, Inductive Miner OCPN, OC-DFG discovery, strict OCEL 2.0 XML/SQLite + 180-day purge ledger, $G/G/c$ Kingman scheduler, bounded transactional nets, Art. 14 oversight, and Art. 50(2) provenance sealing
- `src/foundry-cli.ts` — closed-loop `zcode foundry` (`R_t -> O*_{t+1}`) and Chatman-5 DFCM receipts
- `ontology/` — canonical RDF/SHACL ontologies (`zcode-loop.ttl`, `eu-ai-act.ttl`, `eu-ai-act.shapes.ttl`, `airo_risk_description.ttl`)
- `src/claude-parity.ts` — Claude Code CLI flag normalization
- `src/launcher.ts`, `src/max-turns.ts`, `src/ocel-tap.ts`, `src/gall-work.ts` — runtime bootstrap, turn caps, OCEL tap, and lease lifecycle
- `packages/zcode-tui/` — `@zcode/tui` built on `@earendil-works/pi-tui`
- `scripts/powl-castle-workflow.ts`, `scripts/powl-ecosystem-workflow.ts` — executable POWL v2 workflows
- `zcode-cli.toml` — substrate workspace paths (`castle_dir`, `wasm4pm_dir`, `wasm4pm_compat_dir`)

---

## License

`zcode-cli` source code is MIT licensed. Bundled upstream ZCode runtime artifacts retain their respective licenses (see `LICENSES/` and `docs/THIRD_PARTY_CONTENT.md`).

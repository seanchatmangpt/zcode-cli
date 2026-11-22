# v26.11.20 — Clean-Room Explore → Exploit

Calendar wave for **`ZCODE-CLI-SPEC-26.11.20`**: Experimentation-Through-Implementation of a standalone Object-Centric Process-Mined Coding Agent Runtime (POWL v2 + OCEL 2.0 + transport-aware AIMD).

## Canonical specification

| Document | Path |
|---|---|
| **Unified ARD/PRD (normative)** | [`ard/ZCODE-CLI-SPEC-26.11.20.md`](./ard/ZCODE-CLI-SPEC-26.11.20.md) |
| PRD pointer | [`prd/ZCODE-CLI-SPEC-26.11.20.md`](./prd/ZCODE-CLI-SPEC-26.11.20.md) |

## Implementation status (honesty)

Path-exact Explore/Exploit traceability against §2.2 / §9.1.1 / §10 is **incomplete** as of the C4 EU AI Act prep pass (`REQUEST_CHANGES`): core split modules (`powl-ast`, `wf-net`, `aimd-controller`, `ocel-emitter`, `ocel-validator`, `conformance`, `lease-manager`) are not yet at their specified paths (temporary monolith credit under SPEC §2.2.1 only); Exploit X1–X4 are **0/4**. Treat the Unified ARD/PRD as the target contract, not as a claim that every path already exists on `main`.

## Release modes

| Mode | Meaning |
|---|---|
| `v26.11.20-explore` | Milestones E1–E4: runnable runtime + honest telemetry + Exp-1..4 |
| `v26.11.20-exploit` | Milestones X1–X4: transactional nets, A* alignment, dual-constraint AIMD, OC-DFG discovery |

## Clean-room rule

This wave’s normative docs mandate **zero** coupling of the **core** runtime to external proprietary ecosystems or hardcoded third-party workspace paths. Configuration is self-contained in `zcode-cli.toml` (schema in the Unified ARD/PRD §8.3).

## Optional I/O seam (Appendices D–E)

| Artifact | Path |
|---|---|
| JSONL/POWL primitives | [`src/io/sjira-adapter.ts`](../../../src/io/sjira-adapter.ts) |
| Plugin courts | [`src/adapters/`](../../../src/adapters/) (`sjira-io`, `marketplace-court`, `igniter-sync`, `receipt-sink`, `castle-publish`, `ui-layout-court`) |
| Tests | [`test/sjira-adapter.test.ts`](../../../test/sjira-adapter.test.ts), [`test/adapters.test.ts`](../../../test/adapters.test.ts), [`test/ui-layout-court.test.ts`](../../../test/ui-layout-court.test.ts) |
| Spec | Unified ARD/PRD **Appendix D** + **Appendix E** (incl. **E.5.1** / **E.8** spatial court) |

Authority ceiling remains **CONSTRUCT**. Adapters map frontier JSONL → POWL, enforce marketplace/igniter/ui-layout courts, and emit honest `PARTIAL_ALIVE` / `UNVERIFIED` / `BLOCKED` receipts — never fake live `ALIVE`. Spatial defects refuse with exit `1` and remediation capped at `max_remediation_attempts = 3`; anti-vacuity mutations (360-in-320 / 18px) must flip the court before pack `ALIVE`.

## Gall's Law spine (Appendix F)

| Artifact | Path |
|---|---|
| `runFoundryLoop` | [`src/adapters/foundry-loop.ts`](../../../src/adapters/foundry-loop.ts) |
| Dry-run driver | [`scripts/powl-foundry-loop.ts`](../../../scripts/powl-foundry-loop.ts) |
| Chicago court | [`test/adapters-chicago.test.ts`](../../../test/adapters-chicago.test.ts) |

```bash
bun test test/adapters-chicago.test.ts
bun scripts/powl-foundry-loop.ts --dry-run
```

Complex ecosystem planes evolve **from** this simple working loop — they do not redesign the core.

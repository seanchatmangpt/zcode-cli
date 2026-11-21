# v26.11.20 — Clean-Room Explore → Exploit

Calendar wave for **`ZCODE-CLI-SPEC-26.11.20`**: Experimentation-Through-Implementation of a standalone Object-Centric Process-Mined Coding Agent Runtime (POWL v2 + OCEL 2.0 + transport-aware AIMD).

## Canonical specification

| Document | Path |
|---|---|
| **Unified ARD/PRD (normative)** | [`ard/ZCODE-CLI-SPEC-26.11.20.md`](./ard/ZCODE-CLI-SPEC-26.11.20.md) |
| PRD pointer | [`prd/ZCODE-CLI-SPEC-26.11.20.md`](./prd/ZCODE-CLI-SPEC-26.11.20.md) |

## Release modes

| Mode | Meaning |
|---|---|
| `v26.11.20-explore` | Milestones E1–E4: runnable runtime + honest telemetry + Exp-1..4 |
| `v26.11.20-exploit` | Milestones X1–X4: transactional nets, A* alignment, dual-constraint AIMD, OC-DFG discovery |

## Clean-room rule

This wave’s normative docs mandate **zero** coupling of the **core** runtime to external proprietary ecosystems or hardcoded third-party workspace paths. Configuration is self-contained in `zcode-cli.toml` (schema in the Unified ARD/PRD §8.3).

## Optional I/O seam (Appendix D)

| Artifact | Path |
|---|---|
| `SjiraIoAdapter` | [`src/io/sjira-adapter.ts`](../../../src/io/sjira-adapter.ts) |
| Tests | [`test/sjira-adapter.test.ts`](../../../test/sjira-adapter.test.ts) |
| Spec | Unified ARD/PRD **Appendix D** |

Maps `SJIRA_CANDIDATES` / `"$GGEN_BIN" sjira frontier` → POWL `PartialOrder`, enforces optional `mix ggen_igniter.sync && git diff --exit-code`, and emits `ledger.jsonl` + `loop_receipt.json` with honest `PARTIAL_ALIVE` / `UNVERIFIED` standing (never promoted to `ALIVE`).

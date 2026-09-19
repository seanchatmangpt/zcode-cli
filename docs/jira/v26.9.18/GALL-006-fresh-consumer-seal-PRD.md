# PRD v26.9.18 — GALL-006: Fresh Consumer Seal

**Status:** DRAFT IMPLEMENTATION SPEC
**Release:** v26.9.18
**Repository:** `seanchatmangpt/zcode-cli`
**Owner:** zcode-cli
**Dependencies:** GALL-005
**Authority ceiling:** consume/inspect/reconstruct only

## Product outcome

A clean zcode process reconstructs the same bounded GALL-005 standing solely from the released artifact bundle through a supported public interface, with zero external DO.

## Problem

Gate 11 is unproven if standing depends on producer memory, hidden session state, private runtime internals or re-actuation.

## Functional requirements

1. Prefer documented host/subprocess contract; then public subcommand/Skill/command; then MCP/Plugin.
2. Isolate HOME, workspace, config, session, plugin/MCP fixture state and temporary artifacts.
3. Producer must be terminated before fresh consumer execution.
4. Recompute composition/artifact digests independently and preserve upstream evidence ceiling.
5. Emit `UNSUPPORTED(public-consumer-interface)` if private runtime imports are the only path.
6. Record external_do_count and require it to remain zero.

## Acceptance criteria

1. Producer absent before consumer start.
2. Real zcode subprocess consumes only explicit GALL-005 bundle.
3. Tampered/missing/stale artifacts refuse.
4. Isolated HOME prevents hidden answer recovery.
5. Same composition digest and bounded standing reconstructed.
6. Gate 11 PASS scoped to exact composition digest; external_do_count=0.

## Evidence product

The checkpoint MUST emit a content-addressed machine-readable receipt/artifact binding exact producer SHA, input/predecessor identities, executed court, falsifiers, outputs, standing and evidence ceiling. Source presence or prose is not standing.

## Non-functional requirements

- Deterministic identity for identical admitted inputs.
- Typed UNKNOWN/PARTIAL/REFUSED/BLOCKED states.
- No ambient authority or undeclared dependency.
- Exact-head subject fencing and replayable evidence.
- No promotion of observation, model output, parsing or configuration into stronger standing.

## Definition of done

A clean zcode process reconstructs the same bounded GALL-005 standing solely from the released artifact bundle through a supported public interface, with zero external DO.

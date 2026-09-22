# ARD v26.9.18 — GALL-006: Fresh Consumer Seal

**Status:** DRAFT ARCHITECTURE SPEC
**Release:** v26.9.18
**Repository:** `seanchatmangpt/zcode-cli`
**Owner:** zcode-cli
**Dependencies:** GALL-005
**Authority ceiling:** consume/inspect/reconstruct only

## Architecture objective

A clean zcode process reconstructs the same bounded GALL-005 standing solely from the released artifact bundle through a supported public interface, with zero external DO.

## Components

- `scripts/gall-fresh-consumer.ts` qualification driver
- `test/runtime/gall-fresh-consumer.test.ts` real subprocess court
- documented zcode host/public runtime surface
- isolated filesystem/runtime fixture
- deterministic GALL-006 receipt

## Control/data flow

`GALL-005 bundle -> producer death -> fresh zcode process -> public interface -> independent digest/standing reconstruction -> Gate 11 receipt`

## Invariants

1. Prefer documented host/subprocess contract; then public subcommand/Skill/command; then MCP/Plugin.
2. Isolate HOME, workspace, config, session, plugin/MCP fixture state and temporary artifacts.
3. Producer must be terminated before fresh consumer execution.
4. Recompute composition/artifact digests independently and preserve upstream evidence ceiling.
5. Emit `UNSUPPORTED(public-consumer-interface)` if private runtime imports are the only path.
6. Record external_do_count and require it to remain zero.

## Failure/refusal boundaries

- Private runtime import required => UNSUPPORTED
- Clean isolation impossible => BLOCKED
- Would require re-actuation => REFUSED
- Composition digest mismatch => REFUSED

## Qualification court

- bun run typecheck
- bun test test/runtime/gall-fresh-consumer.test.ts
- bun run test:runtime
- bun run check

## Evidence boundary

Every PASS binds exact producer and predecessor identities. A changed SHA, mapping, model, lockfile, observation projection or runtime subject is a changed subject. A gate is PASS only from observed execution and its required falsifier, never from absence of evidence.

## Authority law

[
Received \neq Admitted,\quad Candidate \neq Authority,\quad SELECT \neq CONSTRUCT \neq DO
]

No component may gain authority merely because it generated, predicted, observed, validated, replayed or parsed something.

## Closure

Architectural closure requires the positive witness plus each named negative witness on the exact v26.9.18 subject.

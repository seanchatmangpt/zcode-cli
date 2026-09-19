# WBPR — GALL-006 Fresh Consumer Seal

**Working-backwards target. This document describes the final fresh-consumer state that must be proven.**

## Headline

**A clean, independent zcode process can reconstruct Semantic A2A standing from public evidence after the producer is gone.**

## Subheadline

GALL-006 closes Chicago Gate 11 by proving the final GALL composition is not secretly dependent on the producer's memory, open handles, local runtime state, private APIs, or a second actuation.

## Announcement

At completion, `zcode-cli` acts as a genuinely fresh consumer:

`GALL-005 artifact -> producer terminated -> clean zcode process -> public supported interface -> same bounded standing`

zcode-cli does not become another authority broker or Semantic A2A runtime. Its value is separation.

## Customer problem

A replay can look deterministic while depending on invisible state:

- in-memory producer objects;
- open file descriptors;
- temp files;
- process-local caches;
- workspace leftovers;
- undocumented runtime internals;
- session objects that never crossed a public interface.

Such a system has not manufactured portable machine evidence. It has manufactured a checkpoint that only its producer can understand.

## Product

GALL-006 proves that a second real runtime can consume the released evidence through an admitted public boundary.

Eligible paths include an already-supported:

- plugin;
- MCP;
- skill;
- host/subprocess contract;
- documented CLI/runtime data surface.

The checkpoint refuses a private-runtime shortcut.

If no public interface can carry the evidence, the correct release result is:

`UNSUPPORTED(public-consumer-interface)`

That boundary is information, not failure to be hidden.

## Customer experience

The producer runs and exits.

A clean zcode process starts later.

It receives only the admitted artifact/receipts.

It validates the exact composition identity and reconstructs the same bounded standing.

It does not perform the external consequence again.

## Core invariants

`FreshConsumerProof => ProducerTerminated && NoHiddenProducerState`

`ReplayInspection => ExternalDOCount = 0`

`ParsingSuccess != ALIVE`

`PrivateRuntimeShortcut => REFUSED/UNSUPPORTED`

## Release proof

The release requires:

1. the producer/court process is terminated;
2. zcode starts in a clean process/session;
3. the artifact crosses a documented public interface;
4. all required exact identities are recomputed/validated;
5. no missing field is silently recovered from workspace/session state;
6. stale composition/receipt identity is refused;
7. the same bounded standing is reconstructed;
8. no external consequence occurs during replay/inspection;
9. the receipt proves the artifact was actually consumed.

## Chicago relation

GALL-006 is the Gate 11 closure needed by the final Chicago crown.

Once GALL-005 and GALL-006 refer to the same immutable composition subject, a separate standing issuer has the evidence required to decide final cross-repository conformance.

## Non-claims

The fresh consumer does not:

- re-prove the original external consequence by acting again;
- gain CommandBus/BRCE authority;
- create a private SA2A ontology;
- treat successful JSON parsing as conformance;
- patch undocumented private runtime structures merely to pass the test.

## Release receipt

The receipt binds:

- zcode exact head/runtime identity;
- Node/Bun/toolchain identity;
- public consumption interface;
- exact GALL-005 composition digest;
- upstream receipt digests;
- clean-process witness;
- reconstructed standing;
- zero external-DO witness;
- falsifiers attempted/survived.

## Working-backwards definition of done

The original producer can disappear and the released evidence still speaks for itself.

That is the final portability test:

**standing survives process death; authority does not leak with it.**

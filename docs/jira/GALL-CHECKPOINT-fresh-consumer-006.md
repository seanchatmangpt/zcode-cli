# GALL Checkpoint 006 — Fresh Consumer Seal

Status: DRAFT IMPLEMENTATION CONTRACT
Repository: `seanchatmangpt/zcode-cli`
Exact admitted base: `84b4edce2cbe161b3d079e6ca0de67820d6beb38`
Branch: `gall/checkpoint-006-fresh-consumer`
Owner surface: public fresh-consumer reconstruction only
Authority ceiling: consume/inspect/reconstruct; no new SA2A execution authority

## Purpose

Chicago Gate 11 requires a fresh consumer to reconstruct standing without hidden producer process state. `zcode-cli` is useful precisely because it is not an SA2A implementation: it provides a real separate process/runtime with public plugin, MCP, skill, subprocess, and headless interaction surfaces.

This checkpoint MUST NOT turn zcode-cli into a private SA2A authority engine.

## Required transition

`finalized upstream checkpoint artifact/receipt -> producer terminated -> clean zcode process -> public supported interface -> receipt/standing reconstruction -> no external DO`

## Admission rule

The implementation MUST first discover an existing public interface capable of consuming the checkpoint artifact:

1. existing plugin/MCP/skill contract;
2. existing documented host/subprocess interface;
3. existing public CLI/runtime data surface.

If no public interface can carry the required artifact without patching private upstream runtime internals, the correct result is `UNSUPPORTED(public-consumer-interface)` and that exact missing interface becomes the next bounded design task.

Private runtime patching is not accepted merely to make this checkpoint green.

## Required implementation when a public path exists

1. Define a machine-readable input carrying the exact GALL-005 composition identity and final receipts needed for reconstruction.
2. Terminate the producer/court process before the consumer run.
3. Start a clean zcode process/session with no producer in-memory state, open handles, or hidden temp fixtures.
4. Consume the artifact only through the admitted public surface.
5. Recompute/validate the identities necessary to reconstruct the reported standing.
6. Report the standing and evidence ceiling without acquiring authority to re-actuate the consequence.
7. Prove replay/inspection cannot cause a second external DO.

## Positive witness

A clean headless zcode process consumes the admitted checkpoint artifact, resolves all required public identities, reconstructs the same bounded standing, and exits successfully without invoking consequence-bearing authority.

## Falsifiers

- leave the producer process alive and depend on its memory/open file descriptors;
- omit one required artifact and silently recover it from workspace/session state;
- change the GALL-005 composition SHA/digest and still reconstruct the old standing;
- consume an old receipt against a new producer identity;
- require an undocumented private ZCode runtime structure to interpret the artifact;
- trigger external DO during replay/inspection;
- self-promote `UNKNOWN`/`PARTIAL_ALIVE` to `ALIVE` because parsing succeeded;
- report success when the checkpoint artifact was never actually consumed.

## GALL receipt fields

- zcode-cli exact head SHA;
- runtime package/version identity;
- Node/Bun identities used by the court;
- public interface used (plugin/MCP/skill/CLI/host contract);
- GALL-005 composition manifest digest;
- consumed upstream receipt digests;
- clean-state/fresh-process witness;
- reconstructed standing;
- external-DO count witness (must remain zero for consumer replay);
- commands/exits/stdout/stderr digests where practical;
- falsifiers attempted/survived.

## Verification ladder

1. focused unit test for artifact parsing/identity if new local code is required
2. real subprocess/runtime test through the public supported interface
3. `bun run typecheck`
4. relevant `bun test` / `bun run test:runtime` court
5. broader `bun run check` / release checks only as required by the touched surface

Do not force TUI rendering into the claim unless the checkpoint actually depends on TUI behavior.

## Dependencies

Requires the exact GALL-005 composition artifact/receipt.

Feeds the final Chicago standing issuer by closing Gate 11 for that same composition identity.

## Exclusions

- no new authority broker;
- no CommandBus/BRCE implementation;
- no private SA2A ontology;
- no hidden producer state;
- no external consequence;
- no merge/publication claim.

## Definition of done

Either: (A) one exact clean zcode process reconstructs the same bounded standing solely from the admitted public artifact/receipt path with zero external re-actuation, producing a fresh-consumer receipt; or (B) the repository emits a precise `UNSUPPORTED(public-consumer-interface)` boundary naming the missing public contract. No private shortcut is accepted.

Standing on successful completion: `ALIVE` for the exact fresh-consumer reconstruction subject, not for the underlying external consequence itself.

## 2026-09-18 semantic telemetry reconstruction

The fresh-consumer court MUST reconstruct the strengthened upstream evidence distinctions without requiring producer memory or a live producer-side Weaver process.

The consumed GALL-005 artifact may reference:

- exact semantic-registry / Weaver validation evidence;
- beam4pm GALL-004 OCEL/conformance evidence;
- independent postcondition evidence;
- observational semantic consequence profiles.

These MUST remain separate evidence classes. Parsing a Weaver receipt or consequence profile MUST NOT promote it into process proof, postcondition proof, or authority.

The checkpoint fails if reconstruction requires:

- hidden semantic-registry state not bound by the artifact;
- producer process handles or in-memory objects;
- unreproducible local Weaver state;
- re-actuation merely to recover prior standing;
- collapsing telemetry-valid, process-valid, and postcondition-valid into one untyped success flag.

The portable composition subject must carry enough exact identities and digests to reconstruct the bounded claim through the supported public consumer interface.

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

## Implementation specifics — refined 2026-09-18

Current docs-only PR head at this refinement: `2d8fb4888f4d5e0616954e9413dc8fc3966f3bde`.

### Verified public surfaces

The checkpoint starts from public repository/runtime contracts already documented on the admitted base:

- published `zcode` command from `bin/zcode.js`;
- documented host integration in `docs/HOST_INTEGRATION.md`;
- official runtime launched as a real child process with inherited stdio;
- public Plugin, MCP, Skill, command, and headless/subcommand surfaces described in `README.md`;
- package/runtime verification scripts in `package.json`:
  - `bun run check`;
  - `bun run typecheck`;
  - `bun run test:runtime`;
  - `bun run test:all`.
- the current head already has precedent for a Chicago-style **real subprocess + local endpoint** runtime test from the builtin-provider-alias repair.

The fresh-consumer implementation should reuse that real-subprocess testing pattern.

### Public interface decision tree

Attempt interfaces in this order and record which one is selected:

1. **documented host/subprocess contract**
   - preferred because it proves an external clean process and does not require TUI rendering.
2. **public runtime subcommand / Skill / command surface**
   - valid if it can consume the artifact as a file/input without private module imports.
3. **MCP or Plugin surface**
   - valid when already supported by the runtime and the fixture can run locally/deterministically.

If all public paths fail to carry the artifact, emit:

`UNSUPPORTED(public-consumer-interface)`

with the failed interface attempts and exact reason. Do not import private extracted-runtime modules directly merely to finish GALL-006.

### Proposed smallest diff

Preferred implementation files:

```text
scripts/gall-fresh-consumer.ts
test/runtime/gall-fresh-consumer.test.ts
docs/jira/GALL-CHECKPOINT-fresh-consumer-006.md
```

No TUI component change is required unless the selected public interface itself depends on TUI behavior.

`scripts/gall-fresh-consumer.ts` is a **test/qualification driver**, not a second SA2A implementation.

Responsibilities:

1. validate the GALL-005 bundle exists;
2. compute its own SHA-256 of the composition manifest and receipt files;
3. create an isolated temp HOME/workspace/config root;
4. verify the producer PID is absent/not reused;
5. launch the published/local `zcode` command as a real subprocess using the documented host contract;
6. pass only the admitted artifact through the selected public interface;
7. capture structured output;
8. compare reconstructed standing + exact composition identity;
9. record external-DO count == 0;
10. emit a fresh-consumer receipt.

### Clean-state requirements

The test MUST isolate at least:

```text
HOME
working directory
ZCode CLI config/storage directory
session history
plugin/MCP fixture state
temporary artifact directory
```

The consumer MUST NOT inherit:

- producer process environment containing hidden receipt values;
- open file descriptors from the producer;
- producer temp directory except the explicitly copied release bundle;
- prior ZCode session state containing the expected answer.

The test should copy the GALL-005 bundle into a fresh temp directory and pass that path explicitly.

### Test fixture

Input bundle:

```text
gall-composition-manifest.json
machine-experience.json
episode-1-receipt.json
episode-2-receipt.json
gall-005-crown-receipt.json
```

Expected reconstructed output:

```json
{
  "composition_digest": "...",
  "source_standing": "PARTIAL_ALIVE|ALIVE",
  "reconstructed_standing": "PARTIAL_ALIVE|ALIVE",
  "gate_11": "PASS",
  "external_do_count": 0,
  "consumed_artifact_digests": ["..."]
}
```

The consumer may preserve the upstream standing ceiling; it may not upgrade it merely because reconstruction succeeded.

### Required runtime tests

`test/runtime/gall-fresh-consumer.test.ts` MUST include:

1. clean subprocess reconstructs exact composition identity;
2. producer PID/process is absent;
3. missing required artifact refuses;
4. stale/tampered composition digest refuses;
5. hidden workspace/session recovery is impossible under isolated HOME;
6. public interface path is recorded;
7. private runtime import is not required;
8. external DO fixture count remains zero;
9. parsing a Weaver/telemetry receipt does not promote it to postcondition/authority standing;
10. successful reconstruction sets Gate 11 PASS only for the same exact composition digest.

### Exact acceptance commands

```bash
bun run typecheck
bun test test/runtime/gall-fresh-consumer.test.ts
bun run test:runtime
bun run check
```

Run `bun run test:all` if the implementation changes shared launcher/runtime integration used outside the focused qualification path.

Do not require TUI scenario/e2e checks for a headless host-contract implementation that does not touch TUI code.

### GALL-006 receipt

Emit a deterministic JSON receipt containing:

```text
zcode_cli_repo_sha
zcode_runtime_lock_digest
node_version
bun_version
public_interface
gall_005_composition_digest
consumed_artifact_digests[]
fresh_home_digest_or_identity
fresh_workspace_identity
consumer_command
exit_code
reconstructed_standing
gate_11 = PASS
external_do_count = 0
falsifiers_attempted[]
```

Do not include credentials, provider secrets, or private runtime objects.

### Final Chicago handoff

GALL-006 does not issue the overall crown by itself.

It returns Gate 11 evidence to the final standing issuer, which must verify:

- GALL-005 and GALL-006 bind the exact same composition digest;
- GALL-005's Gate 12 evidence remains intact;
- GALL-006 did not re-actuate the consequence.

### Stop conditions

Return `UNSUPPORTED(public-consumer-interface)` rather than expanding the product when:

- only a private extracted-runtime import can parse the artifact;
- the runtime cannot receive an explicit file/artifact through any supported public surface;
- clean isolation cannot prevent reuse of producer/session state;
- reconstructing standing would require executing the original consequence again.

A precise unsupported boundary is a successful qualification result for the purpose of identifying the next required public contract; it is not Gate 11 PASS.

## 2026-09-18 exact-head code review

Reviewed source subject: `b751c6548eb3da410a52395dcfb65effa73a119b`.

### Observed public surfaces

The repository does have real process-isolation and extension seams:

- `requestAppServer` starts a separate app-server process, sends one NDJSON request, bounds output, preserves process/protocol errors, and supports cancellation.
- `pluginProtocolMethods` exposes concrete plugin management/reference methods.
- `PluginReferenceCatalog` exposes enabled plugin skills/MCP servers/subagents by stable plugin identity.
- the TUI skill surface resolves exact/unique skill names and then builds a prompt instructing the model to call the Skill tool.
- runtime patch/tests acknowledge MCP server availability as a real runtime concept.
- `captureCommand` can start an arbitrary child process, but it is a generic shell/process primitive, not proof of a supported zcode semantic-consumer contract.

These are source/test surfaces observed at the reviewed head; no runtime command was executed in this review.

### Current GALL-006 gap

No reviewed source path consumes a GALL-005 composition artifact, verifies its digests/evidence classes, or reconstructs its bounded standing.

The currently enumerated plugin app-server methods are management/reference operations (`configure`, `describe`, `install`, marketplace operations, `overview`, `referenceCatalog`, `update`, `validate`). None is an explicit artifact-execution/reconstruction method.

The skill path is prompt/LLM mediated. It cannot by itself prove the GALL-006 requirement that the same bounded standing is reconstructed without hidden producer memory or equivalent exploratory cognition.

### Interface decision court

Do not prematurely label the whole runtime unsupported: this code review did not exhaust every capability of the vendored/upstream runtime.

The next checkpoint is a **public-interface discovery court**:

1. identify one supported zcode public plugin/MCP/skill/host/CLI method that can receive an immutable GALL-005 artifact or path/digest and return deterministic verification evidence;
2. prove it works in a fresh zcode process with the producer terminated;
3. bind exact artifact bytes/digests and preserve the upstream evidence-class ceilings;
4. prove zero external re-actuation;
5. prove no LLM/exploratory fallback is required for the verification itself.

If no such public method exists after that bounded discovery, set:

`UNSUPPORTED(public-consumer-interface)`.

Do not fake closure by using `captureCommand` to shell out to the producer's verifier while calling that "zcode reconstruction."

### Review standing

- separate app-server transport / plugin discovery seams: `PARTIAL_ALIVE` by source inspection;
- deterministic GALL artifact consumer: `UNKNOWN`;
- GALL-006 fresh-consumer seal: `UNKNOWN` pending the public-interface court.

## Four-hour conversation synthesis — standing console and coder handoff, 2026-09-18

The recent conversations split two responsibilities that must not be conflated:

1. **GALL-006 qualification:** zcode is a fresh, deterministic consumer/standing console.
2. **Post-qualification automation:** zcode can become a front door for sending an admitted semantic work order to the durable XaaS/UltraCode execution plane.

### Phase A — required GALL-006 fresh consumer

The clean zcode process must consume the immutable GALL-005 artifact plus its semantic work-order/checkpoint identity through one supported public interface and reconstruct the same bounded standing without:

- producer memory;
- hidden workspace/runtime state;
- exploratory LLM reasoning;
- skill-prompt interpretation as proof;
- external re-actuation;
- generic shell-out to the producer's own verifier.

TTL/RDF work-order content must be treated as semantic evidence with exact digest/identity, not flattened into prompt text and then "understood" by a model.

### Phase B — coder-agent execution handoff

After Phase A standing is proven, a separate extension may let zcode submit the admitted work-order IRI/digest and exact subject to XaaS/UltraCode through a supported public plugin/MCP/host/CLI boundary.

The durable execution responsibility remains XaaS:

`Run -> Epoch -> AshOban -> EpochReactor -> ConsequenceFence -> Receipt`.

Observed current evidence:

- XaaS PR #45, head `42a9eb00c7cc3e3a8c780e4f1eb8b2b83f7fc8d2`, proved a scoped unattended single-node cycle;
- PR #46, head `683f7c972fb9f9078161c4968f993221961c9e0c`, proved partial ggen_igniter manufacture of Run/Epoch/EpochReactor and disclosed unsupported generator residue;
- PR #51, head `f2b5cd72870d3b9e09582169a58e2d2f509586eb`, carries the current production/delegation repair subject.

Those subjects are context for the handoff, not automatically part of GALL-006 standing. If Phase B is implemented, its exact XaaS subject must be named explicitly.

### zcode is not the hidden executor

The zcode public surface may discover plugins, MCP servers, skills and subagents, but discovery/prompting is not execution authority. The desired future role is:

`semantic ticket -> fresh standing display -> explicit dispatch request -> XaaS durable run -> receipts returned to the semantic graph`.

No Jido/LangGraph/CrewAI dependency is introduced. Generic agent-framework loops remain competitive-intelligence material only.

### Unsupported boundary remains valid

If the bounded interface-discovery court still finds no supported public method capable of deterministic artifact consumption, GALL-006 remains `UNSUPPORTED(public-consumer-interface)`. The new coder-agent vision does not weaken that refusal boundary.

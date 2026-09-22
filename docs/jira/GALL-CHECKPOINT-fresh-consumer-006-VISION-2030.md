# Vision 2030 — zcode-cli as the Human / Machine Standing Console

> **Design horizon, not prediction.**
>
> By 2030, a terminal AI interface is valuable only if it can interact with machine evidence without becoming another hidden source of authority. zcode-cli becomes a portable human/machine console over public semantic interfaces, receipts, standing, and fresh-consumer reconstruction.

## 1. Thesis

By 2030, `zcode-cli` is a **standing-aware terminal console** for the semantic enterprise.

It can help a human or agent:

- inspect admitted subjects;
- discover capabilities;
- consume receipts;
- reconstruct standing;
- invoke public interfaces;
- request lawful work;
- observe refusal;
- understand evidence ceilings.

It does not become the authority source merely because the user is interacting through it.

## 2. Why the terminal still matters

Abundant automation does not remove the need for a precise operator surface.

It increases the need for one.

Humans still need to answer:

- What exactly is this machine claiming?
- What evidence supports it?
- Which repository/version produced it?
- What authority would this command require?
- What would change?
- What was refused?
- Can another clean process reconstruct this claim?

zcode-cli becomes the compact operational lens over those questions.

## 3. Public interfaces only

By 2030, zcode-cli participates through public contracts:

- MCP;
- A2A;
- skills;
- plugins;
- subprocess/host APIs;
- semantic receipt formats;
- standard event/evidence surfaces.

A private runtime object is not an integration contract.

The GALL-006 rule remains:

[
NoPublicInterface
Rightarrow
UNSUPPORTED
]

rather than hidden coupling.

## 4. Fresh-consumer architecture

A standing claim is portable only when it survives producer death.

The 2030 test:

[
ProducerTerminates
]

then:

[
Artifact + Receipt
ightarrow
FreshZcodeProcess
ightarrow
SameBoundedStanding
]

with:

[
ExternalDOCount=0
]

during reconstruction.

This makes zcode-cli a standing verifier rather than a replay actuator.

## 5. Standing-native UX

By 2030, every machine claim presented through the CLI carries explicit standing:

- UNKNOWN;
- PARTIAL_ALIVE;
- ALIVE;
- BLOCKED;
- BUILD_BROKEN;
- UNSUPPORTED;
- REFUSED_*.

The interface never collapses:

- source presence;
- successful parsing;
- workflow existence;
- local execution;
- hosted CI;
- deployment;
- publication;

into one generic green check.

Evidence ceiling becomes a first-class UX concept.

## 6. Semantic command surface

The user can express intent naturally or structurally.

zcode-cli resolves that intent into semantic capability requests.

The user sees:

- selected semantic subject;
- candidate capability;
- required authority;
- expected consequence class;
- receipts that will be produced;
- refusal reasons;
- replay status.

The terminal becomes a projection of the semantic control plane, not an alternate hidden control plane.

## 7. Agent runtime plurality

By 2030, zcode-cli can host or connect to many reasoning modes:

- frontier models;
- local models;
- deterministic tools;
- compiled MachineExperience;
- MCP services;
- A2A peers;
- BEAM/WASM/CLI processes.

But the interface makes the source of a decision explicit.

A local deterministic reflex and a frontier model are not presented as equivalent evidence.

## 8. Human interaction becomes selective

The goal is not “human in the loop everywhere.”

The goal is:

[
HumanAttention
ightarrow
IrreversibleChoice
+
MissingAuthority
+
UnresolvedSemantics
+
NovelUNKNOWN
]

Everything else should flow through admitted machine machinery.

zcode-cli is therefore both an interaction surface and an escalation surface.

## 9. Receipts as navigation

By 2030, a receipt is navigable.

From one consequence, an operator can traverse:

[
Consequence
ightarrow
Receipt
ightarrow
Command
ightarrow
Authority
ightarrow
Capability
ightarrow
SemanticSubject
ightarrow
Manufacturer
ightarrow
Source
]

and independently inspect the evidence that led to standing.

This replaces opaque “agent history” with structured provenance.

## 10. Portable workspace state

Workspace configuration itself becomes receipted and reconstructable.

A fresh zcode environment can rehydrate:

- public plugins;
- skills;
- MCP endpoints;
- semantic packs;
- policy projections;
- evidence views;

from admitted configuration rather than machine-local folklore.

## 11. Security posture

The terminal is treated as untrusted presentation plus bounded request construction.

It must not gain authority merely because:

- a prompt asks;
- a plugin exists;
- a model recommends;
- a prior command succeeded;
- a hidden token is available.

Authority remains in the owning system.

## 12. 2030 crown capabilities

1. Standing-aware terminal UX
2. Receipt navigation
3. Fresh-consumer reconstruction
4. Public MCP/A2A/plugin/skill interop
5. Semantic capability discovery
6. Exact evidence ceilings
7. Typed refusals
8. Clean workspace reconstitution
9. Multi-runtime reasoning
10. MachineExperience consumption
11. Human escalation routing
12. Zero-replay-actuation inspection

## 13. What disappears

By 2030, a governed terminal workflow should not depend on:

- private runtime state;
- undocumented plugin internals;
- hidden producer processes;
- “trust me” agent summaries;
- ambiguous green statuses;
- manual provenance reconstruction;
- model-only understanding of machine evidence.

## 14. GALL trajectory

GALL-006 starts with the strongest possible portability test:

**Can a clean consumer understand the released evidence after the producer is gone?**

By 2030, that principle governs every semantic artifact the console handles.

## 15. 2030 falsifiers

The vision fails if:

- standing depends on producer memory;
- the CLI needs private implementation details to consume evidence;
- parsing is confused with verification;
- replay inspection can accidentally re-actuate;
- authority leaks into presentation;
- users cannot distinguish UNKNOWN from ALIVE.

## 16. Final compression

By 2030:

[
oxed{
zcode	ext{-}cli =
	ext{semantic operator console}
+
	ext{standing browser}
+
	ext{fresh-consumer verifier}
}
]

The terminal becomes useful not because it can talk to more AI.

It becomes useful because **it can tell humans and machines exactly what is known, what is authorized, what happened, and why that claim can be trusted**.

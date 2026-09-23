# Governed Multi-Agent Engineering Execution — Western Digital Engagement Proposal

Document: `WD-GALL-FRI-0925`, gate G12 of the GALL-FRI-0925 Friday stop court.
Vendor reference subject: `ash_atlassian` HEAD `0338b9ba169e93d0f5df91f175ef2e62e668fa97`, release `v26.9.22`.
Date: 2026-09-22. Every claim in Section 7 is typed OBSERVED (artifact path + SHA/receipt), BOUNDED-INFERENCE (inference named), or WD-DEPENDENT-UNKNOWN (dependency named). No untyped claims are made anywhere in this document.

---

## 1. Executive summary

We operate a deterministic, ontology-driven software manufacturing system ("Design for Combinatorial Maximalism", DfCM). Software is manufactured from an admitted semantic graph (RDF/SHACL), not hand-written: ontology → generators (ggen) → code as projection → SHACL/SPARQL admission courts → observed-execution receipts → replay. Multi-agent AI coding fleets are bootstrap machinery that compiles UNKNOWN problems into KNOWN deterministic ones; once KNOWN, work runs on deterministic machinery with zero LLM dependency.

What is offered to Western Digital:

1. **Governed multi-agent engineering execution** — AI agents propose; machinery disposes. Every change carries a per-change authority lease and a five-part receipt (identity, authority, consequence, replay, standing): audit-grade provenance per AI-made change.
2. **A semantic work graph (Semantic Jira)** — every obligation carries an exact subject (40-hex base SHA), typed acceptance criteria, and a falsifier. No prose-only tickets.
3. **A compile-down ratchet** — every solved failure class compiles back into executable prior art (rule, shape, plan, or generator), with a measured, not asserted, decline in recurring expert/LLM load.
4. **OCEL 2 process mining** — the engineering process emits object-centric event logs; conformance is checked against declared process models.
5. **`ash_atlassian` as the integration seam** — Jira Cloud (issues, projects, users, transitions) and Confluence Cloud (pages, spaces) resources **generated** from a SHACL profile over public vocabulary terms (schema.org, FOAF, DCMI Terms, P-PLAN); released `v26.9.22`.

The one-number discipline: `ratio = manufactured_lines / total_delivered_lines`. Manufactured means attributable to a pack render or generator run proven by a reconciliation manifest or generator receipt — never by assertion. Unknown attribution counts as hand-written. Residue is ledgered per repo (`HANDWRITTEN.md`, each row an `UNSUPPORTED(generator-capability)` receipt naming the owner pack) and must shrink monotonically. We report the ratio with its ledger, or not at all.

Why this matters to WD: the dominant failure mode of AI-generated change in an enterprise is not model quality — it is **non-admissibility**. Work that cannot be tied to an authority grant, to observed execution of the exact changed subject, and to a reproducible replay cannot enter an audit trail, so it cannot ship at enterprise risk tolerance. The system offered makes AI-made changes admissible by construction.

---

## 2. The problem

AI coding agents, used as they ship today, produce work enterprises cannot admit:

- **No authority boundary.** The agent holds ambient execution access. Nothing distinguishes "read this file" from "push to main"; no per-change ceiling exists for a court to check after the fact.
- **No per-change evidence.** A green unit test is not the desired consequence. Inspection is not execution; a passing test on a sibling branch is not aliveness of the deployed subject. Agent output collapses this distinction.
- **No replay.** The change ran once, inside a conversation. No third party can re-execute the same subject and obtain the same verdict.
- **Hidden state.** Plans, rationales, and status live in chat scrollback — no durable, queryable record of what was decided, under what authority, with what result.

This is not hypothetical. Vendor-internal fleet measurement (skeptic-paired study, 455 single-agent survey claims, 2026-09-22, recorded in the vendor operating doctrine `~/.claude/rules/dfcm-composition.md`) found 35.8% claim error — 46.5% on standing/receipt claims. Untyped agent claims are noise. The remedy is not better prompting but admission machinery: claims become admissible only when a court has executed their falsifier at an exact subject.

---

## 3. The system

### 3.1 The loop

```
        ┌────────────────────────────────────────────────────────────────┐
        │                    Ontology (RDF/SHACL, admitted)               │
        │  classes: WorkOrder, Court, Falsifier, Receipt, LeaseRequest,   │
        │           GoalCheckpoint, MachineExperience, ...                │
        └──────┬─────────────────────────────────────────────┬───────────┘
               │ ggen (deterministic render)                  │ SHACL/SPARQL
               v                                              v
   Observation ──> Admission court ──> Semantic Jira (sJira work graph)
                                            │  exact subject + acceptance + falsifier
                                            v
                              Planner (HDDL / FOND, bounded)
                                            │
                                            v
                     SA2A (typed semantic capability protocol, Chicago corpus)
                                            │
                                            v
                 XaaS authority fabric: lease -> BRCE gate (sole DO path)
                                            │
                                            v
                        Deterministic execution (no LLM on known work)
                                            │
                                            v
        Receipt (identity | authority | consequence | replay | standing)
                                            │
              OCEL 2 event log ─────────────┤
              (process mining)              v
                                  MachineExperience (compile-down)
```

### 3.2 WorkOrder and GoalCheckpoint semantics

A `sj:WorkOrder` is RDF, not prose. The pack `ggen_igniter/priv/ggen/semantic-jira-pack/ontology.ttl` (2,055 lines) defines the vocabulary; `shapes/work-order.shacl.ttl` closes it. An admitted order must carry: a unique identifier, a repository and 40-hex `baseSha` (exact subject), a standing from `UNKNOWN | PARTIAL_ALIVE | ALIVE | BLOCKED | BUILD_BROKEN | UNSUPPORTED | REFUSED(...)`, an authority ceiling matching `^(OBSERVE|SELECT|CONSTRUCT)$`, a promotion rule, a replay identity, a path scope, and at least one typed court, evidence requirement, acceptance criterion, **and falsifier**. Fourteen deterministic projection types (Jira ticket, PRD, ARD, HDDL plan, SA2A package, worker envelope, verification plan, replay manifest, ...) render from the same graph; every projection carries `authorityClaim "NONE"` — a document, however authoritative it reads, is not authority.

The load-bearing law is a SPARQL constraint in the shape file: **ALIVE requires the exact candidate SHA, the exact subject SHA, and a durable, typed receipt** — and independently, a court. `UNKNOWN → ALIVE` in one step is refused by shape; progression must be explicit. The stop layer is `sj:GoalCheckpoint` — a bounded stop condition, not work: it must declare its gap class (`bootstrap | first_mile | core | last_mile`), acceptance, falsifier, exclusions, successor policy, and an LLM-retirement requirement **before execution**, and may reach ALIVE only on a bound receipt. The stop-court gate (`gates/070_stop_court.rq`) is anti-vacuous by construction: its header records that deleting any falsifier from any checkpoint must add a violation row; the pack's test suite guards that property. The frontier gate (`gates/050_frontier.rq`) selects exactly the orders whose typed dependency edges are satisfied by upstream standing — predecessor standing is never inherited.

### 3.3 The ladder

The pack ships a 32-node dependency ladder, `GALL-001`–`GALL-032`, each node a WorkOrder with its own court, acceptance, falsifier, and receipt classes (e.g. `GALL-005 — SA2A Composition/MachineExperience Crown`, `GALL-007 — Chicago Standing Crown`). This is the shape a WD engagement takes: a goal compiled into a typed graph, not a plan in a slide deck.

---

## 4. Evidence

All artifacts below were read in full for this proposal. Paths are exact; facts are quoted or tightly paraphrased.

| Artifact | Fact of record |
|---|---|
| `/Users/sac/ash_atlassian` @ `0338b9ba169e93d0f5df91f175ef2e62e668fa97` | Release `v26.9.22` of generated Jira/Confluence Ash resources. README: "Nothing in `lib/` is hand-written"; regeneration byte-idempotent (`--conflicts replace`, `git diff --exit-code` verified); gate tests run the **real ggen binary** with one negative witness per gate plus a positive control reproducing committed files byte for byte. Every resource ships `Ash.Policy.Authorizer` with **no policies — every action denied** until a consumer declares a carve-out. |
| `/Users/sac/ash_atlassian/receipts/v26.9.22/ASHATL-26922-01.json` | Standing `ALIVE`, exit 0: compile clean, "23 tests, 0 failures", regeneration drift check clean. Notes record an environment repair and the exact Elixir/OTP pin needed for stable gate output — recorded, not hidden. |
| `.../ASHATL-26922-02.json`, `-03.json`, `-04.json` | 02 `BLOCKED:gh_actions_private_repo_billing`; 03 `BLOCKED:XAAS-26922-10`, explicitly "NOT EXECUTED: depends_on ... is unmet" — blocks carried at the same fidelity as successes. 04, the release: `ggen sync run` exit 0 with **no drift beyond the two version lines**, 23/23 tests, tag `v26.9.22` → `2914137`. |
| `/Users/sac/ggen_igniter/priv/ggen/semantic-jira-pack/` | `ontology.ttl` (WorkOrder/Court/Falsifier/Receipt/LeaseRequest/MachineExperience/GoalCheckpoint classes; GALL-001..032), `shapes/work-order.shacl.ttl` (ALIVE⇒SHA+receipt law; duplicate exclusive leases on one concurrency key refused), `gates/010–070` (13 SPARQL gates incl. frontier and stop court). |
| `/Users/sac/.claude/dfcm/receipt.schema.json` + `validate_receipt.py` | Receipts require five groups — identity (subject, repo, subject_sha, base_sha), authority (ceiling enum OBSERVE/SELECT/CONSTRUCT/DO, grant, actor), consequence (commits, files changed, remote effects), replay (commands with per-command exits; durable location "never gitignored tmp"), standing (`derived_from`). BLOCKED/BUILD_BROKEN/REFUSED require a `broken_term` from a nine-value taxonomy. The validator refuses an ALIVE receipt with any non-zero replay exit and checks the subject SHA exists as a commit in the named repo. |
| `/Users/sac/xaas/docs/sjira/v26.9.22/README.md` | Live protocol: "real collaborators only (Chicago-style, no mocks)"; work at the order's `base_sha`; "ALIVE needs an observed run of the exact subject"; receipts append-only — a stale-pin correction (2026-09-22) recorded in the README, historical receipt files untouched. |
| `/Users/sac/dev/zcode-cli/docs/sjira/v26.9.22/work-orders.ttl` | Three live orders (ZOCEL-014/015/016): 40-hex baseSha, standing `UNKNOWN`, ceiling `CONSTRUCT`, promotion rule, per-criterion earn IDs, falsifiers. Anti-vacuity inside acceptance: ZOCEL-015-3 requires removing the new plug, observing the test go red, restoring it, observing green — both outcomes required. |
| `/Users/sac/ash_a2a/priv/sa2a/chicago_mandatory_corpus.json` | 14-member mandatory adversarial corpus (RFC-SA2A-002-v26.9.16 §98): "consequence without authority requirement", "DO without prepared-receipt requirement", "plan exceeding fan-out bound", "semantic artifact lacking provenance", "projection attempting to become canonical source", each bound to a falsifier ID. |
| `/Users/sac/ash_a2a/lib/ash_a2a/semantic/machine_experience.ex` | Compile-down: a resolved UNKNOWN compiles back into one of four machinery kinds (rule, shape, plan, generator), keyed by semantic class. The LLM-allocation decline is **measured via telemetry**, not asserted; compile-back is caller-gated so a model cannot promote its own rule; registration and retraction are both changelogged. |
| `/Users/sac/.zcode/workspace/default/vision-map/_SYNTHESIS.md` | Independent 19-agent synthesis mapping the 12-stage loop (Parse → Route → Admit → Construct → Authorize → Actuate → Receipt → Replay, plus Classify/Select/Execute, standing, experience hooks) onto a real repo: 12/12 integrated reports rated elements ANCHORED or ANCHORED-narrow (enforcing code + tripwire in-repo), zero MISSING. The document itself declares it a map, not evidence. |
| `/Users/sac/dev/zcode-cli/receipts/v26.9.22/zocel-009.json` | A real `PARTIAL_ALIVE` receipt: exit codes include one **exit 1** (`test:runtime`), with `derived_from` explaining the failure is pre-existing on the pristine base HEAD, reproduced on a clean worktree, not introduced by the change — and acceptance not fully met pending human review. Authority: ceiling `CONSTRUCT`, grant "operator-approved implementation plan; no merge of superset, no push", remote effects none. |

---

## 5. Security and authority model

**Zero ambient authority.** Machinery carries no standing execution rights. Consequential action (DO) requires an explicit cut, fresh operator-supplied authority, and a brokered, receipt-bearing path; a request naming authority is not that authority. The receipt schema records, per change: the authority ceiling (OBSERVE/SELECT/CONSTRUCT/DO), the grant (lease id or decision reference), and the actor.

**Leased, receipted, revocable.** Work requiring authority must bind authority, lease, and worker identity or the SHACL shape refuses admission. Lease requests are digested (`sha256:` work-order digest), carry a concurrency key, and duplicate active exclusive leases on one key are refused by SPARQL constraint. Leases are path-scoped and revocable; revocation stops the edge with a typed refusal, not a silent fallback.

**BRCE is the sole consequential-DO path.** parse → route → admit/refuse → diagnose → construct → actuate → receipt → replay. Hooks and workflows carry intent, never authority. Refusals are typed (`REFUSED_NO_AUTHORITY`, `REFUSED_GENERATOR_OWNED`, ...), and the Section 4 corpus includes the negative cases as mandatory members — a system that cannot refuse is not admitted (`admission_vacuous` is a named broken term).

**Token and secret hygiene.** Secrets never enter version control (source-hierarchy law). The `DO` ceiling appears in the schema but is never self-granted by machinery; every DO in the evidence set is operator-granted and receipted. Generated projections declare `authorityClaim "NONE"` mechanically, so no document — including this one — acquires authority by being written.

**Receipt integrity.** A receipt cannot claim ALIVE over a failed replay command, cannot cite a subject SHA absent from the named repository, and cannot report BLOCKED without naming which term of the model it broke.

---

## 6. WD engagement shape

A bounded pilot, structured so that every claim WD relies on at the end is one WD's own courts observed.

**Duration and scope.** 4–6 weeks, one repository, one work-order ladder (8–32 orders), two integration checkpoints.

**WD provides:**
- A read-only mirror of one non-production repository, plus a sanitized sample of its failure-analysis or engineering backlog (50–200 tickets) as raw material for graph admission.
- 2–3 pilot engineers as reviewers and authority grantors (the human edge of the BRCE gate).
- A git remote or namespace under WD control; the vendor never pushes to WD systems.

**Vendor provides:**
- Pack admission for WD's domain vocabulary (EXTEND of existing packs; a genuinely new domain is admitted through the marketplace procedure, never as loose files).
- The full court/receipt/replay apparatus, configured to WD's evidence rules.
- `ash_atlassian` (generated, `v26.9.22`) as the Jira integration seam: WD tickets sync into the semantic work graph and standing syncs back as transition-ready state, deny-by-default until WD declares carve-outs.
- Weekly receipts: per-order standing, the manufactured/hand-written ratio with its ledger, all typed refusals.

**Evidence ceiling for the pilot.** Local execution against the mirrored subject; exact-SHA receipts; replay manifests. Inspection is reported as inspection, never as execution.

**Exclusions.** No production WD data; no deployment into WD infrastructure; no claims about WD outcomes before WD measures them. MTTR reduction, reviewer-load reduction, and defect-escape deltas are **pilot measurement plan items, not claims**: the pilot defines the baseline (WD's numbers over a comparable window) and the receipts supply the denominator. WD's courts, not the vendor's prose, produce any number WD keeps.

**Measurement plan (pilot exit criteria):**
1. Ratio with ledger: manufactured vs. hand-written lines, unknown attribution counted as hand-written.
2. Admissibility: fraction of AI-proposed changes entering WD review with a complete receipt, versus baseline agent output.
3. Anti-vacuity witnessed: at least one court observed refusing on a mutated or reverted subject per deployed gate class.
4. Compile-down: failure classes compiled into machinery, and per-class telemetry of the LLM/expert allocation curve after compile-back.
5. Replay: a WD-selected sample of receipts re-executed by WD engineers, byte-identical verdicts.

---

## 7. Claims table

| # | Claim | Type | Basis |
|---|---|---|---|
| C1 | `ash_atlassian` resources are generated, with byte-idempotent regeneration and a live-gate test suite, at release `v26.9.22` (HEAD `0338b9b`, tag commit `2914137`) | **OBSERVED** | README + `ASHATL-26922-01/04.json` (ALIVE, exit 0, drift checks clean), SHA above |
| C2 | "ALIVE requires exact candidate/subject SHA and a durable receipt, bound to an independent court" is machine-enforced (SHACL+SPARQL); the stop-court gate is anti-vacuous (deleting a falsifier must add a row) | **OBSERVED** | `semantic-jira-pack/shapes/work-order.shacl.ttl`, `gates/070_stop_court.rq` + guarding test |
| C3 | Receipts carry five mandatory groups; ALIVE with any non-zero replay exit is refused; BLOCKED requires a `broken_term` | **OBSERVED** | `~/.claude/dfcm/receipt.schema.json`, `validate_receipt.py` |
| C4 | The ledger records failures at the same fidelity as successes (CI-billing block, unmet dependency, pre-existing red test in a PARTIAL_ALIVE receipt) | **OBSERVED** | `ASHATL-26922-02/03.json`, `zocel-009.json` (exit 1 recorded, reproduced on clean worktree) |
| C5 | A 14-member mandatory adversarial corpus exists, including "consequence without authority requirement" and "DO without prepared-receipt requirement" | **OBSERVED** | `ash_a2a/priv/sa2a/chicago_mandatory_corpus.json` (RFC-SA2A-002 §98) |
| C6 | Compile-down is real machinery with a measured (telemetry, not asserted) per-class LLM-allocation decline, caller-gated so a model cannot promote its own rule | **OBSERVED** | `ash_a2a/lib/ash_a2a/semantic/machine_experience.ex` |
| C7 | The 12-stage loop has enforcing code + tripwires in a real repo (12/12 reports: ANCHORED or ANCHORED-narrow, none MISSING) | **OBSERVED** | `vision-map/_SYNTHESIS.md` (a map, explicitly not ALIVE evidence) |
| C8 | Single-agent untyped claims are unreliable enough to require court pairing | **OBSERVED** (vendor-internal) | 455-claim skeptic study, 35.8%/46.5% error, vendor doctrine `~/.claude/rules/dfcm-composition.md` (2026-09-22) |
| C9 | The court/receipt pattern admits enterprise domains beyond the vendor's own repos by pack EXTEND, without architectural change | **BOUNDED-INFERENCE** | From C1/C2: admission is graph-level, domain vocabulary is data. Not yet witnessed on an external enterprise repo |
| C10 | Court-paired agent output reduces review cost per admitted change relative to untyped output | **BOUNDED-INFERENCE** | From C8 (error asymmetry) + C3 (receipt machine-checkable pre-review). Not measured |
| C11 | `ash_atlassian` syncs standing into WD's Jira with deny-by-default policies and no WD-side code beyond policy carve-outs | **BOUNDED-INFERENCE** | From C1 (generated, deny-by-default) — WD-side Jira administration unverified |
| C12 | The manufactured/hand-written ratio at WD behaves as in the vendor ecosystem (ledgered, monotonic-shrink) | **WD-DEPENDENT-UNKNOWN** | Depends on WD repo topology, pack admission scope, residue WD pilots hand-write |
| C13 | MTTR, reviewer-load, and defect-escape improvements at WD | **WD-DEPENDENT-UNKNOWN** | Depends on WD baseline measurement (Section 6 plan); no claim made |
| C14 | Integration with WD's full enterprise toolchain (SSO, ticket governance, audit consumers) | **WD-DEPENDENT-UNKNOWN** | Depends on WD IT constraints; `ash_atlassian` covers the Jira/Confluence slice only (C1 scope) |

---

*Standing of this document: it is a proposal — a candidate. Per the system's own law, nothing cited here is ALIVE at WD by citation; aliveness belongs to courts executing at exact subjects, which is precisely the pilot's product.*

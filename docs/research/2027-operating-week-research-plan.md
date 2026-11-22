# 2027 Solo Architect Operating Week — Research Plan

**Status:** research / honesty plan — **not** a build sprint and **not** a claim that the 2027 week is ALIVE today.  
**Authority:** post-mop SoT [`docs/c4-sovereign-ecosystem.md`](../c4-sovereign-ecosystem.md) (doc wave label `v26.11.20`) + the just-finished 20-lane C4 disk validation.  
**Date context:** 2026-11-21. No commits implied by this file.

---

## 1. One-paragraph verdict

A mid/late-2027 “normal week” (TAI 555→1, F=0, Monday pull rails, Fourth Watch Day-1 CASTLE exhibits, CindyCat soft intake, HoldCo/FinFab clearing, Gatekeeper WASM offline verify, Woz&Jobs OEM packs, Q1–Q4 table) is **partially spine-plausible and largely commercial-aspirational**. What already exists on disk is a real foundry + fence stack: zcode adapters, ggen/igniter clean-room (`sync --check`), PurRDF 26.10.29, ferroplan+wasm, CASTLE `qualify_fortune5`, Affidavit dual-mode (`map_live` / `verify_witness`), AS-01 WebAuthn hygiene in cos, AWS/Azure/GCP Arcus faces, in-cos RevOps (`SlotLease` / drop airlock **code**), XaaS Ash + live servengine/platform hosts, Popcorn/`beam.wasm` + seven **repo-local** FFB compat shims, and Fourth Watch brand TOML under `mobile-ui-layout-pack`. What does **not** exist as product truth is the week’s theater: 4-Cloud MDS/FROST RAID + OCI, published `@fnox/*`, measured 120 Hz / 5000-stratum / 340 ns / 113k product gates, Chatman-5 / Σ_PQC as live seal, PCCf admit (stub), cos clearinghouse (live `DB_UNAVAILABLE` FAKE-ALIVE), CindyCat runtime (shelved), CASTLE Typst→PDF + probe pins, `revops.fnox.io`, and unverified 21k Connections. Treat the prose as a **target operating picture**; research closes **receipt gaps** on the spine before any Q4 M&A / multi-stratum fantasy.

---

## 2. Claim → Standing matrix

Standing vocabulary (from SoT mop):

| Standing | Meaning |
| --- | --- |
| **ALIVE** | On-disk path with a live/product-usable surface or gated receipt |
| **PARTIAL** | Wired modules / code present; product path incomplete or unmeasured |
| **DOC-ONLY** | Documented or diagrammed; no receipted product gate |
| **MISSING** | Not on disk / not provisioned / shelved as product |

| # | 2027 vision bullet | Standing | Path / receipt hints |
| --- | ---: | --- | --- |
| 1 | Solo Architect TAI 555→1 / F=0 operating week | **DOC-ONLY** | Operating doctrine / prose; no fleet-TAI product gate on disk |
| 2 | Monday pull rails (OEM / buyer funding loops) | **PARTIAL** | In-cos RevOps WSJF / SlotLease (`~/fnox/cos` `FnoxCos.Revops`); no separate Monday-rails product host |
| 3 | Fourth Watch Day-1 CASTLE hard intake | **PARTIAL** | Brand: `ggen-marketplace/packs/mobile-ui-layout-pack/brand/fourth-watch.brand.toml`; CASTLE fortune5 ALIVE; publish/probes incomplete |
| 4 | CASTLE `qualify_fortune5` (40 controls) | **ALIVE** | `~/castle` CLI `fortune5 qualify` |
| 5 | CASTLE multi-probe forensic pins | **PARTIAL** | `~/castle/src/probes` wired; `configs/probes-manifest.json` still `PIN_ON_BUILD` |
| 6 | CASTLE publish Typst → PDF / LinkedIn exhibits | **PARTIAL** | `~/castle/src/publish` Typst-**source** emit; no Typst compiler product; `CASTLE-SPEC-26.11.20` **MISSING** |
| 7 | Gatekeeper sub-250 KB WASM `verify_witness` | **PARTIAL** | `~/affidavit` `verify_witness` / Ed25519 witness path ALIVE in crate+tests; insurer **packaging / size receipt** not productized as “gatekeeper-pack” |
| 8 | 352B CTRT / 736B PCCf fossils | **PARTIAL** | Frame/parse surfaces in Affidavit/GraphLaw; `graphlaw/src/pccf.rs` `admit_pccf` → **FAKE-ALIVE stub** (`NotImplemented`) |
| 9 | Seat AS-01 WebAuthn DO seal (UV=1, monotonic `sign_count`) | **ALIVE** (hygiene) / **PARTIAL** (end-to-end DO evidence) | `~/fnox/cos` `FnoxCosWeb.SealChallenge` + WebAuthn docs; need receipted DO transition evidence, not only helpers |
| 10 | HoldCo / FinFab clearinghouse (`cos.fnox.io`) | **PARTIAL** / live **FAKE-ALIVE** | Code+TF ALIVE (`infra/gcp/cos`, AshDoubleEntry); live `/healthz` with **`DB_UNAVAILABLE`** |
| 11 | Drop airlock `/drop/:lease_id` + SlotLease | **PARTIAL** | In-cos code ALIVE (`SlotLease`, RevOps queue); live cos DB down → airlock not production-ready |
| 12 | `revops.fnox.io` dedicated surface | **MISSING** | RevOps is **in-cos**; `infra/gcp/revops` MISSING |
| 13 | CindyCat soft-intake / patronage runtime | **MISSING** (shelved) | `~/cindy` checkout exists; SoT: shelved pending Fourth Watch cash compounding |
| 14 | Woz & Jobs OEM branded audit packs | **DOC-ONLY** / **PARTIAL** | OEM actor in C4 L1; `--brand` / BrandTheme path ALIVE (`ggen_igniter` BrandTheme); wholesale RAID cells MISSING |
| 15 | FFB wrap legacy React @ 120 Hz / published `@fnox/*` | **PARTIAL** + **DOC-ONLY** + **MISSING** | 7 shims: `~/repop/.../compat` ALIVE repo-local; `@fnox/*` unpublished; `@fnox/react` MISSING; 120 Hz **DOC-ONLY/unmeasured** |
| 16 | Popcorn / `beam.wasm` keyless edge | **PARTIAL** | Present in FFB/edge story; not a sealed OEM product pin (FFB `v26.18.26` **unpinned**) |
| 17 | AWS / Azure / GCP client faces | **ALIVE** | `~/arcus/arcus.toml` `[faces.aws|azure|gcp]` |
| 18 | 4-Cloud MDS/FROST RAID + OCI face | **MISSING** | No OCI face; RAID **not in** `~/smalt` |
| 19 | AoQ 1350B Isochronous / RFC 9266 | **DOC-ONLY** | AoQ QUIC **face** may exist; 1350B/9266 product claim aspirational |
| 20 | LinkedIn Connections ingest / 21k headcount | **PARTIAL** / headcount **MISSING** | Ingest ALIVE per SoT; **21k unverified** |
| 21 | SELECT ≠ DO / authority fences | **ALIVE** | SHACL / PlanningEpisode / Affidavit 4-rung + receipted DO via CommandBus / BRCEBroker |
| 22 | zcode + ggen clean-room week loop | **ALIVE** | `zcode-cli` adapters; drift gate = `mix ggen_igniter.sync --check` (**not** `git diff == 0`) |
| 23 | PurRDF 5k-stratum / 340 ns SHACL | **DOC-ONLY** | PurRDF `26.10.29` ALIVE; stratum/ns figures unsubstantiated |
| 24 | XaaS 113k fps / Chatman-5 / Σ_PQC | **DOC-ONLY** / **MISSING** | Measured WAL band ~29k–88k only; 113k DOC-ONLY; Chatman-5 not live seal; production Σ_PQC unmet |
| 25 | Q1–Q4 M&A cleanroom / multi-stratum foundry scale | **DOC-ONLY** | Requires R1–R2 measured spine; do not research as near-term build |

---

## 3. Research plan (receipt-first, not fake sprint)

### R0 — Honesty / instrumentation (1–2 weeks)

Goal: every contested 2027 claim gets a **named receipt** that would flip standing. No feature build required beyond probes/logging that already fit the fence model.

| Claim cluster | Receipt that would prove it | Likely artifact |
| --- | --- | --- |
| AS-01 DO path | One end-to-end: challenge → UV assertion → monotonic `sign_count` → CommandBus/BRCEBroker DO → loop_receipt / ledger row | `cos` integration receipt + `zcode`/`sjira` ledger hash |
| cos readiness | `/healthz` **and** DB migrate/connect; SlotLease take/release against live PG; refuse if `DB_UNAVAILABLE` | Cloud Run + migrate receipt; redact secrets |
| CASTLE publish | Typst source → **PDF bytes** with pinned compiler SHA; carousel/post lint court pass | `castle` publish receipt; compiler pin file |
| Probe pins | Every `PIN_ON_BUILD` replaced by real `binary_sha256` / `rulepack_sha256` | Diff of `probes-manifest.json` + pin script |
| Affidavit gatekeeper | `verify_witness` WASM artifact size ≤ claimed band; offline host, zero PII, CTRT/PCCf fossil round-trip | Size bench + `wasm-opt` receipt; packaging README |
| FFB honesty | Document 7 shims as **repo-local**; explicitly non-claim published npm / 120 Hz | CAPABILITY or FFB honesty note (no fake `@fnox` publish) |
| Drift gate | Cite only `mix ggen_igniter.sync --check` in operator runbooks | Doc fix only |
| Performance demotions | Keep WAL ~29k–88k as only measured fps band; leave 113k/340ns/5k/120Hz as DOC-ONLY | Point at existing benches; do **not** invent new “ALIVE” numbers |

**R0 exit:** a one-page “receipt registry” listing claim → standing → missing receipt ID. Still no OEM/CindyCat/RAID work.

### R1 — Q1-shaped: close spine gaps that unblock a “normal week”

Order by unblock value (research → minimal construct only when receipt fails for a clear gap):

1. **AS-01 DO path evidence** — prove hardware/user-verified DO is not just `SealChallenge` helpers.
2. **cos DB readiness** — clear `DB_UNAVAILABLE`; AshDoubleEntry / recovery vault actually queryable.
3. **Drop airlock live** — `/drop/:lease_id` + SlotLease against healthy cos (in-cos; do **not** invent `revops.fnox.io`).
4. **CASTLE probe pins** — resolve `PIN_ON_BUILD` in `castle/configs/probes-manifest.json`.
5. **CASTLE publish Typst→PDF** — either pin a Typst toolchain as product dependency or demote “PDF exhibit” claims to Typst-source-only forever in operator docs.
6. **Fortune5 Day-1 script** — Fourth Watch brand.toml → fortune5 qualify → (optional) publish source; refuse if SPEC file still MISSING without documenting the gap.

**R1 anti-pattern:** “build RAID / publish npm / un-shelve CindyCat” while cos is FAKE-ALIVE.

### R2 — Q2–Q3: commercial packaging honesty

Only after R1 receipts exist (or explicit operator waiver):

| Track | Research question | Honesty bar |
| --- | --- | --- |
| OEM branding | Can BrandTheme + `--brand` produce a partner-named audit pack without RAID? | Yes path = brand CSS + CASTLE exhibits; RAID stays MISSING |
| Insurer verifier packaging | Ship Affidavit `verify_witness` as air-gapped WASM + fossil fixtures | Size + offline + zero-PII receipts; no admit_pccf theater |
| CindyCat un-shelve | Cash / compounding gates from Fourth Watch | Explicit criteria doc; no product runtime until gates met |
| FFB packaging | Keep 7 `repop` shims; research whether npm publish is needed at all | Prefer honesty: unpublished shims + live servengine/platform; no fake `@fnox/react` |

### R3 — Q4: M&A cleanroom / multi-stratum

**Gate:** R1 spine green + R2 packaging decisions recorded.

- Multi-stratum / 5k / Chatman / Σ_PQC / 4-Cloud RAID / OCI / RFC 9266 Isochronous remain **research topics only** until measured courts exist.
- M&A cleanroom = process + CASTLE + Affidavit fossils — not a new cloud RAID substrate.
- Revisit PurRDF stratum claims only with a court that pins stratum count and latency; until then DOC-ONLY.

---

## 4. Anti-goals (do NOT research/build yet)

Explicitly out of scope until R1–R2 measured or operator overrides in writing:

- Fake or unverified **21k Connections** headcount
- **4-Cloud MDS/FROST RAID**, OCI face, erasure-striped `.aod` across four clouds
- Treating **`revops.fnox.io`** as a deliverable (in-cos is the SoT)
- Publishing **`@fnox/*`** / inventing **`@fnox/react`** to match prose
- Claiming **120 Hz WebGPU**, **5000-stratum**, **340 ns SHACL**, **113k fps**, **sub-10 ns GraphLaw**, **packs ~50 KB** as ALIVE
- Treating **`admit_pccf`** / Chatman-5 / **Σ_PQC** / Chatman Conservation Law as live product gates
- **CindyCat** product runtime before cash gates
- **`.aod` magic / RAID** narrative as near-term OEM wholesale
- Replacing real drift gate with **`git diff == 0`**
- Fake “build everything in Q1” sprints that ignore cos `DB_UNAVAILABLE` and CASTLE Typst/pin gaps
- Inventing new ALIVE performance metrics in docs without benches

---

## 5. Next decision for operator (pick one)

Three crisp choices — deepen **one** path; park the others until its R0/R1 receipts land:

| Choice | Why it matters | First receipt |
| --- | --- | --- |
| **A. Fourth Watch Day-1 CASTLE path** | Closest to a marketable “normal Monday” exhibit without clearinghouse dependency | Probe pins + fortune5 → publish (Typst source or PDF) with Fourth Watch brand |
| **B. cos readiness** | Unblocks FinFab, drop airlock, Monday rails, AS-01 DO against real DB | Clear `DB_UNAVAILABLE`; SlotLease take/release on live cos |
| **C. Affidavit `verify_witness` packaging** | Unlocks Gatekeeper / insurer story without RAID or CindyCat | Offline WASM artifact + size receipt + fossil round-trip |

**Recommendation default (if undecided):** **B then A** — a FAKE-ALIVE cos undermines HoldCo/FinFab and drop rails that the 2027 week assumes; CASTLE Day-1 can still produce Typst-source exhibits in parallel once pins resolve. **C** is the best parallel research track if insurer conversations are the near-term revenue wedge.

---

## Appendix — SoT anchors (do not drift)

- Honesty SoT: `zcode-cli/docs/c4-sovereign-ecosystem.md`
- CASTLE pins: `castle/configs/probes-manifest.json` (`PIN_ON_BUILD`)
- PCCf stub: `graphlaw/src/pccf.rs` (`admit_pccf` → `NotImplemented`)
- FFB shims: `repop/packages/repop/src/compat/{useQuery,useMutation,useSWR,graphql,table,store,dbClient}.ts`
- Fourth Watch brand: `ggen-marketplace/packs/mobile-ui-layout-pack/brand/fourth-watch.brand.toml`
- RevOps: `fnox/cos/lib/fnox_cos/revops/` (`SlotLease`, queue) — not `revops.fnox.io`
- AS-01 hygiene: `fnox/cos/lib/fnox_cos_web/seal_challenge.ex`
- Drift gate: `mix ggen_igniter.sync --check` (not `git diff == 0`)

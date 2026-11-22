# Sovereign Ecosystem v27.1.1 — Master Product & Architecture Requirements Document (PRD / ARD)

**Document ID:** `ECOSYSTEM-SPEC-27.1.1` (Supersedes `ECOSYSTEM-SPEC-26.11.20`)  
**Target Release Date:** January 1, 2027 (00:00 UTC — EU Data Act & California SB 923 Enforcement Trigger)  
**Operating Doctrine:** TAI $555 \to 1$ Solo-Architect Foundry ($F = 0$)  
**Quality Methodology:** Design for Lean Six Sigma (DfLSS — DMADV, $C_{pk} \ge 2.0$, conformance fitness $\gamma = 0$)  
**Governing Conservation Law (The Chatman Equation):**
$$\Delta S_{\text{admitted}} + \mathbf{\Phi}_{\text{lease}} \equiv \mathbf{R}_{\text{receipt}} \pmod{\mathbf{\Sigma}_{\text{PQC}}}$$
**Core Authority Boundary:** `SELECT != CONSTRUCT != DO` | `PUBLISH ⊂ CONSTRUCT` | Sole Protected `CONSTRUCT -> DO` Gate: `BRCE` + WebAuthn Seat AS-01 (`:prime256v1`)  
**Format Discipline:** `.toml` (Human Config & Brand Manifests) | `.ttl` / `.rq` (Semantic Models & Courts) | Binary (`.aod`, 64B `AOQ1`, 736B `PCCf`) at Runtime

---

## 1. Executive Thesis & Release Delta (PRD)

### 1.1 The v27.1.1 Release Mandate
Version 27.1.1 closes the final gap in the Sovereign Ecosystem: **deterministic, zero-HITL mobile-first user interfaces** and **turnkey Woz-and-Jobs commercial mobilization**. While v26.11.20 sealed the backend compiler spine, zero-string `.aod` storage, 4-Cloud Hyperscaler RAID, and `CASTLE` forensic publication, v27.1.1 eliminates HTML/DOM attack surfaces on net-new control surfaces, automates mobile ergonomics inside `ggen` and `zcode-cli`, and opens the autonomous `revops.fnox.io` airlock for **Fourth Watch AI Cybersecurity** and **CindyCat**.

### 1.2 Structural Problem Solved
* **Statutory Survival Cliff (0.003%):** Effective January 1, 2027, EU Data Act cloud-egress mandates and California SB 923 data-deletion enforcement enter force ahead of CRA/NIS2 and EU AI Act Art. 12/14—a multiplicative logical AND gate that conventional mock-tested cloud/JS codebases clear at roughly **0.003%**.
* **Browser DOM & LLM UI Decay:** Text-based HTML/CSS/JS browsers expose endpoints to XSS, DOM scrapers, RPA bots, and token stealers, while delegating responsive UI layout to VLMs/LLMs fails predominantly on visual spacing and reintroduces stochastic decay into Plane 3.
* **The "Jobs" Scaling Trap:** Handing commercial operations to white-glove partners normally pulls the solo architect back into endless custom UI tweaks and support calls unless mobile branding, layout verification, and client infrastructure are 100% compiler-driven.

### 1.3 Ethical & Commercial Invariants
* **Zero Custody & Zero *Neshek* (0.00% Transaction Rent):** Clients provision four independent cloud accounts (**AWS, Azure, GCP, OCI**) under their own EIN and billing card. Monetization runs strictly on flat fees for craftsmanship and horizontal services (*Luke 10:7*), with zero FinCEN money-transmitter custody.
* **Disposable Exhaust vs. Sovereign Foundry IP:** Generated tenant applications (`xaas`, `servengine`, `natfac`, `revops`) are regenerable compiler caches; 100% of enduring equity resides in Foundry IP (`ggen`, `PurRDF`, `Eyeron`, `Affidavit`, `GraphLaw`, `Smalt`, `CASTLE`, `ash_a2a`, `ash_pplan`, `FinFab`).
* **Unsoftened P28-SIL v2.1.0 & AHDCLT:** Zero free staging or evaluation grace period for institutional enterprises; asymmetric cognitive load (zero-DOM canvas, zero-string `.aod`, mutually blind nodes, silent decoy shunting) renders automated reverse-engineering blind on contact.

---

## 2. Five-Plane Master Architecture (ARD)

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PLANE 5: COMMERCIAL CLEARING, REVOPS & WOZ-AND-JOBS MOBILIZATION                 │
│  • revops.fnox.io (/drop/:lease_id, 21k WSJF triage, 48h/24h SlotLease)          │
│  • cos.fnox.io / FinFab ("Internal Fed", 3–4% vendor float, 72h M&A bolt-on)     │
│  • Front Door #1: Fourth Watch AI (fourth-watch.brand.toml — Sentinel/Steward/   │
│    Shepherd) -> Front Door #2: CindyCat (cindycat.brand.toml — Woman-Owned House)│
│  • Woz & Jobs OEM Foundry (1 Foundry -> N Hot-Swappable White-Glove Operators)   │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│ PLANE 4: CONSEQUENCE, FORENSIC VERIFICATION & DETERMINISTIC PUBLICATION          │
│  • sJira -> CASTLE (CONSEQUENTIAL_ADMISSIBILITY) + zcode-cli v26.11.20 Adapters  │
│  • Pinned Probes: anti-cheat-scorecard (52 Go detectors), Trivy, OpenGrep, RLS   │
│  • castle audit claims-vs-code | castle deletion (45-Day SB 923) | qualify_f5    │
│  • castle publish (--public-anonymize + --brand OEM: PDFs, Carousels, Kits)      │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ (ConstructAdmission -> BRCE -> DO)
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│ PLANE 3: DETERMINISTIC RUNTIME & DUAL-MODE ZERO-AMBIENT-AUTHORITY EDGE           │
│  • BRCE (Sole CONSTRUCT -> DO Gate) + WebAuthn Seat AS-01 (:prime256v1 UV Seal)  │
│  • XaaS / ash_a2a x ash_pplan (BEAM/OTP :gen_statem, 113k fps, <5ms WAL, B=1)    │
│  • Edge Mode A (Net-New): Zero-DOM 120 Hz WebGPU Canvas + Taffy AOT Layout       │
│  • Edge Mode B (Legacy): FFB v26.18.26 (@fnox/* 7 shims) + Playwright rRLG Court │
│  • Strict Causal Diode (Actor -> Shadow Glass -> wasm4pm/BeamPM γ=0 Breaker)     │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ (64B-Aligned Zero-Copy /dev/shm)
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│ PLANE 2: SOVEREIGN WIRE, ZERO-STRING STORAGE & CRYPTOGRAPHIC PROOF               │
│  • Arcus -> cgap (u64 OCEL 2.0, ~98.3% compression) -> GraphLaw (<10 ns gate)    │
│  • Affidavit v26.11.19 (352B CTRT / 736B PCCf / <250KB Air-Gapped WASM Verifier) │
│  • Zero-String Sealed .aod (0x9F1AC401, Monoatomic Leases, affi aod rotate)      │
│  • Smalt 4-Cloud RAID (AWS+Azure+GCP+OCI, (3,4) MDS + FROST, RFC 9266 Decoys)    │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ (AOT Compilation & Static Tables)
┌────────────────────────────────────────▼─────────────────────────────────────────┐
│ PLANE 1: SEMANTIC FOUNDRY & ZERO-HITL UI COMPILER SPINE (ZERO LLM IN ACTUATION)  │
│  • Stateless $0.22/MTok Perimeter Transducer (Call Transcript / Email / Figma)   │
│  • Truex Gate (000_forbid_private_namespaces.rq + W3C SHACL 1.2 UI shui:)        │
│  • PurRDF 3.0.1 + Eyeron 0.8.18 + duckdb_purrdf (5,000-Stratum Datalog x N3)     │
│  • ferroplan (HTN-FOND -> POWL v2) + ggen (SUPPLE/ORC/Taffy AOT) + ggen_igniter  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Plane-by-Plane Architectural Requirements

### 3.1 Plane 1 — Semantic Foundry & Zero-HITL UI Compiler Spine
* **Stateless Perimeter Transducer:** Commodity LLMs (`$0.22/MTok`) are strictly quarantined to a single stateless outer-perimeter hop translating unstructured transcripts, emails, CSVs, or Figma exports into candidate RDF. Zero LLMs participate in state mutation, authorization, or CSS/layout patching.
* **Truex Public-Ontology-Only Gate + `shui:` Admission:** `gates/000_forbid_private_namespaces.rq` enforces ratified public ontologies (`rdf`, `rdfs`, `xsd`, `owl`, `sh`, `time`, `org`, `odrl`, `foaf`, `skos`, `prov`, `p-plan`, `dcterms`, `schema`, `fibo-*`, `ocel`, `urn:uuid:`, `urn:sha256:`) and admits W3C SHACL 1.2 User Interfaces (`shui:`) in v27.1.1. Every Crystallized Control Surface declares grouping and order via `sh:PropertyGroup`, `sh:group`, `sh:order`, `shui:editor`, and `shui:PropertyRole`.
* **DTCG 2025.10 Brand Manifests (`.toml`):** Human-authored visual rhythm lives strictly in `.toml` manifests (`brands/fourth-watch.brand.toml`, `cindycat.brand.toml`, OEM `--brand` packs) encoding `px`/`rem` primitives, 4px/8px grid increments, fluid `clamp()/cqi` slopes, and platform touch-target floors (`48px` Material / `44px` Apple, `8px` inter-target gap).
* **AOT Formal Layout Synthesis & Taffy Pre-Flight Gate:** Before emitting UI artifacts, `ggen` executes SUPPLE/ORC/GRIDS widget-and-pivot optimization (optionally weighted by summarized IEEE OCEL 2.0 interaction frequencies) and evaluates the layout tree natively in **Taffy** (`#![no_std]` Rust Flexbox/Grid) across six canonical widths (`320, 375, 393, 600, 840, 1280px`) plus a synthetic WCAG 1.4.12 1.5× text-expansion pass.
* **Clean-Room Ephemeral Codegen (`ggen_igniter`):** Every build satisfies `rm -rf` of generated trees + `mix ggen_igniter.sync --yes` + `git diff --exit-code == 0`, with zero `generated/` directories anywhere in the workspace.

### 3.2 Plane 2 — Sovereign Wire, Zero-String Storage & Proof-Carrying Conformance
* **Zero-String Sealed `.aod` (`AFFI-SPEC-26.11.19`):** 416-byte minimum little-endian binary format (`0x9F1AC401` non-ASCII sentinel, 64B `AodHeader` with 32B `ontology_hash`, 32B `BufferDirEntry` array, 64B-aligned `avec`/`FFOR` data pages, 352B `CtrtShadow` trailer, `0xE501–0xE50D` refusal codes).
* **Dual-Mode Verifier Split (`map_live` vs. `verify_witness`):** Live admission (`map_live`) burns a monoatomic BLAKE3 nullifier strictly after all structural/PQC checks pass; historical access triggers `affi aod rotate`. External auditors, insurers, and regulators use the free `< 250 KB` air-gapped WASM verifier (`verify_witness`) to validate 352B CTRT and 736B PCCf receipts.
* **Smalt 4-Cloud Hyperscaler RAID & Isochronous AoQ Wire:** Client-owned AWS + Azure + GCP + OCI accounts provisioned in `< 20 min` as a `(2,4)` or `(3,4)` MDS erasure-coded + FROST threshold array ($n=4, q=3$).

### 3.3 Plane 3 — Deterministic Runtime & Dual-Mode Zero-Ambient-Authority Edge
* **BEAM/OTP Photolithography (`XaaS` / `ash_a2a` × `ash_pplan`):** Zero-LLM A2A execution over BEAM `:gen_statem` actors (`113k` frames/s, `< 5 ms` WAL recovery, $B = 1$ blast radius) gated by `BRCE`, Seat AS-01 WebAuthn hardware UV seals, and a live `wasm4pm` ($\gamma = 0$) causal diode circuit breaker.
* **Edge Mode A (Net-New Control Surfaces):** All net-new Crystallized Control Surfaces (~8 exception Sight Glasses & Human Circuit Breakers) compile straight from Taffy AOT coordinates onto a Zero-DOM 120 Hz WebGPU canvas backed by keyless `#![no_std]` Rust/WASM and 64-byte `AOQ1` binary frames.
* **Edge Mode B (Legacy SaaS Wrapping — `FFB` v26.18.26):** Existing client web apps wrap non-invasively via 7 drop-in `@fnox/*` npm shims over WebTransport (`h3`) `AOQ1` frames and fixed-size `SharedArrayBuffer` cursors (`/.well-known/agent-card.json <= 10 KB`).

### 3.4 Plane 4 — `CASTLE` Verification, Publication & `zcode-cli` Autonomic Engine
* **CASTLE (`CASTLE-SPEC-26.11.20`):** Orchestrates SHA-256-pinned air-gapped probes against 40 Fortune-5 controls (`qualify_fortune5()`), compiles reproducible `castle audit claims-vs-code` PDFs, tracks 45-day CPRA/SB 923 data-deletion clocks (`castle deletion`), and compiles anonymized executive advisories and OEM-branded briefs via `castle publish --public-anonymize --brand`.
* **`zcode-cli` Autonomic Orchestrator:** Drives hands-free `CONSTRUCT` loops via POWL v2 ASTs, multi-server $G/G/c$ Kingman + `AimdWipController`, credential-redacted IEEE OCEL 2.0 telemetry (`src/ocel-tap.ts`), and five pluggable adapters:
  1. `src/adapters/sjira-io.ts` (fail-closed `GGEN_BIN` pinning, JSONL-to-POWL projection)
  2. `src/adapters/marketplace-court.ts` (`pack.toml` minimal schema, `SELECT ?violation ?subject` gates, Truex, double capsule check)
  3. `src/adapters/igniter-sync.ts` (upstream-only `.ttl`/`.toml`/template writes, `rm -rf` + sync + `git diff == 0`)
  4. `src/adapters/ui-layout-court.ts` (Taffy pre-flight + Playwright rRLG for legacy shims + anti-vacuity mutation test, `max_remediation_attempts = 3`)
  5. `src/adapters/receipt-sink.ts` (strict `0/1/2/3` exit taxonomy, `~/.zcode/dfcm/receipt.schema.json` 5-field Chatman receipts)

### 3.5 Plane 5 — Commercial Clearing, RevOps & Woz-and-Jobs Mobilization
* **`revops.fnox.io` Self-Serve Airlock:** Ingests the 21,000-node LinkedIn graph via WSJF, enforces 48h/24h `SlotLease` windows via Edge-Shell Clock Injection, stages read-only exports under Verify-Before-Parse SHA-256 jails (`256 MiB` cap), and enforces the `$25,000 × 10^k` `odrl:Duty` fee on custom legal redlines.
* **`cos.fnox.io` / FinFab Treasury:** Zero-float exact `Decimal`/`AshMoney`, live unspent `RECOVERY-VAULT` balance under PostgreSQL `SELECT ... FOR UPDATE`, 3%–4% instant-clear vendor float, and 72-hour M&A bolt-on assimilation via 5,000-stratum `PurRDF × Eyeron` passes.
* **Three-Layer Woz-and-Jobs Mobilization:** Solo Foundry ("Woz") → Front Door #1 Fourth Watch AI (`brands/fourth-watch.brand.toml`) → Front Door #2 CindyCat (`cindycat.brand.toml`, hot-swappable operator house).

---

## 4. Explicit Unresolved Engineering Resolution Contracts

| Risk ID | Subsystem | Unresolved Tension | Mandatory Resolution Contract |
| :--- | :--- | :--- | :--- |
| **R-01** | `cos.fnox.io` | 6 ledger conservation flaws + 36-failure `--seed 7` race. | Close all 6 fixes, eliminate `--seed 7` race, pass 2 consecutive LOW-only skeptic waves before blasting 21k LinkedIn graph. |
| **R-02** | `FFB` Web Worker | Popcorn (`beam.wasm` 2.44 MB) + DuckDB-Wasm previously hit 64 MiB vs. 32 MB ceiling. | Lock fixed-size `SharedArrayBuffer` arena partitioning (`initial === maximum`) before mobile OOM under 250k-row loads. |
| **R-03** | `FFB` Transport | Sandboxed browsers cannot dial raw QUIC `ALPN: aoq/1` directly. | Align WebTransport (`h3`) edge-proxy tunneling to native `ALPN: aoq/1` + UDP-443 fallback across code and release docs. |
| **R-04** | `FFB` Auth | Zero-cookie/zero-token reconnect across Wi-Fi $\leftrightarrow$ cellular migration. | Bind non-extractable WebCrypto (`extractable: false` in IndexedDB) channel-binding signatures to `:gen_statem` `SessionActor`. |
| **R-05** | `Affidavit` `.aod` | ML-DSA-65 signature (~3,309 B) vs. `CtrtShadow.pqc_seal: [u8; 248]` + FFOR variable bit-width vs. fixed-stride. | Lock detached Epoch Lease anchor encoding and `expected_byte_length` stride contract in `#![no_std]` crate. |
| **R-06** | `zcode-cli` Exploit | Explore heuristics (`m ≡ 0` enforced replay, naked timeout returns). | **CLOSED in `zcode-cli` (`0cff19a`, `7b2c181`)**: optimal $A^*$ LP-heuristic alignment ($\gamma = 0$), bounded transactional nets + Saga LIFO rollback, and capped remediation retries. |
| **R-07** | Billing Rails | GCP Billing flags prepaid/single-use virtual cards (`018FD7-382078-0D52EF` hold). | Clear GCP billing hold and stand up direct subscription card/ACH rails (Stripe Billing + Mercury/Brex) for multi-cell ramp. |

---

## 5. Sequenced Critical Path & Release Gates (Nov 21, 2026 → Jan 1, 2027)

| Gate | Target Window | Mandatory Deliverables & Falsifiable Exit Criteria |
| :--- | :--- | :--- |
| **Gate 0: Revenue & Vault Seal** | Nov 21 – Dec 5, 2026 | Clear GCP billing hold; finish `servengine.fnox.io` M4 AshPostgres wiring; close `cos` 6 ledger fixes + `--seed 7` race (2 LOW-only skeptic waves); execute 1-page year-end SOW. |
| **Gate 1: Horizontal Spine & UI Loop** | Dec 6 – Dec 18, 2026 | Unify `curve25519-dalek` v4 & `cgap-aoq` 64B framing; admit `shui:` in Truex; seal Rust/Taffy pre-flight gate in `ggen` + `ui-layout-court.ts` in `zcode-cli`; ship `< 250 KB` air-gapped `verify_witness` WASM binary. |
| **Gate 2: Front Door & Airlock** | Dec 19 – Dec 28, 2026 | Manufacture `revops.fnox.io` (`revops-pack` + 14th GCP Terraform root, `git diff == 0`); lock `fourth-watch.brand.toml` + `cindycat.brand.toml`; pass `castle publish --public-anonymize` redaction court (0% leakage). |
| **Gate 3: v27.1.1 GA Launch** | **January 1, 2027** | All 7 release courts green (`strings -n 4` zero-text `.aod` audit, x86_64/ARM64 determinism, `0xE5xx` mutation court, `< 250 KB` WASM isolation, 50-cycle SIGKILL drill, Taffy/Playwright anti-vacuity mutation exit code `1`); open `/drop/:lease_id` to 21,000-node LinkedIn graph. |

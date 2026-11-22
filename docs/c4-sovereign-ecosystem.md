# C4 Architecture Model — Sovereign Ecosystem v26.11.20

Complete **C4 Architecture Model** (Levels 1–3 plus Deployment) spanning the **Sovereign Ecosystem v26.11.20** across all five architectural planes, repositories, web surfaces, and authority boundaries (`SELECT != CONSTRUCT != DO`), governed by the Chatman Conservation Law ($\Delta S_{\text{admitted}} + \mathbf{\Phi}_{\text{lease}} \equiv \mathbf{R}_{\text{receipt}} \pmod{\mathbf{\Sigma}_{\text{PQC}}}$).

---

## C4 Level 1: System Context Diagram

This view captures all human actors, external third-party platforms, and hardware trust anchors interacting with the Sovereign Ecosystem as a single boundary.

```mermaid
C4Context
  title Level 1: System Context — Sovereign Ecosystem v26.11.20

  Person(architect, "Solo Principal Architect", "Operates the TAI 555-to-1 Foundry (F=0), approves TASK_CONTRACT.md, and seals Seat AS-01 DO transitions")
  Person_Ext(buyer, "HoldCo Principal / Executive", "Drops read-only ERP/repo snapshots via /drop/:lease_id, views Claims vs Code, funds Monday pull rails")
  Person_Ext(oem, "Woz & Jobs OEM Partner", "Independent cybersecurity pro, MSP, or vCISO delivering branded audits and 4-Cloud RAID cells")
  Person_Ext(gatekeeper, "Insurer / Regulator / Auditor", "Verifies 352B CTRT and 736B PCCf compliance offline via free sub-250 KB WASM verifier")
  Person_Ext(staff, "Client Staff & Church Leaders", "Uses existing React/SaaS screens wrapped by FFB shims at 120 Hz with zero retraining")
  Person_Ext(vendor, "Trade Vendors & Carriers", "Settles 3-way verified invoices at T+0 via zero-install ash_a2a Kudzu runners")

  System(ecosystem, "Sovereign Ecosystem v26.11.20", "Five-plane deterministic compiler foundry, 4-Cloud RAID substrate, zero-LLM runtime, CASTLE forensic/publishing engine, and RevOps/FinFab clearinghouse")

  System_Ext(clouds, "Client-Owned 4-Cloud Accounts", "AWS, Azure, GCP, OCI provisioned under client EIN (0% FNOX custody, 0.00% rent)")
  System_Ext(llm_edge, "Commodity Edge LLM APIs", "DeepSeek V4 Flash, local Qwen, glm-5.3-flash quarantined strictly to stateless outer-perimeter RDF parsing")
  System_Ext(webauthn, "Seat AS-01 WebAuthn Hardware", "ES256 prime256v1 hardware authenticator enforcing UV=1 and monotonic sign_count")
  System_Ext(linkedin, "LinkedIn & Threat Feeds", "21k Connections.csv graph, 10 authority surfaces, and weekly live outage/breach manifests")
  System_Ext(legacy_saas, "Legacy ERPs & Church SaaS", "QuickBooks, NetSuite, Tableau exports, Planning Center, and legacy client web apps")

  Rel(architect, ecosystem, "Authorizes contracts, authors ontologies/TOML, seals DO", "CLI / WebAuthn")
  Rel(buyer, ecosystem, "Uploads snapshots, reviews exhibits, funds pull rails", "HTTPS / ACH / MACC / Card")
  Rel(oem, ecosystem, "Pulls --brand content packs & wholesale RAID cells", "CLI / Monday Pull Rails")
  Rel(gatekeeper, ecosystem, "Validates cryptographic witnesses with zero PII access", "Air-gapped WASM verify_witness")
  Rel(staff, ecosystem, "Operates familiar UIs without browser tokens/REST", "WebTransport h3 (AOQ1)")
  Rel(vendor, ecosystem, "Executes instant-clear settlements & cure obligations", "a2a.proto / 736B PCCf")

  Rel(ecosystem, clouds, "Stripes erasure-coded .aod shards & runs Cloud Run/RAID", "Terraform / QUIC :443")
  Rel(ecosystem, llm_edge, "Parses unstructured PDFs/CSVs/transcripts to candidate RDF", "Stateless HTTPS ($0.22/MTok)")
  Rel(ecosystem, webauthn, "Requires hardware user-verification seal for DO actuation", "FIDO2 / WebAuthn ES256")
  Rel(ecosystem, linkedin, "Publishes anonymized carousels/newsletters; ingests signals", "PDF / Markdown / CSV")
  Rel(ecosystem, legacy_saas, "Wraps UIs via FFB shims; ingests read-only exports", "@fnox/* / CSV / Read-Only API")
```

---

## C4 Level 2: Container Diagram (Five-Plane Architecture)

This view decomposes the ecosystem into its five architectural planes, showing the exact runtime containers, authority ceilings (`NONE`, `CONSTRUCT`, `ADMIT`, `ATTEST`, `DO`, `PROJECT`, `SETTLE`), and data-plane contracts.

```mermaid
C4Container
  title Level 2: Containers Across the Five Sovereign Planes

  System_Boundary(p5, "Plane 5: Commercial Clearing, RevOps & Brand Front Doors") {
    Container(revops, "revops.fnox.io", "Elixir / Ash / Phoenix", "Self-serve /drop/:lease_id airlock, 48h/24h SlotLease, 256 MiB symlink jail, WSJF triage [SETTLE via BRCE]")
    Container(cos, "cos.fnox.io (FinFab)", "Elixir / AshDoubleEntry", "Internal Fed treasury clearinghouse, RECOVERY-VAULT FOR UPDATE locks, 3-4% vendor float, 72h M&A bolt-on [SETTLE via BRCE]")
    Container(tenants, "Tenant & Brand Surfaces", "React / Ash / TOML", "servengine.fnox.io, platform.fnox.io, Fourth Watch AI (fourth-watch.brand.toml), CindyCat, natfac, Courtroom.ai [PROJECT]")
  }

  System_Boundary(p4, "Plane 4: Consequence, Forensic Verification & Publication") {
    Container(sjira, "sJira Frontier", "Turtle / SPARQL / JSONL", "Authority-free goals, work orders, candidates.jsonl, ledger.jsonl, loop_receipt.json [NONE]")
    Container(castle, "CASTLE Engine", "Rust + Go/Native Probes", "anti-cheat-scorecard, Trivy/OpenGrep/Gitleaks/Syft, qualify_fortune5 (40 controls), castle audit/deletion/publish [CONSTRUCT]")
  }

  System_Boundary(p1, "Plane 1: Semantic Foundry & Compiler Spine") {
    Container(transducer, "Perimeter Transducer", "Stateless Edge LLM", "Single-hop parser converting PDFs/CSVs/transcripts into candidate RDF structs [NONE]")
    Container(zcode, "zcode-cli v26.11.20", "TypeScript / POWL v2 / AIMD", "Autonomic Explore-to-Exploit I/O orchestrator with sJira, Marketplace, Igniter & Receipt adapters [CONSTRUCT]")
    Container(reasoner, "PurRDF x Eyeron x duckdb_purrdf", "Rust / SIMD / Arrow", "Truex public-ontology gate + 5,000-stratum coupled Datalog x N3 reasoning (340 ns SHACL) [CONSTRUCT]")
    Container(ferroplan, "ferroplan & bcinr-pddl", "Rust / WASM", "HTN-FOND / HDDL-PDDL AOT planner emitting sound POWL v2 policies & Crystallized Control Surfaces [CONSTRUCT]")
    Container(ggen, "ggen / ggen_igniter / Marketplace", "Rust / Elixir AST", "Clean-room AOT codegen from ~50 KB .ttl/.rq/.eex packs; enforces git diff == 0 [CONSTRUCT]")
  }

  System_Boundary(p3, "Plane 3: Deterministic Execution & Zero-Ambient-Authority Edge") {
    Container(brce, "BRCE Authority Gate", "Rust / BEAM", "Sole protected CONSTRUCT-to-DO boundary; verifies ConstructAdmission, monotonic leases & Seat AS-01 WebAuthn [DO]")
    Container(xaas, "XaaS (ash_a2a x ash_pplan)", "Elixir / BEAM OTP", "Zero-LLM A2A gen_statem execution (113k frames/s, sub-5 ms WAL, B=1), ash_surface, chicago_server [EXECUTE behind BRCE]")
    Container(diode, "Causal Diode & wasm4pm", "Rust / WASM / BeamPM / ex4pm", "Unidirectional Shadow Glass verifying POWL v2 trace alignment (gamma=0); microsecond lease revocation [ADMIT]")
    Container(ffb, "FFB v26.18.26 (agents.fnox.io)", "TS / Popcorn beam.wasm / WebGPU", "7 @fnox/* npm shims, keyless zero-symbol WASM, SharedArrayBuffer cursors, 120 Hz projection [PROJECT]")
  }

  System_Boundary(p2, "Plane 2: Sovereign Wire, Storage & Cryptographic Proof") {
    Container(wire, "Arcus & cgap", "Go / Rust no_std SIMD", "Byte-for-byte wire slicing (Arcus) + 8B u64 OCEL 2.0 bit-packing (cgap-bosym, cgap-ocel2, SWAR) [TRANSPORT]")
    Container(proof, "GraphLaw & Affidavit", "Rust no_std / WASM / BEAM NIF", "Sub-10 ns SRL turnstile (GraphLaw); 352B CTRT, 736B PCCf, map_live vs sub-250 KB verify_witness [ADMIT / ATTEST]")
    ContainerDb(aod, "Zero-String Sealed .aod & Smalt RAID", "Binary 0x9F1AC401 / BEAM+Rust", "64B-aligned zero-string storage, monoatomic leases, affi aod rotate, (2,4)/(3,4) MDS+FROST 4-Cloud RAID, AoQ QUIC [STORE / INFRA]")
  }

  Rel(revops, sjira, "Emits staged SHA-256 diagnostic candidates", "candidates.jsonl")
  Rel(revops, cos, "Routes cleared buyers via inverse surface compiler", "Ash / PostgreSQL")
  Rel(cos, brce, "Requests guarded treasury settlement", "ConstructAdmission + WebAuthn")
  Rel(sjira, zcode, "Feeds eligible work-order frontier", "ggen sjira frontier")
  Rel(zcode, castle, "Runs probes, audits & anonymized publications", "CLI / CONSTRUCT")
  Rel(zcode, ggen, "Executes pack qualification & clean-room sync", "marketplace.py / mix ggen_igniter.sync")
  Rel(transducer, reasoner, "Submits candidate RDF structs", "SHACL / Truex Gate")
  Rel(reasoner, ferroplan, "Supplies verified domain ontologies", "Arrow IPC / /dev/shm")
  Rel(ferroplan, ggen, "Supplies POWL v2 & control surfaces", "UniversalPlan ABI")
  Rel(ggen, tenants, "Synthesizes disposable app trees & FFB shims", "Zero-diff codegen")
  Rel(ggen, xaas, "Compiles photomask closures & static string tables", "AOT Rust/Elixir")
  Rel(castle, brce, "Submits signed CONSTRUCT admission bundles", "BLAKE3 / Ed25519")
  Rel(brce, xaas, "Grants scoped GymAct execution leases", "Monotonic Lease")
  Rel(ffb, xaas, "Streams 16B intent frames; receives 28B Arrow pages", "WebTransport h3 (64B AOQ1)")
  Rel(xaas, diode, "Emits immutable transition frames", "Strict Causal Diode")
  Rel(diode, proof, "Triggers immediate SMT lease revocation if gamma > 0", "736B PCCf")
  Rel(xaas, wire, "Streams OCEL 2.0 events & binary payloads", "Zero-copy /dev/shm")
  Rel(wire, proof, "Validates ingress & seals cryptographic shadows", "GraphLaw / Affidavit")
  Rel(proof, aod, "Maps live leases & rotates write-forward shards", "affi aod seal / rotate")
```

---

## C4 Level 3A: Component Diagram — Autonomous Foundry & Verification Loop (Planes 1 & 4)

This view zooms into how `zcode-cli v26.11.20` closes the hands-free I/O loop across `sJira`, `ggen-marketplace`, `ggen_igniter`, `ferroplan`, and `CASTLE`.

```mermaid
C4Component
  title Level 3A: Component View — zcode-cli, ggen Foundry & CASTLE

  Container_Boundary(zcode_c, "zcode-cli v26.11.20 (Clean-Room Orchestrator)") {
    Component(powl_eng, "POWL v2 & Petri Net Engine", "TypeScript", "compilePowlToWorkflowNet + executePowlWithTokenReplay; eliminates structural deadlocks")
    Component(aimd, "AimdWipController & Autonomic Loop", "TypeScript", "Little's Law WIP slow-start, additive increase, multiplicative backoff, deriveFollowUpPowl")
    Component(ocel_tap, "Dual OCEL 2.0 Tap", "TypeScript", "ocel-tap.ts capturing 26 wire events across 6 object types with SHA-256 hash chaining")
    Component(ad_sjira, "src/adapters/sjira-io.ts", "Adapter", "Pins absolute GGEN_BIN (>= fd4f99bbd), compiles candidates.jsonl to PartialOrder(V, prec)")
    Component(ad_mkt, "src/adapters/marketplace-court.ts", "Adapter", "Locks pack.toml keys, forbids ASK gates, runs 000_forbid_private_namespaces.rq & 2x capsule check")
    Component(ad_ign, "src/adapters/igniter-sync.ts", "Adapter", "Restricts mutations to .ttl/.rq/.eex; verifies rm -rf + mix ggen_igniter.sync + git diff == 0")
    Component(ad_sink, "src/adapters/receipt-sink.ts", "Adapter", "Enforces 0/1/2/3 exit codes, anti-fake-ALIVE ceiling, hands_free_twin_parity, DfCM receipts")
  }

  Container_Boundary(foundry_c, "ggen / ggen-marketplace / Compiler Spine") {
    Component(truex, "Truex Oxigraph Stage 1 Gate", "SPARQL", "000_forbid_private_namespaces.rq enforcing ratified public vocabularies only")
    Component(datalog_n3, "PurRDF 3.0.1 + duckdb_purrdf + Eyeron", "Rust / Parquet", "5,000-stratum Datalog x N3 over 176-183 B/row flat 5-table Parquet and /dev/shm rings")
    Component(htn_pack, "htn-fond-powl2-compiler-pack", "ggen Pack", "Compiles ferroplan_wasm.wasm into %Smalt.Powl2{} and cgap-bosym u64 markings")
    Component(packs, "Domain Ontology Packs (~50 KB)", "TTL / RQ / EEx", "revops-pack, castle-pack, github-actions-pack, church/VIN vertical packs")
  }

  Container_Boundary(castle_c, "CASTLE (CASTLE-SPEC-26.11.20)") {
    Component(probes, "Pinned Static & Live Probes", "Go / Native", "anti-cheat-scorecard (52 detectors), Trivy, OpenGrep, Gitleaks, Syft, SQL/RLS, castle deletion")
    Component(courts, "Admissibility & Readiness Courts", "Rust", "qualify_fortune5 (40 controls), admit_replay, minimum_impact_coverage, capability_intake")
    Component(publisher, "Deterministic Typst Publisher", "Rust / Typst", "castle publish (--public-anonymize redaction court + --brand OEM: PDFs, Carousels, Gatekeeper packs)")
  }

  Rel(ad_sjira, powl_eng, "Projects work-order DAG into POWL v2 AST")
  Rel(powl_eng, aimd, "Schedules transitions under dynamic WIP cap")
  Rel(powl_eng, ocel_tap, "Emits E2O/O2O execution telemetry")
  Rel(powl_eng, ad_mkt, "Pre/post-validates touched ggen-marketplace packs")
  Rel(ad_mkt, truex, "Runs public-namespace and SELECT-only gate courts")
  Rel(ad_mkt, packs, "Double-checks capsule determinism before SHA-256 pinning")
  Rel(powl_eng, ad_ign, "Guards upstream-only writes & clean-room regeneration")
  Rel(ad_ign, datalog_n3, "Invokes multi-stratum semantic closure")
  Rel(datalog_n3, htn_pack, "Feeds verified domain constraints")
  Rel(powl_eng, probes, "Executes air-gapped castle probe work orders")
  Rel(probes, courts, "Feeds receipted metric observations")
  Rel(courts, publisher, "Passes ALIVE/REFUSED exhibits to redaction court")
  Rel(ocel_tap, ad_sink, "Seals 5-field Chatman receipt & ledger.jsonl")
```

---

## C4 Level 3B: Component Diagram — Sovereign Wire, Storage, Runtime & Protected DO Edge (Planes 2 & 3)

This view details the zero-string storage, cryptographic proof, BEAM photolithography, and keyless FFB edge components.

```mermaid
C4Component
  title Level 3B: Component View — Plane 2 Proof/Storage & Plane 3 Runtime/Edge

  Container_Boundary(ffb_c, "FFB v26.18.26 Client Edge (Browser COOP/COEP)") {
    Component(shims, "@fnox/* 7 npm Shims", "TypeScript", "react, react-query, swr, graphql, table, store, db-client preserving legacy staff UIs")
    Component(worker, "Keyless WASM Worker", "Popcorn beam.wasm + DuckDB-Wasm", "2.44 MB BEAM WASM + WebReflection/js-proxy cursors over fixed SharedArrayBuffer")
    Component(gpu, "120 Hz WebGPU Projector", "WebGPU", "Renders nameless Arrow IPC pages; zero browser bearer tokens, cookies, or REST/JSON")
  }

  Container_Boundary(xaas_c, "XaaS & BRCE Runtime (BEAM/OTP + Rust)") {
    Component(brce_gate, "BRCE + Seat AS-01 Verifier", "Rust / BEAM", "Verifies ConstructAdmission, GymAct permit, monotonic lease narrowing & ES256 UV=1 sign_count")
    Component(a2a, "ash_a2a & ash_pplan", "Elixir gen_statem", "Photomask %Closure execution, Process.monitor crash recovery (sub-5 ms WAL), ObanAuthority")
    Component(crud, "Xaas.ServEngine.Crud & Tenant RLS", "Elixir / Ash / PG16", "12 Ash resources, Ash.Policy.Authorizer + PG16 NULLIF RLS, AshCloak AES-256-GCM")
    Component(wasm4pm_c, "wasm4pm / BeamPM Diode", "Rust WASM / Elixir", "Checks POWL v2 trace alignment (gamma=0) across unidirectional Shadow Glass")
  }

  Container_Boundary(p2_c, "Plane 2: Arcus, cgap, GraphLaw, Affidavit & Smalt") {
    Component(arcus_c, "Arcus Wire & Emulators", "Go", "Byte-for-byte boundary slicing + ~/arcus/internal/gcp_emulator local cloud twins")
    Component(cgap_c, "cgap Kernel", "Rust no_std forbid(unsafe)", "cgap-bosym, cgap-ocel2 (~98.3% compression to 8B u64, >12M rows/s), cgap-branchless SWAR")
    Component(gl_c, "GraphLaw Turnstile", "Rust no_std", "Sub-10 ns gate + graphlaw/src/pccf.rs stratified SRL admission + encrypted literal enclaves")
    Component(affi_c, "Affidavit v26.11.19 Dual-Mode Verifier", "Rust no_std / WASM / NIF", "map_live (burns BLAKE3 nullifier strictly last) vs verify_witness (sub-250 KB WASM, zero payload ptrs)")
    Component(aod_c, "Zero-String Sealed .aod Engine", "Binary Format", "64B AodHeader (0x9F1AC401), 32B BufferDirEntry, 64B-aligned FFOR/avec pages, 352B CtrtShadow, affi aod rotate")
    Component(smalt_c, "Smalt 4-Cloud RAID & AoQ Wire", "BEAM/OTP + Rust no_std", "(2,4)/(3,4) MDS erasure coding + FROST (n=4, q=3), 1,350B QUIC padding, RFC 9266 decoy shunt, servengine_sim")
  }

  Rel(shims, worker, "Dispatches salted BLAKE3 proxy lookups", "SharedArrayBuffer")
  Rel(worker, gpu, "Projects nameless Arrow buffers", "Zero-copy")
  Rel(worker, a2a, "16B intent frames / 28B page projections", "WebTransport h3 (64B AOQ1)")
  Rel(brce_gate, a2a, "Unlocks protected DO state transitions", "Signed Lease")
  Rel(a2a, crud, "Executes tenant-isolated domain actions", "TenantBinding.with_tenant_tx")
  Rel(a2a, wasm4pm_c, "Streams transition receipts", "Strict Causal Diode")
  Rel(a2a, arcus_c, "Sends binary wire frames", "UDS / QUIC")
  Rel(arcus_c, cgap_c, "Packs OCEL 2.0 events into 8B u64 markings", "64B-aligned SIMD")
  Rel(cgap_c, gl_c, "Validates stratified SRL rules & PCCf envelopes", "Sub-10 ns call")
  Rel(gl_c, affi_c, "Seals 352B CTRT & 736B PCCf Bulletproofs", "BLAKE3 / ML-DSA-65 anchor")
  Rel(affi_c, aod_c, "Seals, maps live, or write-forward rotates .aod", "0xE5xx fail-closed codes")
  Rel(aod_c, smalt_c, "Stripes encrypted zero-string shards across 4 clouds", "MDS + FROST + 1,350B QUIC")
```

---

## C4 Deployment Diagram: Physical & Cloud Topology

This view maps every active repository, live production surface, local production-parity twin, and zero-custody client infrastructure node onto its execution environment.

```mermaid
C4Deployment
  title Deployment View — Local Foundry, Live GCP Run, Client 4-Cloud RAID & Air-Gapped Edge

  Deployment_Node(dev_mac, "Solo-Architect Foundry Host (macOS / Local Canonical Checkouts)", "Rust / Elixir OTP 28 / Go / Node") {
    Container(repos_core, "Core Foundry Repos", "~/fnox (13 TF roots), ~/ggen-marketplace, ~/cgap, ~/arcus, ~/smalt, ~/xaas, ~/srve, ~/cindy", "7-Stage Multi-Agent Manufacturing Loop, zcode-cli, ggen, CASTLE, local gcp_emulator & servengine_sim")
  }

  Deployment_Node(gcp_fnox, "FNOX Control & Live Production (GCP us-west1 / Cloud Run)", "Terraform-Managed (14 Offline-Verified Roots)") {
    Container(cr_srve, "servengine.fnox.io & platform.fnox.io", "Cloud Run (xaas-00022-8f6) + PG16 RLS", "Live XaaS + ServEngine React frontend, Secret Manager, OCEL v2 Cloud Logging")
    Container(cr_revops, "revops.fnox.io", "Cloud Run (infra/gcp/revops)", "Self-serve /drop/:lease_id intake airlock & WSJF prospect pipeline")
    Container(cr_cos, "cos.fnox.io (FinFab)", "Cloud Run (infra/gcp/cos)", "Sovereign HoldCo treasury ledger & Tableau recovery waterfall")
    Container(cr_ffb, "agents.fnox.io", "Cloud Run / Edge", "FFB v26.18.26 GA distribution & /.well-known/agent-card.json (<= 10 KB)")
  }

  Deployment_Node(client_raid, "Client-Owned 4-Cloud Hyperscaler RAID (Client EIN & Billing)", "0% FNOX Custody | 0.00% Transaction Rent") {
    Deployment_Node(aws, "AWS Account", "Shard Node 1") {
      ContainerDb(s1, "Smalt Shard + .aod", "MDS (2,4)/(3,4) + FROST", "Zero-string erasure-coded shard")
    }
    Deployment_Node(azure, "Azure Account", "Shard Node 2") {
      ContainerDb(s2, "Smalt Shard + .aod", "MDS (2,4)/(3,4) + FROST", "Zero-string erasure-coded shard (also Courtroom.ai host)")
    }
    Deployment_Node(gcp_c, "GCP Account", "Shard Node 3") {
      ContainerDb(s3, "Smalt Shard + .aod", "MDS (2,4)/(3,4) + FROST", "Zero-string erasure-coded shard")
    }
    Deployment_Node(oci, "OCI Account", "Shard Node 4") {
      ContainerDb(s4, "Smalt Shard + .aod", "MDS (2,4)/(3,4) + FROST", "Zero-string erasure-coded shard")
    }
  }

  Deployment_Node(client_browser, "Client Staff Browser", "COOP: same-origin | COEP: require-corp") {
    Container(ffb_edge, "FFB Keyless WASM Shell", "Popcorn beam.wasm + DuckDB-Wasm + WebGPU", "Wraps legacy SaaS/React UIs at 120 Hz over WebTransport h3")
  }

  Deployment_Node(auditor_host, "Air-Gapped Gatekeeper / Insurer Host", "Zero Network Egress") {
    Container(wasm_aud, "Affidavit Micro-Verifier", "Standalone sub-250 KB WASM", "Offline verify_witness over 352B CTRT & 736B PCCf fossils")
  }

  Rel(repos_core, gcp_fnox, "Deploys clean-room builds & verified TF plans", "Artifact Registry / Terraform")
  Rel(repos_core, client_raid, "Provisions client RAID cells in under 20 min", "Arcus / Terraform")
  Rel(client_browser, gcp_fnox, "Connects FFB shims to live XaaS", "WebTransport h3 (AOQ1)")
  Rel(client_browser, client_raid, "Connects FFB shims to sovereign RAID cells", "1,350B Isochronous AoQ QUIC :443")
  Rel(gcp_fnox, auditor_host, "Publishes anonymized gatekeeper-pack exhibits", "Offline Transfer (Zero PII)")
```

---

## Complete Project & Repository Inventory Mapped to C4 Planes

| Project / Repo / Surface | Local Path / Domain | Runtime / Stack | C4 Plane | Core Responsibility & Authority Ceiling |
| --- | --- | --- | --- | --- |
| **zcode-cli** | `zcode-cli` (`bin/zcode.js`) | TypeScript / POWL v2 / OCEL 2.0 | Plane 1 | Clean-room Explore-to-Exploit I/O orchestrator with sJira, Marketplace, Igniter & Receipt adapters (`CONSTRUCT`) |
| **ggen / ggen_igniter** | `ggen`, `ggen_igniter ~> 26.10.5` | Rust / Elixir AST (Igniter/Sourceror) | Plane 1 | AOT clean-room codegen from `.ttl`/`.rq`/`.eex` packs; enforces `git diff --exit-code == 0` (`CONSTRUCT`) |
| **ggen-marketplace** | `~/ggen-marketplace` | Turtle / SPARQL / Python check harness | Plane 1 | Qualified ~50 KB vertical packs (`revops-pack`, `castle-pack`, `htn-fond-powl2-compiler-pack`, `github-actions-pack`) (`CONSTRUCT`) |
| **Truex** | `000_forbid_private_namespaces.rq` | Oxigraph SPARQL | Plane 1 | Public-ontology-only Stage 1 build gate (FIBO, PROV-O, P-PLAN, SHACL, ODRL, OCEL v2) (`ADMIT`) |
| **PurRDF + duckdb_purrdf + Eyeron** | `PurRDF 3.0.1`, `Eyeron 0.8.18` | Rust / SIMD / Arrow / Parquet | Plane 1 | Coupled 5,000-stratum Datalog x N3 reasoning (340 ns SHACL, 176–183 B/row Parquet) (`CONSTRUCT`) |
| **ferroplan / bcinr-pddl** | `ferroplan_wasm.wasm`, `bcinr-pddl` | Rust / WASM | Plane 1 | AOT HTN-FOND / HDDL-PDDL planner compiling POWL v2 policies & Crystallized Control Surfaces (`CONSTRUCT`) |
| **Arcus** | `~/arcus` | Go + Terraform | Plane 2 | Byte-for-byte wire slicing + production-parity local cloud twins (`internal/gcp_emulator`) (`TRANSPORT`) |
| **cgap** | `/Users/sac/cgap` | Rust `#![no_std]` `#![forbid(unsafe_code)]` | Plane 2 | `cgap-bosym`, `cgap-ocel2` (~98.3% compression to 8B `u64`, >12M rows/s), `cgap-branchless` SWAR (`TRANSPORT/STORE`) |
| **GraphLaw** | `graphlaw/src/pccf.rs`, `ash_graphlaw` | Rust `#![no_std]` / Elixir | Plane 2 | Sub-10 ns semantic-law ingress turnstile, stratified SRL admission, encrypted literal enclaves (`ADMIT`) |
| **Affidavit / strata** | `affi` CLI, `ash_affidavit`, `strata` | Rust `#![no_std]` / WASM / BEAM NIF | Plane 2 | Zero-String `.aod` (`0x9F1AC401`), 352B CTRT, 736B PCCf, `map_live` vs `< 250 KB` `verify_witness` (`ATTEST`) |
| **Smalt** | `~/smalt` | BEAM/OTP + Rust `#![no_std]` | Plane 2 | 4-Cloud Hyperscaler RAID (AWS/Azure/GCP/OCI), 1,350B AoQ QUIC + RFC 9266 decoy, `servengine_sim` (`INFRASTRUCTURE`) |
| **BRCE** | Core boundary + Seat AS-01 | Rust / BEAM / WebAuthn ES256 | Plane 3 | Sole protected `CONSTRUCT -> DO` boundary enforcing hardware UV seals & monotonic leases (`DO`) |
| **XaaS** | `~/xaas` (`ash_a2a`, `ash_pplan`, `ash_surface`, `chicago_server`) | Elixir / BEAM OTP 28 | Plane 3 | Zero-LLM A2A `gen_statem` runtime (113k frames/s, < 5 ms WAL, B=1), tenant CRUD + PG16 RLS (`EXECUTE behind BRCE`) |
| **wasm4pm / BeamPM / ex4pm** | Strict Causal Diode court | Rust WASM / Elixir | Plane 3 | Live POWL v2 trace alignment ($\gamma = 0$) revoking SMT leases in microseconds on divergence (`ADMIT`) |
| **FFB v26.18.26** | `@fnox/*` (7 npm shims), `agents.fnox.io` | TS / Popcorn `beam.wasm` / WebGPU | Plane 3 | Keyless, zero-REST, zero-symbol 120 Hz SaaS wrappers over WebTransport `h3` & `SharedArrayBuffer` (`PROJECT`) |
| **sJira** | `docs/sjira/`, `candidates.jsonl` | Turtle / SPARQL / JSONL | Plane 4 | Authority-free goals, obligations, eligible frontier, and append-only execution ledger (`NONE`) |
| **CASTLE** | `castle` CLI + `anti-cheat-scorecard` | Rust / Typst + Go/Native Probes | Plane 4 | 40-control Fortune-5 court, Claims vs Code, 45-day CPRA deletion tracker, `--public-anonymize --brand` publisher (`CONSTRUCT`) |
| **fnox Core Infra** | `~/fnox` | Terraform (13 roots) / Python offline harness | Plane 5 | Offline-verified GCP Terraform roots, `epistemic.py` `MonotonicLease`, `ledger/core.py` (`INFRASTRUCTURE`) |
| **RevOps Airlock** | `revops.fnox.io` (`infra/gcp/revops`) | Elixir / Ash / Phoenix | Plane 5 | `/drop/:lease_id` intake, Edge-Shell Clock `SlotLease`, 256 MiB jail, 21k LinkedIn WSJF triage (`SETTLE via BRCE`) |
| **FinFab / HoldCo OS** | `cos.fnox.io` | Elixir / `AshDoubleEntry` | Plane 5 | Internal Fed clearinghouse, `RECOVERY-VAULT` locks, 4-tier $10^k$ scaling, 3–4% Kudzu float, 72h M&A (`SETTLE via BRCE`) |
| **ServEngine & Platform** | `servengine.fnox.io`, `platform.fnox.io`, `~/srve/servengine-frontend` | React + XaaS on GCP Cloud Run | Plane 5 | Live multi-entity dispatch/CRUD production tenant proving FFB + PG16 RLS + OCEL v2 (`PROJECT`) |
| **Fourth Watch AI** | `fourth-watch.brand.toml` | TOML Brand Pack + CASTLE/FFB | Plane 5 | Active Hard-intake cybersecurity front door (Faith + AI: Sentinel, Steward, Shepherd) (`PROJECT`) |
| **CindyCat** | `cindycat.com`, `~/cindy` (`wf_0e714c3d-13a`) | Civic/Church `ggen` Pack + RAID | Plane 5 | Shelved Soft-intake civic/church patronage & §107/§127 guild pending Fourth Watch cash compounding (`PROJECT`) |
| **Other Vertical Tenants** | `natfac`, `Courtroom.ai`, Woz & Jobs OEM | `ggen`-synthesized / Azure & 4-Cloud | Plane 5 | Isomorphic vertical deployments & Depth-1 wholesale OEM partner fronts (`PROJECT`) |

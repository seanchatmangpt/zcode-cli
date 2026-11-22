# ERRC matrix — post-construct wave (2026-11-22)

**Lane:** CREATE-5 (ERRC synthesis register)  
**Status:** **SIBLING_FILL_PASS** — E/R/A/C + lie→impl folded from disk; R4 FILLED from cos GTM honesty (sibling ack-only)  
**Authority:** `errc-cycle` + `source-of-truth-check` (no second-file status theater)  
**Date context:** 2026-11-21 launch → register labeled 2026-11-22 → fill 2026-11-21 evening  
**Commits:** none implied by this file

---

## Coordinator fill law (mandatory)

Wait was unavailable to CREATE-5. This file is the **sink**. The coordinator (or a later synthesis pass) MUST:

1. Collect each sibling notification for E1–E5 · R1–R5 · A1–A5 · C1–C4 (this lane is C5).
2. For every matrix row whose `Sibling fill` is `PENDING_SIBLING`, copy **only** what that lane verified on disk — never promote a construct-seal “green” claim into `Verified`.
3. Re-derive any count/status with `source-of-truth-check` (or an explicit `source_command`) before writing it into a SoT column. Historical construct prose stays in `Construct seed` and is **not** a live mirror.
4. Park security / preference-tension items; do not auto-resolve.
5. Leave cells as `PENDING_SIBLING` / `UNVERIFIED` / `PARK` rather than inventing DONE/PASS/ALIVE.
6. When a sibling returns empty or fails: record `EMPTY` / `FAILED` + agent id — do not backfill from memory of the construct wave.

**Standing vocabulary (SoT mop — do not invent new labels):**

| Standing | Meaning |
| --- | --- |
| **ALIVE** | On-disk path with live/product-usable surface or gated receipt |
| **PARTIAL** | Wired modules / code present; product path incomplete or unmeasured |
| **DOC-ONLY** | Documented or diagrammed; no receipted product gate |
| **MISSING** | Not on disk / not provisioned / shelved |
| **PENDING_SIBLING** | Awaiting E/R/A/C lane notification — **not** a completion |
| **PARK** | Ambiguous / security / operator-only — logged, not auto-fixed |

---

## Construct seed (known outcomes — not ERRC completions)

Source: construct wave seal synthesis (parent transcript, 20/20 sealed uncommitted) + pre-construct gap register. These are **seeds for categorization**, not verified ERRC results.

### Construct seal buckets (claimed at seal time)

| Bucket | Seal claim | Operator caveat |
| --- | --- | --- |
| OCEL redaction / `chain_intact` / lease objects / gall-work | green (code) | Still subject to RAISE A1 re-verify |
| Castle court + brand-required + F-ANON-3 + twins | green (code+tests) | RAISE A2 / ELIMINATE E5 re-verify refuse-only |
| Sync `--check`, twin-parity TOML, chicago 27, Affidavit **28673 B** | green (local) | Fat WASM residual → REDUCE R5; git-diff fallacy → E2 |
| xaas cache **26.9.22** ≡ source | green (cache sync) | RAISE A3 fail-closed verify |
| GTM + runbook honesty | `/readyz` 200 ∧ 2× LOW; no PASS theater | Live `/readyz` still **503** at seal; CREATE C1/C3 |
| Drop / seed-7 | code+TF hardened | Live drop still **503**; REDUCE R3 |

**Still operator-only (PARK — not a lane “DONE”):** billing `018FD7` → JWKS → migrate → redeploy → `/readyz` 200. LinkedIn outbound stop-worked.

### Pre-construct P0–P3 gap register (ERRC targeting input)

| Pri | Gap (as registered pre-construct) | Likely ERRC quadrant | Sibling lane |
| --- | --- | --- | --- |
| P0 | Live `/readyz` **503**; billing ∧ IAP JWKS ∧ redeploy AND-gate | CREATE / PARK | C1 (+ operator) |
| P0 | **0× LOW-PASS**; C/D “cleared” = DOC theater | ELIMINATE + CREATE | E1, C3 |
| P0 | Installed xaas gate not fail-closed (`26.9.17` vs source) | RAISE (post-sync verify) | A3 |
| P0 | OCEL redaction FAIL + `chain_intact` false witness | RAISE (post-fix verify) | A1 |
| P1 | Castle F-ANON-3 / court off wire | RAISE / ELIMINATE strip-ship | A2, E5 |
| P1 | 7/8 DONE overclaim; wrong sync gate; soft `--brand` | ELIMINATE + RAISE | E1, E2, A4 |
| P1 | GTM `@fnox/*` / RAID-GA prose; unlock-criteria drift | ELIMINATE | E4 |
| P1 | Gall-work silent heartbeats / falsifier / discovery.ok | REDUCE / RAISE | R1, A1 |
| P1 | C4 Rel overclaims (fortune5 / BRCE / diode↛proof) | REDUCE | R2 |
| P2 | Lease identity receipt-only; weak case / no E2O/O2O | REDUCE | R1 |
| P2 | TUI untapped; phantom alphabet | ELIMINATE / REDUCE | E3, R1 |
| P2 | Receipts admit gaps; Exp-4 sink empty | RAISE + CREATE | A5, C2 |
| P3 | Affidavit fat WASM vs slim gatekeeper claim | REDUCE | R5 |
| P3 | FFB NOT GA / `@fnox/*` fiction | ELIMINATE | E4 |
| P3 | Seed-7 sibling barriers / Zero-HITL residuals | REDUCE | R3 |
| P3 | Sub-10ns / Σ_PQC / 120Hz DOC-ONLY | ELIMINATE (claim) | E1 (+ research plan anti-goals) |

---

## Lie→impl fold (disk evidence after ERRC explore)

Post-ERRC implement residuals closed on disk. These **supersede** explore “NOT CLEAN / residual OPEN” where cited. Re-derived 2026-11-21; not a claim that live `/readyz` is 200.

| Outcome | Disk evidence | Standing |
| --- | --- | --- |
| **twin court** | `zcode-cli.toml` → `twin_parity_self_test_cmd = ["bun","scripts/twin-parity-self-test.ts"]`; script SHA-256 castle↔zcode `*.brand.toml`; C4 honesty table updated (never `["true"]`) | **ALIVE** |
| **ReceiptSink stub** | `src/adapters/receipt-sink.ts` `zcode.dfcm.receipt/1` + `admit:false`/`non_admit:true` + `isDfcmStubNonAdmit`; `receipts/MIGRATION-ALOOP-v2.md` + `HANDWRITTEN.md` | **ALIVE** (honest stub ≠ Chatman-5 admit) |
| **Unmapped cut** | `part_delta`/`result` omitted from `EVENT_TYPES` (**31** names); ontology/gen comments ELIMINATE-3; `PACK_DEMO_ALPHABET` quarantine retained | **ALIVE** |
| **git refuse** | `requireGitDiffZero` **0** matches; loader refuses legacy `require_git_diff_zero` / `require_clean_room_diff` aliases; `test/clean-room-drift.test.ts` falsifier | **ALIVE** (defaults `--check`; dual dry-run path still PARTIAL — A4) |
| **brand AND-gate** | castle + zcode `brands/fourth-watch.brand.toml` `drop_gated_note` / `blast_unlock_primary` = `/readyz` 200 ∧ 2× LOW; `castle/src/publish/brand.rs` floors require ∧ 2× LOW | **ALIVE** (docs); live host still **PARK** |
| **seed7 continue** | `fnox/cos` `Ticker.handle_continue(:catch_up)`; `await_rest_for_one_settled/1` folds `/healthz` 200; commit `00247179` | **ALIVE** (local barriers); live drop still **PARK** |
| **dual-log join** | `sealDualLogJoinIfBothExist` + `scripts/ocel-dual-log-join.ts` + `test/ocel-dual-log-join.test.ts`; commits `70f89e1` / `92f072d` | **ALIVE** (sidecar; no merge/rehash) |
| **castle refuse** | `strip_external_link_schemes` **0** matches under `/Users/sac/castle`; `seal_public_artifact` → `RedactionCourt::admit`; commit `0d61538` | **ALIVE** |
| **gall env strip** | `stripConstructChildEnv` deletes `WORKER_ENV_DENY_NAMES` + `XAAS_SWEEP`; yolo mute-grant residual still OPEN (A3) | **ALIVE** (small half); structural mute-grant **PARTIAL** |

---

## Sibling roster (fill status)

| ID | Lane brief | Agent id | Notification |
| --- | --- | --- | --- |
| E1 | Overclaim / PASS theater | `9ff59279-0b3d-4287-9f5b-b14cf70ad893` | **FILLED** — residuals; GTM/brand mop + AND-gate lie→impl |
| E2 | git-diff fallacy residuals | `5abd7b95-36c6-4830-97e5-ab4129db84a9` | **FILLED** — legacy aliases → refused (lie→impl) |
| E3 | Phantom OCEL alphabet | `b47de4f6-b5f0-4250-aefb-06a8e8eb815a` | **FILLED** — `part_delta`/`result` cut (lie→impl) |
| E4 | `@fnox/*` fiction | `e9b3403d-826d-4fa7-84c7-6b391ce18df5` | **FILLED** — shipping fiction mopped on cited surfaces |
| E5 | Strip-and-ship redaction | `a1072a10-3837-425c-b17e-45b7c7ddc156` | **FILLED** — explore NOT CLEAN → refuse lie→impl |
| R1 | Dual-log OCEL / weak case | `f6104548-f09f-45f2-9991-4fa103ae7ff3` | **FILLED** — join sidecar lie→impl; attrs/TUI remain |
| R2 | C4 Rel noise | `a4478193-83fa-4fa0-9913-3fea0e89000f` | **FILLED** — Rel caption mop on disk |
| R3 | Seed-7 cascade | `2fce064f-43a3-49ad-8dcb-532ac506f16a` | **FILLED** — `handle_continue` + healthz fold |
| R4 | GTM false-ready | `def71167-6da9-4b01-a20f-9abf09b4d60e` | **FILLED** — sibling ack-only; cos GTM honesty AND-gate + DO NOT PUBLISH re-derived on disk |
| R5 | Fat WASM claims | `183e65cc-facf-45e4-9bd1-0a9249d06e29` | **FILLED** — slim=gatekeeper CLEAN in affidavit |
| A1 | OCEL redaction verify | `067161a1-2117-43b9-9463-607a5dd817c4` | **FILLED** — PARTIAL; fail-closed gaps open |
| A2 | Castle publish verify | `64b1dcef-caa6-4a20-97d4-610e654ad78d` | **FILLED** — CLEAN + brand AND-gate raise |
| A3 | xaas gate verify | `7e936743-bb5d-4f57-8e51-872492d43e27` | **FILLED** — cache≡source; yolo mute OPEN |
| A4 | Sync-check raise | `30e4dba8-080c-4f88-997e-20dffa049ae5` | **FILLED** — defaults hold; “sole” overstated |
| A5 | Receipt ALOOP raise | `5df9ceaf-1e04-4db0-a4ab-118e675723e4` | **FILLED** — honesty path; no mass-rewrite |
| C1 | Operator readyz runbook | `8eb5aec8-08dc-492e-9683-2187eaed7f74` | **FILLED** — `OPERATOR-AND-GATE-readyz.md` |
| C2 | Exp-4 pilot scaffold | `e1818c87-2b40-42bf-9802-de4df03792e6` | **FILLED** — refuse stub + empty runs |
| C3 | LOW receipt schema | `82eea865-7384-4dbc-b47b-c220bc0334c9` | **FILLED** — `fnox/cos/docs/gtm/receipts/` **0×** |
| C4 | Twin self-test pin | `03dd00a1-506f-40d3-ae53-36c0d6ad5721` | **FILLED** — stub → real twin court lie→impl |
| C5 | ERRC synthesis register (this file) | `6219961a-ff41-4039-ba8b-788e110f44ec` | **FILLED** — matrix + lie→impl fold |

**Roster fill count (re-derive):** non-`PENDING_SIBLING` / non-empty notifications = **20/20** explore+create lanes named; R4 = **FILLED** (ack-only sibling + disk GTM honesty; live `/readyz` remains **PARK**).

---

## Column legend (SoT)

| Column | Rule |
| --- | --- |
| **Item** | One backlog atom; exactly one ERRC quadrant |
| **Construct seed** | What the construct seal / gap register claimed — historical |
| **SoT path / command** | Path or shell that re-derives truth (`source_command` style); empty → fill from sibling |
| **Verified** | Post-sibling standing only: ALIVE / PARTIAL / DOC-ONLY / MISSING / UNVERIFIED / PARK |
| **Proposed action** | Bounded next step from sibling; or `PENDING_SIBLING` |
| **safeToVerify** | `yes` / `park` — park security & preference tension |
| **Sibling** | Lane id + agent id when filled |

Do **not** copy `Construct seed` into `Verified`.

---

## Eliminate

| Item | Construct seed | SoT path / command | Verified | Proposed action | safeToVerify | Sibling |
| --- | --- | --- | --- | --- | --- | --- |
| C/D “cleared” / PASS theater without 2× LOW receipts | Gap P0: 0× LOW-PASS; DOC theater | `rg -n 'Lawful count' /Users/sac/fnox/cos/docs/gtm/receipts/PAIR-INDEX.md` → **0×**; C/D = UNFILED | **PARTIAL** — PASS theater scrubbed in JOBS-LOCK; placeholders exist, count stays 0× | Keep 0× law; never rewrite C/D into PASS; file real LOW only after `/readyz` 200 | park if unlock-predicate rewrite | E1 `9ff59279…` + C3 |
| False unlock predicates / 7/8 DONE overclaim prose | Gap P1; seal honesty bar = no PASS theater | castle+zcode `fourth-watch.brand.toml` `drop_gated_note` ∧ `blast_unlock_primary`; `brand.rs` floors | **ALIVE** (brand AND-gate on disk); live unlock still **PARK** | Hold AND-gate prose; operator sequence = C1 only; no `/readyz`-alone unlock | yes (docs); park (live) | E1 + brand AND-gate lie→impl |
| `git diff == 0` as drift gate residuals | Construct raised `--check`; E2 hunts residuals | `rg requireGitDiffZero` → 0; `src/adapters/index.ts` refuses legacy aliases; `test/clean-room-drift.test.ts` | **ALIVE** for git-refuse; dual dry-run/`planned_writes` path still **PARTIAL** (A4) | Keep legacy aliases dead; raise sole-gate honesty separately (A4) | yes | E2 `5abd7b95…` + git refuse lie→impl |
| Phantom OCEL alphabet (`order_hook` et al.) | Gap P2 completeness | `src/generated/ocel.ts` `EVENT_TYPES` length **31**; no `part_delta`/`result` | **ALIVE** cut; keep `PACK_DEMO_ALPHABET` quarantine | Do not re-cut cleared names; document Unmapped bias only | yes | E3 `b47de4f6…` + Unmapped cut lie→impl |
| `@fnox/*` / RAID-GA / unpublished npm fiction | Gap P1/P3; research anti-goals | zcode `docs/gtm/*` honesty fences; castle `v26.11.20-PRFAQ.md` honesty fence; `FFB-IDENTITY-FORK` | **PARTIAL** → cited shipping fiction mopped to on-disk/compat-only | Spot-check new GTM copy against fork; no `@fnox/*` GA voice | yes | E4 `e9b3403d…` |
| Strip-then-admit on CASTLE publish | Construct claimed refuse-only court | `rg strip_external_link_schemes /Users/sac/castle` → **0**; `seal_public_artifact` → `admit` | **ALIVE** refuse-only (post lie→impl; explore had pre-seal strip) | Keep strip APIs out of publish wire; Chicago refuse courts stay green | yes | E5 `a1072a10…` + castle refuse lie→impl |
| Performance DOC-ONLY treated as ALIVE (120Hz / 5k / 340ns / 113k / Σ_PQC) | Research plan §4 anti-goals | `docs/research/2027-operating-week-research-plan.md` + C4 honesty tags | **DOC-ONLY** (correct standing) | Eliminate any ALIVE voice for unmet perf/PQC claims | yes | E1 (+ mop) |

---

## Reduce

| Item | Construct seed | SoT path / command | Verified | Proposed action | safeToVerify | Sibling |
| --- | --- | --- | --- | --- | --- | --- |
| Dual-log OCEL correlation gaps (stream vs gall, empty attrs, TUI filter bias) | Lease objects promoted in construct; case still weak | `src/ocel-tap.ts` `sealDualLogJoinIfBothExist`; `scripts/ocel-dual-log-join.ts`; `test/ocel-dual-log-join.test.ts` | **PARTIAL** — join sidecar **ALIVE**; empty non-identity attrs + TUI tee remain | Next: thin allowlisted attrs / case projection; park TUI tee | yes | R1 `f6104548…` + dual-log join lie→impl |
| C4 Rel overclaim noise (fortune5 / BRCE / diode↛proof) | Gap P1 fitness | `docs/c4-sovereign-ecosystem.md` Rel honesty + DOC-ONLY tags (Zero-diff replaced; WebTransport/16B/28B/$0.22 tagged) | **PARTIAL** — big ↛ + caption mop landed; some Rel essays still architecture theater | Shorten residual essays; keep twin/Affidavit pins synced to disk | yes | R2 `a4478193…` |
| Seed-7 cascade / sibling barrier noise | Construct: seed-7 **13 pass** local; live drop still 503 | `lib/fnox_cos/schedulers/ticker.ex` `handle_continue(:catch_up)`; `fixtures.exs` `await_rest_for_one_settled` ∧ `/healthz` | **PARTIAL** — continue + healthz fold **ALIVE**; `/healthz` still liveness-only | Re-run seed-7 suite on residual flake; park nested-supervisor reshape | yes | R3 `2fce064f…` + seed7 continue lie→impl |
| GTM false-ready framing while `/readyz` ≠ 200 | Seal: live **503**; honesty = 200 ∧ 2× LOW | `/Users/sac/fnox/cos/docs/gtm/JOBS-LOCK-NOV21-RUNBOOK.md` §1 AND-gate **NOT MET**×3; `L10-readyz-DB_UNAVAILABLE-receipt.md` last probe **503 DB_UNAVAILABLE**; `receipts/PAIR-INDEX.md` **Lawful count today: 0×**; draft banners **DO NOT PUBLISH** on `WEEK1-LINKEDIN-CAROUSEL-80PCT-READY-MIRAGE.md` · `WEEK1-PERSONAL-NEWSLETTER-ISSUE-01.md` · `YEAR-END-SOW-1PAGE.md`; `OPERATOR-AND-GATE-readyz.md` (`/readyz` alone ≠ unlock); brand `blast_unlock_primary` / `drop_gated_note` (castle+zcode `brands/fourth-watch.brand.toml`) | **PARTIAL** — GTM honesty fences **ALIVE** (AND-gate + DO NOT PUBLISH); live host **PARK** (503); gate-2 **0×** | Hold DRAFT/refine-only; never blast on ExUnit / UNFILED C/D / `/readyz`-alone / 2×-LOW-alone; operator AND-gate = C1; LOW fill = C3 post-200 | park (live outbound); yes (doc fences) | R4 `def71167…` (ack-only) + cos GTM disk |
| Fat Affidavit WASM pointed at as gatekeeper | Construct slim **28673 B** ALIVE; fat **718736** remains | `wc -c …/affidavit_gatekeeper_verify_witness.wasm` → **28673**; fat pin `affidavit-wasm/registry/ARTIFACTS.sha256` **718736** | **ALIVE** slim=gatekeeper; fat=provenance only | Keep C4/JOBS/research pointing at slim; fat ≠ gatekeeper | yes | R5 `183e65cc…` |

---

## Raise

| Item | Construct seed | SoT path / command | Verified | Proposed action | safeToVerify | Sibling |
| --- | --- | --- | --- | --- | --- | --- |
| OCEL credential redaction + hash-chain integrity | Construct: redaction/`chain_intact` green | `src/ocel-tap.ts` redactors + `verifyChain`; vs `docs/CAPABILITY_SNAPSHOT.md` / `capability-snapshot.sh` | **PARTIAL** — prior P0 closed; no fail-closed refuse-after-redact; TOML/`pwd` drift; lease identity re-inject | RAISE fail-closed seal gate; redact-or-refuse identity fields; sync snapshot.sh `pwd` | yes | A1 `067161a1…` |
| CASTLE publish refuse-only + brand-required + F-ANON-3 | Construct: court/brand/F-ANON-3 green | castle wire/brand/anonymize + brand AND-gate floors; strip helpers gone | **ALIVE** (F-ANON-3 / `--brand` / refuse court / AND-gate docs) | Hold refuse law; optional Chicago re-run after strip cut | yes | A2 `64b1dcef…` + castle refuse + brand AND-gate |
| xaas gate fail-closed at installed cache ≡ source | Construct: cache **26.9.22** ≡ source | `~/.zcode/.../xaas-fabric/26.9.22/` ≡ source markers; `gall-work.ts` yolo + mute allow | **PARTIAL** — cache≡source; yolo mute-grant **OPEN**; env strip = small half only | P0: non-yolo headless permission client; keep `stripConstructChildEnv` | yes | A3 `7e936743…` + gall env strip |
| Sync-check / igniter `--check` as sole drift gate | Construct: git-diff fallacy killed; 84 pass claim | `DEFAULT_CLEAN_ROOM_CHECK_CMD`; SPEC dual-gate; exit-0 passthrough hole | **PARTIAL** — `--check` default **ALIVE**; “sole” claim false | Doc/code agree on dual Jobs path or fail-closed require `--check` | yes | A4 `30e4dba8…` |
| Receipt ALOOP lawful admit path (no mass-rewrite theater) | Gap P2: admit corpus thin; golden ALOOP witness exists | `receipts/_template.json`; `MIGRATION-ALOOP-v2.md`; ReceiptSink stub; `exp4/` scaffold | **PARTIAL** — honesty path **ALIVE**; historical corpus unadmitted | New filings via template + validate; case-by-case migrate only; no mass rewrite | yes | A5 `5df9ceaf…` + ReceiptSink stub |

---

## Create

| Item | Construct seed | SoT path / command | Verified | Proposed action | safeToVerify | Sibling |
| --- | --- | --- | --- | --- | --- | --- |
| Operator `/readyz` runbook (billing→JWKS→migrate→redeploy) | Operator-only AND-gate; live 503 | `/Users/sac/fnox/cos/docs/gtm/OPERATOR-AND-GATE-readyz.md` exists; L10 last probe **503** | **DOC-ONLY** runbook **ALIVE**; live host **PARK** | Operator executes fragment; agents do not claim 200 | park (live secrets/ops) | C1 `8eb5aec8…` |
| Exp-4 pilot scaffold (empty sink OK; no fake REPORT) | `receipts/v26.11.20/exp4/` empty by SPEC honesty | `scripts/exp4-ocel-mining-pilot.ts` refuse stub; `exp4/PLAN.md`; no `REPORT.md`; `runs/` sink | **ALIVE** scaffold (`NOT_ALIVE` standing intentional) | Keep refuse stub until live `ZCODE_OCEL=1` pilot | yes | C2 `e1818c87…` |
| Durable 2× LOW skeptic receipt schema/path | 0× LOW-PASS; C/D theater | `/Users/sac/fnox/cos/docs/gtm/receipts/{README,_TEMPLATE,PAIR-INDEX,re-skeptic-C/D}` | **ALIVE** schema; lawful count **0×** | Fill LOW only post-`/readyz` 200; placeholders ≠ PASS | yes | C3 `82eea865…` |
| Twin self-test pin (castle↔zcode brand/anonymize) | Construct: twins byte-identical claim | `twin_parity_self_test_cmd=["bun","scripts/twin-parity-self-test.ts"]`; script on disk | **ALIVE** brand twin court (upgraded from CREATE-4 `["true"]` stub) | Keep pin; never reintroduce noop `["true"]` | yes | C4 `03dd00a1…` + twin court lie→impl |
| This ERRC synthesis register | CREATE-5 deliverable | `docs/research/ERRC-2026-11-22-construct-wave.md` | **ALIVE** (filled matrix + lie→impl + R4) | Append cycles on new evidence only; live `/readyz` stays PARK | yes | C5 `6219961a…` |

---

## Parked (do not auto-resolve)

| Item | Why parked | Owner |
| --- | --- | --- |
| Live `/readyz` 200 | Operator billing `018FD7` → JWKS → migrate → redeploy; L10 last probe **503 DB_UNAVAILABLE** | Operator |
| LinkedIn outbound | Explicit stop-work | Operator |
| bypass / security-posture prefs (if any sibling surfaces) | `errc-cycle` park law | Operator |
| Preference tensions in GTM unlock criteria | Ambiguous product preference | Operator |
| xaas yolo mute-grant structural close | Needs non-yolo headless permission client (A3); env strip ≠ close | Operator / RAISE follow-on |
| TUI OCEL tee | Deliberate population bias; not dual-log join (R1 park) | Operator / future CREATE |

---

## SoT drift guards (add checks when siblings land)

When a sibling publishes a **count or live status** into this file, add or run a `source-of-truth-check` entry rather than hand-mirroring. Starter candidates:

| Fact | Intended `source_command` (fill when known) | Mirror in this file |
| --- | --- | --- |
| Sibling notification fill count | count roster rows whose Notification ≠ `PENDING_SIBLING` | Roster `Notification` column → **20/20 FILLED** |
| Live `/readyz` code | probe only via operator; do not agent-curl as PASS | Reduce R4 / Create C1 → **PARK** (L10: 503) |
| GTM AND-gate / DO NOT PUBLISH | `rg -n 'AND-gate|DO NOT PUBLISH|Lawful count today' /Users/sac/fnox/cos/docs/gtm/` | Reduce R4 → AND **NOT MET**; drafts fenced; **0×** LOW |
| Affidavit slim WASM bytes | `wc -c /Users/sac/affidavit/affidavit-gatekeeper-wasm/dist/affidavit_gatekeeper_verify_witness.wasm` | Reduce R5 → **28673** |
| Exp-4 sink emptiness | `find receipts/v26.11.20/exp4/runs -type f ! -name .gitkeep \| wc -l` | Create C2 → empty / no `REPORT.md` |
| LOW pair lawful count | `rg -n 'Lawful count today' /Users/sac/fnox/cos/docs/gtm/receipts/PAIR-INDEX.md` | Create C3 → **0×** |
| OCEL EVENT_TYPES size | parse `EVENT_TYPES` in `src/generated/ocel.ts` | Eliminate E3 → **31** |
| Twin pin argv | `rg -n '^twin_parity_self_test_cmd' zcode-cli.toml` | Create C4 → bun script, not `["true"]` |
| Castle strip helper | `rg -n strip_external_link_schemes /Users/sac/castle --glob '!target/**'` | Eliminate E5 → **0** |

Run: `python3 ~/.claude/scripts/source-of-truth-check.py` before treating any mirrored count as current. (Global checks clean as of fill; add project-local checks when promoting counts into `~/.claude/scripts/source-of-truth-checks.json`.)

---

## Cycle 2026-11-21 — sibling fill + lie→impl

1. Drained E1–E5 · R1–R5 · A1–A5 · C1–C5 notifications from agent transcripts; **R4 FILLED** (sibling `def71167…` ack-only → disk cos GTM honesty).
2. Folded lie→impl disk outcomes (twin court, ReceiptSink stub, Unmapped cut, git refuse, brand AND-gate, seed7 continue, dual-log join, castle refuse, gall env strip).
3. Struck construct “green” where siblings falsified (A1 fail-closed; A3 yolo mute; A4 sole-gate; E5 explore strip — later closed by refuse commit).
4. **Parked** live `/readyz` 200 + LinkedIn; no agent PASS claim.
5. R4 reduce checklist (false-ready residual): drafts may refine under **DO NOT PUBLISH**; blast stays stop-worked until AND-gate; never treat ExUnit / UNFILED C/D / `/readyz`-alone / 2×-LOW-alone as unlock.
6. Next safe execute (one item): RAISE A1 fail-closed seal gate, or operator C1 AND-gate sequence — not a bulk DONE sweep.

**CREATE-5 exit criterion (updated):** four quadrant tables filled from sibling+disk evidence (incl. R4); SoT columns named; lie→impl folded; operator `/readyz` remains **PARK** — **not** a claim the ERRC backlog is drained.

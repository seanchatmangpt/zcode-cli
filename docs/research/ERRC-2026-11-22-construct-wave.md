# ERRC matrix — post-construct wave (2026-11-22)

**Lane:** CREATE-5 (ERRC synthesis register)  
**Status:** durable **template** — seeded from known construct outcomes only; sibling ERRC lanes not yet folded in  
**Authority:** `errc-cycle` + `source-of-truth-check` (no second-file status theater)  
**Date context:** 2026-11-21 launch → register labeled 2026-11-22  
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

## Sibling roster (fill status)

| ID | Lane brief | Agent id | Notification |
| --- | --- | --- | --- |
| E1 | Overclaim / PASS theater | `9ff59279-0b3d-4287-9f5b-b14cf70ad893` | PENDING_SIBLING |
| E2 | git-diff fallacy residuals | `5abd7b95-36c6-4830-97e5-ab4129db84a9` | PENDING_SIBLING |
| E3 | Phantom OCEL alphabet | `b47de4f6-b5f0-4250-aefb-06a8e8eb815a` | PENDING_SIBLING |
| E4 | `@fnox/*` fiction | `e9b3403d-826d-4fa7-84c7-6b391ce18df5` | PENDING_SIBLING |
| E5 | Strip-and-ship redaction | `a1072a10-3837-425c-b17e-45b7c7ddc156` | PENDING_SIBLING |
| R1 | Dual-log OCEL / weak case | `f6104548-f09f-45f2-9991-4fa103ae7ff3` | PENDING_SIBLING |
| R2 | C4 Rel noise | `a4478193-83fa-4fa0-9913-3fea0e89000f` | PENDING_SIBLING |
| R3 | Seed-7 cascade | `2fce064f-43a3-49ad-8dcb-532ac506f16a` | PENDING_SIBLING |
| R4 | GTM false-ready | `def71167-6da9-4b01-a20f-9abf09b4d60e` | PENDING_SIBLING |
| R5 | Fat WASM claims | `183e65cc-facf-45e4-9bd1-0a9249d06e29` | PENDING_SIBLING |
| A1 | OCEL redaction verify | `067161a1-2117-43b9-9463-607a5dd817c4` | PENDING_SIBLING |
| A2 | Castle publish verify | `64b1dcef-caa6-4a20-97d4-610e654ad78d` | PENDING_SIBLING |
| A3 | xaas gate verify | `7e936743-bb5d-4f57-8e51-872492d43e27` | PENDING_SIBLING |
| A4 | Sync-check raise | `30e4dba8-080c-4f88-997e-20dffa049ae5` | PENDING_SIBLING |
| A5 | Receipt ALOOP raise | `5df9ceaf-1e04-4db0-a4ab-118e675723e4` | PENDING_SIBLING |
| C1 | Operator readyz runbook | `8eb5aec8-08dc-492e-9683-2187eaed7f74` | PENDING_SIBLING |
| C2 | Exp-4 pilot scaffold | `e1818c87-2b40-42bf-9802-de4df03792e6` | PENDING_SIBLING |
| C3 | LOW receipt schema | `82eea865-7384-4dbc-b47b-c220bc0334c9` | PENDING_SIBLING |
| C4 | Twin self-test pin | `03dd00a1-506f-40d3-ae53-36c0d6ad5721` | PENDING_SIBLING |
| C5 | ERRC synthesis register (this file) | `6219961a-ff41-4039-ba8b-788e110f44ec` | **TEMPLATE_WRITTEN** — matrix empty of sibling verdicts |

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
| C/D “cleared” / PASS theater without 2× LOW receipts | Gap P0: 0× LOW-PASS; DOC theater | `fnox/cos/docs/gtm/` runbooks + receipt paths named therein | PENDING_SIBLING | PENDING_SIBLING | park if unlock-predicate rewrite | E1 `9ff59279…` |
| False unlock predicates / 7/8 DONE overclaim prose | Gap P1; seal honesty bar = no PASS theater | GTM / Jobs runbook live claims vs receipt existence | PENDING_SIBLING | PENDING_SIBLING | yes | E1 |
| `git diff == 0` as drift gate residuals | Construct raised `--check`; E2 hunts residuals | Prefer `mix ggen_igniter.sync --check` citations only | PENDING_SIBLING | PENDING_SIBLING | yes | E2 `5abd7b95…` |
| Phantom OCEL alphabet (`order_hook` et al.) | Gap P2 completeness | Ontology / generated enums vs tap emitters | PENDING_SIBLING | PENDING_SIBLING | yes | E3 `b47de4f6…` |
| `@fnox/*` / RAID-GA / unpublished npm fiction | Gap P1/P3; research anti-goals | Docs claiming published `@fnox/*` | PENDING_SIBLING | PENDING_SIBLING | yes | E4 `e9b3403d…` |
| Strip-then-admit on CASTLE publish | Construct claimed refuse-only court | `castle` publish/seal path vs `RedactionCourt::admit` | PENDING_SIBLING | PENDING_SIBLING | yes | E5 `a1072a10…` |
| Performance DOC-ONLY treated as ALIVE (120Hz / 5k / 340ns / 113k / Σ_PQC) | Research plan §4 anti-goals | `docs/research/2027-operating-week-research-plan.md` + SoT mop | PENDING_SIBLING | PENDING_SIBLING | yes | E1 (+ mop) |

---

## Reduce

| Item | Construct seed | SoT path / command | Verified | Proposed action | safeToVerify | Sibling |
| --- | --- | --- | --- | --- | --- | --- |
| Dual-log OCEL correlation gaps (stream vs gall, empty attrs, TUI filter bias) | Lease objects promoted in construct; case still weak | `src/ocel-tap.ts`, gall-work join surfaces | PENDING_SIBLING | PENDING_SIBLING | yes | R1 `f6104548…` |
| C4 Rel overclaim noise (fortune5 / BRCE / diode↛proof) | Gap P1 fitness | `docs/c4-sovereign-ecosystem.md` Rel edges vs receipts | PENDING_SIBLING | PENDING_SIBLING | yes | R2 `a4478193…` |
| Seed-7 cascade / sibling barrier noise | Construct: seed-7 **13 pass** local; live drop still 503 | Seed-7 harness + barrier inventory | PENDING_SIBLING | PENDING_SIBLING | yes | R3 `2fce064f…` |
| GTM false-ready framing while `/readyz` ≠ 200 | Seal: live **503**; honesty = 200 ∧ 2× LOW | Live probe + GTM prose | PENDING_SIBLING | PENDING_SIBLING | park (operator AND-gate) | R4 `def71167…` |
| Fat Affidavit WASM pointed at as gatekeeper | Construct slim **28673 B** ALIVE; fat **718736** remains | Affidavit docs/WASM paths vs slim pack size | PENDING_SIBLING | PENDING_SIBLING | yes | R5 `183e65cc…` |

---

## Raise

| Item | Construct seed | SoT path / command | Verified | Proposed action | safeToVerify | Sibling |
| --- | --- | --- | --- | --- | --- | --- |
| OCEL credential redaction + hash-chain integrity | Construct: redaction/`chain_intact` green | `bun test` redaction suite; chain witness | PENDING_SIBLING | PENDING_SIBLING | yes | A1 `067161a1…` |
| CASTLE publish refuse-only + brand-required + F-ANON-3 | Construct: court/brand/F-ANON-3 green | Castle test courts + brand CLI | PENDING_SIBLING | PENDING_SIBLING | yes | A2 `64b1dcef…` |
| xaas gate fail-closed at installed cache ≡ source | Construct: cache **26.9.22** ≡ source | Installed plugin cache hash vs source | PENDING_SIBLING | PENDING_SIBLING | yes | A3 `7e936743…` |
| Sync-check / igniter `--check` as sole drift gate | Construct: git-diff fallacy killed; 84 pass claim | Emitters + docs citing only `--check` | PENDING_SIBLING | PENDING_SIBLING | yes | A4 `30e4dba8…` |
| Receipt ALOOP lawful admit path (no mass-rewrite theater) | Gap P2: admit corpus thin; golden ALOOP witness exists | `receipts/**`, `bun run receipts:validate` | PENDING_SIBLING | PENDING_SIBLING | yes | A5 `5df9ceaf…` |

---

## Create

| Item | Construct seed | SoT path / command | Verified | Proposed action | safeToVerify | Sibling |
| --- | --- | --- | --- | --- | --- | --- |
| Operator `/readyz` runbook (billing→JWKS→migrate→redeploy) | Operator-only AND-gate; live 503 | `fnox/cos/docs/gtm/` operator checklist paths | PENDING_SIBLING | PENDING_SIBLING | park (live secrets/ops) | C1 `8eb5aec8…` |
| Exp-4 pilot scaffold (empty sink OK; no fake REPORT) | `receipts/v26.11.20/exp4/` empty by SPEC honesty | `receipts/v26.11.20/README.md` + SPEC Exp-4 | PENDING_SIBLING | PENDING_SIBLING | yes | C2 `e1818c87…` |
| Durable 2× LOW skeptic receipt schema/path | 0× LOW-PASS; C/D theater | GTM receipts dir convention | PENDING_SIBLING | PENDING_SIBLING | yes | C3 `82eea865…` |
| Twin self-test pin (castle↔zcode brand/anonymize) | Construct: twins byte-identical claim | Twin hash / self-test pin path | PENDING_SIBLING | PENDING_SIBLING | yes | C4 `03dd00a1…` |
| This ERRC synthesis register | CREATE-5 deliverable | `docs/research/ERRC-2026-11-22-construct-wave.md` | **PARTIAL** (template only) | Coordinator fills Verified/action from sibling notifications; then append cycle log | yes | C5 `6219961a…` |

---

## Parked (do not auto-resolve)

| Item | Why parked | Owner |
| --- | --- | --- |
| Live `/readyz` 200 | Operator billing `018FD7` → JWKS → migrate → redeploy | Operator |
| LinkedIn outbound | Explicit stop-work | Operator |
| bypass / security-posture prefs (if any sibling surfaces) | `errc-cycle` park law | Operator |
| Preference tensions in GTM unlock criteria | Ambiguous product preference | Operator |

---

## SoT drift guards (add checks when siblings land)

When a sibling publishes a **count or live status** into this file, add or run a `source-of-truth-check` entry rather than hand-mirroring. Starter candidates (commands to be filled only after sibling names the exact SoT):

| Fact | Intended `source_command` (fill when known) | Mirror in this file |
| --- | --- | --- |
| Sibling notification fill count (0–19 + C5) | count non-`PENDING_SIBLING` rows in roster | Roster `Notification` column |
| Live `/readyz` code | curl/probe exit or documented probe script | Reduce R4 / Create C1 Verified |
| Affidavit slim WASM bytes | `wc -c` / package size receipt | Reduce R5 |
| Exp-4 sink emptiness | `find receipts/v26.11.20/exp4 -type f …` | Create C2 |
| Receipt validate admit count | `bun run receipts:validate` (or script JSON) | Raise A5 |

Run: `python3 ~/.claude/scripts/source-of-truth-check.py` before treating any mirrored count as current.

---

## Next recommendation (coordinator)

1. Drain sibling notifications → fill `Verified` + `Proposed action` only.  
2. Strike or demote any construct-seal “green” that a skeptic sibling falsifies.  
3. Execute **one** safe ELIMINATE or RAISE item with a named falsifier — not a bulk DONE sweep.  
4. Append a dated `## Cycle` entry here (or to a dedicated tracker) only after fills land.

**CREATE-5 exit criterion:** this file exists with four quadrant tables, SoT columns, construct seeds, and explicit `PENDING_SIBLING` discipline — **not** a claim that the ERRC cycle completed.

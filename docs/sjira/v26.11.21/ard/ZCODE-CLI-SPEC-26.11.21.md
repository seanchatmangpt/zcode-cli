# ZCODE-CLI-SPEC-26.11.21 — Dogfood ARD (Explore remainder × Exploit queue)

| Field | Value |
|---|---|
| **Document ID** | `ZCODE-CLI-SPEC-26.11.21` |
| **Milestone** | `v26.11.21` |
| **Base SHA** | `2580032e6933d2c850918ccdf3d132d506a34726` (post-integrity `main`) |
| **Supersedes (wave)** | Residual honesty/QMS items left after `v26.11.20` integrity PR wave |
| **Inherits** | [`../v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md`](../../v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md) §0.3 honest formalism |
| **Authority ceiling** | `CONSTRUCT` |

---

## 1. Purpose

Agents must **dogfood** zcode-cli’s own loop — sJira frontier → POWL → OCEL/receipts → marketplace/igniter/foundry courts — while finishing **Explore-clean** work that the integrity wave deliberately did not close, and **queueing Exploit** upgrades without marketing them as present.

This ARD is short and operational. The long-form process-science contract remains SPEC-26.11.20.

## 2. What already landed (do not re-open)

Integrity PRs **#21–#36+#38** on `main` @ `2580032`: HANDWRITTEN lock; case FSM; leases; TUI `--print` tap; AIMD no-`serviceMs` MD; path/`maxCycles`; token conservation; receipt integrity floor; redaction; runtime tap; C4 honesty; courts; WF-net soundness; drainSilent; SQLite; OCEL schema; POWL write-scopes.

Treat those subjects as **ALIVE for integrity**, not as completed Explore Exp-1..4 or Exploit X1–X4.

## 3. Explore lane (honesty / QMS / dogfood)

Tagged `[EXPLORE-SCOPE]`. Frontier orders `ZCODE-261121-01` … `10`:

1. **Dogfood harness** — absolute `GGEN_BIN`, frontier/candidates → POWL → foundry dry-run, honest `0/1/2/3`, fail-closed courts.
2. **Calver / lock / AGENTS drift** — single provenance narrative.
3. **STANDING-RECEIPT re-cert** — bind standing to post-integrity HEAD (E2 stale×N).
4. **HDDL + pyshacl corpus** — ferroplan `(define (problem …) (:htn …))`; dispose legacy `defproblem` / missing `originAuthority` honestly.
5. **Vendor-free CI + Chicago timeout** — first-class gates, not per-PR band-aids.
6. **Interactive TUI OCEL** — measure or `UNSUPPORTED`; D4 headless path already fixed.
7. **XAAS PreToolUse live gate** — observe deny/defer under `XAAS_WORKER=1` or `UNSUPPORTED(host)`.
8. **Annex IV / Art.11 pack** — engineering technical file; no conformity claim.
9. **order_hook / MxLoop leakage** — pack-owned; never hand-edit `src/generated/`.
10. **WorkspaceFingerprint stub** — Explore measurements only; feeds Exploit X1.

## 4. Exploit lane (queued upgrades)

Tagged `[EXPLOIT-UPGRADE]`. Orders `11` … `15` depend on dogfood `01` ALIVE (`12` also on `10`):

| # | Upgrade | SPEC hook |
|---|---|---|
| 11 | A★ trace alignment (`γ=0`) | X2 / `alignTraceAStar` |
| 12 | Transactional lifecycle + rollback | X1 / `expandTransactionalLifecycle` |
| 13 | OCPN / OC-DFG discovery | X4 / `ocel-discover` |
| 14 | Kingman / TTFT + TPM/RPM AIMD | X3 |
| 15 | Per-signature remediation caps | `maxRemediationAttempts` / HANDOFF |

**Rule:** Exploit work must not change Explore fitness/AIMD *marketing* or silently alter baselines. Token-replay \(f\) remains a completion heuristic until 11 is ALIVE.

## 5. Dogfood acceptance (meta)

A milestone dogfood pass is green only when:

- `ZCODE-261121-01` has an exact-head receipt (courts fail-closed; no fake ALIVE).
- At least one additional Explore order closes with honest standing (including `UNSUPPORTED` where capability is absent).
- Exploit orders remain `UNKNOWN` or advance only behind their dependency receipts.
- No edits to `vendor/` or hand-patches under `src/generated/`.

## 6. Out of repo scope

Fourth Watch / CindyCat / GCP billing / FFB / Smalt / CASTLE product claims / xaas application code — composition context only (SPEC Appendix F). Do not invent them here.

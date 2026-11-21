# Instructions for Use — `zcode-cli` (EU AI Act Article 13)

**Document Status**: Technical Deployer Documentation under Regulation (EU) 2024/1689 (EU AI Act), Article 13(3)(a)–(f).

---

## 1. Provider Identity & System Identification — Art. 13(3)(a)

- **System Name**: `zcode-cli` (`zcode-app-cli`)
- **Provider / Maintainer**: Kingsword09 & zcode-cli contributors (`https://github.com/kingsword09/zcode-cli`)
- **License**: MIT (vendored runtime notices in `LICENSES/`)
- **Runtime Lock Provenance**: `zcode-runtime.lock.json` (`appVersion: 3.14.4`, `cliVersion: 0.16.9`, SHA-512 pinned)
- **Compliance Verification CLI**: `zcode compliance info --json` / `zcode version --compliance`

---

## 2. Intended Purpose, Capabilities & Limitations — Art. 13(3)(b)

### 2.1 Intended Purpose
`zcode-cli` is a thin terminal/TUI launcher and EU AI Act process-intelligence compliance layer around the vendored ZCode coding-agent runtime. It supports supervised software engineering workflows (code reading, structured edits, test execution, and compliance verification) strictly under the `CONSTRUCT` authority ceiling and human-in-the-loop oversight.

### 2.2 Characteristics & Technical Controls
- **Art. 50 Transparency**: Direct AI interaction notices in TUI/headless `--json`/`stream-json` (`system.disclosure` / `ai_disclosure`) and machine-readable Art. 50(2) provenance sidecars (`.zcode-provenance/<session>.json`), Markdown provenance comments, and git trailers (`AI-Generated-By`).
- **Art. 12 Record-Keeping**: Tamper-evident SHA-256 hash-chained IEEE OCEL 2.0 event logs (`pi_hash`, `pi_parent`, `pi_attr_sha256`, `pi_obj_sha256`) persisted across JSON, WAL-mode SQLite (`node:sqlite`), and OCEL 2.0 XML with `>= 180`-day retention enforcement.
- **Art. 15 Accuracy, Robustness & Cybersecurity**:
  - POWL v2 soundness-by-construction workflow orchestration (`src/powl-ocel-orchestrator.ts`).
  - Optimal $A^*$ synchronous-product trace alignment ($\gamma = 0$ on conforming traces, exact `log_move` / `model_move` diagnostics).
  - Declare/LTLf temporal verification with explicit anti-vacuity separation (`SATISFIED_WITNESSED` vs `SATISFIED_VACUOUS` vs `VIOLATED`).
  - Bounded transactional lifecycle nets with workspace snapshot rollback (`workspace_rolled_back`) and per-signature retry caps (`RETRY_BUDGET_EXHAUSTED`).
  - Ingest-time secret, JWT, PEM, and GDPR PII redaction (`src/compliance/redactor.ts`) + Responsible Process Mining (FACT) $k$-anonymity & HMAC pseudonymization.

### 2.3 Prohibited & Out-of-Scope Uses
The following uses are **explicitly prohibited or out-of-scope**:
1. **Unattended Autonomous Safety-Critical Actuation**: Deploying `zcode-cli` in critical infrastructure, medical, aviation, or physical-safety actuation without an active named human overseer (`[deployer].overseer_id`).
2. **Permission Bypass Under Regulated Profiles**: Enabling `--mode yolo`, `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, `--permission-mode dontAsk`, `ZCODE_ALLOW_YOLO=1`, or `[compliance].allow_yolo = true` under `high-risk-annex-iii` or `high-risk-annex-i` (refused fail-closed with `OVERSIGHT_POLICY_REFUSED`).
3. **Suppression of Art. 50 Disclosures**: Setting `ZCODE_SUPPRESS_DISCLOSURE=1` or stripping provenance seals under regulated profiles (`DISCLOSURE_REQUIRED` / `PROVENANCE_SEAL_FAILED`).
4. **Disabling Audit Logging or Retention < 180 Days**: Running high-risk profiles with `ZCODE_OCEL=0` + `ZCODE_COMPLIANCE_LOG=0` or `log_retention_days < 180` (`LOGGING_UNAVAILABLE`).
5. **EU AI Act Article 5 Prohibited Practices**: Any use involving prohibited manipulation, social scoring, or untargeted biometric categorization.

### 2.4 Known Limitations & Uncertainty
- Underlying LLM outputs are stochastic candidates and can fail compilation, miss edge cases, or misinterpret ambiguous prompts.
- Static inspection (`zcode compliance info`) reports standing `UNVERIFIED`; empirical accuracy and conformance standing must be measured on observed OCEL 2.0 soak logs via `zcode compliance assess --logs <dir>` and `zcode ocel verify`.
- Coding turn service durations are heavy-tailed ($c_s^2 \gg 1$); Kingman queueing protection caps concurrency below $\rho \to 1$ to prevent queue collapse rather than maximizing raw utilization.

---

## 3. Pre-Determined Changes & Lifecycle Integrity — Art. 13(3)(c)

- Upstream runtime updates are pinned via `zcode-runtime.lock.json` (SHA-512) and verified by `bun run sync:locked` and `bun scripts/check-package.ts`.
- Ontology-to-code projections in `src/generated/` are gated against drift by `bun scripts/gen-ocel.ts --check`.
- Annex IV technical dossiers are verified against the active git `HEAD` SHA and configuration via `zcode compliance annex-iv --out <dir> --check`.

---

## 4. Human Oversight Measures — Art. 13(3)(d) & Art. 14

Deployers configuring `[compliance]` in `zcode-cli.toml` must enforce:
- **`overseer_id`** (`[deployer].overseer_id` or `ZCODE_OVERSEER_ID`): mandatory non-empty identifier for human accountability under high-risk profiles.
- **Automation Bias Guard (`min_review_ms`, default `1000`)**: approvals faster than `min_review_ms` or rapid consecutive approval streaks raise `AB_RISK_FLAG` in OCEL logs and PMM audits.
- **Emergency Stop & Rollback**: human interruption emits `oversight_intervened` (`standing: "INTERVENED"`) and triggers bounded workspace rollback (`workspace_rolled_back`) when `rollback_on_dirty = true`.
- **Subagent Non-Escalation**: spawned subagents inherit parent compliance profile, `min_review_ms`, `overseer_id`, and `XAAS_WORKER=1` gates monotonically (`propagateSubagentOversightContext`).

---

## 5. Computational & Hardware Requirements — Art. 13(3)(e)

- **Node.js**: `>= 22.19.0` (required for built-in `node:sqlite` WAL OCEL 2.0 storage).
- **Bun**: `>= 1.3.12` (development/test/codegen runner).
- **Storage**: Writable OCEL 2.0 directory (`ZCODE_OCEL_DIR`, default `~/.zcode/ocel`) sized for at least **180 days** of retention (`log_retention_days >= 180`).
- **Pre-Flight Verification**: Run `zcode compliance deployer-check` before onboarding a deployer workspace.

---

## 6. Post-Market Monitoring & Serious Incident Cadence — Art. 13(3)(f), Art. 72 & Art. 73

1. **Per-Session Verification**: Run `zcode ocel verify --in <session.ocel.json> --json` (optionally with `--declare` and `--wfnet`).
2. **Continuous PMM Cadence (Art. 72)**: Periodically run `zcode pmm analyze --logs <dir> --json` (minimum sample window `min_window >= 20`) to monitor Bose/van der Aalst concept drift (Page-Hinkley, ADWIN, EWMA, 2-sample KS, Mann-Whitney U), Kingman $c_s^2 / \lambda_{\text{alive}}$, and Responsible Process Mining fairness across providers/models.
3. **Serious Incident Reporting (Art. 73)**: On crashes, unredacted secret breaches, oversight stops, or systemic drift, run `zcode incident report --in <file> --out <packet.json> --session <id>` to generate a causal OC-DFG root-cause packet with statutory deadline classification (`2d`, `10d`, or `15d`).

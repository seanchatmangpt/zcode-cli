# AGENTS.md — zcode-cli

Orientation for agents working in this repo. Every claim below was checked against the tree; verify anything else before relying on it.

## What this repo is

`zcode-app-cli` is a thin CLI/TUI wrapper around the official ZCode agent runtime
(unofficial terminal client; see README "Architecture"). Release *docs* use calendar
versioning (`v<year>.<month>.<day>`; sjira waves through `v26.11.20`, receipts under
`v26.9.22`, `v26.9.23`, and `v26.11.20`). `package.json` may still carry a legacy `<appVersion>-<build>`
id (currently `3.14.4-1`) until the next calver cut. The locked vendored runtime is
Desktop `3.14.4` per `zcode-runtime.lock.json` (re-check `vendor/extraction.json` after
`sync:locked` / `sync:local`):

```
Node.js npm launcher (config / login / version metadata)
  └─ inherited stdin / stdout / stderr
      └─ vendor/zcode.cjs — the official agent runtime (extracted + patched)
          └─ packages/zcode-tui (local @zcode/tui adapter) → @earendil-works/pi-tui
```

The launcher owns config, login, plugin/MCP plumbing and the TUI; it does not insert a second PTY
or relay terminal bytes. The runtime itself is `vendor/zcode.cjs`, extracted and patched from
upstream — either the installer pinned in `zcode-runtime.lock.json` (URL + sha512 + appVersion)
or a local ZCode.app (`bun run sync:local`; provenance in `vendor/extraction.json`).

`vendor/` is **gitignored** — a fresh clone has no runtime until you run the sync pipeline:

- `bun run sync:locked` — build, then extract/patch the locked runtime
- `bun run sync:local` — same, but from a local `ZCode.app` (what `bun run dev` uses)

See `docs/RELEASING.md` and `scripts/sync-runtime.ts`.

Toolchain: bun (`packageManager: bun@1.4.1` in `package.json`), Node >= 22.19.0, TypeScript ESM, built with tsdown.

## Commands

- `bun run test:unit` — unit tests (`bun test test/*.test.ts`); `bun run test` and `test:fast` alias it
- `bun run test:runtime` — tests that exercise the real bundle (`test/runtime/`); needs `vendor/` populated first
- `bun run test:tui` — TUI scenario tests, component + e2e (`test/tui/`); `bun run test:all` runs unit + tui + runtime + node
- `bun run sync:locked` — build + extract/patch the locked runtime, then gates:
  `test/sync-runtime-anchor-drift.test.ts` and `test/sync-runtime-loop-gaps.test.ts` under `ZCODE_REQUIRE_BUNDLE=1`
- `bun run typecheck` — `tsc --noEmit`
- `bun run receipts:validate` — fail-closed validation of `receipts/**/*.json` (`scripts/validate-receipts.ts`)

## Layout

- `src/` — launcher & runtime-adjacent modules: `launcher.ts` (runtime spawn + stdio),
  `config-paths.ts`, `runtime-config-bridge.ts` (legacy provider migration into the shared registry),
  `builtin-provider-families.ts`, `ocel-tap.ts` (OCEL 2.0 event tap), `gall-work.ts`
  (xaas claim → close lease lifecycle), `powl-ocel-orchestrator.ts` (POWL v2 recursive write-scope
  validation, Hasse transitive reduction, Murata WF-net reductions), `foundry-cli.ts`
  (closed-loop `zcode foundry` `R_t -> O*_{t+1}` + Chatman-5 DFCM receipts),
  `compliance-cli.ts`, `compliance/`, `generated/`
- `src/compliance/` — EU AI Act (8/1/26) compliance suite across Articles 9, 10, 11, 12, 13, 14,
  15, 17, 26, 27, 43, 47, 50, 72, 73 and van der Aalst et al. process-mining engines:
  `ocel2.ts` (IEEE OCEL 2.0 strict attribute validation, XML round-trip, event-time 180-day
  retention + SHA-256 `retention-purge-ledger.ndjson`), `ocel-sqlite.ts` (SQLite round-trip),
  `ocel-discover.ts` (OC-DFG convergence/divergence/synchronization, UO `objectCount`, noise
  filtering), `ocpn.ts` (Inductive Miner OCPN discovery, variable-arc/synchronization replay,
  bounded marking-graph soundness), `conformance.ts` (optimal A* alignment with marking-equation
  LP heuristic + tau*-closure Align-ETC precision), `declare-conformance.ts`, `kingman-scheduler.ts`
  (multi-server G/G/c Sakasegawa/Allen-Cunneen scheduler), `transactional-net.ts` (bounded
  transactional nets, silent-cycle detection, Saga LIFO compensation), `oversight.ts` (Art. 14
  TUI `PermissionPreview` + `min_review_ms` dwell guard + `AutomationBiasMonitor`),
  `disclosure.ts` (Art. 50(2) runtime Markdown provenance header + `.zcode-provenance/` sidecar
  sealing), `annex-iv-report.ts`, `concept-drift.ts`, `config.ts`, `pmm-incident.ts`,
  `qms-conformity.ts`, `redactor.ts`, `risk-ledger.ts`, `rpm-fact.ts`
- `src/generated/` — `loop.ts`, `ocel.ts`, `receipt.ts`, `schemas.json`, `zod/`, `py/`: projections of
  `ontology/zcode-loop.ttl` via `bun scripts/gen-ocel.ts`. Never edited by hand; `bun scripts/gen-ocel.ts --check` fails on drift
- `ontology/` — `zcode-loop.ttl` (OCEL/loop ontology), `eu-ai-act.ttl`, `eu-ai-act.shapes.ttl`,
  `airo_risk_description.ttl`
- `test/` — unit tests at the top level; `test/runtime/` for real-bundle tests; `test/tui/` scenarios;
  `test/fixtures/` (incl. `gall-work.contract.json`), `test/support/`, `test/node/`, `test/py/`
- `scripts/` — `sync-runtime.ts` (extract + patch pipeline), `gen-ocel.ts` / `gen-zcode-loop.ts` /
  `zcode-events.ts` (ontology ↔ runtime enums), `ocel-verify.ts`, `validate-receipts.ts`,
  `check-runtime.ts`, plus `smoke-*`, `bench-*`, `release-*`
- `docs/` — `CONFIGURATION.md` (+ `.zh-CN.md`), `PROVIDER_CONFIG.md` (+ `.zh-CN.md`),
  `HOST_INTEGRATION.md`, `INSTRUCTIONS_FOR_USE.md`, `RELEASING.md`, `DEVELOPMENT.md`,
  `TUI_SCENARIO_TESTING.md`, `SQLITE_CONCURRENCY.md`, `THIRD_PARTY_CONTENT.md`,
  `c4-zcode-cli-xaas.md`, `c4-sovereign-ecosystem.md`, `sjira/`, `jira/`
- `receipts/<milestone>/` — session receipts (JSON), validated by `scripts/validate-receipts.ts`;
  present waves: `receipts/v26.9.22/`, `receipts/v26.9.23/`, `receipts/v26.11.20/` (incl. `exp4/`
  and `golden-aloop-v2-admit.json`), plus `receipts/ocel/`
- `docs/sjira/<milestone>/` — work orders; normative Explore/Exploit ARD at `docs/sjira/v26.11.20/`
  (older ZOCEL waves: `v26.9.21`–`v26.9.23`, `v26.10.8`). `work-orders.ttl` is the canonical graph where present;
  `jira/` holds ticket projections; `plan/` HDDL plans; plus `receipts/`, `execution/`, `ard/`
- `HANDWRITTEN.md` (repo root) — the handwritten-residue ledger
- Root: `bin/zcode.ts` (bin entry is `bin/zcode.js`, built), `packages/zcode-tui`,
  `provider.example.json`, `setting.example.json`

## Rules of the house

- `src/generated/` files are projections. Edit the ontology (`ontology/zcode-loop.ttl`) or the
  generator pack — never the projection. `bun scripts/gen-ocel.ts --check` is the drift gate.
- Anything hand-written beside generated code gets a row in `HANDWRITTEN.md` with its
  UNSUPPORTED (generator-capability) reason (currently: `src/ocel-tap.ts`, the `launcher.ts` tap hook,
  `scripts/gen-ocel.ts`, `scripts/gen-zcode-loop.ts` + `zcode-events.ts`, the `test/ocel-*.test.ts` falsifiers).
  No row, no hand-written file.
- Do not edit `vendor/zcode.cjs` by hand. The bundle is patched by `runtimePatchPlan` in
  `scripts/sync-runtime.ts` (patch plan is authoritative; applied/skipped counts are recorded per
  sync in `vendor/extraction.json` after `sync:locked` / `sync:local`).
- `zcode-runtime.lock.json` pins the upstream runtime; change it only through the release flow in `docs/RELEASING.md`.

## Coupling to xaas

This repo contains zero xaas-specific application code; the coupling is documented in
`docs/c4-zcode-cli-xaas.md` (C4 L1–L3 + a dynamic claim-to-receipt cycle) and runs through four
surfaces: the marketplace plugin install, the plugin-shipped `.mcp.json` MCP registration (the
`xaas-execution` fabric verbs — inside the installed xaas-fabric plugin cache, not a repo-root
file), the plugin's `hooks/hooks.json` PreToolUse gate (`$CLAUDE_PLUGIN_ROOT/scripts/xaas-gate.mjs` — inert unless
`XAAS_WORKER=1`; denies or
defers, never grants, fails closed), and the gall-work lease contract (`src/gall-work.ts`; the
contract is byte-identical to `~/xaas/priv/zcode_plugin/gall-work.contract.json`, sha256 pinned in
both repos, fixture at `test/fixtures/gall-work.contract.json` — drift resolved 2026-09-26 by
forwarding the newer contract to the xaas side; both now hash `9f722813…e979`). The OCEL tap
(`src/ocel-tap.ts`,
enabled with `ZCODE_OCEL=1`, output dir `ZCODE_OCEL_DIR`, default `~/.zcode/ocel`) feeds process
mining on the xaas side. Every recorded event is credential-redacted at ingest (secret-shaped keys
and embedded/Bearer token values become `REDACTED` before the hash chain is computed —
`test/ocel-redaction.test.ts`); `OcelRecorder.finish` fail-closes like capability-snapshot
(`containsUnredactedSecretsOrPii` → stub + `redaction_refused` / standing blocked; lease
identity fields are redact-or-refuse before bind/receipt). Under `XAAS_WORKER=1` the receipt
binds the scrubbed lease identity (`subject_sha`, `work_order_iri`, `epoch_id`, `base_sha`).
The capability snapshot/restore tool (redacted, fail-closed) is documented in
`docs/CAPABILITY_SNAPSHOT.md`. The xaas-side ticket tree lives at `~/xaas/docs/sjira/`.

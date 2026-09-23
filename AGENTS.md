# AGENTS.md — zcode-cli

Orientation for agents working in this repo. Every claim below was checked against the tree; verify anything else before relying on it.

## What this repo is

`zcode-app-cli` is a thin CLI/TUI wrapper around the official ZCode agent runtime
(unofficial terminal client; see README "Architecture"). Releases use calendar
versioning (`v<year>.<month>.<day>`; current wave: `v26.9.23`), replacing the
`<appVersion>-<build>` scheme that ended at `3.14.1-27`. The vendored runtime is
Desktop `3.14.3` (official CLI `0.16.9`), as recorded by the last sync in
`vendor/extraction.json`:

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

Toolchain: bun (`packageManager: bun@1.3.12`), Node >= 22.19.0, TypeScript ESM, built with tsdown.

## Commands

- `bun run test:unit` — unit tests (`bun test test/*.test.ts`); `bun run test` and `test:fast` alias it
- `bun run test:runtime` — tests that exercise the real bundle (`test/runtime/`); needs `vendor/` populated first
- `bun run test:tui` — TUI scenario tests, component + e2e (`test/tui/`); `bun run test:all` runs unit + tui + runtime
- `bun run sync:locked` — build + extract/patch the locked runtime, then gates:
  `test/sync-runtime-anchor-drift.test.ts` and `test/sync-runtime-loop-gaps.test.ts` under `ZCODE_REQUIRE_BUNDLE=1`
- `bun run typecheck` — `tsc --noEmit`
- `bun run receipts:validate` — fail-closed validation of `receipts/**/*.json` (`scripts/validate-receipts.ts`)

## Layout

- `src/` — launcher code: `launcher.ts` (runtime spawn + stdio), `config-paths.ts`,
  `runtime-config-bridge.ts` (legacy provider migration into the shared registry),
  `builtin-provider-families.ts`, `ocel-tap.ts` (OCEL event tap), `gall-work.ts`
  (xaas claim → close lease lifecycle), `generated/`
- `src/generated/` — `loop.ts`, `ocel.ts`, `receipt.ts`, `schemas.json`, `zod/`, `py/`: projections of
  `ontology/zcode-loop.ttl` via `bun scripts/gen-ocel.ts`. Never edited by hand; `bun scripts/gen-ocel.ts --check` fails on drift
- `test/` — unit tests at the top level; `test/runtime/` for real-bundle tests; `test/tui/` scenarios;
  `test/fixtures/` (incl. `gall-work.contract.json`), `test/support/`, `test/node/`, `test/py/`
- `scripts/` — `sync-runtime.ts` (extract + patch pipeline), `gen-ocel.ts` / `gen-zcode-loop.ts` /
  `zcode-events.ts` (ontology ↔ runtime enums), `ocel-verify.ts`, `validate-receipts.ts`,
  `check-runtime.ts`, plus `smoke-*`, `bench-*`, `release-*`
- `docs/` — `CONFIGURATION.md` (+ `.zh-CN.md`), `PROVIDER_CONFIG.md` (+ `.zh-CN.md`),
  `HOST_INTEGRATION.md`, `RELEASING.md`, `DEVELOPMENT.md`, `TUI_SCENARIO_TESTING.md`,
  `SQLITE_CONCURRENCY.md`, `THIRD_PARTY_CONTENT.md`, `c4-zcode-cli-xaas.md`, `sjira/`, `jira/`
- `receipts/<milestone>/` — session receipts (JSON), validated by `scripts/validate-receipts.ts`; current: `receipts/v26.9.22/`
- `docs/sjira/<milestone>/` — work orders (current: `v26.9.22`): `work-orders.ttl` is the canonical
  graph; `jira/` holds ticket projections (current wave: `GALL-CHECKPOINT-*`, archive: `v26.9.18/`);
  `plan/` HDDL plans; plus `receipts/`, `execution/`, `ard/`
- `HANDWRITTEN.md` (repo root) — the handwritten-residue ledger
- Root: `bin/zcode.ts` (bin entry is `bin/zcode.js`, built), `ontology/zcode-loop.ttl`,
  `packages/zcode-tui`, `provider.example.json`, `setting.example.json`

## Rules of the house

- `src/generated/` files are projections. Edit the ontology (`ontology/zcode-loop.ttl`) or the
  generator pack — never the projection. `bun scripts/gen-ocel.ts --check` is the drift gate.
- Anything hand-written beside generated code gets a row in `HANDWRITTEN.md` with its
  UNSUPPORTED (generator-capability) reason (currently: `src/ocel-tap.ts`, the `launcher.ts` tap hook,
  `scripts/gen-ocel.ts`, `scripts/gen-zcode-loop.ts` + `zcode-events.ts`, the `test/ocel-*.test.ts` falsifiers).
  No row, no hand-written file.
- Do not edit `vendor/zcode.cjs` by hand. The bundle is patched by `runtimePatchPlan` in
  `scripts/sync-runtime.ts` (23 patches registered; the recorded 3.14.3 sync shows 16 applied,
  2 already present upstream, 5 skipped as incompatible — see `vendor/extraction.json`).
- `zcode-runtime.lock.json` pins the upstream runtime; change it only through the release flow in `docs/RELEASING.md`.

## Coupling to xaas

This repo contains zero xaas-specific application code; the coupling is documented in
`docs/c4-zcode-cli-xaas.md` (C4 L1–L3 + a dynamic claim-to-receipt cycle) and runs through four
surfaces: the marketplace plugin install, `.mcp.json` MCP registration (the `xaas-execution` fabric
verbs), the `hooks.json` PreToolUse gate (`xaas-gate.mjs` — inert unless `XAAS_WORKER=1`; denies or
defers, never grants, fails closed), and the gall-work lease contract (`src/gall-work.ts`; the
contract is byte-identical to `~/xaas/priv/zcode_plugin/gall-work.contract.json`, sha256 pinned in
both repos, fixture at `test/fixtures/gall-work.contract.json`). The OCEL tap (`src/ocel-tap.ts`,
enabled with `ZCODE_OCEL=1`, output dir `ZCODE_OCEL_DIR`, default `~/.zcode/ocel`) feeds process
mining on the xaas side. The xaas-side ticket tree lives at `~/xaas/docs/sjira/`.

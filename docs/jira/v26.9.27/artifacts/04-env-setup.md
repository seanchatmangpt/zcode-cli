# Env Setup — "finish xaas"

Workflow: `wf_expert_144d4b97` · phase `env_setup` · 2026-09-27 · cwd `/Users/sac/zcode-cli`

## Verdict

**READY — no installs or credentials missing.** All gates the executor needs can run as-is.
Two managed environment notes (node PATH below engines floor; xaas lane needs the already-running
local postgres). Nothing in this phase required code edits.

## Verified requirements

| Requirement | Source | Status |
|---|---|---|
| bun | `package.json` packageManager `bun@1.4.1` | installed **1.4.2** — OK |
| node `>=22.19.0` | `package.json` engines | PATH node **v20.13.0 — GAP**; nvm has `v22.12.0 / v22.22.3 / v22.23.3` at `~/.nvm/versions/node/`. Fix is PATH selection only (`nvm use 22`). bun-run unit/typecheck/tests are unaffected; matters for `test/runtime/*`, which spawn `process.execPath` (`test/runtime/launcher.test.ts`, `config-migration.test.ts`, `subagent-builtin-provider.test.ts`) |
| deps | `node_modules/`, `~/xaas/deps/` | both present |
| vendored runtime | `vendor/zcode.cjs` (appVersion 3.14.3, 14.8 MB) | populated; both new patch markers present (`ZCODE_SUBAGENT_MAX_TURNS`, `zExpertStrategyMerge`); `vendor/extraction.json` = 25 registered / 21 applied / 2 already_present / 2 skipped — matches AGENTS.md |
| Elixir toolchain (xaas lane) | `~/xaas/.tool-versions` via asdf | `mix` resolves **inside `~/xaas`** (OTP 28); not on global PATH — always run from the xaas dir |
| postgres (xaas `mix test`) | `~/xaas/config/test.exs` (Ecto Sandbox, defaults `postgres/postgres@localhost`, `DEV_DB_*` overrides) | **localhost:5432 accepting connections** (brew `postgresql@14`, LaunchAgent) |
| gh auth | `gh auth status` | logged in as `seanchatmangpt`, scopes incl. `repo`, `workflow` |
| settings path | `~/.zcode/cli/setting.json` (mode 600) | exists; `expertWorkflow` key present (the new runtime patch's config source) |

## Working-tree state (matches 02-task-analysis)

- zcode-cli: branch `fix/v26926-preview-publish-typed-skip`, ahead 5 of origin; 12 modified + 4 new
  test files uncommitted (`artifacts/` also untracked — the workflow's own output).
- `~/xaas`: `main`, ahead **67** of origin; uncommitted: `lib/xaas/ultracode/wave_loop.ex`,
  `config/config.exs`, `CHANGELOG.md`, `README.md`, `docs/ultracode/multi-repo-run.md`,
  new `docs/ultracode/self-digest.md`.

## Ambient-state notes for the executor

- **`ZCODE_SUBAGENT_MAX_TURNS=100` is set in this session** — exactly the env var
  `src/max-turns.ts` reads. Tests save/restore env themselves (16/16 pass under it), but any manual
  probe of `resolveSubagentMaxTurnsEnv` will see 100 unless overridden.
- `XAAS_WORKER`, `ZCODE_OCEL`, `MIX_BUILD_ROOT`, `ZCODE_REQUIRE_BUNDLE` are unset — defaults apply
  (xaas-gate inert; OCEL tap off; no lane build root pinned yet).

## Focused validation run this phase

- `bun test test/max-turns.test.ts test/expert-strategy-config.test.ts` → **16 pass / 0 fail** (133 ms).
- Session ladder already recorded in `02-task-analysis.md` (unit 1054/0, typecheck 0, bundle gates
  9/0 under `ZCODE_REQUIRE_BUNDLE=1`) — tree unchanged since; not re-run here.

## Risks

1. **node PATH gap**: if the 5 pre-existing `test/runtime/launcher.test.ts` failures are
   node-version-related, rerun once under `nvm use 22` before attributing them. Do NOT
   opportunistically "fix" them — bisect says they predate this diff (constraint 7 in 02).
2. **postgres role mismatch** in the xaas lane: test.exs defaults may not match the local role;
   if `mix test` hits auth failure, set `DEV_DB_USERNAME`/`DEV_DB_PASSWORD` — don't edit test.exs.
3. **mix is dir-scoped** (asdf shim): xaas commands must run from `~/xaas`; never `deps.get` from
   a lane; use `MIX_BUILD_ROOT=_build-laneX`.

## Next actions (executor phase)

1. zcode-cli commit split per `02-task-analysis.md` (feat / docs / HANDWRITTEN ledger row for
   `src/max-turns.ts`), each with its narrow → unit → bundle gate.
2. xaas lane: from `~/xaas`, `MIX_BUILD_ROOT=_build-laneX mix test test/xaas/ultracode/wave_loop_test.exs`
   (postgres already up); only then commit the wave_loop/docs/config half.
3. Optional before final attribution: `nvm use 22` rerun of `bun test test/runtime/launcher.test.ts`
   to classify the 5 pre-existing failures.

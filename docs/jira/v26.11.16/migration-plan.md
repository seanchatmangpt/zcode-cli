# zcode-cli migration plan v26.11.16

Standing: UNVERIFIED

## Identity
- Path: /Users/sac/zcode-cli
- Remote: https://github.com/seanchatmangpt/zcode-cli
- Branch: main@08a5c73 (tracks origin/main, 0/0)
- Last commit: 2026-10-13; commits: 361; size: 101 MB
- Languages/build: TypeScript/Bun (package.json, bun.lock, tsdown.config.ts), ontology/,
  receipts/, vendor/ (pinned ZCode runtime), zcode-runtime.lock.json
- Nested repos: none

## Observed state
- Dirty: 0; Untracked: 0; Stash: 0; ahead/behind 0/0
- Unpushed local branches: 5 — harden/zcode-cli-8-local, modep/preserve-260926-docs,
  v26926/zcode-ggen-toolchain-composite, v26926/zcode-publish-channels-typed-skip,
  v26926/zcode-relay-worker-admission; feat/aloop-l3-execution-provider-parity is behind 2
- Build dirs: none (no node_modules/dist)
- Local data: provider.example.json, setting.example.json (examples only; no .env found)

## What it is
zcode-app-cli: unofficial terminal client for the ZCode agent runtime, packaging a pinned
ZCode Desktop release with compatibility patches and a pi-tui interface. Published on npm.

## Classification
ACTIVE (census agrees).

## Migration risk
- Tree clean and pushed; only 5 local branches would be lost.
Rate: MEDIUM (branches only)

## Recommended action
CLONE-FRESH
1. `cd /Users/sac/zcode-cli && git push origin harden/zcode-cli-8-local
   modep/preserve-260926-docs v26926/zcode-ggen-toolchain-composite
   v26926/zcode-publish-channels-typed-skip v26926/zcode-relay-worker-admission`
2. Verify each with `git ls-remote origin | grep <sha>`.
3. Clone fresh on the new machine; do not copy.

## First commands on the new machine
`git clone https://github.com/seanchatmangpt/zcode-cli && cd zcode-cli && bun install
--frozen-lockfile && bun test` (stated, not run)

## See Also
- ../v26.9.27/
- /Users/sac/docs/jira/v26.11.16/README.md

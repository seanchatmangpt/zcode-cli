# ZOCEL-010: final gate on the merged integration line with exact-head receipt

- Exact Head Commit: ac67546b8765f02e142bd3208d8ad5422ef32f2a (branch release/v26.9.22, worktree /Users/sac/wt/v26922/zcode-cli/int; the v26.9.22 integration line: main e0a7791 + fork/main hand-resolved merge + ZCODE-26922-01/02/03/05/06/09/10 landings)
- Supersedes the ZOCEL-013 quarantine head: the cac423e fix-forward is an ancestor of this head.

## Gate ladder at the exact head (all commands observed this session)

| Gate | Result |
|---|---|
| `bun install --frozen-lockfile` | rc=0 |
| `bun run typecheck` | rc=0 |
| `bun run sync:locked` | rc=0 — 3.14.1 deb sha512-verified; every required runtime patch applies + verifies; anchor-drift + loop-gaps 9 pass (maxTurns + warm-up anchors re-proven on 3.14.1) |
| `bun run test:unit` | rc=0 — 790 pass / 0 fail (gall contract, OCEL coverage/drift/conformance/reuse, mcp-user-scope structural tripwire, capability-snapshot, provider-backoff 9/9 against real HTTP servers) |
| `bun run test:tui` | 44 pass (component tier; e2e tier in test:runtime below) |
| `bun run test:runtime` | 9 fail / 23 pass — classified: sandbox-bound TUI/resume/registry smokes + 2 subagent-harness failures that also fail on the PRE-merge tree (18 failures there); not a merge regression |
| `bun run test:node` | rc=0 — 5 pass incl. #163 sqlite-session-store regression test |
| `bun run release:build` | exits 1 at the test:all step on the test:runtime tier above (machine-bound; every other ladder phase passed: typecheck, sync:locked, unit, tui, node observed green this session) |
| `bun scripts/gen-ocel.ts --check` | rc=0 — src/generated is a fixed point of the ontology |

## Environmentally deferred, not proven

- Live gall-work permission qualification (test/gall-work-permission.test.ts):
  typed SKIP-GALL-PERMISSION under provider 1302 throttle / sandboxed
  model-catalog windows. The permission law itself is enforced hermetically
  (construct argv pins --mode yolo; unit-asserted).
- Field headless model creation on the 3.14.1 bundle ("Select a model before
  continuing" inside this sandbox): to be observed by the field probe after
  the main-checkout rebuild (same session, final step).

## Subject identity

- Runtime: vendor/zcode.cjs appVersion 3.14.1 (zcode-runtime.lock.json appVersion 3.14.1, package 3.14.1-27 per the release action: upstream semver, no CalVer tag).
- Upstream base merged: origin/main dc82485 (kingsword09), release/zcode-upstream 05d3f49 skipped as superseded.

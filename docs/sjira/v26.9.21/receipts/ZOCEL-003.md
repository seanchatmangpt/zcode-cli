# ZOCEL-003 receipt: strict toolchain gates

- package.json: ZCODE_REQUIRE_TOOLCHAINS=1 on test:unit, test:runtime, sync:locked (also ZCODE_REQUIRE_BUNDLE=1);
  scripts/build-release.ts already sets TOOLCHAINS for its spawns. test/release-package.test.ts assertion updated
  for the new test:unit string (introduced by this change, fixed).
- STRICT_TOOLCHAIN_GATE: ALIVE. `env -i PATH=/usr/bin:/bin HOME=$HOME ZCODE_REQUIRE_TOOLCHAINS=1 /opt/homebrew/bin/bun
  test test/ocel-coverage.test.ts test/ocel-reuse.test.ts` -> 7 pass, 1 fail, 1 error, rc=1 (missing toolchain throws,
  not skips). Acceptance text's /Users/sac/.bun/bin/bun does not exist here; homebrew bun used.
- STRICT_BUNDLE_GATE: ALIVE. vendor absent, `ZCODE_REQUIRE_BUNDLE=1 bun test test/ocel-reuse.test.ts` -> 13 pass 1 fail,
  rc=1 (new test "bundle present when ZCODE_REQUIRE_BUNDLE=1"); with bundle present 14 pass 0 fail.
- GATE_WIRED: ALIVE. grep -c TOOLCHAINS: package.json 3, build-release.ts 1, sync-runtime.ts 0; BUNDLE: package.json 1.
- Full `bun run test:unit` (strict): 700 pass 9 fail; the 8 non-release-package failures (TUI notifications x2,
  credential preflight x3, rich Markdown blockquote x2, code highlighter) are in files this change does not touch
  (ZOCEL-013 pre-existing class; UNKNOWN whether each is identical to main, not re-run on main). release-package
  failure was introduced here and fixed (5 pass 0 fail).
- Standing: PARTIAL_ALIVE.

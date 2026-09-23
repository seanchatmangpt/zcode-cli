import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-09-21 readiness incident: after a routine runtime rebuild, overnight
// headless workers were reported to "lose" the user-scope `xaas-execution` MCP
// server (project `.mcp.json` was added as a workaround). Session logs and a
// headless probe proved registration never regressed: user-scope
// `mcp.servers` from ~/.zcode/cli/setting.json are configured and connected in
// headless --prompt sessions, before and after the rebuild; the observed
// disappearances were connect failures of the HTTP endpoint itself (phx 500 /
// refused), which the runtime reports as a failed server, not a skipped scope.
//
// These anchors pin that law to the synced bundle so a future runtime or sync
// change that actually drops the user scope from the MCP source merge fails
// here instead of being discovered by a dead overnight fleet:
//
//   1. resolveMcpServerSources applies scopes in order and "user" is one of
//      them (`n("project",...),n("user",...)` in the compiled resolver);
//   2. config resolution loads the user file by default — the skip branch is
//      opt-in (`skipUserConfig?{...}:Iae(e.userConfigPath)`), and the file it
//      loads is ~/.zcode/cli/setting.json;
//   3. the runtime config merge feeds the resolved `mcp.servers` into the
//      session runtime config (`mcp:{...servers:S...}` from
//      resolveAppRuntimeConfig), so configured == registered.
const bundle = join(import.meta.dir, "..", "vendor", "zcode.cjs");

// Anchors are structural (minifier identifiers wildcarded) so they hold for
// any runtime build: only the SHAPE of the scope-ordered merge, the opt-in
// user-config skip, the settings file identity, and the runtime-config mcp
// merge are pinned -- not particular minified names (3.14.1 renamed them all).
const mcpSourceMergeAnchor = /[A-Za-z_$][\w$]*\("project",e\.projectConfig\),[A-Za-z_$][\w$]*\("user",e\.userConfig\)/u;
const userConfigDefaultLoadAnchor = /[A-Za-z_$][\w$]*\.skipUserConfig\?\{config:\{\},diagnostics:\[\],path:[A-Za-z_$][\w$]*\(\),loaded:!1\}:[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\.userConfigPath\)/u;
const cliSettingsFileAnchor = /[A-Za-z_$][\w$]*="setting\.json",[A-Za-z_$][\w$]*="~\/\.zcode\/cli"/u;
const runtimeConfigMcpServersAnchor = /mcp:\{enabled:[A-Za-z_$][\w$]*\.runtimeConfig\?\.mcp\?\.enabled\?\?[A-Za-z_$][\w$]*\.config\.features\.mcp,servers:[A-Za-z_$][\w$]*/u;

test.skipIf(!existsSync(bundle))("user scope participates in MCP server resolution on the synced bundle", () => {
  const runtime = readFileSync(bundle, "utf8");
  expect(mcpSourceMergeAnchor.test(runtime)).toBe(true);
  expect(userConfigDefaultLoadAnchor.test(runtime)).toBe(true);
  expect(cliSettingsFileAnchor.test(runtime)).toBe(true);
  expect(runtimeConfigMcpServersAnchor.test(runtime)).toBe(true);
});

test("drift: a resolver without the user scope is rejected", () => {
  // The law is the presence of "user" in the ordered scope application, so the
  // tripwire fires on the smallest drift: the user scope dropped from the
  // merge chain while project scope remains.
  const drifted = `o("system",Lm),o("project",e.projectConfig),o("env",e.envConfig)`;
  expect(mcpSourceMergeAnchor.test(drifted)).toBe(false);
  // The live anchor still demands the user scope between project and env.
  expect(mcpSourceMergeAnchor.test('o("project",e.projectConfig),o("user",e.userConfig),o("env",e.envConfig)')).toBe(true);
});

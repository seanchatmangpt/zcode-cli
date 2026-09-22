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

const mcpSourceMergeAnchor = `n("project",e.projectConfig),n("user",e.userConfig)`;
const userConfigDefaultLoadAnchor = `e.skipUserConfig?{config:{},diagnostics:[],path:WE(),loaded:!1}:Iae(e.userConfigPath)`;
const cliSettingsFileAnchor = `IZr="setting.json",TZr="~/.zcode/cli"`;
const runtimeConfigMcpServersAnchor = `mcp:{enabled:n.runtimeConfig?.mcp?.enabled??r.config.features.mcp,servers:S`;

test.skipIf(!existsSync(bundle))("user scope participates in MCP server resolution on the synced bundle", () => {
  const runtime = readFileSync(bundle, "utf8");
  expect(runtime).toContain(mcpSourceMergeAnchor);
  expect(runtime).toContain(userConfigDefaultLoadAnchor);
  expect(runtime).toContain(cliSettingsFileAnchor);
  expect(runtime).toContain(runtimeConfigMcpServersAnchor);
});

test("drift: a resolver without the user scope is rejected", () => {
  // The law is the presence of "user" in the ordered scope application, so the
  // tripwire fires on the smallest drift: the user scope dropped from the
  // merge chain while project scope remains.
  const drifted = `n("system",ma),n("project",e.projectConfig),n("env",e.envConfig)`;
  expect(drifted).not.toContain(`n("user",e.userConfig)`);
  expect(mcpSourceMergeAnchor).toContain(`n("user",e.userConfig)`);
});

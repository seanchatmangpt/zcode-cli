# C4 — zcode-cli ↔ xaas connections

Grounded in (2026-09-18):

- Plugin source (製-ed from ontology): `~/xaas/priv/zcode_plugin/` — `ontology.ttl`, ggen `templates/*.tmpl` (SPARQL-driven), rendered `marketplace/xaas-fabric/` (`plugin.json`, `.mcp.json`, `hooks/hooks.json`, `scripts/xaas-gate.mjs`, `scripts/xaas-lease.mjs`, `skills/xaas-worker/`, `agents/xaas-worker.md`, `commands/xaas.md`)
- Installed instance: `~/.zcode/cli/plugins/cache/xaas-fabric-marketplace/xaas-fabric/26.9.17/`
- Server side: `~/xaas/lib/xaas_web/router.ex:83` — `post("/execution/mcp", ExecutionFabricController, :mcp)` under `/internal-api`, behind `RequireInternalApiToken`
- Host contract: `~/dev/zcode-cli/docs/HOST_INTEGRATION.md` (plugin manifests, user_config interpolation)
- Headless session registration: project `.mcp.json` in the working directory (2026-09-21 runtime rebuild); see [CONFIGURATION.md](./CONFIGURATION.md), "Headless session registration: the project `.mcp.json`"

zcode-cli contains **zero** xaas-specific code; the entire coupling runs through three plugin contracts: the marketplace install, the `.mcp.json` MCP registration, and the `hooks.json` PreToolUse gate.

## L1 — System Context

```mermaid
C4Context
    title L1 System Context — ZCode CLI and the XaaS Execution Fabric

    Person(operator, "Operator", "Retired from writing code; edits ontology, grants authority tokens, reviews receipts")

    System(zcode_cli, "ZCode CLI", "Terminal agent host (zcode-app-cli) that runs agent sessions with skills, hooks, plugins and MCP clients")

    System(xaas, "XaaS Execution Fabric", "Phoenix/Ash app on localhost:4000 that leases receipted work contracts, adjudicates tool calls and seals evidence")

    System_Ext(github, "GitHub", "Hosts both repos and the published xaas-fabric marketplace")

    System_Ext(consumer, "Consumer repos", "Git repositories (xaas and clients) whose leased worktrees workers build in")

    Rel(operator, zcode_cli, "Drives sessions, configures plugin bearer token")
    Rel(zcode_cli, xaas, "Claims and closes receipted work via MCP tools", "JSON-RPC over HTTP POST /internal-api/execution/mcp with Bearer token")
    Rel(operator, xaas, "Owns authority cuts and standing review")
    Rel(xaas, consumer, "Provisions leased worktrees and verifies their heads", "git")
    Rel(zcode_cli, consumer, "Workers commit inside leased worktrees", "git, no push")
    Rel(github, zcode_cli, "Distributes xaas-fabric plugin releases", "zcode plugins install from marketplace")
```

## L2 — Containers

```mermaid
C4Container
    title L2 Containers — plugin-contract coupling between host and fabric

    Person(operator, "Operator", "Configures zcode_xaas_token user config")

    System_Boundary(host, "ZCode CLI (~/dev/zcode-cli)") {
        Container(session, "Agent session", "TypeScript TUI", "Main agent loop; dispatcher spawns xaas-worker subagents with XAAS_WORKER=1")
        Container(mcpclient, "MCP client", "TypeScript", "Exposes mcp__xaas-execution__* tools to the model")
        Container(loader, "Plugin loader", "TypeScript", "Reads installed plugins from the cache; resolves user_config into manifests")
        Container(cache, "Installed plugin cache", "Files", "~/.zcode/cli/plugins/cache/xaas-fabric-marketplace/xaas-fabric/26.9.17 - plugin.json, .mcp.json, hooks, scripts, skills, agents")
        Container(hooks, "Hook runner", "TypeScript", "Runs PreToolUse hooks on every tool call")
        Container(gate, "xaas-gate.mjs", "Node script from plugin", "PreToolUse admission gate, active only when XAAS_WORKER=1; denies or defers, never grants, fails closed")
        Container(leasecli, "xaas-lease.mjs", "Node script from plugin", "Persists the worker lease token in /tmp/xaas-fabric keyed by working directory")
    }

    System_Boundary(fabric, "XaaS (~/xaas, Phoenix on localhost:4000)") {
        Container(endpoint, "Phoenix endpoint", "Elixir", "RequireInternalApiToken plug guards /internal-api")
        Container(mcpserver, "ExecutionFabricController", "Elixir", "POST /internal-api/execution/mcp - the xaas-execution MCP server over JSON-RPC/HTTP")
        Container(domain, "Fabric domain", "Elixir/Ash", "Lease service, admission court, actuation kernel, verifier suites, receipt sealing")
        ContainerDb(store, "Lease and receipt store", "Ash", "Append-only ledger of claims, decisions and evidence")
        Container(forge, "Plugin forge", "ggen + SPARQL", "priv/zcode_plugin - ontology.ttl and templates render every plugin manifest, hook and script")
    }

    Rel(operator, loader, "Sets bearer token via zcode plugins configure")
    Rel(loader, cache, "Loads plugin.json, .mcp.json and hooks.json")
    Rel(loader, mcpclient, "Registers xaas-execution HTTP server with Bearer user_config.zcode_xaas_token")
    Rel(forge, cache, "Publishes marketplace release that installs into the cache", "via GitHub, zcode plugins install")
    Rel(session, mcpclient, "claim_next, heartbeat, admit_tool, actuate, close_candidate, refuse")
    Rel(session, hooks, "Every tool call passes PreToolUse")
    Rel(hooks, gate, "Invokes with tool name and input", "node, 30s timeout")
    Rel(mcpclient, endpoint, "JSON-RPC tool calls", "HTTP POST /internal-api/execution/mcp, Bearer token")
    Rel(endpoint, mcpserver, "Forwards after token check")
    Rel(mcpserver, domain, "Executes registered fabric actions")
    Rel(domain, store, "Persists leases, admissions, receipts")
    Rel(gate, leasecli, "Reads live-lease state to scope decisions")
```

## L3 — Components (runtime enforcement and the claim protocol)

```mermaid
C4Component
    title L3 Components — one leased worker session end to end

    Container_Boundary(session_b, "ZCode CLI worker session (XAAS_WORKER=1)") {
        Component(dispatcher, "Dispatcher", "Main agent", "Spawns the xaas-worker subagent; holds no lease itself")
        Component(worker, "xaas-worker subagent", "Subagent with Read, Grep, Glob, Edit, Write, Bash", "Executes construction inside the leased worktree only; no merge or publish authority")
        Component(gate, "xaas-gate.mjs", "PreToolUse hook", "Defers xaas-execution MCP tools (that IS the lease protocol); Bash argv-allowlist limited to git without push, the lease script and read-only worktree helpers; write tools contained to the leased worktree, never .git; denies Agent spawning unless XAAS_ALLOW_SUBAGENTS=1; every failure path is a deny")
        Component(leasecli, "xaas-lease.mjs", "Node script", "save / get / clear lease state in /tmp/xaas-fabric; refuses to clobber a live different-token lease")
        Component(mcptools, "xaas-execution tool client", "MCP tools", "The seven fabric verbs surfaced to the model")
    }

    Container_Boundary(fabric_b, "XaaS fabric (ExecutionFabricController + Ash domain)") {
        Component(claims, "Lease service", "claim_next, heartbeat, refuse", "Race-safe lease grant for the oldest lease-free epoch; returns work payload plus lease token")
        Component(court, "Admission court", "admit_tool", "Per-consequence fence; Bash, git push and publish stay refused at this surface")
        Component(kernel, "Actuation kernel", "actuate", "Runs one registered resource-action pair under lease-bound authority evidence")
        Component(receipts, "Receipt sealing", "close_candidate", "Closes the leased epoch only with head-verified evidence; seals the Receipt")
        Component(verifiers, "Verifier suites", "Fabric-side", "Independent judgment of the closed head named in the work payload")
    }

    Rel(dispatcher, worker, "Spawns with XAAS_WORKER=1 and ticket path")
    Rel(worker, mcptools, "Calls fabric verbs")
    Rel(worker, leasecli, "Persists claim result across tool calls")
    Rel(worker, gate, "Is subject to, on every tool call")
    Rel(gate, mcptools, "Defers xaas-execution calls through to the model")
    Rel(mcptools, claims, "claim_next / heartbeat / refuse")
    Rel(mcptools, court, "admit_tool before each consequential call")
    Rel(mcptools, kernel, "actuate registered pairs")
    Rel(mcptools, receipts, "close_candidate with evidence")
    Rel(receipts, verifiers, "Requires head verification")
```

## Dynamic — one claim-to-receipt cycle

```mermaid
C4Dynamic
    title Dynamic — worker claim, admission, construction, receipt

    System_Boundary(host, "ZCode CLI") {
        Component(dispatcher, "Dispatcher", "Main agent")
        Component(gate, "xaas-gate.mjs", "PreToolUse gate")
        Component(worker, "xaas-worker", "Leased subagent")
        Component(mcp, "MCP client", "xaas-execution tools")
    }

    System_Boundary(fabric, "XaaS fabric") {
        Component(controller, "ExecutionFabricController", "MCP over HTTP")
        Component(domain, "Fabric domain", "Leases, court, kernel, receipts")
        Component(worktree, "Leased worktree", "Git worktree in a consumer repo")
    }

    Rel(1, dispatcher, worker, "Spawns with ticket path and XAAS_WORKER=1")
    Rel(2, worker, mcp, "claim_next")
    Rel(3, mcp, controller, "POST /internal-api/execution/mcp, Bearer token")
    Rel(4, controller, domain, "Grants lease-free epoch and lease token")
    Rel(5, worker, gate, "Every tool call admitted or denied on the host")
    Rel(6, worker, worktree, "Edits and commits inside the leased worktree, never pushes")
    Rel(7, worker, mcp, "admit_tool before each consequential call; heartbeat renews lease")
    Rel(8, worker, mcp, "close_candidate with head-verified evidence")
    Rel(9, domain, worktree, "Verifies the exact closed head and seals the receipt")
    Rel(10, dispatcher, worktree, "Coordinator merges one serialized --no-ff when clean, writer-free and test-green")
```

## Notes

- **No hard-coded coupling in zcode-cli**: the endpoint URL, server name, tool surface and token key all arrive via the installed plugin manifest, themselves rendered from `zp:` ontology facts by ggen SPARQL templates — editing the endpoint is an ontology edit in xaas, not a code change in zcode-cli.
- **Token path**: operator runs `zcode plugins configure xaas-fabric@<marketplace> --options-file`; the loader interpolates `user_config.zcode_xaas_token` into the `Authorization` header (the `${user_config.*}` form exists because install-time plugin contexts have empty `env`).
- **Two enforcement planes**: the server-side `admit_tool` court (per-consequence fence) and the host-side `xaas-gate.mjs` PreToolUse gate (active only in dispatcher-launched sessions). Both fail closed; the gate only ever denies or defers.
- **What each side can never do**: zcode-cli holds no ambient execution authority (a plugin tool call is not authority); the worker cannot push, spawn subagents, or write outside its leased worktree.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  constructPrompt,
  defaultFabricUrl,
  discoverFabricCapabilities,
  fabricCall,
  gallWorkContractSha256,
  isGallWorkInvocation,
  parseGallWorkArgs,
  parseGallWorkLease,
  resolveFabricTarget,
  standingForOutcome,
  type FabricTarget,
  type FetchLike,
  type GallWorkLease
} from "../src/gall-work.ts";

const lease: GallWorkLease = {
  schema: "gall.work-lease/1",
  work_order_iri: "urn:gall:work-order:xaas:001",
  checkpoint_iri: "urn:gall:checkpoint:xaas:001",
  graph_digest: "sha256:" + "a".repeat(64),
  repository_identity: "seanchatmangpt/xaas",
  base_sha: "b".repeat(40),
  epoch_id: "123e4567-e89b-42d3-a456-426614174000",
  worker_id: "zcode-worker-01",
  worktree: "/tmp/gall-worktree"
};

// The shared contract fixture is byte-identical in both repos (zcode-cli
// test/fixtures/gall-work.contract.json, xaas
// priv/zcode_plugin/gall-work.contract.json). A change must land in both
// repos in the same wave; either side's pinned digest failing means drift.
// The digest also travels in close evidence replay_binding
// (gallWorkContractSha256) -- it must never drift from the bytes.
const contractPath = new URL("./fixtures/gall-work.contract.json", import.meta.url).pathname;
const contractText = readFileSync(contractPath, "utf8");
const contract = JSON.parse(contractText) as Record<string, unknown>;

describe("gall-work contract fixture (shared, byte-identical across repos)", () => {
  test("bytes are the pinned cross-repo digest, equal to the exported replay-binding constant", () => {
    expect(gallWorkContractSha256).toBe(
      "5515775861807cdd7394ef74b1ee38679dd24279224515178702bb6652a95fc4"
    );
    expect(createHash("sha256").update(contractText).digest("hex")).toBe(gallWorkContractSha256);
  });

  test("declares contract_version 1 and the exact dispatcher argv", () => {
    expect(contract.contract_version).toBe(1);
    expect(contract.contract).toBe("gall-work");
    expect(contract.command).toMatchObject({
      name: "zcode gall-work",
      argv: [
        "gall-work",
        "--worker-id",
        "<worker_id>",
        "--epoch-id",
        "<epoch_uuid>",
        "--cwd",
        "<abs_cwd>",
        "--json"
      ],
      process_cwd: "<zcode_cli_dir>"
    });
  });

  test("carries the fabric tool surface, outcome vocabulary, and exit codes", () => {
    const fabric = contract.fabric as Record<string, unknown>;
    expect(Object.keys(fabric.tools as Record<string, unknown>).sort()).toEqual([
      "cancel_work",
      "claim_next",
      "close_candidate",
      "heartbeat",
      "refuse",
      "work_status"
    ]);
    expect((fabric.tools as Record<string, Record<string, unknown>>).cancel_work).toMatchObject({
      arguments: { lease_token: "<token>" },
      result: { status: "cancelled" }
    });
    expect((fabric.tools as Record<string, Record<string, unknown>>).claim_next.arguments).toMatchObject({
      provider: "zcode (resolved from the execution-provider registry; never hard-coded)",
      idempotency_key: "gall-work:<provider>:<worker_id>:<epoch_uuid> (retry-safe re-claim)"
    });
    expect(fabric.outcome_vocabulary).toEqual([
      "alive",
      "partial_alive",
      "blocked",
      "build_broken",
      "unsupported",
      "refused"
    ]);
    expect(Object.keys(contract.exit_codes as Record<string, string>).sort()).toEqual([
      "0",
      "1",
      "142",
      "2",
      "65"
    ]);
  });

  test("encodes the capability-discovery handshake and its typed degrade", () => {
    const fabric = contract.fabric as Record<string, unknown>;
    expect(fabric.capability_discovery).toMatchObject({ handshake: ["initialize (client identity; serverInfo recorded)", "tools/list (capability surface)"] });
    expect(String((fabric.capability_discovery as Record<string, unknown>).degrade)).toContain("degrades typed");
  });

  test("encodes the provider-neutrality cut-point registry law", () => {
    const registry = contract.execution_provider_registry as Record<string, unknown>;
    expect(String(registry.config)).toContain("execution_provider_config.json");
    expect(String(registry.law)).toContain("enabled:false on a provider means it cannot be selected");
    expect(String(registry.law)).toContain("NO provider identity");
  });

  test("carries origin authority and replay binding as carried, never fabricated", () => {
    const workOrder = contract.work_order_file as Record<string, unknown>;
    expect(String(workOrder.origin_authority)).toContain("never fabricated");
    expect(String(contract.replay_binding)).toContain("replay_binding");
  });

  test("encodes the no-fallback law and the goal-off-argv transport", () => {
    expect(String(contract.no_fallback_law)).toContain("/xaas claim_next");
    expect(String(contract.goal_transport)).toContain("NEVER");
    expect(contract.env).toMatchObject({ XAAS_WORKER: "1", XAAS_LEASE_CWD: "<abs_cwd>" });
  });
});

describe("GALL semantic worker lease", () => {
  test("accepts a closed semantic work descriptor", () => {
    expect(parseGallWorkLease(lease)).toEqual(lease);
  });

  test("carries an origin authority when present and binds nothing when absent", () => {
    expect(parseGallWorkLease(lease).origin_authority).toBeUndefined();
    const withAuthority = parseGallWorkLease({
      ...lease,
      origin_authority: "https://w3id.org/chatman/aps#operator-lease-grant"
    });
    expect(withAuthority.origin_authority).toBe("https://w3id.org/chatman/aps#operator-lease-grant");
  });

  test("refuses incomplete canonical subject identity", () => {
    const { work_order_iri: _workOrder, ...missingWorkOrder } = lease;
    expect(() => parseGallWorkLease(missingWorkOrder)).toThrow("work_order_iri");
    expect(() => parseGallWorkLease({ ...lease, repository_identity: "xaas" })).toThrow(
      "repository_identity"
    );
    expect(() => parseGallWorkLease({ ...lease, base_sha: "main" })).toThrow("base_sha");
  });

  test("refuses branch names in place of graph identity", () => {
    expect(() => parseGallWorkLease({ ...lease, graph_digest: "main" })).toThrow(
      "graph_digest"
    );
  });

  test("refuses relative worktrees", () => {
    expect(() => parseGallWorkLease({ ...lease, worktree: "./repo" })).toThrow(
      "absolute path"
    );
  });

  test("refuses arbitrary worker-id shell syntax", () => {
    expect(() => parseGallWorkLease({ ...lease, worker_id: "worker; rm -rf /" })).toThrow(
      "unsupported characters"
    );
  });
});

describe("gall-work invocation parsing", () => {
  test("recognizes the native subcommand", () => {
    expect(isGallWorkInvocation(["gall-work", "--json"])).toBe(true);
    expect(isGallWorkInvocation(["gall", "verify"])).toBe(false);
    expect(isGallWorkInvocation(["--prompt", "/xaas ..."])).toBe(false);
  });

  test("parses the dispatcher flag form", () => {
    const request = parseGallWorkArgs(
      ["--worker-id", "zcode-dispatch-host-abcd1234-4242", "--epoch-id", lease.epoch_id, "--cwd", "/tmp/wt", "--json"],
      {}
    );
    expect(request.workerId).toBe("zcode-dispatch-host-abcd1234-4242");
    expect(request.epochId).toBe(lease.epoch_id);
    expect(request.cwd).toBe("/tmp/wt");
    expect(request.json).toBe(true);
  });

  test("parses provider request and construct-deadline overrides", () => {
    const request = parseGallWorkArgs(
      [
        "--worker-id", "w-1",
        "--epoch-id", lease.epoch_id,
        "--cwd", "/tmp/wt",
        "--provider", "zcode",
        "--construct-deadline-seconds", "90",
        "--json"
      ],
      {}
    );
    expect(request.providerId).toBe("zcode");
    expect(request.constructDeadlineSeconds).toBe(90);
  });

  test("deadline defaults from env, disabled by 0, refused below 0", () => {
    expect(parseGallWorkArgs(
      ["--worker-id", "w-1", "--epoch-id", lease.epoch_id, "--cwd", "/tmp/wt"],
      { ZCODE_CONSTRUCT_DEADLINE_SECONDS: "30" }
    ).constructDeadlineSeconds).toBe(30);
    expect(parseGallWorkArgs(
      ["--worker-id", "w-1", "--epoch-id", lease.epoch_id, "--cwd", "/tmp/wt", "--construct-deadline-seconds", "0"],
      {}
    ).constructDeadlineSeconds).toBe(0);
    expect(() =>
      parseGallWorkArgs(
        ["--worker-id", "w-1", "--epoch-id", lease.epoch_id, "--cwd", "/tmp/wt", "--construct-deadline-seconds", "-5"],
        {}
      )
    ).toThrow("construct-deadline-seconds");
  });

  test("parses the descriptor form and cross-fills the identifiers", () => {
    const dir = "/tmp/gall-work-contract-fixture";
    const path = `${dir}/lease.json`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(lease));
    const request = parseGallWorkArgs(["--lease", path], {});
    expect(request.workerId).toBe(lease.worker_id);
    expect(request.epochId).toBe(lease.epoch_id);
    expect(request.cwd).toBe(lease.worktree);
    expect(request.descriptor?.work_order_iri).toBe(lease.work_order_iri);
  });

  test("refuses mixed forms, relative cwds, and unknown flags with usage", () => {
    expect(() =>
      parseGallWorkArgs(["--worker-id", "w", "--epoch-id", lease.epoch_id, "--cwd", "/t", "--lease", "/x"], {})
    ).toThrow("not both");
    expect(() => parseGallWorkArgs(["--worker-id", "w", "--epoch-id", lease.epoch_id, "--cwd", "rel"], {})).toThrow(
      "absolute path"
    );
    expect(() => parseGallWorkArgs(["--prompt", "/xaas Call claim_next"], {})).toThrow("Unknown gall-work argument");
    expect(() => parseGallWorkArgs(["--worker-id", "w; rm", "--epoch-id", lease.epoch_id, "--cwd", "/t"], {})).toThrow(
      "unsupported characters"
    );
    expect(() => parseGallWorkArgs([], {})).toThrow("Usage:");
  });

  test("the construct prompt never carries goal text, only the work-order path", () => {
    const prompt = constructPrompt("/tmp/xaas-fabric/abc.work-order.json");
    expect(prompt).toContain("/tmp/xaas-fabric/abc.work-order.json");
    expect(prompt.toLowerCase()).toContain("work order");
  });
});

describe("fabric target resolution", () => {
  test("env overrides win and bind the token as Bearer", () => {
    const target = resolveFabricTarget({ XAAS_MCP_URL: "http://127.0.0.1:9/mcp", XAAS_MCP_TOKEN: "sekrit" });
    expect(target).toEqual({ url: "http://127.0.0.1:9/mcp", authorization: "Bearer sekrit" });
  });

  test("without config or env the default local fabric endpoint stands", () => {
    const target = resolveFabricTarget({ ZCODE_CONFIG_PATH: "/nonexistent/gall-test/config.json" });
    expect(target.url).toBe(defaultFabricUrl);
    expect(target.authorization).toBeUndefined();
  });
});

describe("fabric JSON-RPC tool calls", () => {
  const okResponse = (text: string): Response => {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }));
  };

  test("unwraps content[0].text as JSON on success", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const outcome = await fabricCall(
      { url: "http://fabric.test/mcp", authorization: "Bearer t" },
      "claim_next",
      { provider: "zcode", provider_worker_id: "w", epoch_id: lease.epoch_id },
      15_000,
      async (url, init) => {
        calls.push({ url: String(url), init });
        return okResponse(JSON.stringify({ lease_token: "tok-1" }));
      }
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ lease_token: "tok-1" });
    const sentInit = calls[0]!.init!;
    const body = JSON.parse(String(sentInit.body)) as Record<string, unknown>;
    expect(body.method).toBe("tools/call");
    expect((body.params as Record<string, unknown>).name).toBe("claim_next");
    expect((sentInit.headers as Record<string, string>).authorization).toBe("Bearer t");
  });

  test("maps isError tool refusals to typed errors", async () => {
    const outcome = await fabricCall(
      { url: "http://fabric.test/mcp" },
      "claim_next",
      {},
      15_000,
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "no_ready_work" }) }] }
          })
        )
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("no_ready_work");
  });

  test("maps transport failure to fabric_unreachable", async () => {
    const outcome = await fabricCall(
      { url: "http://127.0.0.1:1/mcp" },
      "heartbeat",
      { lease_token: "t" },
      15_000,
      async () => {
        throw new Error("connection refused");
      }
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("fabric_unreachable");
  });
});

describe("capability discovery (initialize + tools/list handshake)", () => {
  const rpcServer = (handlers: Record<string, (params: Record<string, unknown>) => unknown>): FetchLike =>
    async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
      const handler = handlers[body.method];
      if (!handler) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: `method not found: ${body.method}` } }));
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: handler(body.params) }));
    };
  const target: FabricTarget = { url: "http://fabric.test/mcp" };

  test("discovers the tool surface and records serverInfo", async () => {
    const capabilities = await discoverFabricCapabilities(target, rpcServer({
      initialize: () => ({ protocolVersion: "2024-11-05", serverInfo: { name: "xaas-fabric", version: "1" } }),
      "tools/list": () => ({ tools: [{ name: "claim_next" }, { name: "cancel_work" }] })
    }));
    expect(capabilities.discovered).toBe(true);
    expect(capabilities.tools).toEqual(["claim_next", "cancel_work"]);
    expect(capabilities.serverInfo).toMatchObject({ name: "xaas-fabric" });
    expect(capabilities.code).toBeUndefined();
  });

  test("degrades typed when the server lacks the handshake (JSON-RPC error)", async () => {
    const capabilities = await discoverFabricCapabilities(target, rpcServer({}));
    expect(capabilities.discovered).toBe(false);
    expect(capabilities.tools).toEqual([]);
    expect(capabilities.code).toBe("tools_list_unsupported");
  });

  test("degrades typed on a 200 without a tools array", async () => {
    const capabilities = await discoverFabricCapabilities(target, rpcServer({
      initialize: () => ({ serverInfo: { name: "odd" } }),
      "tools/list": () => ({ error: "unexpected tool" })
    }));
    expect(capabilities.discovered).toBe(false);
    expect(capabilities.code).toBe("tools_list_unsupported");
  });

  test("records initialize_unsupported when only tools/list answers", async () => {
    const capabilities = await discoverFabricCapabilities(target, rpcServer({
      "tools/list": () => ({ tools: [{ name: "heartbeat" }] })
    }));
    expect(capabilities.discovered).toBe(true);
    expect(capabilities.tools).toEqual(["heartbeat"]);
    expect(capabilities.code).toBe("initialize_unsupported");
  });
});

describe("outcome -> standing mapping", () => {
  test("covers the fabric outcome vocabulary", () => {
    expect(standingForOutcome("alive")).toBe("ALIVE");
    expect(standingForOutcome("partial_alive")).toBe("PARTIAL_ALIVE");
    expect(standingForOutcome("blocked")).toBe("BLOCKED");
    expect(standingForOutcome("build_broken")).toBe("BUILD_BROKEN");
    expect(standingForOutcome("unsupported")).toBe("UNSUPPORTED");
    expect(standingForOutcome("refused")).toBe("REFUSED");
  });
});

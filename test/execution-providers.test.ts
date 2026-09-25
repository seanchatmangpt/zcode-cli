// Execution-provider registry (execution_provider_config.json, schemaVersion 1).
// Unit qualification: the read is fully injected -- no test touches a real
// ~/.zcode/v2 file. The cut-point law under test: enabled:false on a provider
// means it cannot be selected; selection is fail-closed.
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_EXECUTION_PROVIDER,
  builtinExecutionProvider,
  executionProviderConfigPath,
  parseExecutionProviderRegistry,
  selectExecutionProvider,
  type ExecutionProviderRegistry,
  type ReadConfigText
} from "../src/execution-providers.ts";

const registry = (value: unknown): ReadConfigText => () => JSON.stringify(value);

const enabled = (providerId: string): unknown => ({ providerId, enabled: true, runtime: "fake" });
const disabled = (providerId: string): unknown => ({ providerId, enabled: false, runtime: "fake" });

const claudeThenZcode = {
  schemaVersion: 1,
  executionProviderRules: [enabled("claude"), enabled("zcode")],
  defaultExecutionSelection: { providerId: "claude" }
};

describe("execution_provider_config path", () => {
  test("env override wins; default is ~/.zcode/v2/execution_provider_config.json", () => {
    expect(executionProviderConfigPath({ ZCODE_EXECUTION_PROVIDER_CONFIG_FILE: "/tmp/reg.json" })).toBe("/tmp/reg.json");
    expect(executionProviderConfigPath({}, "darwin", "/home/u")).toBe("/home/u/.zcode/v2/execution_provider_config.json");
    expect(executionProviderConfigPath({}, "win32", "/home/u")).toContain("execution_provider_config.json");
  });
});

describe("registry parsing", () => {
  test("accepts a schemaVersion 1 registry and trims identities", () => {
    const parsed = parseExecutionProviderRegistry(JSON.stringify(claudeThenZcode)) as ExecutionProviderRegistry;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.executionProviderRules.map((rule) => rule.providerId)).toEqual(["claude", "zcode"]);
    expect(parsed.defaultExecutionSelection?.providerId).toBe("claude");
  });

  test("refuses malformed registries (wrong version, missing rules, bad json, bad rule)", () => {
    expect(parseExecutionProviderRegistry("{}")).toBeUndefined();
    expect(parseExecutionProviderRegistry(JSON.stringify({ schemaVersion: 2, executionProviderRules: [] }))).toBeUndefined();
    expect(parseExecutionProviderRegistry("not json")).toBeUndefined();
    expect(parseExecutionProviderRegistry(JSON.stringify({ schemaVersion: 1, executionProviderRules: [{ providerId: "" }] }))).toBeUndefined();
  });
});

describe("provider selection", () => {
  test("no registry file: the built-in zcode provider stands", async () => {
    const selection = await selectExecutionProvider({ env: {}, read: async () => { throw Object.assign(new Error("enoent"), { code: "ENOENT" }); } });
    expect(selection.selected).toBe(true);
    expect(selection.builtin).toBe(true);
    expect(selection.providerId).toBe(DEFAULT_EXECUTION_PROVIDER);
    expect(selection.rule).toEqual(builtinExecutionProvider());
    expect(selection.reads[0]?.present).toBe(false);
  });

  test("malformed registry is fail-closed: refusal, not a guess", async () => {
    const selection = await selectExecutionProvider({ env: {}, read: () => "not json" });
    expect(selection.selected).toBe(false);
    expect(selection.reason).toBe("registry_invalid");
  });

  test("selects the registry default when enabled", async () => {
    const selection = await selectExecutionProvider({ env: {}, read: registry(claudeThenZcode) });
    expect(selection.selected).toBe(true);
    expect(selection.providerId).toBe("claude");
    expect(selection.reads[0]?.present).toBe(true);
  });

  test("disabling the default falls through to the next enabled rule and records the replacement", async () => {
    const cut = {
      schemaVersion: 1,
      executionProviderRules: [disabled("claude"), enabled("zcode")],
      defaultExecutionSelection: { providerId: "claude" }
    };
    const selection = await selectExecutionProvider({ env: {}, read: registry(cut) });
    expect(selection.selected).toBe(true);
    expect(selection.providerId).toBe("zcode");
    expect(selection.replaced).toEqual({ providerId: "claude", reason: "provider_disabled" });
  });

  test("a disabled provider is never selected -- all-disabled refuses typed", async () => {
    const cut = {
      schemaVersion: 1,
      executionProviderRules: [disabled("claude"), disabled("zcode")],
      defaultExecutionSelection: { providerId: "claude" }
    };
    const selection = await selectExecutionProvider({ env: {}, read: registry(cut) });
    expect(selection.selected).toBe(false);
    expect(selection.reason).toBe("provider_disabled");
    expect(selection.replaced?.providerId).toBe("claude");
  });

  test("an unknown requested provider refuses typed", async () => {
    const selection = await selectExecutionProvider({
      env: {},
      requestedProviderId: "unheard-of",
      read: registry(claudeThenZcode)
    });
    expect(selection.selected).toBe(false);
    expect(selection.reason).toBe("provider_unknown");
  });

  test("an empty rules list with no default refuses registry_empty", async () => {
    const selection = await selectExecutionProvider({
      env: {},
      read: registry({ schemaVersion: 1, executionProviderRules: [] })
    });
    expect(selection.selected).toBe(false);
    expect(selection.reason).toBe("registry_empty");
  });

  test("the read log names only the registry path -- no credential file consulted", async () => {
    const seen: string[] = [];
    const selection = await selectExecutionProvider({
      env: {},
      read: (path) => {
        seen.push(path);
        return JSON.stringify(claudeThenZcode);
      }
    });
    expect(selection.selected).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("execution_provider_config.json");
    expect(seen.join("\n")).not.toMatch(/credentials|auth|secret/i);
  });
});

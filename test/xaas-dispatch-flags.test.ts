import { describe, expect, test } from "bun:test";

import {
  firstRunSetupEnv,
  isTuiRuntimeInvocation,
  readRuntimeCliOptionTypes,
  withDefaultBrowserUse
} from "../src/launcher.ts";

// The xaas fabric dispatches this CLI as a worker with exactly this argv shape
// (docs/c4-zcode-cli-xaas.md; src/gall-work.ts:850 constructs the same flag set
// for the internal construct turn). Every flag must survive launcher routing —
// recognized as an agent invocation, never misparsed — and is then forwarded
// verbatim to the vendored runtime by runRuntime (src/launcher.ts:398).
const xaasDispatchArgv = [
  "-p",
  "print the receipt",
  "--cwd",
  "/tmp/xaas-work",
  "--output-format",
  "stream-json",
  "--mode",
  "yolo"
];

describe("xaas worker dispatch argv", () => {
  test("runtime capability manifest declares every xaas flag as a known option", () => {
    const optionTypes = readRuntimeCliOptionTypes();
    expect(optionTypes["prompt"]).toBe("string");
    expect(optionTypes["cwd"]).toBe("string");
    expect(optionTypes["output-format"]).toBe("string");
    expect(optionTypes["mode"]).toBe("string");
  });

  test("routes as an agent invocation and only prepends the browser-use default", () => {
    // Reaching the prepend branch proves: agentInvocation=true, invalid=false,
    // passthrough=false, explicitBrowserUse=false for the exact xaas argv —
    // i.e. every option value was consumed against the current runtime manifest.
    expect(withDefaultBrowserUse(xaasDispatchArgv)).toEqual([
      "--browser-use=headless",
      ...xaasDispatchArgv
    ]);
  });

  test("is never mistaken for a TUI or first-run setup invocation", () => {
    expect(isTuiRuntimeInvocation(xaasDispatchArgv)).toBe(false);
    expect(firstRunSetupEnv(true, xaasDispatchArgv)).toBeUndefined();
  });
});

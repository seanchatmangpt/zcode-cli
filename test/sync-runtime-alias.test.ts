import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { patchRuntimeBuiltinProviderAliases } from "../scripts/sync-runtime.ts";

// Synthetic minified fixture mirroring the shipped 3.14.3 ProviderRegistry class:
// getProvider/getModel read private maps #t/#n and validateSelection checks the raw
// provider map with .has() before getProvider is ever consulted.
const registryFixture = [
  "class dX{",
  "#t;#n;",
  "constructor(){this.#t=new Map([[\"zai\",{providerId:\"zai\"}]]),",
  "this.#n=new Map([[\"zai\",new Map([[\"glm-4\",{modelId:\"glm-4\"}],[\"glm-5\",{modelId:\"glm-5\"}]])]])}",
  "getProvider(t){return this.#t.get(t)}",
  "getModel(t,n){return this.#n.get(t)?.get(n)}",
  "validateSelection(t){if(!this.#t.has(t.providerId))return{ok:!1,code:\"provider-not-found\",providerId:t.providerId};let n=this.getModel(t.providerId,t.modelId);return n?{ok:!0}:{ok:!1,code:\"model-not-found\",providerId:t.providerId,modelId:t.modelId}}",
  "}"
].join("");

function buildRegistryFixture(runtime: string) {
  const Registry = new Function(`${runtime};return dX;`)() as new () => {
    validateSelection(selection: { providerId: string; modelId: string }): {
      ok: boolean;
      code?: string;
      providerId?: string;
      modelId?: string;
    };
    getModel(providerId: string, modelId: string): { modelId: string } | undefined;
  };
  return new Registry();
}

test("alias patch rewrites the registry class so validateSelection resolves through getProvider", () => {
  const patched = patchRuntimeBuiltinProviderAliases(registryFixture);
  expect(patched.split("$zBuiltinProviderAlias").length - 1).toBe(1);
  expect(patched).toContain('validateSelection(t){if(!this.getProvider(t.providerId))return{ok:!1,code:"provider-not-found"');
  expect(patched).not.toContain("this.#t.has(t.providerId)");
  expect(patched).toContain('getProvider(t){/*$zBuiltinProviderAlias*/');
  expect(patchRuntimeBuiltinProviderAliases(patched)).toBe(patched);
});

test("patched registry resolves desktop builtin and account plan ids onto the family provider", () => {
  const registry = buildRegistryFixture(patchRuntimeBuiltinProviderAliases(registryFixture));
  expect(registry.validateSelection({ providerId: "builtin:zai-coding-plan", modelId: "glm-4" })).toEqual({ ok: true });
  expect(registry.validateSelection({ providerId: "account:zai-individual-coding-plan", modelId: "glm-4" })).toEqual({ ok: true });
  expect(registry.validateSelection({ providerId: "account:zai-team-coding-plan", modelId: "glm-5" })).toEqual({ ok: true });
  expect(registry.validateSelection({ providerId: "account:zai-start-plan", modelId: "glm-4" })).toEqual({ ok: true });
  expect(registry.validateSelection({ providerId: "zai", modelId: "glm-4" })).toEqual({ ok: true });
  expect(registry.validateSelection({ providerId: "builtin:bigmodel-coding-plan", modelId: "glm-4" })).toEqual({
    ok: false,
    code: "provider-not-found",
    providerId: "builtin:bigmodel-coding-plan"
  });
  expect(registry.validateSelection({ providerId: "other", modelId: "glm-4" })).toEqual({
    ok: false,
    code: "provider-not-found",
    providerId: "other"
  });
  expect(registry.validateSelection({ providerId: "builtin:zai-coding-plan", modelId: "nope" })).toEqual({
    ok: false,
    code: "model-not-found",
    providerId: "builtin:zai-coding-plan",
    modelId: "nope"
  });
});

test("patched getModel falls back to the family model map with case-insensitive model ids", () => {
  const registry = buildRegistryFixture(patchRuntimeBuiltinProviderAliases(registryFixture));
  expect(registry.getModel("builtin:zai-coding-plan", "glm-4")).toEqual({ modelId: "glm-4" });
  expect(registry.getModel("account:zai-individual-coding-plan", "GLM-5")).toEqual({ modelId: "glm-5" });
  expect(registry.getModel("builtin:zai-coding-plan", "nope")).toBeUndefined();
  expect(registry.getModel("other", "glm-4")).toBeUndefined();
});

test("alias patch throws the typed incompatibility errors on unmatchable fixtures", () => {
  expect(() => patchRuntimeBuiltinProviderAliases("incompatible runtime")).toThrow(/incompatible with the builtin provider alias patch/);
  const missingSelectionAnchor = registryFixture.replace(
    'validateSelection(t){if(!this.#t.has(t.providerId))return{ok:!1,code:"provider-not-found"',
    'validateSelection(t){if(!this.#t.has(t.providerId))return{ok:!1,code:"missing"'
  );
  expect(() => patchRuntimeBuiltinProviderAliases(missingSelectionAnchor)).toThrow(/selection validation anchor missing/);
});

const bundle = resolve(import.meta.dir, "..", "vendor", "zcode.cjs");
const requireBundle = process.env.ZCODE_REQUIRE_BUNDLE === "1";
test.skipIf(!existsSync(bundle) && !requireBundle)("shipped bundle: alias marker injected once and validateSelection routed through getProvider", () => {
  if (!existsSync(bundle)) throw new Error(`real bundle missing at ${bundle}; run bun run sync:locked`);
  const vendor = readFileSync(bundle, "utf8");
  expect(vendor.split("$zBuiltinProviderAlias").length - 1).toBe(1);

  const start = vendor.indexOf("getProvider(t){/*$zBuiltinProviderAlias*/");
  expect(start).toBeGreaterThan(0);
  const end = vendor.indexOf('model-not-found",providerId:t.providerId,modelId:t.modelId}', start);
  expect(end).toBeGreaterThan(start);
  const slice = vendor.slice(Math.max(0, start - 300), end + 80);

  expect(slice.split("$zBuiltinProviderAlias").length - 1).toBe(1);
  expect(slice).toContain('validateSelection(t){if(!this.getProvider(t.providerId))return{ok:!1,code:"provider-not-found"');
  expect(slice).toContain('startsWith("builtin:")&&t.endsWith("-coding-plan")');
  expect(slice).toContain('endsWith("-individual-coding-plan")');
  expect(slice).not.toContain(".has(t.providerId)");
  // Re-running the sync patch on the real registry-class slice is a no-op.
  expect(patchRuntimeBuiltinProviderAliases(slice)).toBe(slice);
});

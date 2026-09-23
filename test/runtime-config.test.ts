import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cliSettingsPath, desktopSettingsPath, legacyCliConfigPath, providerConfigPath, providerMigrationMarkerPath } from "../src/config-paths.ts";
import { ensureCliSettings, readCliSettings } from "../src/model-access.ts";
import { mergeDesktopSettings, migrateLegacyProviders, providerMigrationNeeded, providerRegistryContainsFamilyKey } from "../src/runtime-config-bridge.ts";
import { providerFixture } from "./fixtures/provider-config.ts";
import { writeNotificationSettings } from "../packages/zcode-tui/src/notifications.ts";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "zcode-settings-"));
  homes.push(home);
  const env = { HOME: home, USERPROFILE: home };
  await mkdir(dirname(desktopSettingsPath(env)), { recursive: true });
  return { home, env };
}

test("reuses native Desktop preferences without copying them into CLI settings", async () => {
  const { env } = await fixture();
  const desktop = JSON.stringify({ localePreference: "zh-CN", memoryEnabled: false, terminalFontFamily: "desktop-only" });
  await writeFile(desktopSettingsPath(env), desktop);
  await ensureCliSettings(env);
  const input = await readCliSettings(env);
  expect(input.ui).not.toHaveProperty("locale");
  expect(mergeDesktopSettings(input, cliSettingsPath(env), env)).toMatchObject({
    ui: { locale: "zh-CN" }, memory: { use: false, write: false }, features: { memory: false }
  });
  expect(mergeDesktopSettings({ ui: { locale: "en-US" }, memory: { use: true } }, cliSettingsPath(env), env))
    .toMatchObject({ ui: { locale: "en-US" }, memory: { use: true, write: false }, features: { memory: true } });
  expect(mergeDesktopSettings({ memory: { use: true }, features: { memory: false } }, cliSettingsPath(env), env))
    .toMatchObject({ memory: { use: true, write: false }, features: { memory: false } });
  const project = { ui: { theme: "dark" } };
  expect(mergeDesktopSettings(project, "/workspace/zcode.json", env)).toBe(project);
  await writeNotificationSettings({ method: "off", condition: "always" }, env);
  expect(await readFile(desktopSettingsPath(env), "utf8")).toBe(desktop);
  expect((await readCliSettings(env)).ui).not.toHaveProperty("locale");
});

test("migrates CLI settings once and never reads the old file as a fallback", async () => {
  const { env } = await fixture();
  await mkdir(dirname(legacyCliConfigPath(env)), { recursive: true });
  const legacy = { provider: { custom: {} }, model: { main: "custom/test" }, modelCatalog: {}, ui: { theme: "dark" } };
  await writeFile(legacyCliConfigPath(env), JSON.stringify(legacy));
  expect(await ensureCliSettings(env)).toMatchObject({ created: true, migrated: true });
  expect(await readCliSettings(env)).toEqual({ ui: { theme: "dark" } });
  await writeFile(legacyCliConfigPath(env), JSON.stringify({ ui: { theme: "light" } }));
  expect(await readCliSettings(env)).toEqual({ ui: { theme: "dark" } });
  await writeFile(cliSettingsPath(env), "invalid-new-settings");
  await expect(readCliSettings(env)).rejects.toThrow("Unable to read");
  expect(await readFile(cliSettingsPath(env), "utf8")).toBe("invalid-new-settings");
  await rm(cliSettingsPath(env));
  expect((await readCliSettings(env)).ui).toMatchObject({ theme: "auto" });
});

test("uses Desktop's data directory and honors an explicit provider file", async () => {
  const { home, env } = await fixture();
  const data = join(home, "desktop-data");
  await writeFile(desktopSettingsPath(env), JSON.stringify({ dataBaseDir: data }));
  expect(providerConfigPath(env)).toBe(join(data, ".zcode/v2/provider_config.json"));
  expect(providerConfigPath({ ...env, ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: "/custom/providers.json" })).toBe("/custom/providers.json");
  await writeFile(desktopSettingsPath(env), "invalid-desktop-settings");
  expect(() => providerConfigPath(env)).toThrow("Unable to read Desktop setting.json");
});

type StubRule = { providerId: string; config: unknown; enabled?: boolean };
type StubModelRule = { providerId: string; modelId: string; config: unknown };
interface StubProviderMap { has(id: string): boolean; rules(): StubRule[]; setRule(rule: StubRule): StubProviderMap }
interface StubModelRules {
  rules(): StubModelRule[];
  getExactRule(providerId: string, modelId: string): StubModelRule | undefined;
  setExact(providerId: string, modelId: string, config: unknown): StubModelRules;
}

/** In-memory stand-in for the upstream provider registry snapshot. */
function stubSnapshot(existing: StubRule[] = [], models: StubModelRule[] = []): { providers: StubProviderMap; models: StubModelRules; [key: string]: unknown } {
  const providerMap: StubProviderMap = {
    has: id => existing.some(rule => rule.providerId === id),
    rules: () => existing.map(rule => ({ ...rule })),
    setRule: rule => {
      const index = existing.findIndex(current => current.providerId === rule.providerId);
      if (index >= 0) existing[index] = rule; else existing.push(rule);
      return providerMap;
    }
  };
  const modelRules: StubModelRules = {
    rules: () => models.map(model => ({ ...model })),
    getExactRule: (providerId, modelId) => models.find(model => model.providerId === providerId && model.modelId === modelId),
    setExact: (providerId, modelId, config) => {
      if (!models.some(model => model.providerId === providerId && model.modelId === modelId)) models.push({ providerId, modelId, config });
      return modelRules;
    }
  };
  return { providers: providerMap, models: modelRules };
}

async function legacyFixture(env: NodeJS.ProcessEnv, providers: Record<string, unknown>) {
  await mkdir(dirname(legacyCliConfigPath(env)), { recursive: true });
  await writeFile(legacyCliConfigPath(env), JSON.stringify({ provider: providers }));
}

test("records the migration marker without opening the registry when no legacy provider is importable", async () => {
  const { env } = await fixture();
  await legacyFixture(env, { "account:zai:x": { source: "account" }, "builtin:anthropic": { source: "builtin" } });
  class ForbiddenRepository {
    constructor() { throw new Error("registry must not open for a zero-candidate migration"); }
    read(): never { throw new Error("read must not run"); }
    update(): never { throw new Error("update must not run"); }
    dispose(): void { throw new Error("dispose must not run"); }
  }
  await migrateLegacyProviders({
    Repository: ForbiddenRepository,
    importLegacy: () => { throw new Error("importLegacy must not run for non-importable providers"); },
    env
  });
  const marker = await readFile(providerMigrationMarkerPath(env), "utf8");
  expect(JSON.parse(marker)).toMatchObject({ schemaVersion: 1, imported: [], skipped: ["account:zai:x", "builtin:anthropic"] });
  expect(providerMigrationNeeded(env)).toBe(false);
});

test("fail-closed recovery error names the marker, the provider config and the repair", async () => {
  const { env } = await fixture();
  await legacyFixture(env, { custom: { source: "custom", options: { apiKey: "key" } } });
  class RecoveringRepository {
    onRecovery: (event: unknown) => void;
    constructor(options: { filePath: string; pollingIntervalMs: false; onRecovery: (event: unknown) => void }) { this.onRecovery = options.onRecovery; }
    async read() { this.onRecovery({ reason: "corrupt" }); return stubSnapshot(); }
    async update(): Promise<never> { throw new Error("update must not run after recovery"); }
    dispose(): void {}
  }
  const error = await migrateLegacyProviders({ Repository: RecoveringRepository, importLegacy: () => stubSnapshot([{ providerId: "custom", config: {} }]), env })
    .then(() => undefined, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain(providerMigrationMarkerPath(env));
  expect(String(error)).toContain(providerConfigPath(env));
  expect(String(error)).toMatch(/Repair: fix or remove the provider config file/i);
  expect(existsSync(providerMigrationMarkerPath(env))).toBe(false);
});

test("imports legacy providers once, then the marker makes the next start a no-op", async () => {
  const { env } = await fixture();
  await legacyFixture(env, { custom: { source: "custom", options: { apiKey: "key" } } });
  const current = stubSnapshot([]);
  let updates = 0;
  class StubRepository {
    constructor(_options: { filePath: string; pollingIntervalMs: false; onRecovery: (event: unknown) => void }) {}
    async read() { return current; }
    async update(change: (value: never) => never) { updates += 1; return await change(current as never); }
    dispose(): void {}
  }
  const options = { Repository: StubRepository, importLegacy: () => stubSnapshot([{ providerId: "custom", config: {} }]), env };
  await migrateLegacyProviders(options);
  expect(updates).toBe(1);
  expect(current.providers.has("custom")).toBe(true);
  expect(JSON.parse(await readFile(providerMigrationMarkerPath(env), "utf8"))).toMatchObject({ imported: ["custom"], skipped: [] });
  expect(providerMigrationNeeded(env)).toBe(false);
  await migrateLegacyProviders(options);
  expect(updates).toBe(1);
});

test("detects family-keyed provider rules in the parsed registry config", () => {
  const registry = { schemaVersion: 1, config: { providerConfigRules: { providerRules: [
    { providerId: "account:zai:x", config: {} }, { providerId: "zai", config: {} }
  ] } } };
  expect(providerRegistryContainsFamilyKey(registry, "zai")).toBe(true);
  expect(providerRegistryContainsFamilyKey(registry, "anthropic")).toBe(false);
  expect(providerRegistryContainsFamilyKey({ config: { providerConfigRules: { providerRules: [{ providerId: "account:zai:x" }] } } }, "zai")).toBe(false);
  expect(providerRegistryContainsFamilyKey(providerFixture({ providerId: "zai" }), "zai")).toBe(true);
  expect(providerRegistryContainsFamilyKey(providerFixture(), "zai")).toBe(false);
  expect(providerRegistryContainsFamilyKey({}, "zai")).toBe(false);
  expect(providerRegistryContainsFamilyKey(undefined, "zai")).toBe(false);
});

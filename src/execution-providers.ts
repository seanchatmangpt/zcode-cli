// Execution-provider registry -- closes UNSUPPORTED(zcode-cli:execution_provider_registry).
//
// Provider neutrality law: a work order's identity, authority, planner,
// acceptance criteria and receipt schema carry NO provider identity. The
// provider appears only as (a) a capabilityId left-segment on the wire
// (claim_next `provider`) and (b) a descriptor here. This module is the
// cut-point that makes an execution provider selectable and un-selectable:
// `enabled: false` on a provider means it cannot be selected -- the
// "disable the Claude credential" shape. Selection is fail-closed:
//   - an unreadable/malformed registry file refuses selection
//     (registry_invalid) rather than guessing;
//   - a disabled provider is never selected; discovery falls through to the
//     next enabled rule (provider.replace) or refuses (provider_disabled);
//   - with no registry file at all, the built-in zcode provider stands.
// The registry read is injectable (`read`) so unit tests never depend on a
// real ~/.zcode/v2 file; the path helper imitates src/config-paths.ts.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export const DEFAULT_EXECUTION_PROVIDER = "zcode";

export interface ExecutionProviderRule {
  providerId: string;
  enabled?: boolean;
  runtime?: string;
  capabilitiesRef?: string;
  authRef?: string;
}

/** Schema execution_provider_config.json schemaVersion 1. */
export interface ExecutionProviderRegistry {
  schemaVersion: 1;
  executionProviderRules: ExecutionProviderRule[];
  defaultExecutionSelection?: { providerId?: string };
}

/** One attempted registry read (for the no-credential-consulted falsifier). */
export interface ExecutionProviderRead {
  path: string;
  present: boolean;
  invalid?: boolean;
}

export interface ExecutionProviderSelection {
  selected: boolean;
  providerId?: string;
  rule?: ExecutionProviderRule;
  /** True when selected from the built-in default (no registry file present). */
  builtin?: boolean;
  /** Set when a requested/default provider was skipped and selection fell through. */
  replaced?: { providerId: string; reason: "provider_disabled" | "provider_unknown" };
  /** Typed refusal reason when !selected. */
  reason?: "provider_disabled" | "provider_unknown" | "registry_invalid" | "registry_empty";
  reads: ExecutionProviderRead[];
}

export type ReadConfigText = (path: string) => Promise<string> | string;

const defaultRead: ReadConfigText = (path) => readFile(path, "utf8");

export function executionProviderConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fallbackHome = homedir()
): string {
  const path = platform === "win32" ? win32 : posix;
  const home = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || fallbackHome;
  return env.ZCODE_EXECUTION_PROVIDER_CONFIG_FILE?.trim()
    || path.join(home, ".zcode", "v2", "execution_provider_config.json");
}

/** The built-in provider: this CLI's own execution capacity. */
export function builtinExecutionProvider(): ExecutionProviderRule {
  return { providerId: DEFAULT_EXECUTION_PROVIDER, enabled: true, runtime: "zcode-cli" };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Parse registry text; undefined when malformed (fail-closed upstream). */
export function parseExecutionProviderRegistry(text: string): ExecutionProviderRegistry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const root = record(value);
  if (!root || root.schemaVersion !== 1 || !Array.isArray(root.executionProviderRules)) return undefined;
  const rules: ExecutionProviderRule[] = [];
  const providerIds = new Set<string>();
  for (const raw of root.executionProviderRules) {
    const rule = record(raw);
    if (!rule || typeof rule.providerId !== "string" || !rule.providerId.trim()) return undefined;
    const providerId = rule.providerId.trim();
    if (providerIds.has(providerId)) return undefined;
    providerIds.add(providerId);
    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") return undefined;
    rules.push({
      providerId,
      ...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
      ...(typeof rule.runtime === "string" && rule.runtime.trim() ? { runtime: rule.runtime.trim() } : {}),
      ...(typeof rule.capabilitiesRef === "string" && rule.capabilitiesRef.trim()
        ? { capabilitiesRef: rule.capabilitiesRef.trim() }
        : {}),
      ...(typeof rule.authRef === "string" && rule.authRef.trim() ? { authRef: rule.authRef.trim() } : {})
    });
  }
  const selection = record(root.defaultExecutionSelection);
  const defaultProviderId = typeof selection?.providerId === "string" ? selection.providerId.trim() : "";
  return {
    schemaVersion: 1,
    executionProviderRules: rules,
    ...(defaultProviderId ? { defaultExecutionSelection: { providerId: defaultProviderId } } : {})
  };
}

async function readRegistry(
  env: NodeJS.ProcessEnv,
  read: ReadConfigText
): Promise<{ registry?: ExecutionProviderRegistry; reads: ExecutionProviderRead[] }> {
  const path = executionProviderConfigPath(env);
  let text: string;
  try {
    text = await read(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { reads: [{ path, present: false }] };
    return { reads: [{ path, present: true, invalid: true }] };
  }
  const registry = parseExecutionProviderRegistry(text);
  return registry
    ? { registry, reads: [{ path, present: true }] }
    : { reads: [{ path, present: true, invalid: true }] };
}

/**
 * Resolve the execution provider for a dispatch. Order: an explicitly
 * requested providerId, then the registry default, then registry rule order.
 * A disabled or unknown candidate is never selected -- selection falls
 * through (replaced) to the next enabled candidate or refuses typed.
 */
export async function selectExecutionProvider(options: {
  env?: NodeJS.ProcessEnv;
  requestedProviderId?: string;
  read?: ReadConfigText;
} = {}): Promise<ExecutionProviderSelection> {
  const env = options.env ?? process.env;
  const read = options.read ?? defaultRead;
  const { registry, reads } = await readRegistry(env, read);

  if (!registry) {
    if (reads[0]?.invalid) return { selected: false, reason: "registry_invalid", reads };
    // No registry file: the built-in zcode provider stands. An explicitly
    // requested non-builtin provider cannot be honoured without a registry.
    const requested = options.requestedProviderId?.trim() || undefined;
    if (requested && requested !== DEFAULT_EXECUTION_PROVIDER) {
      return { selected: false, reason: "provider_unknown", reads };
    }
    const rule = builtinExecutionProvider();
    return { selected: true, providerId: rule.providerId, rule, builtin: true, reads };
  }

  const rules = registry.executionProviderRules;
  const find = (id?: string): ExecutionProviderRule | undefined =>
    id ? rules.find((rule) => rule.providerId === id) : undefined;

  // An EXPLICITLY requested provider is a requirement, not a preference:
  // if it cannot be selected, refuse -- never silently execute on a
  // different provider's capacity.
  const requested = options.requestedProviderId?.trim() || undefined;
  if (requested) {
    const rule = find(requested);
    if (!rule) return { selected: false, reason: "provider_unknown", reads };
    if (rule.enabled === false) return { selected: false, reason: "provider_disabled", reads };
    return { selected: true, providerId: requested, rule, reads };
  }

  const candidates: string[] = [];
  const defaultId = registry.defaultExecutionSelection?.providerId?.trim() || undefined;
  if (defaultId) candidates.push(defaultId);
  for (const rule of rules) if (!candidates.includes(rule.providerId)) candidates.push(rule.providerId);

  let replaced: ExecutionProviderSelection["replaced"];
  for (const id of candidates) {
    const rule = find(id);
    if (!rule) {
      replaced ??= { providerId: id, reason: "provider_unknown" };
      continue;
    }
    if (rule.enabled === false) {
      replaced ??= { providerId: id, reason: "provider_disabled" };
      continue;
    }
    return { selected: true, providerId: id, rule, ...(replaced ? { replaced } : {}), reads };
  }
  return {
    selected: false,
    ...(replaced ? { replaced } : {}),
    reason: replaced?.reason ?? (candidates.length > 0 ? "provider_unknown" : "registry_empty"),
    reads
  };
}

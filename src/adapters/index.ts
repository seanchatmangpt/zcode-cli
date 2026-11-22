/**
 * Pluggable workspace adapters for zcode-cli v26.11.20.
 * Core remains PowlNode-only; enable via [adapters.*] in zcode-cli.toml.
 *
 * Call path (live): `src/foundry-cli.ts` → `loadAdapterRegistryFromToml` →
 * `buildAdapterRegistry` → `runFoundryLoop({ courts })`.
 * Gall dry-run spine: `scripts/powl-foundry-loop.ts` → `buildAdapterRegistry` directly.
 */

export * from "./types.ts";
export * from "./sjira-io.ts";
export * from "./marketplace-court.ts";
export * from "./igniter-sync.ts";
export * from "./clean-room-drift.ts";
export * from "./receipt-sink.ts";
export * from "./castle-publish.ts";
export * from "./foundry-loop.ts";
export * from "./repo-verifier-court.ts";
export * from "./zcode-executor.ts";
export * from "./ui-layout-court.ts";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AdapterRegistry, TransitionCourtAdapter, WorkOrderSourceAdapter } from "./types.ts";
import { SjiraWorkOrderSource, type SjiraIoAdapterOptions } from "./sjira-io.ts";
import { MarketplaceCourtAdapter, type MarketplaceCourtOptions } from "./marketplace-court.ts";
import { IgniterSyncCourtAdapter, type IgniterSyncOptions } from "./igniter-sync.ts";
import { CastlePublishCourtAdapter, type CastlePublishOptions } from "./castle-publish.ts";
import { RepoVerifierCourtAdapter, type RepoVerifierCourtOptions } from "./repo-verifier-court.ts";
import { UiLayoutCourtAdapter, type UiLayoutCourtOptions } from "./ui-layout-court.ts";
import type { ReceiptSinkOptions } from "./receipt-sink.ts";
import { parseTomlDocument } from "../compliance/config.ts";

/** Twin-parity knobs parsed from `[adapters.sjira]` → `ReceiptSink`. */
export type ReceiptSinkParityOptions = Pick<
  ReceiptSinkOptions,
  "enforceTwinParity" | "twinParitySelfTestCmd"
>;

/** ARD-aligned option keys (§E.4). CamelCase aliases accepted for TS call sites. */
export interface BuildAdapterRegistryOptions {
  cwd: string;
  /** `[engine].max_remediation_attempts` ceiling (default 3). */
  maxRemediationAttempts?: number;
  /** `[adapters.sjira]` */
  sjira?: SjiraIoAdapterOptions & { enabled?: boolean };
  /** `[adapters.ggen_marketplace]` */
  ggen_marketplace?: MarketplaceCourtOptions & { enabled?: boolean };
  /** `@deprecated` alias → ggen_marketplace */
  marketplace?: MarketplaceCourtOptions & { enabled?: boolean };
  /** `[adapters.ggen_igniter]` */
  ggen_igniter?: IgniterSyncOptions & { enabled?: boolean };
  /** `@deprecated` alias → ggen_igniter */
  igniter?: IgniterSyncOptions & { enabled?: boolean };
  /** `[adapters.castle_publish]` */
  castle_publish?: CastlePublishOptions & { enabled?: boolean };
  /** `@deprecated` alias → castle_publish */
  castle?: CastlePublishOptions & { enabled?: boolean };
  /** Foundry extension (not Appendix E day-1). */
  repo_verifier?: RepoVerifierCourtOptions & { enabled?: boolean };
  /** `@deprecated` alias → repo_verifier */
  repoVerifier?: RepoVerifierCourtOptions & { enabled?: boolean };
  /** `[adapters.ui_layout]` — TransitionCourtAdapter.name = "ui-layout-court" */
  ui_layout?: UiLayoutCourtOptions & { enabled?: boolean };
  /** `@deprecated` alias → ui_layout */
  uiLayout?: UiLayoutCourtOptions & { enabled?: boolean };
  /**
   * Receipt-sink twin parity from `[adapters.sjira].enforce_twin_parity` /
   * `twin_parity_self_test_cmd` (camelCase alias: twinParitySelfTestCmd).
   */
  receipt_sink?: ReceiptSinkParityOptions;
}

export interface EngineTomlConfig {
  mode?: string;
  authorityCeiling?: string;
  maxRemediationAttempts: number;
}

export interface LoadedAdapterRegistry {
  registry: AdapterRegistry;
  engine: EngineTomlConfig;
  tomlPath: string;
  /** Parsed `[adapters.sjira]` twin-parity → pass into `new ReceiptSink(...)`. */
  receiptSink: ReceiptSinkParityOptions;
}

function pickEnabled<T extends { enabled?: boolean }>(
  primary: T | undefined,
  alias: T | undefined
): T | undefined {
  return primary ?? alias;
}

function isEnabled(opts: { enabled?: boolean } | undefined): opts is { enabled?: boolean } {
  return Boolean(opts) && opts!.enabled !== false;
}

export function buildAdapterRegistry(opts: BuildAdapterRegistryOptions): AdapterRegistry {
  const sources: WorkOrderSourceAdapter[] = [];
  const courts: TransitionCourtAdapter[] = [];
  const engineCap = opts.maxRemediationAttempts ?? 3;

  const sjira = opts.sjira;
  if (isEnabled(sjira) && sjira) {
    sources.push(new SjiraWorkOrderSource({ ...sjira, cwd: sjira.cwd ?? opts.cwd }));
  }

  const marketplace = pickEnabled(opts.ggen_marketplace, opts.marketplace);
  if (isEnabled(marketplace) && marketplace) {
    courts.push(new MarketplaceCourtAdapter(marketplace));
  }

  const igniter = pickEnabled(opts.ggen_igniter, opts.igniter);
  if (isEnabled(igniter) && igniter) {
    courts.push(new IgniterSyncCourtAdapter(igniter));
  }

  const castle = pickEnabled(opts.castle_publish, opts.castle);
  if (isEnabled(castle) && castle) {
    courts.push(new CastlePublishCourtAdapter(castle));
  }

  const repoVerifier = pickEnabled(opts.repo_verifier, opts.repoVerifier);
  if (isEnabled(repoVerifier) && repoVerifier) {
    courts.push(new RepoVerifierCourtAdapter(repoVerifier));
  }

  const uiLayout = pickEnabled(opts.ui_layout, opts.uiLayout);
  if (isEnabled(uiLayout) && uiLayout) {
    const attempts = uiLayout.maxRemediationAttempts ?? engineCap;
    if (attempts > engineCap) {
      // ARD §E.4: loader fail-closed when adapter budget exceeds engine ceiling.
      throw new Error(
        `STATIC_CONCURRENCY_FORBIDDEN: [adapters.ui_layout].max_remediation_attempts=${attempts} ` +
          `exceeds [engine].max_remediation_attempts=${engineCap}`
      );
    }
    courts.push(
      new UiLayoutCourtAdapter({
        ...uiLayout,
        maxRemediationAttempts: attempts
      })
    );
  }

  return { sources, courts };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nums = value.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length > 0 ? nums : undefined;
}

/**
 * Map ARD `[adapters.*]` / `[engine]` TOML tables → `BuildAdapterRegistryOptions`.
 * Option keys follow Appendix E.4 snake_case table names.
 * `[adapters.sjira].enforce_twin_parity` / `twin_parity_self_test_cmd` → `receipt_sink`.
 */
export function adapterOptionsFromTomlDoc(
  doc: Record<string, unknown>,
  cwd: string
): {
  engine: EngineTomlConfig;
  options: BuildAdapterRegistryOptions;
  receiptSink: ReceiptSinkParityOptions;
} {
  const engineTable = asRecord(doc.engine) ?? {};
  const engineCap = asNumber(engineTable.max_remediation_attempts) ?? 3;
  const engine: EngineTomlConfig = {
    mode: asString(engineTable.mode),
    authorityCeiling: asString(engineTable.authority_ceiling),
    maxRemediationAttempts: engineCap
  };

  const adapters = asRecord(doc.adapters) ?? {};
  const options: BuildAdapterRegistryOptions = {
    cwd,
    maxRemediationAttempts: engineCap
  };
  const receiptSink: ReceiptSinkParityOptions = {};

  const sjira = asRecord(adapters.sjira);
  if (sjira) {
    options.sjira = {
      cwd,
      enabled: asBool(sjira.enabled, true),
      minGgenAncestor: asString(sjira.min_ggen_ancestor),
      forbidTtyPrompts: asBool(sjira.forbid_tty_prompts, true),
      enforceMinGgenAncestor: Boolean(asString(sjira.min_ggen_ancestor))
    };
    // Twin parity lives on ReceiptSink, not SjiraWorkOrderSource.
    if (typeof sjira.enforce_twin_parity === "boolean") {
      receiptSink.enforceTwinParity = sjira.enforce_twin_parity;
    }
    const twinCmd =
      asStringArray(sjira.twin_parity_self_test_cmd) ??
      asStringArray(sjira.twinParitySelfTestCmd);
    if (twinCmd?.length) {
      receiptSink.twinParitySelfTestCmd = twinCmd;
    }
    options.receipt_sink = { ...receiptSink };
  }

  const marketplace = asRecord(adapters.ggen_marketplace);
  if (marketplace) {
    options.ggen_marketplace = {
      enabled: asBool(marketplace.enabled, true),
      enforcePackTomlMinimal: asBool(marketplace.enforce_pack_toml_minimal, true),
      forbidAskQueries: asBool(marketplace.forbid_ask_queries_in_gates, true),
      requireDoubleCapsuleCheck: asBool(marketplace.require_double_capsule_check, true),
      forbidConsumerPacksTable: asBool(marketplace.forbid_consumer_packs_table, true)
    };
  }

  const igniter = asRecord(adapters.ggen_igniter);
  if (igniter) {
    // require_sync_check is normative. Legacy require_git_diff_zero is refused
    // (ELIMINATE-2): do not alias the git-diff clean-room fallacy into the loader.
    options.ggen_igniter = {
      enabled: asBool(igniter.enabled, true),
      allowedMutationGlobs: asStringArray(igniter.allowed_mutation_globs),
      cleanRoomSyncCmd: asStringArray(igniter.clean_room_sync_cmd),
      requireSyncCheck: asBool(igniter.require_sync_check, true),
      forbidGeneratedDirs: asBool(igniter.forbid_generated_dirs, true)
    };
  }

  const castle = asRecord(adapters.castle_publish);
  if (castle) {
    options.castle_publish = {
      enabled: asBool(castle.enabled, false),
      requirePublicAnonymizeOn: asStringArray(castle.require_public_anonymize_on)
    };
  }

  const repoVerifier = asRecord(adapters.repo_verifier);
  if (repoVerifier) {
    options.repo_verifier = {
      enabled: asBool(repoVerifier.enabled, true)
    };
  }

  const uiLayout = asRecord(adapters.ui_layout);
  if (uiLayout) {
    // suite_enabled=false ⇒ LOUD_SKIP path (adapter.enabled=false).
    const suiteEnabled = asBool(uiLayout.suite_enabled, true);
    const enabled = asBool(uiLayout.enabled, true) && suiteEnabled;
    const taffyCmd = asStringArray(uiLayout.taffy_cmd);
    const playwrightGlob = asString(uiLayout.playwright_court_glob);
    // require_clean_room is normative. Legacy require_clean_room_diff is refused
    // (ELIMINATE-2): do not keep the clean-index / git-diff metaphor in the loader.
    const viewports = asNumberArray(uiLayout.viewports);
    options.ui_layout = {
      enabled,
      maxRemediationAttempts: asNumber(uiLayout.max_remediation_attempts) ?? engineCap,
      taffyCmd,
      playwrightCmd: playwrightGlob
        ? ["bunx", "playwright", "test", playwrightGlob]
        : undefined,
      requireCleanRoom: asBool(uiLayout.require_clean_room, true),
      ...(viewports ? { viewports } : {})
    };
  }

  return { engine, options, receiptSink };
}

/**
 * Load `[engine]` + `[adapters.*]` from zcode-cli.toml and build the registry.
 * Missing file → empty registry with engine defaults (courts opt-in via TOML).
 */
export function loadAdapterRegistryFromToml(
  tomlPath: string,
  opts: { cwd: string }
): LoadedAdapterRegistry {
  const resolved = resolve(tomlPath);
  if (!existsSync(resolved)) {
    return {
      tomlPath: resolved,
      engine: { maxRemediationAttempts: 3 },
      registry: buildAdapterRegistry({ cwd: opts.cwd, maxRemediationAttempts: 3 }),
      receiptSink: {}
    };
  }
  const doc = parseTomlDocument(readFileSync(resolved, "utf8"));
  const { engine, options, receiptSink } = adapterOptionsFromTomlDoc(doc, opts.cwd);
  return {
    tomlPath: resolved,
    engine,
    registry: buildAdapterRegistry(options),
    receiptSink
  };
}

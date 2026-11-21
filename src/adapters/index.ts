/**
 * Pluggable workspace adapters for zcode-cli v26.11.20.
 * Core remains PowlNode-only; enable via [adapters.*] in zcode-cli.toml.
 */

export * from "./types.ts";
export * from "./sjira-io.ts";
export * from "./marketplace-court.ts";
export * from "./igniter-sync.ts";
export * from "./receipt-sink.ts";
export * from "./castle-publish.ts";
export * from "./foundry-loop.ts";
export * from "./repo-verifier-court.ts";
export * from "./zcode-executor.ts";

import type { AdapterRegistry, TransitionCourtAdapter, WorkOrderSourceAdapter } from "./types.ts";
import { SjiraWorkOrderSource, type SjiraIoAdapterOptions } from "./sjira-io.ts";
import { MarketplaceCourtAdapter, type MarketplaceCourtOptions } from "./marketplace-court.ts";
import { IgniterSyncCourtAdapter, type IgniterSyncOptions } from "./igniter-sync.ts";
import { CastlePublishCourtAdapter, type CastlePublishOptions } from "./castle-publish.ts";
import { RepoVerifierCourtAdapter, type RepoVerifierCourtOptions } from "./repo-verifier-court.ts";

export interface BuildAdapterRegistryOptions {
  cwd: string;
  sjira?: SjiraIoAdapterOptions & { enabled?: boolean };
  marketplace?: MarketplaceCourtOptions & { enabled?: boolean };
  igniter?: IgniterSyncOptions & { enabled?: boolean };
  castle?: CastlePublishOptions & { enabled?: boolean };
  repoVerifier?: RepoVerifierCourtOptions & { enabled?: boolean };
}

export function buildAdapterRegistry(opts: BuildAdapterRegistryOptions): AdapterRegistry {
  const sources: WorkOrderSourceAdapter[] = [];
  const courts: TransitionCourtAdapter[] = [];

  if (opts.sjira?.enabled !== false && opts.sjira) {
    sources.push(new SjiraWorkOrderSource({ ...opts.sjira, cwd: opts.sjira.cwd ?? opts.cwd }));
  }
  if (opts.marketplace?.enabled !== false && opts.marketplace) {
    courts.push(new MarketplaceCourtAdapter(opts.marketplace));
  }
  if (opts.igniter?.enabled !== false && opts.igniter) {
    courts.push(new IgniterSyncCourtAdapter(opts.igniter));
  }
  if (opts.castle?.enabled !== false && opts.castle) {
    courts.push(new CastlePublishCourtAdapter(opts.castle));
  }
  if (opts.repoVerifier?.enabled !== false && opts.repoVerifier) {
    courts.push(new RepoVerifierCourtAdapter(opts.repoVerifier));
  }

  return { sources, courts };
}

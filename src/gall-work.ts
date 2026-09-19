import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface GallWorkLease {
  schema: "gall.work-lease/1";
  checkpoint_iri: string;
  graph_digest: string;
  epoch_id: string;
  worker_id: string;
  worktree: string;
}

export interface GallWorkInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

const sha256Digest = /^sha256:[0-9a-f]{64}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const workerId = /^[A-Za-z0-9._:-]{1,128}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid GALL work lease field: ${field}.`);
  }
  return value;
}

export function parseGallWorkLease(value: unknown): GallWorkLease {
  const input = record(value);
  if (!input || input.schema !== "gall.work-lease/1") {
    throw new Error("Unsupported GALL work lease schema.");
  }

  const checkpoint_iri = nonEmptyString(input.checkpoint_iri, "checkpoint_iri");
  const graph_digest = nonEmptyString(input.graph_digest, "graph_digest");
  const epoch_id = nonEmptyString(input.epoch_id, "epoch_id");
  const selectedWorker = nonEmptyString(input.worker_id, "worker_id");
  const worktree = nonEmptyString(input.worktree, "worktree");

  if (!checkpoint_iri.includes(":")) throw new Error("checkpoint_iri must be an absolute IRI.");
  if (!sha256Digest.test(graph_digest)) throw new Error("graph_digest must be sha256:<64 lowercase hex>.");
  if (!uuid.test(epoch_id)) throw new Error("epoch_id must be a UUID.");
  if (!workerId.test(selectedWorker)) throw new Error("worker_id contains unsupported characters.");
  if (!isAbsolute(worktree)) throw new Error("worktree must be an absolute path.");

  return {
    schema: "gall.work-lease/1",
    checkpoint_iri,
    graph_digest,
    epoch_id,
    worker_id: selectedWorker,
    worktree: resolve(worktree)
  };
}

export async function gallWorkInvocation(args: string[]): Promise<GallWorkInvocation | undefined> {
  if (args[0] !== "gall-work") return undefined;

  if (args.length !== 3 || args[1] !== "--lease") {
    throw new Error("Usage: zcode gall-work --lease <descriptor.json>");
  }

  const raw = JSON.parse(await readFile(args[2]!, "utf8")) as unknown;
  const lease = parseGallWorkLease(raw);

  const prompt =
    "/xaas Call claim_next with provider_worker_id exactly "
    + JSON.stringify(lease.worker_id)
    + " and epoch_id exactly "
    + JSON.stringify(lease.epoch_id)
    + "; do not use any other values.";

  return {
    args: ["--prompt", prompt, "--cwd", lease.worktree, "--json"],
    env: {
      XAAS_WORKER: "1",
      XAAS_LEASE_CWD: lease.worktree,
      GALL_CHECKPOINT_IRI: lease.checkpoint_iri,
      GALL_GRAPH_DIGEST: lease.graph_digest
    }
  };
}

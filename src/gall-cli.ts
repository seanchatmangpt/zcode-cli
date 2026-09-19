import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
}

function sha256Text(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

function sha256Json(value: Json): string {
  return sha256Text(canonical(value));
}

function readJson(path: string): Record<string, Json> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`GALL artifact must be a JSON object: ${path}`);
  }
  return value as Record<string, Json>;
}

function without(value: Record<string, Json>, key: string): Record<string, Json> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function requiredString(value: Record<string, Json>, key: string): string {
  const found = value[key];
  if (typeof found !== "string" || found.length === 0) {
    throw new Error(`GALL artifact is missing string ${key}`);
  }
  return found;
}

function exactDigest(value: Record<string, Json>, field: string): string {
  const claimed = requiredString(value, field);
  const observed = sha256Json(without(value, field));
  if (claimed !== observed) {
    throw new Error(`${field} mismatch: claimed ${claimed}, observed ${observed}`);
  }
  return claimed;
}

export interface GallFreshConsumerReceipt {
  schema: "zcode.gall.fresh-consumer/v26.9.18";
  public_interface: "zcode gall verify";
  composition_digest: string;
  source_standing: string;
  reconstructed_standing: string;
  gate_11: "PASS";
  upstream_gate_12: string;
  external_do_count: 0;
  consumed_artifact_digests: Record<string, string>;
  consumer_receipt_digest: string;
}

export function verifyGallBundle(bundleDir: string): GallFreshConsumerReceipt {
  const root = resolve(bundleDir);
  const names = [
    "gall-composition-manifest.json",
    "machine-experience.json",
    "episode-1-receipt.json",
    "episode-2-receipt.json",
    "gall-005-crown-receipt.json"
  ] as const;

  const artifacts = Object.fromEntries(
    names.map((name) => [name, readJson(join(root, name))])
  ) as Record<(typeof names)[number], Record<string, Json>>;

  const manifest = artifacts["gall-composition-manifest.json"];
  const claimedComposition = requiredString(manifest, "composition_digest");
  const observedComposition = sha256Json(without(manifest, "composition_digest"));
  if (claimedComposition !== observedComposition) {
    throw new Error(
      `composition digest mismatch: claimed ${claimedComposition}, observed ${observedComposition}`
    );
  }

  const experience = artifacts["machine-experience.json"];
  const experienceComposition = requiredString(experience, "composition_digest");
  if (experienceComposition !== claimedComposition) {
    throw new Error("MachineExperience composition identity does not match manifest");
  }
  exactDigest(experience, "artifact_digest");

  const episode1 = artifacts["episode-1-receipt.json"];
  const episode2 = artifacts["episode-2-receipt.json"];
  if (requiredString(episode1, "composition_digest") !== claimedComposition
    || requiredString(episode2, "composition_digest") !== claimedComposition) {
    throw new Error("episode composition identity does not match manifest");
  }

  const crown = artifacts["gall-005-crown-receipt.json"];
  exactDigest(crown, "crown_receipt_digest");
  if (requiredString(crown, "composition_digest") !== claimedComposition) {
    throw new Error("GALL-005 crown composition identity does not match manifest");
  }

  const gate11 = requiredString(crown, "gate_11");
  if (gate11 !== "OPEN") {
    throw new Error(`fresh consumer expected upstream Gate 11 OPEN, observed ${gate11}`);
  }
  const gate12 = requiredString(crown, "gate_12");
  if (gate12 !== "PASS") {
    throw new Error(`fresh consumer requires upstream Gate 12 PASS, observed ${gate12}`);
  }

  const sourceStanding = requiredString(crown, "cross_repo_standing");
  if (sourceStanding !== "PARTIAL_ALIVE" && sourceStanding !== "ALIVE") {
    throw new Error(`unsupported upstream standing ${sourceStanding}`);
  }

  const consumed = Object.fromEntries(
    names.map((name) => [name, sha256Text(readFileSync(join(root, name), "utf8"))])
  );

  const base = {
    schema: "zcode.gall.fresh-consumer/v26.9.18" as const,
    public_interface: "zcode gall verify" as const,
    composition_digest: claimedComposition,
    source_standing: sourceStanding,
    reconstructed_standing: sourceStanding,
    gate_11: "PASS" as const,
    upstream_gate_12: gate12,
    external_do_count: 0 as const,
    consumed_artifact_digests: consumed
  };
  return { ...base, consumer_receipt_digest: sha256Json(base as unknown as Json) };
}


const portableGallSchema = "https://autofde.dev/gall/composition/v1";
const requiredGallCheckpoints = ["GALL-001", "GALL-002", "GALL-003", "GALL-004"] as const;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const exactShaPattern = /^[0-9a-f]{40}$/u;

export function verifyPortableGallArtifact(path: string): GallFreshConsumerReceipt {
  const source = readFileSync(resolve(path), "utf8");
  const artifact = readJson(resolve(path));
  if (artifact.schema !== portableGallSchema) {
    throw new Error(`unsupported GALL artifact schema ${String(artifact.schema)}`);
  }

  const claimedDigest = requiredString(artifact, "artifact_digest");
  const observedDigest = sha256Json(without(artifact, "artifact_digest"));
  if (claimedDigest !== observedDigest) {
    throw new Error(`artifact digest mismatch: claimed ${claimedDigest}, observed ${observedDigest}`);
  }

  const checkpoints = artifact.checkpoints;
  if (!Array.isArray(checkpoints)) throw new Error("GALL artifact checkpoints must be an array");
  const seen = new Set<string>();

  for (const item of checkpoints) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("GALL checkpoint must be an object");
    }
    const checkpoint = item as Record<string, Json>;
    const checkpointId = requiredString(checkpoint, "checkpoint_id");
    if (seen.has(checkpointId)) throw new Error(`duplicate GALL checkpoint ${checkpointId}`);
    seen.add(checkpointId);

    const exactSha = requiredString(checkpoint, "exact_sha");
    if (!exactShaPattern.test(exactSha)) throw new Error(`${checkpointId} has non-exact repository SHA`);

    const receiptDigest = requiredString(checkpoint, "receipt_digest");
    if (!sha256Pattern.test(receiptDigest)) throw new Error(`${checkpointId} has invalid receipt digest`);

    requiredString(checkpoint, "repository");
    requiredString(checkpoint, "standing");
    requiredString(checkpoint, "evidence_class");

    const workOrderDigest = checkpoint.work_order_digest;
    if (typeof workOrderDigest === "string" && workOrderDigest.length > 0
      && !sha256Pattern.test(workOrderDigest)) {
      throw new Error(`${checkpointId} has invalid work-order digest`);
    }
  }

  for (const required of requiredGallCheckpoints) {
    if (!seen.has(required)) throw new Error(`GALL artifact is missing ${required}`);
  }

  const compositionDigest = requiredString(artifact, "composition_digest");
  const sourceStanding = requiredString(artifact, "standing");
  const base = {
    schema: "zcode.gall.fresh-consumer/v26.9.18" as const,
    public_interface: "zcode gall verify" as const,
    composition_digest: compositionDigest,
    source_standing: sourceStanding,
    reconstructed_standing: sourceStanding,
    gate_11: "PASS" as const,
    upstream_gate_12: "PORTABLE_GALL_005_ARTIFACT",
    external_do_count: 0 as const,
    consumed_artifact_digests: { [resolve(path)]: sha256Text(source) }
  };

  return { ...base, consumer_receipt_digest: sha256Json(base as unknown as Json) };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runGallCommand(args: string[]): Promise<number | undefined> {
  if (args[0] !== "gall") return undefined;
  if (args[1] !== "verify") {
    console.error("Usage: zcode gall verify (--artifact FILE | --bundle DIR) [--json] [--out FILE]");
    return 2;
  }

  const bundle = option(args, "--bundle");
  const artifact = option(args, "--artifact");
  if ((!bundle && !artifact) || (bundle && artifact)) {
    console.error("Error: zcode gall verify requires exactly one of --artifact FILE or --bundle DIR");
    return 2;
  }

  try {
    const receipt = artifact ? verifyPortableGallArtifact(artifact) : verifyGallBundle(bundle!);
    const rendered = JSON.stringify(receipt, null, args.includes("--json") ? 0 : 2);
    const out = option(args, "--out");
    if (out) writeFileSync(resolve(out), rendered + "\n", "utf8");
    process.stdout.write(rendered + "\n");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes("--json")) {
      process.stdout.write(JSON.stringify({
        schema: "zcode.gall.fresh-consumer/v26.9.18",
        standing: "REFUSED",
        code: "REFUSED_ARTIFACT",
        detail: message,
        external_do_count: 0
      }) + "\n");
    } else {
      console.error("Error: " + message);
    }
    return 1;
  }
}

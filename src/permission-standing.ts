import { createHash } from "node:crypto";

export type PermissionStanding = "UNKNOWN" | "REFUSED" | "ADMITTED";

export interface PermissionSubject {
  repository: string;
  baseSha: string;
  workerId: string;
  epochId: string;
}

export interface PermissionObservation {
  observer: string;
  producer: string;
  repository: string;
  baseSha: string;
  argv: readonly string[];
  requestedAuthority: "SELECT" | "CONSTRUCT" | "DO";
  observedMode?: string;
}

export interface PermissionStandingReceipt {
  schema: "zcode.permission-standing/1";
  subject: PermissionSubject;
  state: PermissionStanding;
  reason: string;
  authorityCeiling: "CONSTRUCT";
  evidenceDigest: string;
  receiptDigest: string;
}

const sha = /^[0-9a-f]{40}$/u;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function modeFromArgv(argv: readonly string[]): string | undefined {
  const indexes = argv.flatMap((value, index) => value === "--mode" ? [index] : []);
  if (indexes.length !== 1) return undefined;
  return argv[indexes[0]! + 1];
}

export function qualifyPermissionStanding(
  subject: PermissionSubject,
  observation?: PermissionObservation
): PermissionStandingReceipt {
  let state: PermissionStanding = "UNKNOWN";
  let reason = "independent_observation_missing";

  if (!sha.test(subject.baseSha)) {
    state = "REFUSED";
    reason = "subject_base_sha_invalid";
  } else if (observation) {
    const argvMode = modeFromArgv(observation.argv);
    const contradictions: string[] = [];
    if (observation.repository !== subject.repository) contradictions.push("cross_repository_evidence");
    if (observation.baseSha !== subject.baseSha) contradictions.push("stale_or_cross_subject_sha");
    if (observation.observer === observation.producer) contradictions.push("self_attestation");
    if (observation.requestedAuthority === "DO") contradictions.push("authority_laundering");
    if (argvMode !== "yolo") contradictions.push(argvMode === undefined ? "mode_not_uniquely_bound" : "mode_not_yolo");
    if (observation.observedMode !== undefined && observation.observedMode !== argvMode) {
      contradictions.push("argv_observation_divergence");
    }
    if (contradictions.length > 0) {
      state = "REFUSED";
      reason = contradictions.sort().join("+");
    } else {
      state = "ADMITTED";
      reason = "exact_subject_independent_yolo_construct";
    }
  }

  const evidenceDigest = digest({ subject, observation: observation ?? null, authorityCeiling: "CONSTRUCT" });
  const unsigned = {
    schema: "zcode.permission-standing/1" as const,
    subject,
    state,
    reason,
    authorityCeiling: "CONSTRUCT" as const,
    evidenceDigest
  };
  return { ...unsigned, receiptDigest: digest(unsigned) };
}

export function replayPermissionStanding(
  receipt: PermissionStandingReceipt,
  observation?: PermissionObservation
): boolean {
  const replayed = qualifyPermissionStanding(receipt.subject, observation);
  return canonical(replayed) === canonical(receipt);
}

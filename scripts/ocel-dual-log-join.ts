#!/usr/bin/env bun
// Tiny mining helper for the seal-time dual-log join sidecar.
// Resolves {stream_ocel, gall_ocel, work_order_iri, epoch_id} and prints a
// join envelope with absolute paths — does not merge or rehash the logs.
//
//   bun scripts/ocel-dual-log-join.ts <gall-work-<epoch>.join.json>
//   bun scripts/ocel-dual-log-join.ts <ocel-dir> --epoch <epoch-id>
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DUAL_LOG_JOIN_SCHEMA,
  dualLogJoinBasename,
  parseDualLogJoinManifest,
  readDualLogJoinManifest,
  resolveDualLogJoinPaths
} from "../src/ocel-tap.ts";

function usage(): never {
  console.error(
    "usage: ocel-dual-log-join.ts <join.json> | <ocel-dir> --epoch <epoch-id>"
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

let dir: string;
let joinPath: string;
let manifest = undefined as ReturnType<typeof parseDualLogJoinManifest>;

if (args.includes("--epoch")) {
  const epochIdx = args.indexOf("--epoch");
  const epochId = args[epochIdx + 1];
  const dirArg = args.find((a, i) => i !== epochIdx && i !== epochIdx + 1 && !a.startsWith("-"));
  if (!epochId?.trim() || !dirArg) usage();
  dir = resolve(dirArg);
  joinPath = resolve(dir, dualLogJoinBasename(epochId.trim()));
  manifest = readDualLogJoinManifest(dir, epochId.trim());
} else {
  joinPath = resolve(args[0]!);
  dir = dirname(joinPath);
  if (!existsSync(joinPath)) {
    console.error(`REFUSED: join sidecar not found: ${joinPath}`);
    process.exit(1);
  }
  try {
    manifest = parseDualLogJoinManifest(JSON.parse(readFileSync(joinPath, "utf8")) as unknown);
  } catch (error) {
    console.error(
      `REFUSED: unparseable join sidecar: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

if (!manifest) {
  console.error(`REFUSED: invalid or missing dual-log join (${DUAL_LOG_JOIN_SCHEMA}): ${joinPath}`);
  process.exit(1);
}

const { streamOcelPath, gallOcelPath } = resolveDualLogJoinPaths(dir, manifest);
const missing: string[] = [];
if (!existsSync(streamOcelPath)) missing.push(streamOcelPath);
if (!existsSync(gallOcelPath)) missing.push(gallOcelPath);
if (missing.length) {
  console.error(`REFUSED: OCEL file(s) missing for join:\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      schema: "zcode.dual-log-join-resolve/1",
      join: joinPath,
      work_order_iri: manifest.work_order_iri,
      epoch_id: manifest.epoch_id,
      stream_ocel: streamOcelPath,
      gall_ocel: gallOcelPath,
      ...(manifest.sessions ? { sessions: manifest.sessions } : {})
    },
    null,
    2
  )
);

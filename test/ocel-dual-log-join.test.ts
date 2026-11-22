// Dual-log join sidecar: stream↔gall files share lease identity but stay
// separate `.jsonocel` logs. Seal-time writes a minimal join index — no
// merge, no rehash. Falsifies the LIE that in-log O2O alone joins the pair.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DUAL_LOG_JOIN_SCHEMA,
  GALL_WORK_SOURCE,
  OcelRecorder,
  buildDualLogJoinManifest,
  dualLogJoinBasename,
  writeDualLogJoinManifest
} from "../src/ocel-tap.ts";
import { fixtures } from "./support/ocel.ts";

const workOrderIri = "https://w3id.org/chatman/sjira/v26.9.22#ZOCEL-DUAL-JOIN";
const epochId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("dual-log join manifest", () => {
  test("buildDualLogJoinManifest requires all four core fields", () => {
    expect(
      buildDualLogJoinManifest({
        streamOcel: "s.jsonocel",
        gallOcel: "g.jsonocel",
        workOrderIri,
        epochId
      })
    ).toEqual({
      schema: DUAL_LOG_JOIN_SCHEMA,
      stream_ocel: "s.jsonocel",
      gall_ocel: "g.jsonocel",
      work_order_iri: workOrderIri,
      epoch_id: epochId
    });
    expect(
      buildDualLogJoinManifest({
        streamOcel: "",
        gallOcel: "g.jsonocel",
        workOrderIri,
        epochId
      })
    ).toBeUndefined();
    expect(
      buildDualLogJoinManifest({
        streamOcel: "s.jsonocel",
        gallOcel: "g.jsonocel",
        workOrderIri: "  ",
        epochId
      })
    ).toBeUndefined();
  });

  test("optional sessions cross-link stream/gall namespaces without merge fields", () => {
    const manifest = buildDualLogJoinManifest({
      streamOcel: "sess-abc.jsonocel",
      gallOcel: `gall-work-${epochId}.jsonocel`,
      workOrderIri,
      epochId,
      streamSession: "sess-abc",
      gallSession: `gall-work-${epochId}`
    });
    expect(manifest?.sessions).toEqual({
      stream: "sess-abc",
      gall: `gall-work-${epochId}`
    });
    expect(manifest).not.toHaveProperty("merged");
    expect(manifest).not.toHaveProperty("head_hash");
  });

  test("writeDualLogJoinManifest seals gall-work-<epoch>.join.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocel-dual-join-"));
    try {
      const manifest = buildDualLogJoinManifest({
        streamOcel: "stream-sess.jsonocel",
        gallOcel: `gall-work-${epochId}.jsonocel`,
        workOrderIri,
        epochId,
        streamSession: "stream-sess",
        gallSession: `gall-work-${epochId}`
      })!;
      const path = writeDualLogJoinManifest(dir, manifest);
      expect(path).toBe(join(dir, dualLogJoinBasename(epochId)));
      expect(existsSync(path)).toBe(true);
      const onDisk = JSON.parse(readFileSync(path, "utf8")) as typeof manifest;
      expect(onDisk.schema).toBe(DUAL_LOG_JOIN_SCHEMA);
      expect(onDisk.stream_ocel).toBe("stream-sess.jsonocel");
      expect(onDisk.gall_ocel).toBe(`gall-work-${epochId}.jsonocel`);
      expect(onDisk.work_order_iri).toBe(workOrderIri);
      expect(onDisk.epoch_id).toBe(epochId);
      expect(onDisk.sessions?.stream).toBe("stream-sess");
      expect(onDisk.sessions?.gall).toBe(`gall-work-${epochId}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("seal-time dual logs stay two files; join indexes them by lease identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocel-dual-seal-"));
    try {
      const identity = {
        workOrderIri,
        epochId
      };
      const stream = new OcelRecorder("zcode_stream", dir, identity);
      stream.write(fixtures()[0].lines.join("\n") + "\n");
      const streamOut = stream.finish();

      const gall = new OcelRecorder(GALL_WORK_SOURCE, dir, identity);
      gall.feed({
        event: "provider.select",
        id: "provider.select#1",
        ts: new Date().toISOString(),
        sessionId: `gall-work-${epochId}`,
        provider: "zcode"
      });
      const gallOut = gall.finish();

      expect(streamOut.ocelPath).not.toBe(gallOut.ocelPath);
      expect(existsSync(streamOut.ocelPath)).toBe(true);
      expect(existsSync(gallOut.ocelPath)).toBe(true);

      const manifest = buildDualLogJoinManifest({
        streamOcel: streamOut.sessionId + ".jsonocel",
        gallOcel: gallOut.sessionId + ".jsonocel",
        workOrderIri,
        epochId,
        streamSession: streamOut.sessionId,
        gallSession: gallOut.sessionId
      })!;
      const joinPath = writeDualLogJoinManifest(dir, manifest);
      const onDisk = JSON.parse(readFileSync(joinPath, "utf8")) as {
        stream_ocel: string;
        gall_ocel: string;
        work_order_iri: string;
        epoch_id: string;
      };
      expect(onDisk.stream_ocel).toBe(`${streamOut.sessionId}.jsonocel`);
      expect(onDisk.gall_ocel).toBe(`${gallOut.sessionId}.jsonocel`);
      expect(onDisk.work_order_iri).toBe(workOrderIri);
      expect(onDisk.epoch_id).toBe(epochId);
      // No merged log was written.
      expect(existsSync(join(dir, `gall-work-${epochId}.merged.jsonocel`))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

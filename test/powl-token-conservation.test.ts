import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  deepFreeze,
  executePowlWithTokenReplay,
  tokenConservationHolds,
  type PowlNode
} from "../src/powl-ocel-orchestrator.ts";

const linearTwo: PowlNode = {
  kind: "partial_order",
  id: "conserv-linear",
  children: [
    { kind: "activity", id: "probe", label: "Probe", objectType: "Artifact" },
    { kind: "activity", id: "publish", label: "Publish", objectType: "Artifact" }
  ],
  order: [["probe", "publish"]]
};

const single: PowlNode = {
  kind: "activity",
  id: "seed",
  label: "Seed",
  objectType: "Artifact"
};

describe("token conservation (p+m = c+r) — EU AI Act accuracy falsifier", () => {
  test("successful run conserves tokens", async () => {
    const res = await executePowlWithTokenReplay(linearTwo, async () => ({ ok: true, exitCode: 0 }));
    expect(tokenConservationHolds(res.replay)).toBe(true);
    expect(res.replay.fitness).toBe(1);
    expect(res.replay.soundTermination).toBe(true);
  });

  test("logic refusal conserves tokens and still degrades fitness < 1.0", async () => {
    // Antigravity: pre-fix refused runs broke Rozinat conservation (p+m ≠ c+r)
    // by inventing a phantom sink missing after destroying reserved tokens.
    const res = await executePowlWithTokenReplay(linearTwo, async () => ({
      ok: false,
      exitCode: 1,
      detail: "SHA256_MISMATCH"
    }));
    expect(tokenConservationHolds(res.replay)).toBe(true);
    expect(res.replay.soundTermination).toBe(false);
    expect(res.replay.fitness).toBeLessThan(1);
    expect(res.replay.remaining).toBeGreaterThan(0);
    expect(res.replay.missing).toBe(0);
  });

  test("single-activity refusal conserves tokens", async () => {
    const res = await executePowlWithTokenReplay(single, async () => ({ ok: false, exitCode: 1 }));
    expect(tokenConservationHolds(res.replay)).toBe(true);
    expect(res.replay.fitness).toBeLessThan(1);
  });

  test("transport backpressure recovery conserves tokens", async () => {
    let attempts = 0;
    const res = await executePowlWithTokenReplay(linearTwo, async () => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, transportBackpressure: true, exitCode: 1, detail: "UND_ERR_CONNECT_TIMEOUT" };
      }
      return { ok: true, exitCode: 0 };
    });
    expect(tokenConservationHolds(res.replay)).toBe(true);
    expect(res.replay.fitness).toBe(1);
  });
});

describe("post-return OCEL/SHA immutability — EU AI Act record accuracy falsifier", () => {
  test("returned OCEL is frozen; mutation throws and SHA stays tied to emit bytes", async () => {
    // Antigravity: pre-fix returned a live mutable OCEL whose post-return edits
    // diverged from ocelSha256 without detection.
    const res = await executePowlWithTokenReplay(single, async () => ({ ok: true, exitCode: 0 }));
    const emitSha = createHash("sha256").update(JSON.stringify(res.ocel, null, 2)).digest("hex");
    expect(emitSha).toBe(res.ocelSha256);
    expect(Object.isFrozen(res.ocel)).toBe(true);
    expect(Object.isFrozen(res.ocel.objects)).toBe(true);
    expect(Object.isFrozen(res.ocel.events)).toBe(true);

    expect(() => {
      res.ocel.objects[0]!.attributes.push({
        name: "hack",
        value: "mutated",
        time: new Date().toISOString()
      });
    }).toThrow();

    expect(createHash("sha256").update(JSON.stringify(res.ocel, null, 2)).digest("hex")).toBe(
      res.ocelSha256
    );
  });

  test("deepFreeze helper freezes nested plain objects", () => {
    const obj = deepFreeze({ a: { b: [1, 2] } });
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
  });
});

// Qualification for typed bounded provider-capacity backoff (ZCODE-26922-10).
//
// HTTP 429 and business code 1302 ("High concurrency usage") saturated the
// xaas dispatch fleet (~1474 log lines). The posture required here, proven
// against REAL local HTTP servers (no mocks of owned collaborators):
//   - a capacity error is retried with typed, bounded, observable backoff;
//   - exhaustion is a TYPED refusal (ProviderCapacityRefusal), never a
//     re-dispatch as a prompt;
//   - the fabric client (fabricCall) classifies 429 and the 1302 tool-error
//     envelope as capacity, retries, then refuses typed;
//   - the concurrency cap bounds this process's in-flight provider calls as
//     observed by the server itself.
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, expect, test } from "bun:test";

import {
  callWithCapacityBackoff,
  capacityFromBody,
  capacityFromStatus,
  ConcurrencyCap,
  delayForAttempt,
  defaultBackoffPolicy,
  isProviderCapacityRefusal,
  ProviderCapacityRefusal
} from "../src/provider-backoff.ts";
import { fabricCall } from "../src/gall-work.ts";

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

interface HttpStubOptions {
  status?: (requestIndex: number) => number;
  body?: (requestIndex: number) => unknown;
  respondDelayMs?: number;
}

/** A real localhost HTTP server scripted per request index. */
function startHttpStub(options: HttpStubOptions): {
  url: string;
  requestCount: () => number;
  maxInFlight: () => number;
} {
  let count = 0;
  let inFlight = 0;
  let max = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    count += 1;
    inFlight += 1;
    max = Math.max(max, inFlight);
    const index = count - 1;
    setTimeout(() => {
      const status = options.status?.(index) ?? 200;
      const payload = options.body?.(index) ?? { ok: true };
      response.writeHead(status, { "content-type": "application/json" });
      response.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      inFlight -= 1;
    }, options.respondDelayMs ?? 0);
  });
  server.listen(0, "127.0.0.1");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  servers.push(server);
  return {
    url: `http://127.0.0.1:${address.port}/`,
    requestCount: () => count,
    maxInFlight: () => max
  };
}

const fastPolicy = { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 40, jitterRatio: 0 };

test("capacityFromStatus and capacityFromBody classify the observed envelopes", () => {
  expect(capacityFromStatus(429)).toEqual({ code: "http_429", message: "HTTP 429" });
  expect(capacityFromStatus(500)).toBe(false);
  expect(capacityFromBody(JSON.stringify({ error: { code: 1302 }, message: "High concurrency usage" }))).toEqual({
    code: "provider_1302",
    message: "High concurrency usage"
  });
  expect(capacityFromBody(JSON.stringify({ error: "rate_limited" }))).toBe(false);
  expect(capacityFromBody("all good")).toBe(false);
});

test("delays are exponential, capped, and jittered within bounds", () => {
  expect(delayForAttempt(defaultBackoffPolicy, 1, () => 0.5)).toBe(500);
  expect(delayForAttempt(defaultBackoffPolicy, 3, () => 0.5)).toBe(2000);
  expect(delayForAttempt(defaultBackoffPolicy, 10, () => 0.5)).toBe(defaultBackoffPolicy.maxDelayMs);
  const jittered = delayForAttempt(defaultBackoffPolicy, 1, () => 1);
  expect(jittered).toBeLessThanOrEqual(500 * 1.2);
  expect(jittered).toBeGreaterThanOrEqual(500 * 0.8);
});

test("retries a real 429 with typed backoff and succeeds", async () => {
  const server = startHttpStub({ status: (index) => (index < 2 ? 429 : 200) });
  const retries: Array<{ attempt: number; delayMs: number; code: string }> = [];
  const result = await callWithCapacityBackoff(
    async () => {
      const response = await fetch(server.url);
      return { response, body: await response.json() as unknown };
    },
    {
      capacityOf: (r) => capacityFromStatus(r.response.status),
      policy: fastPolicy,
      onRetry: (info) => retries.push({ attempt: info.attempt, delayMs: info.delayMs, code: info.code })
    }
  );
  expect(result.response.status).toBe(200);
  expect(server.requestCount()).toBe(3);
  expect(retries.map((retry) => retry.code)).toEqual(["http_429", "http_429"]);
  expect(retries.map((retry) => retry.delayMs)).toEqual([10, 20]);
});

test("refuses typed after bounded retries when 429 persists (no prompt fallback)", async () => {
  const server = startHttpStub({ status: () => 429 });
  let refusal: unknown;
  try {
    await callWithCapacityBackoff(
      async () => {
        const response = await fetch(server.url);
        return { response, body: await response.json() as unknown };
      },
      {
        capacityOf: (r) => capacityFromStatus(r.response.status),
        policy: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 }
      }
    );
  } catch (error) {
    refusal = error;
  }
  expect(isProviderCapacityRefusal(refusal)).toBe(true);
  const typed = refusal as ProviderCapacityRefusal;
  expect(typed.code).toBe("retry_exhausted");
  expect(typed.attempts).toBe(3);
  expect(typed.lastCapacityCode).toBe("http_429");
  // The refusal is a typed object, never a prompt-shaped fallback.
  expect((refusal as { prompt?: unknown }).prompt).toBeUndefined();
  expect(server.requestCount()).toBe(3);
});

test("classifies a 200 envelope carrying business code 1302 as capacity and retries", async () => {
  const server = startHttpStub({
    body: (index) => (index === 0 ? { error: { code: 1302 }, message: "High concurrency usage" } : { renewed: true })
  });
  const retries: string[] = [];
  const result = await callWithCapacityBackoff(
    async () => {
      const response = await fetch(server.url);
      return { response, body: await response.json() as unknown };
    },
    {
      capacityOf: (r) => capacityFromBody(JSON.stringify(r.body)),
      policy: fastPolicy,
      onRetry: (info) => retries.push(info.code)
    }
  );
  expect(result.body).toEqual({ renewed: true });
  expect(retries).toEqual(["provider_1302"]);
  expect(server.requestCount()).toBe(2);
});

test("concurrency cap bounds in-flight provider calls as observed by the server", async () => {
  const server = startHttpStub({ respondDelayMs: 40 });
  const cap = new ConcurrencyCap(3);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => cap.run(() => fetch(server.url).then((response) => response.status)))
  );
  expect(results.every((status) => status === 200)).toBe(true);
  expect(server.requestCount()).toBe(10);
  expect(server.maxInFlight()).toBeLessThanOrEqual(3);
  expect(server.maxInFlight()).toBeGreaterThan(0);
});

test("fabricCall retries a 429 fabric and refuses typed without prompting", async () => {
  const server = startHttpStub({ status: () => 429 });
  const outcome = await fabricCall({ url: server.url }, "claim_next", { provider: "zcode" }, 5_000);
  expect(outcome.ok).toBe(false);
  expect(outcome.error).toBe("fabric_capacity:retry_exhausted:attempts=3");
  expect(server.requestCount()).toBe(3);
  // The refusal is typed in `error`, never a prompt-shaped fallback.
  expect(JSON.stringify(outcome)).not.toContain("prompt");
});

test("fabricCall treats the 1302 tool-error envelope as capacity and then succeeds", async () => {
  const server = startHttpStub({
    body: (index) =>
      index === 0
        ? { result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: 1302 }, message: "High concurrency usage" }) }] } }
        : { result: { content: [{ type: "text", text: JSON.stringify({ status: "renewed" }) }] } }
  });
  const outcome = await fabricCall({ url: server.url }, "heartbeat", { lease_token: "t" }, 5_000);
  expect(outcome.ok).toBe(true);
  expect(outcome.result).toEqual({ status: "renewed" });
  expect(server.requestCount()).toBe(2);
});

test("fabricCall still surfaces non-capacity HTTP errors immediately", async () => {
  const server = startHttpStub({ status: () => 500 });
  const outcome = await fabricCall({ url: server.url }, "claim_next", {}, 5_000);
  expect(outcome.ok).toBe(false);
  expect(outcome.error).toBe("fabric_http_500");
  expect(server.requestCount()).toBe(1);
});

// Typed bounded backoff and a concurrency cap for provider capacity errors.
//
// Z.AI returns HTTP 429 and business-code 1302 ("High concurrency usage")
// when the shared coding plan saturates. During v26.9.21/22 these codes
// appeared in roughly 1474 xaas dispatch log lines: the worker turn died mid
// retry, the dispatch closed as a generic failure, and the queue head stayed
// blocked. This module gives the repo's own provider calls (the gall-work
// fabric client) a typed, bounded posture:
//
//   - capacity errors are CLASSIFIED (http_429 / provider_1302), never
//     string-matched at call sites;
//   - retries are BOUNDED (maxAttempts, exponential delay with cap and
//     jitter) and observable (onRetry);
//   - exhaustion is a TYPED refusal (ProviderCapacityRefusal), never a
//     re-dispatch as a prompt;
//   - local parallelism is CAPPED (ConcurrencyCap) so this process does not
//     contribute avoidable load.

export type CapacityCode = "http_429" | "provider_1302" | "retry_exhausted" | "concurrency_capped";

export class ProviderCapacityRefusal extends Error {
  readonly code: CapacityCode;
  readonly attempts: number;
  readonly lastCapacityCode?: CapacityCode;

  constructor(
    code: CapacityCode,
    message: string,
    options: { attempts?: number; lastCapacityCode?: CapacityCode } = {}
  ) {
    super(message);
    this.name = "ProviderCapacityRefusal";
    this.code = code;
    this.attempts = options.attempts ?? 0;
    this.lastCapacityCode = options.lastCapacityCode;
  }
}

export function isProviderCapacityRefusal(value: unknown): value is ProviderCapacityRefusal {
  return value instanceof ProviderCapacityRefusal;
}

export interface BackoffPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Ratio of uniform jitter added to each delay (0 to 1). */
  jitterRatio: number;
}

export const defaultBackoffPolicy: BackoffPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  jitterRatio: 0.2
};

export const defaultFabricConcurrencyLimit = 4;

/** Exponential backoff for the 1-based attempt that just failed. */
export function delayForAttempt(
  policy: BackoffPolicy,
  attempt: number,
  random: () => number = Math.random
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jitter = 1 + policy.jitterRatio * (2 * random() - 1);
  return Math.max(0, Math.round(exponential * jitter));
}

export interface CapacitySignal {
  code: CapacityCode;
  message?: string;
}

/** HTTP-status capacity signal (429 Too Many Requests). */
export function capacityFromStatus(status: number): CapacitySignal | false {
  if (status === 429) return { code: "http_429", message: `HTTP ${status}` };
  return false;
}

/**
 * Body-capacity signal for the xaas/Z.AI envelope shapes:
 *   {"error":{"code":1302},"message":"High concurrency usage"}
 *   {"result":{"isError":true,"content":[{"text":"{\"error\":\"...1302...\"}"}]}}
 * matched on typed fields first, message text only as a fallback.
 */
export function capacityFromBody(body: unknown): CapacitySignal | false {
  if (typeof body === "string") {
    // Tool-result content is a JSON-encoded envelope; parse it before the
    // text fallback so typed fields win over message matching.
    try {
      return capacityFromBody(JSON.parse(body) as unknown);
    } catch {
      return /1302|rate limit/iu.test(body) ? { code: "provider_1302", message: body.slice(0, 200) } : false;
    }
  }
  if (typeof body !== "object" || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === 1302 || code === "1302" || code === 429 || code === "429") {
      const message = (error as { message?: unknown }).message
        ?? (body as { message?: unknown }).message
        ?? code;
      return { code: "provider_1302", message: String(message) };
    }
  }
  if (typeof body === "object" && typeof (body as { code?: unknown }).code !== "undefined") {
    const code = (body as { code?: unknown }).code;
    if (code === 1302 || code === "1302" || code === 429 || code === "429") {
      return { code: "provider_1302", message: String((body as { message?: unknown }).message ?? code) };
    }
  }
  return false;
}

export interface CallWithCapacityBackoffOptions<T> {
  /** Return a CapacitySignal when the result represents provider saturation. */
  capacityOf: (result: T) => CapacitySignal | false;
  policy?: BackoffPolicy;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; code: CapacityCode; message?: string }) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `op` with typed bounded backoff over provider capacity errors. Each
 * failed attempt is retried with an exponential, capped, jittered delay until
 * `policy.maxAttempts` is reached; exhaustion throws a typed
 * ProviderCapacityRefusal. There is no prompt fallback: a refused call is a
 * refusal, never a lower-grade substitute.
 */
export async function callWithCapacityBackoff<T>(
  op: (attempt: number) => Promise<T>,
  options: CallWithCapacityBackoffOptions<T>
): Promise<T> {
  const policy = options.policy ?? defaultBackoffPolicy;
  const sleep = options.sleep ?? defaultSleep;
  let last: CapacitySignal | undefined;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const result = await op(attempt);
    const capacity = options.capacityOf(result);
    if (!capacity) return result;
    last = capacity;
    if (attempt === policy.maxAttempts) break;
    const delayMs = delayForAttempt(policy, attempt);
    options.onRetry?.({ attempt, delayMs, code: capacity.code, message: capacity.message });
    await sleep(delayMs);
  }
  throw new ProviderCapacityRefusal("retry_exhausted", `Provider capacity exhausted after ${policy.maxAttempts} attempts: ${last?.code ?? "unknown"}${last?.message ? ` (${last.message})` : ""}`, {
    attempts: policy.maxAttempts,
    lastCapacityCode: last?.code
  });
}

/**
 * FIFO concurrency cap over provider calls. Queued calls wait; nothing is
 * dropped, and the in-flight bound this process contributes never exceeds
 * `limit`.
 */
export class ConcurrencyCap {
  private inFlight = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`ConcurrencyCap limit must be a positive integer, got ${limit}.`);
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  async acquire(): Promise<() => void> {
    if (this.inFlight >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
      this.queue.shift()?.();
    };
  }

  async run<T>(op: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await op();
    } finally {
      release();
    }
  }
}

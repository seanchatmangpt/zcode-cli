import { createHmac } from "node:crypto";

export const DEFAULT_REDACT_ENV = [
  "API_KEY",
  "AUTHORIZATION",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY"
] as const;

export interface RedactComplianceOptions {
  /** Redact GDPR PII: emails, IPv4/IPv6, and /Users/<user>, /home/<user> path segments. Default: true. */
  redactPii?: boolean;
  /** Env var names (e.g. from [ocel].redact_env / [compliance].redact_env) whose values are scrubbed. Default: DEFAULT_REDACT_ENV. */
  redactEnv?: readonly string[];
  /** Process env map used to resolve redactEnv names. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Explicit raw secret values to scrub (e.g. caller-resolved envSecrets). */
  envSecrets?: readonly string[];
  /** Additional custom regex patterns whose matches are replaced with `replacement`. */
  extraPatterns?: readonly RegExp[];
  /** Replacement string. Default: "REDACTED". */
  replacement?: string;
}

// Credential-shaped object keys (case-insensitive).
// Avoids non-secret words like tokenizer, token_count, max_tokens, tokenBucket.
export const SECRET_KEY_RE =
  /^(?:(?:[a-z0-9_-]+[-_])?api[-_]?key|(?:access|refresh|auth|id|session|bearer|oauth|csrf|api)[-_]?token|refreshtoken|token|(?:[a-z0-9_-]+[-_])?secret|password|passwd|pwd|private[-_]?key|authorization|set[-_]?cookie|cookie)$/i;

const KEY_ALT =
  "(?:(?:[a-z0-9_-]+[-_])?api[-_]?key|(?:access|refresh|auth|id|session|bearer|oauth|csrf|api)[-_]?token|refreshtoken|token|(?:[a-z0-9_-]+[-_])?secret|password|passwd|pwd|private[-_]?key|authorization|set[-_]?cookie|cookie)";

// Separate quote-depth patterns prevent backslash-quote cross-matching and preserve "" empty values (`+` requires >=1 char).
const PLAIN_JSON_SECRET_RE = new RegExp(`((?<!\\\\)"${KEY_ALT}"\\s*:\\s*")((?:[^"\\\\]|\\\\.)+)(")`, "gi");
const ESC1_JSON_SECRET_RE = new RegExp(
  String.raw`(?<!\\)(\\"${KEY_ALT}\\"\s*:\s*\\")((?:[^"\\]|\\(?!"))+)(\\")`,
  "gi"
);
const ESC2_JSON_SECRET_RE = new RegExp(
  String.raw`(?<!\\)(\\\\\\"${KEY_ALT}\\\\\\"\s*:\s*\\\\\\")((?:[^"\\]|\\(?!(?:\\{0,2})"))+)(\\\\\\")`,
  "gi"
);

const PEM_PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;
const PEM_TRUNCATED_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*/g;
const PEM_HEADER_ONLY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{4,}\.e[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{4,}\b/g;

const AUTH_SCHEME_RE = /(authorization\s*[:=]\s*["']?(?:bearer|basic|token|digest|apikey)\s+)([^\s"'\\]+)(["']?)/gi;
const BEARER_RE =
  /(Bearer\s+)((?=[^\s"'\\]{8,})[^\s"'\\]+|(?=[^\s"'\\]*[0-9_.\-+/=])[^\s"'\\]{3,})/gi;
// Separate quote-variant patterns eliminate the non-regular backreference (\2) from AUTH_RAW.
const AUTH_RAW_DOUBLE_RE =
  /(authorization\s*[:=]\s*")(?!(?:basic|token|digest|bearer|apikey)\s)([^\s"'\\]+)(")/gi;
const AUTH_RAW_SINGLE_RE =
  /(authorization\s*[:=]\s*')(?!(?:basic|token|digest|bearer|apikey)\s)([^\s"'\\]+)(')/gi;
const AUTH_RAW_BARE_RE =
  /(authorization\s*[:=]\s*)(?!["'])(?!(?:basic|token|digest|bearer|apikey)\s)([^\s"'\\]+)/gi;
const URL_SECRET_PARAM_RE = new RegExp(`([?&#](?:${KEY_ALT})=)([^&#\\s"']+)`, "gi");
// RFC 3986 scheme://[user]:pass@host (covers non-HTTP schemes and empty-user URLs)
const URL_USERINFO_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#\s@"']*:)([^@/?#\s"']+)(@)/g;
// RFC 3986 scheme://token@host (colon-less token-as-userinfo URLs)
const URL_USERINFO_TOKEN_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:/?#\s@"']+)(@)/g;
// TOML assignments (capability-snapshot parity): quoted `"..."` / `'...'` and bare
// unquoted `key = value` / `key=value` (no quotes). Omit bare `authorization` so
// header-shaped `authorization="Bearer …"` stays on AUTH_* (not whole-value wipe).
const TOML_KEY_ALT =
  "(?:(?:[a-z0-9_-]+[-_])?api[-_]?key|(?:access|refresh|auth|id|session|bearer|oauth|csrf|api)[-_]?token|refreshtoken|token|(?:[a-z0-9_-]+[-_])?secret|password|passwd|pwd|private[-_]?key|set[-_]?cookie|cookie)";
const TOML_DOUBLE_SECRET_RE = new RegExp(
  `^(\\s*(?:${TOML_KEY_ALT})\\s*=\\s*")(?!REDACTED")((?:[^"\\\\]|\\\\.)+)(")`,
  "gim"
);
const TOML_SINGLE_SECRET_RE = new RegExp(
  `^(\\s*(?:${TOML_KEY_ALT})\\s*=\\s*')(?!REDACTED')([^'\\r\\n]+)(')`,
  "gim"
);
const TOML_BARE_SECRET_RE = new RegExp(
  `^(\\s*(?:${TOML_KEY_ALT})\\s*=\\s*)(?!["'\\s#])(?!REDACTED(?:\\s|$|#))([^\\s#\\r\\n]+)`,
  "gim"
);

// GDPR PII patterns
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IPV4_RE = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.])/g;
// Covers 8-group IPv6, IPv4-mapped IPv6, ::1-style loopback, and compressed :: with >=3 colons or at least one digit (avoids owl::Thing / dead::beef / 19:15:56).
const IPV6_RE =
  /(?<![\w:])(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}:)*\d+\.\d+\.\d+\.\d+|::(?:ffff(?::0{1,4})?:)?\d+\.\d+\.\d+\.\d+|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){2,6}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?|(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}:)+[0-9a-fA-F]{1,4}|(?=[0-9a-fA-F:]*\d)[0-9a-fA-F]{1,4}::[0-9a-fA-F]{1,4})(?![\w:])/g;
const HOME_USER_PATH_RE = /(\/(?:Users|home)\/)([^\/\s"'\\,;)\]}]+)/g;

function isAlreadyRedacted(value: string, replacement: string): boolean {
  return value === replacement || value === "REDACTED";
}

function isRedactedHomeUserPath(text: string, offset: number, preLen: number, replacement: string): boolean {
  const afterPre = text.slice(offset + preLen);
  for (const token of new Set([replacement, "REDACTED"])) {
    if (token.length > 0 && afterPre.startsWith(token)) {
      if (afterPre.length === token.length || /[\/\s"'\\,;)\]}]/.test(afterPre[token.length]!)) {
        return true;
      }
    }
  }
  return false;
}

function isRedactedUrlUserinfoEmail(text: string, match: string, offset: number, replacement: string): boolean {
  const atRel = match.indexOf("@");
  if (atRel < 0) return false;
  const atPos = offset + atRel;
  for (const token of new Set([replacement, "REDACTED"])) {
    if (token.length > 0 && atPos >= token.length && text.slice(atPos - token.length, atPos) === token) {
      const beforeToken = text.slice(0, atPos - token.length);
      if (/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^/?#\s@"']*:)?$/i.test(beforeToken)) {
        return true;
      }
    }
  }
  return false;
}

interface CompiledContext {
  redactPii: boolean;
  replacement: string;
  redactEnvSet: Set<string>;
  envSecrets: string[];
  extraPatterns: RegExp[];
}

function buildContext(options: RedactComplianceOptions = {}): CompiledContext {
  const replacement = options.replacement ?? "REDACTED";
  const redactPii = options.redactPii ?? true;
  const usingExplicitEnv = options.redactEnv !== undefined;
  const redactEnvNames = options.redactEnv ?? DEFAULT_REDACT_ENV;
  const envMap = options.env ?? process.env;
  const minEnvLen = usingExplicitEnv ? 4 : 6;

  const secretSet = new Set<string>();
  const redactEnvSet = new Set<string>();
  for (const name of redactEnvNames) {
    const trimmedName = name.trim();
    if (!trimmedName) continue;
    redactEnvSet.add(trimmedName.toLowerCase());
    const val = envMap[trimmedName];
    if (typeof val === "string" && val.length >= minEnvLen && val !== replacement && val !== "REDACTED") {
      secretSet.add(val);
    }
  }
  for (const raw of options.envSecrets ?? []) {
    if (typeof raw === "string" && raw.length >= 4 && raw !== replacement && raw !== "REDACTED") {
      secretSet.add(raw);
    }
  }

  // Sort longest-first so compound secrets are scrubbed before substrings
  const envSecrets = [...secretSet].sort((a, b) => b.length - a.length);
  const extraPatterns = (options.extraPatterns ?? []).map(
    (re) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)
  );

  return { redactPii, replacement, redactEnvSet, envSecrets, extraPatterns };
}

function replaceQuotedSecrets(text: string, replacement: string): string {
  const replacer = (full: string, pre: string, val: string, post: string): string =>
    val === replacement || val === "REDACTED" ? full : `${pre}${replacement}${post}`;
  return text
    .replace(PLAIN_JSON_SECRET_RE, replacer)
    .replace(ESC1_JSON_SECRET_RE, replacer)
    .replace(ESC2_JSON_SECRET_RE, replacer);
}

/** Auth-scheme-prefixed values belong to AUTH_SCHEME/BEARER, not TOML key=value scrub. */
function isAuthSchemePrefixedValue(val: string): boolean {
  return /^(?:bearer|basic|token|digest|apikey)\s+/i.test(val);
}

function replaceTomlSecrets(text: string, replacement: string): string {
  const quoted = (full: string, pre: string, val: string, post: string): string => {
    if (isAlreadyRedacted(val, replacement) || isAuthSchemePrefixedValue(val)) return full;
    return `${pre}${replacement}${post}`;
  };
  const bare = (full: string, pre: string, val: string): string => {
    if (isAlreadyRedacted(val, replacement) || isAuthSchemePrefixedValue(val)) return full;
    return `${pre}${replacement}`;
  };
  return text
    .replace(TOML_DOUBLE_SECRET_RE, quoted)
    .replace(TOML_SINGLE_SECRET_RE, quoted)
    .replace(TOML_BARE_SECRET_RE, bare);
}

function redactSchemesAndTokens(text: string, ctx: CompiledContext): string {
  const r = ctx.replacement;
  let out = text
    .replace(PEM_PRIVATE_KEY_RE, r)
    .replace(PEM_TRUNCATED_RE, r)
    .replace(JWT_RE, r)
    .replace(URL_SECRET_PARAM_RE, (full, pre: string, val: string) =>
      isAlreadyRedacted(val, r) ? full : `${pre}${r}`
    )
    .replace(URL_USERINFO_RE, (full, pre: string, pw: string, at: string) =>
      isAlreadyRedacted(pw, r) ? full : `${pre}${r}${at}`
    )
    .replace(URL_USERINFO_TOKEN_RE, (full, pre: string, tok: string, at: string) =>
      isAlreadyRedacted(tok, r) ? full : `${pre}${r}${at}`
    )
    .replace(AUTH_SCHEME_RE, (full, pre: string, val: string, post: string) =>
      isAlreadyRedacted(val, r) ? full : `${pre}${r}${post}`
    )
    .replace(BEARER_RE, (full, pre: string, val: string) => (isAlreadyRedacted(val, r) ? full : `${pre}${r}`))
    .replace(AUTH_RAW_DOUBLE_RE, (full, pre: string, val: string, post: string) =>
      isAlreadyRedacted(val, r) ? full : `${pre}${r}${post}`
    )
    .replace(AUTH_RAW_SINGLE_RE, (full, pre: string, val: string, post: string) =>
      isAlreadyRedacted(val, r) ? full : `${pre}${r}${post}`
    )
    .replace(AUTH_RAW_BARE_RE, (full, pre: string, val: string) =>
      isAlreadyRedacted(val, r) ? full : `${pre}${r}`
    );
  // TOML after auth-scheme scrub; skip scheme-prefixed values so
  // `authorization="Bearer REDACTED"` is not collapsed to `authorization="REDACTED"`.
  out = replaceTomlSecrets(out, r);

  for (const secret of ctx.envSecrets) {
    if (out.includes(secret)) out = out.replaceAll(secret, r);
  }
  for (const re of ctx.extraPatterns) {
    re.lastIndex = 0;
    out = out.replace(re, r);
  }
  if (ctx.redactPii) {
    out = out
      .replace(EMAIL_RE, (match, offset: number, whole: string) =>
        isRedactedUrlUserinfoEmail(whole, match, offset, r) ? match : r
      )
      .replace(IPV6_RE, r)
      .replace(IPV4_RE, r)
      .replace(HOME_USER_PATH_RE, (full, pre: string, user: string, offset: number, whole: string) =>
        isAlreadyRedacted(user, r) || isRedactedHomeUserPath(whole, offset, pre.length, r) ? full : `${pre}${r}`
      );
  }
  return out;
}

function redactStringValue(text: string, ctx: CompiledContext, seen: WeakSet<object>, depth: number): string {
  if (text.length === 0) return text;
  let out = text;
  if (/[{[]/.test(text) && depth < 64) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        const redacted = redactNode(parsed, ctx, seen, depth + 1);
        const before = JSON.stringify(parsed);
        const after = JSON.stringify(redacted);
        if (after !== before) out = after;
      } else if (typeof parsed === "string" && /[{[]/.test(parsed)) {
        const redacted = redactStringValue(parsed, ctx, seen, depth + 1);
        if (redacted !== parsed) out = JSON.stringify(redacted);
      }
    } catch {
      // Not whole-string JSON; fall through to shape-level redaction
    }
  }
  out = replaceQuotedSecrets(out, ctx.replacement);
  out = replaceTomlSecrets(out, ctx.replacement);
  return redactSchemesAndTokens(out, ctx);
}

function isSensitiveKey(key: string, ctx: CompiledContext): boolean {
  return SECRET_KEY_RE.test(key) || ctx.redactEnvSet.has(key.toLowerCase());
}

function redactSensitiveValue(value: unknown, ctx: CompiledContext, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 0 ? ctx.replacement : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return ctx.replacement;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    if (depth >= 128) return "[REDACTED_MAX_DEPTH]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
      return value.map((item) => redactSensitiveValue(item, ctx, seen, depth + 1));
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === "object") {
    if (value instanceof Date || value instanceof RegExp) return ctx.replacement;
    if (depth >= 128) return "[REDACTED_MAX_DEPTH]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          redactSensitiveValue(v, ctx, seen, depth + 1)
        ])
      );
    } finally {
      seen.delete(value);
    }
  }
  return redactNode(value, ctx, seen, depth);
}

function redactNode(value: unknown, ctx: CompiledContext, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactStringValue(value, ctx, seen, depth);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (value instanceof RegExp) return value;
  if (depth >= 128) return "[REDACTED_MAX_DEPTH]";
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactNode(item, ctx, seen, depth + 1));
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactStringValue(value.message, ctx, seen, depth + 1),
        ...(value.stack ? { stack: redactStringValue(value.stack, ctx, seen, depth + 1) } : {})
      };
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        isSensitiveKey(key, ctx)
          ? redactSensitiveValue(child, ctx, seen, depth + 1)
          : redactNode(child, ctx, seen, depth + 1)
      ])
    );
  } finally {
    seen.delete(value);
  }
}

export interface ComplianceRedactor {
  redactData<T = unknown>(value: T): T;
  redactText(text: string): string;
  containsUnredacted(text: string): boolean;
}

export function createComplianceRedactor(options?: RedactComplianceOptions): ComplianceRedactor {
  const ctx = buildContext(options);
  return {
    redactData: <T = unknown>(value: T): T => redactNode(value, ctx, new WeakSet<object>(), 0) as T,
    redactText: (text: string): string => redactStringValue(text, ctx, new WeakSet<object>(), 0),
    containsUnredacted: (text: string): boolean => {
      if (typeof text !== "string" || text.length === 0) return false;
      return containsInNode(text, ctx, new WeakSet<object>(), 0);
    }
  };
}

export function redactComplianceData<T = unknown>(value: T, options?: RedactComplianceOptions): T {
  const ctx = buildContext(options);
  return redactNode(value, ctx, new WeakSet<object>(), 0) as T;
}

export function redactComplianceText(text: string, options?: RedactComplianceOptions): string {
  const ctx = buildContext(options);
  return redactStringValue(text, ctx, new WeakSet<object>(), 0);
}

/**
 * Deterministic salted HMAC-SHA256 actor pseudonymization (Art. 10 / RPM Confidentiality).
 * Fails closed if salt is empty so unsalted dictionary-reversible pseudonyms cannot be produced.
 */
export function pseudonymizeActor(id: string, salt: string): string {
  if (typeof salt !== "string" || salt.length === 0) {
    throw new Error("REDACTION_FAILURE: pseudonymizeActor requires a non-empty salt");
  }
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("REDACTION_FAILURE: pseudonymizeActor requires a non-empty actor id");
  }
  return createHmac("sha256", salt).update(id, "utf8").digest("hex");
}

const QUOTED_SECRET_RES = [PLAIN_JSON_SECRET_RE, ESC1_JSON_SECRET_RE, ESC2_JSON_SECRET_RE] as const;

function testQuotedSecrets(text: string, replacement: string): boolean {
  for (const re of QUOTED_SECRET_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const val = m[2];
      if (val && !isAlreadyRedacted(val, replacement)) return true;
    }
  }
  return false;
}

function hasUnredactedGroup(text: string, re: RegExp, groupIdx: number, replacement: string): boolean {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const val = m[groupIdx];
    if (val !== undefined && !isAlreadyRedacted(val, replacement)) return true;
  }
  return false;
}

function testStringRaw(text: string, ctx: CompiledContext): boolean {
  if (!text) return false;
  if (testQuotedSecrets(text, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, TOML_DOUBLE_SECRET_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, TOML_SINGLE_SECRET_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, TOML_BARE_SECRET_RE, 2, ctx.replacement)) return true;
  if (PEM_HEADER_ONLY_RE.test(text)) return true;
  JWT_RE.lastIndex = 0;
  if (JWT_RE.test(text)) return true;
  if (hasUnredactedGroup(text, URL_SECRET_PARAM_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, URL_USERINFO_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, URL_USERINFO_TOKEN_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, AUTH_SCHEME_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, BEARER_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, AUTH_RAW_DOUBLE_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, AUTH_RAW_SINGLE_RE, 2, ctx.replacement)) return true;
  if (hasUnredactedGroup(text, AUTH_RAW_BARE_RE, 2, ctx.replacement)) return true;
  for (const secret of ctx.envSecrets) {
    if (text.includes(secret)) return true;
  }
  for (const re of ctx.extraPatterns) {
    re.lastIndex = 0;
    if (re.test(text)) return true;
  }
  if (ctx.redactPii) {
    EMAIL_RE.lastIndex = 0;
    let em: RegExpExecArray | null;
    while ((em = EMAIL_RE.exec(text)) !== null) {
      if (!isRedactedUrlUserinfoEmail(text, em[0], em.index, ctx.replacement)) return true;
    }
    for (const re of [IPV4_RE, IPV6_RE]) {
      re.lastIndex = 0;
      if (re.test(text)) return true;
    }
    HOME_USER_PATH_RE.lastIndex = 0;
    let hm: RegExpExecArray | null;
    while ((hm = HOME_USER_PATH_RE.exec(text)) !== null) {
      const pre = hm[1] ?? "";
      const user = hm[2] ?? "";
      if (!isAlreadyRedacted(user, ctx.replacement) && !isRedactedHomeUserPath(text, hm.index, pre.length, ctx.replacement)) {
        return true;
      }
    }
  }
  return false;
}

function containsUnredactedSensitiveValue(
  value: unknown,
  ctx: CompiledContext,
  seen: WeakSet<object>,
  depth: number
): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    return value.length > 0 && !isAlreadyRedacted(value, ctx.replacement);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return true;
  }
  if (Array.isArray(value)) {
    if (value.length === 0 || depth >= 128 || seen.has(value)) return false;
    seen.add(value);
    try {
      return value.some((item) => containsUnredactedSensitiveValue(item, ctx, seen, depth + 1));
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === "object") {
    if (depth >= 128 || seen.has(value)) return false;
    seen.add(value);
    try {
      return Object.values(value as Record<string, unknown>).some((v) =>
        containsUnredactedSensitiveValue(v, ctx, seen, depth + 1)
      );
    } finally {
      seen.delete(value);
    }
  }
  return containsInNode(value, ctx, seen, depth);
}

function containsInNode(value: unknown, ctx: CompiledContext, seen: WeakSet<object>, depth: number): boolean {
  if (typeof value === "string") {
    if (/[{[]/.test(value) && depth < 64) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (
          ((parsed !== null && typeof parsed === "object") ||
            (typeof parsed === "string" && /[{[]/.test(parsed))) &&
          containsInNode(parsed, ctx, seen, depth + 1)
        ) {
          return true;
        }
      } catch {
        // fall through
      }
    }
    return testStringRaw(value, ctx);
  }
  if (value === null || typeof value !== "object" || depth >= 128 || seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.some((v) => containsInNode(v, ctx, seen, depth + 1));
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k, ctx)) {
        if (containsUnredactedSensitiveValue(v, ctx, seen, depth + 1)) return true;
      } else if (containsInNode(v, ctx, seen, depth + 1)) {
        return true;
      }
    }
    return false;
  } finally {
    seen.delete(value);
  }
}

export function containsUnredactedSecretsOrPii(
  text: string,
  options?: Pick<RedactComplianceOptions, "redactPii" | "redactEnv" | "env" | "envSecrets" | "extraPatterns" | "replacement">
): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const ctx = buildContext(options);
  return containsInNode(text, ctx, new WeakSet<object>(), 0);
}

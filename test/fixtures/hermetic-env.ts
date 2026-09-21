import { homedir, tmpdir } from "node:os";

/**
 * A temp root that has no ancestor under the real home directory. Credential
 * preflight walks ancestor directories for `.env`/`zcode.json`, so a temp dir
 * below `$HOME` (for example when TMPDIR points into `~/.cache`) inherits the
 * developer's real overrides and changes the outcome of offline tests.
 */
export function hermeticTempRoot(): string {
  const base = tmpdir();
  return process.platform !== "win32" && base.startsWith(homedir()) ? "/tmp" : base;
}

const credentialKey = /^(?:ZCODE|ZAI|BIGMODEL|ZHIPU|ANTHROPIC)_.*(?:KEY|TOKEN|MODEL|CONFIG|PROVIDER|BASE_URL)/u;

/**
 * Overrides that blank every ambient model credential/override present in `env`, for
 * merging over `{ ...process.env }` so a developer's real keys cannot leak into a child.
 */
export function blankedAmbientCredentials(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.keys(env).filter((key) => credentialKey.test(key)).map((key) => [key, ""]));
}

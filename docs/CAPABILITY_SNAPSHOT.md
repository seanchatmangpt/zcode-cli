# Capability snapshot/restore (`scripts/capability-snapshot.sh`)

A ZCode install carries capabilities that an app update must not delete: user
state under `~/.zcode` (config incl. plugin tokens, installed plugins +
marketplace registrations + cache, memories, agents, model-catalog, the user
`AGENTS.md`, workspace state), the deployed app runtime
(`ZCode.app/Contents/Resources/glm`) that local patches were baked into, and
unpushed commits / untracked files in this repo. The snapshot tool preserves
and restores exactly those (landed 2026-09-19, `1aceb47`).

## Usage

```bash
scripts/capability-snapshot.sh save
scripts/capability-snapshot.sh verify  <dir>
scripts/capability-snapshot.sh diff    <dir>
scripts/capability-snapshot.sh restore <dir> [--apply]
```

Snapshots are written to `$ZCODE_BACKUP_ROOT/caps-<ts>/` (default
`~/.zcode-backups`) with a sha256 manifest; `verify` re-hashes a snapshot
against its manifest; `diff` compares live state against a snapshot manifest
(exit nonzero on any MISSING entry or any CHANGED entry outside the app's
`glm/` runtime — `glm/` changes are expected across updates); `restore`
prints, or with `--apply` performs, the restore.

Environment overrides: `ZCODE_BACKUP_ROOT` (default `~/.zcode-backups`),
`ZCODE_REPO` (default `~/dev/zcode-cli`), `ZCODE_APP` (default
`~/Applications/ZCode.app`).

Excluded by design (state, not capability; too large to snapshot):
`~/.zcode/cli/{db,exec,log,rollout,tmp}`, `~/.zcode/v2`,
`~/.zcode/computer-use`.

## Secret redaction contract (fail-closed)

Snapshots must never carry credential values:

- `save` stages user state via APFS clonefile, then replaces **any non-empty**
  credential-shaped value (no `>= 8`-character floor; empty `""` preserved)
  with `REDACTED` in text files under 2 MB
  (`json`/`jsonl`/`jsonc`/`md`/`txt`/`toml`/`yaml`/`yml`).
- Covered credential shapes align with `src/ocel-tap.ts` and
  `src/compliance/redactor.ts` (secret-only mode):
  - Case-insensitive credential keys (`apiKey`, `api_key`, `*_api_key`,
    `token`, `refresh_token`, `access_token`, `refreshtoken`, `authToken`,
    `secret`, `*_secret`, `password`, `passwd`, `private_key`,
    `authorization`, `cookie`/`set-cookie`) in plain JSON, 1- and 2-level
    escaped JSON (`\"key\":\"val\"`, `\\\"key\\\":\\\"val\\\"`), and TOML
    `"..."` / `'...'` assignments.
  - Compact JWTs (`eyJ...`), multi-line and single-line PEM private key blocks
    (`-----BEGIN ... PRIVATE KEY----- ... -----END ... PRIVATE KEY-----`),
    `Bearer` tokens, and `Authorization` header schemes (`Basic`, `Token`,
    `Digest`, `ApiKey`, and raw keys), while preserving ordinary prose such as
    `"the token bucket refills"`.
- A fail-closed scan (`assert_no_secrets`) then walks ALL file sizes
  (including `>= 2 MB`) for all credential shapes above (excluding bare generic
  `"token"` in `assert_no_secrets` to avoid false positives on large
  tokenizer/grammar bundles); if any credential-shaped value survives outside
  the redaction window, `save` is killed with `refusing to snapshot:
  credential-shaped values remain in staging` and no snapshot husk is left
  behind.
- Intentional boundary with `src/compliance/redactor.ts`:
  `capability-snapshot.sh` preserves OS home paths (`/Users/<user>`) and user
  config emails because snapshots restore local user capability trees, whereas
  `src/compliance/redactor.ts` (`redactPii: true`) additionally scrubs GDPR
  PII (emails, IPv4/IPv6, `/Users/<user>`, `/home/<user>`) and
  `[ocel].redact_env` / `[compliance].redact_env` values for EU AI Act Art. 10
  and Responsible Process Mining (RPM) telemetry.
- Consequence for `restore`: restored snapshots have `REDACTED` credential
  fields. Re-enter credentials from the live registry / failover copy (both
  excluded from snapshots) after a restore.

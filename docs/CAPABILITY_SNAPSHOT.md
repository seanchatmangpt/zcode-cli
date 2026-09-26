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

- `save` stages user state via APFS clonefile, then replaces
  credential-shaped values (`apiKey`, `api_key`, `token`, `secret`,
  `password`) with `REDACTED` in text files under 2 MB (json/jsonl/jsonc/md/
  txt/toml/yaml/yml).
- A fail-closed scan (`assert_no_secrets`) then walks ALL file sizes; if any
  credential-shaped value survives outside the redaction window, the save is
  killed with `refusing to snapshot: credential-shaped values remain in
  staging` — no snapshot is written.
- Redaction and the fail-closed scan only see values of ≥8 characters;
  shorter credential values are neither redacted nor flagged.
- The shell redactor matches the exact keys `apiKey`, `api_key`, `token`,
  `secret`, `password` only — compound keys (`authToken`, `refresh_token`,
  `accessToken`) and `authorization` are NOT covered on the shell side.
- `assert_no_secrets` deliberately excludes `token` (too generic), so a long
  `token` value survives unscanned.
- The OCEL ingest redactor (`src/ocel-tap.ts`) redacts ANY non-empty
  credential-shaped value regardless of length — there is no ≥8-character
  floor, so 1–7 character secrets are REDACTED too. Its token key set is
  case-insensitive and includes `refresh_token` and `access_token` (alongside
  the legacy `refreshtoken` spelling); secrets escaped or JSON-embedded
  inside string payloads are redacted; and `Authorization` coverage extends
  beyond `Bearer` to `Basic`/`Token`/digest credentials and raw keys behind
  an explicit `Authorization` header context (`Bearer` stays redacted
  anywhere; ordinary prose like "the token bucket refills" survives).
- The asymmetry is therefore deliberate: the OCEL side (event chain, hashes
  commit to the log) is the stricter contract; the shell side (snapshot
  tarballs, restored by hand) is the looser one — a short or compound-keyed
  credential that OCEL ingest redacts can pass through a snapshot, and the
  fail-closed scan will not flag it.
- Consequence for `restore`: restored snapshots have `REDACTED` credential
  fields. Re-enter credentials from the live registry / failover copy (both
  excluded from snapshots) after a restore.

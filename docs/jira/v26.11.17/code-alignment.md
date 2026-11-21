# code-alignment — zcode-cli v26.11.17

Standing: PASS

## Identity
- Path: `/Users/sac/zcode-cli`
- Branch at generation: main
- HEAD: 05b8417a1c717f23fea538e4d998f957af05d4d2
- Tracked files: 858
- Tracked docs markdown: 321

## Build manifests (tracked at the commit above)
- `package.json`
- `AGENTS.md`
- `README.md`

## Top-level layout (tracked file counts)
- `.`: 14
- `.github`: 6
- `.sa2a`: 1
- `.sjira`: 1
- `LICENSES`: 4
- `bin`: 1
- `docs`: 352
- `ontology`: 2
- `packages`: 79
- `receipts`: 30
- `scripts`: 43
- `src`: 92
- `test`: 233

## Prior doc waves
- `docs/jira/v26.9.18`
- `docs/jira/v26.9.27`
- `docs/jira/v26.11.16`

## Falsifiers
- Any tracked path above absent at HEAD, or a count differing from `git ls-files`.
- HEAD sha not equal to or an ancestor of the live HEAD.

## Acceptance
```bash
python3 ~/zcode-cli/scripts/docs_v261117.py validate /Users/sac/zcode-cli
```
Expected: exit 0 and `PASS`.

## See Also
- `~/zcode-cli/scripts/docs_v261117.py`

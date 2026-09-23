# G1 classification ledger — everything discovered in the last 48h

Law: a discovered dependency either (a) is required by the accepted Friday
prose → close now under its gate, or (b) is not → typed successor below.
Nothing here reopens the Friday checkpoint. This file is the G1 evidence;
each row's status is court-checked before the STOP report.

## Closed now (already landed under the 10-lane remediation, receipt-cited)

| item | evidence | standing |
|---|---|---|
| gall-work lease lifecycle landed on zcode-cli main | `a564ca8`, `receipts/v26.9.22/zocel-009.json`, sha256-identical contract vs xaas | PARTIAL_ALIVE (subset; superset merge = successor row below) |
| MCP dedupe (single xaas-fabric plugin authority, hooks enabled, empty arrays) | `~/.zcode/cli/setting.json`, `config.json` — zero duplicate xaas-execution blocks | ALIVE (config observation) |
| C4 router doc refreshed (router.ex:95, 7 verbs, hooks transport, receipts routes) | zcode-cli `57be34d`, `docs/c4-zcode-cli-xaas.md` | ALIVE (doc diff) |
| zcode-cli AGENTS.md at repo root | present, documents gall-work | ALIVE (presence; completeness is excluded by G2) |
| Receipts tooling (validate-receipts.ts + package.json `receipts:validate`) | zcode-cli `scripts/validate-receipts.ts` | ALIVE (script executes) |
| xaas orientation (README pin + AGENTS.md zcode-integration section) | xaas `e358cb8` | ALIVE (doc diff) |
| Skills unstranded (7 curated skills in `~/.zcode/skills/`) | both skill dirs populated | ALIVE (symlink/copy check) |
| zcode-cli v26.9.22 tickets (ZOCEL-014/015/016 + work-orders.ttl + _RUNBOOK) | `docs/sjira/v26.9.22/` | ALIVE (SHACL admission, G4 court) |
| xaas v26.9.22 tickets (SJ-010/011 + index.json + calver-pin correction record) | `docs/sjira/v26.9.22/` | ALIVE (index) |
| Plugin token hygiene (`zcode_xaas_token` sensitive: true, template+rendered consistent) | xaas `priv/zcode_plugin/` both files | ALIVE (file inspection) |

## Close-now under a Friday gate (Phase B/C work)

| item | gate | plan |
|---|---|---|
| No-LLM gall-work episode + receipt + OCEL | G6, G7 | claim→heartbeat→close vs live fabric; BLOCKED is a typed outcome |
| Frontier before/after diff | G8 | 050_frontier.rq around the G6 close |
| Cold-start court script | G2 | `scripts/cold-start-court.ts` + bootstrap receipt |
| SA2A tuple-conservation court | G5 | bridge shapes + mutation refusal |
| Two-episode ratchet evidence | G9 | bounded two-episode receipts (weights → successor) |
| WD proposal | G12 | `wd-proposal/WD-GALL-FRI-0925.md`, claims typed |
| Per-repo checkpoint matrix | G11 | `checkpoint-matrix.md` |
| Court graph + gate + ledger (this cycle's artifacts) | G0–G5, G10 | this directory |

## Successors (typed; do NOT keep Friday open)

| item | type | note |
|---|---|---|
| Full w9-sweep/zcode-pr3 superset merge of gall-work | successor (BLOCKED on human review) | reviewed-by pending on `/Users/sac/wt/zocel-runs/gall-resolutions.md` |
| SJ-002/ZOCEL-014 ocel-registry-bridge implementation | successor order | ticketed; explicitly out of Friday scope |
| ZOCEL-015 execution-mcp audit coverage | successor order | ticketed |
| ZOCEL-016 ocel-verify CI wiring | successor order | ticketed |
| C02: OCEL-mined planner weights replacing `sa2a_loop.exs:15-21` literal table | successor order | named in G9 exclusions |
| C21: out-of-subject receipts (git notes/OCI referrers) | successor | composition-catalog C21 |
| C08: edge standing courts | successor | composition-catalog C08 |
| C16/C20: sensor-parity courts, generator-plurality court | successor | composition-catalog |
| Ultracode-takeover interrupted-run takeover | successor (UNKNOWN standing) | not required by the accepted Friday prose |
| ZOE Marketplace / Freedom / Planning Center ambitions | successor | Wednesday ZOE lane is a parallel session with its own checkpoint |
| ash_surface F7 (finish list item) | successor | ash_surface v26.9.17 F1-F6+F8 merged |
| Worktree/branch debris (28 zcode-cli worktrees, wo2/ultracode/preserve branches, /tmp w6-w9) | successor (housekeeping) | no-force-push law respected |
| ggen-marketplace untracked `docs/jira/v26.9.19/`, `docs/rfc/`, `.ggen_igniter/` | successor | classify/commit in marketplace's own cycle |
| ash_a2a untracked `research/erc/ERC-00*.json` | successor | probe evidence files; commit in ash_a2a's own cycle |
| `bun run test:runtime` exit 1 on pristine zcode-cli HEAD | successor repair lane | pre-existing at e0a7791 (vendor re-extraction), not introduced; zocel-009.json records it |
| ash_kudzu Actions billing failure | successor | w9-sweep ledger warning; check other repos' Actions |
| SJ-010/SJ-011/ZOCEL-014..016 EXECUTION | successor orders | G4 requires them specified+admitted, not executed |

## Operator acts (out of scope for every agent)

Push/PR; rebase onto 3.14.1-27; token rotation against the live beam; plugin
reinstall; the superset-merge reviewed-by decision; kill switches on standing
automations.

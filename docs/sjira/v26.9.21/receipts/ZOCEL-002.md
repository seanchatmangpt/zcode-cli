# ZOCEL-002 receipt: ts/py pending/outcome parity

Branch fin/consumer-hardening, worktree /Users/sac/wt/z-consumer-hardening. Base main 046feeb.

- SHARED_VECTOR: ALIVE. test/fixtures/ocel-golden-chain.json (10 vectors: 4 success, 6 refusal) is read by
  test/ocel-generated.test.ts and test/py/test_golden_chain.py (grep -l lists both). The
  /Users/sac/wt/zocel-runs/py/*.py path in the acceptance text does not exist; readers live in test/py.
- TS_PARITY: ALIVE. `bun test test/ocel-*.test.ts` 65 pass 0 fail; each vector's digests, verify, unpaired and
  error asserted equal to the fixture literal.
- PY_PARITY: ALIVE. `python3 -m pytest -q test/py` 2 passed; same literals compared, so TS and Py digest lists
  are equal transitively through the shared fixture.
- Fixture literals were generated once from the TS module; Py independently reproduced them (not circular for py).
- Falsifiers: no divergent digest observed; no per-language vector copies.
- Mock grep over test/py, test/ocel-*.test.ts, test/support: 0 matches.
- Standing: PARTIAL_ALIVE (no independent court receipt; ZOCEL-001 standing not inherited).

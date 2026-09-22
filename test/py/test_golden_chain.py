"""Python side of the shared golden chain vectors (test/fixtures/ocel-golden-chain.json).
Real generated module, real file; the TS reader is test/ocel-generated.test.ts."""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "generated" / "py"))
import receipt  # noqa: E402

GOLDEN = json.loads((ROOT / "test" / "fixtures" / "ocel-golden-chain.json").read_text())


def run(ops):
    chain, digests, error = [], [], None
    try:
        for o in ops:
            if o[0] == "pending":
                e = receipt.append_pending(chain, o[1], o[2], o[3])
            elif o[0] == "outcome":
                e = receipt.append_outcome(chain, o[1], o[2], o[3], o[4])
            else:
                e = receipt.seal(chain, o[1], o[2], o[3])
            digests.append(e["hash"])
    except ValueError as x:
        error = str(x)
    return {"digests": digests, "verify": receipt.verify(chain), "unpaired": receipt.unpaired(chain), "error": error}


def test_vectors_present():
    assert len(GOLDEN["vectors"]) >= 10


def test_every_vector_matches_ts_digests():
    for v in GOLDEN["vectors"]:
        assert run(v["ops"]) == v["expected"], v["id"]

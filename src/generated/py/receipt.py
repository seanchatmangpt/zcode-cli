"""Generated hash-chained receipt: append / verify / seal. Policy from es:ChainPolicy."""
import hashlib

ALGORITHM = "sha256"
GENESIS = "0000000000000000000000000000000000000000000000000000000000000000"
FIELDS = ("entry_id", "parent_hash", "phase", "standing", "subject", "action", )
PHASES = ("pending", "outcome", )
STANDINGS = ("alive", "blocked", "build_broken", "partial_alive", "unknown", "unsupported", )
_PENDING, _OUTCOME = PHASES[0], PHASES[-1]


def digest(text: str) -> str:
    data = text.encode("utf-8")
    if ALGORITHM in ("sha256", "sha512"):
        return getattr(hashlib, ALGORITHM)(data).hexdigest()
    if ALGORITHM == "blake2b256":
        return hashlib.blake2b(data, digest_size=32).hexdigest()
    raise ValueError("unsupported algorithm " + ALGORITHM)


def canonical(e: dict) -> str:
    for f in FIELDS:
        if "\n" in str(e[f]):
            raise ValueError("LF in field " + f)
    return "\n".join(f + "=" + str(e[f]) for f in FIELDS)


def _make(chain, entry_id, phase, standing, subject, action):
    if phase not in PHASES or standing not in STANDINGS:
        raise ValueError("bad phase/standing")
    e = {"entry_id": entry_id, "parent_hash": chain[-1]["hash"] if chain else GENESIS,
         "phase": phase, "standing": standing, "subject": subject, "action": action}
    e["hash"] = digest(canonical(e))
    return e


def is_sealed(chain) -> bool:
    return any(e.get("seal") for e in chain)


def append(chain, entry_id, phase, standing, subject, action):
    if is_sealed(chain):
        raise ValueError("chain sealed")
    if phase == _OUTCOME and not any(e["phase"] == _PENDING and e["action"] == action for e in chain):
        raise ValueError("outcome without pending")
    e = _make(chain, entry_id, phase, standing, subject, action)
    chain.append(e)
    return e


def seal(chain, entry_id, standing, subject):
    if is_sealed(chain):
        raise ValueError("chain already sealed")
    e = _make(chain, entry_id, _OUTCOME, standing, subject, "seal")
    e["seal"] = True
    chain.append(e)
    return e


def verify(chain) -> bool:
    prev = GENESIS
    seals = 0
    for e in chain:
        if e["parent_hash"] != prev or e["hash"] != digest(canonical(e)):
            return False
        seals += 1 if e.get("seal") else 0
        prev = e["hash"]
    return seals <= 1 and (seals == 0 or chain[-1].get("seal", False))


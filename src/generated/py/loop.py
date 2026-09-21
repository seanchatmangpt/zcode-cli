"""Generated FSM projection; edit the ontology, not this file."""
from enum import Enum
import hashlib


CHAIN_ALGO = "sha256"


def chain_digest(data):
    return hashlib.sha256(data.encode()).hexdigest()


def chain_events(events):
    """Hash chain over event names: each link digests parent hash + event."""
    out, parent = [], ""
    for e in events:
        parent = chain_digest(parent + "|" + e)
        out.append(parent)
    return out



class MxLoopState(Enum):
    Observed = "Observed"
    Decomposed = "Decomposed"
    Planned = "Planned"
    Selected = "Selected"
    Constructed = "Constructed"
    Executed = "Executed"
    Receipted = "Receipted"
    Replayed = "Replayed"
    Experienced = "Experienced"


MXLOOP_INITIAL = MxLoopState.Observed
MXLOOP_TRANSITIONS = (
    ("construct", MxLoopState.Selected, MxLoopState.Constructed, None),
    ("decompose", MxLoopState.Observed, MxLoopState.Decomposed, None),
    ("execute", MxLoopState.Constructed, MxLoopState.Executed, "admitted"),
    ("next", MxLoopState.Experienced, MxLoopState.Observed, None),
    ("plan", MxLoopState.Decomposed, MxLoopState.Planned, None),
    ("receipt", MxLoopState.Executed, MxLoopState.Receipted, None),
    ("record", MxLoopState.Replayed, MxLoopState.Experienced, None),
    ("replay", MxLoopState.Receipted, MxLoopState.Replayed, None),
    ("select", MxLoopState.Planned, MxLoopState.Selected, None),
)


def step_mxloop(state, name, ctx):
    for tname, src, dst, guard in MXLOOP_TRANSITIONS:
        if tname == name and src == state:
            if guard is not None and not ctx.get(guard, False):
                raise ValueError(f"guard {guard} refused")
            return dst
    raise ValueError(f"no transition {name} from {state}")


def replay_mxloop(events):
    """Replay (name, from, to) events from the initial state; return violations
    as (index, kind, detail) with kind in {"illegal", "skipped"}."""
    violations = []
    current = MXLOOP_INITIAL
    for index, (name, src, dst) in enumerate(events):
        if src != current:
            violations.append((index, "skipped", f"expected from {current} but event claims {src}"))
        match = [t for t in MXLOOP_TRANSITIONS if t[0] == name and t[1] == src]
        if not match or match[0][2] != dst:
            violations.append((index, "illegal", f"no transition {name} {src} -> {dst}"))
            continue
        current = match[0][2]
    return violations


class ZcodeTurnState(Enum):
    Idle = "Idle"
    Running = "Running"
    Completed = "Completed"
    Failed = "Failed"


ZCODETURN_INITIAL = ZcodeTurnState.Idle
ZCODETURN_TRANSITIONS = (
    ("turn_completed", ZcodeTurnState.Running, ZcodeTurnState.Completed, None),
    ("turn_failed", ZcodeTurnState.Running, ZcodeTurnState.Failed, None),
    ("turn_started", ZcodeTurnState.Failed, ZcodeTurnState.Running, None),
    ("turn_started", ZcodeTurnState.Completed, ZcodeTurnState.Running, None),
    ("turn_started", ZcodeTurnState.Idle, ZcodeTurnState.Running, None),
)


def step_zcodeturn(state, name, ctx):
    for tname, src, dst, guard in ZCODETURN_TRANSITIONS:
        if tname == name and src == state:
            if guard is not None and not ctx.get(guard, False):
                raise ValueError(f"guard {guard} refused")
            return dst
    raise ValueError(f"no transition {name} from {state}")


def replay_zcodeturn(events):
    """Replay (name, from, to) events from the initial state; return violations
    as (index, kind, detail) with kind in {"illegal", "skipped"}."""
    violations = []
    current = ZCODETURN_INITIAL
    for index, (name, src, dst) in enumerate(events):
        if src != current:
            violations.append((index, "skipped", f"expected from {current} but event claims {src}"))
        match = [t for t in ZCODETURN_TRANSITIONS if t[0] == name and t[1] == src]
        if not match or match[0][2] != dst:
            violations.append((index, "illegal", f"no transition {name} {src} -> {dst}"))
            continue
        current = match[0][2]
    return violations


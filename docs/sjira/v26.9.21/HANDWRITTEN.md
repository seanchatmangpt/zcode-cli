# Hand-written and relocated files, sjira v26.9.21

Everything under this directory except this file and `work-orders.ttl` is generated
from `work-orders.ttl` by `semantic-jira-pack` (ggen_igniter 26.9.20). Generated
files keep their GENERATED header and are never hand-edited.

## Hand-written

- `work-orders.ttl`: canonical RDF source. Vocabulary individuals (evidence and
  projection specs) are copied verbatim from the pack ontology; work-order,
  court, acceptance, falsifier, dependency, action, and checkpoint nodes are
  authored by a generator script over the task specification.
- `HANDWRITTEN.md`: this file.

## UNSUPPORTED(generator-capability): output path relocation

The pack templates fix their output paths (`docs/jira/<id>.md`, `docs/plan/<id>.hddl`,
`docs/prd/<id>.md`, `docs/ard/<id>.md`, `docs/wbpr/<id>.md`) and offer no
version-directory parameter. Generation ran with `--out` under a temp directory and
the outputs were copied byte-for-byte to `docs/sjira/v26.9.21/{jira,plan,prd,ard,wbpr}/`.
The copy is a relocation, not an edit.

## UNSUPPORTED(generator-capability): descriptors via sync

Execution descriptors are not a `mix ggen_igniter.sync` projection. They were built
with `GgenIgniter.SemanticJira.Descriptor.build/4` (provider zcode, authority NONE)
and rendered with `Descriptor.render/1` into `execution/<id>.execution.json`.

Descriptors exist only for frontier work orders (standing UNKNOWN, dependencies
satisfied): ZOCEL-001, 004, 007, 008, 009, 012, 013. The rest were refused by the
descriptor builder with `not_on_frontier: dependencies_unsatisfied`:
ZOCEL-002, 003, 005, 006, 010, 011. This is correct behavior, not a defect.

## Commands executed

- SHACL court: `GgenIgniter.SemanticJira.Shacl.run/2` over `work-orders.ttl` with the
  pack shapes: all 13 shapes pass (result line: `SHACL ok: 13/13 shapes pass`).
- Generation: `mix ggen_igniter.sync --engine sparql --ontology work-orders.ttl
  --pack semantic-jira-pack:{jira,prd,ard,wbpr,plan} --out <tmp>/<kind>/<%= id %>.<ext>
  --manifest-dir <tmp> --verify-cwd ~/ggen_igniter`: exit 0, 13 files each.

## Descriptor digest note

Descriptors were rebuilt from a read-only RDF mapping of `work-orders.ttl` (identifier local
names for courts, acceptance, falsifiers; `sha256` of the ttl bytes as graph and source
digest). The frontier it derives matches the prior descriptor set on the previous graph, and
graph_digest reproduced byte-for-byte on it, but `snapshot_digest` did not reproduce the
committed value (the original work-order map builder was not recovered). UNSUPPORTED
(generator-capability): a pack-side loader from `work-orders.ttl` to work-order maps.

# PolyEvidence admission

`zcode evidence verify` is a deterministic, non-actuating admission court for claims that a construction actually depends on supplied evidence. It generalizes ordered visual evidence into typed evidence objects without treating evidence availability, observation, integration, verification, construction, authority, or actuation as equivalent.

## Contract

A bundle uses `schema: "zcode.poly-evidence/1"` and pins:

- `repository_identity` as `owner/name`
- `base_sha` as an exact 40-hex commit
- `exact_subject` shared by every evidence and derivation node
- `evidence[]` with typed kind, sha256 digest, provenance, and subject
- `derivations[]` with one of `constraint`, `hypothesis`, `verification`, `construction`
- `edges[]` using only the admitted transitions below
- `claims[]` mapping one evidence node to one construction node

The only admitted causal chain is:

```text
Evidence --constrains--> Constraint --supports--> Hypothesis
         --verified_by--> Verification --admits--> Construction
```

The verifier refuses unknown nodes, duplicate identities, subject drift, branch names in place of exact SHAs, invalid digests, unsupported evidence kinds, stage skipping, or any claim without a complete path.

Supported evidence kinds in v1 are `image`, `video`, `log`, `trace`, `ocel`, `test-output`, `diff`, `source`, `issue`, `metric`, `browser-state`, `db-result`, `ontology`, `receipt`, and `prior-run`.

## Usage

```bash
zcode evidence verify --bundle evidence.json
zcode evidence verify --bundle evidence.json --json
zcode evidence verify --bundle evidence.json --out receipt.json
```

A successful receipt has `standing=ADMITTED`, `proof_scope=evidence-integration`, `authority=none`, and `external_do_count=0`. It proves only that the bundle contains a replayable typed evidence-to-construction path. It does not grant authority, execute a patch, establish deployment, or establish external standing.

## Falsifier

The capability is false for a claimed evidence dependency when either condition holds:

1. no replayable `evidence -> constraint -> hypothesis -> verification -> construction` path exists; or
2. any node in that path changes exact subject while the claim remains admitted.

Mutation/ablation courts belong upstream in `autofde-lab`; this command is the portable consumer/admission boundary for their resulting evidence graph.

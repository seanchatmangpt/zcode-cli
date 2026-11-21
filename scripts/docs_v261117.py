#!/usr/bin/env python3
"""v26.11.17 docs upgrade: generate docs/jira/v26.11.17/code-alignment.md per repo from live
git/code facts, and mechanically validate every claim against the live tree.

  docs_v261117.py generate <repo>...   write the doc (Standing: UNVERIFIED)
  docs_v261117.py validate <repo>...   re-derive facts, compare; PASS rewrites Standing: PASS
  docs_v261117.py selftest             mutation court: tampered doc must fail validation
Exit 1 if any repo fails.
"""
import os, re, subprocess, sys, shutil, tempfile

VER = "v26.11.17"
REL = f"docs/jira/{VER}/code-alignment.md"
MANIFESTS = ["mix.exs", "Cargo.toml", "package.json", "pyproject.toml", "go.mod", "pom.xml",
             "build.gradle", "Gemfile", "Makefile", "justfile", "Justfile", "Dockerfile",
             "compose.yaml", "ggen.toml", ".tool-versions", "CLAUDE.md", "AGENTS.md", "README.md"]


class GitError(Exception):
    pass


def git(repo, *a, strict=True):
    r = subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True)
    if r.returncode != 0:
        if strict:
            raise GitError(f"git {' '.join(a)} failed: {r.stderr.strip()[:200]}")
        return ""
    return r.stdout.rstrip("\n")


def vkey(v):
    return tuple(int(x) for x in re.findall(r"\d+", v))


def facts(repo, rev="HEAD"):
    sha = git(repo, "rev-parse", "--verify", rev + "^{commit}")
    out = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "-z", "--name-only", sha],
                         capture_output=True)
    if out.returncode != 0:
        raise GitError(f"ls-tree {sha} failed: {out.stderr.decode()[:200]}")
    files = [f for f in out.stdout.decode("utf-8", "surrogateescape").split("\0") if f]
    if not files:
        raise GitError(f"empty tree at {sha}")  # never a vacuous 0 == 0
    top = {}
    for f in files:
        k = f.split("/")[0] if "/" in f else "."
        top[k] = top.get(k, 0) + 1
    present = [m for m in MANIFESTS if m in set(files)]
    docs_md = sum(1 for f in files if f.startswith("docs/") and f.endswith(".md"))
    prior = sorted({f.split("/")[2] for f in files if re.match(r"docs/jira/v26\.\d+\.\d+/", f)
                    and f.split("/")[2] != VER}, key=vkey)
    return dict(sha=sha, branch=git(repo, "rev-parse", "--abbrev-ref", "HEAD", strict=False),
                tracked=len(files), top=top, manifests=present, docs_md=docs_md, prior=prior[-3:])


def render(repo, f):
    name = os.path.basename(repo.rstrip("/"))
    L = [f"# code-alignment — {name} {VER}", "", "Standing: UNVERIFIED", "",
         "## Identity", f"- Path: `{repo}`", f"- Branch at generation: {f['branch']}", f"- HEAD: {f['sha']}",
         f"- Tracked files: {f['tracked']}", f"- Tracked docs markdown: {f['docs_md']}", "",
         "## Build manifests (tracked at the commit above)"]
    L += [f"- `{m}`" for m in f["manifests"]] or ["- none"]
    L += ["", "## Top-level layout (tracked file counts)"]
    L += [f"- `{k}`: {v}" for k, v in sorted(f["top"].items())]
    L += ["", "## Prior doc waves"]
    L += [f"- `docs/jira/{p}`" for p in f["prior"]] or ["- none"]
    L += ["", "## Falsifiers",
          "- Any tracked path above absent at HEAD, or a count differing from `git ls-files`.",
          "- HEAD sha not equal to or an ancestor of the live HEAD.", "",
          "## Acceptance", "```bash",
          f"python3 ~/zcode-cli/scripts/docs_v261117.py validate {repo}", "```",
          "Expected: exit 0 and `PASS`.", "", "## See Also",
          "- `~/zcode-cli/scripts/docs_v261117.py`", ""]
    return "\n".join(L)


def parse(text):
    g = lambda p: (re.search(p, text, re.M) or [None, None])[1]
    top = {k: int(v) for k, v in re.findall(r"^- `([^`]+)`: (\d+)$", text, re.M)}
    sec = text.split("## Build manifests (tracked at the commit above)")[1].split("##")[0]
    prior = re.findall(r"^- `docs/jira/(v[\d.]+)`$", text.split("## Prior doc waves")[1].split("##")[0], re.M)
    return dict(prior=prior, sha=g(r"^- HEAD: (\w+)"), tracked=int(g(r"^- Tracked files: (\d+)") or -1),
                docs_md=int(g(r"^- Tracked docs markdown: (\d+)") or -1), top=top,
                manifests=re.findall(r"^- `([^`]+)`", sec, re.M))


def validate(repo, path=None, write=True):
    path = path or os.path.join(repo, REL)
    if not os.path.isfile(path):
        return [f"missing {REL}"]
    text = open(path).read()
    lines = text.split("\n")
    errs = []
    if len(lines) < 3 or not lines[0].startswith("# code-alignment"):
        errs.append("H1 does not match filename stem")
    if len(lines) < 3 or not re.match(
            r"^Standing: (ALIVE|PARTIAL_ALIVE|PASS|BLOCKED|UNVERIFIED|PARTIAL)$", lines[2]):
        errs.append("line 3 is not a closed-vocabulary Standing line")
    if "## Falsifiers" not in text or "## Acceptance" not in text:
        errs.append("missing Falsifiers/Acceptance")
    for i, ln in enumerate(lines, 1):
        if len(ln) > 100 and "`" not in ln:
            errs.append(f"line {i} > 100 chars")
    try:
        c = parse(text)
        # facts are re-derived AT THE DOC'S COMMIT: counts are checked at any age of the doc
        live = facts(repo, c["sha"] or "x")
    except (GitError, ValueError, IndexError, KeyError) as e:
        return errs + [f"re-derivation failed: {e}"]
    if live["sha"] != c["sha"]:
        errs.append(f"sha {c['sha']} resolves to {live['sha']}")
    if git(repo, "merge-base", "--is-ancestor", live["sha"], "HEAD", strict=False) == "" and \
            subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", live["sha"], "HEAD"],
                           capture_output=True).returncode != 0:
        errs.append(f"{live['sha']} is not an ancestor of HEAD")
    for k in ("tracked", "docs_md"):
        if c[k] != live[k]:
            errs.append(f"{k}: doc {c[k]} != tree@sha {live[k]}")
    if c["top"] != live["top"]:
        errs.append("top-level layout differs from tree@sha")
    if c["manifests"] != live["manifests"]:
        errs.append(f"manifests doc {c['manifests']} != tree@sha {live['manifests']}")
    if c["prior"] != live["prior"]:
        errs.append(f"prior waves doc {c['prior']} != tree@sha {live['prior']}")
    if write and not errs and lines[2] != "Standing: PASS":
        lines[2] = "Standing: PASS"
        open(path, "w").write("\n".join(lines))
    return errs


def selftest():
    repo = os.path.expanduser("~/zcode-cli")
    d = tempfile.mkdtemp()
    try:
        p = os.path.join(d, "code-alignment.md")
        good = render(repo, facts(repo))
        open(p, "w").write(good)
        assert not validate(repo, p, write=False), "clean doc failed"
        for name, bad in [
            ("tracked count", good.replace("- Tracked files: ", "- Tracked files: 9", 1)),
            ("layout count", re.sub(r"(- `[^`]+`: )(\d+)", lambda m: m.group(1) + "9" + m.group(2), good, count=1)),
            ("prior waves", good.replace("## Prior doc waves\n", "## Prior doc waves\n- `docs/jira/v1.0.0`\n", 1)),
        ]:
            open(p, "w").write(bad)
            assert validate(repo, p, write=False), f"VACUOUS: tampered {name} passed"
        # stale-sha path: doc pinned to an OLDER commit must still be count-checked
        old = git(repo, "rev-list", "--max-count=1", "HEAD~1")
        stale = render(repo, facts(repo, old))
        open(p, "w").write(stale)
        assert not validate(repo, p, write=False), "clean stale-sha doc failed"
        open(p, "w").write(stale.replace("- Tracked files: ", "- Tracked files: 9", 1))
        assert validate(repo, p, write=False), "VACUOUS: tampered stale-sha doc passed"
        print("selftest PASS (clean ok; 3 tampers + stale-sha tamper all refused)")
    finally:
        shutil.rmtree(d)


if __name__ == "__main__":
    cmd, repos = sys.argv[1], [os.path.abspath(os.path.expanduser(r)) for r in sys.argv[2:]]
    if cmd == "selftest":
        selftest(); sys.exit(0)
    bad = 0
    for r in repos:
        if cmd == "generate":
            if not git(r, "rev-parse", "--verify", "-q", "HEAD", strict=False):
                print(f"SKIP {r} (unborn branch: no commits)"); continue
            try:
                f = facts(r)
            except GitError as ex:
                print(f"FAIL {r} :: {ex}"); bad += 1; continue
            p = os.path.join(r, REL); os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w").write(render(r, f)); print(f"GEN  {r}")
        else:
            if not git(r, "rev-parse", "--verify", "-q", "HEAD", strict=False):
                print(f"SKIP {r} (unborn branch: no commits)"); continue
            e = validate(r)
            print(("PASS " if not e else "FAIL ") + r + ("" if not e else " :: " + "; ".join(e)))
            bad += bool(e)
    sys.exit(1 if bad else 0)

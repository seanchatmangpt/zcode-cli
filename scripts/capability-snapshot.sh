#!/usr/bin/env bash
# capability-snapshot.sh — preserve and restore ZCode capabilities across app updates.
#
# A ZCode install carries capabilities that an update must not delete:
#   * user state under ~/.zcode (config.json incl. plugin user_config tokens,
#     installed plugins + marketplace registrations + cache, memories, agents,
#     model-catalog, the user AGENTS.md, workspace state)
#   * the deployed app runtime (Resources/glm) that local patches were baked
#     into by `sync:local`
#   * unpushed commits and untracked files in the zcode-cli working repo
#
# Modes:
#   save                create ~/.zcode-backups/caps-<ts>/ and snapshot everything
#   verify  <dir>       re-hash the snapshot and check it against its manifest
#   diff    <dir>       compare CURRENT live state against a snapshot manifest
#                       (missing = capability deleted, changed = overwritten)
#   restore <dir> [--apply]  print (or with --apply, perform) the restore
#
# Excluded by design (state, not capability, and far too large to snapshot):
# ~/.zcode/cli/{db,exec,log,rollout,tmp}, ~/.zcode/v2, ~/.zcode/computer-use.
set -euo pipefail

BACKUP_ROOT="${HOME}/.zcode-backups"
REPO_DEFAULT="${HOME}/dev/zcode-cli"
REPO="${ZCODE_REPO:-$REPO_DEFAULT}"
APP_GLM="${HOME}/Applications/ZCode.app/Contents/Resources/glm"
APP_PLIST="${HOME}/Applications/ZCode.app/Contents/Info.plist"

# Paths snapshotted, relative to $HOME unless absolute.
USER_PATHS=(
  ".zcode/AGENTS.md"
  ".zcode/cli/config.json"
  ".zcode/cli/model-catalog.json"
  ".zcode/cli/version.json"
  ".zcode/cli/plugins"
  ".zcode/cli/memories"
  ".zcode/cli/agents"
  ".zcode/workspace"
)

die() { echo "error: $*" >&2; exit 1; }

file_list() {
  for p in "${USER_PATHS[@]}"; do
    [ -e "$HOME/$p" ] && echo "$HOME/$p"
  done
  [ -d "$APP_GLM" ] && { echo "$APP_GLM"; [ -f "$APP_PLIST" ] && echo "$APP_PLIST"; }
}

snapshot_repo_state() {
  local dest="$1"
  mkdir -p "$dest/repo"
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo "repo snapshot skipped: $REPO is not a git repo" >"$dest/repo/README.txt"; return; }
  git -C "$REPO" log --oneline origin/main..main >"$dest/repo/unpushed-commits.txt" 2>/dev/null || true
  git -C "$REPO" status --porcelain >"$dest/repo/status.txt" 2>/dev/null || true
  # Every unpushed commit, self-contained and restorable.
  if git -C "$REPO" rev-list --count origin/main..main >/dev/null 2>&1; then
    git -C "$REPO" bundle create "$dest/repo/unpushed.bundle" origin/main..main >/dev/null 2>&1 || true
  fi
  # Untracked files (the manifest does not cover repo worktrees).
  (cd "$REPO" && git ls-files --others --exclude-standard) >"$dest/repo/untracked-list.txt" 2>/dev/null || true
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$dest/repo/untracked/$(dirname "$f")"
    cp -R "$REPO/$f" "$dest/repo/untracked/$f"
  done <"$dest/repo/untracked-list.txt"
}

cmd_save() {
  local ts dest
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dest="$BACKUP_ROOT/caps-$ts"
  mkdir -p -m 700 "$dest"

  : >"$dest/paths.txt"
  file_list >"$dest/file-list.txt"
  tar -czf "$dest/user-state.tar.gz" -T "$dest/file-list.txt" 2>/dev/null

  # Hash every snapshotted file (recursing into dirs) plus the tarball itself.
  ( while IFS= read -r f; do
      if [ -f "$f" ]; then shasum -a 256 "$f"; else find "$f" -type f -exec shasum -a 256 {} +; fi
    done <"$dest/file-list.txt"
    shasum -a 256 "$dest/user-state.tar.gz" ) | sed "s|$dest/||" >"$dest/manifest.sha256"

  snapshot_repo_state "$dest"

  cat >"$dest/README.md" <<EOF
# Capability snapshot $ts

Contents: user-state.tar.gz (paths in file-list.txt), hashes in
manifest.sha256, repo unpushed commits (bundle + patch list) and untracked
files under repo/.

Restore:  $0 restore $dest --apply
Verify:   $0 verify $dest
Diff:     $0 diff $dest
EOF

  local n; n="$(wc -l <"$dest/file-list.txt" | tr -d ' ')"
  echo "snapshot: $dest"
  echo "  files: $n  size: $(du -sh "$dest" | cut -f1)"
  echo "  unpushed commits: $(wc -l <"$dest/repo/unpushed-commits.txt" 2>/dev/null || echo 0)"
}

cmd_verify() {
  local dir="$1"
  ( cd "$dir" && shasum -a 256 -c manifest.sha256 --quiet ) && echo "verify OK: $dir"
}

cmd_diff() {
  local dir="$1" missing=0 changed=0 total=0
  echo "comparing live state against $dir/manifest.sha256"
  while IFS=$'\t' read -r hash path; do
    case "$path" in "$dir"/*|*user-state.tar.gz) continue ;; esac
    total=$((total+1))
    if [ ! -e "$path" ]; then echo "  MISSING  $path"; missing=$((missing+1));
    elif ! [ "$(shasum -a 256 "$path" | cut -d' ' -f1)" = "$hash" ]; then echo "  CHANGED  $path"; changed=$((changed+1)); fi
  done < <(awk '{hash=$1; $1=""; sub(/^ *\*?/, ""); gsub(/\t/," "); printf "%s\t%s\n", hash, $0}' "$dir/manifest.sha256")
  echo "checked $total: missing=$missing changed=$changed"
  # Changed entries under glm/ are EXPECTED after a runtime update; anywhere
  # else a change or any missing entry means a capability was not preserved.
  [ "$missing" -eq 0 ]
}

cmd_restore() {
  local dir="$1" apply="${2:-}"
  [ -f "$dir/user-state.tar.gz" ] || die "no user-state.tar.gz in $dir"
  echo "restore plan:"
  echo "  1. untar user-state.tar.gz over \$HOME (recreates config, plugins, memories, agents, workspace, AGENTS.md)"
  echo "  2. app runtime: rm -rf '$APP_GLM' && tar -xzf - -C '$(dirname "$APP_GLM")' from the glm/ entry of the tarball"
  echo "  3. repo unpushed commits: git -C '$REPO' fetch '$dir/repo/unpushed.bundle' 'refs/heads/*:refs/unpushed/*' && git -C '$REPO' cherry-pick / reset to the recorded tips (see repo/unpushed-commits.txt)"
  echo "  4. untracked repo files: cp -R '$dir/repo/untracked/.' '$REPO/'"
  if [ "$apply" = "--apply" ]; then
    tar -xzf "$dir/user-state.tar.gz" -C "$HOME"
    if tar -tzf "$dir/user-state.tar.gz" | grep -q "Contents/Resources/glm/"; then
      tar -xzf "$dir/user-state.tar.gz" -C /
    fi
    echo "applied: user state and app runtime restored from $dir"
    echo "repo step is deliberately manual — run the git commands printed above"
  fi
}

case "${1:-}" in
  save)    cmd_save ;;
  verify)  shift; [ $# -ge 1 ] || die "verify <dir>"; cmd_verify "$1" ;;
  diff)    shift; [ $# -ge 1 ] || die "diff <dir>"; cmd_diff "$1" ;;
  restore) shift; [ $# -ge 1 ] || die "restore <dir> [--apply]"; cmd_restore "$@" ;;
  *)       die "usage: $0 save | verify <dir> | diff <dir> | restore <dir> [--apply]" ;;
esac

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
#   save                create $ZCODE_BACKUP_ROOT/caps-<ts>/ and snapshot everything
#   verify  <dir>       re-hash the snapshot and check it against its manifest
#   diff    <dir>       compare CURRENT live state against a snapshot manifest
#                       (exit nonzero on any MISSING entry or any CHANGED entry
#                       outside the app's glm/ runtime; glm/ changes are expected)
#   restore <dir> [--apply]  print (or with --apply, perform) the restore
#
# Environment (defaults are the real install locations):
#   ZCODE_BACKUP_ROOT  snapshot output root   (default ~/.zcode-backups)
#   ZCODE_REPO         zcode-cli working repo (default ~/dev/zcode-cli)
#   ZCODE_APP          ZCode.app bundle       (default ~/Applications/ZCode.app)
#
# Excluded by design (state, not capability, and far too large to snapshot):
# ~/.zcode/cli/{db,exec,log,rollout,tmp}, ~/.zcode/v2, ~/.zcode/computer-use.
set -euo pipefail

BACKUP_ROOT="${ZCODE_BACKUP_ROOT:-${HOME}/.zcode-backups}"
REPO="${ZCODE_REPO:-${HOME}/dev/zcode-cli}"
APP="${ZCODE_APP:-${HOME}/Applications/ZCode.app}"
APP_GLM="$APP/Contents/Resources/glm"
APP_PLIST="$APP/Contents/Info.plist"

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
    if [ -e "$HOME/$p" ]; then echo "$HOME/$p"; fi
  done
  if [ -d "$APP_GLM" ]; then
    echo "$APP_GLM"
    if [ -f "$APP_PLIST" ]; then echo "$APP_PLIST"; fi
  fi
}

snapshot_repo_state() {
  local dest="$1"
  mkdir -p "$dest/repo"
  if ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
    echo "repo snapshot skipped: $REPO is not a git repo" >"$dest/repo/README.txt"
    return 0
  fi
  git -C "$REPO" status --porcelain >"$dest/repo/status.txt"
  # Unpushed commits, self-contained and restorable. Only when both refs exist;
  # a real log/bundle failure past that point is fatal, not swallowed.
  if git -C "$REPO" rev-parse --verify -q origin/main >/dev/null \
     && git -C "$REPO" rev-parse --verify -q main >/dev/null; then
    git -C "$REPO" log --oneline origin/main..main >"$dest/repo/unpushed-commits.txt"
    if [ -s "$dest/repo/unpushed-commits.txt" ]; then
      git -C "$REPO" bundle create "$dest/repo/unpushed.bundle" origin/main..main >/dev/null
    fi
  else
    : >"$dest/repo/unpushed-commits.txt"
    echo "no origin/main..main range in $REPO" >"$dest/repo/README.txt"
  fi
  # Untracked files (the manifest does not cover repo worktrees).
  git -C "$REPO" ls-files --others --exclude-standard >"$dest/repo/untracked-list.txt"
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

  file_list >"$dest/file-list.txt"
  [ -s "$dest/file-list.txt" ] || die "nothing to snapshot (no capability paths exist)"
  tar -czf "$dest/user-state.tar.gz" -T "$dest/file-list.txt" || die "tar failed creating user-state.tar.gz"

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
  echo "  unpushed commits: $(wc -l <"$dest/repo/unpushed-commits.txt" | tr -d ' ')"
}

cmd_verify() {
  local dir="$1"
  ( cd "$dir" && shasum -a 256 -c manifest.sha256 --quiet ) && echo "verify OK: $dir"
}

cmd_diff() {
  local dir="$1" missing=0 changed=0 glm_changed=0 total=0
  echo "comparing live state against $dir/manifest.sha256"
  while IFS=$'\t' read -r hash path; do
    case "$path" in "$dir"/*|*user-state.tar.gz) continue ;; esac
    total=$((total+1))
    if [ ! -e "$path" ]; then
      echo "  MISSING  $path"; missing=$((missing+1))
    elif ! [ "$(shasum -a 256 "$path" | cut -d' ' -f1)" = "$hash" ]; then
      case "$path" in
        "$APP_GLM"/*) echo "  CHANGED  $path (expected: runtime update)"; glm_changed=$((glm_changed+1)) ;;
        *) echo "  CHANGED  $path"; changed=$((changed+1)) ;;
      esac
    fi
  done < <(awk '{hash=$1; $1=""; sub(/^ *\*?/, ""); gsub(/\t/," "); printf "%s\t%s\n", hash, $0}' "$dir/manifest.sha256")
  echo "checked $total: missing=$missing changed=$changed glm_changed=$glm_changed"
  # Changed entries under glm/ are EXPECTED after a runtime update; anywhere
  # else a change or any missing entry means a capability was not preserved.
  [ "$missing" -eq 0 ] && [ "$changed" -eq 0 ]
}

cmd_restore() {
  local dir="$1" apply="${2:-}"
  [ -f "$dir/user-state.tar.gz" ] || die "no user-state.tar.gz in $dir"
  local glm_rel="${APP_GLM#/}"
  echo "restore plan:"
  echo "  1. untar user-state.tar.gz (everything except the app runtime) over / (recreates config, plugins, memories, agents, workspace, AGENTS.md)"
  echo "  2. app runtime: rm -rf '$APP_GLM' && tar -xzf user-state.tar.gz -C / '$glm_rel'"
  echo "  3. repo unpushed commits: git -C '$REPO' fetch '$dir/repo/unpushed.bundle' 'refs/heads/*:refs/unpushed/*' && git -C '$REPO' cherry-pick / reset to the recorded tips (see repo/unpushed-commits.txt)"
  echo "  4. untracked repo files: cp -R '$dir/repo/untracked/.' '$REPO/'"
  if [ "$apply" = "--apply" ]; then
    local listing rest
    listing="$(mktemp)"; rest="$listing.rest"
    tar -tzf "$dir/user-state.tar.gz" >"$listing" || die "cannot list $dir/user-state.tar.gz"
    # grep exits 1 on an empty remainder (archive was runtime-only): legal.
    grep -v -e "^$glm_rel/" -e "^$glm_rel\$" "$listing" >"$rest" || [ $? -eq 1 ]
    if [ -s "$rest" ]; then
      tar -xzf "$dir/user-state.tar.gz" -C / -T "$rest" || die "tar failed restoring user state"
    fi
    if grep -q -e "^$glm_rel/" "$listing"; then
      rm -rf "$APP_GLM"
      mkdir -p "$(dirname "$APP_GLM")"
      tar -xzf "$dir/user-state.tar.gz" -C / "$glm_rel" || die "tar failed restoring app runtime"
    fi
    rm -f "$listing" "$rest"
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

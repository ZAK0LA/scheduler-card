#!/usr/bin/env bash
# Rebuild the integration branch of the scheduler forks from a manifest.
# Never pushes. See README.md.
set -euo pipefail

META_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRAILER="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DIST_MSG="build: update dist for the integration branch"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

usage() {
  cat <<'EOF'
Usage: integration.sh <card|component> <command> [options]

Commands:
  status             what each merge line looks like now: already upstream, already
                     in the branch, upstream PR state, local branch differs from origin;
                     plus origin branches the manifest does not mention
  rebuild            tag a backup, reset the branch to base, replay the manifest
  continue           after resolving a conflict by hand: finish that step, replay the rest
  abort              stop a rebuild, reset the branch to its backup tag
  compare [REF]      diff REF (default: the latest backup tag) against the branch, without dist/

Options:
  --repo DIR         worktree to work in (default: repo from the manifest)
  --branch NAME      branch expected in that worktree (default: branch from the manifest)
  --version N        rebuild: use N for the version suffix (default: previous N + 1)
  --full             compare: print the whole diff, not only the stat
EOF
}

# ---------- manifest ----------

load_manifest() {
  MANIFEST="$META_DIR/$TARGET.manifest"
  [[ -f $MANIFEST ]] || die "no manifest $MANIFEST"
  M_REPO= M_BRANCH= BASE= UPSTREAM_GH=
  STEPS=()
  local line op rest
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    read -r op rest <<<"$line"
    case $op in
      repo) M_REPO=$rest ;;
      branch) M_BRANCH=$rest ;;
      base) BASE=$rest ;;
      upstream) UPSTREAM_GH=$rest ;;
      merge | patch | version | build) STEPS+=("$line") ;;
      *) die "$MANIFEST: unknown op '$op'" ;;
    esac
  done <"$MANIFEST"
  [[ -n $M_REPO && -n $M_BRANCH && -n $BASE ]] || die "$MANIFEST: repo, branch and base are required"
  REPO=${OPT_REPO:-$M_REPO}
  BRANCH=${OPT_BRANCH:-$M_BRANCH}
}

g() { git -C "$REPO" "$@"; }

git_path() { (cd "$REPO" && realpath -m "$(git rev-parse --git-path "$1")"); }

# ---------- rebuild state ----------

state_file() { git_path integration-state; }

save_state() {
  cat >"$(state_file)" <<EOF
S_TARGET=$TARGET
S_BRANCH=$BRANCH
S_BACKUP=$BACKUP
S_VERSION=$VERSION_N
S_NEXT=$1
EOF
}

load_state() {
  local f; f=$(state_file)
  [[ -f $f ]] || die "no rebuild in progress in $REPO"
  # shellcheck disable=SC1090
  source "$f"
  [[ $S_TARGET == "$TARGET" && $S_BRANCH == "$BRANCH" ]] || die "the rebuild in progress is for $S_TARGET/$S_BRANCH"
  BACKUP=$S_BACKUP VERSION_N=$S_VERSION
}

# ---------- checks ----------

check_branch() {
  local cur; cur=$(g symbolic-ref --quiet --short HEAD) || die "$REPO: HEAD is detached"
  [[ $cur == "$BRANCH" ]] || die "$REPO is on '$cur', expected '$BRANCH'"
}

check_clean() {
  [[ -z $(g status --porcelain --untracked-files=no) ]] || die "$REPO has uncommitted changes"
}

# Paths that are still unmerged and have no conflict markers left, i.e. rerere
# or a person resolved them. Prints nothing and fails if any path still needs work.
resolved_paths() {
  local paths=() p stages
  mapfile -t paths < <(g diff --name-only --diff-filter=U)
  ((${#paths[@]})) || return 1
  for p in "${paths[@]}"; do
    stages=$(g ls-files -u -- "$p" | awk '{print $3}' | sort -u | tr -d '\n')
    if [[ $stages != 123 ]]; then
      echo "  $p: modify/delete or add/add conflict, resolve by hand" >&2
      return 1
    fi
    if [[ ! -f $REPO/$p ]] || grep -qE '^(<{7}|>{7})( |$)' "$REPO/$p"; then
      echo "  $p: conflict markers left" >&2
      return 1
    fi
  done
  printf '%s\n' "${paths[@]}"
}

stage_resolved() {
  local paths=()
  mapfile -t paths < <(resolved_paths) || true
  ((${#paths[@]})) || return 1
  g add -- "${paths[@]}"
  info "rerere resolved: ${paths[*]}"
}

# ---------- steps ----------

export_patch() {
  g format-patch -1 HEAD --zero-commit --no-signature --stdout >"$META_DIR/$1"
}

step_merge() {
  local ref=$1
  g rev-parse --quiet --verify "$ref^{commit}" >/dev/null || die "unknown ref $ref"
  if g merge-base --is-ancestor "$ref" HEAD; then
    info "skip $ref: already contained"
    return 0
  fi
  info "merge $ref"
  g merge --no-ff --no-edit "$ref" && return 0
  stage_resolved || return 1
  g commit --no-edit
}

step_patch() {
  local file=$1
  [[ -f $META_DIR/$file ]] || die "no patch $file"
  info "patch $file"
  if ! g am -3 "$META_DIR/$file"; then
    stage_resolved || return 1
    GIT_EDITOR=true g am --continue || return 1
  fi
  export_patch "$file"
}

step_version() {
  local suffix=$1 file=src/const.ts base_ver prev n new
  base_ver=$(g show "$BASE:$file" | sed -nE "s/.*CARD_VERSION = '([^']+)'.*/\1/p")
  [[ -n $base_ver ]] || die "no CARD_VERSION in $BASE:$file"
  n=$VERSION_N
  if [[ -z $n ]]; then
    prev=$(g show "$BACKUP:$file" 2>/dev/null | sed -nE "s/.*CARD_VERSION = '[^']*-$suffix\.([0-9]+)'.*/\1/p")
    n=$((${prev:-0} + 1))
  fi
  new="$base_ver-$suffix.$n"
  info "version $new"
  sed -i -E "s/(CARD_VERSION = ')[^']+(')/\1$new\2/" "$REPO/$file" || return 1
  g add -- "$file" || return 1
  g commit --quiet -m "integration: mark the card version as $new" -m "$TRAILER"
}

step_build() {
  local path=$1; shift
  local log; log=$(git_path integration-build.log)
  info "build: $*"
  if ! (cd "$REPO" && "$@") >"$log" 2>&1; then
    tail -n 30 "$log" >&2
    echo "full log: $log" >&2
    return 1
  fi
  g add -u -- "$path" || return 1
  if g diff --cached --quiet; then
    info "build: $path unchanged"
  else
    g commit --quiet -m "$DIST_MSG" -m "$TRAILER"
  fi
}

run_step() {
  local op a1 rest
  read -r op a1 rest <<<"$1"
  case $op in
    merge) step_merge "$a1" ;;
    patch) step_patch "$a1" ;;
    version) step_version "$a1" ;;
    # shellcheck disable=SC2086
    build) step_build "$a1" $rest ;;
  esac
}

run_steps() {
  local i
  for ((i = $1; i < ${#STEPS[@]}; i++)); do
    save_state "$i"
    if ! run_step "${STEPS[i]}"; then
      cat >&2 <<EOF

Stopped at step $((i + 1))/${#STEPS[@]}: ${STEPS[i]}
Resolve the conflict in $REPO and 'git add' the files (do not commit), then:
  $0 $TARGET continue${OPT_REPO:+ --repo $OPT_REPO}${OPT_BRANCH:+ --branch $OPT_BRANCH}
or give up and go back to $BACKUP:
  $0 $TARGET abort${OPT_REPO:+ --repo $OPT_REPO}${OPT_BRANCH:+ --branch $OPT_BRANCH}
EOF
      exit 2
    fi
  done
  rm -f "$(state_file)"
  info "done: $BRANCH = $(g rev-parse --short HEAD), backup $BACKUP"
  info "check with: $0 $TARGET compare${OPT_REPO:+ --repo $OPT_REPO}${OPT_BRANCH:+ --branch $OPT_BRANCH}"
  info "nothing was pushed"
}

# ---------- commands ----------

cmd_rebuild() {
  check_branch
  check_clean
  [[ ! -f $(state_file) ]] || die "a rebuild is already in progress: use continue or abort"
  g fetch --all --prune --quiet
  BACKUP="integration-backup/$TARGET-$(date +%Y%m%d-%H%M%S)"
  g tag "$BACKUP" HEAD
  info "backup $BACKUP = $(g rev-parse --short HEAD)"
  g reset --quiet --hard "$BASE"
  info "reset $BRANCH to $BASE ($(g rev-parse --short HEAD))"
  run_steps 0
}

cmd_continue() {
  load_state
  check_branch
  [[ -z $(g diff --name-only --diff-filter=U) ]] || die "unmerged files left: resolve them and 'git add' them first"
  local op a1 _
  read -r op a1 _ <<<"${STEPS[S_NEXT]}"
  if g rev-parse --quiet --verify MERGE_HEAD >/dev/null; then
    g commit --no-edit
  elif [[ -d $(git_path rebase-apply) ]]; then
    GIT_EDITOR=true g am --continue
    export_patch "$a1"
    info "re-exported $a1: commit it in $META_DIR"
  elif [[ $op != merge && $op != patch ]]; then
    run_steps "$S_NEXT"
    return
  fi
  run_steps $((S_NEXT + 1))
}

cmd_abort() {
  load_state
  check_branch
  g merge --abort 2>/dev/null || true
  [[ -d $(git_path rebase-apply) ]] && g am --abort
  g reset --quiet --hard "$BACKUP"
  rm -f "$(state_file)"
  info "$BRANCH reset to $BACKUP"
}

cmd_compare() {
  local ref=${1:-}
  if [[ -z $ref ]]; then
    ref=$(g tag --list "integration-backup/$TARGET-*" --sort=-refname | head -n 1)
    [[ -n $ref ]] || die "no backup tag, give a ref"
  fi
  info "$ref ($(g rev-parse --short "$ref")) -> $BRANCH ($(g rev-parse --short "$BRANCH")), dist/ left out"
  if g diff --quiet "$ref" "$BRANCH" -- . ':(exclude)dist'; then
    info "sources identical"
  elif [[ $OPT_FULL == 1 ]]; then
    g --no-pager diff "$ref" "$BRANCH" -- . ':(exclude)dist'
  else
    g --no-pager diff --stat "$ref" "$BRANCH" -- . ':(exclude)dist'
  fi
  if g diff --quiet "$ref" "$BRANCH" -- dist; then
    info "dist identical"
  else
    info "dist differs"
  fi
}

cmd_status() {
  g fetch --all --prune --quiet
  declare -A pr_state=()
  if [[ -n $UPSTREAM_GH ]] && command -v gh >/dev/null; then
    local n s
    while read -r n s; do pr_state[$n]=$s; done < <(
      gh pr list -R "$UPSTREAM_GH" --author @me --state all --limit 200 \
        --json number,state --jq '.[] | "\(.number) \(.state)"' 2>/dev/null || true)
  fi
  printf '%-46s %-8s %-9s %-9s %-7s %s\n' REF SHA UPSTREAM "$BRANCH" PR NOTE
  local line op ref pr local_b note in_up in_br pr_s
  for line in "${STEPS[@]}"; do
    read -r op ref pr _ <<<"$line"
    [[ $op == merge ]] || continue
    if ! g rev-parse --quiet --verify "$ref^{commit}" >/dev/null; then
      printf '%-46s %s\n' "$ref" "MISSING"
      continue
    fi
    in_up=no; g merge-base --is-ancestor "$ref" "$BASE" && in_up=YES
    in_br=no; g merge-base --is-ancestor "$ref" "$BRANCH" && in_br=yes
    pr_s=-; [[ $pr != - ]] && pr_s=${pr_state[$pr]:-?}
    note=
    [[ $in_up == YES ]] && note="already upstream: move to 'Accepted'"
    [[ $pr_s == MERGED && $in_up == no ]] && note="PR merged (squash/edited?): move to 'Accepted', rebase dependants"
    [[ $pr_s == CLOSED ]] && note="PR closed: keep in the fork or drop?"
    local_b=${ref#origin/}
    if [[ $local_b != "$ref" ]] && g rev-parse --quiet --verify "refs/heads/$local_b" >/dev/null &&
      [[ $(g rev-parse "refs/heads/$local_b") != $(g rev-parse "$ref") ]]; then
      note="${note:+$note; }local $local_b differs from origin ($(g rev-list --left-right --count "refs/heads/$local_b...$ref" | awk '{print "+"$1" -"$2}'))"
    fi
    printf '%-46s %-8s %-9s %-9s %-7s %s\n' "$ref" "$(g rev-parse --short=7 "$ref")" "$in_up" "$in_br" "$pr_s" "$note"
  done
  local b unlisted=()
  while read -r b; do
    [[ $b == origin/HEAD || $b == "origin/$M_BRANCH" || $b == origin/main || $b == origin/integration-meta ]] && continue
    grep -qF "$b" "$MANIFEST" || grep -qF "${b#origin/}" "$MANIFEST" || unlisted+=("$b")
  done < <(g for-each-ref --format='%(refname:short)' refs/remotes/origin)
  if ((${#unlisted[@]})); then
    echo
    echo "origin branches not mentioned in $TARGET.manifest:"
    printf '  %s\n' "${unlisted[@]}"
  fi
}

# ---------- main ----------

[[ $# -ge 2 ]] || { usage; exit 1; }
TARGET=$1 CMD=$2
shift 2
OPT_REPO= OPT_BRANCH= OPT_FULL=0 VERSION_N= ARGS=()
while (($#)); do
  case $1 in
    --repo) OPT_REPO=$2; shift 2 ;;
    --branch) OPT_BRANCH=$2; shift 2 ;;
    --version) VERSION_N=$2; shift 2 ;;
    --full) OPT_FULL=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
load_manifest
case $CMD in
  status) cmd_status ;;
  rebuild) cmd_rebuild ;;
  continue) cmd_continue ;;
  abort) cmd_abort ;;
  compare) cmd_compare "${ARGS[@]}" ;;
  *) usage; exit 1 ;;
esac

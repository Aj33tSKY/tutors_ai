#!/usr/bin/env bash
# main and develop must never both diverge — one has to contain the other.
#
# Healthy states:
#   develop ahead of main   normal development
#   main ahead of develop   just promoted with a merge commit
#   identical               just synced
#
# Diverged means each branch has commits the other lacks. It happens when a
# promotion is squashed (main gets a new commit that is not in develop's history
# while develop keeps the originals), or when something is merged straight into
# main while develop has unreleased work. Recovering costs a conflict resolution
# or a force push, so it is worth failing loudly the moment it happens.
#
# Usage: verify-branch-parity.sh [main-ref] [develop-ref]
set -euo pipefail

MAIN="${1:-origin/main}"
DEVELOP="${2:-origin/develop}"

for ref in "$MAIN" "$DEVELOP"; do
  if ! git rev-parse --verify --quiet "$ref" >/dev/null; then
    echo "::error::$ref does not exist. Fetch it, or pass the refs explicitly."
    exit 2
  fi
done

ahead_develop="$(git rev-list --count "$MAIN..$DEVELOP")"
ahead_main="$(git rev-list --count "$DEVELOP..$MAIN")"

if git merge-base --is-ancestor "$MAIN" "$DEVELOP"; then
  echo "OK: $DEVELOP contains $MAIN ($ahead_develop commit(s) ahead)."
  exit 0
fi

if git merge-base --is-ancestor "$DEVELOP" "$MAIN"; then
  echo "OK: $MAIN contains $DEVELOP ($ahead_main commit(s) ahead)."
  exit 0
fi

cat >&2 <<EOF
::error::$MAIN and $DEVELOP have diverged: main is ahead by $ahead_main and develop by $ahead_develop, so neither contains the other.
EOF

cat >&2 <<'EOF'
The usual causes:

  * A promotion pull request was squashed instead of merged. Squashing creates a
    commit on main that is absent from develop's history, so the two forks even
    though the content matches. Promote develop into main with "Create a merge
    commit".

  * Something was merged directly into main while develop had unreleased work —
    a Dependabot pull request, or a hotfix that was never merged back.

To recover, first check whether develop holds anything main does not:

  git diff origin/main origin/develop

If that shows only changes already released, reset develop to main:

  git switch develop && git reset --hard origin/main
  git push --force-with-lease origin develop

If develop holds genuine unreleased work, merge main into develop and resolve
the conflicts instead — do not reset, and do not force-push main.
EOF
exit 1

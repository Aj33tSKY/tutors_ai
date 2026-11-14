#!/usr/bin/env bash
# Sends infra/livekit/ to a LiveKit server and installs it, as the pinned deploy
# key. Called by .github/workflows/deploy-livekit.yml; also runnable by hand for
# a one-off with the same variables.
#
# Required environment:
#   DEPLOY_KEY      private half of the deploy key (the secret's whole text)
#   DEPLOY_HOST     the server's DNS name
#   HOST_KEY        its ssh-keyscan line, e.g. "host ssh-ed25519 AAAA..." — pinned,
#                   so a wrong server is rejected instead of trusted on first use
#   LIVEKIT_DOMAIN  signalling name, for the post-deploy check
#   TURN_DOMAIN     TURN name, for the post-deploy check
# Optional:
#   FORCE=true      deploy even while calls are live (they are dropped)
set -euo pipefail

: "${DEPLOY_KEY:?DEPLOY_KEY is not set}"
: "${DEPLOY_HOST:?DEPLOY_HOST is not set}"
: "${HOST_KEY:?HOST_KEY is not set}"
: "${LIVEKIT_DOMAIN:?LIVEKIT_DOMAIN is not set}"
: "${TURN_DOMAIN:?TURN_DOMAIN is not set}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

umask 077
printf '%s\n' "$DEPLOY_KEY" > "$work/key"
printf '%s\n' "$HOST_KEY" > "$work/known_hosts"

command="deploy"
[ "${FORCE:-false}" = "true" ] && command="deploy --force"

echo "==> Deploying infra/livekit to $DEPLOY_HOST ($command)"
tar --no-xattrs -czf - -C "$root/infra" livekit | ssh \
  -i "$work/key" -o IdentitiesOnly=yes -o BatchMode=yes \
  -o UserKnownHostsFile="$work/known_hosts" -o StrictHostKeyChecking=yes \
  "root@$DEPLOY_HOST" "$command"

# The containers have just restarted and Caddy may still be fetching
# certificates, so give the checks a few tries before calling it a failure.
command -v dig >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq dnsutils >/dev/null; }
echo "==> Checking the server from outside"
for attempt in 1 2 3 4 5 6; do
  if "$root/infra/livekit/check.sh" "$LIVEKIT_DOMAIN" "$TURN_DOMAIN"; then
    echo "Deployed and healthy."
    exit 0
  fi
  [ "$attempt" -lt 6 ] && { echo "Not healthy yet (try $attempt of 6); waiting 20 s."; sleep 20; }
done
echo "The deploy finished but the server did not pass check.sh." >&2
exit 1

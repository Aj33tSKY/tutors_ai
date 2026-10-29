#!/usr/bin/env bash
# The only thing the GitHub deploy key is allowed to run on this server.
#
# authorized_keys pins the key to this script (see README.md, "Updating the
# server"), so even with the private key nobody gets a shell. The workflow in
# .github/workflows/deploy-livekit.yml pipes a tarball of infra/livekit/ into
# stdin and asks for either:
#
#   deploy            refuse while anyone is in a call, otherwise install it
#   deploy --force    install even if calls are live (they will be dropped)
#
# Installing means running setup.sh from the new files, which re-renders the
# config from the state kept in /opt/livekit/.env and restarts livekit, egress
# and caddy. Restarting ends every call in progress, which is the reason for
# the guard.
#
# setup.sh refreshes the copy of this script in /usr/local/bin, so a change to
# it takes effect from the next deploy.
set -euo pipefail

INSTALL_DIR=/opt/livekit
SRC_DIR=/root/livekit
MAX_BYTES=$((10 * 1024 * 1024))

case "${SSH_ORIGINAL_COMMAND:-}" in
  "deploy") force=0 ;;
  "deploy --force") force=1 ;;
  *) echo "Only 'deploy' and 'deploy --force' are allowed here." >&2; exit 2 ;;
esac

# Number of people connected to any room right now. Rooms linger for a few
# minutes after the last person leaves, so rooms alone would block needlessly.
connected_participants() {
  [ -f "$INSTALL_DIR/.env" ] || { echo 0; return; }
  local key secret now header payload sig response
  key="$(grep -E '^LIVEKIT_API_KEY=' "$INSTALL_DIR/.env" | cut -d= -f2-)"
  secret="$(grep -E '^LIVEKIT_API_SECRET=' "$INSTALL_DIR/.env" | cut -d= -f2-)"
  b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  now="$(date +%s)"
  header="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"
  payload="$(printf '{"iss":"%s","nbf":%d,"exp":%d,"video":{"roomList":true}}' "$key" "$((now - 10))" "$((now + 60))" | b64url)"
  sig="$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)"
  if ! response="$(curl -fsS --max-time 10 -X POST \
      -H "Authorization: Bearer $header.$payload.$sig" -H 'Content-Type: application/json' -d '{}' \
      http://127.0.0.1:7880/twirp/livekit.RoomService/ListRooms)"; then
    # A server that is down has nobody on it, and refusing would stop the very
    # deploy that might fix it.
    echo "LiveKit did not answer the room check; assuming no calls." >&2
    echo 0; return
  fi
  python3 -c '
import json, sys
rooms = json.load(sys.stdin).get("rooms", [])
print(sum(int(r.get("numParticipants", r.get("num_participants", 0)) or 0) for r in rooms))
' <<<"$response"
}

echo "==> Receiving files"
incoming="$(mktemp -d /root/livekit-incoming.XXXXXX)"
trap 'rm -rf "$incoming"' EXIT
# Capped, and unpacked as plain files: no ownership from the archive.
head -c "$MAX_BYTES" | tar -xzf - -C "$incoming" --no-same-owner --no-same-permissions
[ -z "$(find "$incoming" -type l)" ] || { echo "Refusing an archive that contains symlinks." >&2; exit 1; }
for f in setup.sh docker-compose.yaml livekit.yaml.template egress.yaml.template caddy.yaml.template redis.conf; do
  [ -f "$incoming/livekit/$f" ] || { echo "Archive is missing livekit/$f." >&2; exit 1; }
done

echo "==> Checking for live calls"
people="$(connected_participants)"
if [ "$people" -gt 0 ]; then
  if [ "$force" -eq 1 ]; then
    echo "$people participant(s) are connected; continuing because --force was given. Their calls will drop."
  else
    echo "$people participant(s) are connected. Restarting now would drop their calls." >&2
    echo "Run again once they have finished, or choose force to deploy anyway." >&2
    exit 3
  fi
else
  echo "Nobody is connected."
fi

echo "==> Installing"
rm -rf "$SRC_DIR.previous"
[ ! -d "$SRC_DIR" ] || mv "$SRC_DIR" "$SRC_DIR.previous"
mv "$incoming/livekit" "$SRC_DIR"
cd "$SRC_DIR"
chmod +x setup.sh check.sh deploy.sh
# The key and secret are already on the server; do not print them into a CI log.
SETUP_QUIET=1 ./setup.sh

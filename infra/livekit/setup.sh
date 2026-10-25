#!/usr/bin/env bash
# Installs or upgrades the self-hosted LiveKit stack on this VM.
#
# Run as root on a fresh Ubuntu 24.04 (or 22.04) server, from a copy of this
# directory:
#
#   sudo LIVEKIT_DOMAIN=livekit-staging.example.com \
#        TURN_DOMAIN=turn-staging.example.com \
#        WEBHOOK_URL=https://tutors-dev.vercel.app/api/webhooks/livekit \
#        ./setup.sh
#
# Safe to re-run: it keeps the API key/secret it generated the first time and
# only re-renders config and pulls the pinned image versions, so it is also the
# upgrade command after docker-compose.yaml changes.
#
# Secrets are generated here and live only in /opt/livekit/.env (mode 600).
# Nothing secret belongs in this repository.
set -euo pipefail

INSTALL_DIR=/opt/livekit
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (use sudo)." >&2; exit 1; }

mkdir -p "$INSTALL_DIR/caddy_data"
chmod 755 "$INSTALL_DIR"

# State from a previous run (domains and, crucially, the generated keys).
if [ -f "$INSTALL_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$INSTALL_DIR/.env"; set +a
fi

: "${LIVEKIT_DOMAIN:?Set LIVEKIT_DOMAIN, e.g. livekit-staging.example.com}"
: "${TURN_DOMAIN:?Set TURN_DOMAIN, e.g. turn-staging.example.com}"
: "${WEBHOOK_URL:?Set WEBHOOK_URL to the /api/webhooks/livekit URL of the app}"

case "$WEBHOOK_URL" in
  https://*/api/webhooks/livekit) ;;
  *) echo "WEBHOOK_URL must look like https://<app-domain>/api/webhooks/livekit (a wrong path still returns 200 and silently drops every event)." >&2; exit 1 ;;
esac

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gettext-base openssl ufw unattended-upgrades >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Checking DNS"
public_ip="$(curl -4 -fsS https://api.ipify.org || true)"
for name in "$LIVEKIT_DOMAIN" "$TURN_DOMAIN"; do
  resolved="$(getent ahostsv4 "$name" | awk 'NR==1{print $1}' || true)"
  if [ -z "$resolved" ] || [ -z "$public_ip" ] || [ "$resolved" != "$public_ip" ]; then
    echo "!! $name resolves to '${resolved:-nothing}' but this server's public IP is '${public_ip:-unknown}'." >&2
    echo "   Caddy cannot get certificates until both names point here. Fix DNS, or set SKIP_DNS_CHECK=1 to continue anyway." >&2
    [ "${SKIP_DNS_CHECK:-0}" = "1" ] || exit 1
  fi
done

# Keys are generated once and then kept; rotating them is a deliberate act
# (it must be mirrored in the app's Vercel variables).
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-API$(openssl rand -hex 6)}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-$(openssl rand -hex 24)}"

umask 077
cat > "$INSTALL_DIR/.env" <<ENV
LIVEKIT_DOMAIN=$LIVEKIT_DOMAIN
TURN_DOMAIN=$TURN_DOMAIN
WEBHOOK_URL=$WEBHOOK_URL
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
ENV
umask 022

echo "==> Writing configuration to $INSTALL_DIR"
export LIVEKIT_DOMAIN TURN_DOMAIN WEBHOOK_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET
vars='${LIVEKIT_DOMAIN} ${TURN_DOMAIN} ${WEBHOOK_URL} ${LIVEKIT_API_KEY} ${LIVEKIT_API_SECRET}'
for name in livekit egress caddy; do
  envsubst "$vars" < "$SRC_DIR/$name.yaml.template" > "$INSTALL_DIR/$name.yaml"
done
# livekit.yaml and egress.yaml carry the API secret. The livekit container runs
# as root; the egress image runs as uid 1001 in group root (gid 0), so it can
# only read its config through the group bit. 640 keeps other host users out.
chmod 600 "$INSTALL_DIR/livekit.yaml"
chmod 640 "$INSTALL_DIR/egress.yaml"
# The containers run as other users and must still read their own config.
chmod 644 "$INSTALL_DIR/caddy.yaml"
cp "$SRC_DIR/redis.conf" "$SRC_DIR/docker-compose.yaml" "$INSTALL_DIR/"
chmod 644 "$INSTALL_DIR/redis.conf" "$INSTALL_DIR/docker-compose.yaml"

echo "==> Configuring the firewall (ufw). The Hetzner Cloud Firewall should match."
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 7881/tcp >/dev/null
ufw allow 3478/udp >/dev/null
ufw allow 50000:60000/udp >/dev/null
ufw --force enable >/dev/null

echo "==> Starting LiveKit"
cd "$INSTALL_DIR"
docker compose pull --quiet
docker compose up -d --remove-orphans
# Recreate so a re-run with changed config always takes effect.
docker compose restart livekit egress caddy >/dev/null

sleep 5
docker compose ps

cat <<DONE

LiveKit is starting. Caddy needs a minute to obtain certificates.

Set these in the app's Vercel project for this environment:

  NEXT_PUBLIC_LIVEKIT_URL=wss://$LIVEKIT_DOMAIN
  LIVEKIT_API_KEY=$LIVEKIT_API_KEY
  LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET

Webhook (already configured on the server): $WEBHOOK_URL

These values are stored in $INSTALL_DIR/.env (root only). Then run
infra/livekit/check.sh from your own machine.
DONE

#!/usr/bin/env bash
# Run from your own machine after setup.sh: ./check.sh <livekit-domain> <turn-domain>
# Checks everything that can be checked from outside without a browser. It
# cannot prove a call works; do the manual test in README.md for that.
set -u
LK="${1:?usage: check.sh <livekit-domain> <turn-domain>}"
TURN="${2:?usage: check.sh <livekit-domain> <turn-domain>}"
fail=0
ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fail=1; }

echo "DNS"
for n in "$LK" "$TURN"; do
  ip="$(dig +short A "$n" | tail -1)"
  [ -n "$ip" ] && ok "$n -> $ip" || bad "$n does not resolve"
done

echo "HTTPS signalling endpoint"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$LK/" || true)"
[ "$code" = "200" ] && ok "https://$LK/ returned 200" || bad "https://$LK/ returned '$code' (expected 200)"

echo "TLS certificates (valid, for the right name)"
for n in "$LK" "$TURN"; do
  res="$(echo | openssl s_client -connect "$n:443" -servername "$n" -verify_return_error 2>&1 | grep -E 'Verify return code' || true)"
  case "$res" in
    *"code: 0 "*) ok "$n certificate valid" ;;
    *) bad "$n certificate: ${res:-no TLS response}" ;;
  esac
done

echo "WebRTC over TCP fallback (7881)"
nc -z -w 5 "$LK" 7881 && ok "$LK:7881 open" || bad "$LK:7881 closed (check the firewall)"

echo "TURN over UDP (3478), via a STUN binding request"
python3 - "$TURN" <<'PY' && ok "$TURN:3478/udp answered" || bad "$TURN:3478/udp did not answer"
import os, socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(5)
req = b"\x00\x01\x00\x00\x21\x12\xa4\x42" + os.urandom(12)
s.sendto(req, (sys.argv[1], 3478))
data, _ = s.recvfrom(2048)
sys.exit(0 if data[:2] == b"\x01\x01" else 1)
PY

echo
[ "$fail" = 0 ] && echo "All external checks passed." || { echo "Some checks failed."; exit 1; }

#!/usr/bin/env bash
# Polls a deployment's health endpoint after a release. Proves the build boots
# with that environment's real variables and can reach its database, which a
# successful `vercel deploy` on its own does not.
set -euo pipefail

base_url="${1:-}"
if [ -z "$base_url" ]; then
  echo "::error::Usage: smoke-check-deployment.sh <base-url>"
  exit 2
fi

case "$base_url" in
  http://*|https://*) ;;
  *) base_url="https://$base_url" ;;
esac

health_url="${base_url%/}/api/health"
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
attempts=6
delay=10

for attempt in $(seq 1 "$attempts"); do
  # curl prints 000 itself on a connection failure, so don't append a fallback.
  status="$(curl -sS -o "$body_file" -w '%{http_code}' --max-time 20 "$health_url" || true)"
  status="${status:-000}"

  case "$status" in
    200)
      echo "Health check passed on attempt $attempt: $health_url"
      cat "$body_file"
      exit 0
      ;;
    401|403)
      echo "::error::$health_url returned $status. Configure a reachable STAGING_URL/PRODUCTION_URL or an authenticated protection bypass so the release can be checked."
      exit 1
      ;;
  esac

  echo "Attempt $attempt/$attempts: $health_url returned $status"
  if [ "$attempt" -lt "$attempts" ]; then sleep "$delay"; fi
done

echo "::error::Deployment did not report healthy at $health_url after $attempts attempts (last status $status)."
cat "$body_file" || true
exit 1

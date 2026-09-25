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
  response="$(curl -sS -o "$body_file" -w '%{http_code} %{redirect_url}' --max-time 20 "$health_url" || true)"
  status="${response%% *}"
  status="${status:-000}"
  redirect="${response#* }"

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
    30[1237])
      # Vercel Deployment Protection answers with a redirect to its SSO endpoint
      # rather than a 401, so the status code alone does not identify it. Retrying
      # a protected URL only wastes a minute before failing with a vaguer message.
      case "$redirect" in
        *vercel.com/sso*|*vercel.com/login*)
          echo "::error::$health_url redirected to Vercel's login ($status). Deployment Protection is intercepting the check. Point STAGING_URL/PRODUCTION_URL at a public domain, or add a protection bypass, so the release can be checked."
          exit 1
          ;;
      esac
      ;;
  esac

  echo "Attempt $attempt/$attempts: $health_url returned $status"
  if [ "$attempt" -lt "$attempts" ]; then sleep "$delay"; fi
done

echo "::error::Deployment did not report healthy at $health_url after $attempts attempts (last status $status)."
cat "$body_file" || true
exit 1

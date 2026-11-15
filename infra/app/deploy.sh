#!/usr/bin/env bash
# Deploys one release to this VPS and rolls back automatically if it does not become healthy.
#
#   ./deploy.sh <app-image@sha256:...> <web-image@sha256:...> <commit-sha>
#
# Run from the directory holding compose.vps.yaml, .env (SITE_ADDRESS) and env/*.env. Images must be
# digest-pinned so the host runs exactly what CI built. Database migrations are applied BEFORE this by
# the release workflow; this script never migrates.
set -euo pipefail

app_image="${1:?app image (name@sha256:digest)}"
web_image="${2:?web image (name@sha256:digest)}"
commit="${3:?commit sha}"
[[ "$app_image" =~ @sha256:[0-9a-f]{64}$ && "$web_image" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "Images must be pinned by digest." >&2; exit 2; }
[[ "$commit" =~ ^[0-9a-f]{7,40}$ ]] || { echo "Invalid commit." >&2; exit 2; }
for file in env/api.env env/worker.env; do [[ -f "$file" ]] || { echo "Missing $file" >&2; exit 2; }; done
host="$(grep -E '^SITE_ADDRESS=' .env | cut -d= -f2-)"
[[ -n "$host" ]] || { echo "SITE_ADDRESS is not set in .env" >&2; exit 2; }

compose() { docker compose -f compose.vps.yaml "$@"; }
release_file=.release
previous_app=""; previous_web=""; previous_commit=""
if [[ -f "$release_file" ]]; then read -r previous_app previous_web previous_commit < "$release_file" || true; fi

start() { # app web commit
  APP_IMAGE="$1" WEB_IMAGE="$2" APP_COMMIT_SHA="$3" compose pull --quiet
  APP_IMAGE="$1" WEB_IMAGE="$2" APP_COMMIT_SHA="$3" compose up -d --wait --wait-timeout 120 --remove-orphans
}
healthy() { # commit
  local live
  for _ in $(seq 1 30); do
    live="$(curl -fsS --max-time 5 "https://${host}/health/ready" 2>/dev/null || true)"
    if [[ "$live" == *"\"commit\":\"$1\""* && "$live" == *'"status":"ok"'* ]]; then return 0; fi
    sleep 2
  done
  return 1
}

echo "Deploying ${commit} to ${host}"
if start "$app_image" "$web_image" "$commit" && healthy "$commit"; then
  echo "$app_image $web_image $commit" > "$release_file"
  echo "Healthy: ${commit} is serving."
  exit 0
fi
echo "Release ${commit} did not become healthy." >&2
if [[ -n "$previous_app" ]]; then
  echo "Rolling back to ${previous_commit}" >&2
  start "$previous_app" "$previous_web" "$previous_commit" && healthy "$previous_commit" && echo "Rolled back." >&2 || echo "ROLLBACK FAILED: intervene manually." >&2
fi
exit 1

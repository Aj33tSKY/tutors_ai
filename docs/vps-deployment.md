# Deploying to a VPS

The portable stack runs on one Linux VPS per environment, and the environments may be on different providers.
Today only **staging** exists (below); production hosting is decided at cutover. **Caddy** (TLS, static frontend, API
proxy), the **API** and the **worker**. Supabase (Postgres and Auth), Cloudflare R2 (recordings) and
the Hetzner LiveKit server stay external and are not part of this host. This document describes what
the repository provides; it does not provision anything.

```text
Internet ──443──► Caddy ─┬─ /v1/*, /health/* ──► api:3001 ──► Supabase (RLS, Auth)
                         └─ everything else ──► static files (prerendered pages + SPA)
                      worker ──► Supabase Postgres (restricted job role), R2, LiveKit, Deepgram, AI Gateway, Stripe
```

One origin serves the app and the API, so session cookies stay host-only and HttpOnly and no
edge relay is needed. `APP_WEB_ORIGIN` must equal the public origin exactly.

## Where each environment runs

| Environment | Host | Notes |
| --- | --- | --- |
| Staging | One Oracle Cloud Always Free **Ampere A1** VM (2 OCPU / 12 GB, arm64, London) | Deploys automatically on every merge to `main`. |
| Production | **Not provisioned.** Planned: a Hetzner server (about $24 a month), chosen at cutover | A free tier is not used for production: Oracle halved the free A1 allowance (docs now say 2 OCPU / 12 GB total, so a second 2/12 host does not fit) and reclaims idle free instances. `PRODUCTION_VPS_*` settings do not exist until a host does. |

Oracle's Always Free limit is 2 OCPU / 12 GB of A1 across the whole tenancy, and instances idle for 7 days (CPU, network and
memory all under 20% at the 95th percentile) may be reclaimed (stopped). The staging host holds no data that cannot be
rebuilt: Postgres is Supabase, recordings are R2, and `deploy-vps.yml` rebuilds the stack. Only its `/opt/tutors/env/*.env`
files exist nowhere else, so keep a private copy.

## Keeping the free Supabase project awake

`supabase-keepalive.yml` runs daily and makes one real query through both paths (direct PostgREST RPC and the deployed app), and fails
loudly if either does not answer. Supabase pauses a Free project after a week with too little user database activity; whether this
is enough is **believed, not proven** until a week passes without a pause. Production should be on a paid plan, which never pauses.
A paused project can be restored from the dashboard for up to 90 days.

## Architecture

The staging host is **Ampere (arm64)**, so release images are built with
`--platform linux/arm64` (`IMAGE_PLATFORM` in `deploy-vps.yml`). **A production host on x86 (for example Hetzner CPX)
cannot run these images**: before it exists, either choose an arm64 server (Hetzner CAX) or build a multi-architecture
image (`linux/amd64,linux/arm64`, digest-pinned) so both environments run the same artifact. The JavaScript build runs natively; only the
runtime-dependency stage targets arm64. CI runs the arm64 images under QEMU emulation for the container and Caddy
smoke tests (the ordinary PR job still smoke-tests amd64). Both architectures pass locally.

## What is verified in CI

- `docker build` of the runtime and web images, a non-root/no-Next container smoke test, and
  `web-smoke.mjs`, which runs both images on a private network and checks routing (unknown app routes
  get the shell, missing assets a real 404), caching (hashed assets immutable, pages `no-cache`, API
  `no-store`), security headers, the API proxy and that cross-origin mutations are still refused.
- `verify-bundle-deps.mjs`: every external import of the API and worker bundles is a declared runtime
  dependency. (This caught a real defect: `stripe` was missing from the runtime image.)
- `compose.vps.yaml` is validated with `docker compose config`.

## Host preparation (once per environment)

1. A VPS with Docker Engine and the Compose plugin; 2 vCPU / 2 GB is a starting point, size from
   measurements (the API streams chat and the worker holds Deepgram/AI requests).
2. Firewall: allow 22, 80 and 443 (TCP; UDP 443 optional for HTTP/3). Nothing else. SSH is open to the internet because GitHub's runners
   deploy over it, so keep password login off, use key-only auth and run `fail2ban` (both are in place on staging).
   The API and worker publish no ports.
3. DNS: an A/AAAA record for the site hostname. Caddy obtains and renews certificates itself, so
   port 80 must be reachable.
4. `mkdir -p /opt/tutors/env && cd /opt/tutors`; copy `compose.vps.yaml` and `deploy.sh` there.
   Create `.env` containing `SITE_ADDRESS=<hostname>` and `env/api.env`, `env/worker.env` from
   `infra/app/env.example/` (generated from `config/required-env.json`). Mode 0600, owned by the
   deploy user. Staging and production hosts and credentials must never be shared.
5. Unattended OS security updates; log rotation is configured in the compose file.

## Database login for the worker and the webhook intake

Applied by the release owner before the first deploy, as in `lesson-worker-handover.md` and
`billing-handover.md`: create `NOINHERIT NOBYPASSRLS` logins, then run the grant commands
(`grantJobRuntime` for the worker, `grantEventIntake` for the API's `APP_EVENTS_DATABASE_URL`).
The API and worker never receive the owner or migration credentials. The release step
(`migrate-jobs`, run by `deploy-vps.yml`) reads `APP_JOBS_MIGRATION_DATABASE_URL`, `APP_JOBS_RUNTIME_ROLE` and
`APP_EVENTS_ROLE` from `env/release.env` and **re-grants both roles on every release**, because each migration can
add private functions they must be allowed to call.

## Release

CI builds the images once, pushes them to the registry and records their digests. A deployment:

1. Applies database migrations (existing release workflow), then the explicit job-queue migration:
   `docker compose -f compose.vps.yaml --profile release run --rm migrate-jobs`.
2. Optionally prerenders the public pages against the target environment's API (so crawlers get
   real HTML) and builds the web image with `--build-arg PRERENDERED_DIR=<dir>`; see below.
3. Runs `./deploy.sh <app@sha256:…> <web@sha256:…> <commit>` on the host. It pulls, starts the stack
   and waits for health, then checks `https://<host>/health/ready` reports the new commit. **If it does
   not become healthy it redeploys the previous release automatically** (recorded in `.release`).
   Schema changes are additive, so the previous image keeps working against the new schema.

### Prerendered pages

`npm run prerender:web` (after `npm run build:portable`) needs `PRERENDER_API_ORIGIN` (an already
running API for that environment), `PUBLIC_SITE_ORIGIN`, and `PRERENDER_REQUIRED=1` in release builds. Run
it again, and redeploy the web image, when a tutor is approved or withdrawn and on a schedule (for
example hourly); between rebuilds a stale page corrects itself in the browser, and a withdrawn tutor's
page marks itself `noindex`. The rebuild trigger is a CI concern and is not yet configured.

## Switching traffic from Vercel

Run the new host alongside the existing deployment first, on its own staging hostname. Then, per the
plan: move one webhook at a time (Stripe, then LiveKit — see their handover documents), observe,
and only then point the production domain at the VPS. Keep Vercel deployable for the agreed
observation period. Auth redirect URLs, the Supabase Site URL, R2 CORS origins and Stripe/LiveKit
webhook URLs all change with the hostname.

## Operations

- Logs: `docker compose -f compose.vps.yaml logs -f api worker web`. Application logs are JSON and
  carry request ids, never credentials or lesson content.
- Backlog and stuck work: `select * from private.provider_event_backlog;` (release owner connection).
- Uptime: monitor `https://<host>/health/ready` from outside the VPS; it also reports the commit.
- Backups: the VPS holds no durable application data (Caddy's certificate volume can be re-issued).
  Database backup and recovery remain Supabase's; rehearse restore before relying on it.
- Rollback by hand: `./deploy.sh` with the previous digests from `.release` history or CI.

## Not covered here

Provisioning, external alerting, a load/soak test of this host and observed staging acceptance. These
remain Phase 6 items in the migration plan.

## The release workflow

`.github/workflows/deploy-vps.yml` deploys **staging on every merge to `main`**, and production only when a
human dispatches it with the typed confirmation. `staging.yml` (Vercel) is retired to manual-only and
`production.yml` stays as the Vercel rollback until the production cutover, after which both are deleted.
It runs: preflight (main only, production confirmation, baseline flag, every credential present) →
the shared CI suite → build both images from the exact commit, smoke-test them, push to GHCR and
record **digests** → apply Supabase migrations (history verified, dry-run first) → copy
`compose.vps.yaml`/`deploy.sh`, run the queue migration and `deploy.sh` over SSH with a **pinned host
key** → check the public `/health/ready` → tag production releases.

Per-environment settings (repository level, prefixed like the existing ones; none exist yet):

| Kind | Names |
| --- | --- |
| Secrets | `STAGING_VPS_SSH_KEY` (and `PRODUCTION_VPS_SSH_KEY` once a production host exists). The registry login uses the run's own short-lived token (`packages: read`), so no registry credential is stored. |
| Variables | `{STAGING,PRODUCTION}_VPS_HOST`, `_VPS_USER` (default `deploy`), `_VPS_KNOWN_HOSTS`, `_SITE_URL`, `_PRERENDER_API_ORIGIN` (optional) |
| Existing | the Supabase secrets/variables used by `staging.yml` and `production.yml` |

Credentials are selected in shell, not with a ternary expression, because a ternary would silently fall
back to the staging value when a production secret is empty.

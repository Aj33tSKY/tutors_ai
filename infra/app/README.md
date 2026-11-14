# Portable application runtime

This directory implements the first migration slice on `feature/portable-frontend-backend`.
It is **not ready to replace the complete Next app**. Current functionality is API-owned
authentication and a participant-scoped calendar/booking read and rename flow. The worker
proves a restricted PostgreSQL job connection and heartbeat; lesson processing remains
owned by the existing Vercel jobs until its durable handlers are extracted and tested.

The authoritative checklist is [the migration plan](../../docs/frontend-backend-migration-plan.md).
Supabase PostgreSQL/Auth, R2 and LiveKit remain unchanged. No backend provider or production
domain has been provisioned by this patch.

## Run locally

Use Node 24 and `npm ci` at the repository root. Existing `npm run dev` still starts the
legacy Next app; its production release workflows remain in place.

1. Copy `.env.portable.example` to `.env.portable.local` and populate development values.
2. Start a local Supabase project or use staging credentials deliberately. Never use
   production data for local development. Apply repository migrations through the existing
   workflow; do not paste SQL into a hosted dashboard.
3. Start the new API with:

   ```sh
   node --env-file=.env.portable.local --import tsx apps/api/src/index.ts
   ```

4. In another terminal run `npm run dev:web`, then visit `http://localhost:5173`.
   The Vite development proxy sends `/v1` requests to the API. Production must set
   `VITE_API_ORIGIN` to its stable API origin or configure an equivalent same-origin proxy.

The API does not need a service-role key or a database-owner password. It uses the public
Supabase key plus the HttpOnly cookie session; RLS remains authoritative. The new rename
RPC is an invoker-rights operation, restricted to booking participants. Linked parents may
read an RLS-visible booking but cannot rename it.

Signup and password reset callback routes are implemented but must be tested with the
environment's email templates, Site URL and exact callback allowlist before deployment.
PKCE code exchange must return to the same browser that requested the link. API-hosted
cookies do not automatically authenticate existing Next pages; the session bridge remains
an explicit later phase, not a reason to widen cookie scope.

## Job infrastructure

Use a direct or session PostgreSQL connection, not an unverified transaction pool. The
schema is `app_jobs`, outside the Data API's exposed schemas. The pinned pg-boss version
owns its internal schema definition; review its upgrade/migration plans as release work.

The queue migration is an explicit one-off release operation using
`APP_JOBS_MIGRATION_DATABASE_URL` from a separate ignored `.env.jobs-migrate.local` file:

```sh
node --env-file=.env.jobs-migrate.local --import tsx scripts/migration/migrate-jobs.ts
```

Runtime startup has `migrate: false` and must never receive
that owner connection. A separate runtime role should have schema usage, DML on job tables,
sequence usage and function execution in this private schema, without schema creation,
role administration, RLS bypass or access to Auth records. Revoke browser/public access.
Provision those grants through reviewed repository migration/bootstrap code when selecting
the target environment; do not put role passwords in SQL files. The disposable integration
test proves this privilege model on real Supabase PostgreSQL.

Start the worker with:

```sh
node --env-file=.env.portable.local --import tsx apps/worker/src/index.ts
```

It consumes a versioned heartbeat queue and exposes a dependency-sensitive health endpoint
on port 3002. An external monitor should alert when that endpoint fails. It does not yet
schedule transcription, summarisation, retention or screen-start retries. Do not disable
their existing Vercel schedules for this slice.

## Containers and frontend artifacts

```sh
npm run build:portable
docker build -f infra/app/Dockerfile -t tutors-portable:local .
docker compose --env-file .env.portable.local -f infra/app/compose.yaml up api worker
```

The same non-root image runs API (`node dist/api.mjs`), worker (`node dist/worker.mjs`) or
the explicit queue migration (`node dist/migrate-jobs.mjs`). Runtime dependencies exclude
the frontend, Next and build tools. Set `PORT` to the provider's assigned port. Health
routes are `/health/live` and `/health/ready`; only the API has HTTP business endpoints.
The worker uses its own port for health checks. Allow at least 35 seconds to drain containers.

Compose maps configuration explicitly so the schema-owner credential is never passed to
the API or worker. For development-only HTTP cookies, run the native dev process; container
production mode sets Secure cookies and expects HTTPS. If connecting to laptop Supabase
from Docker Desktop, use a container-reachable hostname such as `host.docker.internal`.

Frontend output is `apps/web/dist`. `apps/web/wrangler.jsonc` defines distinct staging and
production names. It is preparatory configuration, not an instruction to publish the
partial frontend to the existing live domain. Public marketing/profile rendering, every
remaining application route and deployment cutover still need completion.

## Verification

```sh
npm run lint
npm run typecheck:portable
npm run test:portable
npm run build:portable
npx --no-install playwright install chromium
npm run test:portable:integration
```

Integration owns a temporary project with a distinct ID and ports 553xx. It copies checked-in
migrations/tests, applies a clean reset, lints SQL, runs all pgTAP suites and exercises real
API cookies, RLS, persistence, a real Chromium sign-in/rename/reload/logout/access-denial
journey, and the restricted job role. It never reads `.env.local` or
links a remote project, and stops only its own project with volume deletion. Do not run two
copies simultaneously on the same machine. Existing local `tutors` containers are untouched.

The legacy Next checks must continue to pass too. Keep the existing release check names,
manual production confirmation and serial migration-before-deploy ordering. CI covers both
runtimes while extraction is in progress; no live deployment target switches in this slice.

After building an image, `node scripts/migration/container-smoke.mjs <image>` verifies
non-root execution, absence of Next in the runtime, actual HTTP health/access denial and
graceful SIGTERM. No provider credentials are needed for this smoke check.

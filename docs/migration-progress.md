# Frontend/backend migration progress

Branch: `feature/portable-frontend-backend`, created from fetched `origin/main` at
`67a3da5` on 14 November 2026. This is an incremental migration, not a completed cutover.

## Implemented in the first slice

- npm workspace boundaries for API, web, worker, contracts, data, domain and jobs.
- Hono/Node API with structured request IDs/logging, input limits, exact-origin
  credentialed CORS, mutation-origin protection, consistent errors, readiness and commit ID.
- Supabase cookie adapter keeps credentials HttpOnly; user queries remain RLS-scoped.
- Auth endpoints for sign-in/signup, refresh, logout, password reset/update and PKCE exchange.
- OpenAPI endpoint with a test ensuring versioned endpoint inventory matches documentation.
- Booking/calendar read, explicit participant authorization and invoker-rights rename RPC.
- Separate Vite frontend for sign-in and the booking read/rename journey, with account
  and reset screens prepared for environment-specific email verification.
- pg-boss infrastructure with explicit schema migration, runtime migration disabled and
  a worker heartbeat; API and worker have separate commands and runtime credentials.
- Non-root multi-stage Docker image, local Compose and static Cloudflare configuration.
- CI checks for both old and new runtimes; runner-owned clean local database, schema lint,
  existing/new SQL tests and real Supabase cookie/RLS/job-role integration.
- Environment manifest scanning covers workspace code and the release-only job migration.

## Still required before replacing the existing app

- Live inventory/cost/performance baseline and host/domain selection; the repository docs
  are not proof of current provider account state.
- Frontend parity and component reuse for the full dashboard, booking/request management,
  availability, parents/admin, billing/payouts, messages, review/playback, chat and live lessons.
- Extract the remaining Server Actions and route handlers into domain/API operations;
  transactional booking scheduling, quota reservation and provider idempotency.
- Test email confirmation/reset against actual templates and browser origins; design and
  test the temporary legacy Next/API session bridge and Realtime token lifecycle.
- Durable signed-event inbox/outbox, actual lesson worker handlers, per-segment transcript
  idempotency, summary/embedding publication, retention and controlled scheduler handover.
- Private attachment and Realtime adapters, participant-only LiveKit token endpoint and
  real lesson recording/playback acceptance matrix.
- Full public tutor discovery/profile prerendering and rebuild/withdrawal semantics.
- Generated browser client and richer response schemas; OpenAPI currently documents the
  first-slice routes and inputs, while the browser client uses shared TypeScript DTOs.
- Broader Chromium/Safari browser coverage, deployment-under-load tests, host-failure/recovery and
  artifact rollback with old browser tabs and queued job versions.
- Provider release adapters, runtime environment parity, immutable image deployment,
  stable-domain switches, external alerts and observed staging soak results.
- Production's existing manual release gate, Vercel observation/rollback period and retirement.

The legacy Next frontend, existing webhooks and Vercel lesson jobs remain the live path.
Do not treat this branch's initial frontend or heartbeat worker as a production replacement.
Do not check off the migration plan's phase exit criteria solely because a skeleton builds.

## Verification recorded locally

- ESLint and both TypeScript projects pass. The existing Next production build passes.
- Ten API/domain/contract tests pass.
- Disposable Supabase clean reset, SQL lint and every pgTAP suite pass, including the new
  participant-only rename tests.
- Real-cookie/RLS integration and a Chromium sign-in -> booking -> rename -> reload ->
  logout -> outsider-denial journey pass against local Supabase. Safari and email delivery
  acceptance remain outstanding.
- Restricted job-role enqueue/fetch/complete/supervision works without Auth table access.
- Docker image builds; runtime smoke verifies UID 1000, no installed Next dependency,
  listening HTTP health/access checks and graceful termination. Deployment under real
  request load and worker crash/replay for lesson jobs remain outstanding.
- Environment manifest, reusable-workflow permissions and pinned actionlint checks pass.

These are local results. GitHub-hosted CI and an actual provider deployment are separate
verification steps; neither is implied by the local checks.

Next implementation work: complete Phase 0 inventory and the auth bridge, then migrate the
existing booking/dashboard components onto the tested API boundary. Continue to follow
[frontend-backend-migration-plan.md](frontend-backend-migration-plan.md).

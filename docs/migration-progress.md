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

## Additional extraction on 15 November

- API-backed tutor availability and student/tutor contact lists reuse the
  existing UI. Parent overview and administrator verification screens also use
  shared components, with explicit role checks and caller-scoped queries/RPCs.
- Live lesson state, participant-only token issuance, tutor start, recording
  consent and student presence checks have Hono endpoints. The static frontend
  reuses the existing lobby and video room through injected API adapters.
  Completed/cancelled lessons cannot mint new room tokens; linked parents cannot
  enter live rooms. Consent and lesson start use invoker-rights SQL operations.
- The worker has actual versioned transcription, summary/embedding and retention
  handlers. Private, enumerated database functions keep it out of application and
  Auth tables. Publication, leases, retries and tutor-note preservation replace
  the previous nontransactional processing path.
- Legacy crons and worker selectors share a database ownership fence, defaulting
  to legacy. An explicit paused/drained release handover is documented in
  [lesson-worker-handover.md](lesson-worker-handover.md).
- The portable frontend splits route and video-room bundles; LiveKit credentials
  are read by the API at runtime. AI jobs receive an explicit Gateway key rather
  than relying on Vercel's deployment identity.
- Completed lesson reviews reuse the existing player, synchronized screen
  segments and editable notes. Read models and note writes are caller-scoped;
  signed URLs are created only after the booking passes RLS.
- A small Cloudflare same-origin relay keeps HttpOnly cookie sessions working
  without third-party cookies. Its routing configuration compiles with pinned
  Wrangler and is checked in CI without deployment. See
  [cloudflare-frontend.md](cloudflare-frontend.md).

## Remaining work

- Live inventory/cost/performance baseline and host/domain selection; the repository docs
  are not proof of current provider account state.
- Full calendar/dashboard parity, booking/request management, billing/payouts,
  messages/attachments, chat and public discovery/prerendering.
  Extracted availability, contacts, parent/admin and room screens still need
  production-like acceptance alongside reviews and these remaining journeys.
- Extract the remaining Server Actions and route handlers into domain/API operations;
  transactional booking scheduling, quota reservation and provider idempotency.
- Test email confirmation/reset against actual templates and browser origins; design and
  test the temporary legacy Next/API session bridge and Realtime token lifecycle.
- Durable signed-event inbox/outbox, LiveKit recording/screen-egress worker
  extraction, crash recovery for external recording effects, live-provider
  acceptance and an observed scheduler handover.
- Private attachment and Realtime adapters and a real lesson recording/playback
  acceptance matrix.
- Full public tutor discovery/profile prerendering and rebuild/withdrawal semantics.
- Generated browser client and richer response schemas; OpenAPI currently documents the
  first-slice routes and inputs, while the browser client uses shared TypeScript DTOs.
- Broader Chromium/Safari browser coverage, deployment-under-load tests, host-failure/recovery and
  artifact rollback with old browser tabs and queued job versions.
- Provider release adapters, runtime environment parity, immutable image deployment,
  stable-domain switches, external alerts and observed staging soak results.
- Production's existing manual release gate, Vercel observation/rollback period and retirement.

The legacy Next frontend, existing webhooks and Vercel lesson jobs remain the live path.
The new lesson handlers are fenced off until the documented release handover.
Do not treat the extracted routes as a complete production replacement.
Do not check off the migration plan's phase exit criteria solely because a skeleton builds.

## Verification recorded locally

- ESLint and both TypeScript projects pass. The existing Next production build passes.
- Fifteen API/domain/contract, streaming-relay and transcript-format tests pass.
- Disposable Supabase clean reset, SQL lint and every pgTAP suite pass, including the new
  participant-only rename tests.
- Real-cookie/RLS integration and Chromium journeys pass through the same-origin
  relay: login/logout, booking rename/reload, outsider denial, availability
  create/delete, contacts, parent/admin access, tutor approval, room entry and
  completed-review note editing/reload. LiveKit and AI providers are stubbed.
  Safari, actual media calls and email delivery acceptance remain outstanding.
- Restricted job-role enqueue/fetch/complete/supervision works without Auth or
  direct application-table access. Concurrent transcription claims, completion
  replay, expired/stale leases, provider failure, summary/embedding publication,
  preservation of tutor edits and retention replay pass against real PostgreSQL.
- Docker image builds; runtime smoke verifies UID 1000, no installed Next dependency,
  worker/provider dependency imports,
  listening HTTP health/access checks and graceful termination. Deployment under real
  request load and worker crash/replay for lesson jobs remain outstanding.
- Environment manifest, reusable-workflow permissions and pinned actionlint checks pass.

These are local results. GitHub-hosted CI for the latest extraction and an actual provider deployment are separate
verification steps; neither is implied by the local checks.

Next implementation work: transactional scheduling and full calendar parity,
then billing, messaging/chat and public discovery; finish the signed-event/recording
worker extraction and release adapters before cutover. Phase 0 inventory, the
auth/old-tab transition and production-like acceptance remain required. Continue to follow
[frontend-backend-migration-plan.md](frontend-backend-migration-plan.md).

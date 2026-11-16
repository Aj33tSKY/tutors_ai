# Frontend/backend migration progress

> **Direction changed on 16 November 2026.** The hosting target is now Cloudflare Workers for the web app, the API and the
> background jobs; see [cloudflare-migration-plan.md](cloudflare-migration-plan.md). The VPS runtime described below is an interim staging host, and the cutover
> mechanics under "Remaining work" (VPS provisioning, the worker ownership handover) are superseded by that plan's phases.

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

## Scheduling and messaging extraction (15 November, later)

- Lesson creation, request acceptance, completion, reopening, cancelling (single or series) and
  rescheduling are single database transactions behind invoker-rights RPCs
  (`schedule_lessons_v1`, `tutor_change_lesson_v1`). Both calendars are locked in UUID order, so
  concurrent scheduling cannot double-book either side, a conflict anywhere in a series rolls the
  whole series back, and a per-actor idempotency key makes a retried submit return the original
  result (and rejects a reused key with different input). The confirmation message is part of
  the same transaction. The legacy Server Actions and the Hono routes both call the same RPCs.
- Summary wake-up is a transactional marker (`private.lesson_summary_pending`) rather than
  repeatedly hashing every historical transcript. Participants can no longer write transcript
  provenance or private recording paths on `session_analytics` (column-level `UPDATE` grant).
- Direct messages: server-derived sender, cursor-paged history (50 per page), one batched
  signing call per page, and validated attachments. Uploads go through the API, which checks
  size, an allow-list that excludes SVG, and that the file's leading bytes match the declared
  type. A database constraint ties every new attachment path to its own conversation and
  sender, and a trigger bumps the conversation atomically with the insert. The bucket is now
  declared in a migration (private, 10 MiB, MIME allow-list) instead of being a dashboard step.
- Live updates use cursor polling (5 s, paused in hidden tabs) instead of Supabase Realtime.
  Realtime would need the browser to hold an access token, which the HttpOnly cookie design
  deliberately avoids. SSE can replace polling later behind the same `MessageTransport` seam.
- The job-runtime privilege check also rejects roles that can `SET ROLE` to a privileged role
  through a `NOINHERIT` membership.

## Billing, payouts and the Stripe inbox (15 November, later)

See [billing-handover.md](billing-handover.md). Highlights:

- Closed a pre-existing hole: a booking participant could write `payment_status`,
  `amount_gbp_pence` and invoice fields, and users could set their own Stripe customer or
  payout account. Billing columns are now platform-managed; Stripe ids are first-write-wins.
- Student billing, auto-charge, payout onboarding and lesson invoicing are API operations
  and shared domain code; the web app has Payment settings and Payouts pages, and the
  calendar's "Send invoice" works. Legacy Server Actions delegate to the same code.
- The Stripe webhook persists signed events before acknowledging; the worker applies them
  with leases, backoff and a no-downgrade rule. The legacy webhook no longer swallows
  database failures.
- The 15 % platform fee, invoice semantics and hosted Checkout/portal are unchanged.

## LiveKit webhook and recording control (15 November, later)

See the new section in [lesson-worker-handover.md](lesson-worker-handover.md). Recording start,
stop and screen-share retries moved out of Next's `after()` into the worker with database
reservations, a durable signed-event inbox and reconcilers for lost webhooks and orphaned
reservations. Covered by integration tests with a fake media server; no real call has been made
through the new path yet.

## Revision chat (15 November, later)

- Closed a quota hole: the chat policy let a student delete their own messages to reset the daily
  cap and insert forged assistant turns into the model's history. Messages are now written only by
  `chat_begin_turn_v1` / `chat_finish_turn_v1`; usage is a ledger (`private.chat_usage`) updated
  by one atomic upsert, so the cap is exact under concurrent requests (tested with 6 at once) and
  cannot be reset. Every attempt is charged, including a replay of the same message id.
- Bounded history is read at the source (newest 12) instead of loading the whole thread.
- `chatTurn` in `packages/domain/src/chat.ts` serves both the Hono API (`POST /v1/student/chat`,
  streamed over the cookie session and the same-origin relay) and the legacy Next route. Requests
  accept text parts only. The web app has the revision assistant at `/dashboard/student/chat`,
  sharing one UI with the legacy page. `AI_GATEWAY_API_KEY` is now declared for the API as well.
- Streaming through the real Cloudflare relay and a live Gateway model have not been exercised;
  tests use a mock model.

## Public discovery and lesson requests (15 November, later)

- **Closed another hole:** students could insert lesson requests directly (any tutor, any time, any
  `is_trial`, unlimited volume), and the request flow was four separate writes that raced on the
  free-trial rule. `request_lesson_v1` now validates the tutor and offer, checks the slot, applies
  the trial rule under a lock, bounds open requests (3 per tutor, 10 total) and writes request,
  conversation and tutor notification in one transaction. Requests are immutable after creation.
- **UK time, server-side:** `tutor_open_slots_v1` computes bookable hours in Europe/London from the
  tutor's wall-clock availability (so daylight saving moves the instant, not the lesson hour) and
  hides hours the tutor already has a lesson in. Previously each browser derived slots in its own
  timezone. Open times are never cached.
- **Public API:** `GET /v1/public/tutors[/:id]` serves only approved, non-demo tutors with no
  private fields, cacheable for a minute; the edge relay forwards no cookies on these reads and
  never lets a cookie-setting or authenticated response become shareable.
- **Shared UI:** catalogue, profile and request form are one component set used by the legacy
  pages and the Vite app (`/tutors`, `/tutors/:id`). Sign-in honours a same-site `next` path.
- **Prerendering:** `npm run prerender:web` (after `build:portable`) writes crawlable HTML,
  canonical/OG tags, JSON-LD, `sitemap.xml` and `robots.txt` from the API; tutor-written text is
  escaped so it cannot close the embedded data script. The SPA replaces and revalidates the page on
  load, and a withdrawn tutor's page marks itself `noindex`. Release builds set
  `PRERENDER_REQUIRED=1`; staleness is bounded by rebuilding on tutor approval/withdrawal and on a
  schedule (the rebuild trigger itself is deployment work, not done).
- **Marketing pages and the dashboard frame** now exist in the Vite app, reusing the same
  components: `next/link`, `next/image` and `next/navigation` are aliased to router-backed shims
  at build time, so the legacy files are unchanged and the bundle contains no Next runtime. Fonts
  (Geist, Roboto Mono, Newsreader) are self-hosted. The dashboard sidebar and topbar wrap every
  signed-in route; sign-out is injected (`signOut` prop), so one component serves both hosts.
- Prerendering now covers the four marketing pages as well as the catalogue and profiles, and runs
  through Vite's SSR loader so it sees exactly the browser build's aliases and CSS.

## VPS runtime (15 November, later)

See [vps-deployment.md](vps-deployment.md). The repository now builds a **web image** (Caddy serving the
static frontend, prerendered pages and proxying `/v1` and `/health` on one origin, so no Cloudflare
relay is needed), has a production `compose.vps.yaml` (web, API, worker; digest-pinned images; a
`release` profile for the queue migration) and `deploy.sh`, which health-checks the new commit and
rolls back automatically. CI builds both images and runs `web-smoke.mjs` against them plus a new
`verify-bundle-deps.mjs` guard. Building the images for real exposed a defect the local tests could
not: the runtime image lacked `stripe`. Environment templates under `infra/app/env.example/` are
generated from the manifest. Not done: provisioning, the registry/release workflows that replace the
Vercel steps, the prerender rebuild trigger and an observed staging soak.

## Remaining work

Application behaviour is now fully extracted: every legacy page, Server Action, route handler and cron has
an API/worker/Vite equivalent (the legacy files remain only as the live path until cutover). What is left is
verification against real services, the cutover itself, and a few follow-ups:

- **Phase 0 baselines** (need authorised read-only access to live accounts): deployed commits, domains, costs,
  Supabase sizes and connection limits, API/page timings, background backlog, resource baselines and agreed
  acceptance thresholds. Nothing here can be derived from the repository.
- **Observed acceptance against real providers** (tests use fakes): a Stripe sandbox run (checkout setup,
  invoice, automatic charge, webhook), a real LiveKit call through the new recording path including a
  UDP-blocked network, a live AI Gateway turn through the Caddy proxy, and email confirmation/reset against the
  actual templates and origins.
- **Cutover mechanics:** provision the VPS(es), registry and the per-environment secrets in
  [vps-deployment.md](vps-deployment.md); switch the Stripe, then LiveKit, webhook URLs one at a time; run the
  worker ownership handover ([lesson-worker-handover.md](lesson-worker-handover.md)); update Auth redirect URLs,
  R2 CORS and domains; observe; then retire Vercel crons, Server Actions and the Next runtime after the agreed
  rollback window. Do not run both receivers of any webhook at once.
- **Auth bridge:** the plan's explicit design for sessions shared between the old Next pages and the API during
  the transition is not needed if cutover is by environment (a browser uses one stack), but old-tab/stale-asset
  behaviour across a deploy still needs a rehearsal.
- **Operations:** external uptime/alert rules, a prerender rebuild trigger (on tutor approval/withdrawal and on
  a schedule), a one-hour soak and ten-session load test on the VPS, backup restore rehearsal.
- **Follow-ups:** a generated typed browser client (the browser uses shared TypeScript DTOs; OpenAPI documents
  inputs but not rich response schemas), a transactional outbox for state-change-triggered jobs (discovery polling
  is used today), broader Safari/mobile browser coverage, and the later own-PostgreSQL project (explicitly out of
  scope for this release).

The legacy Next frontend, existing webhooks and Vercel lesson jobs remain the live path.
The new lesson handlers are fenced off until the documented release handover.
The portable stack is feature-complete but **not production-verified**: nothing has run against real
Stripe, LiveKit, AI Gateway, email or a deployed host yet. Do not check off the migration plan's phase exit
criteria on the strength of local fakes; each needs the observed acceptance listed above.

## Verification recorded locally

Latest full run (15 November): ESLint; both TypeScript projects; 16 unit tests; Next build and Vite build;
disposable Supabase clean reset, schema lint and all 15 pgTAP suites; one integration run covering the API,
RLS, messaging, billing and the Stripe/LiveKit event inbox, scheduling concurrency, chat quota, public catalogue
and prerender, and Chromium journeys through the dashboard frame; the runtime and web Docker images with
container and Caddy smoke tests; environment-manifest, bundle-dependency, workflow-permission and actionlint checks.
The earlier, narrower record from the first slices follows.

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

Next implementation work: public discovery and the booking-request flow, then retiring the legacy actions/crons; finish the signed-event/recording
worker extraction and release adapters before cutover. Phase 0 inventory, the
auth/old-tab transition and production-like acceptance remain required. Continue to follow
[frontend-backend-migration-plan.md](frontend-backend-migration-plan.md).

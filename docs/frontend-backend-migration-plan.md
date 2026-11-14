# Frontend/backend migration plan

Status: in progress on `feature/portable-frontend-backend`; first authenticated slice implemented.
Updated: 14 November 2026.

Read [migration-progress.md](migration-progress.md) for implemented work, verification and
remaining scope. Unchecked phase exits remain outstanding even where individual foundations exist.

This is the implementation plan for the architecture agreed in this conversation. It takes precedence over the alternative target architectures in [the hosting assessment](hosting-alternatives-2026-11-14.md) and [the portability assessment](portable-split-architecture-2026-11-14.md). Those remain research context, not implementation instructions.

**First release target:** Cloudflare frontend -> containerised Hono API + background worker -> existing Supabase PostgreSQL and Auth. Keep existing R2 recording storage and the separate Hetzner LiveKit infrastructure.

**Later target:** move application data to our own PostgreSQL deployment, deliberately resolve authentication and other remaining Supabase dependencies, and consider Redis if its whole-stack cost and measured benefit justify it. Do not combine that database cutover with the first frontend/backend migration.

## Working rules

- Keep one repository and one long-lived branch, `main`. Work through feature PRs. Staging deploys automatically; production remains a manually confirmed release.
- GitHub Actions owns deployments. Disable competing provider Git auto-deploys. Build artifacts before applying migrations; apply migrations before deploying code that requires them.
- Preserve migration history, baseline/history verification, SQL/RLS tests, environment parity, workflow permission checks, health checks and production release tags.
- Read [development-workflow.md](development-workflow.md) first and the relevant installed Next.js guides before changing existing Next code. Use the Supabase skill and current official docs for Supabase implementation details; discover pinned CLI commands through `--help`.
- Use additive schema and API changes. Old frontend bundles, API versions and queued jobs must continue working during deployment and rollback overlap.
- No shared production/staging databases, Auth credentials, recording buckets, queues or LiveKit credentials. Keep production credentials out of PR builds and local fixtures.
- Keep business logic independent of Next, Hono request contexts and hosting-provider APIs. Do not introduce Cloudflare Workflows, Queues, D1 or Durable Objects into the core backend for this migration.
- Do not add Redis, Kubernetes, microservices or a new authentication provider to the first release by default.
- This document authorises planning, not external provisioning or a production cutover. Implement repository changes through the normal workflow; use the existing manual production gate for releases.

## Architecture and ownership

```text
Browser -> Cloudflare static frontend -> Hono API container
                                         |-- Supabase Auth
                                         |-- user-scoped Supabase Data API / RPC
                                         |-- private file grants and R2 signing
                                         |-- durable events / job dispatch
                                         |
                                  Node worker container
                                         |-- Supabase-hosted PostgreSQL jobs
                                         |-- Deepgram / AI providers
                                         |-- LiveKit control / recording recovery

Browser <-> LiveKit on Hetzner -> private R2 recordings
```

| Boundary | First-release decision |
| --- | --- |
| Frontend | React/Vite for the authenticated app; reuse existing components. Cloudflare Workers Static Assets preferred, Pages acceptable. Final output stays deployable as ordinary static files. |
| Public pages | Preserve crawlable tutor pages and metadata through prerendering and explicit refresh triggers; retain existing Next public pages temporarily during extraction if needed. Do not silently convert discovery to client-only rendering. |
| API | Hono on pinned Node LTS, initially compatible with the repository's Node 24. HTTP/JSON contracts, OpenAPI, Zod validation and explicit authorization. |
| Jobs | Separate Node worker, preferably the same OCI image with a different command. pg-boss on existing Supabase PostgreSQL, subject to a tested connection/permission/version gate. |
| User queries | Initially retain user-token-scoped Supabase queries and RPCs behind repositories. Do not convert all reads/writes to service-role or owner connections. |
| Database transactions | Add narrow SQL/RPC operations for business transactions and a private outbox. Use a separately scoped direct PostgreSQL role for job infrastructure. |
| Auth | Retain Supabase users, passwords, UUIDs, email verification/reset flows and revocation semantics. Expose application auth through an API adapter. |
| Realtime | Retain Supabase Realtime behind a frontend adapter initially; replace direct browser message mutations with API calls. SSE replacement is a later independent change if it earns its cost. |
| Attachments | Retain Supabase Storage initially behind API-authorised grants. Moving homework files to R2 is separate from moving recordings, which already use R2. |
| Hosting | Backend provider not yet selected. Validate the same image on Render/Railway and local Compose; use a separate Hetzner app host if selected later. Do not provision another database for phase one. |

Portability in the first release means portable application code, contracts and images. It does not mean Supabase-specific schema/Auth features have already been removed.

## Proposed repository layout

```text
apps/web/                 React frontend and public-content build
apps/api/                 Hono HTTP, auth and webhook adapters
apps/worker/              Job handlers and scheduler/reconciliation entrypoint
packages/contracts/      Browser-safe schemas, OpenAPI and generated client
packages/domain/         Bookings, lessons, billing, messaging and access rules
packages/data/           Repository interfaces and Supabase implementations
packages/jobs/           Job schemas, enqueue/outbox and handler registration
infra/app/               Dockerfiles, local Compose, provider deployment config
supabase/migrations/     Existing history and additive phase-one SQL
supabase/tests/          Existing and extended database authorization tests
```

Use npm workspaces initially. Move files incrementally rather than reorganising the entire application before a working slice. Keep server packages out of browser dependency graphs. Keep one authoritative root lockfile and pinned tool versions.

## Phase 0 — baseline and migration inventory

- [ ] Inspect live inventory through authorised read-only access: deployed commits, domains, provider regions, current invoices, Supabase sizes, database version and connection limits. Treat runbooks as context, not proof of live state.
- [ ] Confirm which LiveKit environments are actually on Hetzner; older docs say production still uses Cloud. Do not include a video-server migration in this work.
- [ ] Inventory every Server Action, route handler, server-page query, browser Supabase call, public route, webhook, scheduled job and implicit provider credential.
- [ ] Map each item to its new API/domain/worker owner and track it until no required behaviour is orphaned.
- [ ] Capture baseline API/page timings, first chat token, recording-to-transcript/notes delay, background backlog and idle/peak resource usage. Set agreed performance and recovery acceptance thresholds before comparing hosts.
- [ ] Turn critical paths from [testing-plan.md](testing-plan.md) into repeatable local tests with fake users and stubbed external providers. Reproduce documented access/billing issues relevant to migrated paths; do not preserve known defects as passing expectations.

Exit: endpoint inventory, baseline measurements, test fixtures, current architecture map and a short decision record for first-release domains and backend-host candidates.

## Phase 1 — portable API vertical slice

- [ ] Add Hono, workspace boundaries, request IDs, structured logs, consistent error responses, input validation and OpenAPI/client generation.
- [ ] Add non-root container builds, configured `PORT`, bounded database connections, readiness/liveness checks and graceful termination. Expose a safe build commit/version identifier.
- [ ] Start API and worker as separate processes through local Compose. Never run production migrations automatically on every container start.
- [ ] Implement one authenticated booking read and one representative transactional mutation using the existing Supabase identity and RLS boundary.
- [ ] Render the slice in a frontend screen and exercise actual access denials, not just mocked repository calls.
- [ ] Prove pg-boss with the pinned database/version, restricted private schema, bounded pool and supported direct/session connection. Do not assume a transaction pool supports session features. Keep job tables out of the exposed Data API and prevent browser-role access.
- [ ] Manage job-library schema upgrades explicitly as reviewed release work. Do not let replicas race uncontrolled startup migrations or grant schema ownership to the general API role.
- [ ] Build once and run the exact OCI image locally and on the selected staging host. Record resource use, streaming behaviour and readiness/shutdown results.

Exit: one complete working slice, reproducible images and evidence that the job/data connection design preserves authorization. Select the backend host from whole-stack staging/production quotes and measured behaviour, not smallest advertised prices.

## Phase 2 — authentication and authorization boundary

- [ ] Implement API auth operations against Supabase: sign-in/out, session refresh, current identity, signup, verification callback and password reset.
- [ ] Prefer API-hosted Secure/HttpOnly session cookies on stable custom domains. Define exact origins, credentialed CORS, CSRF checks, callback allowlists, refresh concurrency and logout behaviour.
- [ ] Explicitly design the temporary Next/API session bridge before switching any frontend path. Existing Next pages must not lose access to required sessions during extraction; never widen cookie scope casually to make the bridge work.
- [ ] If the retained Realtime adapter needs a browser access token, specify how it is issued, refreshed, scoped and cleared. Keep refresh credentials and service secrets out of client JavaScript. Test logout and stale subscriptions.
- [ ] Verify server-side identities and booking/conversation ownership for every operation. Frontend route guards are convenience only. Do not trust client roles, sender IDs, parent links or payment state.
- [ ] Cache repeated identity work only within appropriate request/session bounds. Do not treat token signature validity as proof that a session/account has not been revoked.
- [ ] Preserve and extend RLS/Storage policy tests, including self-escalation, protected fields and linked-parent restrictions. Change policies only through additive migrations and matching tests.

Exit: signup, login, refresh, logout, reset and denial tests pass in Chromium and Safari/mobile-representative testing. No general user endpoint relies on service-role bypass.

## Phase 3 — extract application behaviour

Migrate one vertical slice per PR, with existing Next screens temporarily calling the new API through thin adapters where needed.

| Order | Capability | Required outcomes |
| --- | --- | --- |
| 1 | Catalogue, profile and dashboard reads | Screen-shaped responses, pagination, no private-data CDN caching, no browser request waterfalls. |
| 2 | Availability, requests and bookings | Transactional confirmation, overlap protection, price/trial invariants, consistent UK time handling and visible errors. |
| 3 | Messages and attachments | Server-derived sender; participant-only reads/writes; validated attachment paths/types/size; existing Realtime remains functional. |
| 4 | Lessons, consent, presence and token issuance | Participant-only room access, consent preserved, no parent/outsider token access and no credentials in bundles. |
| 5 | Recording playback and editable notes | RLS-equivalent authorization before signing, timestamp alignment, private grants, CORS and tutor-edit protection. |
| 6 | Chat and AI | Bounded history fetched at source, atomic quota reservation, scoped grounding, explicit stream disconnect/retry/persistence policy. |
| 7 | Billing, payouts and signed webhooks | Preserve provider semantics, raw-body signatures, durable acceptance and retry/idempotency behaviour; no real charges in tests. |

Keep AI SDK/model choices initially. Replace Vercel OIDC with explicit server-side Gateway/provider credentials, declared in the environment manifest. Do not change embedding models/dimensions in the same release.

Exit: all in-scope reads and mutations have API contracts and tests; Next Server Actions hold no remaining business logic; direct browser application writes are removed or recorded as a deliberate temporary exception with a removal phase.

## Phase 4 — durable background processing

- [ ] Persist signed incoming events with unique provider/event identities before acknowledging success. Preserve provider retry behaviour on persistence failure.
- [ ] Write an outbox/job intent in the same transaction as state changes where possible. A worker dispatches it to pg-boss reliably; a failed dispatch remains recoverable. Do not claim separate HTTP writes are atomic.
- [ ] Move screen-recording starts/retries out of Next `after()` into cancellable durable jobs. Preserve track uniqueness, tutor ownership, consent and cleanup/reconciliation after a successful external start but failed database update.
- [ ] Transcribe each ready audio segment once into a segment-owned result; assemble the lesson transcript deterministically, preserving channel roles, offsets and resumed-session ordering.
- [ ] Schedule summary/embedding work only when lesson/transcript readiness is satisfied. Version inputs/results, publish replacements atomically, and never overwrite newer tutor edits.
- [ ] Move daily pruning to the worker scheduler with idempotent object/metadata deletion and existing retention semantics.
- [ ] Add bounded retries/timeouts, job payload versions, concurrency limits, dead-letter visibility and a recovery reconciler for missed or abandoned work.
- [ ] Test duplicate/out-of-order events, process termination mid-job, late transcription after completion, downstream outages and replay. A queue does not make external side effects exactly-once.
- [ ] Document one scheduler/consumer ownership transition per job type and environment. Disable old Vercel cron/inline paths only when their replacement is verified; never run both accidentally.

Exit: killing/restarting the worker loses no accepted work, does not duplicate transcript segments or Egress jobs, and leaves failures observable and recoverable.

## Phase 5 — Cloudflare frontend

- [ ] Move authenticated routes to React/Vite using generated API clients and query invalidation; preserve forms, accessibility, deep links, mobile layouts, lesson player and LiveKit behaviour.
- [ ] Choose the minimal public-rendering solution that preserves catalogue/profile HTML and metadata. Define rebuild/invalidation on tutor publication, withdrawal and edits. Keep availability dynamic rather than baking bookable slots into stale HTML.
- [ ] Configure Cloudflare static delivery, SPA fallback only for app routes, real missing-page handling, immutable hashed assets and suitable HTML caching. Keep sensitive/API responses out of shared caches.
- [ ] Use stable staging/production API URLs and test custom-domain cookie flows, callbacks, signed media URLs and streams. Build environment-specific artifacts unless runtime public configuration is deliberately implemented and tested.
- [ ] Remove Next runtime dependencies from the completed static app. Do not use static-export settings as a substitute for extracting Server Actions or dynamic server behaviour.
- [ ] Test old browser tabs against the new API and define safe recovery for stale frontend assets and expired sessions.

Exit: production-like journeys run from Cloudflare against the container backend with Supabase unchanged; public-page SEO and private-route deep links work.

## Phase 6 — CI/CD, observability and cutover

Prepare pipeline changes alongside earlier phases; execute cutover only after their exit criteria pass.

```text
PR -> lint/types/contracts + API/domain/browser tests + database checks
main -> automatic staging release
manual production confirmation -> verify exact commit -> build artifacts
  -> environment parity -> history check / migration dry run -> migrate once
  -> deploy compatible API + worker -> verify digest/readiness/commit
  -> deploy frontend -> critical-flow smoke -> release tag and artifact record
```

- [ ] Keep existing required-check names or deliberately update protection so new failures cannot bypass release gates. Extend relevant CI path filters for extracted packages and SQL/job changes.
- [ ] Publish immutable OCI images to GHCR and deploy the reviewed digest. Scope registry permissions appropriately and validate reusable-workflow callers.
- [ ] Extend `config/required-env.json` and verification to cover web/API/worker configuration separately, retaining staging/production name parity without printing values. Scan the new package paths as well as `src/`.
- [ ] Replace Vercel-only parity/deploy steps with the selected provider implementation. Wait for deployment completion; accepted/queued does not mean healthy. Keep provider-specific code in deployment adapters.
- [ ] Add external uptime alerts, API errors/latency, database pool pressure, queue age/retries, stuck recordings and worker heartbeat. Redact credentials, tokens and student content from logs.
- [ ] Record schema state, frontend artifact, API/worker digest and job schema versions per release. Verify backup/recovery points and rehearse rollback on staging.
- [ ] Update custom domains, Auth redirects, R2 CORS, provider webhook destinations, health URLs and scheduler ownership. Preserve signed webhook delivery during transition, including delayed events.
- [ ] Before routing traffic, document the last compatible frontend/API/worker combination and how to drain/reassign jobs and switch webhooks back. Reconcile already accepted events; do not replay money/media effects blindly.
- [ ] Test rollback with additive schema changes and old client tabs. Database migrations do not roll back with an application image. Do not reactivate old schedulers without first fencing replacement workers.
- [ ] Keep Vercel available for a defined observation/rollback period. Retire it only after cron, Gateway auth, public pages, webhook and callback dependencies have been accounted for.
- [ ] Update README, development workflow, CI/CD, transcription and environment examples to describe the actual completed architecture. Keep this checklist current as each phase lands.

First migration is complete only when both environments use the new frontend/API/worker flow, Supabase PostgreSQL/Auth remain intact, critical tests and failure recovery pass, and the old runtime is safely retired. Record observed cost and performance against Phase 0 rather than claiming savings from the architecture alone.

## Later project — our own PostgreSQL

This means a separately operated PostgreSQL deployment, potentially self-hosted on a dedicated Hetzner database/app host; exact host and availability design are not selected. It is not an automatic move to Render's PostgreSQL service.

- [ ] Choose recovery-time/data-loss targets, operator ownership, capacity, region, patch/upgrade process and HA requirements. Keep production/staging isolated and separate from LiveKit.
- [ ] Inventory all remaining Supabase dependencies: Auth identities/FKs, JWT claims and `auth.uid()`, grants/RLS, SQL helpers, Storage objects/policies, Realtime publications and management/CLI assumptions.
- [ ] Decide explicitly whether to migrate Auth at the same later cutover or retain Supabase Auth temporarily. Keeping hosted Auth while moving data requires an application-owned identity model and cannot retain a cross-database `auth.users` FK.
- [ ] If replacing Auth, evaluate Better Auth then, rehearse identity/password migration, preserve stable IDs/mappings and deliberately reissue sessions. Validate SMTP, verification and reset flows.
- [ ] Implement portable repository adapters and least-privileged SQL roles, transaction-scoped verified user context and equivalent authorization tests. Never replace RLS with unrestricted database-owner access by accident.
- [ ] Move remaining attachments/realtime dependencies through separate tested adapters. Keep S3-compatible object keys and durable message history.
- [ ] Create a reviewed target-schema baseline/import. Preserve historical Supabase migrations unchanged; do not expect them to run against vanilla PostgreSQL without adaptation.
- [ ] Rehearse data copy, sequences, constraints, vector extensions/indexes, object references, job/outbox transfer and identity mappings; compare counts and representative authorised reads.
- [ ] Establish encrypted off-host backups, WAL/PITR if required, secret recovery, monitoring and demonstrated restores. VPS snapshots alone do not satisfy recovery acceptance.
- [ ] Cut over with a write-fencing/delta-sync plan and one active scheduler. After new writes reach the new database, a connection-string rollback alone is unsafe; document reconciliation before reopening the old writer.
- [ ] Keep Supabase until data, identities, files, late events and recovery have been verified. Retire services deliberately rather than deleting the project on cutover day.

## Optional Redis decision

Default: no application Redis in the first migration. PostgreSQL remains the permanent record and pg-boss owns durable jobs.

Evaluate Redis later for measured cache hit opportunities, high-frequency presence, distributed rate limiting or multi-replica fanout. Compare total production + staging cost, persistence requirements, memory/eviction policy, monitoring and recovery effort. It must improve an observed bottleneck or reduce net operating cost.

If selected, use an application Redis deployment isolated from LiveKit Redis. Pub/sub is not durable message history. Switching jobs to BullMQ would be its own migration with persistence and replay acceptance, not a necessary consequence of adding a cache.

## Next implementation action

Start Phase 0, then deliver the Phase 1 authenticated booking slice against disposable local Supabase. Do not begin by replacing Auth, migrating production data, provisioning our own PostgreSQL, rewriting all UI routes or introducing Redis.

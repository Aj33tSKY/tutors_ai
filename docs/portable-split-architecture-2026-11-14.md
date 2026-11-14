# Portable frontend/backend architecture assessment

Research date: 14 November 2026. This assessment addresses the revised preference for a separate frontend and a portable, containerised core backend. It supersedes the Cloudflare-native backend recommendation in the earlier hosting assessment for this objective. Research covers the local application and official framework/provider documentation, not live invoices, provider accounts or load tests. Estimates are planning allowances, excluding tax and engineering time.

**Recommended target**

Use a static React application built with Vite, a Hono API on Node, a separate Node background worker, PostgreSQL with pgvector, PostgreSQL-backed jobs, and private S3-compatible storage. Deploy frontend files to Cloudflare Workers Static Assets or Pages. Deploy backend OCI images to Render, Railway or a separate Hetzner app VPS. Keep LiveKit's independent Hetzner infrastructure.

For an initial production host, prefer Render when managed database recovery and predictable per-service sizing are the deciding factors. Railway is a close alternative when measured resource billing and its deployment workflow suit the team better. Hetzner with Docker/Coolify is the cost-control option after obtaining an available-server quote and accepting responsibility for operations. None requires a different application architecture.

This is a modular monolith with two process types, not a collection of microservices. Separate frontend/backend deployment does not require separate repositories or separate services for bookings, chat, billing and lessons.

| Layer | Proposed choice | Portability boundary |
| --- | --- | --- |
| Authenticated application | React + Vite + React Router + TanStack Query | Ordinary HTML/JS/CSS build output; any static host |
| Public marketing and tutor discovery | Initially retain existing Next frontend while extracting the API; final static/prerendered pages, optionally Astro if justified | Build-time generation and explicit refresh policy; do not sacrifice tutor-profile SEO |
| Core API | Hono on current supported Node LTS, pinned image; begin by retaining Node 24 compatibility | HTTP/JSON, OpenAPI and SSE; standard container |
| Domain logic | TypeScript services for bookings, billing, lessons, messages and identity | No Next, Hono-context or hosting bindings inside business functions |
| Database | PostgreSQL + pgvector + pg_trgm | SQL migrations, standard driver, controlled extension versions |
| Data access | Drizzle + node-postgres, with SQL for transactions and specialised queries | SQL remains the source of truth; ORM not the security boundary |
| Authentication | Supabase Auth during extraction; Better Auth candidate for final independent stack | Backend-owned sessions and explicit identity mapping |
| Background work | pg-boss in a separate worker process | Same PostgreSQL; no Cloudflare Workflows or proprietary queue dependency |
| Realtime | API writes plus SSE updates and durable message history | Standard HTTP streaming; notifications are wake-up signals, not durable storage |
| Files | Existing R2 through S3 API; move homework attachments later | Provider-neutral object keys and short-lived signed URLs |
| Video | Existing LiveKit on Hetzner | Preserve separate deployment, capacity and active-call safeguards |

**Hono, Fastify or Express?**

Hono is the recommended starting point here. Its Web Request/Response model maps well to existing route-handler code, and official Node support means no need to make the backend run in an edge runtime. It also provides streaming helpers for SSE and AI responses. [Hono on Node](https://hono.dev/docs/getting-started/nodejs), [streaming](https://hono.dev/docs/helpers/streaming).

Fastify is equally credible if a more structured Node server ecosystem, plugins, schema validation and lifecycle hooks appeal more. Express is usable but would need more conventions assembled by the project. There is no measured basis for claiming a framework benchmark will materially improve this app: database access, external APIs, transaction design and response payloads are more important. [Fastify documentation](https://fastify.dev/docs/latest/).

Choose Hono for fit and simplicity, not a claimed latency advantage. Share Zod request schemas and a generated API client, while publishing OpenAPI so consumers are not tied to Hono's TypeScript RPC inference. Keep API implementations separate from request/response schema packages to avoid pulling backend code or secrets into browser bundles.

**What actually changes in this repository**

The inspected app has 25 page components, eight route handlers and thirteen TypeScript files declaring Server Actions. Existing React components, Tailwind styles, LiveKit UI and lesson playback logic are reusable, but its server/client boundary changes substantially:

| Current implementation | Replacement |
| --- | --- |
| Server Components querying Supabase | API response endpoints and frontend queries |
| Next Server Actions | Validated HTTP mutations calling domain services |
| `src/proxy.ts` refreshing auth and redirecting | Backend session validation; frontend navigation guards provide UX only |
| `revalidatePath` | Frontend query invalidation; explicit public-content invalidation/rebuild |
| Browser inserts messages directly into Supabase | Authenticated message endpoint; persistent history and SSE updates |
| Supabase Storage uploads and signed attachment URLs | Backend-authorised upload grants, verification/finalisation and read URLs |
| Next webhook route handlers | Hono handlers preserving raw-body signature verification |
| Vercel cron / `after()` jobs | Durable database jobs and separately running worker |
| Server page minting a LiveKit token | Participant-authorised token endpoint; do not expose the API secret |

Introduce screen-shaped read endpoints where they improve efficiency: for example one booking-review response containing authorised booking, notes and playback grants. Avoid replacing every server query with a separate browser request. Parallelise independent reads and paginate large data sets.

**Frontend: static hosting is appropriate after extraction**

Cloudflare Pages is viable; for a new deployment prefer Workers Static Assets, which Cloudflare's own skills guidance recommends for new static sites and SPAs. Requests served directly as static assets are free and unlimited; invoking a Worker script is a separate billing path. The core application still builds to static files and can move to another CDN or Nginx without a rewrite. [Cloudflare guidance](https://github.com/cloudflare/skills/blob/main/skills/cloudflare/references/static-assets/README.md), [asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Vite deployment](https://vite.dev/guide/static-deploy.html).

A Vite SPA suits private dashboards and the live lesson room. Public tutor profiles need crawlable HTML and share metadata. Preserve that using prerendering with a defined refresh trigger, or retain a small SSR public frontend if up-to-date discovery requires it. Merely enabling Next static export cannot preserve the current runtime Server Actions, cookie reads and database-backed dynamic pages; the installed Next static-export guide confirms those architectural constraints.

Do not automatically introduce an Astro marketing app and a Vite dashboard at the same time. Existing Next public pages can call the extracted API during the transition. Once the API boundary works, choose whether one prerendered frontend is enough or a separate marketing build earns its maintenance cost.

Recommended domains: `www.<domain>` for public pages, `app.<domain>` for the dashboard, and `api.<domain>` for the backend. Alternatively use a small replaceable same-origin proxy for `/api`. Either arrangement needs end-to-end cookie and streaming tests, especially on Safari/mobile. A private frontend is a public downloadable bundle; all real authorization belongs in the API and database.

**Authentication and authorisation are the hardest migration**

First extract backend endpoints while keeping Supabase Auth and existing UUIDs. Each request has a verified identity and explicit resource access checks. Do not use admin/service credentials as a general replacement for user-scoped queries.

For the final portable stack, evaluate Better Auth hosted in the API with database-backed sessions. Its Hono integration is direct. Use Secure, HttpOnly cookies, preferably host-only on the API host; an app on another subdomain can call it with credentials without sharing the cookie across every subdomain. Configure exact allowed origins, credentialed CORS, trusted origins and CSRF protection for mutations. Do not depend on unrelated `pages.dev` and provider API domains for production cookie behaviour. [Better Auth Hono integration](https://better-auth.com/docs/integrations/hono), [cookies](https://better-auth.com/docs/concepts/cookies).

There is an official Supabase-to-Better-Auth migration guide, including bcrypt compatibility for existing passwords. It is a starting point, not proof that this application's identities, roles, reset links or sessions will migrate unchanged. Preserve identifiers or create a permanent mapping, rehearse exports, reissue sessions deliberately, and test verification/reset flows and SMTP. Never grant admin through client-supplied signup metadata. [Migration guide](https://better-auth.com/docs/guides/supabase-migration-guide).

Existing schema includes `profiles.id -> auth.users`, many `auth.uid()` policies, Storage policies and a `supabase_realtime` publication. These do not become ordinary PostgreSQL application semantics by changing a connection string. Retain current protections during extraction. For an independent schema, introduce a backend-owned identity context and portable RLS where practical: use a least-privileged non-owner role, transaction-local verified user context on the same connection, and participant/parent checks. Do not accidentally reuse context through connection pools. Any privileged worker access must be separately scoped. Test outsider access, self-escalation and protected-field writes as well as successful paths.

An alternative is application-only authorisation with rigorous tests, but silently removing RLS while routing everything through a powerful connection would weaken the current design. Treat the authority model as an explicit migration deliverable.

**Jobs, messages and storage without proprietary services**

pg-boss is a good initial fit because PostgreSQL is required anyway. It supports transactional enqueueing, delayed jobs, retries, schedules and dead-letter handling. Current requirements are Node 22.12+ and PostgreSQL 13+, compatible with the intended platform after version validation. Isolate its maintenance schema and permissions, include its migrations in release planning and limit concurrency. It is a maintained open-source dependency with its own upgrade risk, not a zero-maintenance primitive. [pg-boss](https://github.com/timgit/pg-boss).

Run API and jobs as separate processes, usually the same image with different commands. This isolates model/transcript work from HTTP serving and permits independent scaling. Both can share a VPS initially without sharing a process. Use transactional jobs or an outbox so persisting an event and dispatching work cannot diverge. Still require idempotency/reconciliation around external calls: successful Egress followed by a failed database update is not made exactly-once by the queue.

Keep the prior lesson-processing improvements: one transcript result per recording segment, versioned transcript/summary/embedding results, conditional publication preserving tutor edits, durable recording-start retries and a recovery reconciler. Avoid sleeping inside API requests or assuming an always-on process cannot crash.

Replace Supabase Realtime initially with authenticated SSE for incoming messages/status and normal POST requests for writes. Store messages/events durably and resume using a cursor after reconnect. For multiple API replicas, PostgreSQL LISTEN/NOTIFY can wake subscribers, but dropped notifications must be recovered from persisted state; it is not a message store. Pin a suitable connection for LISTEN. Add Redis/pub-sub only after measuring a real fanout or throughput need. Existing in-call LiveKit data messaging can remain separate.

Keep R2 with the S3 SDK. Add an object-store abstraction with endpoint, bucket and region configuration; keep object keys, not provider URLs, in records. Homework attachments need upload size/type/path checks and finalisation, not just a signed PUT URL. Preserve private access and recording CORS. Moving to another S3-compatible store still requires copying objects and changing endpoints; interoperability reduces code changes, not migration bandwidth or time.

**Hosting comparison and costs**

| Host | Strength for this project | Material tradeoff | Verdict |
| --- | --- | --- | --- |
| Render | Prebuilt Docker services, separate workers, private networking, managed PostgreSQL and documented recovery | Per-service floors; replicas, staging, larger DB and HA add cost | Preferred managed starting point if the quote fits |
| Railway | Same container architecture, fast service/environment setup, resource billing | Full bill depends on memory/CPU of every service; basic Postgres and managed HA have different guarantees | Close alternative; benchmark representative load |
| Hetzner + Docker/Coolify | Explicit capacity and control; several modest processes can share a host | You own patching, recovery, capacity and host failures; cheap instance stock uncertain | Best cost-control candidate when operating servers is acceptable |

Render accepts prebuilt images for web, private, worker and cron services. Paid Postgres has continuous backups; documented PITR windows are three days on Hobby and seven on Pro or above. Render's HA requires at least one CPU and bills a separate same-size standby. Small paid Postgres is therefore not HA. Verify pgvector and pg_trgm on the selected database version; Render publishes an extension matrix. [Images](https://render.com/docs/deploying-an-image), [backups](https://render.com/docs/postgresql-backups), [HA](https://render.com/docs/postgresql-high-availability), [extensions](https://render.com/docs/postgresql-extensions).

Render's indexed public pricing shows $7/month for 0.5 CPU/512 MB compute and $6/month for 256 MB Postgres. An API + worker + tiny DB has an illustrative $20/month compute floor before storage, workspace fees, bandwidth and staging. This is a floor, not a recommended production size or orderable quote: the live pricing page did not expose the numeric table to the reader, and 256 MB is especially tight for vectors plus background-job traffic. Allow approximately $30–60/month for a small non-HA production stack as an initial budgeting range, then add a separately sized staging environment and verify an actual quote. Render updated compute-plan names in August 2026; do not copy legacy identifiers blindly. [Pricing](https://render.com/pricing), [compute plans](https://render.com/docs/compute-plans).

Railway Pro has a $20/month minimum including $20 of resource usage. Public rates are $0.00000386/GB-second RAM, $0.00000772/vCPU-second CPU, $0.00000006/GB-second volume and $0.05/GB service egress. For an illustrative 30-day month, 1.5 GB average total memory across API/worker/database costs about $15.01; 0.1 average CPU adds about $2; 10 GB volume adds about $1.56, before egress and backups. That is near the Pro floor, not proof those capacities fit this workload. Double average memory and cost changes materially. Budget approximately $25–60/month for a modest non-HA production deployment as a hypothesis to measure, plus staging. Do not add the $20 minimum on top of included resource usage. [Railway pricing](https://railway.com/pricing).

Railway supports deploying standard container images. Its basic Postgres service is deployed from a Postgres image; current documentation also offers managed HA conversion with automatic failover. That HA option introduces database replicas, consensus nodes and routing capacity; quote it separately and verify pgvector image compatibility. The HA documentation explicitly says Railway does not publish an uptime SLA today, so pricing-page availability targets should not be treated as contractual database guarantees. [Services](https://docs.railway.com/services), [Postgres](https://docs.railway.com/databases/postgresql), [HA](https://docs.railway.com/databases/postgresql-ha).

On Hetzner, start by quoting an available 4–8 GB app host for API + worker while retaining managed Postgres. This capacity is an initial test range, not a measured requirement. A fully self-hosted API + worker + database usually needs additional headroom and a deliberate backup/recovery design. The public cost-optimised page currently marks the cheapest plans unavailable; do not promise the old single-digit VPS price. Keep app/database services off the existing LiveKit server. Coolify is optional deployment tooling, not automatic HA or a database recovery service. [Hetzner stock](https://www.hetzner.com/cloud/cost-optimized/).

All ranges exclude LiveKit, R2, SMTP, inference, transcription, taxes, monitoring extras, HA and migration overlap. Separating the application can lower runtime expense, but adding managed API, worker and database services can also match or exceed the earlier illustrative $55/month Vercel + Supabase baseline once staging is counted. This project's strongest case is control and portability; actual bill reduction remains to be demonstrated.

**Performance expectations**

Keep API, job workers and database in the same region/private network when possible. Browser -> API -> colocated SQL avoids long-distance server/database request chains. Combine reads, index actual access patterns, cache only public catalogue data, and keep audio/video direct between browser/LiveKit/R2. Do not route recordings through the backend.

A SPA introduces JavaScript startup and can introduce browser request waterfalls. It is not intrinsically faster than Server Components. Measure dashboard interactivity, API p95, first chat token, booking mutation duration and recording-to-notes time before/after. Bound database pools across API and worker replicas, use database-backed atomic chat limits and quota reservations, and keep expensive transcript work off serving processes. Native Hono SSE can support streaming, but test the full proxy path and shutdown behaviour.

**Keep CI/CD portable**

Retain a monorepo and the single `main` branch. Suggested boundaries are `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/domain`, `packages/db` and `infra`. Start with npm workspaces; a larger build orchestrator is optional.

PR checks cover API/domain tests, frontend type/build checks, OpenAPI compatibility, authorisation and database migrations, and critical browser flows. Build immutable backend images in GitHub Actions and publish to GHCR, then deploy the exact image digest. Test the same image with local Compose and at least one alternative host before claiming portability.

Release order: verify -> build frontend/backend artifacts -> migration dry run/history gate -> apply additive migrations -> deploy compatible API and workers -> readiness and commit checks -> deploy frontend -> end-to-end smoke -> release tag. Preserve manually confirmed production and automatic staging, environment parity and reusable-workflow permissions. A deployment API returning accepted/queued is not success.

Frontends cached in browsers may use an older API after deployment. Keep additive response changes, API versioning where necessary, and overlap support. API rollback must stay compatible with already-published frontend bundles. Version job payloads too: a worker rollback may consume jobs created by a newer API. Do not depend on a perfectly atomic frontend/backend switch.

Existing migration history stays immutable. If leaving Supabase, rehearse a new target-schema baseline/import while retaining the historical SQL; do not pretend Supabase-specific historical migrations can execute on vanilla Postgres unchanged. Preserve and adapt the authorisation-test cases. Database migration runs once as a release job, never independently in every API container.

**Recommended migration sequence**

1. Establish a portable vertical slice: Dockerised Hono, a real database transaction, generated client, local Compose, readiness/health and one frontend screen. Deploy identical images to the managed candidate and a disposable VPS. Benchmark latency and observe idle memory.
2. Extract API ownership while existing Next UI and Supabase Auth remain: bookings, messaging, LiveKit tokens, webhook handling and private file grants. Add explicit resource-authorisation tests. Keep existing SQL protections through the transition.
3. Move background work to pg-boss/worker, with durable events, idempotent segment processing, retry recovery and monitoring. Stop the previous schedulers only after a controlled handover.
4. Move the authenticated UI to Vite and public content to the chosen prerendering/SSR arrangement. Validate deep links, reset links, cookie/CORS/CSRF behaviour, old frontend compatibility and streamed chat recovery.
5. Complete Supabase exit if desired: Better Auth, identity mapping, application-owned RLS/context, attachment migration, realtime replacement and ordinary PostgreSQL baseline. Rehearse copy/validation/cutover and a write-aware rollback plan before production.
6. Choose the host from measured whole-stack cost and recovery behaviour. Run restore and host-failure drills; verify the alternative deployment target actually works.

The first vertical slice should establish compatibility and operating measurements before a whole-project estimate. This is a broader application/backend migration than the earlier 2–4 engineer-week OpenNext proposal. A sensible initial planning allowance for the complete split and Supabase exit is roughly 4–8+ engineer-weeks, highly dependent on the existing data, auth migration and required test/recovery coverage; refine it after the slice rather than treat it as a delivery commitment.

The intended end state is one reusable frontend artifact, standard API/worker images, ordinary PostgreSQL data, and S3-compatible objects. Hosting-provider adapters should handle deployment only. That provides a meaningful exit path without paying the complexity cost of making every component interchangeable on day one.

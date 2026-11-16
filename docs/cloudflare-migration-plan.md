# Cloudflare migration plan

Status: **approved 16 November 2026.** Step 1 (spike) is complete; step 2 (refactor) is next. Nothing on the live
staging or production sites has changed yet.

Evidence for every claim below is in `docs/cloudflare-spike.md` on draft PR #69 (branch `spike/cloudflare-workers`),
which also holds the spike code (`apps/edge/`). Read it before changing any of the decisions here.

## Decision

Run the **web app, the API and all background work in one Cloudflare Worker** on the Workers Paid plan.

| Component | Target |
| --- | --- |
| Static frontend (Vite build, prerendered pages) | Worker static assets, with a `_headers` file for the security headers |
| Hono API | The same Worker (`apps/edge`), unchanged business code |
| Background jobs | The same Worker: a Cron Trigger and a Cloudflare Queue (see below) |
| PostgreSQL and Auth | Supabase, unchanged. Production needs a paid plan |
| Recordings and attachments | Cloudflare R2, unchanged |
| Video | Self-hosted LiveKit on Hetzner, unchanged |

**Retired by this plan:** the Oracle VPS host and its deploy workflow, the Docker runtime and web images, Caddy, the
Node worker process, pg-boss and its `app_jobs` schema, and Vercel.

### Why (bake-off, 15-16 November)

Same code, same staging database, measured against Vercel (Hobby, London) and the Oracle VPS:

- Latency and throughput: equal or better on the Worker (soak p50 90 ms vs 114 ms Vercel and 94 ms VPS); zero errors
  across ramp, burst and soak on all three hosts.
- Streaming chat: first text p50 819 ms on the Worker, 918 ms on Vercel, 1,142 ms on the VPS.
- Cost: about $5-11 a month for Workers Paid at expected volume, against $20+ for Vercel Pro (Hobby is non-commercial)
  and about $24 for a Hetzner app server.
- Operations: no servers, no containers, one deploy target.
- Weakness: the first request after 10-30 minutes idle took 0.7-1.7 s (one sample per cell), against 0.25-0.46 s
  on the always-on VPS.

The reliability ceiling in every test was the **Free Supabase project**, which stalled under sustained load whichever
host was in front of it.

## How background work runs

The job state already lives in the database (claim, publish and release functions with leases and attempt counts),
so duplicate or overlapping runs are safe and the triggers can stay simple. pg-boss only dispatched work.

| Job | Today (Node worker) | Target |
| --- | --- | --- |
| Stripe and LiveKit events | Inbox polled every 5 s | Applied straight after the webhook is stored (`waitUntil`); a 1-minute Cron sweep retries failures |
| Recording reconciler | Every 30 s | 1-minute Cron run (a safety net; the webhook path is primary) |
| Transcription | Discovery every 20 s, pg-boss queue | Cron finds candidates and enqueues; a Queue consumer calls Deepgram (up to 15 min per message) |
| AI summaries | Same as transcription | Same Queue pattern |
| Recording retention | pg-boss job | R2 lifecycle rule deletes the files; a daily Cron run marks rows expired |
| Heartbeat and health server | Custom | Removed; backlog age in `/health/ready` plus an external uptime monitor |

The job logic stays as plain functions over the database in `packages/jobs`; only the triggers are Cloudflare-specific.
Leaving Cloudflare later means writing a small Node runner, not redesigning the jobs.

## Constraints the design must respect

Each of these was measured; none is visible from reading the code.

- **No sockets shared across requests.** A module-level `pg` Pool fails on a later request (error 1101). Open one
  connection per request or job and close it.
- **Use the transaction pooler (port 6543).** Session mode rejected 85 of 100 simultaneous clients; transaction mode served
  all 100. The Free plan allows 60 Postgres connections in total, and a test reached 56.
- **Supabase's pooler ignores the connection-level `statement_timeout`** (both modes). Set timeouts on the database roles.
- **Supabase Auth limits sign-ins and refreshes per IP** (staging: 30 sign-ins, 150 refreshes per 5 minutes). The API
  calls Auth from the server, so users share its IP.
- **CPU:** chat turns use 87-251 ms. The Free plan's 10 ms limit is not viable; Workers Paid is required.
- **A client disconnect cancels the request.** Work that must finish (saving a chat reply) is registered with
  `executionCtx.waitUntil`, which allows about 30 s; longer work belongs in a Queue job.
- **Cron Triggers and Queues need an account `workers.dev` subdomain** (registered: `hybridtutors.workers.dev`; the Worker
  is not served on it). New schedules took about 11 minutes to start (Cloudflare documents up to 15).

## Phases and exit criteria

### A. Prerequisites (before real traffic on Workers)

- [ ] Auth IP forwarding: enable it in Supabase and send `Sb-Forwarded-For: <CF-Connecting-IP>` from a dedicated
      auth-only client using a secret key. A test must prove that client never runs data queries: without a user token a
      secret key acts as service_role and bypasses RLS.
- [ ] Statement timeouts set on the `tutors_events` and `tutors_worker` roles in the release grant step, verified through the
      pooler.
- [ ] Workers Paid plan on the Cloudflare account.
- [ ] Custom SMTP for Supabase Auth (the built-in sender is heavily rate-limited).
- [ ] A paid Supabase plan (and compute size) chosen for production.

### B. Refactor (step 2, code only)

- [ ] Promote `apps/edge` from spike to production: delete the `/spike/*` routes and `spike-jobs.ts`, keep the
      headers, 405 guard, error catch-all and `waitUntil` wiring.
- [ ] Scheduled and Queue handlers calling the existing job functions; remove pg-boss, `apps/worker`, `queue.ts` and the
      `app_jobs` migration step (keep the role grants).
- [ ] Webhook fast path: apply provider events immediately after acceptance, inbox kept for durability and retries.
- [ ] R2 lifecycle rule for recording expiry.
- [ ] Worker-runtime tests in CI (wrangler/workerd), so cross-request I/O and Node-only library calls are caught.
- [ ] A deploy workflow: CI, then migrations, then `wrangler deploy`, with `wrangler rollback` documented.
- [ ] Exit: all existing suites pass, plus Worker-runtime tests; one LiveKit egress *start* exercised in a real test call.

### C. Staged cutover on staging (step 3, needs approval)

- [ ] Deploy the Worker to the staging hostname. Run the new job path alongside the existing VPS worker (claims make both safe),
      then stop the VPS worker.
- [ ] Switch the Stripe and LiveKit staging webhook URLs one at a time. Never run two receivers of one webhook.
- [ ] Observe for several days: backlog, errors, CPU, cold start; acceptance runs for sign-up/email, a real call with
      recording and summary, chat, and a Stripe sandbox invoice.
- [ ] Exit: an agreed observation window with no unexplained failures.

### D. Production

- [ ] Production Supabase plan and secrets; production hostname and DNS; webhook switches; observe; keep the previous
      path available until the rollback window closes.

### E. Retire (step 4)

- [ ] Delete the worker code, Docker images, Caddy, `deploy-vps.yml`, the Oracle VMs and the Vercel workflows and projects.

## Rollback

Until phase E, the previous path stays deployable. Worker versions roll back with `wrangler rollback`; database
migrations are forward-only, so keep them backward-compatible across one release.

## Cost (list prices, estimates)

Workers Paid $5 a month plus usage (about $5-6 more at 40,000 chat turns a day), a paid Supabase plan, Hetzner LiveKit
unchanged. Queues and Cron Triggers are included at this volume.

## Open decisions

- Production Supabase plan and compute size (connection limits rise only with compute size).
- Production hostname, and when to delete the Oracle staging VM (after phase C).
- Deepgram callback mode (no waiting) or the current synchronous call inside a Queue job.

## Temporary resources to remove

The spike Worker `tutors-edge-spike` and its `cf-staging.hybridtutors.co.uk` DNS record, the queue `tutors-jobs-spike`, the
throwaway Vercel project `tutors-vercel-spike`, and the staging test student `cf-test-student@demo.kindling.app`. The OpenAI key
was placed on the spike Worker and the Vercel project; consider rotating it afterwards.

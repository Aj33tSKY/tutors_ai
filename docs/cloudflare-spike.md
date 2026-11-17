# Cloudflare Workers spike (local results)

Goal: decide whether the whole app (static frontend plus the Hono API) can run as one Cloudflare Worker, as one
candidate in the hosting bake-off against Google Cloud Run. Code: `apps/edge/`. Nothing here is deployed.

## Result so far (workerd, local, against the staging Supabase project)

| Check | Result |
| --- | --- |
| Worker script size | 4.7 MB raw, **833 KB gzip** (limits are on gzip: 3 MB Free, 10 MB Paid) |
| Start-up | about 126 ms active CPU locally (hard limit 1 s) |
| Health, public catalogue (live Supabase over HTTP), auth errors, CORS, cross-origin refusal | Pass |
| Static shell, SPA fallback, real 404 for missing files | Pass (after a Worker-side fallback; Caddy's behaviour reproduced) |
| Postgres over TCP (`pg`, restricted `tutors_events` role via the pooler) | **Pass**, 376 ms including connect and TLS |
| LiveKit webhook signature (valid accepted, bad rejected) | Pass |
| Stripe webhook signature | **Failed, then fixed.** Synchronous `constructEvent` cannot run on Workers. Switched to `constructEventAsync`, which works on Node and Workers |

## Deployed results (2026-11-15, `cf-staging.hybridtutors.co.uk`, staging Supabase, London client)

- Start-up reported by Cloudflare: 130 ms.
- Worker CPU time per request (Cloudflare's own tail report, 25 requests each): `/health/ready` median 3 ms (max 34 ms, probably the first
  request), `/v1/public/tutors` median 4 ms (max 15 ms). No request failed. The Free plan allows 10 ms, so the maximums
  exceed it; heavier routes (authenticated reads, chat) are not yet measured.
- Time to first byte, 25 requests, from a London client (Worker vs the Oracle staging VPS): `/health/ready` p50 108 vs 105 ms,
  `/v1/public/tutors` p50 102 vs 89 ms, `/` (static) p50 65 vs 35 ms. Roughly equal for API calls; static is slower on the Worker in this sample.

## Round 2 (authenticated, streaming, headers, load)

Test account: a pre-confirmed staging student created with the Supabase admin API (generated password kept in
`~/.tutors-backups/cf-test/`, not in the repo). Delete it when the bake-off ends.

- **Authenticated flows work on the Worker**: sign-in, HttpOnly session cookie, `/v1/auth/me`, `/v1/calendar`, `/v1/contacts`,
  `/v1/student/chat/conversations`, `/v1/student/billing`. Latency within about 10-15% of the VPS (medians 90-124 ms vs 79-126 ms).
- **CPU on real Cloudflare for those routes** (24 sampled requests): median 5-6 ms, sign-in 10 ms, max 21 ms; 4% were over the Free
  plan's 10 ms and none failed. Borderline on Free, comfortable on Paid.
- **Streaming**: a 20-chunk SSE stream arrived incrementally (about 251 ms gaps) and cost 6 ms CPU for 5 s wall time. A client disconnect
  is observable: the request is reported `canceled` and the stream's `cancel()` runs, so the chat allowance can be settled on disconnect.
- **Postgres over TCP on real Cloudflare**: 190 ms including connect.
- **Headers**: static files are served without running the Worker, so they need `apps/edge/_headers` (built into `.assets/` by
  `npm run build:edge-assets`). With it, static files, hashed assets (immutable), the SPA fallback and real 404s match the Caddy server.
- **Load** (10 concurrent clients, 20 s, one machine, London): no errors on either host.

  | Route | Worker rps / p50 / p95 / p99 | Oracle VPS rps / p50 / p95 / p99 |
  | --- | --- | --- |
  | `/health/ready` | 194 / 43 / 83 / 284 ms | 130 / 68 / 127 / 191 ms |
  | `/v1/public/tutors` | 200 / 42 / 73 / 266 ms | 222 / 41 / 65 / 94 ms |
  | `/v1/auth/me` (signed in) | 130 / 70 / 105 / 298 ms | 121 / 76 / 131 / 189 ms |

  Worker medians and p95 are equal or better; its p99 is worse (about 270-300 ms vs 94-190 ms). One client machine may limit these rps figures.

## Round 3: three-way comparison (Worker vs Vercel vs Oracle VPS), 2026-11-16

Same API code on all three, same staging Supabase project, same test account, London client. Vercel: Node function in `lhr1`
(Hobby plan, throwaway project outside this repo). Vercel's first deploy ran its build in Washington but the function ran in London.

| Test | Worker (Cloudflare Free) | Vercel (Hobby, lhr1) | Oracle VPS (2 OCPU) |
| --- | --- | --- | --- |
| Ramp 5 to 50 clients, mixed routes, errors | 0 | 0 | 0 |
| Throughput at 50 clients | 318 rps | 312 rps | 259 rps |
| p50 at 25 clients | 98 ms | 119 ms | 110 ms |
| Burst: 3 x 300 simultaneous, success | 900/900 | 900/900 | 900/900 |
| Burst wall time per 300 | 1.8-2.3 s | 1.6-1.7 s | 2.4 s |
| Soak 20 min, 10 rps, healthy minutes: p50 / p95 / p99 | 90 / 158 / 229 ms | 114 / 216 / 338 ms | 94 / 176 / 243 ms |
| Soak: drift first 5 vs last 5 min (p50) | 87 -> 92 | 111 -> 121 | 91 -> 96 |
| Soak: errors in healthy minutes | 0 of 10,128 | 0 of 10,130 | 0 of 10,127 |

**The soak had three bad minutes (11, 19, 20) that hit all three hosts at the same instant**, with p99 of 12-26 s and about 300 request
timeouts each in minute 20. The cause is the shared dependency: during and after the stall, direct calls to the staging Supabase
project took 1-20 s and its Database report showed "Memory commitment: SEVERE" (1.35 GB committed against about 936 MB RAM) with swap in
use. It recovered within minutes. So the ceiling in these tests is the Free Supabase project, not any host, and no hosting choice fixes it.

Cloudflare's own aggregate figures for the Worker over about 23,000 invocations: CPU P50 2.4 ms, P90 5.0 ms, P99 8.9 ms, P99.9 14.7 ms;
"Exceeded CPU Time Limits": 0. Free plan limits: 100,000 requests a day, 10 ms CPU.

An internet scanner (`l9scan`) found the new hostname within hours and POSTed to GraphQL paths. That exposed a real bug: static paths
passed POSTs to the asset handler, which threw uncaught exceptions (30 of them). Fixed: non-GET/HEAD on static paths returns 405, and
a catch-all turns any unexpected failure into a logged 500.

The first soak attempt was invalid because the laptop slept mid-test (72-minute gap). The rerun used `caffeinate`.

### Rough monthly cost (list prices, estimates, not measured bills)
- Cloudflare Workers Paid: $5 flat covers 10M requests and 30M CPU-ms (about 6M requests at 5 ms). About $41 at 100M requests.
- Vercel Pro: $20 per seat per month with $20 of usage credit; Hobby is non-commercial only. Roughly $140-180 at 100M requests.
- Oracle free VPS: $0 now; capped at 2 OCPU / 12 GB and reclaimable when idle. Hetzner CPX22 about $24.

## Round 4: cold start and real chat (2026-11-16)

**Cold start** (6 signed-in requests per host after 10 and after 30 minutes with no traffic; one sample per cell, so noisy):

| Host | After 10 min: first / next five | After 30 min: first / next five |
| --- | --- | --- |
| Cloudflare Worker | 687 ms / 136-213 ms | 1,673 ms / 91-185 ms |
| Vercel (lhr1) | 1,229 ms / 251-425 ms | 1,110 ms / 133-204 ms |
| Oracle VPS | 461 ms / 128-311 ms | 253 ms / 141-232 ms |

The VPS keeps warm connections to Supabase, so its first request is only slightly slower. The Worker and Vercel pay roughly 0.5-1.5 s on the
first request after a quiet spell (likely fresh TLS connections to Supabase from a new isolate or instance, not start-up, which is 59-130 ms).

**Real chat** (`gpt-5.4-nano`, replies capped at 600 tokens, one test student, 36 model calls in total, allowance accounting verified
exact in the database: 36 sent, 36 used):

| Host | 18 sequential turns: errors | first text p50 (range) | total p50 |
| --- | --- | --- | --- |
| Cloudflare Worker | 0 | 819 ms (690-3,098) | 1,763 ms |
| Vercel | 0 | 918 ms (716-1,594) | 1,887 ms |
| Oracle VPS | 0 | 1,142 ms (791-1,487) | 1,881 ms |

Five simultaneous chats: all 5 completed on both the Worker and the VPS (wall 4.4 s vs 2.6 s; the Worker's slowest first text was 3.4 s).

**Defect found and fixed: a client disconnect lost the assistant's reply on Workers.** On Node (VPS, Vercel) the model keeps generating after the
client leaves and the reply is saved (`result.consumeStream()`). Cloudflare cancels the request, so only the student's message was saved while
the allowance was spent. `chatTurn` now takes an optional `keepAlive` hook; the API registers the work with `executionCtx.waitUntil`, which is a
no-op on Node. Re-tested twice on the Worker: the transcript now holds `user` and `assistant`.

## Round 5: database connections from Workers (2026-11-16)

Where the Worker touches Postgres: **almost everything goes over HTTPS** (supabase-js to PostgREST and Auth, so Supabase pools server-side and
isolates never become Postgres connections). The **one direct TCP path is webhook intake** (`eventIntake`, role `tutors_events`).

Measured from the deployed Worker, 100 simultaneous requests each holding a connection for 0.4 s (Supabase Free / Nano, eu-west-1):

| Pooler | Succeeded | Failed | Peak Postgres backends for the role |
| --- | --- | --- | --- |
| Session mode, port 5432 (what intake used) | 15 | 85, `EMAXCONNSESSION max clients reached in session mode` | 15 |
| Transaction mode, port 6543 | 100 | 0 | 31 (the two pools share the database) |

Total backends peaked at 56 of the Free plan's 60. The pooler caps real connections, so Postgres is protected, but session mode fails closed
beyond the pool size (15) and transaction mode queues up to the client limit (200 on Nano).

**Defect found and fixed:** a module-level pool (what `eventIntake` did) is reused across requests, which Workers forbid. Measured: 5 sequential
requests gave success, success, **error 1101**, success, success. `eventIntake` now opens and closes one connection per event on Workers
(detected by `navigator.userAgent`), keeps one pool on Node, and the Worker's secret points at port 6543. Unit tests cover both modes.

Other findings: Supabase is in eu-west-1 (Ireland); the project signs tokens with ES256, so `auth.getClaims()` can verify sessions locally with no
Auth round trip.

## Review (2026-11-16): corrections and new findings

1. **Correction: CPU.** The "P99 8.9 ms, fits Free" figure covered cheap routes only. Measured on the Worker: chat turn 87-251 ms CPU,
   conversation create 63 ms, sign-in 21 ms. Cloudflare served them, but Free promises 10 ms; **Workers Paid is required**. At 250 ms per turn,
   40,000 turns a day is about 300M CPU-ms a month, roughly $5-6 on top of the $5 base.
2. **New: Supabase Auth limits by IP, and our API calls Auth from the server.** Staging allows 30 sign-ins or sign-ups and 150 token refreshes per
   5 minutes **per IP**. Behind a VPS that is the whole site's budget; behind Workers the egress IPs vary, which is not a guarantee. Fix: enable
   Auth "IP address forwarding" and send `Sb-Forwarded-For: <CF-Connecting-IP>` from a dedicated **auth-only** client that uses a secret key. The
   secret key must never be used for data queries: without a user token it acts as service_role and bypasses RLS.
3. **New: Supabase's pooler ignores the connection-level `statement_timeout`** in both modes. Server reported `2min`; a 6 s query was not
   cut off with the option set to 5 s. This also means the VPS worker's 30 s timeout has never applied. Fix: set it on the database roles
   (`alter role ... set statement_timeout`) in the release grant step, then re-verify through the pooler.
4. **Security, fixed:** the spike Worker was serving `/spike/pg?sleep=&port=` publicly, which let anyone hold database connections. Disabled
   (`SPIKE=0`); the routes must be deleted before any real deploy.
5. **Gap: background work.** pg-boss needs a long-running process and session-mode connections; it cannot run on Workers. The move covers web and
   API only. Either keep a small worker host or rebuild jobs on Cron Triggers and Queues (the "process due work" design).
6. **Weak evidence to treat with care:** one client machine in London; ramp only to 50 clients; cold start has one sample per cell; the soak stall
   was blamed on Supabase memory by correlation, not proof; chat CPU has three samples.

## Round 6: background-job building blocks on Workers (2026-11-16)

Scheduled trigger (every minute, 6 runs) plus a Cloudflare Queue, in the spike Worker, read-only against staging data. Code: `apps/edge/src/spike-jobs.ts`.

| Building block | Result |
| --- | --- |
| Database as `tutors_worker` via the transaction pooler, per-invocation connection | Works; candidate queries run (0 pending of each kind) |
| Stripe test-mode call with the app's default client | Works; no fetch-client change needed |
| R2 presigned upload, the app's own `sign()` and `remove()`, read-after-delete | 200 / 200 / content matches / 404 |
| LiveKit egress describe, stop-stray, token minting | Works (after the fix below) |
| Queue retry | Retried once, acknowledged on the second attempt |
| Real AI summary (structured output + 768-dimension embeddings) in a queue job | Works; job ran 43-45 s, beyond the 30 s `waitUntil` window |
| CPU | Scheduled runs 59-105 ms; queue jobs 0-62 ms |

Notes:
- Cron schedules took about 11 minutes to start after registration (Cloudflare documents up to 15).
- Cron triggers and queue consumers require an account `workers.dev` subdomain; registered `hybridtutors.workers.dev` (the Worker itself stays off it).
- `Date.now()` does not advance during computation inside Workers, so in-code timings read 0 ms; use the platform's wall and CPU figures.

**Latent bug found and fixed (affects the current Node worker too):** LiveKit answers `not_found` for an egress it no longer knows. `describe()`
threw, and the reconciler reads a throw as "server unreachable, retry later", so a forgotten recording stayed "active" for ever and its lesson
never got a summary. `describe()` now returns null for `not_found` (verified against staging LiveKit on Node and on the Worker); unit test added.

## Not yet tested (must be before any decision)
- Heavier routes (booking, lesson tokens, uploads) for CPU time.
- LiveKit egress *start* (only describe, stop-stray and tokens were exercised; starting needs a live room).
- A live webhook insert into the event inbox through the Worker (pattern proven, write not exercised).
- Sign-in bursts through each host, to observe the per-IP Auth limit directly.
- A second ramp round at a different time of day, and any load that does not run through the Free Supabase project.
- Google Cloud Run (needs a billing card).
- Hyperdrive versus direct pooler connections, request and query limits under load.
- Cost and latency from the UK, cold starts, deploy, rollback and secrets handling.

Run locally: `npm run build:portable`, put values in `apps/edge/.dev.vars` (gitignored), then
`cd apps/edge && ../../node_modules/.bin/wrangler dev --local`. The `/spike/pg` route needs `SPIKE=1` and must be removed
before any real use.

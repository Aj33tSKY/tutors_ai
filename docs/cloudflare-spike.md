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

## Not yet tested (must be before any decision)
- Heavier routes (booking, lesson tokens, uploads) for CPU time, and a larger CPU sample than the 24 requests the tail log kept.
- A second ramp round at a different time of day, and any load that does not run through the Free Supabase project.
- Google Cloud Run (needs a billing card).
- Hyperdrive versus direct pooler connections, request and query limits under load.
- Cost and latency from the UK, cold starts, deploy, rollback and secrets handling.

Run locally: `npm run build:portable`, put values in `apps/edge/.dev.vars` (gitignored), then
`cd apps/edge && ../../node_modules/.bin/wrangler dev --local`. The `/spike/pg` route needs `SPIKE=1` and must be removed
before any real use.

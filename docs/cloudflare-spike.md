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

## Not yet tested (must be before any decision)
- Real chat against a model (needs an OpenAI key); the streaming mechanics above are proven with a synthetic stream.
- Heavier routes (booking, lesson tokens, uploads) for CPU time, and a larger CPU sample than the 24 requests the tail log kept.
- The black-box test suite against a deployed Worker (the current integration suite injects fakes in-process).
- Hyperdrive versus direct pooler connections, request and query limits under load.
- Cost and latency from the UK, cold starts, deploy, rollback and secrets handling.

Run locally: `npm run build:portable`, put values in `apps/edge/.dev.vars` (gitignored), then
`cd apps/edge && ../../node_modules/.bin/wrangler dev --local`. The `/spike/pg` route needs `SPIKE=1` and must be removed
before any real use.

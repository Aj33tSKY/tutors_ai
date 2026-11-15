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

## Not yet tested (must be before any decision)
- Streaming chat (SSE) end to end, including a client disconnecting mid-stream.
- CPU time per request on real Cloudflare (Free plan: 10 ms). Local runs do not enforce it.
- The black-box test suite against a deployed Worker (the current integration suite injects fakes in-process).
- Security headers on static responses: the Caddy set (HSTS, frame, referrer, permissions policy) needs an assets `_headers` file.
- Hyperdrive versus direct pooler connections, request and query limits under load.
- Cost and latency from the UK, cold starts, deploy, rollback and secrets handling.

Run locally: `npm run build:portable`, put values in `apps/edge/.dev.vars` (gitignored), then
`cd apps/edge && ../../node_modules/.bin/wrangler dev --local`. The `/spike/pg` route needs `SPIKE=1` and must be removed
before any real use.

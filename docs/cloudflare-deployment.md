# Deploying to Cloudflare

The whole application runs as one Cloudflare Worker per environment: the static frontend, the Hono API and the background
jobs. The plan, decisions and measured constraints are in [cloudflare-migration-plan.md](cloudflare-migration-plan.md);
read its "Constraints" section before changing anything here.

| Piece | Where |
| --- | --- |
| Worker entry (HTTP, Cron Trigger, Queue consumer) | `apps/edge/src/worker.ts` |
| Background-job adapter (one database connection per run) | `apps/edge/src/jobs.ts` |
| What the jobs actually do (host-agnostic) | `packages/jobs/src/runner.ts` and the modules it calls |
| Configuration per environment | `apps/edge/wrangler.jsonc` (`env.staging`, `env.production`) |
| Release workflow | `.github/workflows/deploy-cloudflare.yml` (manual, typed confirmation) |
| Runtime checks on every pull request | `scripts/ci/worker-smoke.mjs` (boots the Worker in workerd) |

## How background work runs

- **Every minute** (`* * * * *`): the sweep applies due provider events, settles recordings LiveKit has finished, and
  enqueues lessons that need a transcript or a summary.
- **Straight after a webhook is stored**: the API enqueues an `events` job, so the first attempt does not wait for the sweep.
- **Queue consumer** (`tutors-jobs-<env>`): one job per invocation, at most five at once, up to 15 minutes each. A job that
  keeps failing is retried with backoff and then dropped; the database's own attempt counts and the next sweep take over.
  Messages the consumer cannot handle at all land in `tutors-jobs-<env>-failed`.
- **Daily at 03:15 UTC**: expired recordings are deleted from R2 and marked expired.

All of it goes through the database's claim functions, so running the VPS worker and the Worker side by side during the
cutover is safe: a second runner simply fails to claim.

## One-time setup per environment

1. **Cloudflare account:** Workers Paid plan (chat turns use 87-251 ms CPU; Free allows 10 ms). The account needs a
   `workers.dev` subdomain for Cron Triggers and Queues (registered: `hybridtutors`).
2. **GitHub:** secret `CLOUDFLARE_API_TOKEN` (Workers Scripts, Workers Routes, Queues and DNS edit for the zone), variable
   `CLOUDFLARE_ACCOUNT_ID`, and for each environment the variables `<ENV>_SUPABASE_URL`, `<ENV>_SUPABASE_ANON_KEY`,
   `<ENV>_SUPABASE_POOLER_HOST` (for example `aws-1-eu-west-1.pooler.supabase.com`) and `<ENV>_SITE_URL`. The Supabase
   project id, database password, access token and migration baseline variables are shared with the existing workflows.
3. **Worker secrets**, set once with `cd apps/edge && npx wrangler secret put <NAME> --env <env>`. The release refuses to run
   while any of these is missing:

   | Secret | Notes |
   | --- | --- |
   | `APP_JOBS_DATABASE_URL` | `tutors_worker` login, **transaction pooler, port 6543**. Port 5432 is refused at runtime. |
   | `APP_EVENTS_DATABASE_URL` | `tutors_events` login, transaction pooler, port 6543. |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | The webhook secret belongs to the endpoint `<site>/v1/webhooks/stripe`. |
   | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL` | The environment's own LiveKit key pair. |
   | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | The environment's recordings bucket. |
   | `DEEPGRAM_API_KEY` | Transcription. |
   | `OPENAI_API_KEY` | Optional: without it chat answers 503 and summaries are not queued. |

## Releasing

Run **Deploy to Cloudflare** from `main`, choose the environment and type `deploy`. It verifies the commit (the full CI
suite), applies migrations, re-grants the restricted logins (which also sets their statement timeouts, because Supabase's
pooler ignores the connection-level setting), builds and prerenders the frontend, creates the queues if needed, deploys,
and checks `/health/ready`.

### The first staging release is the cutover

`env.staging` claims `staging.hybridtutors.co.uk`, which today points at the Oracle VPS. Follow phase C of the plan:

1. Set the Worker secrets and GitHub variables above.
2. Remove the existing `staging` A record in Cloudflare DNS (a custom domain cannot replace a record it does not own), then
   run the release straight away; the hostname is down between the two steps.
3. Watch the first sweeps and jobs (`npx wrangler tail --env staging`), then stop the VPS worker. Until then both run safely.
4. Point the Stripe and LiveKit staging webhooks at the same URLs (they are unchanged; only the host behind them moved).

## Rollback

`cd apps/edge && npx wrangler rollback --env <env>` returns the previous Worker version within seconds. Database
migrations are forward-only, so every migration must stay compatible with the previous release. To go back to the VPS
during phase C, recreate the A record and remove the Worker's custom domain.

## Operating

- Live logs: `npx wrangler tail --env <env>`. Every sweep logs `jobs_sweep` with counts; failures log `job_failed` or
  `job_step_failed` with a code only (provider messages can contain personal data).
- Dashboard: Workers & Pages, the environment's Worker, Metrics and Observability (CPU time percentiles, errors, cron runs).
- Cron schedules can take up to 15 minutes to start after a release that adds or changes them.
- Local development: `npm run build:portable && npm run build:edge-assets`, put values in `apps/edge/.dev.vars`
  (gitignored), then `cd apps/edge && npx wrangler dev --local`.

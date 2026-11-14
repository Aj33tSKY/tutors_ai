# Hosting alternatives assessment

Research date: 14 November 2026. Recommendation based on repository documentation, application code, deployment workflows, installed Next.js deployment guides, and current provider documentation. No provider accounts, invoices, production usage, or live configuration were inspected. Prices are public list prices or explicitly labelled planning allowances; exclude VAT, currency conversion, engineering time, and usage unless stated.

**Recommendation: retain managed Supabase, R2, and Hetzner LiveKit; evaluate Cloudflare Workers as the replacement for Vercel.** Cloudflare offers the clearest managed hosting saving, but this app needs two compatibility issues resolved first. Hetzner plus Coolify is the alternative for a standard Node runtime and greater control, provided an available server quote actually saves money. Moving both the app and database at once is a poor trade for the existing reliability and release process.

**What exists here**

The developer workflow, CI/CD runbook, transcription documentation, backlog, testing plan, MVP plan, root README, prior LiveKit assessment, infrastructure README, and design documentation were reviewed. Historical plans are not treated as proof of deployed state. The workflows and current source establish:

| Dependency | Actual usage and migration consequence |
| --- | --- |
| Next.js 16.4.6, React 19.3.1, Node 24 in CI | App Router, Server Actions, authenticated server rendering and streaming chat; cannot replace this with a static export. |
| Vercel releases | GitHub Actions deploys two separate projects. One main branch; automatic staging, manually confirmed production; migrations precede deployment; production release tags and health checks. |
| Vercel Cron | Transcription and summarisation every five minutes, recording pruning daily at 03:15 UTC. New hosting needs an explicit scheduler. |
| Vercel AI Gateway | Chat, summaries and embeddings use AI SDK model identifiers. README documents automatic Vercel OIDC authentication, which must be replaced when hosting elsewhere. |
| Supabase | Postgres, Auth, PostgREST queries, RPCs, RLS using auth identities, Realtime direct messages, private homework attachments, pgvector and pg_trgm. This is a backend platform dependency. |
| Cloudflare R2 | Current code already signs, plays and deletes private audio/screen recordings in R2. Deepgram fetches signed audio directly; media does not pass through the app server. |
| Hetzner LiveKit | Keep the independent deployment workflow and separate environments. Do not add app builds or database services to the existing media server. |

Sources in the repository: `package.json`, `src/proxy.ts`, `src/lib/supabase/`, `src/components/dashboard/direct-message-thread.tsx`, `src/app/api/`, `vercel.ts`, `config/required-env.json`, `.github/workflows/`, and `supabase/migrations/`.

The runbooks say staging LiveKit is on Hetzner but production is still on LiveKit Cloud, and production was last released on 26 September. This may lag reality; verify it in accounts before costing or scheduling a cutover. The earlier LiveKit strategy also contains already-completed R2 work and old sizing estimates. The newer infra README's measurements take precedence.

**Cost comparison**

Supabase's published Pro baseline is $25/month including one Micro project's compute; a second Micro adds approximately $10/month. The illustrative baseline below assumes one Vercel developer seat and two paid Micro Supabase projects in one Pro organisation. It is not an estimate of your actual invoice. Vercel Pro starts at $20/month, so this example is approximately $55/month before common extras. [Supabase pricing](https://supabase.com/pricing), [Vercel pricing](https://vercel.com/pricing).

| Option | Illustrative recurring cost for app + backend | Assessment |
| --- | --- | --- |
| Current: Vercel Pro + two managed Supabase Micro projects | About $55/month baseline | Best immediate continuity; first check whether spend actually exceeds the baseline. |
| Workers Paid + same managed Supabase projects | About $40/month base, plus adapter resources and usage | Preferred managed target if migration checks pass. Base saving about $15/month, $180/year, under these assumptions. |
| Hetzner + self-hosted Coolify + same managed Supabase projects | $35/month + actual app VPS, IP, backups and monitoring | Standard Node runtime; saving depends on stock, quote and operational effort. |
| Workers + Neon and replacement backend services | Workers + metered Neon + other service costs | Potential lower idle database spend, but substantial migration effort. No credible total without designing replacements. |
| Hetzner app + self-hosted Supabase | App and database capacity + staging + backup storage + monitoring | Infrastructure can be cheap when suitable capacity is available; does not preserve managed operational responsibility. |

LiveKit, recording storage, Deepgram, AI inference, email, payment fees and GitHub Actions consumption are excluded from every row. They persist across options. Migration can temporarily increase spend while both hosts run.

Workers Paid starts at $5/month and includes 10 million requests and 30 million CPU milliseconds; overages are $0.30/million requests and $0.02/million CPU milliseconds. Static assets are free under the documented model. Additional R2 cache, Durable Objects, queues, logs and image transformations must be costed separately. Network waiting does not count as CPU time. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Do not budget Hetzner from old €3–6 VPS examples. At research time its public cost-optimised page marks CX23 and CX33 unavailable. The indexed official June price-adjustment table lists CX33 at €8.49 and CPX22 at €19.49, but opening that table returned 404 and the live product pages did not expose numeric prices to the reader. Treat these as indicative references, not orderable quotes. Confirm region, stock, IPv4, VAT and backup charges in the console. A roughly €20 app host can erase the saving against a single $20 Vercel seat. [Hetzner availability](https://www.hetzner.com/cloud/cost-optimized/), [regular-performance sizes](https://www.hetzner.com/cloud/regular-performance/), [indexed price-adjustment source](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/).

**Cloudflare: best managed target, conditional on application changes**

Use Workers with `@opennextjs/cloudflare`, rather than Pages with the older `next-on-pages` approach. OpenNext supports Next.js 16 and the Next.js Node runtime on Workers' compatibility layer. This does not turn Workers into a conventional Node server. Pin the adapter and Wrangler, and check the adapter's exact peer range against Next 16.4.6 and the installed React version. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [OpenNext compatibility](https://opennext.js.org/cloudflare).

Two findings make an unchanged production move unsuitable:

1. `src/proxy.ts` refreshes Supabase sessions for `/dashboard` and `/session`. OpenNext currently describes Next.js 16 Node middleware/proxy support as experimental. Prove login, expired-cookie refresh, redirects, logout and session-page access on the actual Workers runtime. If this requires a workaround, review it as an auth change, including direct route access; do not simply delete the proxy.
2. `src/app/api/webhooks/livekit/route.ts` starts screen Egress in `after()`, with retries around 15, 30 and 70 seconds. Workers allows only up to 30 seconds of execution after the response via `waitUntil()`. This is a background-lifetime problem, not a CPU-budget problem. Increasing CPU limits or a Next.js `maxDuration` declaration will not solve it. [Workers execution limits](https://developers.cloudflare.com/workers/platform/limits/).

Move recording-start retries into a durable job mechanism before cutover. One candidate is Cloudflare Queues with delayed retries, or Workflows with durable waits. Preserve the existing unique track reservation, recording consent, tutor ownership, cancellation when a share ends, and cleanup if Egress starts but the database claim fails. Consumers must tolerate redelivery and recover a crash between the external Egress request and recording its ID; a queue alone does not make that external call exactly-once.

Replace all three cron definitions using an explicit scheduled Worker/custom entrypoint. The five-minute jobs need bounded batches, request timeouts, retry observability and atomic claims. Transcription currently selects pending segments and increments attempts without an atomic work lease, then appends text before marking completion. Overlap or a crash can duplicate processing. This risk already exists and becomes more important when changing schedulers. Scheduled handlers have their own execution limits; test long lessons rather than copying the summariser's 300-second Vercel declaration. [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [OpenNext custom workers](https://opennext.js.org/cloudflare/howtos/custom-worker).

The remaining compatibility checks are streamed chat completion/persistence, LiveKit SDK/protobuf signing, R2 AWS SDK presigning, image optimisation, Server Actions, `revalidatePath`, and deployed bundle size. Workers has a 128 MB isolate limit. The existing direct media path helps, but does not prove a full lesson transcript, model response and embedding batch fit under concurrency. Measure CPU, memory and latency. Keep private dashboard responses out of shared CDN caches.

Do not split the marketing pages into a separate Pages deployment initially. Keeping one app preserves shared routes, auth and release simplicity. Most authenticated latency comes from regional backend round trips; a globally distributed frontend is not automatically faster. Measure UK users against the actual Supabase region and consider placement only with evidence.

**Hetzner + Coolify: best standard-runtime alternative**

Use a separate app VPS, with Docker images built in GitHub Actions and deployed by digest. Self-hosted Coolify is free, but the infrastructure is yours. Its own minimum is 2 CPU cores, 2 GB RAM and 10 GB disk; allow additional capacity for the app, staging, and overlapping old/new containers. A 4 GB machine is a starting experiment for app-only hosting; 8 GB gives more headroom if sharing with staging and Coolify. Build outside the VPS so deployment does not compete with serving users. [Coolify installation](https://coolify.io/docs/start-with-self-hosted), [pricing](https://coolify.io/pricing).

Use Coolify's Docker Image application type for the web app, and disable Git push deployments. Actions must remain the release authority. The deploy API accepting a request means queued, not released: wait for the deployment to complete, verify the digest/commit served, then smoke-check and tag. [Coolify GitHub Actions integration](https://coolify.io/docs/applications/sources/github/actions).

Coolify can start a replacement container before stopping the old one for eligible application types. Docker Compose applications do not use that rolling-update mechanism, and neither path guarantees zero downtime. Configure readiness and graceful shutdown; the existing screen-start callback can take longer than the default 30-second stop grace. A longer grace reduces deploy interruption but does not survive host failure; durable jobs remain the stronger solution. [Coolify rolling updates](https://coolify.io/docs/applications/deployments/rolling-updates).

The installed Next.js self-hosting guide confirms `next start` supports the app's features. For rolling or multiple instances, account for Server Action encryption keys, deployment identifiers, old asset availability, cache invalidation and unbuffered streaming. Build separately for staging and production because `NEXT_PUBLIC_SUPABASE_*` and `NEXT_PUBLIC_LIVEKIT_URL` are embedded at build time. Reuse one image within an environment; do not assume the staging image can be promoted unchanged to production.

A single app VPS is a single point of failure even behind Cloudflare. Two hosts and a load balancer improve availability but increase cost and coordination. Avoid sharing with LiveKit: the documented staging media server already has limited CPU headroom during four sessions, and media deployments deliberately protect active calls. App build or restart behaviour must not affect lessons. Keep health alerts outside the server they monitor, retain known-good images, and rehearse rebuilding a lost host.

**Supabase alternatives**

**Keep managed Supabase initially.** The two-project example is about $35/month, buying the managed backend rather than just disk and SQL. Optimise measured compute, database growth and attachment usage first. Free staging is an optional saving only if its separate organisation/plan setup, quotas, inactivity pausing and reduced backup guarantees are acceptable; projects in a paid organisation are not independently switched to a Free plan. It should never share production's database or credentials.

**Neon is the strongest alternative to investigate for a deliberate Postgres/backend redesign.** Its current offering includes managed Better Auth, object storage and beta Realtime, alongside serverless Postgres; it would be inaccurate to describe it as SQL only. Those services still do not establish compatibility with Supabase client calls, `auth.users`, JWT-based RLS, Storage policies, or Realtime publications. Prototype those boundaries before trusting a migration estimate. [Neon pricing and product scope](https://neon.com/pricing).

Neon Launch currently lists $0.106/CU-hour and $0.35/GB-month. At 0.25 CU continuously awake for 730 hours, compute alone is approximately $19.35/month per database, plus storage and extras. Two always-awake minimum computes are approximately $38.69 before storage. Scale-to-zero can change that substantially, but the five-minute cron queries and Realtime requirements may reduce the opportunity; measure actual suspension. The advertised typical $15 spend is not a fixed plan price.

**Self-hosted Supabase on Hetzner is the closest functional replacement.** It retains the platform model more readily than rebuilding around bare Postgres. Official minimum for all components is 4 GB RAM, 2 cores and 40 GB SSD, with 8 GB+, 4 cores+ recommended; this is additional to app/control-plane capacity. Preserve Auth, PostgREST, Realtime, Storage and required extensions. [Supabase Docker requirements](https://supabase.com/docs/guides/self-hosting/docker).

You then own upgrades, monitoring, high availability and recovery. Budget encrypted off-host database backups, WAL/PITR if required by recovery objectives, actual file backups, secret recovery, SMTP and restore drills. VPS snapshots are not proof of database recoverability. Auth accounts can be restored, but service versions, keys, JWT/session behaviour, redirects and separately stored Storage objects require migration work. [Self-hosting responsibilities](https://supabase.com/docs/guides/self-hosting), [platform restore guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

Keep schema changes in repository migrations. Hosted-project linking and management API checks must be replaced by a validated database-URL migration path for self-hosting; retain ordered history checks and RLS tests. Never substitute the dashboard SQL editor for this pipeline. Given the small managed baseline, removing production's managed database is unlikely to pay for the maintenance burden at present.

**Other app hosts**

Railway is worth a standard-Node comparison quote. Its $5 Hobby minimum includes $5 usage, while its professional/team Pro minimum is $20; resources are metered. Do not model two running environments as a guaranteed $5 total. Render is another managed Node/container candidate, but quote paid app capacity, cron and staging together. Neither is an obvious better saving than Workers for this workload. AWS/OpenNext or Cloud Run could work, but introduce more deployment, identity, scheduling and observability machinery than this cost exercise currently warrants. [Railway pricing](https://railway.com/pricing), [Render pricing](https://render.com/pricing).

Cloudflare D1 would require replacing the PostgreSQL/Supabase model and is unsuitable as a cost-only migration. A SQLite-oriented backend would similarly discard too much existing behaviour. These are product/backend rewrites, not hosting substitutions.

**Preserve the release contract**

The target flow should be:

```text
PR checks -> main
  staging: preflight -> verify -> build target artifact -> migration history/dry run
           -> migrate staging -> deploy artifact -> verify commit + health
  production: manual confirmation -> preflight/parity -> verify exact commit
              -> build production artifact -> migration history/dry run
              -> migrate production -> deploy artifact -> smoke -> release tag
```

Building the deployable artifact before migrations catches adapter/image failures before changing the remote schema. Do not use PR builds containing placeholder public URLs as release artifacts. Preserve serialised releases, additive migrations, full production database validation, pinned tooling, existing required check names and workflow permission checks. If GHCR publishing introduces `packages: write`, scope it to the publishing job and check reusable-workflow callers.

Replace the Vercel-specific implementation in `scripts/ci/verify-env-parity.mjs`, not the parity requirement. Continue checking required variable names against `config/required-env.json` without printing secret values. Include implicit SDK configuration such as Gateway credentials. Add provider build/deployment configuration to the relevant CI scope checks.

Keep AI Gateway initially using a server-side `AI_GATEWAY_API_KEY` instead of Vercel OIDC; using the AI SDK does not require Vercel app hosting. Add the credential to the manifest and both environments. Confirm gateway access and billing after changing the Vercel subscription. Direct model-provider credentials are a later independent option; changing embedding provider/model can require re-embedding and dimension changes. [Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok).

Use stable custom staging/production app domains before provider cutover. Update Supabase site/redirect URLs, R2 CORS, webhook destinations, health URLs and scheduler destinations. Treat cron activation as an explicit handover: only one scheduler per environment may run. Disabling Vercel Git deploys does not disable its cron jobs. An app rollback does not undo a database migration, and a database cutover cannot be safely reversed after new writes without reconciliation.

**Recommended execution order and decision gates**

1. Record actual invoices, seats, Supabase sizes/organisation structure, backend region, peak traffic, app CPU/memory, cron duration/backlog and recording growth. Decide acceptable outage and recovery windows. Existing docs are useful context, not live inventory.
2. Prototype Workers on staging with current dependencies. Prove the proxy/cookie boundary and move long post-response retries to durable execution. Preserve consent and idempotency. Establish bounded, claimed background jobs.
3. Run the critical journeys: signup/reset/login/logout/refresh, booking Server Actions, realtime DMs and private attachments, streamed chat persistence, signed webhooks, join/leave/rejoin with audio and screen recording, transcript attribution, summaries/embeddings, playback/CORS and 90-day pruning. Verify a deploy during active requests and a rollback. `/api/health` alone only checks environment/database reachability.
4. If these pass, deploy Workers with managed Supabase, hand over schedulers once, and retain Vercel briefly as a tested rollback. Only end Pro once all hosting, Gateway authentication and scheduler dependencies are accounted for.
5. If proxy support or runtime constraints require disproportionate work, obtain an available Hetzner app-server quote and compare Coolify against retaining Vercel. Keep Vercel if the saving is marginal. Revisit database self-hosting only with a separate cost/recovery case.

The strongest expected saving without owning database operations is approximately $15/month in the one-seat/two-Micro example. At an illustrative £50/hour, even half an hour of recurring maintenance costs £25 before migration time. If actual bills are close to minimums, retaining the current platform while fixing the documented monitoring and application-test gaps can be the more efficient decision. If seats, usage or database spend are materially higher, recalculate from the invoice rather than extrapolating this baseline.

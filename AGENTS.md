<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Where things are documented

- [docs/development-workflow.md](docs/development-workflow.md) — which branch to start from, how to open a pull request, how to write a migration. Read this first.
- [docs/CI-CD.md](docs/CI-CD.md) — the pipeline itself, environment configuration, and what is still outstanding.
- [docs/transcription.md](docs/transcription.md) — how session transcripts are produced.
- [docs/mvp_plan.md](docs/mvp_plan.md) — product scope.

## Things that have already caught someone out

Each of these cost real debugging time. They are not obvious from reading the code.

- **There is one long-lived branch, `main`.** Staging deploys automatically from it; production releases the same commits only when a human dispatches `Deploy production` and types the confirmation. There is no `develop` branch — it was removed because two long-lived branches kept diverging. Do not reintroduce one.
- **GitHub Actions owns deployment, not Vercel's Git integration.** `vercel.ts` sets `git.deploymentEnabled` to `false` for `main` so Vercel cannot deploy it, because migrations must be applied before the code that needs them. Do not "fix" this by re-enabling Git deployment.
- **Migrations are the source of truth.** Never change a remote database through the Supabase dashboard. Doing so makes its history disagree with the repository, and the deploy workflows refuse to run until a human reconciles it. `supabase/tests/` asserts the RLS policies; a pull request that changes a policy must change those tests too.
- **A `track_published` webhook carries no participant metadata** — only sid, name and identity. Roles come from the booking, never from token metadata. Reading metadata there silently discards every event, which is invisible because the handler still returns 200.
- **There is no transcription agent.** Transcription is batch: audio-only per-track egress, then `/api/cron/transcribe-sessions`. The old always-on LiveKit agent under `agent/` was deleted deliberately; do not reintroduce it.
- **A wrong webhook path returns 200.** Next.js answers an unknown POST path with a page, so LiveKit records a successful delivery and never retries. If webhook-driven behaviour is missing, check the configured path before suspecting the handler.
- **Adding a permission to `ci.yml` breaks its callers.** `staging.yml` and `production.yml` call it as a reusable workflow, and a called workflow cannot request more permissions than its caller grants. `scripts/ci/verify-workflow-permissions.mjs` checks this in CI.

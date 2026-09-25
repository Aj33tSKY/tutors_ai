# CI/CD and environment promotion plan

This runbook describes how changes should move from development to production for the Tutors app. For the day-to-day version — which branch to start from, where to open a pull request, how to write a migration — see [development-workflow.md](development-workflow.md); this document is the infrastructure behind it. It separates application deployment (Vercel) from database deployment (Supabase), and keeps production changes reviewed and gated.

## Recommended target workflow

```text
feature branch → pull request → develop/staging → staging checks
                                         ↓ reviewed promotion PR
                                      main → production approval
                                             migration → Vercel deploy → smoke test
```

- `feature/*`: individual changes; pull requests run checks and migration tests.
- `develop`: shared staging line, connected to the tutors_dev Supabase project and the separate `tutors-dev` Vercel project, with a stable staging domain.
- `main`: production source. A GitHub Actions production job re-runs the pull-request checks against the exact commit being released, applies reviewed migrations, then deploys the app to Vercel. `vercel.ts` sets `git.deploymentEnabled` to `false` for `main` and `develop` so Vercel cannot auto-deploy either branch from Git and race ahead of its database migration; leave the matching dashboard setting off as well.
- Keep production and staging data, API keys, storage, LiveKit, and Stripe environments separate. Staging must contain only fake or anonymised data.

For small schema changes, prefer additive, backward-compatible migrations. For a breaking change, use an expand/migrate/contract rollout across separate releases: add the new shape, deploy code that can work with both shapes, migrate data, then remove the old shape in a later release.

## State observed in this checkout (recheck before setup)

- Repository-side workflows and checks are committed on `ci-cd-and-batch-transcription`, but that feature branch has not been merged into `develop` or `main`.
- Vercel project `tutors` has Production variables configured and is linked to GitHub.
- Production Supabase migration history currently matches the checked-in migration files. The production database already has a participant-only read policy for the private `session-recordings` bucket.
- Local `.env.local` is configured for tutors_dev. Never copy its values into production.
- tutors_dev has received at least one direct SQL policy fix. Its migration history was not baselined, so **do not run `supabase db push` against tutors_dev until its schema and history have been reconciled**.
- The project uses imperative SQL migrations under `supabase/migrations/`; no declarative `supabase/schemas/` workflow is configured.
- Verify these facts again before the first release; the environment may have changed.

The remote `develop` branch exists. The workflows cannot release from it until the feature branch is merged, the staging Vercel project is configured, the repository secrets and variables are configured, and the database baseline flags are deliberately enabled. This checkout does not prove which external dashboard settings have since been completed.

## Phase 1: Reconcile tutors_dev safely

This is the current blocker. Decide whether the existing tutors_dev test users and data may be discarded.

### If tutors_dev data is disposable

1. Confirm the target ref is tutors_dev, not production.
2. Take a schema/data backup first, even if the data is expected to be disposable.
3. Rebuild tutors_dev from the repository's migrations and seed only fake test data.
4. Verify the app's essential flows and compare the resulting schema to production where appropriate.

### If tutors_dev data must be preserved

1. Take and verify a backup.
2. Compare the live tutors_dev schema with every checked-in migration.
3. Create a baseline that records which migrations are already represented; do not replay the initial schema blindly.
4. Reconcile one-off SQL fixes into a reviewed migration or the baseline record.
5. Check `supabase migration list` and inspect the planned changes before any push.

Do not use `db reset` or `db reset --linked` against a remote project. Do not use `--include-all`, `migration repair`, or production dashboard SQL as a shortcut around unknown history.

## Phase 2: Configure staging and production environments

### Vercel

1. Keep the existing `tutors` Vercel project for production, with `main` as its Production Branch.
2. The second Vercel project, `tutors-dev`, already exists (created with `vercel project add`, so it has no Git connection, no environment variables and no production branch yet). Connect it to the same Git repository and app root directory; Vercel supports multiple projects using one repository. Its framework preset is set from `vercel.ts`, not the dashboard.
3. Set `develop` as the staging project's Production Branch. In that project, its **Production** environment variables must point only to tutors_dev and staging services. “Production” here means the live deployment slot of the staging Vercel project; it must not contain production credentials.
4. Assign a stable domain to the staging project's `develop` branch, such as `staging.<your-domain>`. The project's stable `.vercel.app` domain can be used if you do not have a custom domain. Configure tutors_dev Auth redirect/site URLs to allow this staging domain.
5. For migration-before-deploy ordering, GitHub Actions applies staging migrations and then deploys to the staging project's production slot with Vercel CLI (`vercel deploy --prod --project <staging-project-id>`). Automatic Git deployment of `main` and `develop` is already disabled in `vercel.ts` for every project built from this repository, so Vercel cannot race ahead of migration jobs; confirm the dashboard agrees. Keep PR checks and ephemeral previews separate; if enabled, their Preview variables must never point to production.
6. Keep the production project's variables scoped to Production. The staging project should have its own copies of every required variable, populated with tutors_dev, staging LiveKit, Stripe test-mode, and staging Storage values.
7. Use separate LiveKit credentials/webhooks and Stripe test-mode credentials for staging. Point the staging LiveKit webhook at the stable staging domain. Never put server secrets in `NEXT_PUBLIC_*` variables.

See [Vercel projects](https://vercel.com/docs/projects), [Git deployments and production branches](https://vercel.com/docs/git), and [deploying from the CLI](https://vercel.com/docs/projects/deploy-from-cli).

### GitHub

**Why repository secrets rather than Environments.** GitHub Environments — and with them required-reviewer approval gates and environment-scoped secrets — are unavailable on private repositories on the Free plan. This repository is intended to become private, so secrets and variables live at repository level and are **prefixed per environment** instead. Nothing here depends on a paid plan or on the repository staying public.

The approval gate is replaced by making production deployment manual: `production.yml` has no `push` trigger and runs only from `workflow_dispatch`, where the operator must type `deploy` to confirm. For a single maintainer this is equivalent protection with less machinery — an approval gate only adds real safety when the approver is not the author. Revisit Environments when a second person joins.

1. Protect both `develop` and `main`: require pull requests, passing CI checks, and no force-pushes. Branch protection works on private Free-plan repositories.
2. Add secrets and variables at repository level (Settings → Secrets and variables → Actions).

Secrets — sensitive, write-only, masked in logs:

| Secret | Purpose |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI authentication; shared by both environments |
| `VERCEL_TOKEN` | Deploy through the Vercel CLI; shared by both environments |
| `PRODUCTION_SUPABASE_DB_PASSWORD` | Production database password |
| `STAGING_SUPABASE_DB_PASSWORD` | tutors_dev database password |

Variables — non-sensitive configuration, visible in the UI:

| Variable | Value |
| --- | --- |
| `VERCEL_ORG_ID` | The Vercel team identifier, shared |
| `PRODUCTION_VERCEL_PROJECT_ID` / `STAGING_VERCEL_PROJECT_ID` | `tutors` and `tutors-dev` project IDs; read with `vercel project inspect <name>` |
| `PRODUCTION_SUPABASE_PROJECT_ID` / `STAGING_SUPABASE_PROJECT_ID` | Supabase project refs |
| `PRODUCTION_SUPABASE_BASELINE_VERSION` / `STAGING_SUPABASE_BASELINE_VERSION` | Last migration verified as already present in that database |
| `PRODUCTION_MIGRATIONS_BASELINED` / `STAGING_MIGRATIONS_BASELINED` | Must be `true` before that environment will deploy |
| `PRODUCTION_URL` / `STAGING_URL` | Optional stable domain for the post-deploy smoke check |

Set them with the CLI rather than pasting into a browser:

```bash
gh secret set SUPABASE_ACCESS_TOKEN              # prompts on stdin
gh secret set PRODUCTION_SUPABASE_DB_PASSWORD
gh variable set VERCEL_ORG_ID --body team_xxx
```

The prefixes are what keep the environments apart, so a staging job cannot reach production: `staging.yml` only ever reads `STAGING_*`, and `production.yml` only ever reads `PRODUCTION_*`. Set the two `*_MIGRATIONS_BASELINED` variables last and deliberately — both workflows refuse to run until the one matching their environment is `true`.

## Phase 3: Add CI and release workflows

Keep workflow definitions in `.github/workflows/`. The Supabase CLI is pinned as a project dependency in `package.json` and invoked through `npx --no-install`, so local development and CI use the same CLI package (including its platform-specific companion binary). Node and Vercel CLI versions are also pinned; Dependabot proposes reviewed updates for GitHub Actions and app dependencies.

### Pull request checks

Run on pull requests to `develop` and `main`:

1. Install the locked Node dependencies.
2. Run lint, Next.js route type generation, typecheck and production build. There is still no app-level test script; database authorisation is covered separately below.
3. Start only the local Supabase containers that applying SQL needs (`-x analytics,vector,studio,imgproxy,inbucket,edge-runtime,functions,realtime`) and apply all migrations from scratch (`supabase db reset --local --no-seed` targets local only and skips the currently absent seed SQL file).
4. Lint the resulting schema with `supabase db lint --local --fail-on error`, then run the pgTAP RLS suite with `supabase test db --local` (see Database authorisation tests). When a pull request changes an RLS or storage policy, add or update the matching test — the suite asserts denied access as well as allowed.
5. Do not deploy to production or use production secrets in this workflow.

`ci.yml` also declares `workflow_call`, so both deploy workflows run it as a required `verify` job against the commit being released.

### Staging release

On merge to `develop`:

1. Re-run the full CI suite against the commit being released.
2. Confirm the baseline flags and required credentials before touching tutors_dev.
4. Run a migration dry-run against tutors_dev and stop if unexpected migrations appear.
5. Apply only pending migrations to tutors_dev.
6. Report any remaining schema drift (`supabase db diff --linked`) as a warning — at that point migrations are applied, so a diff means something changed tutors_dev outside this pipeline. tutors_dev has taken direct SQL fixes before, so expect this to fire until it is reconciled.
7. Deploy the app to the `tutors-dev` Vercel project's Production slot using that project's ID. Its stable domain should continue to track the latest successful `develop` deployment.
8. Poll `/api/health` on the new deployment to confirm it boots with staging variables and can reach tutors_dev.
9. Run staging smoke tests by hand: sign-in, create/reschedule/cancel a session, join/leave, recording and transcript playback, DM upload, and invoice workflow as applicable.

The staging app must use only tutors_dev and staging service integrations.

### Production release

On an approved promotion to `main`:

1. Run `Deploy production` manually and type `deploy` to confirm. There is no automatic trigger.
2. Re-run the full CI suite against the commit being released.
3. Confirm a recent production backup/restore point exists.
4. Confirm the baseline flags and required credentials before touching production.
5. Run `supabase migration list` and `supabase db push --dry-run` for the production project. Stop if history diverges or the plan includes anything unexpected.
6. Apply pending migrations with `supabase db push` (never include seed data).
7. Report any remaining schema drift as a warning, as staging does.
8. Deploy the same reviewed commit to Vercel Production only after migrations succeed.
9. Poll `/api/health` on the release to confirm the running build has its environment and can reach production.
10. Run production smoke checks that do not create fake payments or unwanted user data; monitor Vercel and Supabase logs.

If the migration fails, stop the workflow before deploying the app. Prefer a forward fix for production data/schema changes; only use a rollback when it is known to be safe and tested. When a step fails *after* migrations were applied, the job says so explicitly and prints the `vercel rollback` command, because at that point the database is ahead of the running app.

The repository workflows are in `.github/workflows/ci.yml`, `staging.yml`, and `production.yml`; dependency updates are configured in `.github/dependabot.yml`. The migration-history guard is `scripts/ci/verify-supabase-migration-history.mjs` and the post-deploy check is `scripts/ci/smoke-check-deployment.sh`, which polls the `/api/health` route handler. PR CI runs app lint, Next.js route type generation/typecheck/build, a clean local Supabase migration reset, a schema lint, and the pgTAP RLS suite. Each deployment workflow refuses to run until its own `*_MIGRATIONS_BASELINED` variable is `true`. Production additionally requires a manual run with a typed confirmation.

The migration-history guard refuses to deploy when the remote history is empty, the baseline is unset or absent from either side, a remote version is unknown to the checkout, a remote version is recorded twice, a repository migration at or before the baseline is missing remotely, a pending migration is stamped before the remote head (which `db push` would reject anyway), or any version is not a 14-digit timestamp — the last because every ordering comparison above depends on uniform version length.

Third-party actions are pinned by commit SHA with the version in a trailing comment; Dependabot rewrites both. It cannot see versions embedded in `run:` strings, so **bump the `VERCEL_CLI_VERSION` in both deploy workflows by hand.**

Supabase's migration workflow tracks files in Git separately from each database's migration history. Always inspect status and dry-run before a remote push. See [Supabase managing environments](https://supabase.com/docs/guides/deployment/managing-environments) and [database migrations](https://supabase.com/docs/guides/deployment/database-migrations).

## Transcription deployment requirements

Session transcription runs inside the Next.js app (see [transcription.md](transcription.md)); there is no separate agent service to release. Two things are **not** carried by a deploy and must be set per environment before transcription works:

1. `DEEPGRAM_API_KEY` in that environment's Vercel project. Use a separate key for staging.
2. A LiveKit webhook pointed at `/api/webhooks/livekit`, signed with the same API key pair that environment's Vercel env holds. LiveKit has no per-event subscription — a webhook is a URL and a signing key, and every event type is delivered — so `track_published` needs no enabling. It was already arriving and being ignored. A signing key that does not match the environment's `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` fails signature verification and breaks recording and transcription together.

`LIVEKIT_AGENT_NAME` is no longer read by anything and can be removed from both environments.

## Known gaps

These are deliberate and unresolved, not oversights. Read them before trusting a green pipeline.

- **No application test suite.** There is no app `test` script, so nothing asserts UI or route-handler behaviour. Database authorisation *is* covered (see below), but the Next.js layer is not.
- **The smoke check proves reachability, not correctness.** It confirms the build boots with real variables and can reach its database. If Vercel Deployment Protection intercepts the request with HTTP 401/403, the check fails. Set `PRODUCTION_URL`/`STAGING_URL` to a reachable stable domain or add an authenticated protection bypass.
- **`supabase db diff --linked` reports drift after the push, not before.** Before the push it would flag every pending migration as a difference. This means out-of-band schema edits are surfaced in the release log rather than blocking the release.

## Database authorisation tests

RLS is this app's security boundary, so it is tested with pgTAP under `supabase/tests/`. CI runs the suite on a clean database on every pull request and before every release, after migrations have been applied and the schema linted.

| File | Covers |
| --- | --- |
| `00-rls-coverage.test.sql` | Structural guard: every table in `public` has RLS enabled and at least one policy; the security-definer helpers stay out of `public`; `anon` cannot reach the `private` schema |
| `01-bookings-rls.test.sql` | Lesson visibility for student, tutor, linked parent, admin, outsider and anonymous callers; booking in someone else's name; updating someone else's lesson |
| `02-direct-messages-rls.test.sql` | Conversation scoping for reads; posting into a conversation you are not in; forging another person's `sender_id` |
| `03-session-recordings-rls.test.sql` | Recording metadata and the private `session-recordings` object for participants, linked parent and outsiders; attachment uploads confined to `<conversation_id>/<uploader_id>/` |
| `04-transcript-audio-rls.test.sql` | Transcript audio is unreadable by everyone including the lesson's own participants; its bucket is private and carries no storage policy |

Each test authenticates by setting `role` to `authenticated` and `request.jwt.claims` to the user being impersonated, which is what `auth.uid()` reads — the same path a real PostgREST request takes. Fixtures are created as the table owner, which bypasses RLS deliberately; a test that needs to create fixtures after impersonating someone resets with `pg_temp.act_as_owner()` first.

`00-rls-coverage.test.sql` is the one to keep green above all: it fails the moment a new table ships without a policy, which is the failure that would otherwise reach production silently.

Run them locally with Docker running:

```bash
npx supabase start
npm run test:db
```

Two notes on running them locally:

- **Some suites create storage buckets themselves.** Migrations do not create `session-recordings` or `message-attachments`; those are provisioned per environment by hand, so the storage tests insert them into `storage.buckets` as fixtures. `session-transcript-audio` is the exception — it holds no user content and is created by migration, so it needs no fixture and no manual setup.
- **On macOS the Supabase CLI may fail to pull `pg_prove`** with `docker-credential-desktop: executable file not found in $PATH`. Docker Desktop installs that helper outside the default PATH; prefix the command with it:

  ```bash
  PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" npm run test:db
  ```

  GitHub Actions runners are unaffected.

Verifying the tests can actually fail is part of maintaining them. Weakening a policy to `using (true)` and re-running the matching suite should turn the "outsider" assertions red; if it does not, the test is asserting nothing.

## Changes that migrations do not automatically configure

Database migrations can create SQL-managed schema objects, tables, indexes, functions, grants, and RLS policies. They do not automatically provision or copy all external resources. Maintain separate, documented setup for:

- private Storage buckets and their S3 credentials;
- LiveKit projects, webhook URLs, and the signing key pair those webhooks are verified against;
- Vercel project setup, environment variables, domains, and Git integration settings;
- Stripe accounts, mode-specific keys, and webhooks;
- Auth email provider settings, redirect URLs, and SMTP;
- cron/monitoring integrations and secrets.

Use separate resources/secrets per environment. Never copy production recordings, user data, or payment credentials into staging.

## What can be automated versus what needs a person

### Codex can prepare and maintain in the repository

- GitHub Actions workflow files for PR tests, local migration validation, staging migration/deploy, and approval-gated production migration/deploy.
- Migration files, tests, workflow documentation, and safe dry-run/status checks.
- Code/test changes needed to make deployment reliable, and diagnosis of failed CI or migration runs.
- Exact instructions for setting up GitHub and Vercel settings, and verification after the owner configures them.

### The project owner must do or explicitly approve

- Decide whether tutors_dev test data may be deleted; approve any reset/rebuild or a preservation/baselining strategy.
- Create or rotate Supabase, GitHub, Vercel, LiveKit, Stripe, and SMTP credentials; enter secrets in the appropriate dashboards.
- Create the `develop` branch and finish configuring the `tutors-dev` Vercel project; set GitHub branch protection, environment reviewers and baseline variables, Vercel project IDs/domains/environment variables, and provider webhooks in their accounts (or explicitly authorize account changes if tools support them).
- Decide and perform the tutors_dev baseline/rebuild after a backup; only then set `STAGING_MIGRATIONS_BASELINED=true` and its verified `SUPABASE_BASELINE_VERSION`. Production's currently observed baseline is `20260924184118`; re-check it before setting `PRODUCTION_MIGRATIONS_BASELINED=true`.
- Approve production releases and verify user-facing production behavior.
- Decide business-sensitive retention, billing, access, and rollback policies.

Codex should not guess credentials, expose secret values, reset a remote database, or apply a production migration without explicit authorization and a reviewed dry-run.

## First implementation sequence

1. Decide whether tutors_dev can be rebuilt or must be preserved.
2. Reconcile tutors_dev schema and migration history; verify with a clean migration dry-run.
3. Create the `develop` branch and finish configuring the `tutors-dev` Vercel project; connect its Git repository, assign its stable domain and `develop` branch, configure its staging-only variables, then configure GitHub `staging`/`production` Environments, baseline variables, and branch protection.
4. Add the required GitHub secrets/variables. Set the staging baseline confirmation only after the database history has been reconciled.
5. Merge a harmless PR to `develop`; verify staging migration and deployment before setting up/approving production release.
6. Re-check production migration history, set its reviewed baseline, and exercise a small additive production migration with the approval gate before relying on this for a risky schema change.

# Developer workflow: one repository, two live apps

Start here if you are new to the project. [CI-CD.md](CI-CD.md) has the detailed release and recovery notes.

## The map

| Git branch | What it means | Vercel project | Supabase project |
| --- | --- | --- | --- |
| Your `feature/*` branch | Work in progress; a pull request runs checks | No shared release | Use your local database when changing SQL |
| `develop` | The team's shared development app | `tutors-dev` | `tutors_dev` |
| `main` | The app used by real customers | `tutors` | `tutors_ai` |

There is **one GitHub repository**. Branches are versions of its code. Vercel projects are separate copies of the app, each with its own settings and secrets. Supabase projects are separate databases and Auth/Storage services. A Vercel project's **Production** environment means its stable live slot: the Production slot of `tutors-dev` still needs **development** credentials.

```text
feature branch --PR/checks--> develop --migrate tutors_dev--> deploy tutors-dev
                                  |
                                  +--release PR--> main --migrate tutors_ai--> deploy tutors
```

The workflows in this repository run checks on pull requests and deploy after merges. They apply database migrations **before** deploying app code. Vercel's automatic Git deployment is disabled for `develop` and `main` in `vercel.ts` to preserve that order. A green pull request means its checks passed; it does not mean a release succeeded.

## First day on the project

1. Clone the repository and run `npm ci` with Node 24.
2. Get **development** environment variables from the owner into an ignored `.env.local`. Check that `NEXT_PUBLIC_SUPABASE_URL` is the development project's URL. Never copy production keys. Do not run `vercel env pull .env.local` blindly: the local Vercel link currently points to `tutors`, and a pull from that project could replace your development credentials.
3. Run `npm run dev` and open `http://localhost:3000`.
4. For SQL changes, start the local Supabase stack with `npx supabase start`. Your local database is separate from both cloud projects.

Your laptop can use `tutors_dev` for app development if you need shared test data, but that means local actions can change staging data. Use local Supabase for schema work and fake data only. Ask the owner for the development API keys; the service role key stays on the server and must never be committed or put in a `NEXT_PUBLIC_` variable.

## Make a change

```bash
git switch develop
git pull origin develop
git switch -c feature/short-description
```

Make the change and run the app locally. Push your feature branch and open a pull request **into `develop`**. After review and green checks, merge it. Watch the **Deploy staging** GitHub Action, then use the `tutors-dev` URL to check the actual behavior. If that Action fails, staging has not been released even if the pull request passed.

For a database change, create a file with `npx supabase migration new describe_change`, write the SQL, and commit the file. Apply it to your **local** database with `npx supabase db reset --local --no-seed`. If changing RLS or Storage policies, update the matching SQL checks in `supabase/tests/`. Do not edit the cloud databases through Supabase Studio or the SQL editor. Already merged migration files are historical records; change the schema with a new migration.

Use additive database changes when possible. The old app briefly runs against the new schema while Vercel deploys. Removing or renaming a column in the same release can break it.

## Release to customers

Once `tutors-dev` has been checked, open a pull request **from `develop` into `main`**. Merging does not deploy. Run the **Deploy production** Action yourself and type `deploy` to confirm; it then checks the merged commit, applies migrations to `tutors_ai`, deploys `tutors`, and checks `/api/health`. Verify a real user flow after it succeeds. For an urgent fix, branch from `main`, use a pull request into `main`, then bring that fix back into `develop`.

## Owner setup before the first release

The workflow files currently live on the `ci-cd-and-batch-transcription` feature branch, not `main` or `develop`. The remote `develop` branch exists. The repository does not prove which settings have been completed in external dashboards, so check these in order:

1. Review and merge the pipeline branch into `develop`, then promote it to `main` once staging works. GitHub Actions cannot run a workflow from an unmerged branch for those targets.
2. Reconcile `tutors_dev`'s existing schema and migration history **before** enabling staging deployment. The one-off script `scripts/ops/reconcile-tutors-dev.sh` describes the previously observed state; review its assumptions against the live project and its backup before running it. Do not run `db reset` on a cloud project. Record the confirmed baseline version in the repository variable `STAGING_SUPABASE_BASELINE_VERSION` and set `STAGING_MIGRATIONS_BASELINED=true` only after reconciliation.
3. Check production migration history separately. Record its confirmed baseline version in the repository variable `PRODUCTION_SUPABASE_BASELINE_VERSION` and set `PRODUCTION_MIGRATIONS_BASELINED=true` only after confirming it.
4. Connect both Vercel projects to this one GitHub repository. Set `tutors`'s Production Branch to `main` and `tutors-dev`'s to `develop`. Give each project's Production slot only its matching Supabase URL/keys, Stripe mode, LiveKit, Storage, Deepgram, webhook, and cron values. Configure separate Auth redirect URLs and service webhooks for each stable domain. Confirm Vercel Git deployment of `main` and `develop` is disabled so GitHub Actions controls release order.
5. Add the repository secrets and variables listed in [CI-CD.md](CI-CD.md#github). They are **repository-level and prefixed** (`PRODUCTION_*`, `STAGING_*`) rather than held in GitHub Environments, because Environments and their secrets are ignored on private repositories on the Free plan. Protect both Git branches with pull requests and required CI checks — branch protection is unaffected by that limitation. Production has no automatic trigger and no approval rule; the gate is that a human runs the workflow and types the confirmation.
6. Use a reachable stable URL for each Action's `STAGING_URL` / `PRODUCTION_URL`, and confirm `/api/health` returns 200 after release. A protected URL needs an authenticated smoke check; an HTTP 401/403 is a failed check, not proof that the app works.

The exact GitHub variable and secret names are in [CI-CD.md](CI-CD.md#github). Keep production credentials away from feature branches and developers' local files.

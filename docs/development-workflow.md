# Developer workflow: one repository, two live apps

Start here if you are new to the project. [CI-CD.md](CI-CD.md) has the detailed release and recovery notes.

## The map

There is **one long-lived branch, `main`.** Both live apps come from it; they differ only in when they deploy and which credentials they hold.

| | Deploys when | Vercel project | Supabase project |
| --- | --- | --- | --- |
| Your `feature/*` branch | Never; a pull request runs checks | — | Your local database |
| **Staging** | Automatically, on every merge to `main` | `tutors-dev` | `tutors_dev` |
| **Production** | Only when a human dispatches it | `tutors` | `tutors_ai` |

```text
feature branch --PR + checks--> main --migrate tutors_dev--> deploy tutors-dev   (automatic)
                                  |
                                  +--manual dispatch--> migrate tutors_ai --> deploy tutors
```

Vercel projects are separate copies of the app with their own settings and secrets; Supabase projects are separate databases. A Vercel project's **Production** environment means its stable live slot, so the Production slot of `tutors-dev` still holds **development** credentials.

Migrations are applied **before** app code, in both environments. Vercel's own Git deployment is disabled for `main` in `vercel.ts` to preserve that order — GitHub Actions owns releases.

A green pull request means its checks passed. It does not mean anything was released.

### Why one branch

There used to be a `develop` branch that staging deployed from, with promotion pull requests into `main`. Two long-lived branches diverge: a squashed promotion, or anything merged straight into `main`, leaves each branch holding commits the other lacks, and recovering means resolving conflicts or force-pushing. It happened twice.

One branch cannot diverge from itself. It also means `main`'s branch protection — pull requests required, three checks required — now covers staging too, where the old `develop` branch was unprotected and anything pushed to it deployed unreviewed.

The cost is that anything merged is immediately eligible for a production dispatch. You control the dispatch, and every production release is tagged, so what shipped is always recoverable.

## First day on the project

1. Clone the repository and run `npm ci` with Node 24.
2. Get **development** environment variables from the owner into an ignored `.env.local`. Check that `NEXT_PUBLIC_SUPABASE_URL` is the development project's URL. Never copy production keys. Do not run `vercel env pull .env.local` blindly: the local Vercel link currently points to `tutors`, and a pull from that project could replace your development credentials.
3. Run `npm run dev` and open `http://localhost:3000`.
4. For SQL changes, start the local Supabase stack with `npx supabase start`. Your local database is separate from both cloud projects.

Your laptop can use `tutors_dev` for app development if you need shared test data, but that means local actions can change staging data. Use local Supabase for schema work and fake data only. Ask the owner for the development API keys; the service role key stays on the server and must never be committed or put in a `NEXT_PUBLIC_` variable.

## Make a change

```bash
git switch main
git pull origin main
git switch -c feature/short-description
```

Make the change, run it locally, then open a pull request **into `main`**. Squash and merge once the checks are green and it has been reviewed.

Merging deploys to **staging** automatically: migrations are applied to tutors_dev, then `tutors-dev` is deployed, then its health is checked. Watch the **Deploy staging** Action and test the real behaviour on the staging URL. If that Action fails, nothing was released, even though your pull request passed.

For a database change, create the file with `npx supabase migration new describe_change`, write the SQL, and commit it. Apply it to your **local** database with `npx supabase db reset --local --no-seed`. If you changed an RLS or Storage policy, update the matching checks in `supabase/tests/`. Never edit a cloud database through Supabase Studio or the SQL editor, and never edit a migration that has already merged — change the schema with a new one.

Prefer additive database changes. Migrations run before the new app deploys, so the old app briefly runs against the new schema; removing or renaming a column in the same release can break it.

The workflow lint check also compares the PR's merge result with its base commit. Existing SQL migration files must keep their path and contents: edits, deletions, and renames fail CI. You can freely edit a new migration on your feature branch until it merges.

CI only validates migrations when your change could affect the result, so an app-only pull request finishes that check in seconds and says so in its run summary. That is expected, not a check that failed to run.

## Release to customers

Nothing reaches production automatically. Once the change is on `main` and you have checked it on staging:

```bash
gh workflow run "Deploy production" --ref main -f confirm=deploy
```

The typed confirmation is the gate — there is no approval rule to click. The release then:

1. Checks confirmation, branch, baseline flag, credentials, and a successful staging workflow run for this exact commit. If staging is still running or failed, production stops before touching its services; dispatch it again after staging succeeds.
2. Re-runs the full check suite against that exact commit, always validating migrations.
3. Verifies production's migration history matches the repository, and refuses if it does not.
4. Prints the migration plan, then applies it.
5. Deploys, checks `/api/health`, and reports any schema drift.
6. **Tags the released commit** as `production-<date>-<run>`.

Read the printed plan before letting it proceed. If a step fails *after* migrations were applied, the job says so and prints the rollback command, because at that point the database is ahead of the running app.

Because production deploys whatever `main` was at dispatch time, that tag is the only record of which commit went live. `git tag -l 'production-*'` is how you answer "what was running then?" later.

Prefer a forward fix to a rollback. `vercel rollback` restores the previous app, but migrations do not roll back — an older app against a newer schema is only safe for additive changes.

## What is already set up

Both environments release through the pipeline and have been exercised against reality. `main` is protected — pull requests required, three checks required, admins included, no force pushes. Both Vercel projects are configured, all secrets and variables are set, and transcription has been verified end to end on staging.

As a new contributor you should not need to configure anything. You need Docker running for `npm run test:db`, and a `.env.local` for local development.

## What is not set up

- **A second LiveKit project.** Staging and production share one, so they share API keys — and a LiveKit key can mint a token for any room in its project, including a live lesson. This is the largest remaining isolation gap.
- **`STRIPE_WEBHOOK_SECRET` on `tutors-dev`**, so Stripe webhooks fail on staging.
- **An application test suite.** Database authorisation is covered by `supabase/tests/`; the Next.js layer is not.

Before the first paying student there is a separate checklist — Stripe live mode, a second LiveKit project, Auth redirect URLs and the data-protection questions. See [Before taking real payments](CI-CD.md#before-taking-real-payments). Everything on it is safe to defer now and unsafe to defer past launch.

Full detail, including every secret and variable name, is in [CI-CD.md](CI-CD.md). Keep production credentials out of feature branches and local files.

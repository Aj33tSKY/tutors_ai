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

CI only validates migrations when your change could affect the result, so on an app-only pull request that check finishes in seconds and says so in its run summary. That is expected, not a check that failed to run. Anything touching `supabase/migrations/`, `supabase/tests/`, `supabase/config.toml` or the pinned Supabase CLI validates in full.

## What may reach main

Only two kinds of pull request:

- **`develop` → `main`**, a promotion. The normal route; everything on `develop` has already run on staging.
- **`hotfix/*` → `main`**, for something urgent that cannot wait for a staging cycle. Merge `main` back into `develop` afterwards, or the branches diverge.

The **Promotion source** Action enforces this — a pull request into `main` from anything else fails. Branch protection can require checks and reviews but cannot say where a pull request may come from, so this covers that gap.

It matters for dependency updates in particular: **Dependabot reads `.github/dependabot.yml` from the default branch only.** Changing `target-branch` on `develop` has no effect until that change is promoted to `main`.

## Which merge button to use

This matters more than it looks, and it is not enforceable in GitHub settings — merge methods are repository-wide, so the repository cannot require one for `main` and another for `develop`.

| Pull request | Use | Why |
| --- | --- | --- |
| feature → `develop` | **Squash and merge** | Keeps `develop` readable: one commit per change |
| `develop` → `main` | **Create a merge commit** | Keeps `main` a descendant of `develop` |

Squashing a promotion is the one that causes damage. It creates a commit on `main` that is absent from `develop`'s history, so the two branches diverge even though their content is identical — and recovering means resolving conflicts or force-pushing a branch.

The **Branch parity** Action checks this after every push to either branch and fails if they have diverged, naming the likely cause and the fix. If it goes red, fix it before doing anything else; the longer the branches stay forked, the more painful the merge.

## Release to customers

Once `tutors-dev` has been checked, open a pull request **from `develop` into `main`**. Merging does not deploy. Run the **Deploy production** Action yourself and type `deploy` to confirm; it then checks the merged commit, applies migrations to `tutors_ai`, deploys `tutors`, and checks `/api/health`. Verify a real user flow after it succeeds. For an urgent fix, branch from `main`, use a pull request into `main`, then bring that fix back into `develop`.

## What is already set up

Staging works. A merge to `develop` applies migrations to tutors_dev, deploys `tutors-dev`, and health-checks it, and a real lesson has produced a correctly attributed transcript. `main` is protected, both Vercel projects are configured, and all secrets and variables are set at repository level.

So as a new contributor you should not need to configure anything to start work. You need Docker running for `npm run test:db`, and `.env.local` for local development.

## What is not set up

Production has **never been released by this pipeline**. Before it can be:

- A second LiveKit project, so staging stops sharing production's API keys.
- `STRIPE_WEBHOOK_SECRET` on `tutors-dev`.
- `PRODUCTION_MIGRATIONS_BASELINED=true`, set only after re-checking production's migration history.

Also worth knowing: **`develop` is not branch-protected**, so it is possible to push to it directly. Don't — the pipeline assumes changes arrive reviewed, and a migration pushed straight to `develop` deploys to staging without anyone having read it.

Full detail, including every secret and variable name, is in [CI-CD.md](CI-CD.md). Keep production credentials out of feature branches and local files.

# Development workflow

How to make a change to this project and get it in front of real users, safely.

## What an "environment" actually is

The same code runs in three places. The only thing that differs is which credentials it is given.

| | Runs where | Branch | Database | Money |
| --- | --- | --- | --- | --- |
| **Local** | your laptop, `npm run dev` | whatever you checked out | tutors_dev | Stripe test |
| **Staging** | `tutors-dev` Vercel project | `develop` | tutors_dev | Stripe test |
| **Production** | `tutors` Vercel project | `main` | production | Stripe live |

### The word "Production" is overloaded

Every Vercel project has a **Production** environment scope, meaning "the live slot of this project". `tutors-dev` has one too. It is *not* your production, and it must hold staging credentials only.

When someone says "push to production" they mean the `tutors` project. When Vercel says "Production environment variables" on `tutors-dev`, it means staging.

### Known overlaps

- Local and staging share the tutors_dev database. Developing locally can overwrite staging data. Do not treat staging data as precious.
- All environments currently share one LiveKit project, so they share API keys. Splitting this is outstanding work.

## Day-to-day: changing the app

Start from `develop`, never from `main`.

```bash
git checkout develop
git pull
git checkout -b feature/short-description
```

Make your change, then run what CI will run, so you find problems in seconds rather than minutes:

```bash
npm run dev                  # try it for real
npm run lint
npx next typegen && npx tsc --noEmit
```

Then open a pull request **into `develop`**:

```bash
git push -u origin feature/short-description
gh pr create --base develop
```

CI runs automatically. Once it is green and reviewed, merge. Merging to `develop` deploys to staging: migrations are applied to tutors_dev first, then the app deploys, then a health check runs.

Check your change on the staging URL before going further.

## Day-to-day: changing the database

This is the part that goes wrong most often, so it has its own rules.

```bash
npx supabase migration new describe_your_change
```

That creates a timestamped file in `supabase/migrations/`. Write your SQL there, then prove it applies to an empty database:

```bash
npx supabase db reset --local --no-seed
npm run test:db
```

If you touched RLS or storage policies, **add or update a test in `supabase/tests/`**. Those tests are the only thing standing between a typo and a student reading another student's lesson.

Three rules that matter more than they look:

1. **Never edit the SQL in the Supabase dashboard.** The repository is the source of truth. A dashboard edit makes the database disagree with the migration history, and deployment then refuses to run until someone reconciles it by hand.
2. **Never edit a migration that has already merged.** It has already run in other databases. Write a new migration that changes what the old one did.
3. **Prefer additive changes.** Migrations run *before* the new app deploys, so for a moment the old app is talking to the new schema. Adding a nullable column is safe. Renaming or dropping one breaks the running app. To remove something: add the new shape, ship code that uses it, migrate the data, and drop the old shape in a *later* release.

## Promoting staging to production

Production is a pull request from `develop` into `main`:

```bash
gh pr create --base main --head develop --title "Release: <what's in it>"
```

CI re-runs against that exact commit — passing once on a feature branch is not enough, because the merge result is code no one has built before. After merge:

1. The production workflow waits for a human to approve the `production` GitHub Environment.
2. It verifies the migration history matches the repository, and refuses if it does not.
3. It applies migrations to the production database.
4. Only then does it deploy the app.
5. It polls `/api/health` and reports any schema drift.

That order is the whole point: the database is always ready before the code that needs it arrives.

If something breaks after release, **prefer a forward fix**. Rolling back code is easy; rolling back a migration usually is not.

## Fixing something urgently

A production hotfix still goes through `main` via a pull request — the approval gate and migration checks are what keep an urgent change from becoming an outage. Branch from `main`, PR into `main`, then merge `main` back into `develop` so staging does not drift behind.

## Quick reference

| Task | Command |
| --- | --- |
| Start a feature | `git checkout develop && git pull && git checkout -b feature/x` |
| Run locally | `npm run dev` |
| Check like CI does | `npm run lint && npx tsc --noEmit` |
| New migration | `npx supabase migration new name` |
| Test migrations from scratch | `npx supabase db reset --local --no-seed` |
| Run RLS tests | `npm run test:db` |
| Ship to staging | PR into `develop` |
| Ship to production | PR from `develop` into `main` |

On macOS, `npm run test:db` may fail to pull its Docker image. Prefix it:

```bash
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" npm run test:db
```

## Before this workflow actually works

Setup still outstanding, tracked in [CI-CD.md](CI-CD.md):

- `tutors-dev` has no environment variables yet, so staging cannot run.
- tutors_dev's migration history is not reconciled, and staging deploys deliberately refuse to run until `STAGING_MIGRATIONS_BASELINED=true`.
- The `staging` and `production` GitHub Environments and their secrets do not exist yet, and the `production` environment has no required reviewer — so the approval step described above is not enforcing anything.
- `main` has no branch protection, so it is currently possible to push straight to production without a pull request.

# Application tests and database upgrade tests

Status: design, based on the application and migrations inspected on 26 September 2026. The proposed commands and files below are not implemented yet. Existing checks are app lint/types/build, workflow lint, migration immutability, clean database migrations, schema lint, pgTAP RLS checks, and deployment health.

## Goal

Catch failures in login, booking creation and viewing, access denial, invoice handling, and upgrades of databases containing existing rows. Make the same tests repeatable on a developer's laptop and in GitHub Actions with no production credentials or customer data.

Unit tests alone cannot prove cookies, Next.js routing, PostgREST grants, RLS, or upgrades work. Use four layers with clear responsibilities:

| Layer | Tool | Dependencies | What it proves |
| --- | --- | --- | --- |
| Unit and action/route tests | Vitest, Node environment | Mock Next navigation/cache and external boundaries | Validation, calculations, authority decisions, error handling, provider calls |
| Database authorization and integrity | Existing pgTAP suite, extended | Disposable local Supabase | Actual grants, RLS, triggers, constraints and privileged-field protection |
| Application smoke tests | Playwright, Chromium initially | Built Next.js app and disposable local Supabase | Real login/cookies, server actions, routing, persisted bookings, HTTP webhooks and denials |
| Migration upgrades | Local Supabase runner plus SQL assertions | Old schema, representative fake rows, pending migrations | Existing data survives and satisfies the new schema and behavior |

Keep async Server Components in browser tests. The installed Next.js testing guide explicitly recommends E2E coverage for them. Do not mock Supabase in browser or upgrade tests; that would remove the boundary being tested.

## Repeatability and fixture rules

1. Each integration run gets its own temporary project directory, Supabase project ID, database, and ports. It must not reset a developer's existing local stack, tutors_dev, or tutors_ai. The runner owns only the stack it created and cleans it up in a finally handler.
2. Read credentials from the newly created local stack. Refuse non-loopback app, Supabase, or database destinations. Do not inherit an existing .env.local; explicitly override all provider variables when starting the test app. Also reject unexpected external network access from fixtures and browser flows.
3. Use reserved fake emails and UUIDs, and separate users per scenario: student A, unrelated student B, tutor A, tutor B, linked parent, unrelated parent, and a trusted admin. Create admin privileges through the fixture administrator after signup, never through public signup metadata.
4. Fixtures are explicit factories, not one shared mutable demo seed. Only the arrangement phase uses the service client. Exercise every user operation with that user's real session; independently verify writes with a scoped fixture administrator.
5. Browser contexts are fresh per test. Seed a unique booking/request per scenario and clean its users and dependent rows afterward. Reset the whole disposable stack between upgrade scenarios. Do not depend on test order.
6. Freeze time in unit tests. Browser tests use a runner-selected future UTC date, and choose timezone-specific dates explicitly for DST checks. Do not depend on the machine timezone or a hard-coded date becoming past.
7. Stub Stripe/LiveKit/Deepgram/AI at their external HTTP or SDK boundary. Never create real charges or send customer emails. A synthetic Stripe payload should use the real SDK signature helper and the real route's signature verification, with a local fake secret.
8. Avoid sleeps. Wait for a visible state, a known database row, or an HTTP response with a bounded timeout. Use one browser worker initially; parallelize only after fixtures are isolated.
9. Pin test dependencies in package.json and commit the lockfile. Commit assertions and fixtures, not generated auth state, reports, screenshots, or database dumps.

## Initial application coverage

Every row below includes both success and rejection cases. Check persisted side effects, not only a returned success message.

| Area | Required cases | Layer |
| --- | --- | --- |
| Signup | Student/tutor/parent, whitespace, required fields, short password, duplicate email, confirmation required, malicious admin/unknown role, provider failure | Action + browser + database |
| Sign-in/out | Correct password, incorrect password, expired session, provider outage, protected-route redirect, session cleared on logout; return destination behavior defined explicitly | Action + browser |
| Profile creation | Missing role-specific row created once; repeated login preserves saved details; missing profile denied; failed bootstrap not silently treated as success | Action + database |
| Lesson requests | Offered subject/board, available future slot, malformed input, forged timestamp/day/time tuple, past slot, overlapping booking, tutor missing, missing session, failed reads/writes, trial eligibility | Action + database + browser |
| Tutor confirmation | Only addressed tutor, pending request only, single/weekly schedule, recurrence bounds and integer validation, unavailable rate, real overlap vs adjacent bookings, later-week conflict, correct request linkage and trial | Action + database + browser |
| Tutor-created lessons | Tutor role and student relationship, single and 2–12 weekly lessons, 1–3 hour durations, rate snapshot multiplied by duration, first lesson free, conflict checks, database outage, request transition | Action + database + browser |
| Booking viewing | Student/tutor/linked parent permitted where intended; unrelated users denied; absent/invalid UUID; completed review only; no private recording URL exposed | Database + browser |
| Session lifecycle | Tutor-only start/complete/cancel; unstarted/scheduled/completed/cancelled states; preserve original started_at; rename limits; reschedule preserves duration; cancel one vs its series; started sessions excluded | Action + database |
| Calendar boundaries | Adjacent sessions allowed; overlap rejected; quarter-hour validation; UTC offsets; UK DST change; weekly time policy; simultaneous scheduling of the same slot | Unit + database/integration |
| Invoice sending | Tutor owner only; completed, paid lesson only; no trial/zero charge; valid customer; payout capability; correct currency, total and fee; provider and DB failure; repeated/concurrent submit | Action + controlled integration |
| Invoice webhook | Signed paid and failed events; missing/wrong/stale signature; tampered body; unknown event; absent metadata; wrong invoice/booking ID; duplicate event; failed DB write; paid then delayed failure; event before invoice linkage | Route + database + HTTP |
| Access denial | Call actions/API directly and use Supabase's public API with user credentials; do not rely on hidden UI buttons. Deny role escalation, protected billing writes and unauthorized participant changes | Action + database + browser/API |

### First browser smoke suite

1. Anonymous visitor requesting a dashboard is sent to sign-in. Incorrect login produces an error; correct login reaches the correct role dashboard; logout removes access.
2. Student A sends a request to tutor A. Assert one pending request and no booking/charge. Tutor A confirms it through the UI; assert one scheduled trial, the request transition, and student A's booking view.
3. Student B cannot view A's completed booking, its review, or its session room. Linked parent can view the permitted review but cannot join the room. Tutor B cannot start, complete, cancel or invoice it.
4. Submit a signed synthetic invoice.paid event over HTTP for a seeded completed paid lesson. Assert payment_status changes only on the matching booking. Repeat it, send a delayed failure, and send a bad signature; assert the final state and responses.

Do not add a production-only bypass or test API route to make the flows testable. Fixtures can arrange state through local Supabase without changing the app's access model.

## Broader application coverage

Add these after the first four flows, using the same fixtures and test boundaries:

| Area | Risks to cover |
| --- | --- |
| Availability and tutor discovery | Invalid/overlapping intervals, ownership, empty schedules, subject/board filtering, unverified/public data rules, timezone consistency |
| Direct messages and files | Authorized pair only, forged sender/conversation, empty/oversized content, allowed MIME/path/size, failed upload, signed URL failure, parent denial |
| Live session tokens and consent | Only booking participants receive tokens, only tutor opens lesson/consents, cancelled/completed states, token room/identity/permissions, missing LiveKit configuration |
| LiveKit webhook | Signature failure, unknown room/participant, duplicate and out-of-order events, per-track attribution, repeated joins, Egress failure and retry, DB/storage failure |
| Transcription | Silence, timestamps/offsets, speaker merging, resumed lesson append, settling interval, active track skip, provider timeout, attempts limit, concurrency, failed cleanup and orphan pagination |
| Summary/embeddings | Empty/partial transcripts, repeat processing, failed embedding write, retry after partial write, dimensional compatibility, grounding only from authorized lessons |
| Revision chat | Malformed input, user-only messages, conversation ownership, quota boundaries, UTC reset, concurrent requests, duplicate message ID, database failure, model failure, disconnected stream persistence |
| Recording retention | Cron authentication, expiry boundary, private access, successful deletion, Storage failure before metadata update, metadata failure after deletion, repeat run |
| Parent/admin portals and payouts | Role restrictions, actual parent linkage, trusted admin provisioning, payout capabilities/disabled accounts, provider failures |

Unit coverage reports should include the business modules under test and branch coverage. Set numerical thresholds after the initial suite establishes a baseline. A percentage is not a substitute for testing every money/access decision's allowed, denied, retry and failure cases.

## Database upgrade coverage

The existing clean reset remains required. Add a second runner that proves upgrades with populated databases.

### Runner contract

1. Select a baseline commit/migration version from a checked-in scenario manifest.
2. Build a disposable local database with only migrations through that baseline.
3. Load that scenario's fake rows using the old schema. Run before assertions to prove the rows exercise the intended conditions.
4. Apply newer migrations in their real timestamp order through the pinned Supabase CLI. Preserve real migration history; do not fake success with migration repair.
5. Run after assertions: IDs, relationships, totals and protected data survive; expected transformed values are exact; constraints/grants/RLS behave as intended.
6. Apply pending migrations again through the CLI. Assert no further pending changes or data mutations. This tests deployment retry behavior, not an assumption that every SQL file can be rerun manually.
7. Report baseline, target, scenario, assertions and failures; always stop and remove the runner-owned stack.

Validate the baseline and SQL path manifest before executing it. A missing fixture, missing baseline or empty assertion set fails; a skipped scenario cannot silently turn a required job green.

### Historical regression scenarios

| Baseline / change | Fake rows | Assertions after upgrade |
| --- | --- | --- |
| Before pending-payment default | Existing paid/pending/failed bookings and future invoice data | Existing payment states unchanged; new unpaid lesson defaults to pending |
| Before started-session backfill (after started_at is added) | Scheduled lesson with transcript; no transcript; completed/cancelled lessons; existing non-null started_at | Only eligible scheduled transcript rows get analytics.created_at; original start values and all other rows survive |
| Before nullable follow-up subjects | Existing subject/board bookings and requests | Existing context preserved; supported follow-up booking can omit subject/board; times/FKs remain enforced |
| Before private helper migration | Existing users, linked parent, bookings, messages and legacy policies | Trigger still creates safe profiles; authorization helpers still work; public RPC privilege exposure denied |
| Before transcript audio migration | Existing transcript/analytics, recording metadata and consent | Historical content unchanged; new tables/defaults valid; transcript audio private for every user role |

Do not copy production records to reproduce these shapes. Include null values, Unicode names, realistic relationships, invoice IDs, overlapping boundaries and legacy rows deliberately.

### New migration PRs

For PRs adding migrations, also test the PR base schema with a maintained representative fixture. Apply every added migration to that populated schema and assert preservation. A migration that adds a constraint or backfill needs a focused fixture and postcondition in the same PR.

Representative rows evolve with the base schema; historical scenarios remain versioned. New fixture factories must not reference columns that do not exist at their chosen baseline. The upgrade manifest belongs outside supabase/tests so ordinary pgTAP execution cannot accidentally run it against the latest schema.

Small fake datasets prove correctness; they do not prove production-scale locking or runtime. Large-table rewrites/backfills need a separate representative-volume rehearsal and lock/runtime review before release.

## Proposed file structure and commands

```text
vitest.config.mts
playwright.config.ts
tests/unit/auth-actions.test.ts
tests/unit/lesson-requests.test.ts
tests/unit/session-actions.test.ts
tests/unit/invoice-actions.test.ts
tests/unit/stripe-webhook.test.ts
tests/unit/transcription.test.ts
tests/support/clock.ts
tests/support/provider-stubs.ts
tests/support/local-stack.mjs
tests/support/fixtures.ts
tests/smoke/auth.spec.ts
tests/smoke/bookings.spec.ts
tests/smoke/access.spec.ts
tests/smoke/invoice-webhook.spec.ts
tests/upgrades/scenarios.json
tests/upgrades/<scenario>/before.sql
tests/upgrades/<scenario>/after.sql
scripts/ci/run-app-smoke.mjs
scripts/ci/run-db-upgrades.mjs
supabase/tests/05-profile-authority.test.sql
supabase/tests/06-booking-authority.test.sql
supabase/tests/07-lesson-requests.test.sql
```

Proposed scripts: npm test (one unit run), npm run test:watch, npm run test:coverage, npm run test:smoke (owns local stack/app), npm run test:upgrades (owns isolated databases), and existing npm run test:db. Document exact setup and cleanup once implemented. There must be no requirement for a Supabase cloud login or Stripe account to run the mandatory suite.

## CI integration

- Run unit/action/route tests inside the existing app job on every PR and release.
- Keep the existing required check names stable. Run new smoke checks in a dedicated job and make the app job depend on it so the existing required app check covers smoke failures; branch protection need not silently miss a newly named check.
- Give smoke its own runner-owned local Supabase stack and build the app with its credentials. Do not reuse the placeholder CI build against a real local database: NEXT_PUBLIC values are embedded during the build.
- Extend the migrations job to run clean-schema checks and populated-upgrade scenarios when relevant. Add tests/upgrades, runner helpers and relevant fixture changes to its scope filter. Production continues to validate upgrades unconditionally.
- Always run the smoke job, including app-only PRs. Unit mocks and a database check alone cannot detect a broken form or action boundary.
- The reusable CI workflow must be awaited by staging and production. Their callers must grant any new permissions requested by CI; keep the existing permission checker.
- Upload browser traces/screenshots and concise assertion reports on failure with short retention. Fixture credentials and auth cookies should not be printed. Set explicit job timeouts; do not use retries to mask deterministic failures.

Target: fast units on every change; one Chromium smoke suite; database upgrades only where relevant plus every production release. Measure actual runtimes before introducing path skips or more browsers.

## Issues found during design

These are source-review findings, not live exploitation tests. Confirm them in the disposable local environment and add regressions for the intended behavior. P0 access issues should block release; P1 money/reliability issues should be fixed before relying on these flows.

| ID | Priority | Evidence and failure | Required regression / disposition |
| --- | --- | --- | --- |
| AUTH-01 | P0 | Auth action accepts arbitrary role; initial handle_new_user copies raw_user_meta_data.role into profiles, including admin. Moving the function to private did not change this logic. | Direct public signup requesting admin must never obtain it. Enforce the public-role allowlist in the DB trigger as well as the action. |
| AUTH-02 | P0 | Profile INSERT/UPDATE policies only restrict id; no checked-in protection restricts role or stripe_customer_id changes. RLS ownership does not protect privileged columns. | A student using the Data API cannot change role or billing identity. Verify actual grants locally; protect fields in the DB, not just forms. |
| BOOK-01 | P0 | Booking UPDATE policies check participants but do not restrict payment_status, amount, invoice IDs or participants. Student INSERT policy still allows direct confirmed self-bookings outside the request workflow. | User sessions cannot forge payment, price or another participant, and direct creation follows the approved flow. Define allowed operations before replacing the broad policies. |
| BILL-01 | P1 | Stripe route logs an UPDATE error then returns HTTP 200, without durably queuing the event. | DB failure must produce a retryable response; replay after recovery reaches the correct state. |
| BILL-02 | P1 | invoice.payment_failed unconditionally updates matching bookings to failed even after invoice.paid. | Duplicate/delayed failure must not downgrade a settled payment. Include concurrent arrival checks at the DB boundary. |
| BILL-03 | P1 | createTutorSessionAction accepts 1–3 hours but stores tutor.hourly_rate as the full booking amount. | Paid 2/3-hour sessions have 2/3 times the hourly snapshot; trial remains zero. |
| BILL-04 | P1, race to reproduce | Invoice action creates/sends the provider invoice before saving its ID; no idempotency key or atomic claim. Concurrent submits can create duplicates, and an early paid event matches zero rows and is acknowledged. | Simultaneous sends create one invoice; delayed DB linkage and retries cannot lose payment state. |
| BILL-05 | P1 | Invoice action tries to save stripe_customer_id on the student's profile using the tutor's user client; the profile UPDATE policy permits only the profile owner. The write result is ignored. | A validated tutor invoice can persist the customer's ID through an appropriately scoped privileged operation; subsequent invoices reuse it. |
| BOOK-02 | P1 | Lesson request validates a client-supplied day/time separately from its timestamp. A valid available tuple can accompany a different future timestamp. | Tampered availability data must be rejected; derive or verify the selected slot server-side under a defined timezone. |
| BOOK-03 | P1, race to reproduce | Scheduling checks conflicts then inserts without a checked-in overlap constraint or atomic request claim. Query errors can also look like no conflicts. | Concurrent same-slot confirmations produce at most one booking; failed reads never permit an insert. |
| TIME-01 | P2, policy needed | Weekly recurrence adds seven UTC days. Across UK DST the wall-clock lesson time moves by an hour. Request scheduling parses datetime-local using server timezone; tutor-created scheduling uses an offset. | Decide whether recurring lessons preserve local wall time; use one timezone contract and test both DST transitions. |
| AUTH-03 | P2 | Protected routes and lesson requests supply a next destination, but signInAction always redirects to /dashboard. | Decide whether to resume the requested page; if implemented, validate a safe local destination and test open-redirect attempts. |
| CHAT-01 | P2 | Chat JSON/message shape is not validated and DB count/write errors are ignored. A failed quota query is treated as zero; concurrent quota checks are non-atomic. | Invalid input gets a controlled response; storage/quota failure prevents provider spending; concurrent requests cannot exceed the agreed cap. |
| AUDIO-01 | P2, race to reproduce | Transcript is appended before discardAudio removes files/marks rows. If deletion fails, ready rows remain; the next run can append the same audio again. Concurrent workers have no explicit claim. | Failed cleanup/retry and overlapping cron runs cannot duplicate transcript content. |

The current RLS suite covers outsider access but does not cover self-escalation or protected field changes. Do not treat its existing green result as evidence these issues are prevented.

## Delivery order and acceptance

1. Reproduce AUTH-01/02 and BOOK-01 locally, agree the public role and booking operation contracts, fix them with new migrations, and keep explicit regression tests. Do not edit existing migrations.
2. Install/configure the test runners and fixture lifecycle; prove a clean checkout can run the suite twice with identical results and no leaked processes/data.
3. Implement the initial action/route cases and four real application smoke flows; fix the narrow billing defects with their regressions.
4. Add historical upgrade scenarios plus the populated PR-base upgrade path; prove each fixture exists before migration and each postcondition afterward.
5. Wire CI and update the developer runbook. Verify negative checks can fail: denied access, lost data in a backfill, and failed provider persistence must produce a red result.
6. Expand the broader application matrix in priority order. Track remaining cases explicitly; do not call the application comprehensively covered after only the initial smoke suite.

Known defects should have issue IDs and a failing reproduction during repair. Do not encode unsafe behavior as a passing expected result, permanently skip regression cases, or report an expected-failure suite as a release gate that proves the bug fixed.

## Reference guidance

- Installed Next.js guides: node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md and playwright.md.
- [Vitest module mocking](https://vitest.dev/guide/mocking/modules).
- [Supabase database testing](https://supabase.com/docs/guides/database/testing) and [pgTAP](https://supabase.com/docs/guides/database/extensions/pgtap).
- [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security): user metadata is editable and must not authorize privileged access.
- [Stripe webhooks](https://docs.stripe.com/webhooks): design for retries, duplicate events and events arriving out of order.

# Kindling — UK A-Level STEM Tutoring Platform

Implementation of `docs/mvp_plan.md`: tutor discovery & booking, live WebRTC sessions with
transcription, post-session analytics, and a RAG revision chatbot — for UK A-Level Maths,
Further Maths, Physics, Chemistry, Biology and Computing.

## Stack

Next.js 16 (App Router) · Tailwind v4 + shadcn/ui · Supabase (Postgres + Auth + pgvector) ·
Vercel AI SDK (AI Gateway) · Framer Motion.

## What's live

- **Marketing site** — landing page, tutor discovery (`/tutors`, filterable by subject/exam
  board), tutor profiles, how-it-works, pricing, safeguarding/about.
- **Auth** — real Supabase email/password signup with role selection (student/parent/tutor),
  backed by a DB trigger that creates the `profiles` row and RLS policies scoping every table.
- **Booking** — students book real sessions against seeded tutor availability; bookings are
  written to Postgres and readable from both the student and tutor dashboards.
- **Dashboards** — role-based shells for student, tutor, parent and admin, all reading live data.
- **Revision chatbot** (`/dashboard/student/chat`) — live on the AI Gateway (`openai/gpt-5.4-nano`),
  grounded in `session_embeddings` for that student, streaming via `useChat`. Conversations
  persist to Postgres (`chat_conversations` / `chat_messages`) with a sidebar of past chats —
  nothing is lost on refresh. System prompt is tuned for short, spoken, markdown-free answers.
- **Payments** — booking a session goes through real Stripe Checkout (test mode); a booking row
  is only ever created by the webhook once payment succeeds, never optimistically. Tutors connect
  a Stripe Express account (`/dashboard/tutor/payouts`) to get paid directly via destination
  charges; until they do, payment settles to the platform and the tutor is paid out manually.

### Chatbot cost controls

Set at the top of `src/app/api/chat/route.ts`:

| Control | Default | Why |
| --- | --- | --- |
| `HISTORY_WINDOW` | last 12 messages | Only the recent window is sent to the model each turn — without this, cost per message grows with the *entire* conversation length, not just that turn. Full history still displays in the UI and is stored in full. |
| `DAILY_MESSAGE_LIMIT` | 40 user messages/student/day | Checked before any model call, so an over-limit request costs $0. Returns a 429 the client renders as a friendly "resets at midnight" message. |
| `MAX_OUTPUT_TOKENS` | 600 | Hard ceiling per reply, independent of what the model would otherwise generate. |

These are flat defaults, not tied to the pricing plan yet (see the table below).

### AI Gateway model & billing notes

- Using `openai/gpt-5.4-nano`, not `gpt-5.4-mini` — `mini` returned "Free tier users do not
  have access to this model" even after a card was added and the Vercel account moved to Pro.
  Adding a card ≠ having spendable Gateway credits; that needs an explicit top-up at
  `vercel.com/[team]/~/ai` → top-up. `nano` works on the free tier and is materially cheaper, so
  it's the default rather than a fallback — swap the model string back to `mini` in
  `src/app/api/chat/route.ts` if/when credits are topped up and the stronger model is wanted.
- Auth to the Gateway is via Vercel OIDC (automatic for a linked project, `vercel link` +
  `vercel env pull`) — no `AI_GATEWAY_API_KEY` needed for this app.

### Payments architecture

`src/app/(marketing)/tutors/[id]/actions.ts` (`createCheckoutAction`) creates a Stripe Checkout
Session and redirects there — it **never** writes a `bookings` row itself. Fulfillment happens
only in `src/app/api/webhooks/stripe/route.ts`, on `checkout.session.completed` **and**
`checkout.session.async_payment_succeeded` (gated on `session.payment_status !== 'unpaid'`), per
Stripe's own guidance: delayed-notification payment methods fire `completed` before the payment
has actually gone through, so fulfilling on that event alone would grant unpaid bookings and miss
ones that succeed later. `stripe_checkout_session_id` is unique, so a retried or duplicate webhook
delivery can't double-book — verified by replaying the same signed event twice and confirming only
one row exists.

Tutor payouts use Stripe's **v2 Accounts API** (`stripe.v2.core.accounts.create`), not the
deprecated `stripe.accounts.create({ type: 'express' })` v1 pattern. Payout eligibility
(`transfer_data.destination` on the Checkout Session) is decided with a **live** capability check
against Stripe on every checkout and every payouts-page load — never from a cached DB flag —
because it's a money-movement decision, not just a display concern.

One live-API surprise worth flagging: Stripe's own docs/skill guidance say a marketplace
`recipient`-only connected account (just `stripe_balance.stripe_transfers`) shouldn't need
`merchant.card_payments`. This sandbox's actual API rejected that combination and required both
capabilities together — confirmed by testing the account-creation call directly against the
sandbox. The code requests both; it doesn't change what charges are actually made (still
destination charges, still `recipient`-owned transfers).

### What's stubbed (needs credentials only you can provide)

| Module | Status | What's needed |
| --- | --- | --- |
| WebRTC video room (`/session/[id]`) | UI shell only | A LiveKit or Daily.co account + `LIVEKIT_*` / `NEXT_PUBLIC_LIVEKIT_URL` env vars |
| Live transcription | Not started | Deepgram account + `DEEPGRAM_API_KEY`, wired to the video room's audio track |
| Post-session LLM summarizer | Not started | Depends on the transcription pipe existing first |
| Chat limits by plan tier | Flat limit only | Once a real subscription model exists, tie `DAILY_MESSAGE_LIMIT` to pay-as-you-go vs subscriber |
| Tutor DBS document upload | Admin queue UI only, no upload | `@vercel/blob`, private access, form on tutor onboarding |
| Stripe production webhook | Test-mode only, via Stripe CLI locally | Once deployed, add a webhook endpoint in the Stripe dashboard pointing at `/api/webhooks/stripe` for `checkout.session.*`, and set `STRIPE_WEBHOOK_SECRET` to its signing secret |
| Live-mode Stripe | Sandbox/test mode only | `vercel integration resource claim stripe-emerald-arrow` to attach this to a real Stripe account, then go through Stripe's own account activation |

## Local development

```bash
npm install
vercel env pull .env.local   # re-sync if env vars change in the Vercel dashboard
npm run dev
```

To exercise payments locally, run the Stripe CLI listener alongside `npm run dev` — it forwards
real test-mode events to your machine and prints a `whsec_...` signing secret to put in
`.env.local` as `STRIPE_WEBHOOK_SECRET` (this changes every time you start it):

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed
```

Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.

## Database

Schema + RLS policies live in `supabase/schema.sql` (already applied to the linked Supabase
project). Re-run it after any schema change:

```bash
# via the Supabase SQL editor, or psql against POSTGRES_URL_NON_POOLING
```

`supabase/seed.mjs` seeds 6 demo tutors (run with `node supabase/seed.mjs`, reads
`SUPABASE_SERVICE_ROLE_KEY` from `.env.local`). Demo tutor accounts:
`priya.m@demo.kindling.app` (and 5 others, see `supabase/seed-data.mjs`), password
`KindlingDemo2026!`.

## Project structure

```
src/app/(marketing)/         public site: landing, /tutors discovery, /tutors/[id], how-it-works, pricing, about
src/app/(auth)/              sign-in / sign-up + server actions
src/app/dashboard/           role-based dashboards (student, tutor, parent, admin)
src/app/dashboard/student/chat/       /chat redirects to the most recent (or a new) conversation
src/app/dashboard/student/chat/[id]/  the actual chat UI, sidebar, create/delete conversation actions
src/app/session/[id]/        WebRTC room shell (pending LiveKit/Daily integration)
src/app/api/chat/            RAG chatbot streaming endpoint — persistence, windowing, daily cap live here
src/app/api/webhooks/stripe/ Checkout fulfillment — the only place a paid booking gets created
src/app/dashboard/tutor/payouts/  Stripe Connect (v2) onboarding + live payout-status check
src/lib/supabase/            browser/server/proxy Supabase clients + profile bootstrapping
src/lib/supabase/admin.ts    service-role client for the webhook (no user session to read cookies from)
src/lib/stripe.ts            lazy Stripe client (avoids crashing `next build` before keys exist)
supabase/schema.sql          full schema + RLS, matches docs/mvp_plan.md §3 plus chat_* and payment columns
```

## Verification

Nothing above was taken on faith — checked with exploratory `node` scripts against the live
Supabase/Stripe sandboxes (not committed; scratch files loading `.env.local`):

- Signup → DB trigger → RLS-scoped booking insert/read-back; a second student confirmed unable to
  read another's `chat_messages` rows.
- The real `/api/chat` route hit with an authenticated session cookie end to end (200, streamed
  reply, both messages persisted, title auto-generated).
- The AI Gateway tested directly with `generateText` before and after the billing change described
  above.
- Stripe: a plain Checkout Session created live against the sandbox; a v2 Connect account created,
  linked for onboarding, and its capability status read back live; a real signed
  `checkout.session.completed` event delivered to the local webhook (via `stripe
  webhooks.generateTestHeaderString`) and confirmed it creates exactly one booking — replayed the
  identical event a second time and confirmed no duplicate; a forged signature confirmed rejected
  with 400.

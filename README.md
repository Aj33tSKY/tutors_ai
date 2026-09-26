# Kindling — UK A-Level STEM Tutoring Platform

For new contributors, start with [the developer workflow](docs/development-workflow.md).
It explains the single repository, `tutors-dev` / `tutors` deployments and database
migrations. There is one long-lived branch: staging releases automatically on every
merge to `main`, and production releases the same commits only when a human
dispatches it. The pipeline itself is
documented in [docs/CI-CD.md](docs/CI-CD.md), and transcription in
[docs/transcription.md](docs/transcription.md).

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
- **Lesson requests** — students select tutor-published availability; a request sends a formatted
  DM and creates no booking or charge until its tutor confirms the schedule.
- **Dashboards** — role-based shells for student, tutor, parent and admin, all reading live data.
- **Revision chatbot** (`/dashboard/student/chat`) — live on the AI Gateway (`openai/gpt-5.4-nano`),
  grounded in `session_embeddings` for that student, streaming via `useChat`. Conversations
  persist to Postgres (`chat_conversations` / `chat_messages`) with a sidebar of past chats —
  nothing is lost on refresh. System prompt is tuned for short, spoken, markdown-free answers.
- **Payments** — a student's first lesson with a tutor is a free trial. After a tutor marks a
  paid lesson complete, they send a Stripe invoice; the invoice webhook owns paid/failed state.
- **Live video** (`/session/[bookingId]`) — real LiveKit room per booking, using LiveKit's prebuilt
  `VideoConference` UI (camera/mic, screen share, in-call text chat all included). Access is
  server-checked before a token is ever minted: only the booking's own student or tutor can join
  (not other users, not even a linked parent — deliberate, for safeguarding); everyone else gets a
  404, not a redirect, so the booking's existence isn't leaked either. Token minting happens
  entirely server-side in the page component — there's no separate public token endpoint.
- **Session transcription** — the LiveKit webhook starts a recording and the app's cron
  transcribes it in batches with Deepgram. See [transcription setup](docs/transcription.md).
- **Post-session summarizer** (`src/app/api/cron/summarize-sessions`) — a Vercel Cron job (every 5
  minutes, `vercel.ts`) finds completed bookings with a transcript but no summary yet, extracts
  spec-mapped topics/misconceptions/homework via the AI Gateway, computes a talk-time ratio from
  the transcript directly (no LLM needed for that part), and chunks + embeds the transcript into
  `session_embeddings` — this is what actually grounds the revision chatbot; before this, that
  table was always empty. The student dashboard's "Topics covered" card reads this live.
- **Per-session review** (`/dashboard/student/bookings/[bookingId]`) — each completed booking has
  its own review with the LLM overview, topics, action points, misconceptions and full transcript.
  When recording is enabled, the same page plays the session video from a private, short-lived URL.

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

The tutor-page action creates a `lesson_requests` row and a formatted direct message; it never
calls Stripe. Tutors set the actual time and an optional weekly run from their portal. Once a paid
lesson is complete, the tutor's **Send invoice** action creates a Stripe `send_invoice` invoice due
in seven days. `invoice.paid` and `invoice.payment_failed` update the matching booking in the
Stripe webhook handler.

Tutor payouts use Stripe's **v2 Accounts API** (`stripe.v2.core.accounts.create`), not the
deprecated `stripe.accounts.create({ type: 'express' })` v1 pattern. Payout eligibility
(`transfer_data.destination` on the Stripe invoice) is decided with a **live** capability check
against Stripe whenever an invoice is sent and every payouts-page load — never from a cached DB flag —
because it's a money-movement decision, not just a display concern.

One live-API surprise worth flagging: Stripe's own docs/skill guidance say a marketplace
`recipient`-only connected account (just `stripe_balance.stripe_transfers`) shouldn't need
`merchant.card_payments`. This sandbox's actual API rejected that combination and required both
capabilities together — confirmed by testing the account-creation call directly against the
sandbox. The code requests both; it doesn't change what charges are actually made (still
destination charges, still `recipient`-owned transfers).

### Post-session summarizer notes

Same AI Gateway billing story as the chatbot, twice over: `openai/text-embedding-3-small` — the
model `session_embeddings.embedding` was originally sized for (`vector(1536)`) — needs paid
credits this account doesn't have, same as `gpt-5.4-mini` did. Switched to
`google/text-embedding-005`, which works on the free tier (768 dims), and resized the column to
`vector(768)` to match (safe — the table was empty). The summary-extraction call itself
(`generateObject` with `gpt-5.4-nano`) worked on the first try with no billing issue. If credits
get topped up later, both the embedding model and the column dimension need to change together.

The extraction prompt is deliberately conservative: told not to invent spec point numbers or
misconceptions/homework that aren't actually evidenced in the transcript, empty arrays over
guesses. Verified against a real physics tutoring transcript — correctly extracted the exact spec
point from the plan's own example (`Edexcel Physics 4.2 — Particle Accelerators`), real
misconceptions, real homework, and a plausible talk ratio; verified separately against a
low-content test transcript that it returns empty results rather than hallucinating.

### What's stubbed (needs credentials only you can provide)

| Module | Status | What's needed |
| --- | --- | --- |
| Batch transcription | Implemented in the app | Needs `DEEPGRAM_API_KEY` and a signed LiveKit webhook in each Vercel project; see [transcription setup](docs/transcription.md) |
| Chat limits by plan tier | Flat limit only | Once a real subscription model exists, tie `DAILY_MESSAGE_LIMIT` to pay-as-you-go vs subscriber |
| Tutor DBS document upload | Admin queue UI only, no upload | `@vercel/blob`, private access, form on tutor onboarding |
| Stripe production webhook | Test-mode only, via Stripe CLI locally | Once deployed, add a webhook endpoint in the Stripe dashboard pointing at `/api/webhooks/stripe` for `invoice.paid,invoice.payment_failed`, and set `STRIPE_WEBHOOK_SECRET` to its signing secret |
| Live-mode Stripe | Sandbox/test mode only | `vercel integration resource claim stripe-emerald-arrow` to attach this to a real Stripe account, then go through Stripe's own account activation |
| In-call whiteboard / KaTeX formula editor | Not started | Plan mentions Excalidraw + KaTeX; LiveKit's data channel (`canPublishData`, already granted) can carry whiteboard sync without another service |

### Video calling notes

LiveKit isn't in the Vercel Marketplace (only Mux — video streaming, not real-time calls), so this
needed a manual [LiveKit Cloud](https://cloud.livekit.io) project and three env vars:
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL`. Until all three are set,
`/session/[bookingId]` shows a "video isn't configured yet" state instead of erroring — checked
via `livekitConfigured()` in `src/lib/livekit.ts`.

## Local development

```bash
npm install
# Get development values for .env.local from the owner. The local Vercel link
# currently points to tutors, so a blind env pull can fetch production values.
npm run dev
```

To exercise post-session invoices locally, run the Stripe CLI listener alongside `npm run dev` — it forwards
real test-mode events to your machine and prints a `whsec_...` signing secret to put in
`.env.local` as `STRIPE_WEBHOOK_SECRET` (this changes every time you start it):

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe \
  --events invoice.paid,invoice.payment_failed
```

Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC.

Vercel Cron only fires on real deployments, so trigger the summarizer manually while developing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/summarize-sessions
```

### Session recording

The tutor explicitly opts in on the session page. When they join, a signed LiveKit webhook starts
RoomComposite Egress and writes an MP4 segment to the private `session-recordings` Supabase Storage
bucket. When the tutor leaves, the webhook stops Egress; rejoining creates another segment, which
the review page plays in order. A daily cron deletes each segment after 90 days. Playback uses
short-lived signed URLs and Storage RLS; no public recording URL is stored.

Before enabling this in a deployment:

1. Create a private `session-recordings` bucket in Supabase Storage and generate S3 connection
   credentials. Set `SUPABASE_STORAGE_S3_ACCESS_KEY_ID`, `SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY`,
   and `SUPABASE_STORAGE_S3_REGION` in the app environment.
2. Set `DEEPGRAM_API_KEY` in that Vercel project for batch transcription.
3. Configure LiveKit Cloud to POST its signed webhook events to `/api/webhooks/livekit`
   using that environment's API key pair.
4. Apply the Supabase migration and redeploy the app so the 90-day cleanup cron is active.

### Direct messages and homework attachments

`/dashboard/student/tutors` and `/dashboard/tutor/students` provide one private conversation for
each tutor–student pair with a shared booking. Messages support images, PDFs, and Word documents
up to 10 MB. Before deploying, create a **private** `message-attachments` Storage bucket with a
10 MB limit and restrict its allowed MIME types to the file types accepted by the UI. The SQL RLS
policies enforce participant-only reads/uploads using paths shaped
`<conversation-id>/<sender-id>/<file-name>`; parents deliberately do not inherit message access.

This is an MVP messaging store, so make two policy decisions before real student use: a retention
period for messages/files, and malware scanning for uploaded homework. Neither is implemented by
the app or supplied automatically by Storage.

## Database

Schema changes are released through versioned files in `supabase/migrations/`.
Create a new migration for each change; never re-run `supabase/schema.sql` or
edit a cloud database directly. See [the developer workflow](docs/development-workflow.md).

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
src/app/session/[id]/        live LiveKit video room — server page mints the token, client renders VideoConference
src/app/api/chat/            RAG chatbot streaming endpoint — persistence, windowing, daily cap live here
src/app/api/webhooks/stripe/ Checkout fulfillment — the only place a paid booking gets created
src/app/dashboard/tutor/payouts/  Stripe Connect (v2) onboarding + live payout-status check
src/lib/supabase/            browser/server/proxy Supabase clients + profile bootstrapping
src/lib/supabase/admin.ts    service-role client for the webhook (no user session to read cookies from)
src/lib/stripe.ts            lazy Stripe client (avoids crashing `next build` before keys exist)
src/lib/livekit.ts           token minting + room naming (one room per booking id)
supabase/migrations/          versioned schema and RLS changes deployed by GitHub Actions
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
- Video room access control: a real booking's own student could load `/session/[id]` (200); a
  second, unrelated student got a 404 rather than any indication the booking exists; an
  unauthenticated request was redirected to `/sign-in?next=...`. Actual audio/video was verified
  working live in a real call.
- Transcription: verified end to end against a real two-person call on staging — real speech came
  back as correctly-attributed text in `session_analytics.full_transcript`, roughly three minutes
  after the tutor left, with `talk_ratio` and `summary_notes` generated from it. The always-on
  LiveKit agent this used to need has been removed; audio-only per-track egress plus the
  `transcribe-sessions` cron replaced it. See [docs/transcription.md](docs/transcription.md),
  including the two failure modes that produce silence rather than an error.

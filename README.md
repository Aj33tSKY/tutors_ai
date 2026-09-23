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

### Chatbot cost controls

Set at the top of `src/app/api/chat/route.ts`:

| Control | Default | Why |
| --- | --- | --- |
| `HISTORY_WINDOW` | last 12 messages | Only the recent window is sent to the model each turn — without this, cost per message grows with the *entire* conversation length, not just that turn. Full history still displays in the UI and is stored in full. |
| `DAILY_MESSAGE_LIMIT` | 40 user messages/student/day | Checked before any model call, so an over-limit request costs $0. Returns a 429 the client renders as a friendly "resets at midnight" message. |
| `MAX_OUTPUT_TOKENS` | 600 | Hard ceiling per reply, independent of what the model would otherwise generate. |

These are flat defaults, not tied to the pricing plan yet — see "Next up" below.

## What's stubbed (needs credentials only you can provide)

| Module | Status | What's needed |
| --- | --- | --- |
| WebRTC video room (`/session/[id]`) | UI shell only | A LiveKit or Daily.co account + `LIVEKIT_*` / `NEXT_PUBLIC_LIVEKIT_URL` env vars |
| Live transcription | Not started | Deepgram account + `DEEPGRAM_API_KEY`, wired to the video room's audio track |
| Post-session LLM summarizer | Not started | Depends on the transcription pipe existing first |
| Stripe billing / payouts | Not started | `vercel integration add stripe` (Marketplace), then wire booking checkout |
| Chat limits by plan tier | Flat limit only | Once Stripe billing exists, tie `DAILY_MESSAGE_LIMIT` to pay-as-you-go vs subscriber |
| Tutor DBS document upload | Admin queue UI only, no upload | `@vercel/blob`, private access, form on tutor onboarding |

## Local development

```bash
npm install
vercel env pull .env.local   # re-sync if env vars change in the Vercel dashboard
npm run dev
```

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
src/app/(marketing)/   public site: landing, /tutors discovery, /tutors/[id], how-it-works, pricing, about
src/app/(auth)/        sign-in / sign-up + server actions
src/app/dashboard/     role-based dashboards (student, tutor, parent, admin)
src/app/session/[id]/  WebRTC room shell (pending LiveKit/Daily integration)
src/app/api/chat/      RAG chatbot streaming endpoint
src/lib/supabase/      browser/server/middleware Supabase clients + profile bootstrapping
supabase/schema.sql    full schema + RLS, matches docs/mvp_plan.md §3
```

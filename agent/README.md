# Kindling transcription agent

A [LiveKit Agent](https://docs.livekit.io/agents/) that joins every tutoring session room as a
silent participant, transcribes the tutor's and student's audio separately via Deepgram, and
saves the finished transcript to Supabase (`session_analytics.full_transcript`) when the call
ends. It also flips the booking's `status` to `completed`.

This is a **separate, always-on service** from the Next.js app in `../` — it cannot run on
Vercel (serverless functions can't hold the persistent connection an agent needs), and it isn't
part of that app's build.

## How it finds the right booking

Room names are `booking-<uuid>` (minted in `../src/lib/livekit.ts`). The agent parses the
booking id straight out of the room name — no separate lookup or dispatch metadata needed. It
uses automatic dispatch (no `agentName` set), so it joins every room in this LiveKit project;
since every room in this project *is* a tutoring session, that's correct here; if that ever
changes, switch to explicit dispatch instead of filtering post-hoc.

## Speaker attribution

Each participant gets their own Deepgram stream, keyed to their own LiveKit track — LiveKit
already keeps each speaker's audio separate, so this is more reliable than asking Deepgram to
diarize a single merged track. Role (`student` vs `tutor`) comes from the participant metadata
set at token-mint time (`src/lib/livekit.ts`'s `createParticipantToken`), not guessed.

## Local development

```bash
pnpm install
pnpm approve-builds --all   # once — @livekit/local-inference needs a native build step
```

Copy the values already in the main app's `.env.local` into this directory's `.env.local`:

```
LIVEKIT_URL=              # same value as NEXT_PUBLIC_LIVEKIT_URL in ../.env.local
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
DEEPGRAM_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Then, with the main app's `npm run dev` also running so you can actually join a call:

```bash
pnpm dev   # lk agent dev — hot reload, connects to your real LiveKit Cloud project
```

There's no local LiveKit server in this setup — dev mode connects to the real Cloud project and
registers as a worker there, the same as production, just with hot reload. Join a real session
from the main app (two browser tabs, student + tutor) and the agent will be dispatched into that
room automatically.

**Verified so far:** the worker registers with LiveKit Cloud, receives a job when a room is
created, connects, correctly parses the booking id from the room name, and shuts down cleanly
when the room empties — confirmed by connecting a throwaway test participant and watching the
agent's logs, both via `pnpm dev` and the compiled `pnpm start`. Actual Deepgram transcription
was **not** verified end-to-end in that session (no `DEEPGRAM_API_KEY` was available yet) — the
Deepgram plugin's own constructor throws a clear error if the key is missing, and that's caught
per-track rather than crashing the whole agent, so confirm real transcript text lands in
`session_analytics` once you have a key and a real call with two people talking.

## Deploying (LiveKit Cloud Agents)

This needs the [LiveKit CLI](https://github.com/livekit/livekit-cli) (`lk`) and Docker (Cloud
deployment builds a container image). Install `lk`:

```bash
brew install livekit-cli
# or download a prebuilt binary from https://github.com/livekit/livekit-cli/releases
```

Project is already registered locally (`lk project list` should show `kindling`). First deploy:

```bash
lk agent create
```

This builds the Dockerfile in this directory, deploys to LiveKit Cloud, and writes a
`livekit.toml` recording the agent's id — commit that file once it exists. It'll prompt for the
same secrets as the `.env.local` above (`--secrets-file` avoids the prompts in CI).

Subsequent deploys, after code changes:

```bash
lk agent deploy
```

Useful commands once deployed: `lk agent status`, `lk agent logs` (tail), `lk agent secrets`
(inspect what's set — never prints values), `lk agent rollback`.

## Why this design, not alternatives

- **A LiveKit Agent, not a webhook + batch job**: transcription needs to observe live audio as
  it happens; there's no artifact to fetch after the fact unless you set up separate egress
  recording, which adds storage and another moving piece for no benefit here.
- **Per-track Deepgram streams, not Deepgram's own diarization**: the room already tells us
  exactly who's who per track; acoustic diarization is a worse, guessed version of information
  we already have for free.
- **`upsert` on `session_analytics.booking_id`**: an agent restart (crash, redeploy) mid-session
  reconnects to the same room and would otherwise create a duplicate `full_transcript` row.

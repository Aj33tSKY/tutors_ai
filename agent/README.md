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

Needs its own `.env.local` in this directory (not shared with the main app's — see the path bug
note below for why the location matters), copied from the values already in `../.env.local`:

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

**Verified end to end** against a real two-person call: the worker registers with LiveKit Cloud,
receives a job when a room is created, connects, transcribes real speech via Deepgram, correctly
attributes it to `[Student]`/`[Tutor]`, saves it to `session_analytics.full_transcript`, and flips
the booking to `completed` on shutdown.

### A path bug worth knowing about

`agent.ts` and `session.ts` each call `process.loadEnvFile()` before importing anything that reads
`process.env` at import time (see "Why three files" below). Both computed `.env.local`'s path
relative to their own location in `src/` — one directory too shallow, since `.env.local` lives at
this package's root, not inside `src/`. `existsSync()` just silently returned false and skipped
loading; nothing errored until a real job tried to construct the Deepgram or Supabase client,
minutes into using the app, which made it look like an env-inheritance problem across
`@livekit/agents`' per-job process fork rather than the one-line path mistake it actually was.
Caught it by adding temporary diagnostic logging and reading the actual computed path, rather than
continuing to guess. If you restructure these files, keep the `join(dirname(selfPath), "..",
".env.local")` one level up.

### Why three files, not one

`agent.ts` — loads env, then hands the framework `session.ts`'s path (a string, not an import).
`session.ts` — loads env *again* (separate process; see above), then dynamically imports
`session-impl.ts`. `session-impl.ts` — the actual `defineAgent` logic. The split exists because
`@livekit/agents-plugin-deepgram` reads `DEEPGRAM_API_KEY` into a module-level default object the
instant it's imported — a static top-level import is always hoisted above any other code in the
importing file, so a single-file version would read the env var before it was ever loaded, no
matter where the `loadEnvFile()` call was written in that file. Dynamic, path-based loading is
what lets "load env, then import" actually happen in that order.

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

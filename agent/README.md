# Kindling transcription agent

A [LiveKit Agent](https://docs.livekit.io/agents/) explicitly dispatched after the tutor joins a
tutoring room. It transcribes the tutor's and student's audio separately via Deepgram and appends
the segment to Supabase (`session_analytics.full_transcript`) when the tutor leaves. A room
disconnect does not complete the booking; the tutor does that explicitly in the dashboard, so a
late start or reconnect remains possible.

This is a **separate, always-on service** from the Next.js app in `../` — it cannot run on
Vercel (serverless functions can't hold the persistent connection an agent needs), and it isn't
part of that app's build.

## How it finds the right booking

Room names are `booking-<uuid>` (minted in `../src/lib/livekit.ts`). The agent parses the booking
id from the room name. Explicit dispatch means it joins only after the tutor joins; it shuts down
when the tutor leaves, even if the student remains in the room. On a tutor rejoin, a fresh job
continues the existing transcript.

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
LIVEKIT_AGENT_NAME=kindling-transcription
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Then, with the main app's `npm run dev` also running so you can actually join a call:

```bash
pnpm dev   # lk agent dev — hot reload, connects to your real LiveKit Cloud project
```

There's no local LiveKit server in this setup — dev mode connects to the real Cloud project and
registers as a worker there, the same as production, just with hot reload. Set `LIVEKIT_AGENT_NAME`
to the same name configured for the Cloud Agent. Configure the app's LiveKit webhook to post
`participant_joined`, `participant_left`, and `egress_ended` events to
`/api/webhooks/livekit`; a tutor join triggers explicit dispatch.

The transcription path was previously verified in local dev mode against a real two-person call.
The explicit-dispatch and tutor-departure lifecycle must be deployed and exercised against the
LiveKit Cloud webhook before production use.

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

Set `LIVEKIT_AGENT_NAME` in the agent and app environments to the same explicit dispatch name.
The app also needs the private `session-recordings` Supabase Storage bucket's S3 credentials to
start tutor-consented Egress recordings.

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

- **LiveKit Agent plus Egress**: Deepgram needs live audio streams; Egress separately captures
  tutor-consented video and audio. Both follow tutor presence, while the booking stays scheduled
  until the tutor explicitly completes it.
- **Per-track Deepgram streams, not Deepgram's own diarization**: the room already tells us
  exactly who's who per track; acoustic diarization is a worse, guessed version of information
  we already have for free.
- **`upsert` on `session_analytics.booking_id`**: an agent restart (crash, redeploy) mid-session
  reconnects to the same room and would otherwise create a duplicate `full_transcript` row.

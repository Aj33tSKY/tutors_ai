# Portable lesson worker handover

The Node worker now handles stereo transcription, summary/embedding generation,
recording retention and LiveKit recording control. The API persists signed LiveKit
webhooks (`POST /v1/webhooks/livekit`) and the worker starts and stops Egress. See
[LiveKit recording control](#livekit-recording-control) for the cutover.

## Credentials and installation

Apply repository migrations before installing the job schema. Give the worker a
dedicated PostgreSQL login with `NOINHERIT`, `NOBYPASSRLS`, no superuser, no role
creation, no schema ownership and no Auth table privileges. Use a direct or
session-pooler connection, not transaction pooling. Keep staging and production
logins and queues in their respective Supabase databases.

The release owner installs queues and grants the existing runtime role only the
queue tables and enumerated private lesson functions:

```sh
node dist/migrate-jobs.mjs --runtime-role tutors_worker
```

Only this release command receives `APP_JOBS_MIGRATION_DATABASE_URL`. API and
worker containers never receive it. Worker runtime receives
`APP_JOBS_DATABASE_URL`, the private R2 bucket credentials, `DEEPGRAM_API_KEY`
and `AI_GATEWAY_API_KEY`. `DEEPGRAM_MODEL` defaults to `nova-3`.

The explicit Gateway key replaces Vercel's ambient OIDC credentials; the SDK
supports model strings outside Vercel with this key ([official documentation](https://ai-sdk.dev/unauthenticated-ai-gateway)).
Models and vector dimensions are unchanged by this extraction.

## Scheduler ownership

The migration defaults `private.lesson_job_control.owner` to `legacy`. A worker
can be deployed and checked without taking ownership. All three legacy cron
routes now consult the same database flag and fail closed if it cannot be read.
Deploy these updated legacy routes before attempting a handover; an older
Vercel deployment does not understand the ownership fence.

Use the release owner connection with these commands, first on staging:

```sh
node dist/job-ownership.mjs legacy paused
# Verify every in-flight legacy cron invocation has finished in provider logs.
# Check the worker is healthy and provider/storage credentials have been tested.
node dist/job-ownership.mjs paused worker
```

`paused` stops new claims in both runtimes. It does not cancel a running
transcription/model request. Do not skip the drain observation between commands.
The second command refuses while an unexpired worker lease exists. The command
checks the expected owner and changes it transactionally; startup never changes
ownership automatically.

Rollback follows the same pause/drain sequence:

```sh
node dist/job-ownership.mjs worker paused
# Observe active handlers finish; do not re-enable legacy jobs while they run.
node dist/job-ownership.mjs paused legacy
```

If returning to the worker after a legacy window, pause and drain again. The
transition checkpoints the current aggregate transcript and retires completed
segment ledger entries, so text appended by legacy processing is preserved.
Recording completion markers remain intact.

## Durability and limits

- Discovery runs on startup and each heartbeat, scanning oldest unfinished
  records rather than only the most recent 50 completed lessons. pg-boss stores
  versioned jobs; singleton keys reduce redundant enqueueing.
- A transcription claim atomically increments the recording attempt and obtains
  a ten-minute lease. Only that lease token can publish. A provider failure
  releases the lease; a process crash recovers after lease expiry. The existing
  three-attempt budget remains authoritative.
- Segment result, chronological aggregate and `transcribed_at` are one database
  transaction. Replayed work cannot append the same segment twice. Existing
  transcripts are retained as a baseline.
- Summary publication checks the source transcript, booking state, previous
  summary and lease. Embeddings and summary publish in one transaction. Tutor
  notes are checked at publication time and preserved. Existing summaries are
  retained when embeddings need repair. A changed transcript refreshes retrieval
  data without overwriting the established reflection notes.
- Deepgram fetches a private signed R2 URL itself. Neither API nor worker buffers
  the recording. Provider requests have explicit deadlines. Retention deletes
  the object before marking it expired; replaying object deletion is safe.
- Failures exhaust their budget rather than retrying provider calls indefinitely.
  Operational dead-letter alerts, manual replay tooling, observed queue latency,
  actual provider acceptance and a staging soak remain cutover requirements.

Local integration tests use a fresh runner-owned database and provider stubs.
They exercise RLS, restricted credentials, concurrent claims, replay, lease
expiry, stale publication, provider failure, preservation of tutor edits and
retention. They do not demonstrate live Deepgram/AI/LiveKit connectivity or an
observed staging handover.

## LiveKit recording control

The API verifies the LiveKit signature, stores only the normalised event (room's booking,
participant identity, track id, or the Egress outcome) in `private.provider_events` keyed by
LiveKit's event id, and answers 200 (503 if it could not store, so LiveKit retries). The worker
applies events through enumerated private SQL functions; its login still cannot read
application tables.

Guarantees, each covered by the integration suite with a fake media server:

- A recording row is reserved **before** LiveKit is asked to record. Unique indexes make a
  duplicate join or repeated `track_published` a no-op, so a crash after the external call
  leaves a row to reconcile, never a second job.
- The booking, not the payload, decides who the tutor is; consent and an open lesson are required.
- Screen starts retry in-process for about a minute (a busy Egress node refuses silently), then
  fail the row. A share that ends first abandons the retry. Audio start failures free the slot and
  retry after 5, 15 and 30 seconds.
- The file's own media start and end are stored for playback alignment.
- **Reconciler (every 30 s):** reservations older than 3 minutes that never reached LiveKit are
  failed (after stopping stray jobs in the room); jobs unreported for 10 minutes are settled from
  LiveKit's own record, so a lost `egress_ended` no longer leaves a recording `active` forever.

Cutover (staging first). LiveKit supports several webhook URLs, but run **one** receiver at a time:
the legacy and new handlers share the same tables and the legacy one stops "stray" jobs.

1. Deploy API and worker. Give the worker `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
   `NEXT_PUBLIC_LIVEKIT_URL` and the R2 variables; give the API `APP_EVENTS_DATABASE_URL`.
   Without LiveKit credentials the worker leaves recording events queued, visible in
   `private.provider_event_backlog`.
2. Change `WEBHOOK_URL` in the LiveKit deployment to `https://<api-domain>/v1/webhooks/livekit`
   through the **Deploy LiveKit** workflow. Installing restarts LiveKit and drops calls in
   progress, so do it when nobody is connected; the workflow refuses otherwise unless forced.
3. Make a staging call: audio row `active`, tutor screen share row `active`, both `ready` after
   the call, transcript produced. Roll back by restoring the old URL; events already stored are
   applied by the worker when it returns, and the legacy route is untouched until retired.

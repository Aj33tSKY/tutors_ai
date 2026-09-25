# Session transcription

Transcripts are produced **after** a lesson, from short-lived audio recorded during it. There is no always-on service involved.

```text
tutor joins ──► track_published (per microphone) ──► audio-only track egress
                                                          │
tutor leaves ──► egress stopped ──► egress_ended ──► status: ready
                                                          │
                     transcribe-sessions cron (every 5 min)
                                                          │
          Deepgram prerecorded ──► interleave ──► session_analytics.full_transcript
                                                          │
                                              audio deleted immediately
```

## Why it is built this way

**One egress per microphone track, not one per room.** Each file contains exactly one speaker, so attribution is a property of *which file* the words came from. The alternative — a single mixed file plus acoustic diarization — guesses at who spoke, and guesses wrong when people talk over each other. Lessons are full of that.

**Audio only, never video.** A transcript needs no pixels. Audio-only egress is cheaper to produce and to store, and it keeps this pipeline entirely separate from the consented video recording.

**Deleted as soon as it is used.** These files are a processing buffer. The cron deletes them the moment the transcript is written, and `pruneExpiredAudio` removes anything older than 24 hours regardless of what went wrong. Nothing accumulates.

**Batch, not live.** Nothing displays a transcript during a lesson — it is read afterwards by the summariser, the parent dashboard and the transcript-grounded chat. Prerecorded transcription is cheaper than streaming, and it is retryable: a failed transcription can run again against the same file, where a crashed live agent lost that lesson's transcript permanently.

## How the timeline is reconstructed

Each track's file starts when that track was published, which is not when the lesson started — a student joining thirty seconds after their tutor produces a file that begins thirty seconds late.

Every segment therefore records `started_at`, and `transcribeBooking` measures each one against the earliest start in that session. Deepgram returns utterance timestamps relative to each file, and adding that per-file offset puts every speaker on one shared timeline before the turns are sorted and merged.

Getting this wrong does not throw — it silently produces a transcript where one person appears to say everything first. `src/lib/transcription.ts`'s `formatTranscript` is pure and unit-testable precisely so this can be checked without a real call.

## Output format

One line per turn, consecutive utterances from the same speaker merged:

```text
[Tutor] Hello, ready to start?
[Student] Yes I am.
```

This format is a contract. `talkRatio` and `consolidateTranscriptTurns` in `src/app/api/cron/summarize-sessions/route.ts` parse it with regexes, and the booking detail page renders it directly. Changing it means changing them.

## Failure handling

- Each attempt increments `transcribe_attempts`; after 3 the segments are marked `failed` and their audio is deleted rather than retried forever.
- A session with any segment still `starting` or `active` is skipped — a lesson in progress is never transcribed halfway.
- A two-minute settle window after the last segment ends lets a reconnecting tutor publish a new track before transcription runs.
- A tutor who leaves and rejoins produces new tracks. Their transcript is **appended**, matching the rule that leaving a room is not the same as completing a lesson.

## Operational requirements

| Requirement | Where |
| --- | --- |
| `DEEPGRAM_API_KEY` | Vercel, both environments |
| `DEEPGRAM_MODEL` | Optional override; defaults to `nova-3` |
| LiveKit webhook → `/api/webhooks/livekit` | Signed with that environment's API key pair. All event types are delivered; `track_published` needs no enabling |
| `session-transcript-audio` bucket | Created by migration; no manual setup |
| `SUPABASE_STORAGE_S3_*` credentials | Already required by video recording; egress writes both buckets |

`LIVEKIT_AGENT_NAME` is no longer used by anything and can be removed from both environments.

## What this replaced

A LiveKit Agent (`agent/`) that joined every room, held one Deepgram **streaming** connection per participant, and wrote the transcript on shutdown. It worked, but it was a third always-on deployable with its own Dockerfile, registry, release process and failure modes — and it streamed every participant's full audio, silence included, at streaming rates.

Its useful design notes live on here: per-track attribution, append-on-rejoin, and `[Tutor]`/`[Student]` formatting all came from it. Its deployment machinery did not survive, which was the point.

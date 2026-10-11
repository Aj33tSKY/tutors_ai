# Session transcription

Transcripts are produced **after** a lesson, from the same recording a student can play back. There is no always-on service involved, and there is no separate video recording — audio only.

```text
tutor joins ──► one stereo Egress job for the whole call
                   (tutor's track → left channel, student's → right)
tutor leaves ──► egress stopped ──► egress_ended ──► status: ready
                                                          │
                     transcribe-sessions cron (every 5 min)
                                                          │
          Deepgram prerecorded, multichannel ──► session_analytics.full_transcript
                                                          │
                                   recording is kept — it is the playable one
```

## Why it is built this way

**One Egress job per call, not two or three.** The previous design recorded one audio-only Egress per participant microphone track, purely to feed Deepgram, separate from the consented video recording — 2-3 concurrent Egress jobs per live call. LiveKit's `MediaSource`/`AudioConfig`/`AudioRoute` routes each participant's track to its own channel within a *single* file instead, so concurrent-Egress usage scales with concurrent calls, not a multiple of it.

**Channel, not diarization, decides who spoke.** `AudioRoute` matches by `participant_identity`, so the tutor's audio always lands on the left channel and the student's on the right regardless of join order. Deepgram's `multichannel` option transcribes each channel independently — attribution is a property of which channel the words came from, not a guess. (`diarize` is deliberately not combined with `multichannel` here: each channel already has exactly one speaker, and diarizing it too would just relabel that one speaker "0" on both sides.)

**Audio only, never video.** A transcript needs no pixels, and dropping video recording removes an entire egress type (`RoomCompositeEgress`, backed by a headless-Chrome render — the heaviest and most failure-prone of LiveKit's Egress types) along with its cost.

**The recording is not a processing buffer — it is kept.** Earlier versions of this pipeline (and an even earlier always-on LiveKit Agent before that) treated the audio as disposable: transcribe it, then delete it. This version's consent flow is the same one that used to gate a video recording, and a student expects to be able to replay what they consented to — so the file is kept for the same 90-day window the video recording used to use (`prune-session-recordings`, unchanged), not deleted the moment a transcript is written.

**Batch, not live.** Nothing displays a transcript during a lesson — it is read afterwards by the summariser, the parent dashboard and the transcript-grounded chat. Prerecorded transcription is cheaper than streaming, and it is retryable: a failed transcription can run again against the same file, where a crashed live agent lost that lesson's transcript permanently.

## How the timeline is reconstructed

It mostly isn't anymore, which is the point of one file over several. Deepgram's `utterances` already come back in one chronological order across both channels of a single file, so `formatTranscript` just sorts by each utterance's own `start` time and merges consecutive same-channel lines into turns — no per-file offset math, because there is no second file to offset against.

## Output format

One line per turn, consecutive utterances from the same speaker merged:

```text
[Tutor] Hello, ready to start?
[Student] Yes I am.
```

This format is a contract. `talkRatio` and `consolidateTranscriptTurns` in `src/app/api/cron/summarize-sessions/route.ts` parse it with regexes, and the booking detail page renders it directly. Changing it means changing them.

## Failure handling

- `session_recordings.transcribe_attempts` increments on each attempt; after `MAX_TRANSCRIBE_ATTEMPTS` (3, exported from `src/lib/transcription.ts`) the cron stops retrying that segment. The recording itself is left alone either way — it is the user's playable file, not disposable.
- A tutor who leaves and rejoins produces a new recording segment with its own full lifecycle (its own `egress_id`, its own `ready`/`failed` status) — each one is transcribed independently and **appended** to `session_analytics.full_transcript`, matching the rule that leaving a room is not the same as completing a lesson.
- The webhook's `stopStrayEgress` lists and stops any Egress already active for a room before starting a new one. Added after staging testing showed more Egress jobs running than this webhook had ever requested — the exact source was never conclusively identified, so this makes it structurally impossible for our own code to leave more than one job per room running regardless of cause.

## Traps

- **A wrong webhook path returns 200.** Next.js answers an unknown POST path with a page, so LiveKit records a successful delivery and never retries. If no `session_recordings` rows appear at all, check the configured URL includes `/api/webhooks/livekit` before suspecting the handler.
- **Token metadata is absent from some LiveKit webhook payloads.** Role (`tutor` vs `student`) is read by comparing the event's participant identity against the booking's `tutor_id`/`student_id`, never from token metadata — the booking is authoritative anyway, and unlike metadata it cannot be omitted or spoofed.

## Operational requirements

| Requirement | Where |
| --- | --- |
| `DEEPGRAM_API_KEY` | Vercel, both environments |
| `DEEPGRAM_MODEL` | Optional override; defaults to `nova-3` |
| LiveKit webhook → `/api/webhooks/livekit` | Signed with that environment's API key pair, for `participant_joined`, `participant_left` and `egress_ended` |
| `session-recordings` bucket | Private, provisioned per environment by hand (same bucket the old video recording used) |
| `SUPABASE_STORAGE_S3_*` credentials | Egress writes to this bucket over Supabase Storage's S3 API |

`LIVEKIT_AGENT_NAME` is not used by anything and can be removed from both environments.

## What this replaced

Two designs came before this one:

1. A LiveKit Agent (`agent/`) that joined every room and held one Deepgram **streaming** connection per participant, writing the transcript on shutdown. It worked, but it was a third always-on deployable with its own Dockerfile, registry, release process and failure modes, and it streamed every participant's full audio, silence included, at streaming rates.
2. A batch pipeline that replaced the agent but still recorded one Egress per participant microphone track, kept only as a transcription buffer and deleted immediately after use, entirely separate from the consented video recording. It was retryable and had no always-on service, which were real improvements — but it cost 2-3 concurrent Egress jobs per live call, which is what actually constrains how many lessons can run at once on a given LiveKit Cloud plan.

Per-channel attribution, append-on-rejoin, `[Tutor]`/`[Student]` formatting, and the retry/attempt-count pattern all carried forward from these. What didn't survive: a second file per call, and deleting the audio once it had been transcribed.

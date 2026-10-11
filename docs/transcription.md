# Session transcription

Transcripts are produced **after** a lesson, from the same recording a student can play back. There is no always-on service involved. The only video recorded is the tutor's screen shares (see [Screen shares](#screen-shares)); the camera is never recorded.

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

tutor starts a screen share ──► second Egress job, that one track saved as-is
tutor stops sharing         ──► job ends with the track ──► status: ready
```

## Why it is built this way

**One Egress job per call, not two or three.** The previous design recorded one audio-only Egress per participant microphone track, purely to feed Deepgram, separate from the consented video recording — 2-3 concurrent Egress jobs per live call. LiveKit's `MediaSource`/`AudioConfig`/`AudioRoute` routes each participant's track to its own channel within a *single* file instead, so concurrent-Egress usage scales with concurrent calls, not a multiple of it.

**Channel, not diarization, decides who spoke.** `AudioRoute` matches by `participant_identity`, so the tutor's audio always lands on the left channel and the student's on the right regardless of join order. Deepgram's `multichannel` option transcribes each channel independently — attribution is a property of which channel the words came from, not a guess. (`diarize` is deliberately not combined with `multichannel` here: each channel already has exactly one speaker, and diarizing it too would just relabel that one speaker "0" on both sides.)

**No composite video.** A transcript needs no pixels, and dropping the composite video recording removes an entire egress type (`RoomCompositeEgress`, backed by a headless-Chrome render — the heaviest and most failure-prone of LiveKit's Egress types) along with its cost. Screen shares are recorded separately and far more cheaply; see below.

**The recording is not a processing buffer — it is kept.** Earlier versions of this pipeline (and an even earlier always-on LiveKit Agent before that) treated the audio as disposable: transcribe it, then delete it. This version's consent flow is the same one that used to gate a video recording, and a student expects to be able to replay what they consented to — so the file is kept for the same 90-day window the video recording used to use (`prune-session-recordings`, unchanged), not deleted the moment a transcript is written.

**Batch, not live.** Nothing displays a transcript during a lesson — it is read afterwards by the summariser, the parent dashboard and the transcript-grounded chat. Prerecorded transcription is cheaper than streaming, and it is retryable: a failed transcription can run again against the same file, where a crashed live agent lost that lesson's transcript permanently.

## How the timeline is reconstructed

It mostly isn't anymore, which is the point of one file over several. Deepgram's `utterances` already come back in one chronological order across both channels of a single file, so `formatTranscript` just sorts by each utterance's own `start` time and merges consecutive same-channel lines into turns — no per-file offset math, because there is no second file to offset against.

## Screen shares

While the tutor shares their screen, a second Egress job records that one video track. It starts on the `track_published` webhook for a `SCREEN_SHARE` track whose publisher is the booking's tutor, under the same recording consent, and ends by itself when the track is unpublished (`track_unpublished` stops it too, as a backstop). A tutor who shares several times gets one recording per share. Student screen shares are not recorded.

- **Saved as-is, not re-encoded.** The job uses the `PASSTHROUGH` encoding preset: no decode, no re-encode, no audio. That should be billed as a raw track export ($0.001/min on Ship) rather than a video transcode ($0.02/min) — a small fraction of what recording video normally costs. LiveKit doesn't document how passthrough is billed, so confirm it in the LiveKit Cloud usage dashboard.
- **H.264, so the files are MP4.** Passthrough keeps the track's own codec, and the container follows it: H.264 is written as MP4, VP8 as WebM. The call publishes H.264 (`publishDefaults.videoCodec` in `video-room.tsx`); `livekit-client` only sets the codec room-wide, so cameras publish H.264 too. A share from a browser that falls back to VP8 is saved as `.webm`.
- **What the tutor sent is what is saved.** By default a share is published at up to 1080p, 15 fps, 2.5 Mbps (`livekit-client`'s `ScreenSharePresets.h1080fps15`). If the tutor's connection forces LiveKit to send less, the recording has less.
- **Lined up, not stitched.** Shares are never joined into one file. The booking page plays the lesson audio and shows whichever share was live at that point in the audio (`lesson-player.tsx`), with a placeholder in between and buttons to jump to each share. Both kinds of recording store the media start and end of their own file (`started_at`/`ended_at`, from `egress_ended`), which is what lines them up.
- **The first few seconds of each share are missed.** The job is started by a webhook, and webhook delivery takes a few seconds. The job itself then goes live in under a second (0.7 s measured), because a passthrough recording begins at the next keyframe and a browser sends one as soon as the recorder subscribes. Measuring this with a pre-encoded file instead showed a 16 s start-up — that was just the file's 250-frame keyframe interval, not LiveKit.
- **LiveKit names the file.** With passthrough, the container follows the codec, so `egress_ended` stores the path LiveKit actually wrote (`fileResults[0].filename`) over the one we asked for.
- **Concurrency.** At most two Egress jobs per lesson at once — the audio and one share — so Ship's limit of 100 concurrent jobs covers 50 concurrent lessons.

Both kinds live in `session_recordings`, told apart by `kind` (`audio`/`screen`), so playback, RLS and the 90-day prune treat them the same. Screen recordings are never transcribed. Only the audio recording is limited to one active row per booking; a tutor who stops and restarts a share publishes a new track while the previous share's job is still finishing, so screen recordings are made idempotent per `track_sid` instead.

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
- The webhook's `stopStrayEgress` lists and stops any Egress already active for a room before starting a new audio recording, except the booking's own tracked screen recordings. Added after staging testing showed more Egress jobs running than this webhook had ever requested — the exact source was never conclusively identified, so this makes it structurally impossible for our own code to leave stray jobs running regardless of cause. Screen recordings are excluded because webhooks can be handled out of order: a share started right after joining may already be recording when the tutor's join is processed.
- A recording counts as `ready` when LiveKit reports a non-empty saved file, even if the job also reported an error. A screen share that simply ends takes its job down with it, and that must not hide a good recording.

## Traps

- **Passthrough rejects an explicit file type.** Setting `fileType` on a `PASSTHROUGH` file output fails with `400 request has missing or invalid field: passthrough file_type`, so every screen recording failed to start. Leave it unset; LiveKit picks the container from the track's codec.
- **Leaving drops the last word or so unless the connection is held open.** Disconnecting closes the microphone track at once, and LiveKit's recorder drops whatever of it is still in flight. The session page's room (`DrainingRoom` in `video-room.tsx`) therefore mutes immediately on Leave, so nothing said afterwards is heard or recorded, but keeps the connection for 1.5 s so the speech before the click gets through. Closing the tab skips this.
- **A recording can be shorter than LiveKit's reported duration.** Once everyone has left, nobody's audio is routed into the stereo recording, so nothing is written for the seconds before the stop request arrives — LiveKit's `duration` still counts them. Harmless.
- **A wrong webhook path returns 200.** Next.js answers an unknown POST path with a page, so LiveKit records a successful delivery and never retries. If no `session_recordings` rows appear at all, check the configured URL includes `/api/webhooks/livekit` before suspecting the handler.
- **Token metadata is absent from some LiveKit webhook payloads.** Role (`tutor` vs `student`) is read by comparing the event's participant identity against the booking's `tutor_id`/`student_id`, never from token metadata — the booking is authoritative anyway, and unlike metadata it cannot be omitted or spoofed.

## Operational requirements

| Requirement | Where |
| --- | --- |
| `DEEPGRAM_API_KEY` | Vercel, both environments |
| `DEEPGRAM_MODEL` | Optional override; defaults to `nova-3` |
| LiveKit webhook → `/api/webhooks/livekit` | Signed with that environment's API key pair, for `participant_joined`, `participant_left`, `track_published`, `track_unpublished` and `egress_ended`. LiveKit Cloud sends every event type by default |
| `session-recordings` bucket | Private, provisioned per environment by hand (same bucket the old video recording used) |
| `SUPABASE_STORAGE_S3_*` credentials | Egress writes to this bucket over Supabase Storage's S3 API |

`LIVEKIT_AGENT_NAME` is not used by anything and can be removed from both environments.

## What this replaced

Two designs came before this one:

1. A LiveKit Agent (`agent/`) that joined every room and held one Deepgram **streaming** connection per participant, writing the transcript on shutdown. It worked, but it was a third always-on deployable with its own Dockerfile, registry, release process and failure modes, and it streamed every participant's full audio, silence included, at streaming rates.
2. A batch pipeline that replaced the agent but still recorded one Egress per participant microphone track, kept only as a transcription buffer and deleted immediately after use, entirely separate from the consented video recording. It was retryable and had no always-on service, which were real improvements — but it cost 2-3 concurrent Egress jobs per live call, which is what actually constrains how many lessons can run at once on a given LiveKit Cloud plan.

Per-channel attribution, append-on-rejoin, `[Tutor]`/`[Student]` formatting, and the retry/attempt-count pattern all carried forward from these. What didn't survive: a second file per call, and deleting the audio once it had been transcribed.

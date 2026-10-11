-- The batch-transcription pipeline previously recorded one audio-only Egress
-- per participant microphone track (session_transcript_audio) purely to feed
-- Deepgram, separate from the consented, user-playable session_recordings
-- video. That meant 2-3 concurrent Egress jobs per live call (one per track,
-- plus the room composite), which is the dominant cost against LiveKit
-- Cloud's concurrent-Egress plan limit.
--
-- This replaces both with a single audio-only stereo Egress per booking,
-- using LiveKit's MediaSource/AudioRoute to route the tutor's track to the
-- left channel and the student's to the right within one file — one Egress
-- job per call, not two or three. There is no more video recording. That one
-- file is now both the transcription source and the persistent, user-playable
-- recording (previously, transcript audio was a processing buffer deleted
-- immediately after use; now it is kept for the same 90-day window the video
-- recording used to be).

alter table public.session_recordings
  add column if not exists transcribed_at timestamptz,
  add column if not exists transcribe_attempts integer not null default 0;

drop policy if exists "transcript audio is never user readable" on public.session_transcript_audio;
drop table if exists public.session_transcript_audio;

-- The session-transcript-audio bucket is left in place deliberately: Supabase
-- rejects direct DML on storage.objects/storage.buckets ("Direct deletion from
-- storage tables is not allowed. Use the Storage API instead."), and any
-- objects it still holds would block deleting the bucket row via FK anyway.
-- It is private, carries no storage policy, and nothing references it once
-- the table above is gone — removing the bucket and whatever it holds is a
-- one-off Storage API / dashboard cleanup, not something a migration can do.

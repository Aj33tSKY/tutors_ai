-- 20261011120000 added transcribed_at but left it null on every existing row,
-- so the transcribe-sessions cron treated old MP4 room-composite recordings as
-- untranscribed stereo recordings. Those MP4s carry one mixed soundtrack on
-- both channels, so multichannel transcription heard every line twice and
-- appended it to the booking's transcript as both [Tutor] and [Student].
--
-- Only the stereo .ogg recordings are a valid transcription source. Anything
-- else predates them and was already transcribed by the pipeline of its time.
update public.session_recordings
set transcribed_at = coalesce(ended_at, started_at, created_at)
where transcribed_at is null
  and storage_path not like '%.ogg';

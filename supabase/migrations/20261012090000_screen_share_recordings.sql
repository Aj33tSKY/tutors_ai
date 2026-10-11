-- Screen shares are now recorded alongside the lesson audio: while the tutor
-- shares their screen, a second Egress job saves that one video track as-is
-- (PASSTHROUGH, no re-encode, no audio). Playback shows whichever share was
-- live at that point in the lesson audio, so the two never need stitching.
--
-- Both kinds live in session_recordings so playback, RLS and the 90-day prune
-- treat them identically; `kind` tells them apart.

alter table public.session_recordings
  add column if not exists kind text not null default 'audio'
    check (kind in ('audio', 'screen')),
  add column if not exists track_sid text;

-- "One active recording per booking" now applies to the audio recording only.
-- A tutor who stops and restarts a share (switching windows, say) publishes a
-- new track while the previous share's job is still finishing, so screen
-- recordings are made idempotent per track instead.
drop index if exists public.session_recordings_one_active_per_booking_idx;

create unique index if not exists session_recordings_one_active_audio_per_booking_idx
  on public.session_recordings (booking_id)
  where kind = 'audio' and status in ('starting', 'active');

create unique index if not exists session_recordings_track_sid_key
  on public.session_recordings (track_sid)
  where track_sid is not null;

-- Batch transcription replaces the always-on LiveKit agent.
--
-- Every session now gets a short-lived, audio-only per-track egress whose only
-- purpose is to feed the transcription pipeline. These files are deleted as soon
-- as the transcript is written, and are never readable by any user — unlike
-- session_recordings, which are consented, user-visible and kept for 90 days.

create table if not exists public.session_transcript_audio (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  participant_identity text not null,
  role text not null check (role in ('student', 'tutor')),
  track_sid text not null,
  egress_id text,
  storage_path text not null,
  status text not null default 'starting'
    check (status in ('starting', 'active', 'ready', 'failed', 'transcribed', 'deleted')),
  -- Each track's file starts when that track was published, so transcripts are
  -- interleaved by offsetting each segment against the earliest start in the session.
  started_at timestamptz,
  ended_at timestamptz,
  transcribe_attempts integer not null default 0,
  created_at timestamptz not null default now()
);

-- A duplicate track_published webhook must not start a second egress.
create unique index if not exists session_transcript_audio_track_sid_key
  on public.session_transcript_audio (track_sid);

create index if not exists session_transcript_audio_booking_status_idx
  on public.session_transcript_audio (booking_id, status);

create index if not exists session_transcript_audio_egress_idx
  on public.session_transcript_audio (egress_id);

alter table public.session_transcript_audio enable row level security;

-- Deliberately unreadable by end users. The pipeline runs with the service role,
-- which bypasses RLS; this policy states the intent explicitly rather than
-- leaving the table with no policy at all.
create policy "transcript audio is never user readable"
  on public.session_transcript_audio for select to authenticated using (false);

-- Unlike the other buckets, this one is created here: it holds no user-facing
-- content, needs no per-environment setup, and must exist wherever the pipeline
-- runs. It stays private and gets no storage policies, so only the service role
-- can reach the objects.
insert into storage.buckets (id, name, public)
values ('session-transcript-audio', 'session-transcript-audio', false)
on conflict (id) do nothing;

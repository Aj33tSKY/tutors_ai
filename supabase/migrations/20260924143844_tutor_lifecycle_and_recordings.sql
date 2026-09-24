-- Store explicit tutor consent and each independently finalized Egress file.
-- A new row is created for each time the tutor joins, so resumed calls keep
-- every recording segment instead of overwriting the previous one.
create table if not exists public.session_recording_consents (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  tutor_id uuid not null references public.profiles(id) on delete cascade,
  consented_at timestamptz not null default now(),
  consent_version integer not null default 1
);

alter table public.session_recording_consents enable row level security;
revoke all on public.session_recording_consents from anon, authenticated;
grant select on public.session_recording_consents to authenticated;
grant all on public.session_recording_consents to service_role;

create policy "participants read recording consent"
  on public.session_recording_consents for select to authenticated
  using (
    exists (
      select 1 from public.bookings b where b.id = booking_id
      and (b.student_id = (select auth.uid()) or b.tutor_id = (select auth.uid())
        or public.is_linked_parent(b.student_id) or public.app_current_role() = 'admin')
    )
  );

create table if not exists public.session_recordings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  egress_id text unique,
  storage_path text not null unique,
  status text not null default 'starting'
    check (status in ('starting', 'active', 'stopping', 'ready', 'failed', 'expired')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now()
);

create index if not exists session_recordings_booking_idx
  on public.session_recordings (booking_id, started_at);
create index if not exists session_recordings_expiry_idx
  on public.session_recordings (expires_at)
  where status in ('starting', 'active', 'stopping', 'ready', 'failed');
create unique index if not exists session_recordings_one_active_per_booking_idx
  on public.session_recordings (booking_id)
  where status in ('starting', 'active');

alter table public.session_recordings enable row level security;
revoke all on public.session_recordings from anon;
grant select on public.session_recordings to authenticated;
grant all on public.session_recordings to service_role;

create policy "participants read their session recordings"
  on public.session_recordings for select to authenticated
  using (
    exists (
      select 1 from public.bookings b where b.id = booking_id
      and (b.student_id = (select auth.uid()) or b.tutor_id = (select auth.uid())
        or public.is_linked_parent(b.student_id) or public.app_current_role() = 'admin')
    )
  );

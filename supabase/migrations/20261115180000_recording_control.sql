-- Durable recording control for the worker.
--
-- LiveKit webhooks are persisted as provider events and applied by the worker. The
-- worker's database login cannot read application tables, so every state change it
-- needs is one of these enumerated private functions. Each reservation function is the
-- idempotency gate for an external effect: the row exists before LiveKit is asked to
-- record, so a crash after the external call leaves a reconcilable row, never a
-- duplicate job.

-- Reserve the single audio recording for a booking. Returns null when the tutor is
-- not the booked tutor, the lesson is not open, consent is missing, or one already runs.
create function private.recording_reserve_audio(p_booking uuid, p_tutor_identity text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; rec_id uuid; path text;
begin
  select * into b from public.bookings where id = p_booking;
  -- Identity is compared with the booking, never with token metadata (absent from some payloads).
  if not found or b.status <> 'scheduled' or b.tutor_id::text is distinct from p_tutor_identity then return null; end if;
  if not exists (select 1 from public.session_recording_consents where booking_id = p_booking) then return null; end if;
  path := p_booking::text || '/' || gen_random_uuid()::text || '.ogg';
  begin
    insert into public.session_recordings (booking_id, storage_path, status, kind) values (p_booking, path, 'starting', 'audio') returning id into rec_id;
  exception when unique_violation then return null;
  end;
  return jsonb_build_object('id', rec_id, 'storagePath', path, 'tutorId', b.tutor_id, 'studentId', b.student_id);
end;
$$;

-- Reserve one screen share. The track id is unique, so a repeated webhook cannot start a second job.
create function private.screen_reserve(p_booking uuid, p_identity text, p_track text, p_mime text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; rec_id uuid; path text;
begin
  select * into b from public.bookings where id = p_booking;
  -- Only the tutor's shares are recorded, and only while the lesson is open.
  if not found or b.status <> 'scheduled' or b.tutor_id::text is distinct from p_identity then return null; end if;
  if not exists (select 1 from public.session_recording_consents where booking_id = p_booking) then return null; end if;
  -- Passthrough keeps the track's codec: H.264 is written as MP4, VP8/VP9 as WebM. egress_ended records the real name.
  path := p_booking::text || '/screen-' || regexp_replace(p_track, '[^A-Za-z0-9_-]', '', 'g') || case when coalesce(p_mime, '') = '' or lower(p_mime) like '%h264%' then '.mp4' else '.webm' end;
  begin
    insert into public.session_recordings (booking_id, storage_path, status, kind, track_sid) values (p_booking, path, 'starting', 'screen', p_track) returning id into rec_id;
  exception when unique_violation then return null;
  end;
  return jsonb_build_object('id', rec_id, 'storagePath', path);
end;
$$;

-- True only while the reservation is still waiting; false once the share ended or the job was abandoned.
create function private.recording_is_starting(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.session_recordings where id = p_id and status = 'starting');
$$;
create function private.recording_activate(p_id uuid, p_egress text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.session_recordings set egress_id = p_egress, status = 'active' where id = p_id and status = 'starting';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
create function private.recording_fail(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.session_recordings set status = 'failed', ended_at = now() where id = p_id and status = 'starting';
$$;

-- The tutor left: every active recording of the booking begins stopping. Returns the jobs to stop.
create function private.recording_begin_stop(p_booking uuid, p_tutor_identity text) returns setof text
language sql security definer set search_path = '' as $$
  with allowed as (select 1 from public.bookings where id = p_booking and tutor_id::text = p_tutor_identity),
  stopped as (
    update public.session_recordings set status = 'stopping'
     where booking_id = p_booking and status = 'active' and egress_id is not null and exists (select 1 from allowed) returning egress_id
  ) select egress_id from stopped;
$$;
-- A share that ended: a still-waiting reservation is abandoned; a running job is told to stop.
create function private.screen_end(p_track text) returns text
language plpgsql security definer set search_path = '' as $$
declare egress text;
begin
  update public.session_recordings set status = 'failed', ended_at = now() where track_sid = p_track and status = 'starting';
  update public.session_recordings set status = 'stopping' where track_sid = p_track and status = 'active' returning egress_id into egress;
  return egress;
end;
$$;
-- Egress jobs this booking is already tracking; anything else running in the room is stray.
create function private.recording_tracked_screens(p_booking uuid) returns setof text
language sql stable security definer set search_path = '' as $$
  select egress_id from public.session_recordings where booking_id = p_booking and kind = 'screen' and status in ('starting', 'active') and egress_id is not null;
$$;

-- The file's own media start and length drive playback alignment, so they are stored exactly.
-- Success means a file was saved, not that no error was reported: a share that simply ends takes its export down with it.
create function private.recording_egress_ended(p_egress text, p_ok boolean, p_started timestamptz, p_ended timestamptz, p_file text) returns void
language sql security definer set search_path = '' as $$
  update public.session_recordings set status = case when p_ok then 'ready' else 'failed' end, ended_at = coalesce(p_ended, now()),
    started_at = coalesce(p_started, started_at), storage_path = coalesce(nullif(p_file, ''), storage_path)
   where egress_id = p_egress and (status in ('starting', 'active', 'stopping') or (status = 'failed' and p_ok));
$$;

-- Reconciliation inputs. Reservations that never reached LiveKit, and jobs whose end was never reported.
create function private.recording_stale_starting(p_older interval default interval '3 minutes') returns table(id uuid, booking_id uuid)
language sql stable security definer set search_path = '' as $$
  select id, booking_id from public.session_recordings where status = 'starting' and created_at < now() - p_older order by created_at limit 50;
$$;
create function private.recording_unsettled(p_older interval default interval '10 minutes') returns table(id uuid, egress_id text)
language sql stable security definer set search_path = '' as $$
  select id, egress_id from public.session_recordings where status in ('active', 'stopping') and egress_id is not null and created_at < now() - p_older order by created_at limit 50;
$$;

revoke all on function private.recording_reserve_audio(uuid,text), private.screen_reserve(uuid,text,text,text), private.recording_is_starting(uuid),
  private.recording_activate(uuid,text), private.recording_fail(uuid), private.recording_begin_stop(uuid,text), private.screen_end(text),
  private.recording_tracked_screens(uuid), private.recording_egress_ended(text,boolean,timestamptz,timestamptz,text),
  private.recording_stale_starting(interval), private.recording_unsettled(interval) from public, anon, authenticated, service_role;

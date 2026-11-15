-- Private machine API: deliberately no auth.uid(), and no browser/service-role
-- EXECUTE grants. Release tooling grants only these functions to the restricted
-- worker login. It receives neither table access nor Auth access.
create table private.lesson_job_control (
  singleton boolean primary key default true check (singleton),
  owner text not null default 'legacy' check (owner in ('legacy', 'paused', 'worker'))
);
insert into private.lesson_job_control default values;
create table private.lesson_segment_results (
  recording_id uuid primary key references public.session_recordings(id) on delete cascade,
  lease_token uuid,
  lease_until timestamptz,
  transcript text,
  completed_at timestamptz
);
create table private.lesson_transcript_baselines (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  transcript text not null
);
alter table private.lesson_job_control enable row level security;
alter table private.lesson_segment_results enable row level security;
alter table private.lesson_transcript_baselines enable row level security;
revoke all on private.lesson_job_control, private.lesson_segment_results,
  private.lesson_transcript_baselines from public, anon, authenticated, service_role;

create function public.lesson_job_owner() returns text
language sql stable security definer set search_path = '' as $$
  select owner from private.lesson_job_control where singleton;
$$;
revoke all on function public.lesson_job_owner() from public, anon, authenticated;
grant execute on function public.lesson_job_owner() to service_role;

create function private.lesson_transcription_candidates() returns table(id uuid)
language sql stable security definer set search_path = '' as $$
  select r.id from public.session_recordings r
  left join private.lesson_segment_results s on s.recording_id = r.id
  where (select owner = 'worker' from private.lesson_job_control where singleton)
    and r.status = 'ready' and r.kind = 'audio' and r.storage_path like '%.ogg'
    and r.expires_at > now() and r.transcribed_at is null and r.transcribe_attempts < 3
    and (s.lease_until is null or s.lease_until < now())
  order by r.started_at, r.id limit 100;
$$;

create function private.lesson_transcription_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.session_recordings; s private.lesson_segment_results; token uuid;
begin
  if not (select owner = 'worker' from private.lesson_job_control where singleton) then return null; end if;
  select * into r from public.session_recordings where id = p_id for update;
  if not found or r.status <> 'ready' or r.kind <> 'audio' or r.storage_path not like '%.ogg'
    or r.expires_at <= now() or r.transcribed_at is not null or r.transcribe_attempts >= 3 then return null; end if;
  insert into private.lesson_segment_results(recording_id) values(p_id) on conflict do nothing;
  select * into s from private.lesson_segment_results where recording_id = p_id for update;
  if s.completed_at is not null or s.lease_until > now() then return null; end if;
  token := gen_random_uuid();
  update private.lesson_segment_results set lease_token = token, lease_until = now() + interval '10 minutes' where recording_id = p_id;
  update public.session_recordings set transcribe_attempts = transcribe_attempts + 1 where id = p_id;
  return jsonb_build_object('id', r.id, 'token', token, 'storagePath', r.storage_path,
    'offsetSeconds', greatest(0, extract(epoch from (r.started_at - coalesce(b.started_at, b.start_time)))))
    from public.bookings b where b.id = r.booking_id;
end;
$$;

-- One transaction publishes the segment, chronological aggregate and marker.
-- Lock the booking before reading the baseline so concurrent resumed segments
-- cannot overwrite each other. A replay never appends the same segment twice.
create function private.lesson_transcription_publish(p_id uuid, p_token uuid, p_transcript text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.session_recordings; s private.lesson_segment_results; combined text;
begin
  if length(p_transcript) > 2000000 then raise exception 'Transcript exceeds limit'; end if;
  select * into r from public.session_recordings where id = p_id for update;
  if not found then return false; end if;
  select * into s from private.lesson_segment_results where recording_id = p_id for update;
  if not found or s.lease_token is distinct from p_token then return false; end if;
  if s.completed_at is not null then return true; end if;
  if r.status <> 'ready' or r.expires_at <= now() or s.lease_until <= now() then return false; end if;
  perform 1 from public.bookings where id = r.booking_id for update;
  insert into private.lesson_transcript_baselines(booking_id, transcript)
    select r.booking_id, coalesce((select full_transcript from public.session_analytics where booking_id = r.booking_id), '')
    on conflict do nothing;
  update private.lesson_segment_results set transcript = p_transcript, completed_at = now(), lease_until = null where recording_id = p_id;
  select concat_ws(E'\n', nullif(b.transcript, ''), nullif((
    select string_agg(nullif(x.transcript, ''), E'\n' order by sr.started_at, sr.id)
    from private.lesson_segment_results x join public.session_recordings sr on sr.id = x.recording_id
    where sr.booking_id = r.booking_id and x.completed_at is not null
  ), '')) into combined from private.lesson_transcript_baselines b where b.booking_id = r.booking_id;
  insert into public.session_analytics(booking_id, full_transcript) values(r.booking_id, combined)
    on conflict (booking_id) do update set full_transcript = excluded.full_transcript;
  update public.session_recordings set transcribed_at = now() where id = p_id;
  return true;
end;
$$;

create function private.lesson_transcription_release(p_id uuid, p_token uuid) returns void
language sql security definer set search_path = '' as $$
  update private.lesson_segment_results set lease_until = null
    where recording_id = p_id and lease_token = p_token and completed_at is null;
$$;

create function private.lesson_retention_candidates() returns table(id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.storage_path from public.session_recordings r
  where (select owner = 'worker' from private.lesson_job_control where singleton)
    and r.status <> 'expired' and r.expires_at <= now()
  order by r.expires_at, r.id limit 100;
$$;
create function private.lesson_retention_complete(p_id uuid, p_path text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.session_recordings set status = 'expired'
    where id = p_id and storage_path = p_path and expires_at <= now() and status <> 'expired';
  return found;
end;
$$;
revoke all on function private.lesson_transcription_candidates(),
  private.lesson_transcription_claim(uuid), private.lesson_transcription_publish(uuid,uuid,text),
  private.lesson_transcription_release(uuid,uuid), private.lesson_retention_candidates(),
  private.lesson_retention_complete(uuid,text) from public, anon, authenticated, service_role;

create table private.lesson_summary_state (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  source_hash text,
  published_hash text,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0
);
alter table private.lesson_summary_state enable row level security;
revoke all on private.lesson_summary_state from public, anon, authenticated, service_role;
-- Existing successfully processed lessons are not needlessly billed again.
insert into private.lesson_summary_state(booking_id, source_hash, published_hash)
select a.booking_id, md5(a.full_transcript), md5(a.full_transcript)
from public.session_analytics a where a.full_transcript is not null and a.summary_notes is not null
  and exists(select 1 from public.session_embeddings e where e.booking_id = a.booking_id);

create function private.lesson_summary_candidates() returns table(id uuid)
language sql stable security definer set search_path = '' as $$
  select b.id from public.bookings b join public.session_analytics a on a.booking_id = b.id
  left join private.lesson_summary_state s on s.booking_id = b.id
  where (select owner = 'worker' from private.lesson_job_control where singleton)
    and b.status = 'completed' and length(a.full_transcript) > 0
    and (s.lease_until is null or s.lease_until < now())
    and (s.source_hash is distinct from md5(a.full_transcript) or coalesce(s.attempts,0) < 3)
    and (s.published_hash is distinct from md5(a.full_transcript) or a.summary_notes is null
      or not exists(select 1 from public.session_embeddings e where e.booking_id = b.id))
    and not exists(select 1 from public.session_recordings r where r.booking_id = b.id and r.kind = 'audio'
      and (r.status in ('starting','active','stopping') or (r.status = 'ready' and r.transcribed_at is null
        and r.transcribe_attempts < 3 and r.storage_path like '%.ogg' and r.expires_at > now())))
  order by b.start_time, b.id limit 100;
$$;
create function private.lesson_summary_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; a public.session_analytics; s private.lesson_summary_state; token uuid;
begin
  if not exists(select 1 from private.lesson_summary_candidates() c where c.id = p_id) then return null; end if;
  select * into b from public.bookings where id = p_id for update;
  select * into a from public.session_analytics where booking_id = p_id for update;
  insert into private.lesson_summary_state(booking_id) values(p_id) on conflict do nothing;
  select * into s from private.lesson_summary_state where booking_id = p_id for update;
  if s.lease_until > now() then return null; end if;
  token := gen_random_uuid();
  update private.lesson_summary_state set source_hash = md5(a.full_transcript), lease_token = token,
    lease_until = now() + interval '10 minutes',
    attempts = case when source_hash is distinct from md5(a.full_transcript) then 1 else attempts + 1 end
    where booking_id = p_id;
  return jsonb_build_object('id', p_id, 'token', token, 'transcript', a.full_transcript,
    'summary', a.summary_notes, 'subject', b.subject, 'examBoard', b.exam_board);
end;
$$;
create function private.lesson_summary_publish(p_id uuid, p_token uuid, p_source text,
  p_previous_summary jsonb, p_summary jsonb, p_notes text, p_ratio numeric, p_chunks jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare b public.bookings; a public.session_analytics; s private.lesson_summary_state; chunk jsonb;
begin
  select * into b from public.bookings where id = p_id for update;
  if not found or b.status <> 'completed' then return false; end if;
  select * into a from public.session_analytics where booking_id = p_id for update;
  select * into s from private.lesson_summary_state where booking_id = p_id for update;
  if not found or s.lease_token is distinct from p_token or s.lease_until is null or s.lease_until <= now()
    or a.full_transcript is distinct from p_source or a.summary_notes is distinct from p_previous_summary then return false; end if;
  if p_summary is null or jsonb_array_length(p_chunks) = 0 then raise exception 'Incomplete summary publication'; end if;
  delete from public.session_embeddings where booking_id = p_id;
  for chunk in select value from jsonb_array_elements(p_chunks) loop
    insert into public.session_embeddings(booking_id,student_id,content,topic,embedding)
      values(p_id,b.student_id,chunk->>'content',b.subject::text,
        (jsonb_populate_record(null::public.session_embeddings, chunk)).embedding);
  end loop;
  update public.session_analytics set summary_notes = coalesce(summary_notes,p_summary),
    notes_markdown = case when summary_notes is null then coalesce(notes_markdown,p_notes) else notes_markdown end,
    talk_ratio = case when summary_notes is null then p_ratio else talk_ratio end where booking_id = p_id;
  update private.lesson_summary_state set published_hash = md5(p_source), lease_until = null, attempts = 0 where booking_id = p_id;
  return true;
end;
$$;
create function private.lesson_summary_release(p_id uuid, p_token uuid) returns void
language sql security definer set search_path = '' as $$
  update private.lesson_summary_state set lease_until = null where booking_id = p_id and lease_token = p_token;
$$;
revoke all on function private.lesson_summary_candidates(), private.lesson_summary_claim(uuid),
  private.lesson_summary_publish(uuid,uuid,text,jsonb,jsonb,text,numeric,jsonb),
  private.lesson_summary_release(uuid,uuid) from public, anon, authenticated, service_role;

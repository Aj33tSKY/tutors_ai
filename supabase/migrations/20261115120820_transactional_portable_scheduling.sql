-- The privileged implementation is private and checks the caller itself.
-- Public wrappers are invoker-rights RPCs, never general table-write proxies.
create function private.tutor_change_lesson_v1(p_id uuid, p_kind text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); b public.bookings; changed uuid[]; new_start timestamptz; new_end timestamptz; new_name text;
begin
  if actor is null or private.app_current_role() is distinct from 'tutor'::public.user_role then raise exception 'Tutor required' using errcode='42501'; end if;
  select * into b from public.bookings where id=p_id and tutor_id=actor;
  if not found then raise exception 'Lesson not found' using errcode='P0002'; end if;
  -- All portable scheduling writers lock the two calendars in UUID order.
  perform pg_advisory_xact_lock(hashtextextended('lesson-calendar:' || least(b.student_id,b.tutor_id)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('lesson-calendar:' || greatest(b.student_id,b.tutor_id)::text,0));
  select * into b from public.bookings where id=p_id and tutor_id=actor for update;
  if p_kind='complete' then
    if b.status='completed' then return jsonb_build_object('bookingIds',array[b.id]); end if;
    if b.status<>'scheduled' or b.started_at is null then raise exception 'Only started lessons can complete'; end if;
    update public.bookings set status='completed' where id=b.id;
  elsif p_kind='reopen' then
    if b.status='scheduled' then return jsonb_build_object('bookingIds',array[b.id]); end if;
    if b.status<>'completed' then raise exception 'Only completed lessons can reopen'; end if;
    update public.bookings set status='scheduled' where id=b.id;
    update public.session_analytics set summary_notes=null,talk_ratio=null,notes_markdown=null where booking_id=b.id;
    delete from public.session_embeddings where booking_id=b.id;
    delete from private.lesson_summary_state where booking_id=b.id;
  elsif p_kind='cancel' then
    if b.status='cancelled' then return jsonb_build_object('bookingIds',array[b.id]); end if;
    if b.status<>'scheduled' or b.started_at is not null then raise exception 'Only unstarted lessons can cancel'; end if;
    if coalesce((p_input->>'series')::boolean,false) then
      if b.recurrence_series_id is null then raise exception 'Cancel legacy series individually'; end if;
      with cancelled as (
        update public.bookings set status='cancelled' where tutor_id=actor and student_id=b.student_id
          and recurrence_series_id=b.recurrence_series_id and start_time>=b.start_time
          and status='scheduled' and started_at is null returning id
      ) select array_agg(id) into changed from cancelled;
      return jsonb_build_object('bookingIds',changed);
    end if;
    update public.bookings set status='cancelled' where id=b.id;
  elsif p_kind='reschedule' then
    if b.status<>'scheduled' then raise exception 'Only scheduled lessons can reschedule'; end if;
    new_name := nullif(btrim(p_input->>'lessonName'),'');
    new_start := (p_input->>'startTime')::timestamptz;
    if new_name is null or length(new_name)>120 or new_start is null or new_start<=now()
      or extract(minute from new_start)::integer % 15 <> 0 or extract(second from new_start)<>0
      then raise exception 'Invalid lesson details' using errcode='22023'; end if;
    new_end := new_start+(b.end_time-b.start_time);
    if exists(select 1 from public.bookings x where x.id<>b.id and x.status='scheduled'
      and (x.tutor_id=b.tutor_id or x.student_id=b.student_id)
      and x.start_time<new_end and x.end_time>new_start) then
      raise exception 'Calendar conflict' using errcode='23P01';
    end if;
    update public.bookings set lesson_name=new_name,start_time=new_start,end_time=new_end where id=b.id;
  else raise exception 'Unsupported operation' using errcode='22023';
  end if;
  return jsonb_build_object('bookingIds',array[b.id]);
end;
$$;
revoke all on function private.tutor_change_lesson_v1(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.tutor_change_lesson_v1(uuid,text,jsonb) to authenticated;
create function public.tutor_change_lesson_v1(p_id uuid,p_kind text,p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.tutor_change_lesson_v1(p_id,p_kind,p_input); $$;
revoke all on function public.tutor_change_lesson_v1(uuid,text,jsonb) from public,anon;
grant execute on function public.tutor_change_lesson_v1(uuid,text,jsonb) to authenticated;

create table private.scheduling_commands (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  command_id uuid not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,command_id)
);
alter table private.scheduling_commands enable row level security;
revoke all on private.scheduling_commands from public,anon,authenticated,service_role;

create function private.schedule_lessons_v1(p_student_id uuid,p_start timestamptz,p_hours integer,p_count integer,
  p_name text,p_request_id uuid default null,p_command_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); request public.lesson_requests; tutor public.tutor_profiles;
  is_trial boolean; linked_request uuid; series uuid; ids uuid[]; booking_id uuid;
  session_start timestamptz; session_end timestamptz; i integer; conversation uuid;
  command private.scheduling_commands; fingerprint jsonb; result jsonb;
begin
  if actor is null or private.app_current_role() is distinct from 'tutor'::public.user_role then raise exception 'Tutor required' using errcode='42501'; end if;
  fingerprint:=jsonb_build_object('student',p_student_id,'start',p_start,'hours',p_hours,'count',p_count,'name',btrim(p_name),'request',p_request_id);
  if p_command_id is not null then
    select * into command from private.scheduling_commands where actor_id=actor and command_id=p_command_id;
    if found then
      if command.input<>fingerprint then raise exception 'Idempotency key reused for different input' using errcode='22023'; end if;
      return command.result;
    end if;
  end if;
  if p_student_id is null or p_student_id=actor or p_start is null or p_start<=now() or p_hours not between 1 and 3
    or p_hours is null or p_count is null or p_count not between 1 and 12 or nullif(btrim(p_name),'') is null or length(p_name)>120
    or extract(minute from p_start)::integer%15<>0 or extract(second from p_start)<>0
    then raise exception 'Invalid schedule' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lesson-calendar:' || least(p_student_id,actor)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('lesson-calendar:' || greatest(p_student_id,actor)::text,0));
  if p_command_id is not null then
    select * into command from private.scheduling_commands where actor_id=actor and command_id=p_command_id;
    if found then
      if command.input<>fingerprint then raise exception 'Idempotency key reused for different input' using errcode='22023'; end if;
      return command.result;
    end if;
  end if;
  select * into tutor from public.tutor_profiles where id=actor;
  if not found or tutor.hourly_rate<=0 then raise exception 'Set a tutor rate before scheduling'; end if;
  if p_request_id is not null then
    select * into request from public.lesson_requests where id=p_request_id and tutor_id=actor and student_id=p_student_id for update;
    if not found then raise exception 'Request not found' using errcode='P0002'; end if;
    if request.status='scheduled' then
      select array_agg(id order by start_time) into ids from public.bookings where lesson_request_id=request.id;
      result:=jsonb_build_object('bookingIds',coalesce(ids,'{}'::uuid[]));
      if p_command_id is not null then insert into private.scheduling_commands(actor_id,command_id,input,result)
        values(actor,p_command_id,fingerprint,result); end if;
      return result;
    end if;
    if request.status<>'pending' then raise exception 'Request is no longer pending'; end if;
  else
    select * into request from public.lesson_requests where tutor_id=actor and student_id=p_student_id and status='pending'
      order by created_at limit 1 for update;
    if not found and not exists(select 1 from public.bookings where tutor_id=actor and student_id=p_student_id) then
      raise exception 'Student relationship required' using errcode='42501';
    end if;
  end if;
  is_trial := not exists(select 1 from public.bookings where tutor_id=actor and student_id=p_student_id and status<>'cancelled');
  -- A request's recorded trial decision is authoritative when explicitly accepted.
  if p_request_id is not null then is_trial := is_trial and request.is_trial; end if;
  linked_request := case when p_request_id is not null or is_trial then request.id else null end;
  series := case when p_count>1 then gen_random_uuid() else null end;
  for i in 0..p_count-1 loop
    session_start := p_start+i*interval '7 days'; session_end:=session_start+p_hours*interval '1 hour';
    if exists(select 1 from public.bookings b where b.status='scheduled'
      and (b.tutor_id=actor or b.student_id=p_student_id) and b.start_time<session_end and b.end_time>session_start) then
      raise exception 'Calendar conflict' using errcode='23P01';
    end if;
    insert into public.bookings(student_id,tutor_id,subject,exam_board,lesson_name,lesson_request_id,start_time,end_time,
      status,is_trial,payment_status,amount_gbp_pence,recurrence_rule,recurrence_series_id)
    values(p_student_id,actor,case when i=0 then request.subject else null end,case when i=0 then request.exam_board else null end,
      btrim(p_name),linked_request,session_start,session_end,'scheduled',is_trial and i=0,
      case when is_trial and i=0 then 'paid'::public.payment_status else 'pending'::public.payment_status end,
      case when is_trial and i=0 then 0 else tutor.hourly_rate end,
      case when p_count>1 then 'weekly:'||p_count::text else null end,series) returning id into booking_id;
    ids:=array_append(ids,booking_id);
  end loop;
  if linked_request is not null then update public.lesson_requests set status='scheduled',responded_at=now() where id=linked_request; end if;
  insert into public.direct_conversations(student_id,tutor_id) values(p_student_id,actor)
    on conflict(student_id,tutor_id) do update set updated_at=now() returning id into conversation;
  insert into public.direct_messages(conversation_id,sender_id,body)
    values(conversation,actor,'Lesson confirmed'||E'\n\n'||btrim(p_name)||E'\nStarts: '||to_char(p_start at time zone 'Europe/London','YYYY-MM-DD HH24:MI')||' Europe/London'||
      case when p_count>1 then E'\nWeekly for '||p_count::text||' sessions.' else E'\nOne session scheduled.' end||
      case when is_trial then E'\nYour first session is a free trial.' else '' end);
  result:=jsonb_build_object('bookingIds',ids);
  if p_command_id is not null then insert into private.scheduling_commands(actor_id,command_id,input,result)
    values(actor,p_command_id,fingerprint,result); end if;
  return result;
end;
$$;
revoke all on function private.schedule_lessons_v1(uuid,timestamptz,integer,integer,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.schedule_lessons_v1(uuid,timestamptz,integer,integer,text,uuid,uuid) to authenticated;
create function public.schedule_lessons_v1(p_student_id uuid,p_start timestamptz,p_hours integer,p_count integer,p_name text,p_request_id uuid default null,p_command_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.schedule_lessons_v1(p_student_id,p_start,p_hours,p_count,p_name,p_request_id,p_command_id); $$;
revoke all on function public.schedule_lessons_v1(uuid,timestamptz,integer,integer,text,uuid,uuid) from public,anon;
grant execute on function public.schedule_lessons_v1(uuid,timestamptz,integer,integer,text,uuid,uuid) to authenticated;

create index if not exists session_recordings_pending_transcription_idx on public.session_recordings(started_at,id)
  where kind='audio' and status='ready' and transcribed_at is null and transcribe_attempts<3;
create index if not exists session_embeddings_booking_idx on public.session_embeddings(booking_id);

-- The tutor-facing policy is for notes only. A general UPDATE grant also
-- allowed changing transcript provenance and the private recording path.
revoke update on public.session_analytics from public,anon,authenticated;
grant update(notes_markdown) on public.session_analytics to authenticated;

-- Transactional wake-up markers prevent a poll from repeatedly hashing every
-- historical transcript. Markers survive queue outages and are deleted only
-- when publication commits or a version exhausts its attempt budget.
create table private.lesson_summary_pending (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table private.lesson_summary_pending enable row level security;
revoke all on private.lesson_summary_pending from public,anon,authenticated,service_role;
create index lesson_summary_pending_age_idx on private.lesson_summary_pending(requested_at,booking_id);

-- Internal trigger maintenance, not a callable API. It only queues its own
-- source row; the source table's caller/RLS checks remain authoritative.
create function private.mark_analytics_summary_pending() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.full_transcript is null or new.full_transcript !~ '[^[:space:]]' then
    delete from private.lesson_summary_pending where booking_id=new.booking_id;
  elsif tg_op='INSERT' or new.full_transcript is distinct from old.full_transcript
    or (new.summary_notes is null and old.summary_notes is not null) then
    insert into private.lesson_summary_pending(booking_id) values(new.booking_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger queue_analytics_summary after insert or update of full_transcript,summary_notes on public.session_analytics
for each row execute function private.mark_analytics_summary_pending();

create function private.mark_completed_summary_pending() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and exists(select 1 from public.session_analytics a where a.booking_id=new.id and a.full_transcript ~ '[^[:space:]]') then
    insert into private.lesson_summary_pending(booking_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger queue_completed_summary after insert or update of status on public.bookings
for each row execute function private.mark_completed_summary_pending();

create function private.finish_summary_pending() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.lease_until is null and ((new.attempts=0 and new.published_hash is not null and new.published_hash=new.source_hash) or new.attempts>=3) then
    delete from private.lesson_summary_pending p using public.session_analytics a
      where p.booking_id=new.booking_id and a.booking_id=p.booking_id and md5(a.full_transcript)=new.source_hash;
  end if;
  return new;
end;
$$;
create trigger finish_summary_pending after update of published_hash,lease_until,attempts on private.lesson_summary_state
for each row execute function private.finish_summary_pending();
revoke all on function private.mark_analytics_summary_pending(),private.mark_completed_summary_pending(),
  private.finish_summary_pending() from public,anon,authenticated,service_role;

insert into private.lesson_summary_pending(booking_id)
select a.booking_id from public.session_analytics a join public.bookings b on b.id=a.booking_id
where b.status='completed' and a.full_transcript ~ '[^[:space:]]'
  and (a.summary_notes is null or not exists(select 1 from public.session_embeddings e where e.booking_id=b.id));

create or replace function private.lesson_summary_candidates() returns table(id uuid)
language sql stable security definer set search_path='' as $$
  select b.id from private.lesson_summary_pending p
  join public.bookings b on b.id=p.booking_id join public.session_analytics a on a.booking_id=b.id
  left join private.lesson_summary_state s on s.booking_id=b.id
  where (select owner='worker' from private.lesson_job_control where singleton)
    and b.status='completed' and a.full_transcript ~ '[^[:space:]]'
    and (s.lease_until is null or s.lease_until<now())
    and (s.source_hash is distinct from md5(a.full_transcript) or coalesce(s.attempts,0)<3)
    and (s.published_hash is distinct from md5(a.full_transcript) or a.summary_notes is null
      or not exists(select 1 from public.session_embeddings e where e.booking_id=b.id))
    and not exists(select 1 from public.session_recordings r where r.booking_id=b.id and r.kind='audio'
      and (r.status in ('starting','active','stopping') or (r.status='ready' and r.transcribed_at is null
        and r.transcribe_attempts<3 and r.storage_path like '%.ogg' and r.expires_at>now())))
  order by p.requested_at,p.booking_id limit 100;
$$;

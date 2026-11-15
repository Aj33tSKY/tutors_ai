-- Transactional lesson requests and server-computed open slots.
--
-- Before: a student could INSERT a lesson request directly (any tutor, any time, any
-- is_trial value, unlimited volume), and the booking flow made four separate writes that could
-- stop halfway and raced on the free-trial rule. Now the only way in is request_lesson_v1, which
-- validates the offer and the slot, applies the trial rule under a lock, rate-limits, and writes
-- the request, conversation and message in one transaction.
drop policy if exists "students create their lesson requests" on public.lesson_requests;

-- Tutors respond (status, responded_at); everything describing the request is fixed once made.
create function private.protect_lesson_request() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.student_id is distinct from old.student_id or new.tutor_id is distinct from old.tutor_id or new.subject is distinct from old.subject
    or new.exam_board is distinct from old.exam_board or new.requested_start_time is distinct from old.requested_start_time
    or new.requested_end_time is distinct from old.requested_end_time or new.is_trial is distinct from old.is_trial) then
    raise exception 'A lesson request cannot be altered after it is made' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger protect_lesson_request before update on public.lesson_requests
for each row execute function private.protect_lesson_request();

-- Open one-hour starts for a verified tutor over the next p_days days. Availability is wall-clock
-- time in the UK, so a daylight-saving change moves the instant, not the lesson hour. Instants the
-- tutor already has a scheduled lesson on are excluded. Callable by anyone: it reveals only free times.
create function private.tutor_open_slots(p_tutor uuid, p_days integer default 28) returns setof timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare today date := (now() at time zone 'Europe/London')::date; day_offset integer; local_day date; slot record; local_start time; instant timestamptz;
begin
  if not exists (select 1 from public.tutor_profiles where id = p_tutor and dbs_verified and not is_demo) then return; end if;
  for day_offset in 0 .. least(greatest(p_days, 1), 60) loop
    local_day := today + day_offset;
    for slot in select start_time, end_time from public.availability where tutor_id = p_tutor and day_of_week = extract(dow from local_day)::integer order by start_time loop
      local_start := slot.start_time;
      while local_start + interval '1 hour' <= slot.end_time and local_start + interval '1 hour' > local_start loop
        instant := (local_day + local_start) at time zone 'Europe/London';
        if instant > now() and not exists (select 1 from public.bookings b where b.tutor_id = p_tutor and b.status = 'scheduled'
             and b.start_time < instant + interval '1 hour' and b.end_time > instant) then
          return next instant;
        end if;
        local_start := local_start + interval '1 hour';
      end loop;
    end loop;
  end loop;
end;
$$;

create function private.request_lesson(p_tutor uuid, p_subject text, p_board text, p_start timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.lesson_requests; trial boolean; request_id uuid; conversation uuid; student_name text; label text;
begin
  if actor is null or private.app_current_role() is distinct from 'student'::public.user_role then raise exception 'Student required' using errcode = '42501'; end if;
  if p_tutor = actor or p_start is null or p_start <= now() then raise exception 'slot_unavailable' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lesson-request:' || actor::text || ':' || p_tutor::text, 0));
  if not exists (select 1 from public.tutor_profiles t where t.id = p_tutor and t.dbs_verified and not t.is_demo
      and p_subject = any (t.subjects::text[]) and p_board = any (t.boards::text[])) then
    raise exception 'subject_unavailable' using errcode = '22023';
  end if;
  select * into existing from public.lesson_requests where student_id = actor and tutor_id = p_tutor and requested_start_time = p_start and status = 'pending';
  if found then return jsonb_build_object('requestId', existing.id, 'isTrial', existing.is_trial, 'duplicate', true); end if;
  if not exists (select 1 from private.tutor_open_slots(p_tutor, 29) s where s = p_start) then raise exception 'slot_unavailable' using errcode = '22023'; end if;
  -- Bounded volume: a handful of open requests per tutor and per student.
  if (select count(*) from public.lesson_requests where student_id = actor and tutor_id = p_tutor and status = 'pending') >= 3
     or (select count(*) from public.lesson_requests where student_id = actor and status = 'pending') >= 10 then
    raise exception 'too_many_requests' using errcode = '22023';
  end if;
  -- A first lesson is per student-tutor pair, not an unlimited platform-wide trial.
  trial := not exists (select 1 from public.bookings where student_id = actor and tutor_id = p_tutor and status <> 'cancelled')
       and not exists (select 1 from public.lesson_requests where student_id = actor and tutor_id = p_tutor and status <> 'declined');
  insert into public.lesson_requests (student_id, tutor_id, subject, exam_board, requested_start_time, requested_end_time, is_trial)
    values (actor, p_tutor, p_subject::public.stem_subject, p_board::public.exam_board, p_start, p_start + interval '1 hour', trial) returning id into request_id;
  insert into public.direct_conversations (student_id, tutor_id) values (actor, p_tutor) on conflict (student_id, tutor_id) do update set updated_at = now() returning id into conversation;
  select full_name into student_name from public.profiles where id = actor;
  label := initcap(replace(p_subject, '_', ' '));
  insert into public.direct_messages (conversation_id, sender_id, body) values (conversation, actor,
    'New lesson request' || E'\n\nStudent: ' || coalesce(student_name, 'Student') || E'\nSubject: ' || label || ' · ' || replace(p_board, '_', ' ') ||
    E'\nRequested: ' || to_char(p_start at time zone 'Europe/London', 'FMDay DD FMMonth YYYY HH24:MI') || ' (UK time)' ||
    case when trial then E'\nFree trial lesson — no payment will be requested.' else E'\nPlease accept and set the lesson time or recurring schedule.' end);
  return jsonb_build_object('requestId', request_id, 'isTrial', trial, 'duplicate', false);
end;
$$;
revoke all on function private.tutor_open_slots(uuid,integer), private.request_lesson(uuid,text,text,timestamptz) from public, anon, authenticated, service_role;
-- Anonymous callers never touch the private schema; the one public wrapper below runs as its owner.
grant execute on function private.tutor_open_slots(uuid,integer) to authenticated;
grant execute on function private.request_lesson(uuid,text,text,timestamptz) to authenticated;
create function public.tutor_open_slots_v1(p_tutor uuid) returns setof timestamptz
-- Definer on purpose: it reveals only the free hours of an approved tutor, which the public page already shows.
language sql stable security definer set search_path = '' as $$ select private.tutor_open_slots(p_tutor, 28); $$;
create function public.request_lesson_v1(p_tutor uuid, p_subject text, p_board text, p_start timestamptz) returns jsonb
language sql security invoker set search_path = '' as $$ select private.request_lesson(p_tutor, p_subject, p_board, p_start); $$;
revoke all on function public.tutor_open_slots_v1(uuid), public.request_lesson_v1(uuid,text,text,timestamptz) from public;
grant execute on function public.tutor_open_slots_v1(uuid) to anon, authenticated;
grant execute on function public.request_lesson_v1(uuid,text,text,timestamptz) to authenticated;

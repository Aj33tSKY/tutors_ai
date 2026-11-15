-- Revision chat integrity.
--
-- The original policy let a student INSERT, UPDATE and DELETE their own chat messages, so the
-- daily cap (a count of today's user messages) could be reset by deleting them, and assistant
-- turns could be forged into the model's history. Messages are now written only by the
-- functions below, and usage is a ledger the student cannot edit.
drop policy if exists "students manage their own chat messages" on public.chat_messages;
create policy "students read their own chat messages" on public.chat_messages for select to authenticated using (student_id = (select auth.uid()));
revoke insert, update, delete on public.chat_messages from authenticated;

create table private.chat_usage (
  student_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  used integer not null default 0 check (used >= 0),
  primary key (student_id, day)
);
alter table private.chat_usage enable row level security;
revoke all on private.chat_usage from public, anon, authenticated, service_role;
-- Carry today's existing usage over so the first deploy does not hand out a fresh allowance.
insert into private.chat_usage (student_id, day, used)
select student_id, (now() at time zone 'utc')::date, count(*) from public.chat_messages
 where role = 'user' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc' group by student_id
on conflict do nothing;

-- Atomically spends one unit of the day's allowance and stores the user's turn. Every attempt is
-- charged, including a replay of the same message id, because each one costs a model call.
-- The single upsert makes the cap exact under concurrent requests (no check-then-insert race).
create function private.chat_begin_turn(p_conversation uuid, p_message_id text, p_message jsonb, p_limit integer default 40) returns text
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); spent integer;
begin
  if actor is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.chat_conversations where id = p_conversation and student_id = actor) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  if p_message_id is null or length(p_message_id) not between 1 and 128 or p_message->>'role' is distinct from 'user'
     or length(p_message::text) > 20000 then raise exception 'Invalid message' using errcode = '22023'; end if;
  insert into private.chat_usage (student_id, day, used) values (actor, (now() at time zone 'utc')::date, 1)
    on conflict (student_id, day) do update set used = private.chat_usage.used + 1 where private.chat_usage.used < least(p_limit, 200)
    returning used into spent;
  if spent is null then return 'limit'; end if;
  insert into public.chat_messages (id, conversation_id, student_id, role, message) values (p_message_id, p_conversation, actor, 'user', p_message)
    on conflict (id) do nothing;
  return 'ok';
end;
$$;

-- Stores the assistant's reply and refreshes the conversation (and its title, once).
create function private.chat_finish_turn(p_conversation uuid, p_reply_id text, p_reply jsonb, p_title text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.chat_conversations where id = p_conversation and student_id = actor) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  if p_reply_id is null or length(p_reply_id) not between 1 and 128 or p_reply->>'role' is distinct from 'assistant' or length(p_reply::text) > 60000 then
    raise exception 'Invalid reply' using errcode = '22023';
  end if;
  insert into public.chat_messages (id, conversation_id, student_id, role, message) values (p_reply_id, p_conversation, actor, 'assistant', p_reply)
    on conflict (id) do nothing;
  update public.chat_conversations set updated_at = now(), title = coalesce(title, left(nullif(btrim(p_title), ''), 60))
   where id = p_conversation and student_id = actor;
end;
$$;
-- The first message names the conversation even if the model never answers.
create function private.chat_name_conversation(p_conversation uuid, p_title text) returns void
language sql security definer set search_path = '' as $$
  update public.chat_conversations set title = left(nullif(btrim(p_title), ''), 60) where id = p_conversation and student_id = auth.uid() and title is null;
$$;
revoke all on function private.chat_begin_turn(uuid,text,jsonb,integer), private.chat_finish_turn(uuid,text,jsonb,text), private.chat_name_conversation(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function private.chat_begin_turn(uuid,text,jsonb,integer), private.chat_finish_turn(uuid,text,jsonb,text), private.chat_name_conversation(uuid,text) to authenticated;
create function public.chat_begin_turn_v1(p_conversation uuid, p_message_id text, p_message jsonb, p_limit integer default 40) returns text
language sql security invoker set search_path = '' as $$ select private.chat_begin_turn(p_conversation, p_message_id, p_message, p_limit); $$;
create function public.chat_finish_turn_v1(p_conversation uuid, p_reply_id text, p_reply jsonb, p_title text default null) returns void
language sql security invoker set search_path = '' as $$ select private.chat_finish_turn(p_conversation, p_reply_id, p_reply, p_title); $$;
create function public.chat_name_conversation_v1(p_conversation uuid, p_title text) returns void
language sql security invoker set search_path = '' as $$ select private.chat_name_conversation(p_conversation, p_title); $$;
revoke all on function public.chat_begin_turn_v1(uuid,text,jsonb,integer), public.chat_finish_turn_v1(uuid,text,jsonb,text), public.chat_name_conversation_v1(uuid,text) from public, anon;
grant execute on function public.chat_begin_turn_v1(uuid,text,jsonb,integer), public.chat_finish_turn_v1(uuid,text,jsonb,text), public.chat_name_conversation_v1(uuid,text) to authenticated;

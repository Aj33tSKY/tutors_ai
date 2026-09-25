-- Direct messages are scoped through their conversation: only the two people in
-- a conversation may read it, and a sender may only write as themselves.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'student@test.local', '{"role":"student","full_name":"Student"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'tutor@test.local',   '{"role":"tutor","full_name":"Tutor"}'),
  ('dddddddd-0000-0000-0000-000000000004', 'other@test.local',   '{"role":"student","full_name":"Stranger"}');

insert into public.direct_conversations (id, student_id, tutor_id)
values ('0000000c-0000-0000-0000-00000000000c',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.direct_messages (conversation_id, sender_id, body)
values ('0000000c-0000-0000-0000-00000000000c',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'private message');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*) from public.direct_messages)::int, 1, 'the student reads their own conversation');
select is((select count(*) from public.direct_conversations)::int, 1, 'the student sees the conversation itself');

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*) from public.direct_messages)::int, 1, 'the tutor reads the shared conversation');

select pg_temp.act_as('dddddddd-0000-0000-0000-000000000004');
select is((select count(*) from public.direct_messages)::int, 0, 'an outsider reads no messages');
select is((select count(*) from public.direct_conversations)::int, 0, 'an outsider sees no conversations');

select throws_ok(
  $$ insert into public.direct_messages (conversation_id, sender_id, body)
     values ('0000000c-0000-0000-0000-00000000000c', 'dddddddd-0000-0000-0000-000000000004', 'intrusion') $$,
  '42501',
  null,
  'an outsider cannot post into a conversation they are not part of'
);

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.direct_messages (conversation_id, sender_id, body)
     values ('0000000c-0000-0000-0000-00000000000c', 'bbbbbbbb-0000-0000-0000-000000000002', 'forged') $$,
  '42501',
  null,
  'a participant cannot post a message attributed to the other person'
);

select lives_ok(
  $$ insert into public.direct_messages (conversation_id, sender_id, body)
     values ('0000000c-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001', 'reply') $$,
  'a participant can post as themselves'
);

select * from finish();
rollback;

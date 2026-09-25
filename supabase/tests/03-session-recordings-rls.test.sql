-- Session recordings are the most sensitive data here: video of a minor in a
-- lesson. Both the metadata row and the object in the private bucket must be
-- readable only by that lesson's participants.
--
-- The buckets are created here because migrations do not create them — they are
-- provisioned per environment by hand. If that ever changes, these inserts
-- become redundant rather than wrong.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into storage.buckets (id, name, public) values
  ('session-recordings', 'session-recordings', false),
  ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'student@test.local', '{"role":"student","full_name":"Student"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'tutor@test.local',   '{"role":"tutor","full_name":"Tutor"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'parent@test.local',  '{"role":"parent","full_name":"Parent"}'),
  ('dddddddd-0000-0000-0000-000000000004', 'other@test.local',   '{"role":"student","full_name":"Stranger"}');

insert into public.student_profiles (id, parent_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003')
on conflict (id) do update set parent_id = excluded.parent_id;

insert into public.bookings (id, student_id, tutor_id, subject, exam_board, start_time, end_time)
values ('0000000a-0000-0000-0000-00000000000a',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002',
        'Mathematics', 'AQA', now(), now() + interval '1 hour');

insert into public.session_recordings (booking_id, storage_path, status)
values ('0000000a-0000-0000-0000-00000000000a',
        '0000000a-0000-0000-0000-00000000000a/recording.mp4', 'ready');

-- Objects are keyed by booking id, which is what the storage policy matches on.
insert into storage.objects (bucket_id, name, owner_id) values
  ('session-recordings', '0000000a-0000-0000-0000-00000000000a/recording.mp4',
   'bbbbbbbb-0000-0000-0000-000000000002');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- The metadata row
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*) from public.session_recordings)::int, 1, 'the student sees their lesson recording');

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*) from public.session_recordings)::int, 1, 'the tutor sees the recording of their lesson');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select is((select count(*) from public.session_recordings)::int, 1, 'the linked parent sees the recording');

select pg_temp.act_as('dddddddd-0000-0000-0000-000000000004');
select is((select count(*) from public.session_recordings)::int, 0, 'an outsider sees no recordings');

-- The object in the private bucket
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*) from storage.objects where bucket_id = 'session-recordings')::int, 1,
  'the student can list the recording object');

select pg_temp.act_as('dddddddd-0000-0000-0000-000000000004');
select is((select count(*) from storage.objects where bucket_id = 'session-recordings')::int, 0,
  'an outsider cannot list the recording object');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('session-recordings', '0000000a-0000-0000-0000-00000000000a/forged.mp4',
             'dddddddd-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'an outsider cannot write into another lesson''s recording folder'
);

-- Attachment uploads are scoped to <conversation_id>/<uploader_id>/...
select pg_temp.act_as_owner();
insert into public.direct_conversations (id, student_id, tutor_id)
values ('0000000c-0000-0000-0000-00000000000c',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('message-attachments',
             '0000000c-0000-0000-0000-00000000000c/aaaaaaaa-0000-0000-0000-000000000001/notes.pdf',
             'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'a participant can upload an attachment under their own folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('message-attachments',
             '0000000c-0000-0000-0000-00000000000c/bbbbbbbb-0000-0000-0000-000000000002/forged.pdf',
             'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a participant cannot upload into the other person''s attachment folder'
);

select * from finish();
rollback;

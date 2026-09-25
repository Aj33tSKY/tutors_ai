-- Transcript audio is a processing buffer, not user content. Unlike a consented
-- session recording, nobody — not even the lesson's own participants — may read
-- the rows or the objects. Only the service role, which bypasses RLS, may.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (select public from storage.buckets where id = 'session-transcript-audio'),
  false,
  'the transcript audio bucket exists and is private'
);

select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'storage' and qual like '%session-transcript-audio%' $$,
  'no storage policy exposes the transcript audio bucket to users'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'student@test.local', '{"role":"student","full_name":"Student"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'tutor@test.local',   '{"role":"tutor","full_name":"Tutor"}');

insert into public.bookings (id, student_id, tutor_id, subject, exam_board, start_time, end_time)
values ('0000000a-0000-0000-0000-00000000000a',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002',
        'Mathematics', 'AQA', now(), now() + interval '1 hour');

insert into public.session_transcript_audio
  (booking_id, participant_identity, role, track_sid, storage_path, status)
values ('0000000a-0000-0000-0000-00000000000a',
        'bbbbbbbb-0000-0000-0000-000000000002', 'tutor', 'TR_test123',
        '0000000a-0000-0000-0000-00000000000a/TR_test123.ogg', 'ready');

insert into storage.objects (bucket_id, name, owner_id)
values ('session-transcript-audio',
        '0000000a-0000-0000-0000-00000000000a/TR_test123.ogg',
        'bbbbbbbb-0000-0000-0000-000000000002');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

-- The tutor owns this lesson and still must not see its transcript audio.
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*) from public.session_transcript_audio)::int, 0,
  'the tutor cannot read transcript audio rows for their own lesson');
select is((select count(*) from storage.objects where bucket_id = 'session-transcript-audio')::int, 0,
  'the tutor cannot list transcript audio objects');

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*) from public.session_transcript_audio)::int, 0,
  'the student cannot read transcript audio rows');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('session-transcript-audio', 'forged.ogg', 'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a user cannot write into the transcript audio bucket'
);

select * from finish();
rollback;

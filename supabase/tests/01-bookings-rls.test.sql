-- Participant scoping on bookings: a lesson must be visible to its student, its
-- tutor, that student's linked parent and an admin, and to nobody else.
begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- Fixtures are created as the owner, which bypasses RLS on purpose.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'student@test.local', '{"role":"student","full_name":"Student"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'tutor@test.local',   '{"role":"tutor","full_name":"Tutor"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'parent@test.local',  '{"role":"parent","full_name":"Parent"}'),
  ('dddddddd-0000-0000-0000-000000000004', 'other@test.local',   '{"role":"student","full_name":"Stranger"}'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'admin@test.local',   '{"role":"admin","full_name":"Admin"}');

insert into public.student_profiles (id, parent_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003')
on conflict (id) do update set parent_id = excluded.parent_id;

-- The stranger is a student too, but with no parent link to anyone.
insert into public.student_profiles (id) values ('dddddddd-0000-0000-0000-000000000004')
on conflict (id) do nothing;

insert into public.bookings (id, student_id, tutor_id, subject, exam_board, start_time, end_time)
values (
  '0000000a-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002',
  'Mathematics', 'AQA', now(), now() + interval '1 hour'
);

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

-- Reads
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*) from public.bookings)::int, 1, 'the student sees their own lesson');

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
select is((select count(*) from public.bookings)::int, 1, 'the tutor sees the lesson they teach');

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
select is((select count(*) from public.bookings)::int, 1, 'the linked parent sees their child''s lesson');

select pg_temp.act_as('eeeeeeee-0000-0000-0000-000000000005');
select is((select count(*) from public.bookings)::int, 1, 'an admin sees the lesson');

select pg_temp.act_as('dddddddd-0000-0000-0000-000000000004');
select is((select count(*) from public.bookings)::int, 0, 'an unrelated student sees no lessons');

-- Writes
select throws_ok(
  $$ insert into public.bookings (student_id, tutor_id, subject, exam_board, start_time, end_time)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
             'Physics', 'AQA', now(), now() + interval '1 hour') $$,
  '42501',
  null,
  'a stranger cannot book a lesson in another student''s name'
);

select lives_ok(
  $$ insert into public.bookings (student_id, tutor_id, subject, exam_board, start_time, end_time)
     values ('dddddddd-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002',
             'Physics', 'AQA', now(), now() + interval '1 hour') $$,
  'a student can book a lesson for themselves'
);

update public.bookings set status = 'cancelled' where id = '0000000a-0000-0000-0000-00000000000a';
select is((select count(*) from public.bookings where status = 'cancelled')::int, 0,
  'a stranger''s update of someone else''s lesson affects no rows');

select pg_temp.act_as_owner();
select is(
  (select status::text from public.bookings where id = '0000000a-0000-0000-0000-00000000000a'),
  'scheduled',
  'the lesson survived the stranger''s update attempt unchanged'
);

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
update public.bookings set status = 'cancelled' where id = '0000000a-0000-0000-0000-00000000000a';
select is((select count(*) from public.bookings where status = 'cancelled')::int, 1,
  'the student can cancel their own lesson');

-- auth.uid() is null for an unauthenticated caller, so nothing should match.
select pg_temp.act_as_owner();
set local role anon;
select is((select count(*) from public.bookings)::int, 0, 'an anonymous caller sees no lessons');

select * from finish();
rollback;

-- session_analytics: readable by the booking's participants (+ linked parent
-- and admin, same as bookings), but only the tutor can edit notes_markdown.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000011', 'student@test.local', '{"role":"student","full_name":"Student"}'),
  ('bbbbbbbb-0000-0000-0000-000000000012', 'tutor@test.local',   '{"role":"tutor","full_name":"Tutor"}'),
  ('cccccccc-0000-0000-0000-000000000013', 'other-tutor@test.local', '{"role":"tutor","full_name":"Other Tutor"}');

insert into public.student_profiles (id) values ('aaaaaaaa-0000-0000-0000-000000000011')
on conflict (id) do nothing;

insert into public.bookings (id, student_id, tutor_id, subject, exam_board, start_time, end_time, amount_gbp_pence, status)
values (
  '0000000b-0000-0000-0000-00000000000b',
  'aaaaaaaa-0000-0000-0000-000000000011',
  'bbbbbbbb-0000-0000-0000-000000000012',
  'Mathematics', 'AQA', now() - interval '1 hour', now(), 4200, 'completed'
);

insert into public.session_analytics (booking_id, notes_markdown)
values ('0000000b-0000-0000-0000-00000000000b', '## Overview\n\nOriginal notes.');

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

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000011');
select is((select count(*) from public.session_analytics)::int, 1, 'the student can read their session analytics');

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000012');
update public.session_analytics set notes_markdown = 'Edited by the tutor.' where booking_id = '0000000b-0000-0000-0000-00000000000b';
select is(
  (select notes_markdown from public.session_analytics where booking_id = '0000000b-0000-0000-0000-00000000000b'),
  'Edited by the tutor.',
  'the tutor can edit their own session''s notes'
);

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000011');
update public.session_analytics set notes_markdown = 'Edited by the student.' where booking_id = '0000000b-0000-0000-0000-00000000000b';
select is(
  (select notes_markdown from public.session_analytics where booking_id = '0000000b-0000-0000-0000-00000000000b'),
  'Edited by the tutor.',
  'the student''s edit attempt affects no rows and the tutor''s notes survive'
);

select pg_temp.act_as('cccccccc-0000-0000-0000-000000000013');
update public.session_analytics set notes_markdown = 'Edited by a stranger.' where booking_id = '0000000b-0000-0000-0000-00000000000b';

select pg_temp.act_as_owner();
select is(
  (select notes_markdown from public.session_analytics where booking_id = '0000000b-0000-0000-0000-00000000000b'),
  'Edited by the tutor.',
  'an unrelated tutor cannot edit someone else''s session notes'
);

set local role anon;
update public.session_analytics set notes_markdown = 'Edited anonymously.' where booking_id = '0000000b-0000-0000-0000-00000000000b';
select is((select count(*) from public.session_analytics)::int, 0, 'an anonymous caller reads no session analytics');

select pg_temp.act_as_owner();
select is(
  (select notes_markdown from public.session_analytics where booking_id = '0000000b-0000-0000-0000-00000000000b'),
  'Edited by the tutor.',
  'an anonymous caller cannot edit session notes'
);

select * from finish();
rollback;

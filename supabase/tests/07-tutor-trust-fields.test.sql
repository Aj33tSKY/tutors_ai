begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000071', 'student@test.local', '{"role":"admin","full_name":"Untrusted signup"}'),
  ('bbbbbbbb-0000-0000-0000-000000000072', 'tutor@test.local', '{"role":"tutor","full_name":"Tutor"}'),
  ('cccccccc-0000-0000-0000-000000000073', 'admin@test.local', '{"role":"student","full_name":"Admin"}');
update public.profiles set role = 'admin' where id = 'cccccccc-0000-0000-0000-000000000073';

select is((select role::text from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000071'), 'student', 'signup metadata cannot create an admin');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000071');
select throws_ok(
  $$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000071'$$,
  'P0001', 'Account role cannot be changed by the account owner',
  'account owners cannot promote themselves'
);

select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000072');
select throws_ok(
  $$insert into public.tutor_profiles (id, hourly_rate, dbs_verified) values ('bbbbbbbb-0000-0000-0000-000000000072', 3500, true)$$,
  'P0001', 'Tutor trust fields are managed by the platform',
  'a tutor cannot create a verified profile'
);
insert into public.tutor_profiles (id, hourly_rate) values ('bbbbbbbb-0000-0000-0000-000000000072', 3500);
select throws_ok(
  $$update public.tutor_profiles set dbs_verified = true where id = 'bbbbbbbb-0000-0000-0000-000000000072'$$,
  'P0001', 'Tutor trust fields are managed by the platform',
  'a tutor cannot verify their own profile'
);
select throws_ok(
  $$update public.tutor_profiles set rating = 5 where id = 'bbbbbbbb-0000-0000-0000-000000000072'$$,
  'P0001', 'Tutor trust fields are managed by the platform',
  'a tutor cannot invent a rating'
);

set local role anon;
select is((select count(*) from public.tutor_profiles)::int, 0, 'unverified tutors are hidden from visitors');

reset role;
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000072');
select throws_ok(
  $$select public.approve_tutor_verification('bbbbbbbb-0000-0000-0000-000000000072', 'I checked the tutor evidence in person')$$,
  'P0001', 'Only administrators can approve tutors',
  'a tutor cannot call the approval workflow'
);
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000073');
select public.approve_tutor_verification('bbbbbbbb-0000-0000-0000-000000000072', 'I checked the tutor evidence in person');
select is((select count(*) from public.tutor_verification_reviews)::int, 1, 'an admin approval records its reviewer and evidence note');
set local role anon;
select is((select count(*) from public.tutor_profiles)::int, 1, 'verified tutors are visible to visitors');

reset role;
select set_config('request.jwt.claims', '', true);
update public.tutor_profiles set is_demo = true where id = 'bbbbbbbb-0000-0000-0000-000000000072';
set local role anon;
select is((select count(*) from public.tutor_profiles)::int, 0, 'demo tutors stay hidden even when verified');

select * from finish();
rollback;

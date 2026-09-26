-- auto_charge_enabled decides whether a lesson is charged to a saved card
-- without the payer present, so being able to set it on someone else's profile
-- would let one account arrange payments from another.
--
-- No new policy was added for this column; it relies on "users can update their
-- own profile". This asserts that reliance rather than assuming it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'student@test.local', '{"role":"student","full_name":"Student"}'),
  ('dddddddd-0000-0000-0000-000000000004', 'other@test.local',   '{"role":"student","full_name":"Other"}');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

select is(
  (select auto_charge_enabled from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  false,
  'automatic payment is off until somebody turns it on'
);

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
update public.profiles set auto_charge_enabled = true where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select auto_charge_enabled from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  true,
  'a student can turn on automatic payment for themselves'
);

-- Someone else's preference is not theirs to change. Flip it the opposite way to
-- its current value, so a blocked update and a successful one differ.
select pg_temp.act_as('dddddddd-0000-0000-0000-000000000004');
update public.profiles set auto_charge_enabled = false where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select auto_charge_enabled from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  true,
  'an unrelated account cannot change someone else''s automatic payment setting'
);

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
update public.profiles set auto_charge_enabled = false where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select auto_charge_enabled from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  false,
  'and can turn it back off'
);

select * from finish();
rollback;

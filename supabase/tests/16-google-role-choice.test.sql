begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000161', 'google@test.local', '{"full_name":"Google Person"}', '{"provider":"google"}'),
  ('bbbbbbbb-0000-0000-0000-000000000162', 'email-tutor@test.local', '{"role":"tutor","full_name":"Email Tutor"}', '{"provider":"email"}'),
  ('dddddddd-0000-0000-0000-000000000164', 'google2@test.local', '{"name":"Named Only"}', '{"provider":"google"}');

select is((select role::text || ':' || role_confirmed::text from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000161'), 'student:false', 'a Google account starts as an unconfirmed student');
select is((select full_name from public.profiles where id = 'dddddddd-0000-0000-0000-000000000164'), 'Named Only', 'the name comes from Google when there is no full_name');
select is((select role::text || ':' || role_confirmed::text from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000162'), 'tutor:true', 'an email sign-up keeps its chosen role and is confirmed');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000161');
select throws_ok($$update public.profiles set role = 'admin', role_confirmed = true where id = 'aaaaaaaa-0000-0000-0000-000000000161'$$, 'P0001', 'Account role cannot be changed by the account owner', 'an unconfirmed account cannot choose admin');
select throws_ok($$update public.profiles set role = 'parent', role_confirmed = true where id = 'aaaaaaaa-0000-0000-0000-000000000161'$$, 'P0001', 'Account role cannot be changed by the account owner', 'an unconfirmed account cannot choose parent');
select throws_ok($$update public.profiles set role = 'tutor' where id = 'aaaaaaaa-0000-0000-0000-000000000161'$$, 'P0001', 'Account role cannot be changed by the account owner', 'the choice must confirm the account');
select lives_ok($$update public.profiles set role = 'tutor', role_confirmed = true where id = 'aaaaaaaa-0000-0000-0000-000000000161'$$, 'an unconfirmed account can choose tutor once');
select throws_ok($$update public.profiles set role = 'student' where id = 'aaaaaaaa-0000-0000-0000-000000000161'$$, 'P0001', 'Account role cannot be changed by the account owner', 'after the choice the role is fixed');
select throws_ok($$update public.profiles set role_confirmed = false where id = 'aaaaaaaa-0000-0000-0000-000000000161'$$, 'P0001', 'Account role cannot be changed by the account owner', 'an owner cannot reopen the choice');
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000162');
select throws_ok($$update public.profiles set role = 'student' where id = 'bbbbbbbb-0000-0000-0000-000000000162'$$, 'P0001', 'Account role cannot be changed by the account owner', 'a confirmed email account cannot change role');

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000081', 'tutor-profile@test.local', '{"role":"tutor","full_name":"Profile Tutor"}'),
  ('bbbbbbbb-0000-0000-0000-000000000082', 'other-profile@test.local', '{"role":"tutor","full_name":"Other Tutor"}');

select is((select public from storage.buckets where id = 'tutor-avatars'), true, 'profile photos are served from a public bucket');
select is((select file_size_limit from storage.buckets where id = 'tutor-avatars'), 5242880::bigint, 'avatar uploads are limited to 5 MB');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in (
  'tutors upload their own avatars', 'tutors manage their own avatar files', 'tutors delete their own avatar files'
))::int, 3, 'avatar objects have owner-scoped write policies');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000081');
select lives_ok($$update public.profiles set full_name = 'Updated Tutor' where id = 'aaaaaaaa-0000-0000-0000-000000000081'$$, 'tutors can edit their own display name');
select throws_ok(
  $$update public.profiles set email = 'forged@test.local' where id = 'aaaaaaaa-0000-0000-0000-000000000081'$$,
  'P0001', 'Change your email through account settings',
  'tutors cannot change the profile email outside Auth confirmation'
);
select is((select count(*) from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000082' and full_name = 'Updated Tutor')::int, 0, 'tutors cannot edit another account');

reset role;
select set_config('request.jwt.claims', '', true);
update auth.users set email = 'confirmed@test.local' where id = 'aaaaaaaa-0000-0000-0000-000000000081';
select is((select email from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000081'), 'confirmed@test.local', 'confirmed Auth email updates the app profile');

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
 ('aaa00000-0000-4000-8000-000000000001', 'portable-student@test.local', '{"role":"student","full_name":"Student"}'),
 ('bbb00000-0000-4000-8000-000000000002', 'portable-tutor@test.local', '{"role":"tutor","full_name":"Tutor"}'),
 ('ccc00000-0000-4000-8000-000000000003', 'portable-parent@test.local', '{"role":"parent","full_name":"Parent"}'),
 ('ddd00000-0000-4000-8000-000000000004', 'portable-outsider@test.local', '{"role":"student","full_name":"Outsider"}');
insert into public.student_profiles (id,parent_id) values ('aaa00000-0000-4000-8000-000000000001','ccc00000-0000-4000-8000-000000000003')
 on conflict (id) do update set parent_id=excluded.parent_id;
insert into public.bookings (id,student_id,tutor_id,subject,exam_board,start_time,end_time,amount_gbp_pence)
values ('eee00000-0000-4000-8000-000000000005','aaa00000-0000-4000-8000-000000000001','bbb00000-0000-4000-8000-000000000002','Mathematics','AQA',now(),now()+interval '1 hour',3500);

select ok(not has_function_privilege('anon','public.rename_booking_lesson(uuid,text)','execute'),'anonymous cannot call rename RPC');
select ok(not (select prosecdef from pg_proc where oid='public.rename_booking_lesson(uuid,text)'::regprocedure),'rename RPC does not bypass RLS');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select lesson_name from public.rename_booking_lesson('eee00000-0000-4000-8000-000000000005','  Revision  ')),'Revision','participant can rename and whitespace is trimmed');
select is((select amount_gbp_pence from public.bookings where id='eee00000-0000-4000-8000-000000000005'),3500,'rename preserves price');
select throws_ok($$select * from public.rename_booking_lesson('eee00000-0000-4000-8000-000000000005',repeat('x',121))$$,'22023','Invalid lesson name','database rejects an oversized name');
select set_config('request.jwt.claims','{"sub":"ddd00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.rename_booking_lesson('eee00000-0000-4000-8000-000000000005','Forged')),0,'outsider cannot rename');
select set_config('request.jwt.claims','{"sub":"ccc00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.rename_booking_lesson('eee00000-0000-4000-8000-000000000005','Forged')),0,'linked parent cannot rename');
reset role;
update public.bookings set status='cancelled' where id='eee00000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.rename_booking_lesson('eee00000-0000-4000-8000-000000000005','New')),0,'cancelled lesson cannot be renamed');
reset role;
select * from finish();
rollback;

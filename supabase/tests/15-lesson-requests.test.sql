begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
insert into auth.users(id,email,raw_user_meta_data) values
 ('aaa70000-0000-4000-8000-000000000001','req-student@test.local','{"role":"student","full_name":"Student"}'),
 ('bbb70000-0000-4000-8000-000000000002','req-tutor@test.local','{"role":"tutor","full_name":"Tutor"}'),
 ('ccc70000-0000-4000-8000-000000000003','req-unverified@test.local','{"role":"tutor","full_name":"Unverified"}');
insert into public.tutor_profiles(id,hourly_rate,subjects,boards,dbs_verified) values
 ('bbb70000-0000-4000-8000-000000000002',3500,'{Mathematics}','{AQA}',true),
 ('ccc70000-0000-4000-8000-000000000003',3500,'{Mathematics}','{AQA}',false);
insert into public.availability(tutor_id,day_of_week,start_time,end_time)
 select t,d,'10:00','12:00' from generate_series(0,6) d, (values ('bbb70000-0000-4000-8000-000000000002'::uuid),('ccc70000-0000-4000-8000-000000000003'::uuid)) v(t);
create temp table slots as select s, row_number() over (order by s) n from private.tutor_open_slots('bbb70000-0000-4000-8000-000000000002', 28) s;
grant select on slots to authenticated, anon;
select ok((select count(*) from slots) >= 20,'open slots are generated for a verified tutor');
select is((select count(*)::int from private.tutor_open_slots('ccc70000-0000-4000-8000-000000000003', 28)),0,'an unverified tutor offers nothing');
select ok((select bool_and(extract(minute from s at time zone 'Europe/London') = 0 and extract(hour from s at time zone 'Europe/London') in (10, 11)) from slots),'slots follow UK wall-clock availability');
insert into public.bookings(student_id,tutor_id,start_time,end_time,amount_gbp_pence) select 'aaa70000-0000-4000-8000-000000000001','bbb70000-0000-4000-8000-000000000002',s,s+interval '1 hour',3500 from slots where n=1;
select ok(not exists (select 1 from private.tutor_open_slots('bbb70000-0000-4000-8000-000000000002', 28) o where o = (select s from slots where n=1)),'a booked hour is no longer offered');
delete from public.bookings;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa70000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$insert into public.lesson_requests(student_id,tutor_id,subject,exam_board,requested_start_time,requested_end_time,is_trial) values('aaa70000-0000-4000-8000-000000000001','bbb70000-0000-4000-8000-000000000002','Mathematics','AQA',now()+interval '1 day',now()+interval '1 day 1 hour',true)$$,'42501',null,'students cannot insert requests directly');
select is((public.request_lesson_v1('bbb70000-0000-4000-8000-000000000002','Mathematics','AQA',(select s from slots where n=2)))->>'isTrial','true','first request is the free trial');
select is((public.request_lesson_v1('bbb70000-0000-4000-8000-000000000002','Mathematics','AQA',(select s from slots where n=2)))->>'duplicate','true','a repeat is recognised, not duplicated');
select is((select count(*)::int from public.lesson_requests),1,'one request, one message');
select is((select count(*)::int from public.direct_messages),1,'the notification is part of the same transaction');
select is((public.request_lesson_v1('bbb70000-0000-4000-8000-000000000002','Mathematics','AQA',(select s from slots where n=3)))->>'isTrial','false','only the first request is a trial');
select throws_ok($$select public.request_lesson_v1('bbb70000-0000-4000-8000-000000000002','Mathematics','AQA',(select s + interval '30 minutes' from slots where n=5))$$,'22023','slot_unavailable','an off-grid time is refused');
select throws_ok($$select public.request_lesson_v1('bbb70000-0000-4000-8000-000000000002','Physics','AQA',(select s from slots where n=5))$$,'22023','subject_unavailable','an unoffered subject is refused');
select lives_ok($$select public.request_lesson_v1('bbb70000-0000-4000-8000-000000000002','Mathematics','AQA',(select s from slots where n=4))$$,'third open request allowed');
select throws_ok($$select public.request_lesson_v1('bbb70000-0000-4000-8000-000000000002','Mathematics','AQA',(select s from slots where n=5))$$,'22023','too_many_requests','volume per tutor is bounded');
select set_config('request.jwt.claims','{"sub":"bbb70000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$update public.lesson_requests set is_trial=true where is_trial=false$$,'42501',null,'a request cannot be altered after it is made');
reset role;
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users(id,email,raw_user_meta_data) values
 ('aaa10000-0000-4000-8000-000000000001','live-student@test.local','{"role":"student","full_name":"Student"}'),
 ('bbb10000-0000-4000-8000-000000000002','live-tutor@test.local','{"role":"tutor","full_name":"Tutor"}'),
 ('ccc10000-0000-4000-8000-000000000003','live-stranger@test.local','{"role":"student","full_name":"Stranger"}');
insert into public.student_profiles(id) values('aaa10000-0000-4000-8000-000000000001') on conflict (id) do nothing;
insert into public.bookings(id,student_id,tutor_id,subject,exam_board,start_time,end_time,amount_gbp_pence)
values('eee10000-0000-4000-8000-000000000005','aaa10000-0000-4000-8000-000000000001','bbb10000-0000-4000-8000-000000000002','Mathematics','AQA',now(),now()+interval '1 hour',3500);
select ok(not has_function_privilege('anon','public.start_booking_lesson(uuid)','execute'),'anonymous cannot start a lesson');
select ok(not has_function_privilege('anon','public.consent_booking_recording(uuid)','execute'),'anonymous cannot consent');
select ok(not (select prosecdef from pg_proc where oid='public.start_booking_lesson(uuid)'::regprocedure),'start preserves RLS');
select ok(not (select prosecdef from pg_proc where oid='public.consent_booking_recording(uuid)'::regprocedure),'consent preserves RLS');
select ok(not has_column_privilege('authenticated','public.session_recording_consents','tutor_id','update'),'consent cannot be reassigned');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa10000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.start_booking_lesson('eee10000-0000-4000-8000-000000000005'),false,'student cannot open lesson');
select throws_ok($$select public.consent_booking_recording('eee10000-0000-4000-8000-000000000005')$$,'42501',null,'student cannot consent for tutor');
select set_config('request.jwt.claims','{"sub":"bbb10000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.start_booking_lesson('eee10000-0000-4000-8000-000000000005'),true,'tutor can start own lesson');
select lives_ok($$select public.consent_booking_recording('eee10000-0000-4000-8000-000000000005')$$,'tutor can save consent');
select lives_ok($$select public.consent_booking_recording('eee10000-0000-4000-8000-000000000005')$$,'consent replay is safe');
select set_config('request.jwt.claims','{"sub":"ccc10000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.start_booking_lesson('eee10000-0000-4000-8000-000000000005'),false,'an unrelated user cannot open the lesson');
reset role;
update public.bookings set status='cancelled' where id='eee10000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbb10000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.start_booking_lesson('eee10000-0000-4000-8000-000000000005'),false,'cancelled lesson cannot be reopened');
reset role;
select * from finish();
rollback;

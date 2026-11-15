begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
insert into auth.users(id,email,raw_user_meta_data) values
 ('aaa20000-0000-4000-8000-000000000001','schedule-student@test.local','{"role":"student","full_name":"Student"}'),
 ('bbb20000-0000-4000-8000-000000000002','schedule-tutor@test.local','{"role":"tutor","full_name":"Tutor"}'),
 ('ccc20000-0000-4000-8000-000000000003','schedule-other-tutor@test.local','{"role":"tutor","full_name":"Other tutor"}');
insert into public.tutor_profiles(id,hourly_rate) values('bbb20000-0000-4000-8000-000000000002',3500),('ccc20000-0000-4000-8000-000000000003',4500);
insert into public.lesson_requests(id,student_id,tutor_id,subject,exam_board,requested_start_time,requested_end_time,is_trial)
values('ddd20000-0000-4000-8000-000000000004','aaa20000-0000-4000-8000-000000000001','bbb20000-0000-4000-8000-000000000002','Mathematics','AQA',date_trunc('day',now())+interval '1 day 12 hours',date_trunc('day',now())+interval '1 day 13 hours',true);
select ok(not has_function_privilege('anon','public.schedule_lessons_v1(uuid,timestamptz,integer,integer,text,uuid,uuid)','execute'),'anonymous cannot schedule');
select ok(not (select prosecdef from pg_proc where oid='public.schedule_lessons_v1(uuid,timestamptz,integer,integer,text,uuid,uuid)'::regprocedure),'public scheduling wrapper preserves caller identity');
select ok(not has_function_privilege('service_role','private.schedule_lessons_v1(uuid,timestamptz,integer,integer,text,uuid,uuid)','execute'),'machine service role cannot impersonate a tutor command');
select ok(has_column_privilege('authenticated','public.session_analytics','notes_markdown','update'),'authenticated tutor policy can save notes');
select ok(not has_column_privilege('authenticated','public.session_analytics','recording_path','update'),'participants cannot redirect private recording grants');
select ok(not has_column_privilege('authenticated','public.session_analytics','full_transcript','update'),'participants cannot rewrite transcript provenance');
select ok(not has_column_privilege('authenticated','public.session_analytics','summary_notes','update'),'participants cannot overwrite generated summaries');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa20000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.schedule_lessons_v1('aaa20000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '1 day 12 hours',1,2,'Revision','ddd20000-0000-4000-8000-000000000004','eee20000-0000-4000-8000-000000000005')$$,'42501',null,'student cannot schedule as tutor');
select set_config('request.jwt.claims','{"sub":"bbb20000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select public.schedule_lessons_v1('aaa20000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '1 day 12 hours',1,2,'Revision','ddd20000-0000-4000-8000-000000000004','eee20000-0000-4000-8000-000000000005')$$,'tutor schedules a requested series');
select is((select count(*)::int from public.bookings),2,'exactly two sessions created');
select is((select count(*)::int from public.bookings where is_trial),1,'only first session is free');
select is((select amount_gbp_pence from public.bookings where not is_trial),3500,'follow-up keeps the tutor rate snapshot');
select is((select status from public.lesson_requests where id='ddd20000-0000-4000-8000-000000000004'),'scheduled','request status committed with bookings');
select lives_ok($$select public.schedule_lessons_v1('aaa20000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '1 day 12 hours',1,2,'Revision','ddd20000-0000-4000-8000-000000000004','eee20000-0000-4000-8000-000000000005')$$,'idempotency replay succeeds');
select is((select count(*)::int from public.direct_messages),1,'replay does not duplicate confirmation');
select throws_ok($$select public.schedule_lessons_v1('aaa20000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '1 day 12 hours',1,2,'Different name','ddd20000-0000-4000-8000-000000000004','eee20000-0000-4000-8000-000000000005')$$,'22023',null,'idempotency key cannot change its input');
reset role;
-- Another tutor's booking is hidden by this tutor's RLS, but must still prevent
-- scheduling an overlapping student session. Clash is in the third week so
-- the assertion also proves rollback of earlier inserts in the batch.
insert into public.bookings(student_id,tutor_id,subject,exam_board,start_time,end_time,amount_gbp_pence)
values('aaa20000-0000-4000-8000-000000000001','ccc20000-0000-4000-8000-000000000003','Mathematics','AQA',date_trunc('day',now())+interval '16 days 12 hours',date_trunc('day',now())+interval '16 days 13 hours',4500);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbb20000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.schedule_lessons_v1('aaa20000-0000-4000-8000-000000000001',date_trunc('day',now())+interval '2 days 12 hours',1,3,'Conflicting batch',null,'fff20000-0000-4000-8000-000000000006')$$,'23P01',null,'student clash prevents the whole series');
select is((select count(*)::int from public.bookings where lesson_name='Conflicting batch'),0,'no partially created series survives');
select throws_ok($$select public.tutor_change_lesson_v1((select id from public.bookings where is_trial),'complete')$$,'P0001',null,'unstarted session cannot complete');
select lives_ok($$select public.tutor_change_lesson_v1((select id from public.bookings where is_trial),'cancel','{"series":true}')$$,'tutor cancels the unstarted remainder by series identity');
reset role;
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
insert into auth.users(id,email,raw_user_meta_data) values
 ('aaa70000-0000-4000-8000-000000000001','cc-student@test.local','{"role":"student","full_name":"Student"}'),
 ('bbb70000-0000-4000-8000-000000000002','cc-tutor@test.local','{"role":"tutor","full_name":"Tutor"}'),
 ('ccc70000-0000-4000-8000-000000000003','cc-other@test.local','{"role":"tutor","full_name":"Other tutor"}');
insert into public.tutor_profiles(id,hourly_rate) values('bbb70000-0000-4000-8000-000000000002',3500),('ccc70000-0000-4000-8000-000000000003',3500);
insert into public.bookings(id,student_id,tutor_id,start_time,end_time,amount_gbp_pence,status,payment_status) values
 ('ddd70000-0000-4000-8000-000000000004','aaa70000-0000-4000-8000-000000000001','bbb70000-0000-4000-8000-000000000002',now()-interval '2 hours',now()-interval '1 hour',3500,'completed','pending');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbb70000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.claim_connected_customer_v1('ddd70000-0000-4000-8000-000000000004','cus_conn1')$$,'55000',null,'no customer can be recorded before the tutor has a payout account');
select is(public.connected_customer_for_booking_v1('ddd70000-0000-4000-8000-000000000004'),null,'nothing stored without an account');
select is(public.claim_stripe_account_v1('acct_tutor1'),'acct_tutor1','the tutor connects an account');
select is(public.connected_customer_for_booking_v1('ddd70000-0000-4000-8000-000000000004'),null,'nothing stored yet for this student');
select is(public.claim_connected_customer_v1('ddd70000-0000-4000-8000-000000000004','cus_conn1'),'cus_conn1','the first connected customer is recorded');
select is(public.claim_connected_customer_v1('ddd70000-0000-4000-8000-000000000004','cus_conn2'),'cus_conn1','a stored connected customer is never re-pointed');
select is(public.connected_customer_for_booking_v1('ddd70000-0000-4000-8000-000000000004'),'cus_conn1','the stored customer is read back');
select throws_ok($$select public.claim_connected_customer_v1('ddd70000-0000-4000-8000-000000000004','not-a-customer')$$,'22023',null,'malformed customer ids are refused');

select set_config('request.jwt.claims','{"sub":"ccc70000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.claim_connected_customer_v1('ddd70000-0000-4000-8000-000000000004','cus_stolen')$$,'P0002',null,'another tutor cannot record a customer for this lesson');
select throws_ok($$select public.connected_customer_for_booking_v1('ddd70000-0000-4000-8000-000000000004')$$,'P0002',null,'another tutor cannot read it');

select set_config('request.jwt.claims','{"sub":"aaa70000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.claim_connected_customer_v1('ddd70000-0000-4000-8000-000000000004','cus_student')$$,'P0002',null,'the student cannot record one');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
insert into auth.users(id,email,raw_user_meta_data) values
 ('aaa50000-0000-4000-8000-000000000001','bill-student@test.local','{"role":"student","full_name":"Student"}'),
 ('bbb50000-0000-4000-8000-000000000002','bill-tutor@test.local','{"role":"tutor","full_name":"Tutor"}');
insert into public.tutor_profiles(id,hourly_rate) values('bbb50000-0000-4000-8000-000000000002',3500);
insert into public.bookings(id,student_id,tutor_id,start_time,end_time,amount_gbp_pence,status,payment_status) values
 ('ddd50000-0000-4000-8000-000000000004','aaa50000-0000-4000-8000-000000000001','bbb50000-0000-4000-8000-000000000002',now()-interval '2 hours',now()-interval '1 hour',3500,'completed','pending');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa50000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$update public.bookings set payment_status='paid' where id='ddd50000-0000-4000-8000-000000000004'$$,'42501',null,'student cannot mark a lesson paid');
select throws_ok($$update public.bookings set amount_gbp_pence=0 where id='ddd50000-0000-4000-8000-000000000004'$$,'42501',null,'student cannot change the price');
select throws_ok($$update public.bookings set stripe_invoice_id='in_forged' where id='ddd50000-0000-4000-8000-000000000004'$$,'42501',null,'participant cannot forge an invoice id');
select lives_ok($$update public.bookings set lesson_name='Revision' where id='ddd50000-0000-4000-8000-000000000004'$$,'ordinary lesson fields stay writable');
select throws_ok($$update public.profiles set stripe_customer_id='cus_victim' where id='aaa50000-0000-4000-8000-000000000001'$$,'42501',null,'user cannot point at another billing customer');
select lives_ok($$update public.profiles set auto_charge_enabled=true where id='aaa50000-0000-4000-8000-000000000001'$$,'auto-charge preference remains the user''s');
select is(public.claim_stripe_customer_v1('cus_first'),'cus_first','first customer is recorded');
select is(public.claim_stripe_customer_v1('cus_second'),'cus_first','a stored customer is never re-pointed');
select throws_ok($$select public.claim_stripe_customer_v1('not-a-customer')$$,'22023',null,'malformed customer ids are refused');

select set_config('request.jwt.claims','{"sub":"bbb50000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$update public.tutor_profiles set stripe_account_id='acct_attacker' where id='bbb50000-0000-4000-8000-000000000002'$$,'42501',null,'tutor cannot point payouts at a chosen account');
select throws_ok($$update public.tutor_profiles set stripe_payouts_enabled=true where id='bbb50000-0000-4000-8000-000000000002'$$,'42501',null,'tutor cannot self-declare payouts enabled');
select is(public.claim_stripe_account_v1('acct_first'),'acct_first','first payout account is recorded');
select is(public.claim_stripe_account_v1('acct_other'),'acct_first','a stored account is never re-pointed');
select ok(public.record_booking_invoice_v1('ddd50000-0000-4000-8000-000000000004','in_1','https://invoice.example/1'),'tutor records the invoice');
select ok(not public.record_booking_invoice_v1('ddd50000-0000-4000-8000-000000000004','in_2','https://invoice.example/2'),'a second invoice cannot replace the first');
select is(public.claim_booking_student_customer_v1('ddd50000-0000-4000-8000-000000000004','cus_other'),'cus_first','tutor cannot replace the student''s stored customer');

select set_config('request.jwt.claims','{"sub":"aaa50000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(not public.record_booking_invoice_v1('ddd50000-0000-4000-8000-000000000004','in_3','https://invoice.example/3'),'a student cannot record an invoice');
select throws_ok($$select private.accept_provider_event('stripe','evt_1','invoice.paid','{}')$$,'42501',null,'clients cannot inject provider events');
reset role;

select ok(private.accept_provider_event('stripe','evt_1','invoice.paid','{}'),'new event is accepted');
select ok(not private.accept_provider_event('stripe','evt_1','invoice.paid','{}'),'a redelivered event is deduplicated');
select ok(private.apply_invoice_status('ddd50000-0000-4000-8000-000000000004','in_1','paid'),'invoice marks paid');
select ok(not private.apply_invoice_status('ddd50000-0000-4000-8000-000000000004','in_unrecorded','paid'),'an unrecorded invoice reports no match so the event is retried');
select ok(private.apply_invoice_status('ddd50000-0000-4000-8000-000000000004','in_1','failed'),'a late failure event still matches the invoice');
select is((select payment_status::text from public.bookings where id='ddd50000-0000-4000-8000-000000000004'),'paid','a late failure cannot undo a settled payment');
select is((select count(*)::int from private.provider_event_claim(5)),1,'a worker claims the stored event');
select is((select count(*)::int from private.provider_event_claim(5)),0,'a leased event is not claimed twice');
select * from finish();
rollback;

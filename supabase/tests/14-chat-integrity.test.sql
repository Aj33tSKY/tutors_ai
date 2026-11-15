begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users(id,email,raw_user_meta_data) values
 ('aaa60000-0000-4000-8000-000000000001','chat-a@test.local','{"role":"student","full_name":"A"}'),
 ('bbb60000-0000-4000-8000-000000000002','chat-b@test.local','{"role":"student","full_name":"B"}');
insert into public.chat_conversations(id,student_id) values
 ('ddd60000-0000-4000-8000-000000000004','aaa60000-0000-4000-8000-000000000001'),
 ('eee60000-0000-4000-8000-000000000005','bbb60000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa60000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$insert into public.chat_messages(id,conversation_id,student_id,role,message) values('x1','ddd60000-0000-4000-8000-000000000004','aaa60000-0000-4000-8000-000000000001','assistant','{"role":"assistant"}')$$,'42501',null,'students cannot forge messages');
select is(public.chat_begin_turn_v1('ddd60000-0000-4000-8000-000000000004','m1','{"role":"user","parts":[]}',2),'ok','first turn allowed');
select is(public.chat_begin_turn_v1('ddd60000-0000-4000-8000-000000000004','m1','{"role":"user","parts":[]}',2),'ok','a replay is charged but stores one message');
select is((select count(*)::int from public.chat_messages),1,'replay did not duplicate the message');
select is(public.chat_begin_turn_v1('ddd60000-0000-4000-8000-000000000004','m2','{"role":"user","parts":[]}',2),'limit','the cap is exact');
select throws_ok($$delete from public.chat_messages$$,'42501',null,'students cannot delete messages to reset the cap');
select is(public.chat_begin_turn_v1('ddd60000-0000-4000-8000-000000000004','m3','{"role":"user","parts":[]}',2),'limit','the cap survives a deletion attempt');
select throws_ok($$select public.chat_begin_turn_v1('eee60000-0000-4000-8000-000000000005','m4','{"role":"user","parts":[]}',2)$$,'P0002',null,'cannot write into another student''s conversation');
select throws_ok($$select public.chat_begin_turn_v1('ddd60000-0000-4000-8000-000000000004','m5','{"role":"assistant","parts":[]}',9)$$,'22023',null,'the user turn must have the user role');
select lives_ok($$select public.chat_finish_turn_v1('ddd60000-0000-4000-8000-000000000004','r1','{"role":"assistant","parts":[]}','Circular motion')$$,'reply stored');
select is((select title from public.chat_conversations where id='ddd60000-0000-4000-8000-000000000004'),'Circular motion','first reply names the conversation');
select is((select count(*)::int from public.chat_conversations where id='eee60000-0000-4000-8000-000000000005'),0,'other students'' conversations stay invisible');
reset role;
select * from finish();
rollback;

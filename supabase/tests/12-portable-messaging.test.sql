begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,email,raw_user_meta_data) values
 ('aaa30000-0000-4000-8000-000000000001','msg-student@test.local','{"role":"student","full_name":"Student"}'),
 ('bbb30000-0000-4000-8000-000000000002','msg-tutor@test.local','{"role":"tutor","full_name":"Tutor"}'),
 ('ccc30000-0000-4000-8000-000000000003','msg-outsider@test.local','{"role":"student","full_name":"Outsider"}');
insert into public.direct_conversations(id,student_id,tutor_id,updated_at)
values('ddd30000-0000-4000-8000-000000000004','aaa30000-0000-4000-8000-000000000001','bbb30000-0000-4000-8000-000000000002','2020-01-01');
select ok((select not public from storage.buckets where id='message-attachments'),'attachment bucket is private');
select is((select file_size_limit from storage.buckets where id='message-attachments'),10485760::bigint,'bucket enforces the 10 MiB limit');
select ok((select not ('image/svg+xml' = any(allowed_mime_types)) from storage.buckets where id='message-attachments'),'scriptable SVG is not accepted');
select ok(not has_function_privilege('authenticated','private.touch_direct_conversation()','execute'),'trigger function is not callable');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaa30000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into public.direct_messages(conversation_id,sender_id,body) values('ddd30000-0000-4000-8000-000000000004','aaa30000-0000-4000-8000-000000000001','hello')$$,'participant sends');
select ok((select updated_at>'2020-01-02' from public.direct_conversations where id='ddd30000-0000-4000-8000-000000000004'),'sending bumps the conversation atomically');
select throws_ok($$insert into public.direct_messages(conversation_id,sender_id,body,attachment_path,attachment_name,attachment_type) values('ddd30000-0000-4000-8000-000000000004','aaa30000-0000-4000-8000-000000000001','','ddd30000-0000-4000-8000-000000000004/bbb30000-0000-4000-8000-000000000002/x.pdf','x.pdf','application/pdf')$$,'23514',null,'cannot attach an object under another sender');
select throws_ok($$insert into public.direct_messages(conversation_id,sender_id,body,attachment_path,attachment_name,attachment_type) values('ddd30000-0000-4000-8000-000000000004','aaa30000-0000-4000-8000-000000000001','','eee30000-0000-4000-8000-000000000005/aaa30000-0000-4000-8000-000000000001/x.pdf','x.pdf','application/pdf')$$,'23514',null,'cannot attach an object from another conversation');
select set_config('request.jwt.claims','{"sub":"ccc30000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$insert into public.direct_messages(conversation_id,sender_id,body) values('ddd30000-0000-4000-8000-000000000004','ccc30000-0000-4000-8000-000000000003','intrude')$$,'42501',null,'outsider cannot post');
reset role;
select * from finish();
rollback;

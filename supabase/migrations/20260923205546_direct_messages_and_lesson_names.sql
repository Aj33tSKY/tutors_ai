alter table public.bookings add column if not exists lesson_name text;

drop policy if exists "participants update their bookings" on public.bookings;
create policy "participants update their bookings"
  on public.bookings for update to authenticated
  using (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
  with check (student_id = (select auth.uid()) or tutor_id = (select auth.uid()));

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, tutor_id),
  check (student_id <> tutor_id)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  attachment_path text,
  attachment_name text,
  attachment_type text,
  created_at timestamptz not null default now(),
  check (char_length(body) <= 4000),
  check (body <> '' or attachment_path is not null)
);

create index if not exists direct_conversations_student_idx
  on public.direct_conversations (student_id, updated_at desc);
create index if not exists direct_conversations_tutor_idx
  on public.direct_conversations (tutor_id, updated_at desc);
create index if not exists direct_messages_conversation_idx
  on public.direct_messages (conversation_id, created_at);

alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "participants read direct conversations" on public.direct_conversations;
create policy "participants read direct conversations"
  on public.direct_conversations for select to authenticated
  using (student_id = (select auth.uid()) or tutor_id = (select auth.uid()));

drop policy if exists "booking participants create direct conversations" on public.direct_conversations;
create policy "booking participants create direct conversations"
  on public.direct_conversations for insert to authenticated
  with check (
    (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
    and exists (
      select 1 from public.bookings b
      where b.student_id = direct_conversations.student_id
        and b.tutor_id = direct_conversations.tutor_id
    )
  );

drop policy if exists "participants update direct conversations" on public.direct_conversations;
create policy "participants update direct conversations"
  on public.direct_conversations for update to authenticated
  using (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
  with check (student_id = (select auth.uid()) or tutor_id = (select auth.uid()));

drop policy if exists "participants read direct messages" on public.direct_messages;
create policy "participants read direct messages"
  on public.direct_messages for select to authenticated
  using (
    exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id
        and (c.student_id = (select auth.uid()) or c.tutor_id = (select auth.uid()))
    )
  );

drop policy if exists "participants send direct messages" on public.direct_messages;
create policy "participants send direct messages"
  on public.direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id
        and (c.student_id = (select auth.uid()) or c.tutor_id = (select auth.uid()))
    )
  );

do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; end $$;

drop policy if exists "conversation participants read attachments" on storage.objects;
create policy "conversation participants read attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from public.direct_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.student_id = (select auth.uid()) or c.tutor_id = (select auth.uid()))
    )
  );

drop policy if exists "conversation participants upload attachments" on storage.objects;
create policy "conversation participants upload attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.direct_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.student_id = (select auth.uid()) or c.tutor_id = (select auth.uid()))
    )
  );

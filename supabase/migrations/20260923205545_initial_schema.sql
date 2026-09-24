-- Kindling: UK A-Level STEM tutoring platform
-- Run in the Supabase SQL editor (or `supabase db push`) after the project is provisioned.

create extension if not exists vector;
create extension if not exists pg_trgm;

do $$ begin
  create type user_role as enum ('student', 'parent', 'tutor', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type exam_board as enum ('AQA', 'Edexcel', 'OCR_A', 'OCR_B', 'WJEC', 'CIE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stem_subject as enum ('Mathematics', 'Further_Maths', 'Physics', 'Chemistry', 'Biology', 'Computing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum ('scheduled', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('pending', 'paid', 'refunded', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  role user_role not null default 'student',
  full_name text not null,
  email text unique not null,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists tutor_profiles (
  id uuid primary key references profiles(id) on delete cascade,
  bio text,
  headline text,
  hourly_rate int not null, -- GBP pence
  dbs_verified boolean default false,
  subjects stem_subject[] not null default '{}',
  boards exam_board[] not null default '{}',
  years_experience int,
  rating numeric(2, 1) default 5.0
);

create table if not exists student_profiles (
  id uuid primary key references profiles(id) on delete cascade,
  parent_id uuid references profiles(id),
  target_grades jsonb default '{}',
  enrolled_subjects stem_subject[] default '{}'
);

create table if not exists availability (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid references tutor_profiles(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_recurring boolean default true,
  check (end_time > start_time)
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references profiles(id),
  tutor_id uuid references profiles(id),
  subject stem_subject not null,
  exam_board exam_board not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status booking_status default 'scheduled',
  webrtc_room_url text,
  created_at timestamptz default now(),
  -- Stripe: a booking row is only created once payment succeeds (in the
  -- webhook), so payment_status defaults to 'paid' rather than tracking a
  -- pending-booking state in this table.
  payment_status payment_status not null default 'paid',
  amount_gbp_pence int, -- price snapshot at time of payment, in case rates change later
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  lesson_name text,
  check (end_time > start_time)
);

-- for databases created before payments existed
alter table bookings add column if not exists payment_status payment_status not null default 'paid';
alter table bookings add column if not exists amount_gbp_pence int;
alter table bookings add column if not exists stripe_checkout_session_id text unique;
alter table bookings add column if not exists stripe_payment_intent_id text;
alter table bookings add column if not exists lesson_name text;

alter table tutor_profiles add column if not exists stripe_account_id text;
alter table tutor_profiles add column if not exists stripe_payouts_enabled boolean not null default false;

create table if not exists session_analytics (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references bookings(id) on delete cascade,
  full_transcript text,
  summary_notes jsonb,
  talk_ratio numeric(3, 2),
  -- Private object key in the session-recordings Storage bucket, never a
  -- public or long-lived signed URL. See README for the recording pipeline.
  recording_path text,
  created_at timestamptz default now()
);

alter table session_analytics add column if not exists recording_path text;

create table if not exists session_embeddings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  student_id uuid references profiles(id) on delete cascade,
  content text not null,
  topic text,
  -- 768 dims for google/text-embedding-005 (via AI Gateway) — not OpenAI's
  -- text-embedding-3-small (1536 dims), which needs paid Gateway credits
  -- this account doesn't have. See src/app/api/cron/summarize-sessions.
  embedding vector(768)
);

create index if not exists session_embeddings_ivfflat
  on session_embeddings using ivfflat (embedding vector_cosine_ops);

create index if not exists bookings_tutor_time_idx on bookings (tutor_id, start_time);
create index if not exists bookings_student_time_idx on bookings (student_id, start_time);
create index if not exists availability_tutor_idx on availability (tutor_id, day_of_week);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table tutor_profiles enable row level security;
alter table student_profiles enable row level security;
alter table availability enable row level security;
alter table bookings enable row level security;
alter table session_analytics enable row level security;
alter table session_embeddings enable row level security;

create or replace function public.app_current_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function public.is_linked_parent(student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from student_profiles sp
    where sp.id = student and sp.parent_id = auth.uid()
  )
$$;

-- profiles: everyone can read public profile fields, only the owner can update
create policy "profiles are readable by authenticated users"
  on profiles for select to authenticated using (true);
-- tutor profiles are public listings (name shown on /tutors discovery) — visible
-- even to signed-out visitors; students/parents/admins stay authenticated-only above.
create policy "tutor profiles are publicly readable"
  on profiles for select to anon using (role = 'tutor');
create policy "users can update their own profile"
  on profiles for update to authenticated using (id = auth.uid());
create policy "users can insert their own profile"
  on profiles for insert to authenticated with check (id = auth.uid());

-- tutor_profiles: publicly readable (discovery), owner writes
create policy "tutor profiles are publicly readable"
  on tutor_profiles for select using (true);
create policy "tutors manage their own profile"
  on tutor_profiles for insert to authenticated with check (id = auth.uid());
create policy "tutors update their own profile"
  on tutor_profiles for update to authenticated using (id = auth.uid());

-- student_profiles: student, their linked parent, and admins
create policy "students read their own profile"
  on student_profiles for select to authenticated
  using (id = auth.uid() or parent_id = auth.uid() or app_current_role() = 'admin');
create policy "students manage their own profile"
  on student_profiles for insert to authenticated with check (id = auth.uid());
create policy "students update their own profile"
  on student_profiles for update to authenticated using (id = auth.uid());

-- availability: publicly readable, tutor manages their own
create policy "availability is publicly readable"
  on availability for select using (true);
create policy "tutors manage their own availability"
  on availability for all to authenticated
  using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());

-- bookings: participants (+ linked parent) and admins only
create policy "participants read their bookings"
  on bookings for select to authenticated
  using (
    student_id = auth.uid() or tutor_id = auth.uid()
    or is_linked_parent(student_id) or app_current_role() = 'admin'
  );
create policy "students create bookings for themselves"
  on bookings for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "participants update their bookings" on bookings;
create policy "participants update their bookings"
  on bookings for update to authenticated
  using (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
  with check (student_id = (select auth.uid()) or tutor_id = (select auth.uid()));

-- session_analytics: same visibility as the parent booking
create policy "participants read session analytics"
  on session_analytics for select to authenticated
  using (
    exists (
      select 1 from bookings b where b.id = booking_id
      and (b.student_id = auth.uid() or b.tutor_id = auth.uid()
        or is_linked_parent(b.student_id) or app_current_role() = 'admin')
    )
  );

-- Recordings live in a *private* Supabase Storage bucket named
-- `session-recordings`, with object names beginning `<booking-id>/`. Create
-- that bucket in the Storage dashboard (or API), not by mutating storage
-- tables directly. The recording worker writes with the service role; this
-- policy only grants session participants (and linked parents) playback.
drop policy if exists "session participants read recordings" on storage.objects;
create policy "session participants read recordings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'session-recordings'
    and exists (
      select 1 from bookings b
      where b.id::text = (storage.foldername(name))[1]
        and (
          b.student_id = (select auth.uid())
          or b.tutor_id = (select auth.uid())
          or is_linked_parent(b.student_id)
          or app_current_role() = 'admin'
        )
    )
  );

-- session_embeddings: student (+ linked parent) only — grounds their own RAG chatbot
create policy "students read their own embeddings"
  on session_embeddings for select to authenticated
  using (student_id = auth.uid() or is_linked_parent(student_id) or app_current_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Direct messages: exactly one conversation per student/tutor pair that has
-- at least one booking. Parents deliberately do not inherit access to DMs.
-- ---------------------------------------------------------------------------
create table if not exists direct_conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  tutor_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, tutor_id),
  check (student_id <> tutor_id)
);

create table if not exists direct_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references direct_conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null default '',
  attachment_path text,
  attachment_name text,
  attachment_type text,
  created_at timestamptz not null default now(),
  check (char_length(body) <= 4000),
  check (body <> '' or attachment_path is not null)
);

create index if not exists direct_conversations_student_idx
  on direct_conversations (student_id, updated_at desc);
create index if not exists direct_conversations_tutor_idx
  on direct_conversations (tutor_id, updated_at desc);
create index if not exists direct_messages_conversation_idx
  on direct_messages (conversation_id, created_at);

alter table direct_conversations enable row level security;
alter table direct_messages enable row level security;

create policy "participants read direct conversations"
  on direct_conversations for select to authenticated
  using (student_id = (select auth.uid()) or tutor_id = (select auth.uid()));
create policy "booking participants create direct conversations"
  on direct_conversations for insert to authenticated
  with check (
    (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
    and exists (
      select 1 from bookings b
      where b.student_id = direct_conversations.student_id
        and b.tutor_id = direct_conversations.tutor_id
    )
  );
create policy "participants update direct conversations"
  on direct_conversations for update to authenticated
  using (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
  with check (student_id = (select auth.uid()) or tutor_id = (select auth.uid()));
create policy "participants read direct messages"
  on direct_messages for select to authenticated
  using (
    exists (
      select 1 from direct_conversations c
      where c.id = conversation_id
        and (c.student_id = (select auth.uid()) or c.tutor_id = (select auth.uid()))
    )
  );
create policy "participants send direct messages"
  on direct_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from direct_conversations c
      where c.id = conversation_id
        and (c.student_id = (select auth.uid()) or c.tutor_id = (select auth.uid()))
    )
  );

-- Enables live inbox refreshes for direct messages. Safe to re-run after the
-- table has already been added to the publication.
do $$ begin
  alter publication supabase_realtime add table direct_messages;
exception when duplicate_object then null; end $$;

-- Create the private `message-attachments` bucket through Storage's dashboard
-- or API. Object names must be `<conversation-id>/<sender-id>/<file-name>`.
drop policy if exists "conversation participants read attachments" on storage.objects;
create policy "conversation participants read attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1 from direct_conversations c
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
      select 1 from direct_conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.student_id = (select auth.uid()) or c.tutor_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- Revision chatbot: persisted conversations
-- ---------------------------------------------------------------------------
create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- id is the AI SDK UIMessage id (client- or server-generated), not a uuid.
create table if not exists chat_messages (
  id text primary key,
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  message jsonb not null, -- full UIMessage (id, role, parts[]) for exact UI replay
  created_at timestamptz default now()
);

create index if not exists chat_conversations_student_idx on chat_conversations (student_id, updated_at desc);
create index if not exists chat_messages_conversation_idx on chat_messages (conversation_id, created_at);
-- backs the daily-message-cap lookup in /api/chat
create index if not exists chat_messages_student_daily_idx on chat_messages (student_id, role, created_at);

alter table chat_conversations enable row level security;
alter table chat_messages enable row level security;

create policy "students manage their own conversations"
  on chat_conversations for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy "students manage their own chat messages"
  on chat_messages for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Auth trigger: create a profile row on signup from user_metadata
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, email)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'student'),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

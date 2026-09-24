-- A student request is deliberately separate from a confirmed lesson. A request
-- never creates a charge or reserves a booking until its tutor schedules it.
create table if not exists public.lesson_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  subject stem_subject not null,
  exam_board exam_board not null,
  requested_start_time timestamptz not null,
  requested_end_time timestamptz not null,
  is_trial boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'declined', 'scheduled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requested_end_time > requested_start_time)
);

create index if not exists lesson_requests_tutor_status_idx on public.lesson_requests (tutor_id, status, created_at desc);
create index if not exists lesson_requests_student_idx on public.lesson_requests (student_id, created_at desc);

alter table public.lesson_requests enable row level security;
create policy "participants read lesson requests" on public.lesson_requests for select to authenticated
  using (student_id = (select auth.uid()) or tutor_id = (select auth.uid()));
create policy "students create their lesson requests" on public.lesson_requests for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy "tutors respond to lesson requests" on public.lesson_requests for update to authenticated
  using (tutor_id = (select auth.uid())) with check (tutor_id = (select auth.uid()));

-- A free trial is explicit, while a paid booking remains unpaid until its
-- post-session Stripe invoice is settled.
alter table public.bookings add column if not exists lesson_request_id uuid references public.lesson_requests(id) on delete set null;
alter table public.bookings add column if not exists is_trial boolean not null default false;
alter table public.bookings add column if not exists recurrence_rule text;
alter table public.bookings add column if not exists stripe_invoice_id text unique;
alter table public.bookings add column if not exists stripe_invoice_url text;
alter table public.bookings add column if not exists invoice_sent_at timestamptz;
alter table public.profiles add column if not exists stripe_customer_id text unique;

-- Conversation creation now starts at a request, rather than only after a
-- checkout-created booking.
drop policy if exists "booking participants create direct conversations" on public.direct_conversations;
create policy "lesson participants create direct conversations" on public.direct_conversations for insert to authenticated
  with check (
    (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
    and (
      exists (select 1 from public.bookings b where b.student_id = direct_conversations.student_id and b.tutor_id = direct_conversations.tutor_id)
      or exists (select 1 from public.lesson_requests r where r.student_id = direct_conversations.student_id and r.tutor_id = direct_conversations.tutor_id)
    )
  );

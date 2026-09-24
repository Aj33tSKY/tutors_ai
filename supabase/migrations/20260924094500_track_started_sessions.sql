-- A scheduled lesson can be entered, left, and resumed before the tutor
-- completes it. Preserve that lifecycle independently from its schedule.
alter table public.bookings add column if not exists started_at timestamptz;
alter table public.bookings add column if not exists last_joined_at timestamptz;

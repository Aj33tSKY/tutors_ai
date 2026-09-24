-- Subject and exam board describe the initial lesson request. Follow-up
-- bookings are identified by their session name instead.
alter table public.bookings alter column subject drop not null;
alter table public.bookings alter column exam_board drop not null;

-- A stable series id lets a tutor cancel the remaining sessions in one
-- recurring slot without relying on a potentially repeated lesson name.
alter table public.bookings add column if not exists recurrence_series_id uuid;
create index if not exists bookings_recurrence_series_idx
  on public.bookings (recurrence_series_id, start_time)
  where recurrence_series_id is not null;

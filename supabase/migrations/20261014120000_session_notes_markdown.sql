-- A single editable markdown document replacing the separate summary /
-- topics / action-point / misconception cards on the session review page.
-- Seeded once by the summarize-sessions cron from the structured
-- summary_notes it already generates; after that the tutor's saved edits
-- are the source of truth, so nothing server-side overwrites a non-null
-- value except the same reset markSessionUpcomingAction already performs
-- on summary_notes when a session is reopened.
alter table public.session_analytics add column if not exists notes_markdown text;

-- Session analytics otherwise has no update policy at all (every other write
-- goes through the service role, from the summarize-sessions cron). The
-- tutor is the only one who can edit their own session's notes; the Server
-- Action that calls this only ever sets notes_markdown, the same pattern
-- updateLessonNameAction already uses on bookings.
drop policy if exists "tutors update their own session notes" on public.session_analytics;
create policy "tutors update their own session notes"
  on public.session_analytics for update to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and b.tutor_id = (select auth.uid())))
  with check (exists (select 1 from public.bookings b where b.id = booking_id and b.tutor_id = (select auth.uid())));

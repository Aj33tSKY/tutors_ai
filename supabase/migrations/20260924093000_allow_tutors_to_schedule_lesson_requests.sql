-- Tutors can only create a booking from a lesson request addressed to them.
-- This preserves the existing student self-booking path while permitting the
-- tutor-side accept-and-schedule workflow.
create policy "tutors schedule their lesson requests"
  on public.bookings for insert to authenticated
  with check (
    tutor_id = (select auth.uid())
    and exists (
      select 1 from public.lesson_requests r
      where r.id = bookings.lesson_request_id
        and r.student_id = bookings.student_id
        and r.tutor_id = (select auth.uid())
        and r.status = 'pending'
    )
  );

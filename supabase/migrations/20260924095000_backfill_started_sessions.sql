-- Existing partial calls already have transcript evidence; make them resumable
-- under the new explicit lifecycle marker.
update public.bookings b
set started_at = analytics.created_at
from public.session_analytics analytics
where analytics.booking_id = b.id
  and b.started_at is null
  and analytics.full_transcript is not null
  and b.status = 'scheduled';

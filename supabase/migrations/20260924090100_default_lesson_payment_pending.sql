-- Confirmed paid lessons are invoiced after completion, not paid at booking.
alter table public.bookings alter column payment_status set default 'pending';

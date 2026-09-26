-- A booking without a price silently disables invoicing: sendSessionInvoiceAction
-- requires amount_gbp_pence, so the session can never be charged for. Nothing
-- prevented it, and three staging sessions ended up in that state.
--
-- Backfilled to 0 rather than to the tutor's current rate on purpose. 0 is falsy
-- in the invoicing check, so these bookings stay exactly as uninvoiceable as they
-- are today — no price is invented for a lesson that already happened.
update public.bookings
set amount_gbp_pence = 0
where amount_gbp_pence is null;

alter table public.bookings
  alter column amount_gbp_pence set not null;

-- Free lessons are 0. Negative is always a bug.
alter table public.bookings
  add constraint bookings_amount_gbp_pence_non_negative
  check (amount_gbp_pence >= 0);

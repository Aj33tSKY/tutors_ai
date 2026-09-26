-- Automatic collection: when a student has saved a payment method and opted in,
-- a tutor sending an invoice charges it rather than emailing a link.
--
-- The saved payment method itself lives in Stripe, as the customer's
-- invoice_settings.default_payment_method. Duplicating it here would create two
-- sources of truth for something money moves against, and the copy would be the
-- one that goes stale. Only the preference is stored.
alter table public.profiles
  add column if not exists auto_charge_enabled boolean not null default false;

comment on column public.profiles.auto_charge_enabled is
  'Student opted in to invoices being charged automatically to their saved Stripe payment method. Meaningless without invoice_settings.default_payment_method on the Stripe customer.';

-- Only the account holder may change their own billing preference. The existing
-- "users can update their own profile" policy already restricts updates to
-- id = auth.uid(), so no new policy is needed — this comment records that the
-- column is deliberately covered by it rather than left unprotected.

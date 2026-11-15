-- Billing hardening and the durable provider-event inbox.
--
-- 1. Row policies let either participant UPDATE any column of their own booking,
--    so a student could mark a lesson paid at a price of zero, and any user could
--    point their profile at someone else's Stripe customer or connected account.
--    Row-level policy cannot express "these columns belong to the platform", so a
--    trigger rejects direct client writes. SECURITY DEFINER functions run as their
--    owner (current_user is not 'authenticated'), which is how legitimate writers
--    below get through; the service role is unaffected.
create function private.protect_booking_billing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.payment_status is distinct from old.payment_status or new.amount_gbp_pence is distinct from old.amount_gbp_pence
    or new.stripe_invoice_id is distinct from old.stripe_invoice_id or new.stripe_invoice_url is distinct from old.stripe_invoice_url
    or new.invoice_sent_at is distinct from old.invoice_sent_at or new.is_trial is distinct from old.is_trial
    or new.student_id is distinct from old.student_id or new.tutor_id is distinct from old.tutor_id
    or new.lesson_request_id is distinct from old.lesson_request_id
  ) then
    raise exception 'Billing fields and lesson participants are managed by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger protect_booking_billing before update on public.bookings
for each row execute function private.protect_booking_billing();

create function private.protect_profile_billing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'The billing customer is managed by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
create function private.protect_tutor_billing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (new.stripe_account_id is distinct from old.stripe_account_id
    or new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled) then
    raise exception 'Payout settings are managed by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger protect_profile_billing before update on public.profiles
for each row execute function private.protect_profile_billing();
create trigger protect_tutor_billing before update on public.tutor_profiles
for each row execute function private.protect_tutor_billing();

-- Students no longer insert bookings directly: requests and tutor scheduling
-- (schedule_lessons_v1) are the only ways to create one.
drop policy if exists "students create bookings for themselves" on public.bookings;

-- First write wins, so an identifier can never be re-pointed once it is set.
create function private.claim_stripe_customer(p_customer text) returns text
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); winner text;
begin
  if actor is null or p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]+$' then raise exception 'Invalid customer' using errcode = '22023'; end if;
  update public.profiles set stripe_customer_id = p_customer where id = actor and stripe_customer_id is null;
  select stripe_customer_id into winner from public.profiles where id = actor;
  return winner;
end;
$$;
create function private.claim_stripe_account(p_account text) returns text
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); winner text;
begin
  if actor is null or p_account is null or p_account !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Invalid account' using errcode = '22023'; end if;
  update public.tutor_profiles set stripe_account_id = p_account where id = actor and stripe_account_id is null;
  select stripe_account_id into winner from public.tutor_profiles where id = actor;
  return winner;
end;
$$;
create function private.set_payouts_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  update public.tutor_profiles set stripe_payouts_enabled = p_enabled where id = auth.uid() and stripe_payouts_enabled is distinct from p_enabled;
end;
$$;
-- The invoice is recorded only by the booking's tutor, once, for a completed paid lesson.
create function private.record_booking_invoice(p_booking uuid, p_invoice text, p_url text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.bookings set stripe_invoice_id = p_invoice, stripe_invoice_url = p_url, invoice_sent_at = now(), payment_status = 'pending'
   where id = p_booking and tutor_id = auth.uid() and status = 'completed' and not is_trial and stripe_invoice_id is null;
  get diagnostics changed = row_count;
  return changed = 1 or exists(select 1 from public.bookings where id = p_booking and tutor_id = auth.uid() and stripe_invoice_id = p_invoice);
end;
$$;
do $$
declare f text;
begin
  foreach f in array array['claim_stripe_customer(text)', 'claim_stripe_account(text)', 'set_payouts_enabled(boolean)', 'record_booking_invoice(uuid,text,text)'] loop
    execute format('revoke all on function private.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function private.%s to authenticated', f);
    execute format('create function public.%s returns %s language sql security invoker set search_path = %L as %L',
      case f when 'claim_stripe_customer(text)' then 'claim_stripe_customer_v1(p_customer text)' when 'claim_stripe_account(text)' then 'claim_stripe_account_v1(p_account text)'
        when 'set_payouts_enabled(boolean)' then 'set_payouts_enabled_v1(p_enabled boolean)' else 'record_booking_invoice_v1(p_booking uuid, p_invoice text, p_url text)' end,
      case f when 'set_payouts_enabled(boolean)' then 'void' when 'record_booking_invoice(uuid,text,text)' then 'boolean' else 'text' end, '',
      case f when 'claim_stripe_customer(text)' then 'select private.claim_stripe_customer(p_customer)' when 'claim_stripe_account(text)' then 'select private.claim_stripe_account(p_account)'
        when 'set_payouts_enabled(boolean)' then 'select private.set_payouts_enabled(p_enabled)' else 'select private.record_booking_invoice(p_booking, p_invoice, p_url)' end);
  end loop;
end $$;
revoke all on function public.claim_stripe_customer_v1(text), public.claim_stripe_account_v1(text), public.set_payouts_enabled_v1(boolean),
  public.record_booking_invoice_v1(uuid,text,text) from public, anon;
grant execute on function public.claim_stripe_customer_v1(text), public.claim_stripe_account_v1(text), public.set_payouts_enabled_v1(boolean),
  public.record_booking_invoice_v1(uuid,text,text) to authenticated;

-- A tutor invoicing a student who has no billing customer yet may record the
-- first customer for that student, once and only through one of their bookings.
create function private.claim_booking_student_customer(p_booking uuid, p_customer text) returns text
language plpgsql security definer set search_path = '' as $$
declare student uuid; winner text;
begin
  if auth.uid() is null or p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]+$' then raise exception 'Invalid customer' using errcode = '22023'; end if;
  select student_id into student from public.bookings where id = p_booking and tutor_id = auth.uid();
  if student is null then raise exception 'Lesson not found' using errcode = 'P0002'; end if;
  update public.profiles set stripe_customer_id = p_customer where id = student and stripe_customer_id is null;
  select stripe_customer_id into winner from public.profiles where id = student;
  return winner;
end;
$$;
revoke all on function private.claim_booking_student_customer(uuid,text) from public, anon, authenticated, service_role;
grant execute on function private.claim_booking_student_customer(uuid,text) to authenticated;
create function public.claim_booking_student_customer_v1(p_booking uuid, p_customer text) returns text
language sql security invoker set search_path = '' as $$ select private.claim_booking_student_customer(p_booking, p_customer); $$;
revoke all on function public.claim_booking_student_customer_v1(uuid,text) from public, anon;
grant execute on function public.claim_booking_student_customer_v1(uuid,text) to authenticated;

-- 2. Signed provider events are persisted, deduplicated by provider identity, and
--    only then acknowledged. A worker applies them later with leases and bounded
--    retries, so a database blip never turns into a lost payment status.
create table private.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_error text,
  unique (provider, event_id)
);
alter table private.provider_events enable row level security;
revoke all on private.provider_events from public, anon, authenticated, service_role;
create index provider_events_pending_idx on private.provider_events (received_at, id) where processed_at is null;

create function private.accept_provider_event(p_provider text, p_event_id text, p_type text, p_payload jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into private.provider_events(provider, event_id, event_type, payload) values (p_provider, p_event_id, p_type, p_payload)
    on conflict (provider, event_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

create function private.provider_event_claim(p_limit integer default 10) returns table(id uuid, provider text, event_type text, payload jsonb, attempts integer)
language sql security definer set search_path = '' as $$
  with picked as (
    select e.id from private.provider_events e
    where e.processed_at is null and e.attempts < 12 and (e.lease_until is null or e.lease_until < now())
    order by e.received_at, e.id limit least(greatest(p_limit, 1), 50) for update skip locked
  )
  update private.provider_events e set lease_until = now() + interval '2 minutes', attempts = e.attempts + 1
  from picked where e.id = picked.id returning e.id, e.provider, e.event_type, e.payload, e.attempts;
$$;
create function private.provider_event_complete(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update private.provider_events set processed_at = now(), lease_until = null, last_error = null where id = p_id;
$$;
-- Backoff grows with attempts. The error text is a short code, never provider payload.
create function private.provider_event_fail(p_id uuid, p_error text, p_delay_seconds integer default null) returns void
language sql security definer set search_path = '' as $$
  update private.provider_events set lease_until = now() + coalesce(least(greatest(p_delay_seconds, 1), 3600) * interval '1 second', least(attempts, 10) * interval '30 seconds'),
    last_error = left(p_error, 200) where id = p_id;
$$;
-- A handler that decides an event can never succeed ends it without retrying.
create function private.provider_event_abandon(p_id uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update private.provider_events set processed_at = now(), lease_until = null, last_error = left('abandoned:' || p_error, 200) where id = p_id;
$$;

-- Late or replayed events must not undo a settled payment: paid and refunded stick.
create function private.apply_invoice_status(p_booking uuid, p_invoice text, p_status text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if p_status not in ('paid', 'failed', 'pending') then raise exception 'Unsupported status' using errcode = '22023'; end if;
  update public.bookings set payment_status = case
      when p_status = 'paid' and payment_status <> 'refunded' then 'paid'::public.payment_status
      when payment_status in ('paid', 'refunded') then payment_status
      else p_status::public.payment_status end
   where id = p_booking and stripe_invoice_id = p_invoice;
  get diagnostics changed = row_count;
  -- No match yet means the invoice id has not been recorded; the caller retries.
  return changed = 1;
end;
$$;
revoke all on function private.accept_provider_event(text,text,text,jsonb), private.provider_event_claim(integer),
  private.provider_event_complete(uuid), private.provider_event_fail(uuid,text,integer), private.provider_event_abandon(uuid,text), private.apply_invoice_status(uuid,text,text)
  from public, anon, authenticated, service_role;

-- Operators can see stuck events without exposing payloads.
create view private.provider_event_backlog as
  select provider, count(*) filter (where attempts >= 12) as dead, count(*) as pending, min(received_at) as oldest
  from private.provider_events where processed_at is null group by provider;
revoke all on private.provider_event_backlog from public, anon, authenticated, service_role;

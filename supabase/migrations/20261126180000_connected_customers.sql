-- Direct charges: a lesson is invoiced on the TUTOR's Stripe account, so the student needs a customer record on that account.
-- This remembers it per (student, tutor account), so the second lesson reuses the first lesson's customer instead of creating
-- another. Like the other Stripe identifiers it is first-write-wins and written only through narrow functions: a tutor can
-- record or read it for their own booking and nothing else.
create table private.stripe_connected_customers (
  student_id uuid not null references public.profiles(id) on delete cascade,
  account_id text not null check (account_id ~ '^acct_[A-Za-z0-9]+$'),
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  primary key (student_id, account_id)
);
revoke all on private.stripe_connected_customers from public, anon, authenticated;

create function private.connected_customer_for_booking(p_booking uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare student uuid; account text; found text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select b.student_id, t.stripe_account_id into student, account
    from public.bookings b join public.tutor_profiles t on t.id = b.tutor_id
   where b.id = p_booking and b.tutor_id = auth.uid();
  if student is null then raise exception 'Lesson not found' using errcode = 'P0002'; end if;
  if account is null then return null; end if;
  select customer_id into found from private.stripe_connected_customers where student_id = student and account_id = account;
  return found;
end;
$$;

create function private.claim_connected_customer(p_booking uuid, p_customer text) returns text
language plpgsql security definer set search_path = '' as $$
declare student uuid; account text; winner text;
begin
  if auth.uid() is null or p_customer is null or p_customer !~ '^cus_[A-Za-z0-9]+$' then raise exception 'Invalid customer' using errcode = '22023'; end if;
  select b.student_id, t.stripe_account_id into student, account
    from public.bookings b join public.tutor_profiles t on t.id = b.tutor_id
   where b.id = p_booking and b.tutor_id = auth.uid();
  if student is null then raise exception 'Lesson not found' using errcode = 'P0002'; end if;
  if account is null then raise exception 'Connect a payout account first' using errcode = '55000'; end if;
  insert into private.stripe_connected_customers(student_id, account_id, customer_id) values (student, account, p_customer) on conflict do nothing;
  select customer_id into winner from private.stripe_connected_customers where student_id = student and account_id = account;
  return winner;
end;
$$;

revoke all on function private.connected_customer_for_booking(uuid), private.claim_connected_customer(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.connected_customer_for_booking(uuid), private.claim_connected_customer(uuid, text) to authenticated;

create function public.connected_customer_for_booking_v1(p_booking uuid) returns text
language sql security invoker set search_path = '' as 'select private.connected_customer_for_booking(p_booking)';
create function public.claim_connected_customer_v1(p_booking uuid, p_customer text) returns text
language sql security invoker set search_path = '' as 'select private.claim_connected_customer(p_booking, p_customer)';
revoke all on function public.connected_customer_for_booking_v1(uuid), public.claim_connected_customer_v1(uuid, text) from public, anon;
grant execute on function public.connected_customer_for_booking_v1(uuid), public.claim_connected_customer_v1(uuid, text) to authenticated;

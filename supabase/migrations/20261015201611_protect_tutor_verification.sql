-- Trust fields are assigned by platform operations, never by a tutor's browser.
alter table public.tutor_profiles add column if not exists is_demo boolean not null default false;
alter table public.tutor_profiles alter column rating drop default;

update public.tutor_profiles tp
set is_demo = true
from public.profiles p
where p.id = tp.id and p.email like '%@demo.kindling.app';

create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, email)
  values (
    new.id,
    (case
      when new.raw_user_meta_data->>'role' in ('student', 'parent', 'tutor')
        then new.raw_user_meta_data->>'role'
      else 'student'
    end)::public.user_role,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create function private.protect_profile_role()
returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' and new.role not in ('student', 'parent', 'tutor') then
      raise exception 'Account role cannot be assigned by the account owner';
    elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Account role cannot be changed by the account owner';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_role
before insert or update on public.profiles
for each row execute function private.protect_profile_role();

create function private.protect_tutor_trust_fields()
returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and private.app_current_role() is distinct from 'admin' then
    if tg_op = 'INSERT' then
      if new.dbs_verified or new.rating is not null or new.is_demo then
        raise exception 'Tutor trust fields are managed by the platform';
      end if;
    elsif new.dbs_verified is distinct from old.dbs_verified
       or new.rating is distinct from old.rating
       or new.is_demo is distinct from old.is_demo then
      raise exception 'Tutor trust fields are managed by the platform';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_tutor_trust_fields
before insert or update on public.tutor_profiles
for each row execute function private.protect_tutor_trust_fields();

drop policy if exists "tutor profiles are publicly readable" on public.tutor_profiles;
create policy "verified real tutors are publicly readable"
on public.tutor_profiles for select
using (dbs_verified and not is_demo);

drop policy if exists "tutor profiles are publicly readable" on public.profiles;
create policy "approved tutor names are publicly readable"
on public.profiles for select to anon
using (role = 'tutor' and exists (
  select 1 from public.tutor_profiles tp
  where tp.id = profiles.id and tp.dbs_verified and not tp.is_demo
));

create policy "tutors and admins read private tutor profiles"
on public.tutor_profiles for select to authenticated
using (id = (select auth.uid()) or (select private.app_current_role()) = 'admin');

create policy "admins update tutor verification"
on public.tutor_profiles for update to authenticated
using ((select private.app_current_role()) = 'admin')
with check ((select private.app_current_role()) = 'admin');

create table public.tutor_verification_reviews (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  evidence_note text not null check (char_length(trim(evidence_note)) >= 20),
  created_at timestamptz not null default now()
);
alter table public.tutor_verification_reviews enable row level security;
create policy "admins read verification reviews" on public.tutor_verification_reviews
for select to authenticated using ((select private.app_current_role()) = 'admin');
create policy "admins record verification reviews" on public.tutor_verification_reviews
for insert to authenticated with check (
  (select private.app_current_role()) = 'admin' and reviewer_id = (select auth.uid())
);
grant select, insert on public.tutor_verification_reviews to authenticated;

create function public.approve_tutor_verification(p_tutor_id uuid, p_evidence_note text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if private.app_current_role() is distinct from 'admin' then
    raise exception 'Only administrators can approve tutors';
  end if;
  if char_length(trim(coalesce(p_evidence_note, ''))) < 20 then
    raise exception 'Record the evidence reviewed before approval';
  end if;
  update public.tutor_profiles
  set dbs_verified = true
  where id = p_tutor_id and not dbs_verified and not is_demo;
  if not found then
    raise exception 'Tutor is unavailable or already approved';
  end if;
  insert into public.tutor_verification_reviews (tutor_id, reviewer_id, evidence_note)
  values (p_tutor_id, auth.uid(), trim(p_evidence_note));
end;
$$;
revoke all on function public.approve_tutor_verification(uuid, text) from public, anon;
grant execute on function public.approve_tutor_verification(uuid, text) to authenticated;

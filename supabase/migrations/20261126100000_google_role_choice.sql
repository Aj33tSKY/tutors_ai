-- Google sign-in cannot carry the student/tutor choice made on the email form, so an account created through a provider
-- starts as an unconfirmed student and picks once, in the app. Accounts made with the email form already chose, so they
-- are confirmed from the start. After the choice the role is as fixed as before: owners can never change it again.
alter table public.profiles add column if not exists role_confirmed boolean not null default true;

create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, email, role_confirmed)
  values (
    new.id,
    (case when new.raw_user_meta_data->>'role' in ('student', 'parent', 'tutor') then new.raw_user_meta_data->>'role' else 'student' end)::public.user_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email'
  );
  return new;
end;
$$;

create or replace function private.protect_profile_role()
returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.role not in ('student', 'parent', 'tutor') then
        raise exception 'Account role cannot be assigned by the account owner';
      end if;
    else
      if old.role_confirmed and not new.role_confirmed then
        raise exception 'Account role cannot be changed by the account owner';
      end if;
      -- The one allowed change: an unconfirmed account choosing student or tutor, which confirms it.
      if new.role is distinct from old.role and not (not old.role_confirmed and new.role in ('student', 'tutor') and new.role_confirmed) then
        raise exception 'Account role cannot be changed by the account owner';
      end if;
    end if;
  end if;
  return new;
end;
$$;

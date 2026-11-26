-- Parents are not part of the product: there is no parent sign-up, dashboard, API route or visibility rule any more.
-- Refuse to run if anything still depends on them, so no data is lost silently.
do $$
begin
  if exists (select 1 from public.profiles where role = 'parent')
     or exists (select 1 from public.student_profiles where parent_id is not null) then
    raise exception 'Parent accounts or parent links exist; convert or remove them before removing the parent role';
  end if;
end $$;

-- Visibility rules: the same participants as before, without "a linked parent".
alter policy "participants read their bookings" on public.bookings
  using (student_id = auth.uid() or tutor_id = auth.uid() or private.app_current_role() = 'admin'::user_role);

alter policy "participants read session analytics" on public.session_analytics
  using (exists (select 1 from public.bookings b where b.id = session_analytics.booking_id
    and (b.student_id = auth.uid() or b.tutor_id = auth.uid() or private.app_current_role() = 'admin'::user_role)));

alter policy "students read their own embeddings" on public.session_embeddings
  using (student_id = auth.uid() or private.app_current_role() = 'admin'::user_role);

alter policy "participants read recording consent" on public.session_recording_consents
  using (exists (select 1 from public.bookings b where b.id = session_recording_consents.booking_id
    and (b.student_id = (select auth.uid()) or b.tutor_id = (select auth.uid()) or private.app_current_role() = 'admin'::user_role)));

alter policy "participants read their session recordings" on public.session_recordings
  using (exists (select 1 from public.bookings b where b.id = session_recordings.booking_id
    and (b.student_id = (select auth.uid()) or b.tutor_id = (select auth.uid()) or private.app_current_role() = 'admin'::user_role)));

alter policy "students read their own profile" on public.student_profiles
  using (id = auth.uid() or private.app_current_role() = 'admin'::user_role);

alter policy "session participants read recordings" on storage.objects
  using (bucket_id = 'session-recordings' and exists (select 1 from public.bookings b
    where b.id::text = (storage.foldername(objects.name))[1]
    and (b.student_id = (select auth.uid()) or b.tutor_id = (select auth.uid()) or private.app_current_role() = 'admin'::user_role)));

drop function private.is_linked_parent(uuid);
alter table public.student_profiles drop column parent_id;

-- Postgres cannot drop a value from an enum safely, so the value stays in the type and is blocked instead.
alter table public.profiles add constraint profiles_role_not_parent check (role <> 'parent');

create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, email, role_confirmed)
  values (
    new.id,
    (case when new.raw_user_meta_data->>'role' in ('student', 'tutor') then new.raw_user_meta_data->>'role' else 'student' end)::public.user_role,
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
      if new.role not in ('student', 'tutor') then
        raise exception 'Account role cannot be assigned by the account owner';
      end if;
    else
      if old.role_confirmed and not new.role_confirmed then
        raise exception 'Account role cannot be changed by the account owner';
      end if;
      if new.role is distinct from old.role and not (not old.role_confirmed and new.role in ('student', 'tutor') and new.role_confirmed) then
        raise exception 'Account role cannot be changed by the account owner';
      end if;
    end if;
  end if;
  return new;
end;
$$;

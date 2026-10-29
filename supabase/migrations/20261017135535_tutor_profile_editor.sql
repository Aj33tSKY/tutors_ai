-- Profile photos are public assets, but only tutors may write inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutor-avatars', 'tutor-avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "tutors upload their own avatars" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tutor-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'tutor')
);

create policy "tutors manage their own avatar files" on storage.objects
for select to authenticated
using (bucket_id = 'tutor-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "tutors delete their own avatar files" on storage.objects
for delete to authenticated
using (bucket_id = 'tutor-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The authentication email is authoritative. It changes only after Supabase
-- completes its email-change flow; keep the app profile in sync at that point.
create function private.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger sync_profile_email
after update of email on auth.users
for each row execute function private.sync_profile_email();

create function private.protect_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and new.email is distinct from old.email
     and new.email is distinct from (select email from auth.users where id = new.id) then
    raise exception 'Change your email through account settings';
  end if;
  return new;
end;
$$;

create trigger protect_profile_email
before update of email on public.profiles
for each row execute function private.protect_profile_email();

create function public.start_booking_lesson(p_booking_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare started boolean;
begin
  update public.bookings set started_at = coalesce(started_at,now()),
    last_joined_at = case when started_at is null then now() else last_joined_at end
    where id = p_booking_id and tutor_id = (select auth.uid()) and status = 'scheduled'
      and private.app_current_role() = 'tutor'
    returning true into started;
  return coalesce(started,false);
end;
$$;
revoke all on function public.start_booking_lesson(uuid) from public, anon;
grant execute on function public.start_booking_lesson(uuid) to authenticated;

-- Consent is a caller-scoped mutation, never an application-wide admin write.
grant insert(booking_id,tutor_id,consented_at,consent_version), update(consented_at,consent_version)
  on public.session_recording_consents to authenticated;
create policy "tutors insert their recording consent" on public.session_recording_consents
for insert to authenticated with check (
  tutor_id = (select auth.uid()) and consent_version = 1 and private.app_current_role() = 'tutor'
  and exists(select 1 from public.bookings b where b.id = booking_id and b.tutor_id = (select auth.uid()) and b.status = 'scheduled')
);
create policy "tutors update their recording consent" on public.session_recording_consents
for update to authenticated using (
  tutor_id = (select auth.uid()) and private.app_current_role() = 'tutor'
  and exists(select 1 from public.bookings b where b.id = booking_id and b.tutor_id = (select auth.uid()) and b.status = 'scheduled')
) with check (
  tutor_id = (select auth.uid()) and consent_version = 1 and private.app_current_role() = 'tutor'
  and exists(select 1 from public.bookings b where b.id = booking_id and b.tutor_id = (select auth.uid()) and b.status = 'scheduled')
);
create function public.consent_booking_recording(p_booking_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.session_recording_consents(booking_id,tutor_id,consented_at,consent_version)
  values(p_booking_id,(select auth.uid()),now(),1)
  on conflict(booking_id) do update set consented_at=excluded.consented_at,consent_version=1;
end;
$$;
revoke all on function public.consent_booking_recording(uuid) from public, anon;
grant execute on function public.consent_booking_recording(uuid) to authenticated;

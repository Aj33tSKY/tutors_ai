-- Invoker rights retain the caller's RLS. The API never supplies an actor id.
create function public.rename_booking_lesson(p_booking_id uuid, p_lesson_name text)
returns setof public.bookings
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_lesson_name is null or length(btrim(p_lesson_name)) > 120 then
    raise exception 'Invalid lesson name' using errcode = '22023';
  end if;
  return query
    update public.bookings
       set lesson_name = nullif(btrim(p_lesson_name), '')
     where id = p_booking_id
       and (student_id = (select auth.uid()) or tutor_id = (select auth.uid()))
       and status <> 'cancelled'
    returning *;
end;
$$;
revoke all on function public.rename_booking_lesson(uuid, text) from public, anon;
grant execute on function public.rename_booking_lesson(uuid, text) to authenticated;

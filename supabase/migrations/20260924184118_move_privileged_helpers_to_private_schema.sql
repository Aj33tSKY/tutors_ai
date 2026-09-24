-- These SECURITY DEFINER helpers are used by RLS and the auth trigger, not as
-- public RPC endpoints. Keep them outside the exposed `public` API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.app_current_role() set schema private;
alter function public.is_linked_parent(uuid) set schema private;
alter function public.handle_new_user() set schema private;

-- RLS needs the two read helpers for signed-in requests. They are not exposed
-- through PostgREST because `private` is not an API schema.
revoke all on function private.app_current_role() from public, anon, authenticated, service_role;
grant execute on function private.app_current_role() to authenticated, service_role;
revoke all on function private.is_linked_parent(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_linked_parent(uuid) to authenticated, service_role;

-- The trigger invokes this function internally; clients never call it.
revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;

-- Avoid exposing future public functions by default. Grant execution explicitly
-- to the roles that need it when adding a function.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

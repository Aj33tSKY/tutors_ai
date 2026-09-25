-- Structural guard: every user-facing table must be protected at all, before the
-- per-table suites check that it is protected *correctly*. This is the test that
-- catches a new table shipped without RLS.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  $$,
  'every table in public has row level security enabled'
);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      )
  $$,
  'every table with RLS enabled has at least one policy'
);

-- The privileged helpers bypass RLS by design, so they must stay out of the API
-- schema where PostgREST would expose them.
select is_empty(
  $$
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('app_current_role', 'is_linked_parent', 'handle_new_user')
  $$,
  'privileged security-definer helpers live outside the public schema'
);

select is_empty(
  $$ select has_schema_privilege('anon', 'private', 'usage')::text where has_schema_privilege('anon', 'private', 'usage') $$,
  'anon cannot reach the private helper schema'
);

select * from finish();
rollback;

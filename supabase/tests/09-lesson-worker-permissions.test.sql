begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
select is((select owner from private.lesson_job_control), 'legacy', 'deploying schema does not activate worker');
select ok(not has_table_privilege('authenticated','private.lesson_segment_results','select'), 'segment results stay private');
select ok(not has_table_privilege('service_role','private.lesson_job_control','update'), 'legacy API cannot change scheduler ownership');
select ok(not has_function_privilege('anon','public.lesson_job_owner()','execute'), 'anonymous cannot query control plane');
select ok(has_function_privilege('service_role','public.lesson_job_owner()','execute'), 'legacy scheduler may check ownership');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname like 'lesson_%'
    and (has_function_privilege('anon',p.oid,'execute')
      or has_function_privilege('authenticated',p.oid,'execute')
      or has_function_privilege('service_role',p.oid,'execute'))
), 'worker operations have no browser or service-role execute grants');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname like 'lesson_%'
    and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)
), 'privileged machine functions use empty search_path');
select * from finish();
rollback;

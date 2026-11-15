import type { Pool } from "pg";

/** Owner-only release operation. Never grant general application-table access. */
export async function grantJobRuntime(pool: Pool, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("Invalid runtime role name");
  const { rows } = await pool.query(`select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
    exists(select 1 from pg_roles elevated where pg_has_role(r.oid,elevated.oid,'MEMBER')
      and (elevated.rolsuper or elevated.rolbypassrls or elevated.rolname in ('authenticated','service_role'))) as can_assume_privileged_role,
    has_schema_privilege(r.oid, 'app_jobs', 'CREATE') as can_migrate,
    has_table_privilege(r.oid, 'auth.users', 'SELECT') as reads_auth
    from pg_roles r where r.rolname = $1`, [role]);
  const candidate = rows[0];
  if (!candidate || Object.values(candidate).some(Boolean)) throw new Error("Runtime role is missing or has excessive privileges");
  const quoted = `"${role}"`;
  await pool.query(`grant usage on schema app_jobs, private to ${quoted};
    grant select,insert,update,delete on all tables in schema app_jobs to ${quoted};
    grant usage,select on all sequences in schema app_jobs to ${quoted};
    grant execute on all functions in schema app_jobs to ${quoted};
    grant execute on function private.lesson_transcription_candidates(),
      private.lesson_transcription_claim(uuid), private.lesson_transcription_publish(uuid,uuid,text),
      private.lesson_transcription_release(uuid,uuid), private.lesson_retention_candidates(),
      private.lesson_retention_complete(uuid,text), private.lesson_summary_candidates(),
      private.lesson_summary_claim(uuid), private.lesson_summary_release(uuid,uuid),
      private.lesson_summary_publish(uuid,uuid,text,jsonb,jsonb,text,numeric,jsonb),
      private.provider_event_claim(integer), private.provider_event_complete(uuid), private.provider_event_fail(uuid,text,integer),
      private.provider_event_abandon(uuid,text), private.apply_invoice_status(uuid,text,text),
      private.recording_reserve_audio(uuid,text), private.screen_reserve(uuid,text,text,text), private.recording_is_starting(uuid),
      private.recording_activate(uuid,text), private.recording_fail(uuid), private.recording_begin_stop(uuid,text), private.screen_end(text),
      private.recording_tracked_screens(uuid), private.recording_egress_ended(text,boolean,timestamptz,timestamptz,text),
      private.recording_stale_starting(interval), private.recording_unsettled(interval) to ${quoted}`);
}

/**
 * Owner-only release operation for the API's webhook intake login. It may persist signed
 * events and nothing else: no queue tables, no application tables, no event reads.
 */
export async function grantEventIntake(pool: Pool, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("Invalid runtime role name");
  const { rows } = await pool.query(`select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
    exists(select 1 from pg_roles elevated where pg_has_role(r.oid,elevated.oid,'MEMBER')
      and (elevated.rolsuper or elevated.rolbypassrls or elevated.rolname in ('authenticated','service_role'))) as can_assume_privileged_role,
    has_table_privilege(r.oid, 'auth.users', 'SELECT') as reads_auth
    from pg_roles r where r.rolname = $1`, [role]);
  const candidate = rows[0];
  if (!candidate || Object.values(candidate).some(Boolean)) throw new Error("Intake role is missing or has excessive privileges");
  const quoted = `"${role}"`;
  await pool.query(`grant usage on schema private to ${quoted};
    grant execute on function private.accept_provider_event(text,text,text,jsonb) to ${quoted}`);
}

import type { Pool } from "pg";

/** Owner-only release operation. Never grant general application-table access. */
export async function grantJobRuntime(pool: Pool, role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("Invalid runtime role name");
  const { rows } = await pool.query(`select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
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
      private.lesson_summary_publish(uuid,uuid,text,jsonb,jsonb,text,numeric,jsonb) to ${quoted}`);
}

import { PgBoss } from "pg-boss";
import { Pool } from "pg";

export const queueSchema = "app_jobs";
export async function assertJobRuntimePrivileges(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
  try {
    const { rows } = await pool.query(`select r.rolsuper, r.rolbypassrls,
      has_schema_privilege(current_user, 'app_jobs', 'CREATE') as can_migrate,
      coalesce((select bool_or(has_table_privilege(current_user, c.oid, 'SELECT'))
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='auth' and c.relname='users'), false) as reads_auth
      from pg_roles r where r.rolname=current_user`);
    const role = rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || role.can_migrate || role.reads_auth) {
      throw new Error("Job runtime credentials must not own migrations, bypass RLS or read Auth records");
    }
  } finally { await pool.end(); }
}
export function queue(connectionString: string, migrate = false) {
  const boss = new PgBoss({ connectionString, schema: queueSchema, max: 3, connectionTimeoutMillis: 10000, migrate, createSchema: migrate, schedule: false });
  boss.on("error", () => console.error(JSON.stringify({ event: "job_queue_error" })));
  return boss;
}

export const queues = { heartbeat: "runtime-heartbeat-v1" } as const;

/** Explicit release command; normal API/worker startup must not install schemas. */
export async function migrateQueue(connectionString: string) {
  const boss = queue(connectionString, true);
  try {
    await boss.start();
    await boss.createQueue(queues.heartbeat, { retryLimit: 3, retryDelay: 5, expireInSeconds: 60 });
  } finally { await boss.stop(); }
}

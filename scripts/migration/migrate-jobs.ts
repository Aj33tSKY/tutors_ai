import { migrateQueue } from "../../packages/jobs/src/queue.js";
import { grantEventIntake, grantJobRuntime } from "../../packages/jobs/src/permissions.js";
import { Pool } from "pg";

// Release-only. Grants are re-applied on every release because each migration can add private functions that
// the worker and the webhook intake must be allowed to call. Role names come from flags or the release env.
const connection = process.env.APP_JOBS_MIGRATION_DATABASE_URL;
if (!connection) throw new Error("APP_JOBS_MIGRATION_DATABASE_URL is required");
const flag = (name: string, fallback?: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const runtimeRole = flag("--runtime-role", process.env.APP_JOBS_RUNTIME_ROLE);
const intakeRole = flag("--intake-role", process.env.APP_EVENTS_ROLE);
await migrateQueue(connection);
if (runtimeRole || intakeRole) {
  const pool = new Pool({ connectionString: connection, max: 1 });
  try {
    if (runtimeRole) await grantJobRuntime(pool, runtimeRole);
    if (intakeRole) await grantEventIntake(pool, intakeRole);
  } finally { await pool.end(); }
}
console.info("Private job schema ready; runtime credentials must not own schema migrations.");

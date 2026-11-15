import { migrateQueue } from "../../packages/jobs/src/queue.js";
import { grantJobRuntime } from "../../packages/jobs/src/permissions.js";
import { Pool } from "pg";
const connection = process.env.APP_JOBS_MIGRATION_DATABASE_URL;
if (!connection) throw new Error("APP_JOBS_MIGRATION_DATABASE_URL is required");
await migrateQueue(connection);
const roleIndex = process.argv.indexOf("--runtime-role");
if (roleIndex >= 0) {
  const pool = new Pool({ connectionString: connection, max: 1 });
  try { await grantJobRuntime(pool, process.argv[roleIndex + 1] ?? ""); }
  finally { await pool.end(); }
}
console.info("Private job schema ready; runtime credentials must not own schema migrations.");

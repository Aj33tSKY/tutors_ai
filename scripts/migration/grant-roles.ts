import { grantEventIntake, grantJobRuntime } from "../../packages/jobs/src/permissions.js";
import { Pool } from "pg";

// Release-only, for hosts without a long-running worker (Cloudflare). Unlike migrate-jobs.ts it installs no queue schema:
// it only re-grants the two restricted logins, because each migration can add private functions they must be allowed to call.
const connection = process.env.APP_JOBS_MIGRATION_DATABASE_URL;
const runtimeRole = process.env.APP_JOBS_RUNTIME_ROLE;
const intakeRole = process.env.APP_EVENTS_ROLE;
if (!connection || !runtimeRole || !intakeRole) throw new Error("APP_JOBS_MIGRATION_DATABASE_URL, APP_JOBS_RUNTIME_ROLE and APP_EVENTS_ROLE are required");
const pool = new Pool({ connectionString: connection, max: 1 });
try {
  await grantJobRuntime(pool, runtimeRole);
  await grantEventIntake(pool, intakeRole);
} finally { await pool.end(); }
console.info("Restricted job and intake logins granted.");

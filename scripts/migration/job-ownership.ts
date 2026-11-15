import { Pool } from "pg";

const [expected, target] = process.argv.slice(2);
const owners = ["legacy", "paused", "worker"];
if (!owners.includes(expected) || !owners.includes(target) || expected === target || (expected !== "paused" && target !== "paused")) {
  throw new Error("Usage: job-ownership <expected-owner> <target-owner>; transition through paused and drain in-flight work first");
}
const connection = process.env.APP_JOBS_MIGRATION_DATABASE_URL;
if (!connection) throw new Error("APP_JOBS_MIGRATION_DATABASE_URL is required for this release-only operation");
const pool = new Pool({ connectionString: connection, max: 1 });
try {
  await pool.query("begin");
  const active = await pool.query(`select exists(select 1 from private.lesson_segment_results where lease_until > now())
    or exists(select 1 from private.lesson_summary_state where lease_until > now()) as busy`);
  if (target !== "paused" && active.rows[0].busy) throw new Error("Worker handlers still hold leases; finish draining before resuming a scheduler");
  const { rowCount } = await pool.query("update private.lesson_job_control set owner=$1 where singleton and owner=$2", [target, expected]);
  if (rowCount !== 1) throw new Error("Scheduler owner changed; inspect current ownership before retrying");
  if (target === "worker") {
    // A rollback may let the legacy cron append new segments. Checkpoint the
    // current aggregate and retire completed ledger entries before resuming,
    // so future publication cannot drop text added during that legacy window.
    await pool.query(`update private.lesson_transcript_baselines b set transcript = coalesce(a.full_transcript,'')
      from public.session_analytics a where a.booking_id = b.booking_id;
      delete from private.lesson_segment_results where completed_at is not null`);
  }
  await pool.query("commit");
  console.info(`Lesson scheduler ownership: ${expected} -> ${target}. Drain existing handlers before leaving paused.`);
} catch (error) { await pool.query("rollback"); throw error; }
finally { await pool.end(); }

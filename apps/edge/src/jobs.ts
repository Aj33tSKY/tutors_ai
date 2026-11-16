// Cloudflare adapter for background work: a Cron Trigger runs the sweep, a Queue runs one job per message. The decisions live
// in packages/jobs/src/runner.ts; this file only supplies a database connection and clients for each run.
//
// Rule for this file: nothing that holds a socket may outlive the invocation that created it. Workers forbid reusing I/O
// across requests (a module-level pg Pool fails on a later request with error 1101), so every run builds its own.
import Stripe from "stripe";
import type { Pool } from "pg";
import { aiConfigured } from "../../../packages/jobs/src/ai-models.js";
import { livekitEgress } from "../../../packages/jobs/src/livekit-egress.js";
import { recordingStore } from "../../../packages/jobs/src/recording-store.js";
import { expireRecordings, jobMessage, runJob, sweep, type JobClients, type JobMessage } from "../../../packages/jobs/src/runner.js";

export type JobsQueue = { send(body: JobMessage): Promise<void>; sendBatch(messages: { body: JobMessage }[]): Promise<void> };
export type JobsEnv = { JOBS?: JobsQueue };
export type QueueMessage = { body: unknown; attempts: number; ack(): void; retry(options?: { delaySeconds?: number }): void };

/** The daily schedule; every other schedule runs the sweep. Must match `triggers.crons` in wrangler.jsonc. */
export const DAILY_CRON = "15 3 * * *";
/** A queue message is retried this many times before it is dropped; the next sweep re-enqueues anything still due. */
export const MAX_MESSAGE_ATTEMPTS = 3;
const QUEUE_BATCH_LIMIT = 100;

export function jobsDatabaseUrl(raw = process.env.APP_JOBS_DATABASE_URL): string {
  if (!raw) throw new Error("APP_JOBS_DATABASE_URL is required");
  const url = new URL(raw);
  // Session mode rejects every client beyond its pool size; here each run opens a short connection of its own.
  if (url.hostname.endsWith(".pooler.supabase.com") && url.port !== "6543") throw new Error("On Workers APP_JOBS_DATABASE_URL must use Supabase's transaction pooler (port 6543)");
  return raw;
}

export async function withJobsDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const { Pool: PgPool } = await import("pg");
  const pool = new PgPool({ connectionString: jobsDatabaseUrl(), max: 1, connectionTimeoutMillis: 10000 });
  pool.on("error", () => console.error(JSON.stringify({ event: "jobs_database_connection_failed" })));
  try { return await run(pool); }
  finally { await pool.end().catch(() => undefined); }
}

export function jobClients(): JobClients {
  let store: JobClients["store"] = null;
  try { store = recordingStore(); } catch { /* R2 not configured: storage work stays switched off */ }
  return {
    stripe: process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20000 }) : null,
    egress: livekitEgress(),
    store,
    transcription: Boolean(process.env.DEEPGRAM_API_KEY),
    summaries: aiConfigured(),
  };
}

type Runtime = { database: typeof withJobsDatabase; clients: typeof jobClients };
const realRuntime: Runtime = { database: withJobsDatabase, clients: jobClients };

export async function runScheduled(cron: string, env: JobsEnv, runtime: Runtime = realRuntime) {
  await runtime.database(async (pool) => {
    const clients = runtime.clients();
    if (cron === DAILY_CRON) { await expireRecordings(pool, clients); return; }
    await sweep(pool, clients, async (messages) => {
      if (!env.JOBS) throw new Error("The JOBS queue binding is missing");
      for (let i = 0; i < messages.length; i += QUEUE_BATCH_LIMIT) await env.JOBS.sendBatch(messages.slice(i, i + QUEUE_BATCH_LIMIT).map((body) => ({ body })));
    });
  });
}

export async function runQueueBatch(batch: { messages: QueueMessage[] }, runtime: Runtime = realRuntime) {
  for (const message of batch.messages) {
    const parsed = jobMessage.safeParse(message.body);
    if (!parsed.success) { console.error(JSON.stringify({ event: "job_message_invalid" })); message.ack(); continue; }
    try {
      await runtime.database((pool) => runJob(pool, parsed.data, runtime.clients()));
      message.ack();
    } catch (error) {
      // The database already counts attempts for transcription and summaries and releases their claims; this retry only
      // covers failures around them (for example the database being briefly unreachable).
      const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "job_failed";
      console.error(JSON.stringify({ event: "job_failed", kind: parsed.data.kind, attempts: message.attempts, code }));
      if (message.attempts < MAX_MESSAGE_ATTEMPTS) message.retry({ delaySeconds: 30 * message.attempts });
      else message.ack();
    }
  }
}

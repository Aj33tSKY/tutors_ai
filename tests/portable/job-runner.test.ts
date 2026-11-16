import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { eventEffects, runJob, sweep, type JobClients, type JobMessage } from "../../packages/jobs/src/runner.js";
import { jobsDatabaseUrl, runQueueBatch, runScheduled, DAILY_CRON, MAX_MESSAGE_ATTEMPTS, type QueueMessage } from "../../apps/edge/src/jobs.js";

const quiet = () => { const e = console.error, i = console.info; console.error = () => {}; console.info = () => {}; return () => { console.error = e; console.info = i; }; };
type Handler = (text: string, values?: unknown[]) => unknown[] | Promise<unknown[]>;
function fakePool(handler: Handler) {
  const calls: string[] = [];
  const pool = { calls, async query(text: string, values?: unknown[]) { calls.push(text); return { rows: await handler(text, values) }; } };
  return pool as unknown as Pool & { calls: string[] };
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clients = (overrides: Partial<JobClients> = {}): JobClients => ({ stripe: null, egress: null, store: { sign: async () => "https://r2.test/x", remove: async () => {} }, transcription: true, summaries: true, ...overrides });

test("the sweep enqueues due transcripts and summaries", async () => {
  const restore = quiet();
  const pool = fakePool((text) => text.includes("transcription_candidates") ? [{ id: uuid(1) }, { id: uuid(2) }] : text.includes("summary_candidates") ? [{ id: uuid(3) }] : []);
  const sent: JobMessage[] = [];
  const result = await sweep(pool, clients(), async (messages) => { sent.push(...messages); });
  restore();
  assert.deepEqual(sent, [{ kind: "transcribe", recordingId: uuid(1) }, { kind: "transcribe", recordingId: uuid(2) }, { kind: "summarize", bookingId: uuid(3) }]);
  assert.equal(result.enqueued, 3);
});

test("unconfigured providers switch their work off instead of failing it", async () => {
  const restore = quiet();
  const pool = fakePool((text) => text.includes("candidates") ? [{ id: uuid(1) }] : []);
  const sent: JobMessage[] = [];
  await sweep(pool, clients({ transcription: false, summaries: false }), async (messages) => { sent.push(...messages); });
  restore();
  assert.deepEqual(sent, []);
  assert.ok(!pool.calls.some((text) => text.includes("candidates")), "no candidate queries without providers");
});

test("one failing step does not stop the rest of the sweep", async () => {
  const restore = quiet();
  const pool = fakePool((text) => { if (text.includes("provider_event_claim")) throw new Error("database blip"); return text.includes("summary_candidates") ? [{ id: uuid(9) }] : []; });
  const sent: JobMessage[] = [];
  const result = await sweep(pool, clients(), async (messages) => { sent.push(...messages); });
  restore();
  assert.equal(result.applied, null);
  assert.deepEqual(sent, [{ kind: "summarize", bookingId: uuid(9) }]);
});

test("an events job keeps claiming while full batches come back", async () => {
  let claims = 0;
  const invoice = (n: number) => ({ id: uuid(n), attempts: 1, payload: { kind: "invoice_status", bookingId: uuid(100), invoiceId: `in_${n}`, status: "paid" } });
  const pool = fakePool((text) => {
    if (text.includes("provider_event_claim")) { claims++; return Array.from({ length: claims < 3 ? 10 : 3 }, (_, i) => invoice(claims * 100 + i)); }
    if (text.includes("apply_invoice_status")) return [{ applied: true }];
    return [];
  });
  assert.equal(await runJob(pool, { kind: "events" }, clients()), 23);
  assert.equal(claims, 3);
});

test("jobs refuse to run without their provider", async () => {
  await assert.rejects(runJob(fakePool(() => []), { kind: "transcribe", recordingId: uuid(1) }, clients({ store: null })), /transcription_unconfigured/);
  await assert.rejects(runJob(fakePool(() => []), { kind: "summarize", bookingId: uuid(1) }, clients({ summaries: false })), /summaries_unconfigured/);
});

test("saving a card makes it the customer's default, and fails clearly without Stripe", async () => {
  const pool = fakePool(() => []);
  await assert.rejects(eventEffects(pool, { stripe: null, egress: null }).setDefaultPaymentMethod("cus_1", "seti_1"), /stripe_unconfigured/);
  const updates: unknown[] = [];
  const stripe = { setupIntents: { retrieve: async () => ({ payment_method: "pm_1" }) }, customers: { update: async (id: string, body: unknown) => { updates.push([id, body]); } } };
  await eventEffects(pool, { stripe: stripe as never, egress: null }).setDefaultPaymentMethod("cus_1", "seti_1");
  assert.deepEqual(updates, [["cus_1", { invoice_settings: { default_payment_method: "pm_1" } }]]);
});

test("on Workers the job database must be the transaction pooler", () => {
  assert.throws(() => jobsDatabaseUrl("postgresql://u.ref:p@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"), /transaction pooler/);
  assert.equal(jobsDatabaseUrl("postgresql://u.ref:p@aws-1-eu-west-1.pooler.supabase.com:6543/postgres").includes(":6543/"), true);
  assert.doesNotThrow(() => jobsDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:54322/postgres"));
  assert.throws(() => jobsDatabaseUrl(""), /required/);
});

function message(body: unknown, attempts = 1) {
  const state = { acked: false, retried: null as null | number };
  const m: QueueMessage = { body, attempts, ack: () => { state.acked = true; }, retry: (o) => { state.retried = o?.delaySeconds ?? 0; } };
  return { m, state };
}
const runtime = (run: () => Promise<unknown>) => ({ database: async <T>(fn: (pool: Pool) => Promise<T>) => { await run(); return fn(fakePool(() => [])); }, clients: () => clients() });

test("queue messages: invalid ones are dropped, successes acknowledged, failures retried with backoff then dropped", async () => {
  const restore = quiet();
  const invalid = message({ kind: "nonsense" });
  const ok = message({ kind: "events" });
  await runQueueBatch({ messages: [invalid.m, ok.m] }, runtime(async () => {}));
  assert.equal(invalid.state.acked, true);
  assert.equal(ok.state.acked, true);
  const failing = () => runtime(async () => { throw new Error("database_unreachable"); });
  const first = message({ kind: "events" }, 1); const second = message({ kind: "events" }, 2); const last = message({ kind: "events" }, MAX_MESSAGE_ATTEMPTS);
  await runQueueBatch({ messages: [first.m, second.m, last.m] }, failing());
  restore();
  assert.deepEqual([first.state.retried, second.state.retried], [30, 60]);
  assert.deepEqual([last.state.acked, last.state.retried], [true, null]);
});

test("the minute schedule enqueues in batches of at most 100; the daily one expires recordings", async () => {
  const restore = quiet();
  const ids = Array.from({ length: 150 }, (_, i) => ({ id: uuid(i + 1) }));
  const batches: number[] = [];
  const env = { JOBS: { send: async () => {}, sendBatch: async (messages: unknown[]) => { batches.push(messages.length); } } };
  const minute = { database: async <T>(fn: (pool: Pool) => Promise<T>) => fn(fakePool((text) => text.includes("transcription_candidates") ? ids : [])), clients: () => clients({ summaries: false }) };
  await runScheduled("* * * * *", env, minute);
  assert.deepEqual(batches, [100, 50]);
  const removed: string[] = [];
  const daily = { database: async <T>(fn: (pool: Pool) => Promise<T>) => fn(fakePool((text) => text.includes("retention_candidates") ? [{ id: uuid(7), storage_path: "recordings/x.ogg" }] : [])),
    clients: () => clients({ store: { sign: async () => "", remove: async (path: string) => { removed.push(path); } } }) };
  await runScheduled(DAILY_CRON, env, daily);
  restore();
  assert.deepEqual(removed, ["recordings/x.ogg"]);
});

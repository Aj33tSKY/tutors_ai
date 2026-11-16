// Host-agnostic background work. A host supplies a database pool, its clients and a way to enqueue; this module decides what
// to do. The Cloudflare Worker calls it from a Cron Trigger and a Queue consumer; the Node worker uses the same effects.
// Every step goes through the database's claim functions, so overlapping or repeated runs cannot double-apply anything.
import type { Pool } from "pg";
import type Stripe from "stripe";
import { z } from "zod";
import { processProviderEvents, type EventEffects } from "./provider-events.js";
import { handleRecordingEvent, reconcileRecordings, type EgressControl } from "./recording-control.js";
import { pruneRecordings, transcribeRecording, type RecordingStore } from "./lesson-work.js";
import { summarizeLesson } from "./summarization.js";

export const jobMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("events") }).strict(),
  z.object({ kind: z.literal("transcribe"), recordingId: z.uuid() }).strict(),
  z.object({ kind: z.literal("summarize"), bookingId: z.uuid() }).strict(),
]);
export type JobMessage = z.infer<typeof jobMessage>;

/** What a run may use. A missing client switches its work off instead of failing it. */
export type JobClients = {
  stripe: Stripe | null;
  egress: EgressControl | null;
  store: RecordingStore | null;
  /** Deepgram is configured. */
  transcription: boolean;
  /** An AI provider is configured; without one summaries are not queued, so they burn no attempts. */
  summaries: boolean;
};

export function eventEffects(pool: Pool, clients: Pick<JobClients, "stripe" | "egress">): EventEffects {
  return {
    // Without LiveKit/R2 credentials recording events stay queued (and visible) instead of being dropped.
    recording: clients.egress ? (event, attempts) => handleRecordingEvent(pool, clients.egress!, event, attempts) : undefined,
    async setDefaultPaymentMethod(customerId, setupIntentId) {
      if (!clients.stripe) throw new Error("stripe_unconfigured");
      const intent = await clients.stripe.setupIntents.retrieve(setupIntentId);
      const method = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
      // Making it the default lets charge_automatically invoices find it without a copy here that could go stale.
      if (method) await clients.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: method } });
    },
  };
}

const log = (event: string, fields: Record<string, unknown> = {}) => console.info(JSON.stringify({ event, ...fields }));
async function step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try { return await run(); }
  catch (error) {
    // Codes only: provider messages can carry personal data.
    console.error(JSON.stringify({ event: "job_step_failed", step: name, error: error instanceof Error ? error.name : "unknown" }));
    return null;
  }
}

/**
 * The once-a-minute safety net: apply provider events that are due (first attempts normally happen straight after the
 * webhook), settle recordings the media server has finished, and enqueue lessons that need a transcript or a summary.
 * Each part is isolated, so one failing provider does not stop the others.
 */
export async function sweep(pool: Pool, clients: JobClients, enqueue: (messages: JobMessage[]) => Promise<void>) {
  const applied = await step("provider_events", () => processProviderEvents(pool, eventEffects(pool, clients)));
  const settled = clients.egress ? await step("reconcile_recordings", () => reconcileRecordings(pool, clients.egress!)) : 0;
  const messages: JobMessage[] = [];
  if (clients.transcription && clients.store) {
    const rows = await step("transcription_candidates", async () => (await pool.query<{ id: string }>("select id from private.lesson_transcription_candidates()")).rows);
    for (const row of rows ?? []) messages.push({ kind: "transcribe", recordingId: row.id });
  }
  if (clients.summaries) {
    const rows = await step("summary_candidates", async () => (await pool.query<{ id: string }>("select id from private.lesson_summary_candidates()")).rows);
    for (const row of rows ?? []) messages.push({ kind: "summarize", bookingId: row.id });
  }
  if (messages.length) await enqueue(messages);
  log("jobs_sweep", { applied, settled, enqueued: messages.length });
  return { applied, settled, enqueued: messages.length };
}

/** Runs one queued job. Failures release the claim and count an attempt in the database, which bounds retries. */
export async function runJob(pool: Pool, message: JobMessage, clients: JobClients) {
  switch (message.kind) {
    case "events": {
      // A burst of webhooks can leave more than one batch waiting.
      let applied = 0;
      for (let batch = 0; batch < 5; batch++) {
        const count = await processProviderEvents(pool, eventEffects(pool, clients));
        applied += count;
        if (count < 10) break;
      }
      return applied;
    }
    case "transcribe":
      if (!clients.store || !clients.transcription) throw new Error("transcription_unconfigured");
      await transcribeRecording(pool, message.recordingId, clients.store);
      return 1;
    case "summarize":
      if (!clients.summaries) throw new Error("summaries_unconfigured");
      await summarizeLesson(pool, message.bookingId);
      return 1;
  }
}

/** Daily: delete expired recordings from storage and mark them expired. */
export async function expireRecordings(pool: Pool, clients: Pick<JobClients, "store">) {
  if (!clients.store) throw new Error("storage_unconfigured");
  await pruneRecordings(pool, clients.store);
}

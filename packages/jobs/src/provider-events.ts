import type { Pool } from "pg";
import { z } from "zod";

/** The only facts the application keeps from a signed provider event. No customer details are stored. */
export const normalizedEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoice_status"), bookingId: z.uuid(), invoiceId: z.string().min(1), status: z.enum(["paid", "failed", "pending"]) }).strict(),
  z.object({ kind: z.enum(["tutor_joined", "tutor_left"]), bookingId: z.uuid(), identity: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("screen_started"), bookingId: z.uuid(), identity: z.string().min(1), trackSid: z.string().min(1), mimeType: z.string() }).strict(),
  z.object({ kind: z.literal("screen_ended"), trackSid: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("egress_ended"), egressId: z.string().min(1), ok: z.boolean(), startedAt: z.string().optional(), endedAt: z.string(), filename: z.string().optional() }).strict(),
  z.object({ kind: z.literal("setup_completed"), customerId: z.string().min(1), setupIntentId: z.string().min(1) }).strict(),
]);
export type NormalizedEvent = z.infer<typeof normalizedEvent>;
type StripeLike = { type: string; data: { object: Record<string, unknown> } };
const idOf = (value: unknown) => typeof value === "string" ? value : (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : null);

/** Returns null for events this application does not act on, so they are acknowledged without being stored. */
export function normalizeStripeEvent(event: StripeLike): NormalizedEvent | null {
  const object = event.data.object;
  if (event.type === "checkout.session.completed") {
    const customerId = idOf(object.customer); const setupIntentId = idOf(object.setup_intent);
    // Saving a method finishes here, not on the success page: closing the tab after authorising still counts.
    return object.mode === "setup" && customerId && setupIntentId ? { kind: "setup_completed", customerId, setupIntentId } : null;
  }
  const status = ({ "invoice.paid": "paid", "invoice.payment_failed": "failed",
    // Off-session 3-D Secure cannot finish without the student; Stripe emails the link, so the lesson must not look collected.
    "invoice.payment_action_required": "pending" } as Record<string, "paid" | "failed" | "pending">)[event.type];
  const metadata = object.metadata as { booking_id?: string } | undefined;
  const parsed = z.uuid().safeParse(metadata?.booking_id);
  const invoiceId = idOf(object.id);
  return status && parsed.success && invoiceId ? { kind: "invoice_status", bookingId: parsed.data, invoiceId, status } : null;
}

export interface EventEffects {
  setDefaultPaymentMethod(customerId: string, setupIntentId: string): Promise<void>;
  /** Present on a worker with LiveKit credentials; recording events wait (and retry) without it. */
  recording?(event: NormalizedEvent, attempts: number): Promise<void>;
}
/** Thrown by a handler to choose its own retry delay instead of the default backoff. */
export class RetryAfter extends Error { constructor(readonly seconds: number, readonly code = "retry") { super(code); } }
/** Thrown by a handler when no retry can help; the event is ended and visible as abandoned. */
export class Abandon extends Error { constructor(readonly code = "abandoned") { super(code); } }

/** Applies one claimed event. Throwing leaves it leased for a backed-off retry. */
export async function applyProviderEvent(pool: Pool, event: NormalizedEvent, effects: EventEffects, attempts = 1) {
  if (event.kind !== "setup_completed" && event.kind !== "invoice_status") {
    if (!effects.recording) throw new Error("recording_unconfigured");
    await effects.recording(event, attempts); return;
  }
  if (event.kind === "setup_completed") { await effects.setDefaultPaymentMethod(event.customerId, event.setupIntentId); return; }
  const { rows } = await pool.query("select private.apply_invoice_status($1,$2,$3) as applied", [event.bookingId, event.invoiceId, event.status]);
  // The webhook can beat the request that records the invoice on the booking; retry until it lands.
  if (!rows[0]?.applied) throw new Error("invoice_not_recorded_yet");
}

export async function processProviderEvents(pool: Pool, effects: EventEffects, limit = 10) {
  const claimed = await pool.query<{ id: string; payload: unknown; attempts: number }>("select id, payload, attempts from private.provider_event_claim($1)", [limit]);
  let applied = 0;
  for (const row of claimed.rows) {
    try {
      await applyProviderEvent(pool, normalizedEvent.parse(row.payload), effects, row.attempts);
      await pool.query("select private.provider_event_complete($1)", [row.id]);
      applied++;
    } catch (error) {
      if (error instanceof Abandon) { await pool.query("select private.provider_event_abandon($1,$2)", [row.id, error.code]); continue; }
      if (error instanceof RetryAfter) { await pool.query("select private.provider_event_fail($1,$2,$3)", [row.id, error.code, error.seconds]); continue; }
      // Store a short code only. Provider payloads and messages can contain personal data.
      const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "handler_failed";
      await pool.query("select private.provider_event_fail($1,$2)", [row.id, code]);
      console.error(JSON.stringify({ event: "provider_event_failed", eventId: row.id, code }));
    }
  }
  return applied;
}

export function eventIntake(connectionString = process.env.APP_EVENTS_DATABASE_URL) {
  if (!connectionString) return null;
  let pool: Pool | undefined;
  return { async accept(provider: string, eventId: string, type: string, payload: NormalizedEvent) {
    const { Pool: PgPool } = await import("pg");
    pool ??= new PgPool({ connectionString, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    const { rows } = await pool.query("select private.accept_provider_event($1,$2,$3,$4) as accepted", [provider, eventId, type, JSON.stringify(payload)]);
    return Boolean(rows[0]?.accepted);
  } };
}
export type EventIntake = NonNullable<ReturnType<typeof eventIntake>>;

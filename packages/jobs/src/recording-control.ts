import type { Pool } from "pg";
import { Abandon, RetryAfter, type NormalizedEvent } from "./provider-events";
import { NonRetryableError, retryWithDelays } from "./retry";
import { egressFinished, egressOutcome, type EgressOutcome } from "./livekit-events";
import type { EgressInfo } from "livekit-server-sdk";

/** The media server, as the recording logic sees it. LiveKit is one adapter. */
export interface EgressControl {
  startAudio(input: { roomName: string; tutorIdentity: string; studentIdentity: string; path: string }): Promise<string>;
  startScreen(input: { roomName: string; trackSid: string; path: string }): Promise<string>;
  /** Idempotent: an already-ended job is not an error. */
  stop(egressId: string): Promise<void>;
  /** Stops anything running in the room that the database is not tracking. */
  stopStray(roomName: string, keep: readonly string[]): Promise<void>;
  /** null when the media server has no record of the job. */
  describe(egressId: string): Promise<{ finished: boolean; outcome: EgressOutcome } | null>;
}
export const roomFor = (bookingId: string) => `booking-${bookingId}`;
// A busy Egress node turns a job away without saying so and LiveKit reports it ~10 s later. A share
// that starts alongside other recordings is often accepted moments later, so retry for about a minute.
export const SCREEN_START_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;
const AUDIO_RETRY_SECONDS = [5, 15, 30] as const;

type Row = Record<string, unknown>;
async function one<T = Row>(pool: Pool, sql: string, values: unknown[]): Promise<T | null> {
  const { rows } = await pool.query(sql, values);
  return (rows[0] as T | undefined) ?? null;
}

async function startAudio(pool: Pool, egress: EgressControl, bookingId: string, identity: string, attempts: number) {
  const reserved = await one<{ r: { id: string; storagePath: string; tutorId: string; studentId: string } | null }>(pool, "select private.recording_reserve_audio($1,$2) as r", [bookingId, identity]);
  if (!reserved?.r) return; // not the tutor, lesson closed, no consent, or already recording
  const { id, storagePath, tutorId, studentId } = reserved.r;
  const room = roomFor(bookingId);
  try {
    const tracked = (await pool.query("select private.recording_tracked_screens($1) as egress", [bookingId])).rows.map((row) => row.egress as string);
    // Belt and braces against piled-up jobs observed on staging: stop strays, but never a tracked share,
    // because webhooks can be handled out of order and a share may already be recording.
    await egress.stopStray(room, tracked);
    const egressId = await egress.startAudio({ roomName: room, tutorIdentity: tutorId, studentIdentity: studentId, path: storagePath });
    const active = await one<{ ok: boolean }>(pool, "select private.recording_activate($1,$2) as ok", [id, egressId]);
    // The reservation changed while the job started (for example reconciled as failed): do not leave it running.
    if (!active?.ok) await egress.stop(egressId);
  } catch {
    await pool.query("select private.recording_fail($1)", [id]);
    // A fresh attempt reserves a new row; bound the retries so a stale join cannot record an empty room for long.
    const delay = AUDIO_RETRY_SECONDS[attempts - 1];
    if (delay === undefined) throw new Abandon("audio_start_failed");
    throw new RetryAfter(delay, "audio_start_retry");
  }
}

async function startScreen(pool: Pool, egress: EgressControl, event: Extract<NormalizedEvent, { kind: "screen_started" }>) {
  const reserved = await one<{ r: { id: string; storagePath: string } | null }>(pool, "select private.screen_reserve($1,$2,$3,$4) as r", [event.bookingId, event.identity, event.trackSid, event.mimeType]);
  if (!reserved?.r) return;
  const { id, storagePath } = reserved.r;
  try {
    await retryWithDelays(async () => {
      const egressId = await egress.startScreen({ roomName: roomFor(event.bookingId), trackSid: event.trackSid, path: storagePath });
      // Only the Egress request is retried: past this point a job exists, and repeating it would record the share twice.
      try {
        const active = await one<{ ok: boolean }>(pool, "select private.recording_activate($1,$2) as ok", [id, egressId]);
        // The share ended while the job was starting; nothing is left to record.
        if (!active?.ok) await egress.stop(egressId);
      } catch (error) {
        await egress.stop(egressId).catch(() => undefined);
        throw new NonRetryableError(error);
      }
    }, SCREEN_START_RETRY_DELAYS_MS, {
      // A share that has ended marks its row failed, which is what stops a retry still waiting.
      shouldContinue: async () => Boolean((await one<{ ok: boolean }>(pool, "select private.recording_is_starting($1) as ok", [id]))?.ok),
      onRetry: (_error, attempt, delayMs) => console.warn(JSON.stringify({ event: "screen_recording_retry", attempt, delayMs })),
    });
  } catch {
    console.error(JSON.stringify({ event: "screen_recording_failed", recordingId: id }));
    await pool.query("select private.recording_fail($1)", [id]);
  }
}

/** Applies one signed LiveKit event. Safe to replay: every state change is gated by a database reservation. */
export async function handleRecordingEvent(pool: Pool, egress: EgressControl, event: NormalizedEvent, attempts: number) {
  switch (event.kind) {
    case "tutor_joined": return startAudio(pool, egress, event.bookingId, event.identity, attempts);
    case "tutor_left": {
      const { rows } = await pool.query("select private.recording_begin_stop($1,$2) as egress", [event.bookingId, event.identity]);
      // Egress may already have ended; the egress_ended event finalises the saved file either way.
      for (const row of rows) await egress.stop(row.egress as string).catch(() => console.warn(JSON.stringify({ event: "egress_stop_failed" })));
      return;
    }
    case "screen_started": return startScreen(pool, egress, event);
    case "screen_ended": {
      const row = await one<{ egress: string | null }>(pool, "select private.screen_end($1) as egress", [event.trackSid]);
      if (row?.egress) await egress.stop(row.egress).catch(() => undefined);
      return;
    }
    case "egress_ended":
      await pool.query("select private.recording_egress_ended($1,$2,$3,$4,$5)", [event.egressId, event.ok, event.startedAt ?? null, event.endedAt, event.filename ?? null]);
      return;
    default: throw new Error("not_a_recording_event");
  }
}

/**
 * Closes the gaps a lost webhook or a crash leaves. Reservations that never reached the media
 * server are failed (after stopping anything stray in their room), and jobs whose end was never
 * reported are settled from the media server's own record.
 */
export async function reconcileRecordings(pool: Pool, egress: EgressControl) {
  let settled = 0;
  for (const row of (await pool.query<{ id: string; booking_id: string }>("select id, booking_id from private.recording_stale_starting()")).rows) {
    const tracked = (await pool.query("select private.recording_tracked_screens($1) as egress", [row.booking_id])).rows.map((r) => r.egress as string);
    await egress.stopStray(roomFor(row.booking_id), tracked).catch(() => undefined);
    await pool.query("select private.recording_fail($1)", [row.id]); settled++;
  }
  for (const row of (await pool.query<{ id: string; egress_id: string }>("select id, egress_id from private.recording_unsettled()")).rows) {
    const info = await egress.describe(row.egress_id).catch(() => undefined);
    if (info === undefined) continue; // media server unreachable: try again next pass
    if (info && !info.finished) continue; // still genuinely running
    const outcome = info?.outcome ?? { ok: false, endedAt: new Date().toISOString() };
    await pool.query("select private.recording_egress_ended($1,$2,$3,$4,$5)", [row.egress_id, outcome.ok, outcome.startedAt ?? null, outcome.endedAt, outcome.filename ?? null]); settled++;
  }
  return settled;
}
export const describeInfo = (info: EgressInfo) => ({ finished: egressFinished(info), outcome: egressOutcome(info) });

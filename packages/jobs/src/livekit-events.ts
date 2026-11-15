import { EgressStatus, TrackSource, TrackType, type EgressInfo, type WebhookEvent } from "livekit-server-sdk";
import type { NormalizedEvent } from "./provider-events";

export type EgressOutcome = { ok: boolean; startedAt?: string; endedAt: string; filename?: string };

/**
 * What a finished Egress job produced. Judged by whether a file was saved rather than by
 * `error` alone: a screen share that simply ends takes its export down with it, and that
 * must not hide a good recording. Times are the file's own media clock (unix nanoseconds),
 * not when the job was requested or the webhook arrived, because playback lines screen
 * shares up against the lesson audio with them.
 */
export function egressOutcome(info: EgressInfo, now = new Date()): EgressOutcome {
  const file = info.fileResults[0];
  const startNanos = Number(file?.startedAt ?? 0) || Number(info.startedAt);
  const startedAtMs = startNanos > 0 ? startNanos / 1_000_000 : undefined;
  const durationMs = Number(file?.duration ?? 0) / 1_000_000;
  return {
    ok: Boolean(file && Number(file.size) > 0),
    startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : undefined,
    endedAt: startedAtMs && durationMs > 0 ? new Date(startedAtMs + durationMs).toISOString() : now.toISOString(),
    // The path LiveKit actually wrote; for passthrough it chooses the container itself.
    filename: file?.filename || undefined,
  };
}
export const egressFinished = (info: EgressInfo) =>
  [EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED, EgressStatus.EGRESS_LIMIT_REACHED].includes(info.status);

const bookingIdFromRoom = (room: string | undefined) => room?.match(/^booking-([0-9a-f-]{36})$/i)?.[1]?.toLowerCase() ?? null;

/**
 * Keeps only what the worker needs. The webhook's `id` is the dedupe key. Roles are never
 * read from the payload: a track_published webhook carries no participant metadata, so the
 * booking decides who the tutor is when the event is applied.
 */
export function normalizeLiveKitEvent(event: WebhookEvent): NormalizedEvent | null {
  if (event.event === "egress_ended" && event.egressInfo?.egressId) {
    const info = event.egressInfo;
    if (info.error) console.warn(JSON.stringify({ event: "egress_ended_with_error", egressId: info.egressId }));
    return { kind: "egress_ended", egressId: info.egressId, ...egressOutcome(info) };
  }
  if (event.event === "track_published" || event.event === "track_unpublished") {
    const track = event.track;
    if (!track?.sid || track.type !== TrackType.VIDEO || track.source !== TrackSource.SCREEN_SHARE) return null;
    if (event.event === "track_unpublished") return { kind: "screen_ended", trackSid: track.sid };
    const bookingId = bookingIdFromRoom(event.room?.name);
    const identity = event.participant?.identity;
    if (!bookingId || !identity) return null;
    return { kind: "screen_started", bookingId, identity, trackSid: track.sid, mimeType: track.mimeType || track.codecs[0]?.mimeType || "" };
  }
  if (event.event === "participant_joined" || event.event === "participant_left") {
    const bookingId = bookingIdFromRoom(event.room?.name);
    const identity = event.participant?.identity;
    return bookingId && identity ? { kind: event.event === "participant_joined" ? "tutor_joined" : "tutor_left", bookingId, identity } : null;
  }
  return null;
}

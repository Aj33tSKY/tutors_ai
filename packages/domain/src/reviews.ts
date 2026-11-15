import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index.js";
import type { SessionRecording } from "../../contracts/src/models.js";
import type { ReviewBooking, SessionReview, ScreenSegment } from "../../contracts/src/reviews.js";
import { databaseResult } from "./portal";
import { AppError } from "./errors";

export async function sessionReview(client: SupabaseClient, identity: Identity, id: string, sign: (path: string) => Promise<string | null>): Promise<SessionReview> {
  const result = await client.from("bookings").select("id,tutor_id,student_id,subject,exam_board,lesson_name,start_time,started_at,is_trial,payment_status,status")
    .eq("id", id).maybeSingle<ReviewBooking & { status: string }>();
  databaseResult(result.error);
  const booking = result.data;
  if (!booking || booking.status !== "completed") throw new AppError(404, "not_found", "Session review not found");
  const [analytics, recordings] = await Promise.all([
    client.from("session_analytics").select("full_transcript,summary_notes,notes_markdown,recording_path").eq("booking_id", id).maybeSingle(),
    client.from("session_recordings").select("id,storage_path,status,started_at,ended_at,transcribed_at,transcribe_attempts,kind")
      .eq("booking_id", id).order("started_at").returns<SessionRecording[]>(),
  ]);
  databaseResult(recordings.error);
  const rows = recordings.data ?? [];
  const isPending = (r: SessionRecording) => ["starting", "active", "stopping"].includes(r.status);
  const ready = rows.filter((r) => r.kind === "audio" && r.status === "ready");
  const paths = ready.length ? ready.map((r) => ({ id: r.id, path: r.storage_path, startedAt: r.started_at, endedAt: r.ended_at }))
    : analytics.data?.recording_path ? [{ id: "legacy", path: analytics.data.recording_path as string, startedAt: booking.started_at ?? booking.start_time, endedAt: null }] : [];
  const audioPlayers = await Promise.all(paths.map(async (r) => ({ ...r, url: await sign(r.path) })));
  const screens = await Promise.all(rows.filter((r) => r.kind === "screen" && r.status === "ready" && r.ended_at).map(async (r): Promise<ScreenSegment | null> => {
    const src = await sign(r.storage_path);
    return src ? { id: r.id, src, type: r.storage_path.endsWith(".webm") ? "video/webm" : "video/mp4", startMs: Date.parse(r.started_at), endMs: Date.parse(r.ended_at!) } : null;
  }));
  return { booking, analytics: analytics.error || !analytics.data ? null : { full_transcript: analytics.data.full_transcript,
    summary_notes: analytics.data.summary_notes, notes_markdown: analytics.data.notes_markdown }, analyticsError: Boolean(analytics.error),
    audioPlayers, screenSegments: screens.filter((r): r is ScreenSegment => r !== null), hasPendingRecordings: rows.some(isPending),
    transcriptPending: rows.some((r) => r.kind === "audio" && isPending(r)) || ready.some((r) => !r.transcribed_at && r.transcribe_attempts < 3),
    canEditNotes: identity.id === booking.tutor_id };
}

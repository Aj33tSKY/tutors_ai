import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronRequest } from "@/lib/cron";
import { formatTranscript, transcribeRemoteAudio, type SpeakerRole, type SpeakerSegment } from "@/lib/transcription";

const TRANSCRIPT_AUDIO_BUCKET = "session-transcript-audio";
/** Give a reconnecting tutor time to publish a new track before transcribing. */
const SETTLE_MS = 2 * 60 * 1000;
/** Audio is a processing buffer, never storage. Nothing survives this long. */
const MAX_AUDIO_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_BOOKINGS_PER_RUN = 3;
const SIGNED_URL_TTL_SECONDS = 900;

type Segment = {
  id: string;
  booking_id: string;
  role: SpeakerRole;
  storage_path: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  transcribe_attempts: number;
};

/** Deletes the audio itself, then records that it is gone. */
async function discardAudio(
  admin: ReturnType<typeof createAdminClient>,
  segments: Pick<Segment, "id" | "storage_path">[],
  status: "transcribed" | "deleted",
) {
  if (segments.length === 0) return;
  const { error: removeError } = await admin.storage
    .from(TRANSCRIPT_AUDIO_BUCKET)
    .remove(segments.map((segment) => segment.storage_path));
  if (removeError) {
    console.error("transcribe-sessions: could not delete transcript audio:", removeError.message);
    return;
  }
  await admin
    .from("session_transcript_audio")
    .update({ status })
    .in("id", segments.map((segment) => segment.id));
}

async function transcribeBooking(
  admin: ReturnType<typeof createAdminClient>,
  bookingId: string,
): Promise<"done" | "skipped" | "failed"> {
  const { data, error } = await admin
    .from("session_transcript_audio")
    .select("id, booking_id, role, storage_path, status, started_at, ended_at, transcribe_attempts")
    .eq("booking_id", bookingId);
  if (error) throw error;

  const segments = (data ?? []) as Segment[];
  // A session that is still recording must not be transcribed halfway through.
  if (segments.some((segment) => segment.status === "starting" || segment.status === "active")) {
    return "skipped";
  }

  const ready = segments.filter((segment) => segment.status === "ready" && segment.started_at);
  if (ready.length === 0) return "skipped";

  const newestEnd = Math.max(
    ...ready.map((segment) => new Date(segment.ended_at ?? segment.started_at!).getTime()),
  );
  if (Date.now() - newestEnd < SETTLE_MS) return "skipped";

  if (ready.some((segment) => segment.transcribe_attempts >= MAX_ATTEMPTS)) {
    await admin
      .from("session_transcript_audio")
      .update({ status: "failed" })
      .in("id", ready.map((segment) => segment.id));
    await discardAudio(admin, ready, "deleted");
    return "failed";
  }

  await admin
    .from("session_transcript_audio")
    .update({ transcribe_attempts: (ready[0]?.transcribe_attempts ?? 0) + 1 })
    .in("id", ready.map((segment) => segment.id));

  // Each file starts when its track was published, so everything is measured
  // from the earliest one to put both speakers on a single timeline.
  const sessionStart = Math.min(...ready.map((segment) => new Date(segment.started_at!).getTime()));

  const speakerSegments: SpeakerSegment[] = [];
  for (const segment of ready) {
    const { data: signed, error: signError } = await admin.storage
      .from(TRANSCRIPT_AUDIO_BUCKET)
      .createSignedUrl(segment.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(`Could not sign ${segment.storage_path}: ${signError?.message ?? "no URL returned"}`);
    }
    speakerSegments.push({
      role: segment.role,
      offsetSeconds: (new Date(segment.started_at!).getTime() - sessionStart) / 1000,
      utterances: await transcribeRemoteAudio(signed.signedUrl),
    });
  }

  const transcript = formatTranscript(speakerSegments);
  if (transcript.trim().length === 0) {
    // Nobody spoke, or Deepgram heard nothing. Still a finished session.
    await discardAudio(admin, ready, "transcribed");
    return "done";
  }

  // A tutor may leave and rejoin; append rather than replace, matching how the
  // booking stays scheduled until the tutor explicitly completes it.
  const { data: existing } = await admin
    .from("session_analytics")
    .select("full_transcript")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const combined = existing?.full_transcript
    ? `${existing.full_transcript}\n${transcript}`
    : transcript;

  const { error: upsertError } = await admin
    .from("session_analytics")
    .upsert({ booking_id: bookingId, full_transcript: combined }, { onConflict: "booking_id" });
  if (upsertError) throw upsertError;

  await discardAudio(admin, ready, "transcribed");
  return "done";
}

/** Nothing may linger, including audio whose session never transcribed cleanly. */
async function pruneExpiredAudio(admin: ReturnType<typeof createAdminClient>) {
  const cutoff = new Date(Date.now() - MAX_AUDIO_AGE_MS).toISOString();
  const { data, error } = await admin
    .from("session_transcript_audio")
    .select("id, storage_path")
    .lt("created_at", cutoff)
    .not("status", "in", "(transcribed,deleted)")
    .limit(100);
  if (error) {
    console.error("transcribe-sessions: could not load expired audio:", error.message);
    return 0;
  }
  const expired = data ?? [];
  await discardAudio(admin, expired, "deleted");

  // Belt and braces: delete anything left in the bucket that no longer has a
  // row pointing at it. Historically egress also wrote a manifest beside each
  // file, and a run that dies between starting an egress and recording it would
  // strand its audio here too. The bucket should hold nothing but in-flight
  // segments, so anything old and unreferenced goes.
  const orphans: string[] = [];
  const { data: folders } = await admin.storage.from(TRANSCRIPT_AUDIO_BUCKET).list("", { limit: 100 });
  for (const folder of folders ?? []) {
    const { data: objects } = await admin.storage
      .from(TRANSCRIPT_AUDIO_BUCKET)
      .list(folder.name, { limit: 100 });
    for (const object of objects ?? []) {
      const path = `${folder.name}/${object.name}`;
      const age = Date.now() - new Date(object.created_at ?? Date.now()).getTime();
      if (age < MAX_AUDIO_AGE_MS) continue;
      const { count } = await admin
        .from("session_transcript_audio")
        .select("id", { count: "exact", head: true })
        .eq("storage_path", path);
      if (!count) orphans.push(path);
    }
  }
  if (orphans.length > 0) {
    const { error: orphanError } = await admin.storage.from(TRANSCRIPT_AUDIO_BUCKET).remove(orphans);
    if (orphanError) console.error("transcribe-sessions: could not delete orphaned audio:", orphanError.message);
  }

  return expired.length + orphans.length;
}

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();

  const { data: pending, error } = await admin
    .from("session_transcript_audio")
    .select("booking_id")
    .eq("status", "ready")
    .limit(200);
  if (error) {
    console.error("transcribe-sessions: could not load pending audio:", error.message);
    return new Response("Failed to load pending audio", { status: 500 });
  }

  const bookingIds = [...new Set((pending ?? []).map((row) => row.booking_id))].slice(
    0,
    MAX_BOOKINGS_PER_RUN,
  );

  let transcribed = 0;
  let failed = 0;
  for (const bookingId of bookingIds) {
    try {
      const outcome = await transcribeBooking(admin, bookingId);
      if (outcome === "done") transcribed += 1;
      if (outcome === "failed") failed += 1;
    } catch (cause) {
      // Attempts were already incremented, so a persistently broken session
      // stops retrying instead of blocking the queue forever.
      failed += 1;
      console.error(`transcribe-sessions: booking ${bookingId} failed:`, cause);
    }
  }

  const pruned = await pruneExpiredAudio(admin);
  return Response.json({ transcribed, failed, pruned });
}

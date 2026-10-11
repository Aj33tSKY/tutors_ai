import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronRequest } from "@/lib/cron";
import { formatTranscript, transcribeStereoRecording, MAX_TRANSCRIBE_ATTEMPTS } from "@/lib/transcription";

const RECORDINGS_BUCKET = "session-recordings";
const MAX_SEGMENTS_PER_RUN = 10;
const SIGNED_URL_TTL_SECONDS = 900;

type PendingSegment = {
  id: string;
  booking_id: string;
  storage_path: string;
  transcribe_attempts: number;
};

/**
 * Each recording segment is a single, already-complete stereo Egress job
 * (started on the tutor's join, stopped on their leave), so — unlike the
 * old per-track pipeline — there is no "is this session's audio fully
 * assembled yet" ambiguity to wait out. A segment can be transcribed the
 * moment it is `ready`.
 */
async function transcribeSegment(
  admin: ReturnType<typeof createAdminClient>,
  segment: PendingSegment,
): Promise<void> {
  await admin
    .from("session_recordings")
    .update({ transcribe_attempts: segment.transcribe_attempts + 1 })
    .eq("id", segment.id);

  const { data: signed, error: signError } = await admin.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(segment.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    throw new Error(`Could not sign ${segment.storage_path}: ${signError?.message ?? "no URL returned"}`);
  }

  const turns = await transcribeStereoRecording(signed.signedUrl);
  const transcript = formatTranscript(turns);

  if (transcript.trim().length > 0) {
    // A tutor may leave and rejoin, producing a new segment; append rather
    // than replace, matching how the booking stays scheduled until the
    // tutor explicitly completes it.
    const { data: existing } = await admin
      .from("session_analytics")
      .select("full_transcript")
      .eq("booking_id", segment.booking_id)
      .maybeSingle();
    const combined = existing?.full_transcript
      ? `${existing.full_transcript}\n${transcript}`
      : transcript;

    const { error: upsertError } = await admin
      .from("session_analytics")
      .upsert({ booking_id: segment.booking_id, full_transcript: combined }, { onConflict: "booking_id" });
    if (upsertError) throw upsertError;
  }
  // Nobody spoke, or Deepgram heard nothing — still a finished attempt.

  const { error } = await admin
    .from("session_recordings")
    .update({ transcribed_at: new Date().toISOString() })
    .eq("id", segment.id);
  if (error) throw error;
}

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const { data: pending, error } = await admin
    .from("session_recordings")
    .select("id, booking_id, storage_path, transcribe_attempts")
    .eq("status", "ready")
    .eq("kind", "audio")
    // Only the stereo recordings have one speaker per channel; older MP4s have
    // the same mixed audio on both and would transcribe every line twice.
    .like("storage_path", "%.ogg")
    .is("transcribed_at", null)
    .lt("transcribe_attempts", MAX_TRANSCRIBE_ATTEMPTS)
    .order("started_at", { ascending: true })
    .limit(MAX_SEGMENTS_PER_RUN);
  if (error) {
    console.error("transcribe-sessions: could not load pending recordings:", error.message);
    return new Response("Failed to load pending recordings", { status: 500 });
  }

  let transcribed = 0;
  let failed = 0;
  for (const segment of (pending ?? []) as PendingSegment[]) {
    try {
      await transcribeSegment(admin, segment);
      transcribed += 1;
    } catch (cause) {
      // The attempt was already incremented, so a persistently broken
      // recording stops retrying after MAX_TRANSCRIBE_ATTEMPTS instead of
      // blocking the queue forever. The file itself is left alone either
      // way — it is the user's playable recording, not a processing buffer.
      failed += 1;
      console.error(`transcribe-sessions: recording ${segment.id} failed:`, cause);
    }
  }

  return Response.json({ transcribed, failed });
}

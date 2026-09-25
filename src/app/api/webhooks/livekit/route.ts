import {
  DirectFileOutput,
  EncodedFileOutput,
  EncodedFileType,
  EgressClient,
  RoomServiceClient,
  S3Upload,
  TrackSource,
  TrackType,
  WebhookReceiver,
} from "livekit-server-sdk";
import { createAdminClient } from "@/lib/supabase/admin";

const RECORDINGS_BUCKET = "session-recordings";
const TRANSCRIPT_AUDIO_BUCKET = "session-transcript-audio";

function livekitHost() {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!url) throw new Error("NEXT_PUBLIC_LIVEKIT_URL is not configured");
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function bookingIdFromRoom(roomName: string | undefined) {
  const match = roomName?.match(/^booking-([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

function clients() {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error("LiveKit server credentials are not configured");
  const host = livekitHost();
  return {
    egress: new EgressClient(host, key, secret),
    rooms: new RoomServiceClient(host, key, secret),
  };
}

/** Both buckets are written by LiveKit Egress over Supabase Storage's S3 API. */
function storageUpload(bucket: string) {
  const accessKey = process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID;
  const secretKey = process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!accessKey || !secretKey || !supabaseUrl) {
    throw new Error("Supabase Storage S3 credentials are not configured");
  }
  return new S3Upload({
    accessKey,
    secret: secretKey,
    endpoint: `${new URL(supabaseUrl).origin}/storage/v1/s3`,
    region: process.env.SUPABASE_STORAGE_S3_REGION || "us-east-1",
    bucket,
    forcePathStyle: true,
  });
}

/**
 * Starts an audio-only egress for one participant's microphone track. One file
 * per track is what gives the transcript reliable speaker attribution without
 * acoustic diarization — the same property the old in-room agent had, but
 * without an always-on service.
 *
 * These files exist only until the transcript is written; the transcribe-sessions
 * cron deletes them. They are not the consented session recording.
 */
async function startTranscriptAudioEgress(
  bookingId: string,
  roomName: string,
  trackSid: string,
  role: "student" | "tutor",
  identity: string,
) {
  const admin = createAdminClient();
  const storagePath = `${bookingId}/${trackSid}.ogg`;

  // A repeated track_published webhook must not start a second egress; the
  // unique index on track_sid makes the insert the idempotency gate.
  const { data: segment, error: insertError } = await admin
    .from("session_transcript_audio")
    .insert({
      booking_id: bookingId,
      participant_identity: identity,
      role,
      track_sid: trackSid,
      storage_path: storagePath,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError || !segment) {
    if (insertError?.code === "23505") return;
    throw insertError ?? new Error("Could not reserve a transcript audio segment");
  }

  try {
    const { egress } = clients();
    const result = await egress.startTrackEgress(
      roomName,
      new DirectFileOutput({
        filepath: storagePath,
        // Egress writes a sibling <egress-id>.json manifest by default. Nothing
        // reads it, and this bucket is meant to hold nothing for long, so not
        // writing it beats deleting it afterwards.
        disableManifest: true,
        output: { case: "s3", value: storageUpload(TRANSCRIPT_AUDIO_BUCKET) },
      }),
      trackSid,
    );
    const { error } = await admin
      .from("session_transcript_audio")
      .update({ egress_id: result.egressId, status: "active" })
      .eq("id", segment.id)
      .eq("status", "starting");
    if (error) throw error;
  } catch (error) {
    await admin
      .from("session_transcript_audio")
      .update({ status: "failed", ended_at: new Date().toISOString() })
      .eq("id", segment.id);
    throw error;
  }
}

/** Transcription spans the tutor's presence, exactly as the old agent did. */
async function stopTranscriptAudio(bookingId: string) {
  const admin = createAdminClient();
  const { data: segments } = await admin
    .from("session_transcript_audio")
    .select("id, egress_id")
    .eq("booking_id", bookingId)
    .in("status", ["starting", "active"]);
  if (!segments?.length) return;

  const { egress } = clients();
  for (const segment of segments) {
    if (!segment.egress_id) continue;
    try {
      await egress.stopEgress(segment.egress_id);
    } catch (error) {
      // Egress may already have ended when the room emptied; the signed
      // egress_ended webhook is the source of truth either way.
      console.warn(`Could not stop transcript egress ${segment.egress_id}:`, error);
    }
  }
}

/** True once the tutor is actually connected, so a lone student is not recorded. */
async function tutorIsPresent(roomName: string, tutorId: string) {
  const { rooms } = clients();
  const participants = await rooms.listParticipants(roomName);
  return participants.some((participant) => participant.identity === tutorId);
}

async function startRecording(bookingId: string, roomName: string) {
  const admin = createAdminClient();
  const { data: consent } = await admin
    .from("session_recording_consents")
    .select("booking_id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!consent) return;

  const { data: existing } = await admin
    .from("session_recordings")
    .select("id")
    .eq("booking_id", bookingId)
    .in("status", ["starting", "active"])
    .maybeSingle();
  if (existing) return;

  const storagePath = `${bookingId}/${crypto.randomUUID()}.mp4`;
  const { data: recording, error: insertError } = await admin
    .from("session_recordings")
    .insert({ booking_id: bookingId, storage_path: storagePath, status: "starting" })
    .select("id")
    .single();
  if (insertError || !recording) {
    // A concurrent duplicate LiveKit webhook may have claimed the active
    // recording slot. Treat that as already handled.
    if (insertError?.code === "23505") return;
    throw insertError ?? new Error("Could not reserve a recording segment");
  }

  try {
    const { egress } = clients();
    const result = await egress.startRoomCompositeEgress(
      roomName,
      {
        file: new EncodedFileOutput({
          fileType: EncodedFileType.MP4,
          filepath: storagePath,
          output: { case: "s3", value: storageUpload(RECORDINGS_BUCKET) },
        }),
      },
      { layout: "speaker" },
    );
    const { error } = await admin
      .from("session_recordings")
      .update({ egress_id: result.egressId, status: "active" })
      .eq("id", recording.id)
      .eq("status", "starting");
    if (error) throw error;
  } catch (error) {
    await admin
      .from("session_recordings")
      .update({ status: "failed", ended_at: new Date().toISOString() })
      .eq("id", recording.id);
    throw error;
  }
}

async function stopTutorRecording(bookingId: string, roomName: string) {
  const admin = createAdminClient();
  const { data: recordings } = await admin
    .from("session_recordings")
    .select("id, egress_id")
    .eq("booking_id", bookingId)
    .eq("status", "active");
  if (!recordings?.length) return;

  const { egress } = clients();
  for (const recording of recordings) {
    if (!recording.egress_id) continue;
    await admin
      .from("session_recordings")
      .update({ status: "stopping" })
      .eq("id", recording.id)
      .eq("status", "active");
    try {
      await egress.stopEgress(recording.egress_id);
    } catch (error) {
      // Egress may already have ended; the signed egress_ended webhook is the
      // source of truth for finalizing the saved file.
      console.warn(`Could not stop egress ${recording.egress_id} for ${roomName}:`, error);
    }
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return new Response("Webhook not configured", { status: 503 });

  const body = await request.text();
  let event;
  try {
    event = await new WebhookReceiver(apiKey, apiSecret).receive(body, request.headers.get("authorization") ?? undefined);
  } catch {
    return new Response("Invalid LiveKit webhook signature", { status: 401 });
  }

  try {
    if (event.event === "egress_ended" && event.egressInfo?.egressId) {
      const admin = createAdminClient();
      const info = event.egressInfo;
      const successful = !info.error && info.fileResults.length > 0;
      const endedAt = new Date().toISOString();

      const { error } = await admin
        .from("session_recordings")
        .update({ status: successful ? "ready" : "failed", ended_at: endedAt })
        .eq("egress_id", info.egressId);
      if (error) throw error;

      // LiveKit's own start time is what the transcript timeline is built from,
      // and it is more accurate than when this app requested the egress.
      // startedAt is unix nanoseconds; the tsconfig target predates BigInt literals.
      const startedAtNanos = Number(info.startedAt);
      const startedAt =
        startedAtNanos > 0 ? new Date(startedAtNanos / 1_000_000).toISOString() : undefined;
      const { error: audioError } = await admin
        .from("session_transcript_audio")
        .update({
          status: successful ? "ready" : "failed",
          ended_at: endedAt,
          ...(startedAt ? { started_at: startedAt } : {}),
        })
        .eq("egress_id", info.egressId)
        .in("status", ["starting", "active"]);
      if (audioError) throw audioError;

      return new Response("ok");
    }

    if (event.event === "track_published") {
      const track = event.track;
      if (track?.type !== TrackType.AUDIO || track.source !== TrackSource.MICROPHONE) {
        return new Response("ok");
      }
      const roomName = event.room?.name;
      const bookingId = bookingIdFromRoom(roomName);
      const identity = event.participant?.identity;
      if (!roomName || !bookingId || !identity) return new Response("ok");

      const admin = createAdminClient();
      const { data: booking } = await admin
        .from("bookings")
        .select("id, tutor_id, student_id, status")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking || booking.status !== "scheduled") return new Response("ok");

      // A track_published payload carries only the participant's sid, name and
      // identity — no metadata — so the role cannot be read from the token here.
      // The booking is the authoritative source anyway, and unlike metadata it
      // cannot be omitted or spoofed.
      const role =
        identity === booking.tutor_id ? "tutor" : identity === booking.student_id ? "student" : null;
      if (!role) return new Response("ok");

      if (!(await tutorIsPresent(roomName, booking.tutor_id))) return new Response("ok");

      await startTranscriptAudioEgress(bookingId, roomName, track.sid, role, identity);
      return new Response("ok");
    }

    if (event.event !== "participant_joined" && event.event !== "participant_left") {
      return new Response("ok");
    }

    const roomName = event.room?.name;
    const bookingId = bookingIdFromRoom(roomName);
    if (!roomName || !bookingId) return new Response("ok");

    const admin = createAdminClient();
    const { data: booking } = await admin
      .from("bookings")
      .select("id, tutor_id, status")
      .eq("id", bookingId)
      .maybeSingle();
    // Comparing identity against the booking is what establishes this is the
    // tutor. Token metadata is not consulted: it is absent from some webhook
    // payloads, and the booking is authoritative regardless.
    if (!booking || booking.tutor_id !== event.participant?.identity) {
      return new Response("ok");
    }

    if (event.event === "participant_joined") {
      if (booking.status !== "scheduled") return new Response("ok");
      // Transcript audio starts from each track_published event, since a track
      // only exists after its participant has joined.
      await startRecording(bookingId, roomName);
    } else {
      await stopTranscriptAudio(bookingId);
      await stopTutorRecording(bookingId, roomName);
    }
    return new Response("ok");
  } catch (error) {
    console.error("LiveKit webhook processing failed:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}

// AudioConfig/AudioRoute/AudioChannel aren't re-exported by livekit-server-sdk
// (only the older egress request types are) — import straight from the
// protocol package it wraps.
import { AudioChannel, AudioConfig, AudioRoute } from "@livekit/protocol";
import {
  EgressClient,
  EncodedFileType,
  FileOutput,
  MediaSource,
  Output,
  S3Upload,
  StartEgressRequest,
  StorageConfig,
  WebhookReceiver,
} from "livekit-server-sdk";
import { createAdminClient } from "@/lib/supabase/admin";

const RECORDINGS_BUCKET = "session-recordings";

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
  };
}

function storageUpload() {
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
    bucket: RECORDINGS_BUCKET,
    forcePathStyle: true,
  });
}

/**
 * Guards against ending up with more active Egress jobs per room than
 * intended — observed on staging during rapid back-to-back testing. Belt and
 * suspenders: stop anything already running for this room before starting a
 * fresh job, so a stray or duplicate job can never pile up concurrency usage
 * on its own, regardless of cause.
 */
async function stopStrayEgress(roomName: string) {
  const { egress } = clients();
  try {
    const active = await egress.listEgress({ roomName, active: true });
    await Promise.all(
      active.map((info) =>
        egress.stopEgress(info.egressId).catch((error) => {
          console.warn(`Could not stop stray egress ${info.egressId} for ${roomName}:`, error);
        }),
      ),
    );
  } catch (error) {
    console.warn(`Could not list egress for room ${roomName}:`, error);
  }
}

/**
 * Starts one audio-only, two-channel Egress for the whole booking — the
 * tutor's track routed to the left channel, the student's to the right.
 * One file gives the transcript reliable speaker attribution without
 * acoustic diarization (the channel, not a guess, says who spoke), and one
 * Egress job per call is what keeps concurrent-Egress usage proportional to
 * concurrent calls instead of 2-3x it. The same file is both the transcript
 * source and the persistent, user-playable recording — there is no separate
 * video recording and no separate transcript-only buffer.
 */
async function startRecording(
  bookingId: string,
  roomName: string,
  tutorIdentity: string,
  studentIdentity: string,
) {
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

  await stopStrayEgress(roomName);

  const storagePath = `${bookingId}/${crypto.randomUUID()}.ogg`;
  const { data: recording, error: insertError } = await admin
    .from("session_recordings")
    .insert({ booking_id: bookingId, storage_path: storagePath, status: "starting" })
    .select("id")
    .single();
  if (insertError || !recording) {
    // A concurrent duplicate LiveKit webhook must not claim the active
    // recording slot twice; the unique index on (booking_id) where status is
    // starting/active makes the insert itself the idempotency gate.
    if (insertError?.code === "23505") return;
    throw insertError ?? new Error("Could not reserve a recording segment");
  }

  try {
    const { egress } = clients();
    const result = await egress.startEgress(
      new StartEgressRequest({
        roomName,
        source: {
          case: "media",
          value: new MediaSource({
            audio: new AudioConfig({
              captureAll: false,
              routes: [
                new AudioRoute({
                  match: { case: "participantIdentity", value: tutorIdentity },
                  channel: AudioChannel.LEFT,
                }),
                new AudioRoute({
                  match: { case: "participantIdentity", value: studentIdentity },
                  channel: AudioChannel.RIGHT,
                }),
              ],
            }),
          }),
        },
        outputs: [
          new Output({
            config: {
              case: "file",
              value: new FileOutput({ fileType: EncodedFileType.OGG, filepath: storagePath }),
            },
          }),
        ],
        storage: new StorageConfig({ provider: { case: "s3", value: storageUpload() } }),
      }),
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

      // LiveKit's own start time is more accurate than when this app
      // requested the egress, and is what the booking page's segment labels
      // are built from. startedAt is unix nanoseconds; the tsconfig target
      // predates BigInt literals.
      const startedAtNanos = Number(info.startedAt);
      const startedAt =
        startedAtNanos > 0 ? new Date(startedAtNanos / 1_000_000).toISOString() : undefined;

      const { error } = await admin
        .from("session_recordings")
        .update({
          status: successful ? "ready" : "failed",
          ended_at: endedAt,
          ...(startedAt ? { started_at: startedAt } : {}),
        })
        .eq("egress_id", info.egressId);
      if (error) throw error;
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
      .select("id, tutor_id, student_id, status")
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
      await startRecording(bookingId, roomName, booking.tutor_id, booking.student_id);
    } else {
      await stopTutorRecording(bookingId, roomName);
    }
    return new Response("ok");
  } catch (error) {
    console.error("LiveKit webhook processing failed:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}

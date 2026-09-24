import {
  AgentDispatchClient,
  EncodedFileOutput,
  EncodedFileType,
  EgressClient,
  S3Upload,
  WebhookReceiver,
} from "livekit-server-sdk";
import { createAdminClient } from "@/lib/supabase/admin";

const RECORDINGS_BUCKET = "session-recordings";

function livekitHost() {
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!url) throw new Error("NEXT_PUBLIC_LIVEKIT_URL is not configured");
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function roleFromMetadata(metadata: string | undefined) {
  try {
    const parsed = JSON.parse(metadata ?? "{}") as { role?: string };
    return parsed.role;
  } catch {
    return undefined;
  }
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
    dispatch: new AgentDispatchClient(host, key, secret),
    egress: new EgressClient(host, key, secret),
  };
}

async function startTutorAgent(roomName: string, webhookEventId: string) {
  const agentName = process.env.LIVEKIT_AGENT_NAME;
  if (!agentName) throw new Error("LIVEKIT_AGENT_NAME is not configured");
  const { dispatch } = clients();
  const existing = await dispatch.listDispatch(roomName);
  const eventMetadata = JSON.stringify({ webhookEventId });
  if (existing.some((item) => item.agentName === agentName && item.metadata === eventMetadata)) return;
  await dispatch.createDispatch(roomName, agentName, { metadata: eventMetadata });
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

  const accessKey = process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID;
  const secretKey = process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!accessKey || !secretKey || !supabaseUrl) {
    await admin.from("session_recordings").update({ status: "failed", ended_at: new Date().toISOString() }).eq("id", recording.id);
    throw new Error("Supabase Storage S3 credentials are not configured");
  }

  try {
    const { egress } = clients();
    const result = await egress.startRoomCompositeEgress(
      roomName,
      {
        file: new EncodedFileOutput({
          fileType: EncodedFileType.MP4,
          filepath: storagePath,
          output: {
            case: "s3",
            value: new S3Upload({
              accessKey,
              secret: secretKey,
              endpoint: `${new URL(supabaseUrl).origin}/storage/v1/s3`,
              region: process.env.SUPABASE_STORAGE_S3_REGION || "us-east-1",
              bucket: RECORDINGS_BUCKET,
              forcePathStyle: true,
            }),
          },
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
      const { error } = await admin
        .from("session_recordings")
        .update({
          status: successful ? "ready" : "failed",
          ended_at: new Date().toISOString(),
        })
        .eq("egress_id", info.egressId);
      if (error) throw error;
      return new Response("ok");
    }

    if (event.event !== "participant_joined" && event.event !== "participant_left") {
      return new Response("ok");
    }
    if (roleFromMetadata(event.participant?.metadata) !== "tutor") return new Response("ok");

    const roomName = event.room?.name;
    const bookingId = bookingIdFromRoom(roomName);
    if (!roomName || !bookingId) return new Response("ok");

    const admin = createAdminClient();
    const { data: booking } = await admin
      .from("bookings")
      .select("id, tutor_id, status")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking || booking.tutor_id !== event.participant?.identity) {
      return new Response("ok");
    }

    if (event.event === "participant_joined") {
      if (booking.status !== "scheduled") return new Response("ok");
      await startTutorAgent(roomName, event.id);
      await startRecording(bookingId, roomName);
    } else {
      await stopTutorRecording(bookingId, roomName);
    }
    return new Response("ok");
  } catch (error) {
    console.error("LiveKit webhook processing failed:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}

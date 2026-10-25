// AudioConfig/AudioRoute/AudioChannel aren't re-exported by livekit-server-sdk
// (only the older egress request types are) — import straight from the
// protocol package it wraps.
import { AudioChannel, AudioConfig, AudioRoute } from "@livekit/protocol";
import {
  EgressClient,
  EncodedFileType,
  EncodingOptionsPreset,
  FileOutput,
  MediaSource,
  Output,
  StartEgressRequest,
  StorageConfig,
  TrackSource,
  TrackType,
  WebhookReceiver,
} from "livekit-server-sdk";
import { after } from "next/server";
import { recordingsUpload } from "@/lib/recordings-storage";
import { NonRetryableError, retryWithDelays } from "@/lib/retry";
import { createAdminClient } from "@/lib/supabase/admin";

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

/**
 * Guards against ending up with more active Egress jobs per room than
 * intended — observed on staging during rapid back-to-back testing. Belt and
 * suspenders: stop anything already running for this room before starting a
 * fresh audio job, so a stray or duplicate job can never pile up concurrency
 * usage on its own, regardless of cause.
 *
 * Screen-share jobs this booking is tracking are left alone: webhooks can be
 * handled out of order, so a share started right after joining may already be
 * recording by the time the tutor's join is processed.
 */
async function stopStrayEgress(bookingId: string, roomName: string) {
  const { egress } = clients();
  try {
    const { data: screens } = await createAdminClient()
      .from("session_recordings")
      .select("egress_id")
      .eq("booking_id", bookingId)
      .eq("kind", "screen")
      .in("status", ["starting", "active"]);
    const tracked = new Set((screens ?? []).map((row) => row.egress_id));
    const active = await egress.listEgress({ roomName, active: true });
    await Promise.all(
      active.filter((info) => !tracked.has(info.egressId)).map((info) =>
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

  await stopStrayEgress(bookingId, roomName);

  const storagePath = `${bookingId}/${crypto.randomUUID()}.ogg`;
  const { data: recording, error: insertError } = await admin
    .from("session_recordings")
    .insert({ booking_id: bookingId, storage_path: storagePath, status: "starting", kind: "audio" })
    .select("id")
    .single();
  if (insertError || !recording) {
    // A concurrent duplicate LiveKit webhook must not claim the active
    // recording slot twice; the unique index on (booking_id) for an active
    // audio recording makes the insert itself the idempotency gate.
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
              // Egress otherwise writes an <egress-id>.json manifest beside the
              // file. Nothing reads it, and no session_recordings row points at
              // it, so the 90-day prune would never delete it.
              value: new FileOutput({ fileType: EncodedFileType.OGG, filepath: storagePath, disableManifest: true }),
            },
          }),
        ],
        storage: new StorageConfig({ provider: { case: "s3", value: recordingsUpload() } }),
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

/**
 * Records one screen-share track, saved exactly as published (PASSTHROUGH:
 * no decode, no re-encode, no audio). That is what should make it cheap — a
 * raw track export rather than a video transcode, though LiveKit doesn't
 * document how passthrough is billed — and the lesson audio already comes
 * from the stereo recording. Playback lines the two up by their start times.
 */
async function startScreenRecording(bookingId: string, roomName: string, trackSid: string, mimeType: string) {
  const admin = createAdminClient();
  const { data: consent } = await admin
    .from("session_recording_consents")
    .select("booking_id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (!consent) return;

  // Passthrough keeps the track's own codec, and LiveKit picks the container
  // from it: H.264 is written as MP4, VP8/VP9 as WebM. The call publishes H.264
  // (see video-room.tsx); WebM covers a browser that fell back to VP8. This is
  // only our best guess at the name — egress_ended records the real one.
  const isH264 = !mimeType || mimeType.toLowerCase().includes("h264");
  const storagePath = `${bookingId}/screen-${trackSid}.${isH264 ? "mp4" : "webm"}`;

  const { data: recording, error: insertError } = await admin
    .from("session_recordings")
    .insert({
      booking_id: bookingId,
      storage_path: storagePath,
      status: "starting",
      kind: "screen",
      track_sid: trackSid,
    })
    .select("id")
    .single();
  if (insertError || !recording) {
    // A repeated track_published webhook must not start a second job for the
    // same share; the unique index on track_sid is the idempotency gate.
    if (insertError?.code === "23505") return;
    throw insertError ?? new Error("Could not reserve a screen recording");
  }

  // Starting happens after the response: a busy Egress node turns a job away
  // without saying so, LiveKit reports that 10 s later, and the retries below
  // can take another minute — far longer than LiveKit should wait on a webhook.
  after(() => startScreenEgress(recording.id, roomName, trackSid, storagePath));
}

// Egress holds a freshly accepted job's CPU estimate for 15 s, so a share that
// starts alongside other recordings can be refused and then accepted moments
// later. Waits are counted from the end of the previous attempt, which itself
// takes up to 10 s to fail. Attempts: now, then roughly 15 s, 30 s and 70 s in.
const SCREEN_START_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

async function startScreenEgress(recordingId: string, roomName: string, trackSid: string, storagePath: string) {
  const admin = createAdminClient();
  try {
    await retryWithDelays(
      async () => {
        const result = await clients().egress.startEgress(
          new StartEgressRequest({
            roomName,
            source: {
              case: "media",
              value: new MediaSource({ video: { case: "videoTrackId", value: trackSid } }),
            },
            encoding: { case: "preset", value: EncodingOptionsPreset.PASSTHROUGH },
            outputs: [
              new Output({
                config: {
                  case: "file",
                  // No fileType: with PASSTHROUGH, LiveKit rejects any explicit
                  // type ("invalid field: passthrough file_type") and picks the
                  // container from the track's codec itself.
                  value: new FileOutput({ filepath: storagePath, disableManifest: true }),
                },
              }),
            ],
            storage: new StorageConfig({ provider: { case: "s3", value: recordingsUpload() } }),
          }),
        );
        // Only the Egress request is retried: past this point a job exists, and
        // repeating it would record the same share twice.
        try {
          const { data: claimed, error } = await admin
            .from("session_recordings")
            .update({ egress_id: result.egressId, status: "active" })
            .eq("id", recordingId)
            .eq("status", "starting")
            .select("id");
          if (error) throw error;
          // The share ended while the job was starting; nothing is left to record.
          if (!claimed?.length) await clients().egress.stopEgress(result.egressId);
        } catch (error) {
          console.error(`Screen egress ${result.egressId} started but could not be recorded:`, error);
          await clients().egress.stopEgress(result.egressId).catch(() => {});
          throw new NonRetryableError(error);
        }
      },
      SCREEN_START_RETRY_DELAYS_MS,
      {
        // A share that has ended (track_unpublished) marks its row failed, which
        // is what stops any retry still waiting.
        shouldContinue: async () => {
          const { data } = await admin.from("session_recordings").select("status").eq("id", recordingId).maybeSingle();
          return data?.status === "starting";
        },
        onRetry: (error, attemptNumber, delayMs) =>
          console.warn(
            `Screen recording for ${trackSid} could not start (attempt ${attemptNumber}); retrying in ${delayMs / 1000}s:`,
            error,
          ),
      },
    );
  } catch (error) {
    console.error(`Screen recording for ${trackSid} failed to start:`, error);
    await admin
      .from("session_recordings")
      .update({ status: "failed", ended_at: new Date().toISOString() })
      .eq("id", recordingId)
      .eq("status", "starting");
  }
}

/** A single-track export ends by itself when its track goes away; this is the backstop. */
async function stopScreenRecording(trackSid: string) {
  const admin = createAdminClient();
  // A share that ends before its recording has started (still waiting on a
  // busy Egress) has nothing to stop. Failing the row is what tells the start
  // retries to give up.
  await admin
    .from("session_recordings")
    .update({ status: "failed", ended_at: new Date().toISOString() })
    .eq("track_sid", trackSid)
    .eq("status", "starting");

  const { data: recording } = await admin
    .from("session_recordings")
    .select("id, egress_id")
    .eq("track_sid", trackSid)
    .eq("status", "active")
    .maybeSingle();
  if (!recording?.egress_id) return;

  await admin.from("session_recordings").update({ status: "stopping" }).eq("id", recording.id).eq("status", "active");
  try {
    await clients().egress.stopEgress(recording.egress_id);
  } catch (error) {
    // Usually it has already ended with the track; egress_ended finalizes it.
    console.warn(`Could not stop screen egress ${recording.egress_id}:`, error);
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
      const file = info.fileResults[0];
      // Judged by whether a file was saved rather than by info.error alone: a
      // screen share that simply ends takes its export down with it, and that
      // must not hide a good recording.
      const successful = Boolean(file && Number(file.size) > 0);
      if (info.error) console.warn(`Egress ${info.egressId} ended with: ${info.error}`);

      // The file's own media start and length, not when this app asked for the
      // egress or when this webhook arrived: playback lines screen shares up
      // against the lesson audio with these, so they need to be exact. Values
      // are unix nanoseconds; the tsconfig target predates BigInt literals.
      const startNanos = Number(file?.startedAt ?? 0) || Number(info.startedAt);
      const startedAtMs = startNanos > 0 ? startNanos / 1_000_000 : undefined;
      const durationMs = Number(file?.duration ?? 0) / 1_000_000;
      const startedAt = startedAtMs ? new Date(startedAtMs).toISOString() : undefined;
      const endedAt =
        startedAtMs && durationMs > 0 ? new Date(startedAtMs + durationMs).toISOString() : new Date().toISOString();

      const { error } = await admin
        .from("session_recordings")
        .update({
          status: successful ? "ready" : "failed",
          ended_at: endedAt,
          ...(startedAt ? { started_at: startedAt } : {}),
          // The path LiveKit actually wrote. For a passthrough screen share
          // LiveKit chooses the container, so the extension we asked for is
          // only a guess; playback must point at the real file.
          ...(file?.filename ? { storage_path: file.filename } : {}),
        })
        .eq("egress_id", info.egressId);
      if (error) throw error;
      return new Response("ok");
    }

    if (event.event === "track_published" || event.event === "track_unpublished") {
      const track = event.track;
      if (!track?.sid || track.type !== TrackType.VIDEO || track.source !== TrackSource.SCREEN_SHARE) {
        return new Response("ok");
      }
      if (event.event === "track_unpublished") {
        await stopScreenRecording(track.sid);
        return new Response("ok");
      }

      const roomName = event.room?.name;
      const bookingId = bookingIdFromRoom(roomName);
      if (!roomName || !bookingId) return new Response("ok");

      const { data: booking } = await createAdminClient()
        .from("bookings")
        .select("id, tutor_id, status")
        .eq("id", bookingId)
        .maybeSingle();
      // Only the tutor's shares are recorded. A track_published payload has no
      // token metadata, so the booking decides who the tutor is.
      if (!booking || booking.status !== "scheduled" || booking.tutor_id !== event.participant?.identity) {
        return new Response("ok");
      }

      const mimeType = track.mimeType || track.codecs[0]?.mimeType || "";
      await startScreenRecording(bookingId, roomName, track.sid, mimeType);
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

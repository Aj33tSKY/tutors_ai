// The actual per-session agent logic. Deliberately never imported at the
// top level by anything — src/agent.ts hands the framework this file's path
// as a plain string, and the framework dynamically imports it per job. That
// matters here specifically because @livekit/agents-plugin-deepgram reads
// process.env.DEEPGRAM_API_KEY into a module-level default object the
// moment it's imported: if this file were a normal top-level import of
// agent.ts, that read would happen before agent.ts's own env-loading code
// ever got a chance to run (ESM imports are hoisted above everything else
// in the importing module). Dynamic, path-based loading sidesteps that —
// see agent.ts.
import { type JobContext, defineAgent, AutoSubscribe, stt } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import {
  RoomEvent,
  TrackKind,
  AudioStream,
  type RemoteParticipant,
  type RemoteTrack,
} from "@livekit/rtc-node";
import { createClient } from "@supabase/supabase-js";

interface TranscriptLine {
  role: "student" | "tutor";
  name: string;
  text: string;
  timestamp: string;
}

/**
 * Deepgram emits a FINAL_TRANSCRIPT whenever it detects a natural pause. That
 * is a transport-level utterance boundary, not necessarily a conversational
 * turn, so preserve a new line only when the speaker actually changes.
 */
function formatTranscript(lines: TranscriptLine[]): string {
  const turns: TranscriptLine[] = [];

  for (const line of lines) {
    const previous = turns.at(-1);
    if (previous?.role === line.role) {
      previous.text = `${previous.text} ${line.text}`;
      previous.timestamp = line.timestamp;
    } else {
      turns.push({ ...line });
    }
  }

  return turns
    .map((line) => `[${line.role === "tutor" ? "Tutor" : "Student"}] ${line.text}`)
    .join("\n");
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Room names are `booking-<uuid>`, minted in src/lib/livekit.ts of the main app. */
function bookingIdFromRoomName(roomName: string): string | null {
  const match = roomName.match(/^booking-(.+)$/);
  return match?.[1] ?? null;
}

function participantRole(participant: RemoteParticipant): "student" | "tutor" {
  try {
    const meta = participant.metadata ? JSON.parse(participant.metadata) : {};
    return meta.role === "tutor" ? "tutor" : "student";
  } catch {
    return "student";
  }
}

function isTutor(participant: RemoteParticipant): boolean {
  return participantRole(participant) === "tutor";
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    const bookingId = bookingIdFromRoomName(ctx.room.name ?? "");
    if (!bookingId) {
      console.warn(`Room "${ctx.room.name}" isn't a booking room — skipping transcription.`);
      return;
    }

    const transcript: TranscriptLine[] = [];
    const openStreams = new Map<string, stt.SpeechStream>();
    const streamTasks = new Map<string, Promise<void>>();

    async function transcribeTrack(track: RemoteTrack, participant: RemoteParticipant) {
      const sid = track.sid;
      if (!sid) return;

      const role = participantRole(participant);
      const name = participant.name || role;

      // Deepgram gets one stream per LiveKit track — the room already keeps
      // each speaker's audio on its own track, so we get speaker attribution
      // for free instead of relying on Deepgram's acoustic diarization.
      const speechStream = new deepgram.STT().stream();
      openStreams.set(sid, speechStream);

      const audioStream = new AudioStream(track, { sampleRate: 16000, numChannels: 1 });
      const pumpFrames = (async () => {
        for await (const frame of audioStream) {
          speechStream.pushFrame(frame);
        }
      })();

      try {
        for await (const event of speechStream) {
          if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
            const text = event.alternatives?.[0]?.text?.trim();
            if (text) {
              transcript.push({ role, name, text, timestamp: new Date().toISOString() });
            }
          }
        }
      } catch (err) {
        console.error(`Transcription stream failed for ${name} (${role}):`, err);
      } finally {
        openStreams.delete(sid);
        await pumpFrames.catch(() => {});
      }
    }

    ctx.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === TrackKind.KIND_AUDIO) {
        const task = transcribeTrack(track, participant).catch((err) => {
          console.error("Failed to start transcription for track:", err);
        });
        if (track.sid) streamTasks.set(track.sid, task);
        void task.finally(() => {
          if (track.sid && streamTasks.get(track.sid) === task) streamTasks.delete(track.sid);
        });
      }
    });

    ctx.room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.sid) openStreams.get(track.sid)?.close();
    });

    // The tutor controls the lesson lifecycle. When they leave, end this
    // per-room job even if the student remains connected in the waiting view.
    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (isTutor(participant)) {
        for (const stream of openStreams.values()) stream.close();
        ctx.shutdown("tutor left the session");
      }
    });

    ctx.addShutdownCallback(async () => {
      for (const stream of openStreams.values()) stream.close();
      await Promise.allSettled([...streamTasks.values()]);
      const supabase = supabaseAdmin();
      if (transcript.length === 0) return;

      transcript.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const fullTranscript = formatTranscript(transcript);

      // Leaving a room is not the same as completing a lesson: either person
      // might briefly reconnect or the tutor may run late. Keep the booking
      // scheduled until the tutor explicitly completes it, and append a
      // reconnect's transcript rather than replacing the first attempt.
      const { data: existing } = await supabase
        .from("session_analytics")
        .select("full_transcript")
        .eq("booking_id", bookingId)
        .maybeSingle();
      const combinedTranscript = existing?.full_transcript
        ? `${existing.full_transcript}\n${fullTranscript}`
        : fullTranscript;

      const { error } = await supabase
        .from("session_analytics")
        .upsert({ booking_id: bookingId, full_transcript: combinedTranscript }, { onConflict: "booking_id" });

      if (error) {
        console.error(`Failed to save transcript for booking ${bookingId}:`, error);
      } else {
        console.log(`Saved transcript for booking ${bookingId} (${transcript.length} lines).`);
      }
    });

    // Explicit dispatch is asynchronous: the tutor can leave between the
    // webhook firing and this worker connecting. Do not leave a transcription
    // job attached to a student-only room in that case.
    const tutorAlreadyPresent = [...ctx.room.remoteParticipants.values()].some(isTutor);
    if (!tutorAlreadyPresent) {
      ctx.shutdown("tutor is no longer in the session");
    }
  },
});

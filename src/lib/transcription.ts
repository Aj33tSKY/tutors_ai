import "server-only";

export type SpeakerRole = "student" | "tutor";

export type RoleTurn = {
  role: SpeakerRole;
  /** Seconds from the start of the recording. */
  start: number;
  text: string;
};

const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";

/** Shared between the transcribe-sessions cron and the booking review page, which needs to know when a recording has given up retrying. */
export const MAX_TRANSCRIBE_ATTEMPTS = 3;

// The LiveKit webhook's AudioRoute pins the tutor's track to the left
// channel and the student's to the right — standard interleaved-stereo
// convention puts the left channel at index 0, and Deepgram's multichannel
// response numbers channels the same way.
const TUTOR_CHANNEL = 0;

/**
 * Transcribes the booking's single stereo recording with Deepgram's
 * prerecorded API. multichannel transcribes each channel independently, so
 * speaker attribution comes from which channel a line is on, not acoustic
 * diarization — diarize is deliberately not combined with multichannel here,
 * since each channel already has exactly one speaker.
 *
 * Deepgram fetches the audio itself from a signed URL, so the recording
 * never passes through this function — which keeps it well inside a
 * serverless function's memory and body limits.
 */
export async function transcribeStereoRecording(signedUrl: string): Promise<RoleTurn[]> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not configured");

  const params = new URLSearchParams({
    // Overridable so a model rename does not need a redeploy to recover from.
    model: process.env.DEEPGRAM_MODEL || "nova-3",
    language: "en",
    smart_format: "true",
    punctuate: "true",
    multichannel: "true",
    // Utterance boundaries are what let each channel's lines be merged back
    // into turns; Deepgram returns them already in one chronological order
    // across both channels.
    utterances: "true",
  });

  const response = await fetch(`${DEEPGRAM_ENDPOINT}?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: signedUrl }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Deepgram returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    results?: {
      utterances?: { channel?: number; start?: number; transcript?: string }[];
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };

  const utterances = payload.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances
      .map((utterance) => ({
        role: (utterance.channel === TUTOR_CHANNEL ? "tutor" : "student") as SpeakerRole,
        start: typeof utterance.start === "number" ? utterance.start : 0,
        text: (utterance.transcript ?? "").trim(),
      }))
      .filter((turn) => turn.text.length > 0);
  }

  // Deepgram omits utterances when it found no speech boundaries on a
  // channel. Fall back to each channel's flat transcript so a quiet
  // participant still contributes their words, just as one turn each.
  const channels = payload.results?.channels ?? [];
  return channels
    .map((channel, index) => ({
      role: (index === TUTOR_CHANNEL ? "tutor" : "student") as SpeakerRole,
      start: 0,
      text: channel.alternatives?.[0]?.transcript?.trim() ?? "",
    }))
    .filter((turn) => turn.text.length > 0);
}

/** mm:ss, or h:mm:ss past an hour — same convention as the session player's own clock (lesson-player.tsx). */
function clockLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Renders the canonical transcript format: one "[Tutor MM:SS] ..." /
 * "[Student MM:SS] ..." line per turn, with consecutive utterances from the
 * same speaker merged into that turn (the merged line's timestamp is its
 * first utterance's). The timestamp lets summarize-sessions cite evidence
 * in its generated notes against a specific moment.
 *
 * `offsetSeconds` places a resumed session's second (or later) recording
 * segment on the same clock as the first, rather than restarting at 0 — see
 * transcribe-sessions, which passes each segment's own start time relative
 * to the booking's.
 *
 * The format is what `talkRatio` and `consolidateTranscriptTurns` in the
 * summarize-sessions cron already parse, so it must not drift from theirs.
 */
export function formatTranscript(turns: RoleTurn[], offsetSeconds = 0): string {
  const sorted = [...turns].sort((a, b) => a.start - b.start);

  const out: { role: SpeakerRole; start: number; text: string }[] = [];
  for (const turn of sorted) {
    const previous = out.at(-1);
    if (previous?.role === turn.role) {
      previous.text = `${previous.text} ${turn.text}`;
    } else {
      out.push({ role: turn.role, start: turn.start, text: turn.text });
    }
  }

  return out
    .map(
      (turn) =>
        `[${turn.role === "tutor" ? "Tutor" : "Student"} ${clockLabel(offsetSeconds + turn.start)}] ${turn.text}`,
    )
    .join("\n");
}

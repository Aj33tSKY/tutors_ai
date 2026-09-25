import "server-only";

export type SpeakerRole = "student" | "tutor";

export type Utterance = {
  /** Seconds from the start of the audio file this utterance came from. */
  start: number;
  text: string;
};

export type SpeakerSegment = {
  role: SpeakerRole;
  /** Seconds this file started after the first file in the session. */
  offsetSeconds: number;
  utterances: Utterance[];
};

const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";

/**
 * Transcribes one participant's audio with Deepgram's prerecorded API.
 *
 * Deepgram fetches the audio itself from a signed URL, so a full lesson's audio
 * never passes through this function — which keeps it well inside a serverless
 * function's memory and body limits.
 */
export async function transcribeRemoteAudio(signedUrl: string): Promise<Utterance[]> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not configured");

  const params = new URLSearchParams({
    // Overridable so a model rename does not need a redeploy to recover from.
    model: process.env.DEEPGRAM_MODEL || "nova-3",
    language: "en",
    smart_format: "true",
    punctuate: "true",
    // Utterance boundaries carry the timestamps used to interleave speakers.
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
      utterances?: { start?: number; transcript?: string }[];
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };

  const utterances = payload.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances
      .map((utterance) => ({
        start: typeof utterance.start === "number" ? utterance.start : 0,
        text: (utterance.transcript ?? "").trim(),
      }))
      .filter((utterance) => utterance.text.length > 0);
  }

  // Deepgram omits utterances when it found no speech boundaries. Fall back to
  // the flat transcript so a quiet participant still contributes their words.
  const flat = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
  return flat ? [{ start: 0, text: flat }] : [];
}

/**
 * Interleaves each participant's utterances onto one timeline and renders the
 * canonical transcript format: one "[Tutor] ..." / "[Student] ..." line per turn,
 * with consecutive utterances from the same speaker merged into that turn.
 *
 * The format is what `talkRatio` and `consolidateTranscriptTurns` in the
 * summarize-sessions cron already parse, so it must not drift from theirs.
 */
export function formatTranscript(segments: SpeakerSegment[]): string {
  const lines = segments
    .flatMap((segment) =>
      segment.utterances.map((utterance) => ({
        role: segment.role,
        at: segment.offsetSeconds + utterance.start,
        text: utterance.text,
      })),
    )
    .sort((a, b) => a.at - b.at);

  const turns: { role: SpeakerRole; text: string }[] = [];
  for (const line of lines) {
    const previous = turns.at(-1);
    if (previous?.role === line.role) {
      previous.text = `${previous.text} ${line.text}`;
    } else {
      turns.push({ role: line.role, text: line.text });
    }
  }

  return turns
    .map((turn) => `[${turn.role === "tutor" ? "Tutor" : "Student"}] ${turn.text}`)
    .join("\n");
}

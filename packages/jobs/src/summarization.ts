import { embedMany, generateText, Output } from "ai";
import { z } from "zod";
import type { Pool } from "pg";

const CHUNK_LINES = 6;
const SummarySchema = z.object({
  sessionGoals: z.string().describe("What this session aimed to cover or achieve, inferred from how it opened and its context"),
  whatWeCovered: z.string().describe("What was actually covered and achieved in the session"),
  whatWentWell: z.string().describe("Teaching approaches, explanations or activities that worked well"),
  areasForImprovement: z.string().describe("Where the student struggled, or the session hit difficulty"),
  learningInsights: z.string().describe("Any preference or recurring pattern in how the student learns or responds, noticed in this session"),
  keyBreakthrough: z.string().describe("A specific breakthrough, win or moment of real understanding, if there was one"),
  nextSteps: z.string().describe("What should happen next — follow-up actions, homework, or what to focus on next session"),
});

// Sessions summarized under an earlier field shape remain valid and can
// still have their embeddings repaired without spending another model call.
const ExistingSummarySchema = SummarySchema.partial();

/**
 * A session needs (re)summarizing only when it has never been summarized at
 * all — a brand new session, or one explicitly reset by
 * markSessionUpcomingAction, which nulls summary_notes/notes_markdown
 * together for exactly this reason. A schema change (new field names, an
 * added field) must never retroactively rewrite sessions that already have
 * a summary, however old its shape: do that and the next cron run
 * regenerates every previously-summarized session's notes and spends an LLM
 * call doing it, which really happened once already. Any existing summary,
 * in whatever shape, is left alone; formatSessionNotesMarkdown's fallback
 * handles rendering it.
 */


/**
 * Backfill older transcripts that saved one Deepgram utterance per line.
 * This also runs against every already-correct transcript, to decide
 * whether it needs rewriting at all (see needsTranscriptNormalization
 * below) — the optional " MM:SS"/" H:MM:SS" group is what makes that a
 * no-op for current transcripts rather than quietly stripping every line's
 * timestamp the next time this processes them.
 */
function consolidateTranscriptTurns(transcript: string): string {
  const turns: { speaker: string; time: string; text: string }[] = [];

  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^\[(Tutor|Student)(\s+\d{1,2}:\d{2}(?::\d{2})?)?\]\s*(.+)$/);
    if (!match) {
      turns.push({ speaker: "", time: "", text: line });
      continue;
    }

    const speaker = match[1];
    const time = match[2] ?? "";
    const text = match[3].trim();
    const previous = turns.at(-1);
    if (previous?.speaker === speaker) {
      // Keep the earlier turn's own timestamp — it marks when the (now
      // merged) turn began, same convention as formatTranscript's.
      previous.text = `${previous.text} ${text}`;
    } else {
      turns.push({ speaker, time, text });
    }
  }

  return turns.map((turn) => (turn.speaker ? `[${turn.speaker}${turn.time}] ${turn.text}` : turn.text)).join("\n");
}

/** Transcript lines are "[Tutor] ..." / "[Student] ...", written by the transcribe-sessions cron. */
function talkRatio(transcript: string): number | null {
  let tutorWords = 0;
  let studentWords = 0;
  for (const line of transcript.split("\n")) {
    // The optional " MM:SS" (or " H:MM:SS") covers formatTranscript's
    // current "[Tutor 00:02] ..." lines; the bare "[Tutor] ..." form still
    // matches too, for transcripts saved before timestamps were added.
    const match = line.match(/^\[(Tutor|Student)(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\]\s*(.*)$/);
    if (!match) continue;
    const words = match[2].trim().split(/\s+/).filter(Boolean).length;
    if (match[1] === "Tutor") tutorWords += words;
    else studentWords += words;
  }
  const total = tutorWords + studentWords;
  return total === 0 ? null : Math.round((tutorWords / total) * 100) / 100;
}

function chunkTranscript(transcript: string, linesPerChunk = CHUNK_LINES): string[] {
  const lines = transcript.split("\n").filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    chunks.push(lines.slice(i, i + linesPerChunk).join("\n"));
  }
  return chunks;
}


export function formatSessionNotesMarkdown(summary: Record<string, string | undefined>): string {
  // "N/A" matches what the model itself is asked to write for a field that
  // doesn't apply — one convention, not two different phrasings, for the
  // same case: whether the model wrote it or this is a genuinely missing
  // field (parsing an older or unexpected shape), the fallback agrees.
  const section = (heading: string, text: string | undefined) => `## ${heading}\n\n${text?.trim() || "N/A"}`;

  return [
    section("Session Goals", summary.sessionGoals),
    section("What We Covered", summary.whatWeCovered),
    section("What Went Well", summary.whatWentWell),
    section("Areas for Improvement", summary.areasForImprovement),
    section("Learning Insights", summary.learningInsights),
    section("Key Breakthrough", summary.keyBreakthrough),
    section("Next Steps", summary.nextSteps),
  ].join("\n\n");
}

const summaryClaim = z.object({ id: z.uuid(), token: z.uuid(), transcript: z.string().min(1), summary: z.unknown(), subject: z.string(), examBoard: z.string() });
export async function generateLessonSummary(input: z.infer<typeof summaryClaim>) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is required outside Vercel");
  const transcript = consolidateTranscriptTurns(input.transcript);
  const subjectLabel = input.subject.replaceAll("_", " ");
  const boardLabel = input.examBoard.replaceAll("_", " ");
  const summary = input.summary == null ? (await generateText({
    model: "openai/gpt-5.4-nano", output: Output.object({ schema: SummarySchema }),
    abortSignal: AbortSignal.timeout(120_000),
    system: `You are a UK A-Level ${subjectLabel} tutor writing your own private reflection notes on a session you just taught, for the ${boardLabel} exam board, based on its transcript. Write each field as one to three short, factual sentences in your own voice, grounded only in what the transcript actually shows — never invent content to fill a field. When a field genuinely doesn't apply (no clear breakthrough, no particular pattern noticed), write exactly "N/A" for that field and nothing else — don't spend a sentence explaining why it doesn't apply. This applies even when the call is only an introduction, a product test, or has no substantive syllabus content.

Each transcript line is tagged "[Tutor MM:SS]" or "[Student MM:SS]" with when it happened. When a field makes a specific, checkable claim about what someone said or did (not a general impression), cite the timestamp of the line it's drawn from in square brackets at the end of that sentence, e.g. "Jayden solved one problem independently and needed one prompt on the second. [17:28]". Cite only timestamps that actually appear in the transcript, and only for claims concrete enough to point at one moment — don't force a citation onto a general summary sentence.`,
    prompt: transcript,
  })).output : ExistingSummarySchema.parse(input.summary);
  const contents = chunkTranscript(transcript);
  const { embeddings } = await embedMany({ model: "google/text-embedding-005", values: contents, abortSignal: AbortSignal.timeout(120_000) });
  if (embeddings.length !== contents.length || embeddings.some((v) => v.length !== 768 || v.some((n) => !Number.isFinite(n)))) throw new Error("Invalid embedding response");
  return { summary, notes: formatSessionNotesMarkdown(summary), ratio: talkRatio(transcript),
    chunks: contents.map((content, i) => ({ content, embedding: embeddings[i] })) };
}
export async function summarizeLesson(pool: Pool, bookingId: string, generate = generateLessonSummary) {
  const result = await pool.query("select private.lesson_summary_claim($1) as claim", [bookingId]);
  if (!result.rows[0]?.claim) return;
  const input = summaryClaim.parse(result.rows[0].claim);
  try {
    const output = await generate(input);
    const published = await pool.query("select private.lesson_summary_publish($1,$2,$3,$4,$5,$6,$7,$8) as saved",
      [input.id, input.token, input.transcript, input.summary == null ? null : JSON.stringify(input.summary), JSON.stringify(output.summary), output.notes, output.ratio, JSON.stringify(output.chunks)]);
    if (!published.rows[0]?.saved) throw new Error("Summary input changed or lease lost");
  } catch (error) {
    await pool.query("select private.lesson_summary_release($1,$2)", [input.id, input.token]);
    throw error;
  }
}

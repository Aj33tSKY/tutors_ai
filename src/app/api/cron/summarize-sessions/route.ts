import { embedMany, generateText, Output } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronRequest } from "@/lib/cron";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import { formatSessionNotesMarkdown } from "@/lib/session-notes";
import type { Booking, ExamBoard, SessionAnalytics, StemSubject } from "@/lib/types";

export const maxDuration = 300;

// Kept small: each run does real LLM + embedding work per booking, and Vercel
// Cron re-runs this on a schedule anyway — a straggler just gets picked up
// next tick rather than needing to fit in one giant batch.
const BATCH_SIZE = 5;
const CHUNK_LINES = 6; // transcript lines per embedding chunk

// Seven short, factual fields rather than free paragraphs — cheap for the
// model to produce reliably every time (a fixed schema beats hoping a
// free-form prompt reliably reproduces the same seven headings) and cheap
// to turn into markdown afterwards, with zero extra model cost: see
// formatSessionNotesMarkdown, which just maps each field onto its own
// heading. The tutor only ever edits the resulting markdown, never this
// shape directly.
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
function summaryNeedsRefresh(summary: unknown): boolean {
  return summary === null || summary === undefined;
}

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

type PendingRow = {
  booking: Pick<Booking, "id" | "student_id" | "subject" | "exam_board">;
  analytics: Pick<SessionAnalytics, "id" | "full_transcript" | "summary_notes" | "notes_markdown"> & {
    full_transcript: string;
  };
  needsSummary: boolean;
  needsTranscriptNormalization: boolean;
};

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();

  // Filtering a joined table's column isn't reliable through the query
  // builder here, so fetch recent completed bookings and filter for
  // "has a transcript, no summary yet" in application code instead.
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, student_id, subject, exam_board, session_analytics(id, full_transcript, summary_notes, notes_markdown)")
    .eq("status", "completed")
    .order("start_time", { ascending: false })
    .limit(50);

  if (error) {
    console.error("summarize-sessions: failed to load bookings:", error);
    return new Response("Failed to load bookings", { status: 500 });
  }

  const embeddingBookingIds = (bookings ?? []).map((booking) => booking.id);
  const { data: embeddingRows, error: embeddingLookupError } = embeddingBookingIds.length
    ? await supabase.from("session_embeddings").select("booking_id").in("booking_id", embeddingBookingIds)
    : { data: [], error: null };

  if (embeddingLookupError) {
    console.error("summarize-sessions: failed to load embedding state:", embeddingLookupError);
    return new Response("Failed to load embedding state", { status: 500 });
  }

  const bookingsWithEmbeddings = new Set((embeddingRows ?? []).map((row) => row.booking_id));
  const pending: PendingRow[] = [];
  for (const b of bookings ?? []) {
    const analytics = Array.isArray(b.session_analytics) ? b.session_analytics[0] : b.session_analytics;
    const needsSummary = summaryNeedsRefresh(analytics?.summary_notes);
    const needsTranscriptNormalization = Boolean(
      analytics?.full_transcript &&
        consolidateTranscriptTurns(analytics.full_transcript) !== analytics.full_transcript,
    );
    // A previous run may have written the summary but failed while inserting
    // embeddings. Pick it up again: the chat must never remain ungrounded
    // merely because that second API call was transiently unavailable.
    const needsEmbeddings = !bookingsWithEmbeddings.has(b.id);
    if (analytics?.full_transcript && (needsSummary || needsEmbeddings || needsTranscriptNormalization)) {
      pending.push({
        booking: b,
        analytics: analytics as PendingRow["analytics"],
        needsSummary,
        needsTranscriptNormalization,
      });
    }
    if (pending.length >= BATCH_SIZE) break;
  }

  const results: { bookingId: string; status: string }[] = [];

  for (const { booking, analytics, needsSummary, needsTranscriptNormalization } of pending) {
    try {
      const subject = booking.subject as StemSubject;
      const examBoard = booking.exam_board as ExamBoard;
      const transcript = consolidateTranscriptTurns(analytics.full_transcript!);

      const summary = needsSummary
        ? (
            await generateText({
              model: "openai/gpt-5.4-nano",
              output: Output.object({ schema: SummarySchema }),
              system: `You are a UK A-Level ${subjectLabel(subject)} tutor writing your own private reflection notes on a session you just taught, for the ${boardLabel(examBoard)} exam board, based on its transcript. Write each field as one to three short, factual sentences in your own voice, grounded only in what the transcript actually shows — never invent content to fill a field. When a field genuinely doesn't apply (no clear breakthrough, no particular pattern noticed), write exactly "N/A" for that field and nothing else — don't spend a sentence explaining why it doesn't apply. This applies even when the call is only an introduction, a product test, or has no substantive syllabus content.

Each transcript line is tagged "[Tutor MM:SS]" or "[Student MM:SS]" with when it happened. When a field makes a specific, checkable claim about what someone said or did (not a general impression), cite the timestamp of the line it's drawn from in square brackets at the end of that sentence, e.g. "Jayden solved one problem independently and needed one prompt on the second. [17:28]". Cite only timestamps that actually appear in the transcript, and only for claims concrete enough to point at one moment — don't force a citation onto a general summary sentence.`,
              prompt: transcript,
            })
          ).output
        : ExistingSummarySchema.parse(analytics.summary_notes);

      const chunks = chunkTranscript(transcript);
      if (chunks.length > 0) {
        // Same story as the chat route's model choice: openai/text-embedding-3-small
        // (matching session_embeddings' original vector(1536) sizing) needs paid
        // Gateway credits this account doesn't have yet. google/text-embedding-005
        // works on the free tier — 768 dims, which is what the column is sized for now.
        const { embeddings } = await embedMany({
          model: "google/text-embedding-005",
          values: chunks,
        });

        // Re-processing a booking (e.g. after a manual summary_notes reset)
        // would otherwise duplicate embeddings — clear this booking's own
        // rows first, never another booking's.
        const { error: deleteError } = await supabase
          .from("session_embeddings")
          .delete()
          .eq("booking_id", booking.id);
        if (deleteError) throw deleteError;

        const embeddingRows = chunks.map((content, i) => ({
          booking_id: booking.id,
          student_id: booking.student_id,
          content,
          topic: subjectLabel(subject),
          embedding: embeddings[i],
        }));

        const { error: embedError } = await supabase.from("session_embeddings").insert(embeddingRows);
        if (embedError) throw embedError;
      }

      // This is deliberately last. A summary is the completion marker used by
      // the scheduler, so committing it before embeddings can strand a session
      // with no retrieval context after a transient embedding failure.
      if (needsSummary || needsTranscriptNormalization) {
        const { error: updateError } = await supabase
          .from("session_analytics")
          .update({
            full_transcript: transcript,
            ...(needsSummary
              ? {
                  summary_notes: summary,
                  talk_ratio: talkRatio(transcript),
                  // Never clobber a tutor's saved edits — only seed this the
                  // first time (or after an explicit reset, which nulls it
                  // alongside summary_notes; see markSessionUpcomingAction).
                  ...(analytics.notes_markdown ? {} : { notes_markdown: formatSessionNotesMarkdown(summary) }),
                }
              : {}),
          })
          .eq("id", analytics.id);
        if (updateError) throw updateError;
      }

      results.push({ bookingId: booking.id, status: "summarized" });
    } catch (err) {
      console.error(`summarize-sessions: failed for booking ${booking.id}:`, err);
      results.push({ bookingId: booking.id, status: "failed" });
    }
  }

  return Response.json({ processed: results.length, results });
}

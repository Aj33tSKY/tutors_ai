import { embedMany, generateObject } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCronRequest } from "@/lib/cron";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import type { Booking, ExamBoard, SessionAnalytics, StemSubject } from "@/lib/types";

export const maxDuration = 300;

// Kept small: each run does real LLM + embedding work per booking, and Vercel
// Cron re-runs this on a schedule anyway — a straggler just gets picked up
// next tick rather than needing to fit in one giant batch.
const BATCH_SIZE = 5;
const CHUNK_LINES = 6; // transcript lines per embedding chunk

const SummarySchema = z.object({
  overview: z
    .string()
    .describe("A concise, factual 2–4 sentence account of what happened in this session"),
  covered_topics: z
    .array(
      z.object({
        spec_point: z
          .string()
          .describe("Best-effort exam board spec point reference, e.g. 'Edexcel Physics 4.2'"),
        title: z.string().describe("Short topic title, e.g. 'Particle Accelerators'"),
      }),
    )
    .describe("Distinct syllabus topics actually covered in this session"),
  misconceptions: z
    .array(z.string())
    .describe("Specific misconceptions or knowledge gaps the student showed, if any"),
  homework: z
    .array(z.string())
    .describe("Homework or follow-up action items assigned or implied, if any"),
});

// Sessions summarized before `overview` was introduced remain valid and can
// still have their embeddings repaired without spending another model call.
const ExistingSummarySchema = SummarySchema.extend({ overview: z.string().optional() });

function summaryNeedsRefresh(summary: unknown): boolean {
  if (!summary || typeof summary !== "object") return true;
  const overview = (summary as { overview?: unknown }).overview;
  return typeof overview !== "string" || overview.trim().length === 0;
}

/** Backfill older transcripts that saved one Deepgram utterance per line. */
function consolidateTranscriptTurns(transcript: string): string {
  const turns: { speaker: string; text: string }[] = [];

  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^\[(Tutor|Student)\]\s*(.+)$/);
    if (!match) {
      turns.push({ speaker: "", text: line });
      continue;
    }

    const speaker = match[1];
    const text = match[2].trim();
    const previous = turns.at(-1);
    if (previous?.speaker === speaker) {
      previous.text = `${previous.text} ${text}`;
    } else {
      turns.push({ speaker, text });
    }
  }

  return turns.map((turn) => (turn.speaker ? `[${turn.speaker}] ${turn.text}` : turn.text)).join("\n");
}

/** Transcript lines are "[Tutor] ..." / "[Student] ...", written by the transcribe-sessions cron. */
function talkRatio(transcript: string): number | null {
  let tutorWords = 0;
  let studentWords = 0;
  for (const line of transcript.split("\n")) {
    const match = line.match(/^\[(Tutor|Student)\]\s*(.*)$/);
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
  analytics: Pick<SessionAnalytics, "id" | "full_transcript" | "summary_notes"> & {
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
    .select("id, student_id, subject, exam_board, session_analytics(id, full_transcript, summary_notes)")
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
            await generateObject({
              model: "openai/gpt-5.4-nano",
              schema: SummarySchema,
              system: `You are analysing a transcript of a UK A-Level ${subjectLabel(subject)} tutoring session for the ${boardLabel(examBoard)} exam board. Always write a short, factual overview of what took place, even when the call is only an introduction, product test, or has no substantive syllabus content. Map topics onto real ${boardLabel(examBoard)} ${subjectLabel(subject)} specification points where you can, but never invent a spec point number you're not reasonably confident about — a plausible topic title alone is fine when unsure. Only report misconceptions and homework that are actually evidenced in the transcript; leave those arrays empty rather than guessing.`,
              prompt: transcript,
            })
          ).object
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
          topic: summary.covered_topics[0]?.title ?? subjectLabel(subject),
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
            ...(needsSummary ? { summary_notes: summary, talk_ratio: talkRatio(transcript) } : {}),
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

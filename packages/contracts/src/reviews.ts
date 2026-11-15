import { z } from "zod";
import type { Booking, SessionAnalytics } from "./models.js";
export type ReviewBooking = Pick<Booking, "id" | "tutor_id" | "student_id" | "subject" | "exam_board" | "lesson_name" | "start_time" | "started_at" | "is_trial" | "payment_status">;
export type ScreenSegment = { id: string; src: string; type: "video/mp4" | "video/webm"; startMs: number; endMs: number };
export type AudioPlayer = { id: string; path: string; startedAt: string; endedAt: string | null; url: string | null };
export type SessionReview = { booking: ReviewBooking; analytics: Pick<SessionAnalytics, "full_transcript" | "summary_notes" | "notes_markdown"> | null;
  analyticsError: boolean; audioPlayers: AudioPlayer[]; screenSegments: ScreenSegment[]; hasPendingRecordings: boolean;
  transcriptPending: boolean; canEditNotes: boolean };
export const notesInput = z.object({ notesMarkdown: z.string().max(20000) }).strict();

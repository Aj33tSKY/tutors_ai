import { z } from "zod";
import { EXAM_BOARDS, SUBJECTS } from "./subjects";
import type { ExamBoard, StemSubject } from "./models";

export const PRICE_BANDS = [35, 45, 60] as const;
export const tutorQuery = z.object({
  subject: z.enum(SUBJECTS.map((s) => s.value) as [StemSubject, ...StemSubject[]]).optional().catch(undefined),
  board: z.enum(EXAM_BOARDS.map((b) => b.value) as [ExamBoard, ...ExamBoard[]]).optional().catch(undefined),
  maxPrice: z.coerce.number().refine((n) => (PRICE_BANDS as readonly number[]).includes(n)).optional().catch(undefined),
  day: z.coerce.number().int().min(0).max(6).optional().catch(undefined),
});
export type TutorQuery = z.infer<typeof tutorQuery>;
/** Everything the public pages show. Never includes contact details, ids of other accounts or rates in pence ambiguity. */
export type PublicTutor = {
  id: string; fullName: string; avatarUrl: string | null; headline: string | null; bio: string | null;
  subjects: StemSubject[]; boards: ExamBoard[]; hourlyRatePence: number; yearsExperience: number | null; availableDays: number[];
};
/** `approved` ignores filters, so a page can tell "nobody yet" from "nothing matches". */
export type TutorCatalogue = { tutors: PublicTutor[]; total: number; approved: number };
export type OpenSlots = { slots: string[] };
export const lessonRequestInput = z.object({
  subject: z.enum(SUBJECTS.map((s) => s.value) as [StemSubject, ...StemSubject[]]),
  examBoard: z.enum(EXAM_BOARDS.map((b) => b.value) as [ExamBoard, ...ExamBoard[]]),
  startTime: z.iso.datetime({ offset: true }),
}).strict();
export type LessonRequestResult = { requestId: string; isTrial: boolean; duplicate: boolean };

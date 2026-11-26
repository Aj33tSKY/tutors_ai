import { z } from "zod";

export const availabilityInput = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict().refine((input) => input.startTime < input.endTime, { message: "End time must follow start time" });
export type AvailabilitySlot = { id: string; tutor_id: string; day_of_week: number; start_time: string; end_time: string };
export type Contact = { id: string; fullName: string; email: string; sessionCount: number };
export type PendingTutor = { id: string; hourly_rate: number; dbs_verified: boolean; subjects: string[];
  profiles: { full_name: string; email: string } | { full_name: string; email: string }[] };
export type AdminOverview = { profileCount: number; bookingCount: number; pendingTutors: PendingTutor[] };
export const tutorApproval = z.object({ evidenceNote: z.string().trim().min(20).max(1000), confirmed: z.literal(true) }).strict();

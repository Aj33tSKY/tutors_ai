import { z } from "zod";

export const uuid = z.uuid();
export const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });
export const signup = credentials.extend({ password: z.string().min(8).max(256), fullName: z.string().trim().min(1).max(150), role: z.enum(["student", "parent", "tutor"]) });
export const resetRequest = z.object({ email: z.email().max(254) });
export const passwordUpdate = z.object({ password: z.string().min(8).max(256) });
export const authCode = z.object({ code: z.string().min(1).max(4096) });
export const renameBooking = z.object({ lessonName: z.string().trim().max(120) });
export const calendarRange = z.object({ from: z.iso.datetime(), to: z.iso.datetime() }).refine(({ from, to }) => {
  const duration = Date.parse(to) - Date.parse(from);
  return duration > 0 && duration <= 190 * 86400000;
}, "Choose a range of at most 190 days");

export type ApiError = { error: { code: string; message: string; requestId: string } };
export type BookingSummary = {
  id: string; student_id: string; tutor_id: string; lesson_name: string | null;
  subject: string | null; start_time: string; end_time: string; status: string;
  payment_status: string; is_trial: boolean; started_at: string | null;
};

export type BookingDetail = { booking: BookingSummary; counterpartName: string; canRename: boolean };
export type Identity = { id: string; email: string; profile: { id: string; full_name: string; role: "student" | "parent" | "tutor" | "admin" } };

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { schedulingError } from "../../../../packages/domain/src/calendar";
import { AppError } from "../../../../packages/domain/src/errors";
const CreateSessionSchema = z.object({
  studentId: z.string().uuid(),
  lessonName: z.string().trim().min(1, "Enter a session name.").max(120),
  startTime: z.string().datetime({ local: true }),
  utcOffsetMinutes: z.coerce.number().int().min(-720).max(840),
  durationHours: z.coerce.number().int().min(1).max(3),
  scheduleType: z.enum(["single", "weekly"]),
  recurrenceCount: z.coerce.number().int().min(2).max(12),
});

export type CreateTutorSessionState = { error?: string; success?: boolean };

/** Create a tutor-added session after checking that the selected student is theirs. */
export async function createTutorSessionAction(
  _previous: CreateTutorSessionState,
  formData: FormData,
): Promise<CreateTutorSessionState> {
  const parsed = CreateSessionSchema.safeParse({
    studentId: formData.get("student_id"),
    lessonName: formData.get("lesson_name"),
    startTime: formData.get("start_time"),
    utcOffsetMinutes: formData.get("utc_offset_minutes"),
    durationHours: formData.get("duration_hours"),
    scheduleType: formData.get("schedule_type"),
    recurrenceCount: formData.get("recurrence_count"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the session details and try again." };

  // datetime-local deliberately has no timezone. The browser supplies the
  // offset for the selected date so 10:00 stays 10:00 in the tutor's locale.
  const localIso = parsed.data.startTime.length === 16 ? `${parsed.data.startTime}:00Z` : `${parsed.data.startTime}Z`;
  const start = new Date(Date.parse(localIso) - parsed.data.utcOffsetMinutes * 60_000);
  if (Number.isNaN(start.getTime()) || start.getMinutes() % 15 !== 0 || start.getSeconds() !== 0) {
    return { error: "Sessions must start on a 15-minute interval." };
  }
  if (start <= new Date()) return { error: "Choose a future date and time." };
  const supabase = await createClient();
  const result = await supabase.rpc("schedule_lessons_v1", {
    p_student_id: parsed.data.studentId, p_start: start.toISOString(), p_hours: parsed.data.durationHours,
    p_count: parsed.data.scheduleType === "weekly" ? parsed.data.recurrenceCount : 1,
    p_name: parsed.data.lessonName, p_request_id: null, p_command_id: crypto.randomUUID(),
  });
  try { schedulingError(result.error); }
  catch (error) { if (error instanceof AppError) return { error: error.message }; throw error; }
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

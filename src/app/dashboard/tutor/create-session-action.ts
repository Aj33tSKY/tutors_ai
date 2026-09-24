"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
  const durationMilliseconds = parsed.data.durationHours * 60 * 60 * 1000;
  const recurrenceCount = parsed.data.scheduleType === "weekly" ? parsed.data.recurrenceCount : 1;
  const sessionStarts = Array.from({ length: recurrenceCount }, (_, index) => new Date(start.getTime() + index * 7 * 24 * 60 * 60 * 1000));
  const lastEnd = new Date(sessionStarts.at(-1)!.getTime() + durationMilliseconds);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before creating a session." };

  // Verify both role and student relationship using the caller's RLS-scoped view
  // before intentionally using the service client for the insert.
  const [{ data: tutor }, { data: existingBookings }, { data: relatedRequest }] = await Promise.all([
    supabase.from("tutor_profiles").select("id, hourly_rate").eq("id", user.id).maybeSingle(),
    supabase.from("bookings").select("id, start_time").eq("tutor_id", user.id).eq("student_id", parsed.data.studentId).order("start_time", { ascending: false }),
    supabase.from("lesson_requests").select("id, subject, exam_board").eq("tutor_id", user.id).eq("student_id", parsed.data.studentId).eq("status", "pending").limit(1).maybeSingle(),
  ]);
  if (!tutor) return { error: "Only tutors can create sessions." };
  if (!existingBookings?.length && !relatedRequest) return { error: "Choose one of your students." };

  const admin = createAdminClient();
  const { data: possibleConflicts } = await admin
    .from("bookings")
    .select("id, start_time, end_time")
    .eq("tutor_id", user.id)
    .eq("status", "scheduled")
    .lt("start_time", lastEnd.toISOString())
    .gt("end_time", start.toISOString())
  const hasConflict = possibleConflicts?.some((booking) => sessionStarts.some((sessionStart) => {
    const sessionEnd = new Date(sessionStart.getTime() + durationMilliseconds);
    return sessionStart < new Date(booking.end_time) && sessionEnd > new Date(booking.start_time);
  }));
  if (hasConflict) return { error: "One or more sessions overlap with your existing calendar." };

  // A tutor-created first lesson follows the same free-trial rule as an
  // accepted student request. Subsequent lessons retain the rate snapshot.
  const isTrial = !existingBookings?.length;
  const linkedRequestId = isTrial ? relatedRequest?.id ?? null : null;
  const recurrenceSeriesId = recurrenceCount > 1 ? crypto.randomUUID() : null;
  const { data: createdSessions, error } = await admin.from("bookings").insert(sessionStarts.map((sessionStart, index) => ({
    student_id: parsed.data.studentId,
    tutor_id: user.id,
    // The initial request keeps subject/board context. Follow-up sessions are
    // intentionally tracked by their descriptive lesson name alone.
    subject: isTrial ? relatedRequest?.subject ?? null : null,
    exam_board: isTrial ? relatedRequest?.exam_board ?? null : null,
    lesson_name: parsed.data.lessonName,
    lesson_request_id: linkedRequestId,
    start_time: sessionStart.toISOString(),
    end_time: new Date(sessionStart.getTime() + durationMilliseconds).toISOString(),
    status: "scheduled",
    is_trial: isTrial && index === 0,
    payment_status: isTrial && index === 0 ? "paid" : "pending",
    amount_gbp_pence: isTrial && index === 0 ? 0 : tutor.hourly_rate,
    recurrence_rule: recurrenceCount > 1 ? `weekly:${recurrenceCount}` : null,
    recurrence_series_id: recurrenceSeriesId,
  }))).select("id");
  if (error) return { error: "We couldn’t create this session. Please try again." };
  if (linkedRequestId && createdSessions?.length) {
    await admin.from("lesson_requests").update({ status: "scheduled", responded_at: new Date().toISOString() }).eq("id", linkedRequestId).eq("tutor_id", user.id);
  }

  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

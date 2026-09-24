"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { subjectLabel } from "@/lib/subjects";
import type { Availability, ExamBoard, Profile, StemSubject } from "@/lib/types";

export interface BookingFormState { error?: string; success?: string; }

function isAvailable(day: number, time: string, slots: Availability[]) {
  const [hours, minutes] = time.split(":").map(Number);
  const end = `${String(Math.floor((hours * 60 + minutes + 60) / 60)).padStart(2, "0")}:${String((hours * 60 + minutes + 60) % 60).padStart(2, "0")}`;
  return slots.some((slot) => slot.day_of_week === day && time >= slot.start_time.slice(0, 5) && end <= slot.end_time.slice(0, 5));
}

export async function createLessonRequestAction(tutorId: string, _prev: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/tutors/${tutorId}`);
  const subject = String(formData.get("subject")) as StemSubject;
  const examBoard = String(formData.get("exam_board")) as ExamBoard;
  const [startValue, dayValue, time] = String(formData.get("requested_start")).split("|");
  const start = new Date(startValue);
  if (!subject || !examBoard || Number.isNaN(start.getTime()) || start <= new Date()) return { error: "Please choose a subject, exam board and an available future slot." };
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const [{ data: tutor }, { data: slots }, { data: existing }] = await Promise.all([
    supabase.from("tutor_profiles").select("id, subjects, boards").eq("id", tutorId).maybeSingle(),
    supabase.from("availability").select("*").eq("tutor_id", tutorId).returns<Availability[]>(),
    supabase.from("bookings").select("id").eq("tutor_id", tutorId).eq("start_time", start.toISOString()).eq("status", "scheduled").maybeSingle(),
  ]);
  if (!tutor || !(tutor.subjects as StemSubject[]).includes(subject) || !(tutor.boards as ExamBoard[]).includes(examBoard)) return { error: "That subject or exam board is no longer offered by this tutor." };
  if (!isAvailable(Number(dayValue), time, slots ?? []) || existing) return { error: "That slot is no longer available. Please choose another." };
  // A first lesson is per student–tutor pair, so a student does not get an
  // unlimited platform-wide trial while a rescheduled trial stays free.
  const [{ count: bookingCount }, { count: requestCount }] = await Promise.all([
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("tutor_id", tutorId).neq("status", "cancelled"),
    supabase.from("lesson_requests").select("id", { count: "exact", head: true }).eq("student_id", user.id).eq("tutor_id", tutorId).neq("status", "declined"),
  ]);
  const isTrial = (bookingCount ?? 0) === 0 && (requestCount ?? 0) === 0;
  const { data: request, error } = await supabase.from("lesson_requests").insert({ student_id: user.id, tutor_id: tutorId, subject, exam_board: examBoard, requested_start_time: start.toISOString(), requested_end_time: end.toISOString(), is_trial: isTrial }).select("id").single();
  if (error || !request) return { error: "We couldn't send that request. Please try again." };
  let { data: conversation } = await supabase.from("direct_conversations").select("id").eq("student_id", user.id).eq("tutor_id", tutorId).maybeSingle();
  if (!conversation) {
    const { data: created, error: conversationError } = await supabase.from("direct_conversations").insert({ student_id: user.id, tutor_id: tutorId }).select("id").single();
    if (conversationError || !created) return { error: "Your request was saved, but we couldn't open the tutor conversation." };
    conversation = created;
  }
  const { data: student } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle<Pick<Profile, "full_name">>();
  await supabase.from("direct_messages").insert({ conversation_id: conversation.id, sender_id: user.id, body: `New lesson request\n\nStudent: ${student?.full_name ?? "Student"}\nSubject: ${subjectLabel(subject)} · ${examBoard}\nRequested: ${start.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}\n${isTrial ? "Free trial lesson — no payment will be requested." : "Please accept and set the lesson time or recurring schedule."}` });
  await supabase.from("direct_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);
  revalidatePath("/dashboard/tutor");
  return { success: "Request sent. Your tutor will confirm the actual lesson time in messages." };
}

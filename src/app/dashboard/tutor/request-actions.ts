"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { subjectLabel } from "@/lib/subjects";
import type { LessonRequest } from "@/lib/types";

async function tutorRequest(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, request: null };
  const { data: request } = await supabase.from("lesson_requests").select("*").eq("id", id).eq("tutor_id", user.id).maybeSingle<LessonRequest>();
  return { supabase, user, request };
}

export async function declineLessonRequestAction(formData: FormData) {
  const id = String(formData.get("request_id"));
  const { supabase, request } = await tutorRequest(id);
  if (!request || request.status !== "pending") return;
  await supabase.from("lesson_requests").update({ status: "declined", responded_at: new Date().toISOString() }).eq("id", request.id);
  revalidatePath("/dashboard/tutor");
}

export async function scheduleLessonRequestAction(requestId: string, formData: FormData) {
  const { supabase, request } = await tutorRequest(requestId);
  if (!request || request.status !== "pending") redirect("/dashboard/tutor");
  const start = new Date(String(formData.get("start_time")));
  const recurrenceCount = Math.min(12, Math.max(1, Number(formData.get("recurrence_count")) || 1));
  const lessonName = String(formData.get("lesson_name")).trim().slice(0, 120) || null;
  if (Number.isNaN(start.getTime()) || start <= new Date()) redirect(`/dashboard/tutor/requests/${requestId}?error=time`);
  const { data: tutor } = await supabase.from("tutor_profiles").select("hourly_rate").eq("id", request.tutor_id).maybeSingle();

  // Each proposed session occupies one hour, weekly from the chosen start.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const SESSION_MS = 60 * 60 * 1000;
  const proposed = Array.from({ length: recurrenceCount }, (_, index) => {
    const sessionStart = new Date(start.getTime() + index * WEEK_MS);
    return { start: sessionStart, end: new Date(sessionStart.getTime() + SESSION_MS) };
  });

  // Only a genuine overlap is a conflict. Asking whether the tutor has *any*
  // booking inside the series window would reject every request from a tutor
  // who already teaches weekly, however far apart the times actually are.
  const seriesStart = proposed[0].start;
  const seriesEnd = proposed[proposed.length - 1].end;
  const { data: existing } = await supabase
    .from("bookings")
    .select("start_time, end_time")
    .eq("tutor_id", request.tutor_id)
    .eq("status", "scheduled")
    .lt("start_time", seriesEnd.toISOString())
    .gt("end_time", seriesStart.toISOString());

  const clash = proposed.find((session) =>
    (existing ?? []).some((booking) => {
      const bookingStart = new Date(booking.start_time).getTime();
      const bookingEnd = new Date(booking.end_time).getTime();
      return bookingStart < session.end.getTime() && bookingEnd > session.start.getTime();
    }),
  );
  if (clash) {
    redirect(`/dashboard/tutor/requests/${requestId}?error=conflict&at=${encodeURIComponent(clash.start.toISOString())}`);
  }

  const recurrenceSeriesId = recurrenceCount > 1 ? crypto.randomUUID() : null;
  const bookings = proposed.map(({ start: sessionStart, end: sessionEnd }, index) => {
    return {
      student_id: request.student_id,
      tutor_id: request.tutor_id,
      subject: index === 0 ? request.subject : null,
      exam_board: index === 0 ? request.exam_board : null,
      start_time: sessionStart.toISOString(),
      end_time: sessionEnd.toISOString(),
      status: "scheduled",
      payment_status: request.is_trial && index === 0 ? "paid" : "pending",
      amount_gbp_pence: tutor?.hourly_rate ?? null,
      lesson_name: lessonName,
      lesson_request_id: request.id,
      is_trial: request.is_trial && index === 0,
      recurrence_rule: recurrenceCount > 1 ? `weekly:${recurrenceCount}` : null,
      recurrence_series_id: recurrenceSeriesId,
    };
  });
  const { error } = await supabase.from("bookings").insert(bookings);
  if (error) redirect(`/dashboard/tutor/requests/${requestId}?error=save`);
  await supabase.from("lesson_requests").update({ status: "scheduled", responded_at: new Date().toISOString() }).eq("id", request.id);
  let { data: conversation } = await supabase.from("direct_conversations").select("id").eq("student_id", request.student_id).eq("tutor_id", request.tutor_id).maybeSingle();
  if (!conversation) {
    const { data, error: conversationError } = await supabase.from("direct_conversations").insert({ student_id: request.student_id, tutor_id: request.tutor_id }).select("id").single();
    // The lessons are already booked at this point, so a failed conversation
    // must not fail the action — but it must not vanish silently either.
    if (conversationError) console.error("Could not open a conversation for the confirmed lesson:", conversationError.message);
    conversation = data;
  }
  if (conversation) {
    await supabase.from("direct_messages").insert({ conversation_id: conversation.id, sender_id: request.tutor_id, body: `Lesson confirmed\n\n${subjectLabel(request.subject)} · ${request.exam_board}\nStarts: ${start.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}\n${recurrenceCount > 1 ? `Weekly for ${recurrenceCount} sessions.` : "One session scheduled."}${request.is_trial ? "\nYour first session is a free trial." : ""}` });
    await supabase.from("direct_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);
  }
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  redirect("/dashboard/tutor");
}

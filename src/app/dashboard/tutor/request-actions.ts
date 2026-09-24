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
  const { data: conflicts } = await supabase.from("bookings").select("id").eq("tutor_id", request.tutor_id).eq("status", "scheduled").gte("start_time", start.toISOString()).lt("start_time", new Date(start.getTime() + recurrenceCount * 7 * 24 * 60 * 60 * 1000).toISOString());
  if (conflicts?.length) redirect(`/dashboard/tutor/requests/${requestId}?error=conflict`);
  const recurrenceSeriesId = recurrenceCount > 1 ? crypto.randomUUID() : null;
  const bookings = Array.from({ length: recurrenceCount }, (_, index) => {
    const sessionStart = new Date(start.getTime() + index * 7 * 24 * 60 * 60 * 1000);
    return {
      student_id: request.student_id,
      tutor_id: request.tutor_id,
      subject: index === 0 ? request.subject : null,
      exam_board: index === 0 ? request.exam_board : null,
      start_time: sessionStart.toISOString(),
      end_time: new Date(sessionStart.getTime() + 60 * 60 * 1000).toISOString(),
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
    const { data } = await supabase.from("direct_conversations").insert({ student_id: request.student_id, tutor_id: request.tutor_id }).select("id").single();
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

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
  await supabase.from("lesson_requests").update({ status: "declined", responded_at: new Date().toISOString() }).eq("id", request.id).eq("status", "pending");
  revalidatePath("/dashboard/tutor");
}

export async function scheduleLessonRequestAction(requestId: string, formData: FormData) {
  const { supabase, request } = await tutorRequest(requestId);
  if (!request || request.status !== "pending") redirect("/dashboard/tutor");
  const start = new Date(String(formData.get("start_time")));
  const recurrenceCount = Math.min(12, Math.max(1, Number(formData.get("recurrence_count")) || 1));
  const lessonName = String(formData.get("lesson_name")).trim().slice(0, 120) || null;
  if (Number.isNaN(start.getTime()) || start <= new Date()) redirect(`/dashboard/tutor/requests/${requestId}?error=time`);
  const result = await supabase.rpc("schedule_lessons_v1", { p_student_id: request.student_id,
    p_start: start.toISOString(), p_hours: 1, p_count: recurrenceCount,
    p_name: lessonName || subjectLabel(request.subject), p_request_id: request.id, p_command_id: crypto.randomUUID() });
  if (result.error) redirect(`/dashboard/tutor/requests/${requestId}?error=${result.error.code === "23P01" ? "conflict" : "save"}`);
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  redirect("/dashboard/tutor");
}

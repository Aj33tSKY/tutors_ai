import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { scheduleLessonRequestAction } from "../../request-actions";
import { ScheduleRequestView } from "@/components/dashboard/schedule-request";
import type { LessonRequest, Profile } from "@/lib/types";

export default async function ScheduleRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; at?: string }> }) {
  const [{ id }, { error, at }] = await Promise.all([params, searchParams]);
  const clashAt = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at) : null;
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();
  const { data: request } = await supabase.from("lesson_requests").select("*").eq("id", id).eq("tutor_id", userId).maybeSingle<LessonRequest>();
  if (!request || request.status !== "pending") redirect("/dashboard/tutor");
  const { data: student } = await supabase.from("profiles").select("full_name").eq("id", request.student_id).maybeSingle<Pick<Profile, "full_name">>();
  const action = scheduleLessonRequestAction.bind(null, request.id);
  const defaultDateTime = new Date(request.requested_start_time).toISOString().slice(0, 16);
  return <ScheduleRequestView request={request} studentName={student?.full_name ?? "your student"} defaultDateTime={defaultDateTime} scheduleAction={action} error={error} clashAt={clashAt}/>;
}

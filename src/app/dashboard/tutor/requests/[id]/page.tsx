import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import type { LessonRequest, Profile } from "@/lib/types";
import { scheduleLessonRequestAction } from "../../request-actions";

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
  return <div className="mx-auto max-w-2xl space-y-6">
    <div><Link href="/dashboard/tutor" className="text-sm text-muted-foreground hover:text-foreground">← Back to sessions</Link><h2 className="display-md mt-3">Confirm lesson schedule</h2><p className="mt-1 text-sm text-muted-foreground">Set the actual time with {student?.full_name ?? "your student"}. This creates the scheduled sessions and sends confirmation in DMs.</p></div>
    <Card><CardHeader><CardTitle>{subjectLabel(request.subject)} · {boardLabel(request.exam_board)}</CardTitle></CardHeader><CardContent><form action={action} className="space-y-5">
      <div className="rounded-xl bg-muted/50 p-4 text-sm"><p className="font-medium">Requested slot</p><p className="mt-1 text-muted-foreground">{new Date(request.requested_start_time).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}</p>{request.is_trial && <p className="mt-3 font-medium text-emerald-700 dark:text-emerald-300">This first session is a free trial.</p>}</div>
      <div className="space-y-1.5"><Label htmlFor="lesson_name">Lesson name (optional)</Label><Input id="lesson_name" name="lesson_name" placeholder={subjectLabel(request.subject)} /></div>
      <div className="space-y-1.5"><Label htmlFor="start_time">Actual first session</Label><Input id="start_time" name="start_time" type="datetime-local" defaultValue={defaultDateTime} required /></div>
      <div className="space-y-1.5"><Label htmlFor="recurrence_count">Schedule</Label><select id="recurrence_count" name="recurrence_count" defaultValue="1" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="1">One session</option><option value="4">Weekly for 4 sessions</option><option value="8">Weekly for 8 sessions</option><option value="12">Weekly for 12 sessions</option></select><p className="text-xs text-muted-foreground">Recurring sessions are created weekly now; each completed paid session can be invoiced separately.</p></div>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error === "rate" ? "Set your hourly rate in your tutor profile before confirming a lesson — a lesson with no price cannot be invoiced." : error === "conflict" ? (clashAt ? `That clashes with an existing session on ${clashAt.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}. Pick another time.` : "That schedule overlaps an existing session.") : "We couldn’t save this schedule. Please check the time and try again."}</p>}
      <Button type="submit">Confirm and message student</Button>
    </form></CardContent></Card>
  </div>;
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import type { LessonRequest } from "@/lib/types";
import { declineLessonRequestAction } from "@/app/dashboard/tutor/request-actions";

export function LessonRequests({ requests, names }: { requests: LessonRequest[]; names: Map<string, string> }) {
  if (!requests.length) return null;
  return <Card><CardHeader><CardTitle>New lesson requests</CardTitle></CardHeader><CardContent className="space-y-3">{requests.map((request) => <div key={request.id} className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{names.get(request.student_id) ?? "Student"} · {subjectLabel(request.subject)}</p><p className="mt-1 text-sm text-muted-foreground">{boardLabel(request.exam_board)} · requested {new Date(request.requested_start_time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>{request.is_trial && <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Free trial</p>}</div><div className="flex gap-2"><form action={declineLessonRequestAction}><input type="hidden" name="request_id" value={request.id} /><Button type="submit" size="sm" variant="ghost">Decline</Button></form><Button asChild size="sm"><Link href={`/dashboard/tutor/requests/${request.id}`}>Accept &amp; schedule</Link></Button></div></div>)}</CardContent></Card>;
}

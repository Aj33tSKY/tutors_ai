import { Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Profile } from "@/lib/types";
import { subjectLabel } from "@/lib/subjects";

import type { FamilyOverview } from "../../../packages/contracts/src/portal";

export function FamilyOverviewView({ family: { children, bookings } }: { family: FamilyOverview }) {
  const childIds = (children ?? []).map((child) => child.id);
  const childNames = new Map((children ?? []).map((child) => {
    const student = Array.isArray(child.profiles) ? child.profiles[0] : child.profiles;
    return [child.id, (student as Profile | undefined)?.full_name ?? "Your child"];
  }));
  const upcoming = (bookings ?? []).filter((booking) => booking.status === "scheduled" && new Date(booking.end_time) >= new Date())
    .sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, 3);
  const recent = (bookings ?? []).filter((booking) => booking.status === "completed").slice(0, 4);

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h2 className="display-md">Family overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          See your children&apos;s upcoming lessons and completed session reviews.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-brand-strong" /> Linked children
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!children || children.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <p className="font-medium">No children linked yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Ask your child to add your email as their parent when they set up their profile,
                or contact support to link an existing account.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {children.map((c) => {
                const student = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-xl border border-border p-4"
                  >
                    <div>
                      <p className="font-medium">{(student as Profile | undefined)?.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(student as Profile | undefined)?.email}
                      </p>
                    </div>
                    <span className="eyebrow shrink-0">Linked</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {childIds.length > 0 && <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Coming up</CardTitle></CardHeader><CardContent>
          {upcoming.length ? <ul className="divide-y divide-border">{upcoming.map((booking) => <li key={booking.id} className="py-3 first:pt-0"><p className="font-medium">{booking.lesson_name || subjectLabel(booking.subject as import("@/lib/types").StemSubject)}</p><p className="text-sm text-muted-foreground">{childNames.get(booking.student_id)} · {new Date(booking.start_time).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No upcoming lessons are scheduled.</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Recent lesson reviews</CardTitle></CardHeader><CardContent>
          {recent.length ? <ul className="divide-y divide-border">{recent.map((booking) => <li key={booking.id} className="flex items-center justify-between gap-3 py-3 first:pt-0"><div><p className="font-medium">{booking.lesson_name || subjectLabel(booking.subject as import("@/lib/types").StemSubject)}</p><p className="text-sm text-muted-foreground">{childNames.get(booking.student_id)} · {new Date(booking.start_time).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p></div><a href={`/dashboard/student/bookings/${booking.id}`} className="shrink-0 text-sm font-semibold text-brand-strong">Review →</a></li>)}</ul> : <p className="text-sm text-muted-foreground">Completed lessons will appear here with notes and recordings when available.</p>}
        </CardContent></Card>
      </div>}
    </div>
  );
}

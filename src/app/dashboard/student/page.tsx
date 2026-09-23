import Link from "next/link";
import { CalendarPlus, Clock, MessageCircle, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressRing } from "@/components/progress-ring";
import { subjectLabel } from "@/lib/subjects";
import type { Booking } from "@/lib/types";

export default async function StudentDashboardPage() {
  const { userId, profile } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("student_id", userId)
    .order("start_time", { ascending: true })
    .returns<Booking[]>();

  const now = new Date();
  const upcoming = (bookings ?? []).filter((b) => new Date(b.start_time) >= now && b.status !== "cancelled");
  const past = (bookings ?? []).filter((b) => new Date(b.start_time) < now || b.status === "completed");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="display-md">
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s where your revision stands today.
          </p>
        </div>
        <Button asChild>
          <Link href="/tutors">
            <CalendarPlus className="size-4" /> Book a session
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-saffron" /> Upcoming sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <EmptyState
                title="No sessions booked yet"
                body="Find a specialist tutor for your exam board and book your first session."
                cta="Browse tutors"
                href="/tutors"
              />
            ) : (
              <ul className="space-y-3">
                {upcoming.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between rounded-sm border border-hairline p-4"
                  >
                    <div>
                      <p className="font-medium">{subjectLabel(b.subject)}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(b.start_time).toLocaleString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/session/${b.id}`}>Join</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="size-4 text-saffron" /> Revision AI
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Ask questions grounded in your own session transcripts, any time.
            </p>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/dashboard/student/chat">
                <Sparkles className="size-4" /> Open chat
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Specification coverage</CardTitle>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <EmptyState
              title="Coverage appears after your first completed session"
              body="Once a tutor confirms a session, topics are auto-mapped to your exam spec here."
            />
          ) : (
            <div className="flex flex-wrap items-center gap-8">
              <ProgressRing value={0} label="Coming soon" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({
  title,
  body,
  cta,
  href,
}: {
  title: string;
  body: string;
  cta?: string;
  href?: string;
}) {
  return (
    <div className="rounded-sm border border-dashed border-hairline p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {cta && href && (
        <Button asChild size="sm" className="mt-4">
          <Link href={href}>{cta}</Link>
        </Button>
      )}
    </div>
  );
}

import Link from "next/link";
import { Clock, PoundSterling, Star, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { subjectLabel } from "@/lib/subjects";
import type { Booking, TutorProfile } from "@/lib/types";

export default async function TutorDashboardPage() {
  const { userId, profile } = await getCurrentProfile();
  const supabase = await createClient();

  const [{ data: tutorProfile }, { data: bookings }] = await Promise.all([
    supabase.from("tutor_profiles").select("*").eq("id", userId).maybeSingle<TutorProfile>(),
    supabase
      .from("bookings")
      .select("*")
      .eq("tutor_id", userId)
      .order("start_time", { ascending: true })
      .returns<Booking[]>(),
  ]);

  const now = new Date();
  const upcoming = (bookings ?? []).filter((b) => new Date(b.start_time) >= now && b.status !== "cancelled");
  const completed = (bookings ?? []).filter((b) => b.status === "completed");
  const paid = (bookings ?? []).filter((b) => b.payment_status === "paid");
  const earnings = paid.reduce(
    (sum, b) => sum + (b.amount_gbp_pence ?? tutorProfile?.hourly_rate ?? 0) / 100,
    0,
  );

  const stats = [
    { label: "Upcoming sessions", value: upcoming.length, icon: Clock },
    { label: "Sessions completed", value: completed.length, icon: Users },
    { label: "Est. earnings", value: `£${earnings.toFixed(0)}`, icon: PoundSterling },
    { label: "Rating", value: tutorProfile?.rating ?? "—", icon: Star },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="display-md">
            {profile?.full_name ? `Welcome back, ${profile.full_name.split(" ")[0]}` : "Welcome back"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Your teaching overview.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/tutor/availability">Manage availability</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <s.icon className="size-4 text-saffron" />
              <p className="mt-3 display-md">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <div className="rounded-sm border border-dashed border-hairline p-8 text-center">
              <p className="font-medium">No sessions booked yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Set your availability so students can find and book you.
              </p>
              <Button asChild size="sm" className="mt-4">
                <Link href="/dashboard/tutor/availability">Set availability</Link>
              </Button>
            </div>
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

      {!tutorProfile?.dbs_verified && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div>
              <p className="font-medium">DBS verification pending</p>
              <p className="text-sm text-muted-foreground">
                Upload your DBS certificate to appear in student search results.
              </p>
            </div>
            <Button size="sm">
              Upload documents
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { ShieldCheck, Users, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/types";

type PendingTutor = {
  id: string;
  hourly_rate: number;
  dbs_verified: boolean;
  subjects: string[];
  profiles: Pick<Profile, "full_name" | "email"> | Pick<Profile, "full_name" | "email">[];
};

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const [{ count: profileCount }, { count: bookingCount }, { data: pendingTutors }] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("bookings").select("*", { count: "exact", head: true }),
      supabase
        .from("tutor_profiles")
        .select("id, hourly_rate, dbs_verified, subjects, profiles!tutor_profiles_id_fkey(full_name, email)")
        .eq("dbs_verified", false),
    ]);

  const stats = [
    { label: "Total users", value: profileCount ?? 0, icon: Users },
    { label: "Total bookings", value: bookingCount ?? 0, icon: CalendarClock },
    { label: "Pending DBS checks", value: pendingTutors?.length ?? 0, icon: ShieldCheck },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h2 className="display-md">Platform overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">Live counts from the database.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          <CardTitle>Tutor verification queue</CardTitle>
        </CardHeader>
        <CardContent>
          {!pendingTutors || pendingTutors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tutors waiting on DBS review.</p>
          ) : (
            <ul className="space-y-3">
              {pendingTutors.map((t: PendingTutor) => {
                const tutorProfile = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hairline p-4"
                  >
                    <div>
                      <p className="font-medium">{tutorProfile?.full_name}</p>
                      <p className="text-sm text-muted-foreground">{tutorProfile?.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Awaiting DBS</Badge>
                      <Button size="sm">
                        Review
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

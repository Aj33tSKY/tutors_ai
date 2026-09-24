import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { SessionsPanel } from "@/components/dashboard/sessions-panel";
import { RefreshDashboardOnHistoryNavigation } from "@/components/dashboard/refresh-dashboard-on-history-navigation";
import type { Booking, Profile } from "@/lib/types";

export default async function StudentDashboardPage() {
  const { userId, profile } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("student_id", userId)
    .order("start_time", { ascending: false })
    .returns<Booking[]>();

  const tutorIds = [...new Set((bookings ?? []).map((booking) => booking.tutor_id))];
  const { data: tutors } = tutorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", tutorIds)
    : { data: [] as Pick<Profile, "id" | "full_name">[] };
  const tutorNames = new Map((tutors ?? []).map((tutor) => [tutor.id, tutor.full_name]));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <RefreshDashboardOnHistoryNavigation />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display-md">
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Your lessons, all in one place.</p>
        </div>
        <Button asChild size="md">
          <Link href="/tutors"><CalendarPlus className="size-4" /> Book a new session</Link>
        </Button>
      </div>
      <SessionsPanel
        sessions={(bookings ?? []).map((booking) => ({
          ...booking,
          counterpartName: tutorNames.get(booking.tutor_id) ?? "Your tutor",
          counterpartId: booking.tutor_id,
        }))}
      />
    </div>
  );
}
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

import { SessionsPanel } from "@/components/dashboard/sessions-panel";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { Booking, Profile } from "@/lib/types";

export default async function TutorDashboardPage() {
  const { userId, profile } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("tutor_id", userId)
    .order("start_time", { ascending: false })
    .returns<Booking[]>();

  const studentIds = [...new Set((bookings ?? []).map((booking) => booking.student_id))];
  const { data: students } = studentIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", studentIds)
    : { data: [] as Pick<Profile, "id" | "full_name">[] };
  const studentNames = new Map((students ?? []).map((student) => [student.id, student.full_name]));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h2 className="display-md">
          Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Your lessons, all in one place.</p>
      </div>
      <SessionsPanel
        counterpartLabel="Student"
        sessions={(bookings ?? []).map((booking) => ({
          ...booking,
          counterpartName: studentNames.get(booking.student_id) ?? "Student",
        }))}
      />
    </div>
  );
}

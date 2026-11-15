import { createClient } from "@/lib/supabase/server";
import { AdminOverviewView } from "@/components/dashboard/admin-overview";
import { TutorReviewForm } from "./tutor-review-form";

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

  return <AdminOverviewView profileCount={profileCount ?? 0} bookingCount={bookingCount ?? 0} pendingTutors={pendingTutors ?? []} renderReview={(id) => <TutorReviewForm tutorId={id} />} />;
}

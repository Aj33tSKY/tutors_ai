import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { FamilyOverviewView } from "@/components/dashboard/family-overview";
import type { Booking } from "@/lib/types";

export default async function ParentDashboardPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();

  const { data: children } = await supabase
    .from("student_profiles")
    .select("id, profiles!student_profiles_id_fkey(full_name, email)")
    .eq("parent_id", userId);
  const childIds = (children ?? []).map((child) => child.id);
  const { data: bookings } = childIds.length
    ? await supabase.from("bookings")
        .select("id, student_id, tutor_id, lesson_name, subject, start_time, end_time, status, payment_status, is_trial")
        .in("student_id", childIds)
        .neq("status", "cancelled")
        .order("start_time", { ascending: false })
        .limit(50)
        .returns<Pick<Booking, "id" | "student_id" | "tutor_id" | "lesson_name" | "subject" | "start_time" | "end_time" | "status" | "payment_status" | "is_trial">[]>()
    : { data: [] };
  return <FamilyOverviewView family={{ children: children ?? [], bookings: bookings ?? [] }} />;
}

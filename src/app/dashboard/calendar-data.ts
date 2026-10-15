"use server";

import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import type { CalendarBooking, CalendarSession, Profile } from "@/lib/types";

const BOOKING_COLUMNS = "id, student_id, tutor_id, subject, start_time, end_time, status, lesson_name, is_trial, stripe_invoice_id, amount_gbp_pence, started_at, recurrence_rule, recurrence_series_id";
const MAX_WINDOW_MS = 190 * 24 * 60 * 60 * 1000;

/** RLS-scoped calendar data for a bounded interval, including older months. */
export async function loadCalendarSessions(from: string, to: string): Promise<CalendarSession[]> {
  const start = new Date(from);
  const end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      end <= start || end.getTime() - start.getTime() > MAX_WINDOW_MS) {
    throw new Error("Invalid calendar range");
  }

  const { userId, profile } = await getCurrentProfile();
  if (!userId || (profile?.role !== "student" && profile?.role !== "tutor")) {
    throw new Error("Calendar access denied");
  }

  const supabase = await createClient();
  const counterpartField = profile.role === "student" ? "tutor_id" : "student_id";
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq(profile.role === "student" ? "student_id" : "tutor_id", userId)
    .gte("start_time", start.toISOString())
    .lt("start_time", end.toISOString())
    .neq("status", "cancelled")
    .order("start_time", { ascending: true })
    .returns<CalendarBooking[]>();
  if (error) throw new Error("Could not load sessions");

  const ids = [...new Set((bookings ?? []).map((booking) => booking[counterpartField]))];
  const { data: counterparts, error: profileError } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids).returns<Pick<Profile, "id" | "full_name">[]>()
    : { data: [] as Pick<Profile, "id" | "full_name">[], error: null };
  if (profileError) throw new Error("Could not load session contacts");
  const names = new Map((counterparts ?? []).map((person) => [person.id, person.full_name]));

  return (bookings ?? []).map((booking) => ({
    ...booking,
    counterpartId: booking[counterpartField],
    counterpartName: names.get(booking[counterpartField]) ?? (profile.role === "student" ? "Your tutor" : "Student"),
  }));
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index";
import { calendarRange } from "../../contracts/src/index";
import type { CalendarSession, CalendarBooking } from "../../contracts/src/models.js";
import { databaseResult, requireRole } from "./portal";
import { AppError } from "./errors";

export async function calendarSessions(client: SupabaseClient, identity: Identity, from: string, to: string): Promise<CalendarSession[]> {
  requireRole(identity, ["student", "tutor"]);
  const input = calendarRange.parse({ from, to });
  const own = identity.profile.role === "student" ? "student_id" : "tutor_id";
  const other = own === "student_id" ? "tutor_id" : "student_id";
  const rows = await client.from("bookings").select("id,student_id,tutor_id,subject,start_time,end_time,status,lesson_name,is_trial,stripe_invoice_id,amount_gbp_pence,started_at,recurrence_rule,recurrence_series_id")
    .eq(own, identity.id).gte("start_time", input.from).lt("start_time", input.to).neq("status", "cancelled").order("start_time").returns<CalendarBooking[]>();
  databaseResult(rows.error);
  const ids = [...new Set((rows.data ?? []).map((row) => row[other]))];
  const people = ids.length ? await client.from("profiles").select("id,full_name").in("id", ids) : { data: [], error: null };
  databaseResult(people.error);
  const names = new Map((people.data ?? []).map((p) => [p.id, p.full_name as string]));
  return (rows.data ?? []).map((row) => ({ ...row, counterpartId: row[other], counterpartName: names.get(row[other]) ?? (own === "student_id" ? "Your tutor" : "Student") }));
}
export function schedulingError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "23P01") throw new AppError(409, "calendar_conflict", "That time overlaps another lesson");
  if (error.code === "P0002") throw new AppError(404, "not_found", "Lesson or request not found");
  if (error.code === "42501") throw new AppError(403, "forbidden", "Only the booked tutor can make this change");
  if (["22023", "22P02", "22007"].includes(error.code ?? "")) throw new AppError(400, "invalid_schedule", "Check the lesson name, time and recurrence");
  if (["P0001", "23505"].includes(error.code ?? "")) throw new AppError(409, "lesson_state_changed", "This lesson cannot be changed in its current state; refresh and check the tutor's rate and schedule");
  throw new AppError(503, "database_unavailable", "Could not save the schedule; please try again");
}

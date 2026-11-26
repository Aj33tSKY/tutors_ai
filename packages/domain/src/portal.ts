import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index.js";
import type { Contact, AdminOverview, PendingTutor } from "../../contracts/src/portal.js";
import { AppError } from "./errors";

export function requireRole(identity: Identity, roles: string[]) {
  if (!roles.includes(identity.profile.role)) throw new AppError(403, "forbidden", "This account cannot access this operation");
}
export function databaseResult(error: unknown) {
  if (error) throw new AppError(503, "database_unavailable", "Could not complete this request; please try again");
}
export async function contacts(client: SupabaseClient, identity: Identity): Promise<Contact[]> {
  requireRole(identity, ["student", "tutor"]);
  const own = identity.profile.role === "student" ? "student_id" : "tutor_id";
  const other = identity.profile.role === "student" ? "tutor_id" : "student_id";
  const [bookings, requests] = await Promise.all([
    client.from("bookings").select("student_id,tutor_id").eq(own, identity.id),
    client.from("lesson_requests").select("student_id,tutor_id").eq(own, identity.id),
  ]);
  databaseResult(bookings.error); databaseResult(requests.error);
  const counts = new Map<string, number>();
  for (const row of bookings.data ?? []) counts.set(row[other], (counts.get(row[other]) ?? 0) + 1);
  for (const row of requests.data ?? []) if (!counts.has(row[other])) counts.set(row[other], 0);
  if (!counts.size) return [];
  const profiles = await client.from("profiles").select("id,full_name,email").in("id", [...counts.keys()]);
  databaseResult(profiles.error);
  return (profiles.data ?? []).map((row) => ({ id: row.id, fullName: row.full_name, email: row.email, sessionCount: counts.get(row.id) ?? 0 }));
}
export async function adminOverview(client: SupabaseClient, identity: Identity): Promise<AdminOverview> {
  requireRole(identity, ["admin"]);
  const [profiles, bookings, tutors] = await Promise.all([
    client.from("profiles").select("id", { count: "exact", head: true }),
    client.from("bookings").select("id", { count: "exact", head: true }),
    client.from("tutor_profiles").select("id,hourly_rate,dbs_verified,subjects,profiles!tutor_profiles_id_fkey(full_name,email)")
      .eq("dbs_verified", false).returns<PendingTutor[]>(),
  ]);
  for (const result of [profiles, bookings, tutors]) databaseResult(result.error);
  return { profileCount: profiles.count ?? 0, bookingCount: bookings.count ?? 0, pendingTutors: tutors.data ?? [] };
}

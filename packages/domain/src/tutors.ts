import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index";
import type { ExamBoard, StemSubject } from "../../contracts/src/models";
import type { LessonRequestResult, PublicTutor, TutorCatalogue, TutorQuery } from "../../contracts/src/tutors";
import { AppError } from "./errors";
import { databaseResult, requireRole } from "./portal";

type Row = { id: string; headline: string | null; bio: string | null; subjects: StemSubject[]; boards: ExamBoard[]; hourly_rate: number; years_experience: number | null;
  profiles: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[] | null };
const columns = "id, headline, bio, subjects, boards, hourly_rate, years_experience, profiles!tutor_profiles_id_fkey(full_name, avatar_url)";
const toTutor = (row: Row, days: number[]): PublicTutor => {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return { id: row.id, fullName: profile?.full_name ?? "Tutor", avatarUrl: profile?.avatar_url ?? null, headline: row.headline, bio: row.bio, subjects: row.subjects, boards: row.boards,
    hourlyRatePence: row.hourly_rate, yearsExperience: row.years_experience, availableDays: days };
};

/** The approved, non-demo catalogue. The anonymous RLS role enforces who is public; this only filters. */
export async function publicTutors(client: SupabaseClient, query: TutorQuery = {}): Promise<TutorCatalogue> {
  const result = await client.from("tutor_profiles").select(columns).eq("dbs_verified", true).eq("is_demo", false).order("hourly_rate", { ascending: true }).order("id").limit(200).returns<Row[]>();
  databaseResult(result.error);
  const rows = result.data ?? [];
  const slots = rows.length ? await client.from("availability").select("tutor_id, day_of_week").in("tutor_id", rows.map((row) => row.id)) : { data: [], error: null };
  databaseResult(slots.error);
  const days = new Map<string, number[]>();
  for (const slot of slots.data ?? []) { const list = days.get(slot.tutor_id) ?? []; if (!list.includes(slot.day_of_week)) list.push(slot.day_of_week); days.set(slot.tutor_id, list); }
  const tutors = rows.map((row) => toTutor(row, (days.get(row.id) ?? []).sort()))
    .filter((tutor) => (!query.subject || tutor.subjects.includes(query.subject)) && (!query.board || tutor.boards.includes(query.board))
      && (!query.maxPrice || tutor.hourlyRatePence <= query.maxPrice * 100) && (query.day === undefined || tutor.availableDays.includes(query.day)));
  return { tutors, total: tutors.length, approved: rows.length };
}
export async function publicTutor(client: SupabaseClient, id: string): Promise<PublicTutor> {
  const result = await client.from("tutor_profiles").select(columns).eq("id", id).eq("dbs_verified", true).eq("is_demo", false).maybeSingle<Row>();
  databaseResult(result.error);
  if (!result.data) throw new AppError(404, "not_found", "Tutor not found");
  const slots = await client.from("availability").select("day_of_week").eq("tutor_id", id);
  databaseResult(slots.error);
  return toTutor(result.data, [...new Set((slots.data ?? []).map((slot) => slot.day_of_week as number))].sort());
}
export async function openSlots(client: SupabaseClient, tutorId: string): Promise<string[]> {
  const result = await client.rpc("tutor_open_slots_v1", { p_tutor: tutorId });
  databaseResult(result.error);
  return (result.data ?? []) as string[];
}
const requestFailures: Record<string, [number, string, string]> = {
  slot_unavailable: [409, "slot_unavailable", "That slot is no longer available. Please choose another."],
  subject_unavailable: [409, "subject_unavailable", "That subject or exam board is no longer offered by this tutor."],
  too_many_requests: [429, "too_many_requests", "You already have several open requests with this tutor. Wait for a reply before sending more."],
};
export async function requestLesson(client: SupabaseClient, identity: Identity, tutorId: string, input: { subject: StemSubject; examBoard: ExamBoard; startTime: string }): Promise<LessonRequestResult> {
  requireRole(identity, ["student"]);
  const result = await client.rpc("request_lesson_v1", { p_tutor: tutorId, p_subject: input.subject, p_board: input.examBoard, p_start: input.startTime });
  const known = result.error && requestFailures[result.error.message];
  if (known) throw new AppError(...known);
  if (result.error?.code === "42501") throw new AppError(403, "forbidden", "Only students can request lessons");
  databaseResult(result.error);
  return result.data as LessonRequestResult;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index.js";
import type { LessonRoom } from "../../contracts/src/lessons.js";
import { AppError } from "./errors.js";
import { databaseResult } from "./portal.js";

export async function participantLesson(client: SupabaseClient, identity: Identity, id: string): Promise<LessonRoom["booking"]> {
  const { data, error } = await client.from("bookings").select("id,tutor_id,student_id,subject,lesson_name,start_time,status,started_at")
    .eq("id", id).maybeSingle<LessonRoom["booking"]>();
  databaseResult(error);
  if (!data || (data.tutor_id !== identity.id && data.student_id !== identity.id)) throw new AppError(404, "not_found", "Lesson not found");
  return data;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingSummary } from "../../contracts/src/index.js";
import type { BookingRepository } from "../../domain/src/bookings.js";
import { AppError } from "../../domain/src/errors.js";

export const bookingColumns = "id,student_id,tutor_id,lesson_name,subject,start_time,end_time,status,payment_status,is_trial,started_at";
export function bookingRepository(client: SupabaseClient): BookingRepository {
  return {
    async find(id) {
      const { data, error } = await client.from("bookings").select(bookingColumns).eq("id", id).maybeSingle<BookingSummary>();
      if (error) throw new AppError(503, "database_unavailable", "Could not load the lesson");
      return data;
    },
    async name(id) {
      const { data, error } = await client.from("profiles").select("full_name").eq("id", id).maybeSingle();
      if (error) throw new AppError(503, "database_unavailable", "Could not load the participant");
      return data?.full_name ?? null;
    },
    async rename(id, name) {
      const { data, error } = await client.rpc("rename_booking_lesson", { p_booking_id: id, p_lesson_name: name }).select(bookingColumns);
      if (error) throw new AppError(409, "update_failed", "Could not rename the lesson");
      return (Array.isArray(data) ? data[0] : null) as BookingSummary | null;
    },
  };
}

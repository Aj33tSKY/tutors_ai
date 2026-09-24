"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type StartLessonActionState = { error?: string; success?: boolean };

/** The tutor is the sole authority for opening a lesson room. */
export async function startLessonAction(
  _previous: StartLessonActionState,
  formData: FormData,
): Promise<StartLessonActionState> {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  if (!bookingId.success) return { error: "We couldn’t identify this session." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before starting." };
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, tutor_id, status, started_at")
    .eq("id", bookingId.data)
    .maybeSingle();
  if (!booking || booking.tutor_id !== user.id) return { error: "Only the tutor can start this session." };
  if (booking.status !== "scheduled") return { error: "Only scheduled sessions can be started." };

  if (!booking.started_at) {
    const startedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("bookings")
      .update({ started_at: startedAt, last_joined_at: startedAt })
      .eq("id", booking.id)
      .is("started_at", null)
      .select("id")
      .maybeSingle();
    if (error || !data) return { error: "We couldn’t start the session. Please try again." };
  }

  revalidatePath(`/session/${booking.id}`);
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

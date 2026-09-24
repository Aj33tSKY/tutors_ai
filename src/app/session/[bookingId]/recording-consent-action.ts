"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function consentToSessionRecording(bookingIdInput: string): Promise<{ error?: string }> {
  const parsedId = z.string().uuid().safeParse(bookingIdInput);
  if (!parsedId.success) return { error: "We couldn’t identify this session." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before joining." };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, tutor_id, status")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!booking || booking.tutor_id !== user.id || booking.status !== "scheduled") {
    return { error: "Only the tutor can consent to recording this scheduled session." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("session_recording_consents")
    .upsert({ booking_id: booking.id, tutor_id: user.id, consented_at: new Date().toISOString(), consent_version: 1 }, { onConflict: "booking_id" });
  return error ? { error: "We couldn’t save your recording consent. Please try again." } : {};
}

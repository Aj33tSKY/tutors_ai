"use server";

import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { calendarSessions } from "../../../packages/domain/src/calendar";

export async function loadCalendarSessions(from: string, to: string) {
  const { userId, email, profile } = await getCurrentProfile();
  if (!profile) throw new Error("Please sign in");
  return calendarSessions(await createClient(), { id: userId, email, profile }, from, to);
}

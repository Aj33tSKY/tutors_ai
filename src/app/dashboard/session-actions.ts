"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const LessonNameSchema = z.string().trim().max(120);

export async function updateLessonNameAction(formData: FormData) {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  const lessonName = LessonNameSchema.safeParse(formData.get("lesson_name"));
  if (!bookingId.success || !lessonName.success) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // The participant-scoped RLS update policy is the authority check. Only
  // this one mutable column is supplied by the client.
  await supabase
    .from("bookings")
    .update({ lesson_name: lessonName.data || null })
    .eq("id", bookingId.data);

  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/tutor");
}

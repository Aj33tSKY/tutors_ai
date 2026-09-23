"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addAvailabilityAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const dayOfWeek = Number(formData.get("day_of_week"));
  const startTime = String(formData.get("start_time"));
  const endTime = String(formData.get("end_time"));

  if (Number.isNaN(dayOfWeek) || !startTime || !endTime || startTime >= endTime) return;

  await supabase.from("availability").insert({
    tutor_id: user.id,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
  });

  revalidatePath("/dashboard/tutor/availability");
}

export async function removeAvailabilityAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = String(formData.get("id"));
  await supabase.from("availability").delete().eq("id", id).eq("tutor_id", user.id);

  revalidatePath("/dashboard/tutor/availability");
}

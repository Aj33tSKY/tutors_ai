"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";

export type ReviewState = { error?: string; success?: boolean };

export async function approveTutorAction(_previous: ReviewState, formData: FormData): Promise<ReviewState> {
  const { profile } = await getCurrentProfile();
  if (profile?.role !== "admin") return { error: "Only an administrator can approve a tutor." };

  const input = z.object({
    tutorId: z.uuid(),
    evidenceNote: z.string().trim().min(20).max(1000),
    confirmed: z.literal("on"),
  }).safeParse({
    tutorId: formData.get("tutor_id"),
    evidenceNote: formData.get("evidence_note"),
    confirmed: formData.get("confirmed"),
  });
  if (!input.success) return { error: "Confirm the checks and record at least 20 characters of evidence before approval." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_tutor_verification", {
    p_tutor_id: input.data.tutorId,
    p_evidence_note: input.data.evidenceNote,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin");
  return { success: true };
}

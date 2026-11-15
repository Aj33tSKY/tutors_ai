"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { legacyContext, legacyOutcome } from "@/lib/billing-adapter";
import { lessonRequestInput } from "../../../../../packages/contracts/src/tutors";
import { requestLesson } from "../../../../../packages/domain/src/tutors";

export interface BookingFormState { error?: string; success?: string }

/** Legacy host for the shared transactional request; the rules live in the database function. */
export async function createLessonRequestAction(tutorId: string, input: { subject: string; examBoard: string; startTime: string }): Promise<BookingFormState> {
  const context = await legacyContext();
  if (!context) redirect(`/sign-in?next=/tutors/${tutorId}`);
  const parsed = lessonRequestInput.safeParse(input);
  if (!parsed.success) return { error: "Please choose a subject, exam board and an available future slot." };
  const result = await legacyOutcome(() => requestLesson(context.client, context.identity, tutorId, parsed.data));
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/tutor");
  return { success: "Request sent. Your tutor will confirm the actual lesson time in messages." };
}

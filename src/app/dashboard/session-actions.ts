"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { schedulingError } from "../../../packages/domain/src/calendar";
import { AppError } from "../../../packages/domain/src/errors";
import { legacyBilling, legacyBillingContext, legacyOutcome } from "@/lib/billing-adapter";
import { sendLessonInvoice } from "../../../packages/domain/src/billing";

const LessonNameSchema = z.string().trim().max(120);
const SessionDetailsSchema = z.object({
  bookingId: z.string().uuid(),
  lessonName: z.string().trim().min(1, "Enter a session name.").max(120),
  startTime: z.string().datetime({ local: true }),
  utcOffsetMinutes: z.coerce.number().int().min(-720).max(840),
});

export type LessonNameActionState = { error?: string; success?: boolean };

export async function updateLessonNameAction(
  _previous: LessonNameActionState,
  formData: FormData,
): Promise<LessonNameActionState> {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  const lessonName = LessonNameSchema.safeParse(formData.get("lesson_name"));
  if (!bookingId.success || !lessonName.success) return { error: "Enter a lesson name of 120 characters or fewer." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before saving." };

  // The participant-scoped RLS update policy is the authority check. Only
  // this one mutable column is supplied by the client.
  const { data, error } = await supabase
    .from("bookings")
    .update({ lesson_name: lessonName.data || null })
    .eq("id", bookingId.data)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "We couldn’t save the lesson name. Please try again." };

  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/tutor");
  return { success: true };
}

export type SessionDetailsActionState = { error?: string; success?: boolean };

/**
 * Tutors can rename or reschedule an active lesson without changing its
 * duration. `started_at` is deliberately never updated: it remains the true
 * beginning of the recording/transcript, while this changes only the planned
 * resume slot.
 */
export async function updateSessionDetailsAction(
  _previous: SessionDetailsActionState,
  formData: FormData,
): Promise<SessionDetailsActionState> {
  const parsed = SessionDetailsSchema.safeParse({
    bookingId: formData.get("booking_id"),
    lessonName: formData.get("lesson_name"),
    startTime: formData.get("start_time"),
    utcOffsetMinutes: formData.get("utc_offset_minutes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the session details and try again." };
  const localIso = parsed.data.startTime.length === 16 ? `${parsed.data.startTime}:00Z` : `${parsed.data.startTime}Z`;
  const start = new Date(Date.parse(localIso) - parsed.data.utcOffsetMinutes * 60_000);
  if (Number.isNaN(start.getTime()) || start.getMinutes() % 15 !== 0 || start.getSeconds() !== 0) return { error: "Choose a 15-minute start time." };
  if (start <= new Date()) return { error: "Choose a future date and time." };

  return runTutorChange(parsed.data.bookingId, "reschedule", { lessonName: parsed.data.lessonName, startTime: start.toISOString() });
}

export type MarkSessionCompleteActionState = { error?: string; success?: boolean };

export async function markSessionCompleteAction(
  _previous: MarkSessionCompleteActionState,
  formData: FormData,
): Promise<MarkSessionCompleteActionState> {
  const id = z.uuid().safeParse(formData.get("booking_id"));
  if (!id.success) return { error: "We couldn’t identify that session." };
  return runTutorChange(id.data, "complete");
}

export async function markSessionUpcomingAction(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("booking_id"));
  if (!id.success) return;
  const result = await runTutorChange(id.data, "reopen");
  if (!result.success) return;
  redirect("/dashboard/tutor");
}

export type CancelSessionActionState = { error?: string; success?: boolean };

/** Cancel an unstarted session, or the unstarted remainder of its series. */
export async function cancelSessionAction(
  _previous: CancelSessionActionState,
  formData: FormData,
): Promise<CancelSessionActionState> {
  const id = z.uuid().safeParse(formData.get("booking_id"));
  if (!id.success) return { error: "We couldn’t identify that session." };
  return runTutorChange(id.data, "cancel", { series: formData.get("cancel_series") === "on" });
}

export type SendSessionInvoiceActionState = { error?: string; success?: boolean };

export async function sendSessionInvoiceAction(
  _previous: SendSessionInvoiceActionState,
  formData: FormData,
): Promise<SendSessionInvoiceActionState> {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  if (!bookingId.success) return { error: "We couldn’t identify that session." };
  const context = await legacyBillingContext();
  if (!context) return { error: "Please sign in again before sending an invoice." };
  const result = await legacyOutcome(() => sendLessonInvoice(context.client, context.identity, legacyBilling, bookingId.data));
  if (!result.ok) return { error: result.code === "payments_unavailable" ? "Invoicing is not configured for this environment." : result.error };
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

export type SessionNotesActionState = { error?: string; success?: boolean };

const SessionNotesSchema = z.object({
  bookingId: z.string().uuid(),
  notesMarkdown: z.string().max(20_000, "Notes must be 20,000 characters or fewer."),
});

/**
 * Saves the tutor's edits to a completed session's notes. These replace the
 * separate summary/topics/action-point cards the summarize-sessions cron
 * used to produce as read-only output — once generated, the markdown is the
 * tutor's to rewrite, same as updateLessonNameAction's one-column pattern:
 * the RLS policy on session_analytics is the real authority check, and this
 * action only ever sends the one column a tutor is allowed to touch.
 */
export async function updateSessionNotesAction(
  _previous: SessionNotesActionState,
  formData: FormData,
): Promise<SessionNotesActionState> {
  const parsed = SessionNotesSchema.safeParse({
    bookingId: formData.get("booking_id"),
    notesMarkdown: formData.get("notes_markdown"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "We couldn’t save those notes." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before saving." };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, tutor_id, status")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();
  if (!booking || booking.tutor_id !== user.id) return { error: "Only the tutor can edit these notes." };
  if (booking.status !== "completed") return { error: "Notes can only be edited once the session is completed." };

  const { error } = await supabase
    .from("session_analytics")
    .update({ notes_markdown: parsed.data.notesMarkdown })
    .eq("booking_id", booking.id);
  if (error) return { error: "We couldn’t save your changes. Please try again." };

  revalidatePath(`/dashboard/student/bookings/${booking.id}`);
  return { success: true };
}

async function runTutorChange(id: string, kind: string, input: Record<string, unknown> = {}): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const result = await supabase.rpc("tutor_change_lesson_v1", { p_id: id, p_kind: kind, p_input: input });
  try { schedulingError(result.error); }
  catch (error) { if (error instanceof AppError) return { error: error.message }; throw error; }
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

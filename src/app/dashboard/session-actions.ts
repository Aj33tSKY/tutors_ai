"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { subjectLabel } from "@/lib/subjects";
import type { Booking, Profile, TutorProfile } from "@/lib/types";

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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before saving." };
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, tutor_id, status, started_at, start_time, end_time")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();
  if (!booking || booking.tutor_id !== user.id) return { error: "Only the tutor can edit this session." };
  if (booking.status !== "scheduled") return { error: "Completed sessions can’t be rescheduled." };
  const duration = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
  const end = new Date(start.getTime() + duration);
  const { data: conflict } = await supabase
    .from("bookings")
    .select("id")
    .eq("tutor_id", user.id)
    .eq("status", "scheduled")
    .neq("id", booking.id)
    .lt("start_time", end.toISOString())
    .gt("end_time", start.toISOString())
    .limit(1)
    .maybeSingle();
  if (conflict) return { error: "That time overlaps with another session." };
  const { data, error } = await supabase
    .from("bookings")
    .update({ lesson_name: parsed.data.lessonName, start_time: start.toISOString(), end_time: end.toISOString() })
    .eq("id", booking.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "We couldn’t save the session. Please try again." };
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

export type MarkSessionCompleteActionState = { error?: string; success?: boolean };

export async function markSessionCompleteAction(
  _previous: MarkSessionCompleteActionState,
  formData: FormData,
): Promise<MarkSessionCompleteActionState> {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  if (!bookingId.success) return { error: "We couldn’t identify that session." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before completing the session." };

  // Tutors, rather than room disconnects, are the source of truth for when a
  // lesson is over. Select first so a student cannot complete a booking by
  // posting a guessed id to this Server Action.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, tutor_id, status, started_at")
    .eq("id", bookingId.data)
    .maybeSingle();
  if (!booking || booking.tutor_id !== user.id || booking.status !== "scheduled" || !booking.started_at) return { error: "Only a started tutor session can be marked complete." };

  const { data, error } = await supabase.from("bookings").update({ status: "completed" }).eq("id", booking.id).select("id").maybeSingle();
  if (error || !data) return { error: "We couldn’t complete the session. Please try again." };
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

export async function markSessionUpcomingAction(formData: FormData) {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  if (!bookingId.success) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, tutor_id, status")
    .eq("id", bookingId.data)
    .maybeSingle();
  if (!booking || booking.tutor_id !== user.id || booking.status !== "completed") return;
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "scheduled" })
    .eq("id", booking.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return;
  // Keep the original transcript and recording reference intact. If this is
  // eventually completed again, discard only derived output so it is rebuilt
  // from the stitched transcript rather than the first partial call.
  const admin = createAdminClient();
  await Promise.all([
    admin.from("session_analytics").update({ summary_notes: null, talk_ratio: null }).eq("booking_id", booking.id),
    admin.from("session_embeddings").delete().eq("booking_id", booking.id),
  ]);
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  redirect("/dashboard/tutor");
}

export type CancelSessionActionState = { error?: string; success?: boolean };

/** Cancel an unstarted session, or the unstarted remainder of its series. */
export async function cancelSessionAction(
  _previous: CancelSessionActionState,
  formData: FormData,
): Promise<CancelSessionActionState> {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  const cancelSeries = formData.get("cancel_series") === "on";
  if (!bookingId.success) return { error: "We couldn’t identify that session." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again before cancelling." };
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, tutor_id, student_id, status, started_at, start_time, recurrence_rule, recurrence_series_id")
    .eq("id", bookingId.data)
    .maybeSingle();
  if (!booking || booking.tutor_id !== user.id) return { error: "Only the tutor can cancel this session." };
  if (booking.status !== "scheduled" || booking.started_at) return { error: "Only sessions that have not been started can be cancelled." };

  let query = supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .eq("tutor_id", user.id)
    .eq("status", "scheduled")
    .is("started_at", null)
    .select("id");
  if (cancelSeries && booking.recurrence_rule) {
    query = query
      .eq("student_id", booking.student_id)
      .gte("start_time", booking.start_time);
    query = booking.recurrence_series_id
      ? query.eq("recurrence_series_id", booking.recurrence_series_id)
      : query.eq("recurrence_rule", booking.recurrence_rule);
  } else {
    query = query.eq("id", booking.id);
  }
  const { data, error } = await query;
  if (error || !data?.length) return { error: "We couldn’t cancel that session. Please try again." };
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
  return { success: true };
}

const PLATFORM_FEE_RATE = 0.15;

export async function sendSessionInvoiceAction(formData: FormData) {
  const bookingId = z.string().uuid().safeParse(formData.get("booking_id"));
  if (!bookingId.success || !process.env.STRIPE_SECRET_KEY) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: booking } = await supabase.from("bookings").select("*").eq("id", bookingId.data).maybeSingle<Booking>();
  if (!booking || booking.tutor_id !== user.id || booking.status !== "completed" || booking.is_trial || booking.stripe_invoice_id || !booking.amount_gbp_pence) return;
  const [{ data: student }, { data: tutor }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, stripe_customer_id, auto_charge_enabled").eq("id", booking.student_id).maybeSingle<Pick<Profile, "id" | "full_name" | "email" | "stripe_customer_id" | "auto_charge_enabled">>(),
    supabase.from("tutor_profiles").select("id, stripe_account_id").eq("id", booking.tutor_id).maybeSingle<Pick<TutorProfile, "id" | "stripe_account_id">>(),
  ]);
  if (!student) return;
  const stripe = getStripe();
  let customerId = student.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: student.email, name: student.full_name, metadata: { supabase_user_id: student.id } });
    customerId = customer.id;
    await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", student.id);
  }
  let payoutReady = false;
  if (tutor?.stripe_account_id) {
    const account = await stripe.v2.core.accounts.retrieve(tutor.stripe_account_id, { include: ["configuration.recipient"] });
    payoutReady = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
  }
  // Charge automatically only when the student opted in *and* Stripe still holds
  // a default payment method for them. Trusting the flag alone would promise
  // automatic payment and silently not collect.
  let chargeAutomatically = false;
  if (student.auto_charge_enabled) {
    const customer = await stripe.customers.retrieve(customerId);
    chargeAutomatically = Boolean(!customer.deleted && customer.invoice_settings?.default_payment_method);
  }

  const invoice = await stripe.invoices.create({
    customer: customerId,
    // send_invoice emails a link and waits. charge_automatically attempts the
    // saved method as soon as the invoice finalizes, which needs auto_advance so
    // Stripe progresses it rather than leaving it draft.
    ...(chargeAutomatically
      ? { collection_method: "charge_automatically" as const, auto_advance: true }
      : { collection_method: "send_invoice" as const, days_until_due: 7, auto_advance: false }),
    description: `${subjectLabel(booking.subject)} lesson`,
    metadata: { booking_id: booking.id },
    ...(payoutReady ? { transfer_data: { destination: tutor!.stripe_account_id! }, application_fee_amount: Math.round(booking.amount_gbp_pence * PLATFORM_FEE_RATE) } : {}),
  });
  await stripe.invoiceItems.create({ customer: customerId, invoice: invoice.id, currency: "gbp", amount: booking.amount_gbp_pence, description: `${subjectLabel(booking.subject)} lesson · ${new Date(booking.start_time).toLocaleDateString("en-GB")}`, metadata: { booking_id: booking.id } });
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  const sent = await stripe.invoices.sendInvoice(finalized.id);
  await supabase.from("bookings").update({ stripe_invoice_id: sent.id, stripe_invoice_url: sent.hosted_invoice_url, invoice_sent_at: new Date().toISOString(), payment_status: "pending" }).eq("id", booking.id);
  revalidatePath("/dashboard/tutor");
  revalidatePath("/dashboard/student");
}

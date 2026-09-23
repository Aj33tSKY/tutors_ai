"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { subjectLabel } from "@/lib/subjects";
import type { ExamBoard, Profile, StemSubject } from "@/lib/types";

export interface BookingFormState {
  error?: string;
}

// Platform's cut on bookings paid out directly to a tutor's connected
// Stripe account. Only applied when the tutor has payouts enabled — see
// the fallback note below.
const PLATFORM_FEE_RATE = 0.15;

export async function createCheckoutAction(
  tutorId: string,
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/sign-in?next=/tutors/${tutorId}`);

  const subject = String(formData.get("subject")) as StemSubject;
  const examBoard = String(formData.get("exam_board")) as ExamBoard;
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));

  if (!subject || !examBoard || !date || !time) {
    return { error: "Please choose a subject, exam board, date and time." };
  }

  const start = new Date(`${date}T${time}:00`);
  if (Number.isNaN(start.getTime()) || start < new Date()) {
    return { error: "Please choose a valid, future time." };
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  if (!process.env.STRIPE_SECRET_KEY) {
    return { error: "Payments aren't set up yet — please check back soon." };
  }

  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("hourly_rate, stripe_account_id, profiles!tutor_profiles_id_fkey(full_name)")
    .eq("id", tutorId)
    .maybeSingle<{
      hourly_rate: number;
      stripe_account_id: string | null;
      profiles: Pick<Profile, "full_name"> | Pick<Profile, "full_name">[];
    }>();

  if (!tutor) return { error: "This tutor is no longer available." };

  const tutorProfile = Array.isArray(tutor.profiles) ? tutor.profiles[0] : tutor.profiles;

  const host = (await headers()).get("host");
  const origin = `${host?.startsWith("localhost") ? "http" : "https"}://${host}`;

  const stripe = getStripe();

  // Destination charge straight to the tutor's connected account when
  // they've finished payout onboarding; otherwise the payment settles to
  // the platform account and the tutor is paid out manually until they
  // connect Stripe (see /dashboard/tutor/payouts). Checked live, not from a
  // cached flag — this decides where money moves.
  let payoutReady = false;
  if (tutor.stripe_account_id) {
    const account = await stripe.v2.core.accounts.retrieve(tutor.stripe_account_id, {
      include: ["configuration.recipient"],
    });
    payoutReady =
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ===
      "active";
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    line_items: [
      {
        price_data: {
          currency: "gbp",
          unit_amount: tutor.hourly_rate,
          product_data: {
            name: `${subjectLabel(subject)} session with ${tutorProfile?.full_name ?? "your tutor"}`,
            description: `${examBoard} · ${start.toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            })}`,
          },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: payoutReady
      ? {
          transfer_data: { destination: tutor.stripe_account_id! },
          application_fee_amount: Math.round(tutor.hourly_rate * PLATFORM_FEE_RATE),
        }
      : undefined,
    metadata: {
      student_id: user.id,
      tutor_id: tutorId,
      subject,
      exam_board: examBoard,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      amount_gbp_pence: String(tutor.hourly_rate),
    },
    success_url: `${origin}/dashboard/student?checkout=success`,
    cancel_url: `${origin}/tutors/${tutorId}?checkout=cancelled`,
  });

  if (!session.url) return { error: "Could not start checkout. Please try again." };

  redirect(session.url);
}

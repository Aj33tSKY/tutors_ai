import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return new Response("Webhook not configured", { status: 400 });
  }

  const body = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabase = createAdminClient();

  // Delayed-notification payment methods fire `checkout.session.completed`
  // while the session is still `unpaid`; the real confirmation arrives as
  // `checkout.session.async_payment_succeeded` later. Both events route
  // through the same fulfillment so neither path double-books or skips a
  // payment that succeeds asynchronously.
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "unpaid") break;
      await fulfillBooking(supabase, session);
      break;
    }

    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.warn("Checkout session payment failed asynchronously:", session.id);
      break;
    }

    default:
      break;
  }

  return new Response("ok", { status: 200 });
}

async function fulfillBooking(supabase: SupabaseClient, session: Stripe.Checkout.Session) {
  const m = session.metadata;
  if (!m?.student_id || !m.tutor_id || !m.subject || !m.exam_board) return;

  // Idempotent: Stripe can retry or send both completed + async_succeeded
  // for the same session, and stripe_checkout_session_id is unique, so a
  // repeat insert just no-ops instead of double-booking.
  const { error } = await supabase.from("bookings").insert({
    student_id: m.student_id,
    tutor_id: m.tutor_id,
    subject: m.subject,
    exam_board: m.exam_board,
    start_time: m.start_time,
    end_time: m.end_time,
    status: "scheduled",
    payment_status: "paid",
    amount_gbp_pence: m.amount_gbp_pence ? Number(m.amount_gbp_pence) : null,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
  });

  if (error && error.code !== "23505") {
    // 23505 = unique_violation, i.e. this session was already fulfilled
    console.error("Failed to create booking from Stripe webhook:", error);
  }
}

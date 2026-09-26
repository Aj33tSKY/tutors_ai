import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/** Marks a booking, but only if the invoice recorded against it still matches. */
async function setPaymentStatus(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  invoiceId: string,
  status: "paid" | "failed" | "pending",
  label: string,
) {
  const { error } = await supabase
    .from("bookings")
    .update({ payment_status: status })
    .eq("id", bookingId)
    .eq("stripe_invoice_id", invoiceId);
  if (error) console.error(`Failed to mark lesson invoice ${label}:`, error);
}

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) return new Response("Webhook not configured", { status: 400 });
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabase = createAdminClient();

  // Saving a payment method finishes here, not on the success page: a student
  // who closes the tab after authorising has still authorised it.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode !== "setup") return new Response("ok", { status: 200 });

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const setupIntentId =
      typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
    if (!customerId || !setupIntentId) return new Response("ok", { status: 200 });

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethod =
      typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;
    if (!paymentMethod) return new Response("ok", { status: 200 });

    // Making it the customer's default is what lets an invoice created with
    // collection_method: "charge_automatically" find it without this app
    // storing a copy that could go stale.
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod },
    });
    return new Response("ok", { status: 200 });
  }

  const invoice = event.data.object as Stripe.Invoice;
  const bookingId = invoice.metadata?.booking_id;
  if (!bookingId || !invoice.id) return new Response("ok", { status: 200 });

  if (event.type === "invoice.paid") {
    await setPaymentStatus(supabase, bookingId, invoice.id, "paid", "paid");
  }

  if (event.type === "invoice.payment_failed") {
    await setPaymentStatus(supabase, bookingId, invoice.id, "failed", "failed");
  }

  // An off-session charge that needs 3D Secure cannot complete without the
  // student present. Stripe stops and emails them the hosted invoice, so the
  // booking must not sit in a state implying payment is in hand. Dropping this
  // event would leave the tutor believing the lesson was charged.
  if (event.type === "invoice.payment_action_required") {
    await setPaymentStatus(supabase, bookingId, invoice.id, "pending", "awaiting authentication");
    console.warn(
      `Invoice ${invoice.id} for booking ${bookingId} needs customer authentication; Stripe has emailed the payment link.`,
    );
  }

  return new Response("ok", { status: 200 });
}

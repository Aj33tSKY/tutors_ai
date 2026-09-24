import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) return new Response("Webhook not configured", { status: 400 });
  const stripe = getStripe();
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await req.text(), signature, webhookSecret); }
  catch (error) { console.error("Stripe webhook signature verification failed:", error); return new Response("Invalid signature", { status: 400 }); }
  const supabase = createAdminClient();
  const invoice = event.data.object as Stripe.Invoice;
  const bookingId = invoice.metadata?.booking_id;
  if (!bookingId) return new Response("ok", { status: 200 });
  if (event.type === "invoice.paid") {
    const { error } = await supabase.from("bookings").update({ payment_status: "paid" }).eq("id", bookingId).eq("stripe_invoice_id", invoice.id);
    if (error) console.error("Failed to mark lesson invoice paid:", error);
  }
  if (event.type === "invoice.payment_failed") {
    const { error } = await supabase.from("bookings").update({ payment_status: "failed" }).eq("id", bookingId).eq("stripe_invoice_id", invoice.id);
    if (error) console.error("Failed to mark lesson invoice failed:", error);
  }
  return new Response("ok", { status: 200 });
}

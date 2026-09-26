"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

export type BillingActionState = { error?: string; success?: boolean };

async function getOrigin() {
  const host = (await headers()).get("host");
  return `${host?.startsWith("localhost") ? "http" : "https"}://${host}`;
}

/** Ensures the signed-in user has a Stripe customer, creating one on first use. */
async function currentCustomer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle<{ id: string; full_name: string; email: string; stripe_customer_id: string | null }>();
  if (!profile) redirect("/dashboard");

  if (profile.stripe_customer_id) return { supabase, profile, customerId: profile.stripe_customer_id };

  const customer = await getStripe().customers.create({
    email: profile.email,
    name: profile.full_name,
    metadata: { supabase_user_id: profile.id },
  });
  await supabase.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", profile.id);
  return { supabase, profile, customerId: customer.id };
}

/**
 * Sends the student to Stripe to authorise a payment method for future use.
 *
 * `mode: "setup"` rather than a bare SetupIntent: Checkout hosts the form, so
 * card details never reach this app, and Stripe surfaces whichever methods the
 * account has enabled — including BACS Direct Debit — without this code naming
 * any of them. Naming them with `payment_method_types` would lock out the rest.
 */
export async function savePaymentMethodAction() {
  if (!process.env.STRIPE_SECRET_KEY) redirect("/dashboard/student/billing?error=unconfigured");
  const { customerId } = await currentCustomer();
  const origin = await getOrigin();

  const session = await getStripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    // Checkout's setup mode already creates the SetupIntent with
    // usage=off_session, which is what future invoices need — there is no usage
    // field to set here.
    success_url: `${origin}/dashboard/student/billing?setup=complete`,
    cancel_url: `${origin}/dashboard/student/billing?setup=cancelled`,
  });

  if (!session.url) redirect("/dashboard/student/billing?error=setup");
  redirect(session.url);
}

/**
 * Stripe's own UI for managing saved methods, invoice history and cancellation.
 * Building that here would mean reimplementing mandate handling and dunning,
 * which is not a good place to be original.
 */
export async function openBillingPortalAction() {
  if (!process.env.STRIPE_SECRET_KEY) redirect("/dashboard/student/billing?error=unconfigured");
  const { customerId } = await currentCustomer();
  const origin = await getOrigin();

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard/student/billing`,
  });
  redirect(session.url);
}

export async function setAutoChargeAction(
  _previous: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const enabled = z.enum(["on", "off"]).safeParse(formData.get("enabled"));
  if (!enabled.success) return { error: "We couldn’t read that preference." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  if (enabled.data === "on") {
    // Turning this on without a saved method would promise automatic payment
    // and then quietly fall back to emailing a link.
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle<{ stripe_customer_id: string | null }>();
    if (!profile?.stripe_customer_id) {
      return { error: "Save a payment method before turning on automatic payment." };
    }
    const customer = await getStripe().customers.retrieve(profile.stripe_customer_id);
    const defaultMethod =
      !customer.deleted && customer.invoice_settings?.default_payment_method;
    if (!defaultMethod) {
      return { error: "Save a payment method before turning on automatic payment." };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ auto_charge_enabled: enabled.data === "on" })
    .eq("id", user.id);
  if (error) return { error: "We couldn’t save that preference. Please try again." };

  revalidatePath("/dashboard/student/billing");
  return { success: true };
}

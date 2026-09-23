"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

async function getOrigin() {
  const host = (await headers()).get("host");
  return `${host?.startsWith("localhost") ? "http" : "https"}://${host}`;
}

export async function startPayoutOnboardingAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const stripe = getStripe();
  const origin = await getOrigin();

  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("stripe_account_id")
    .eq("id", user.id)
    .maybeSingle();

  let accountId = tutor?.stripe_account_id ?? null;

  if (!accountId) {
    // Marketplace pattern (platform is merchant of record, destination
    // charges): Recipient + stripe_transfers is the documented minimum, but
    // this account's platform currently rejects stripe_transfers without
    // merchant.card_payments alongside it (verified live against the
    // sandbox — Stripe's own error names the exact fix). Requesting both is
    // what actually works; it doesn't change how charges are made — we
    // still only use recipient/transfers via destination charges.
    const account = await stripe.v2.core.accounts.create({
      contact_email: user.email,
      dashboard: "express",
      identity: { country: "GB" },
      defaults: {
        currency: "gbp",
        responsibilities: { fees_collector: "application", losses_collector: "application" },
      },
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
        merchant: {
          capabilities: { card_payments: { requested: true } },
        },
      },
    });
    accountId = account.id;
    await supabase.from("tutor_profiles").update({ stripe_account_id: accountId }).eq("id", user.id);
  }

  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient", "merchant"],
        refresh_url: `${origin}/dashboard/tutor/payouts`,
        return_url: `${origin}/dashboard/tutor/payouts?onboarding=return`,
      },
    },
  });

  redirect(link.url);
}

export async function openStripeDashboardAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const stripe = getStripe();

  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("stripe_account_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!tutor?.stripe_account_id) redirect("/dashboard/tutor/payouts");

  // Express dashboard login links are still issued via the v1 endpoint —
  // it operates on the same acct_ id namespace as v2-created accounts.
  const link = await stripe.accounts.createLoginLink(tutor.stripe_account_id);
  redirect(link.url);
}

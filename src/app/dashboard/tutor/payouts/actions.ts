"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { legacyBilling, legacyBillingContext, legacyOutcome } from "@/lib/billing-adapter";
import { openPayoutDashboard, startPayoutOnboarding } from "../../../../../packages/domain/src/billing";

async function getOrigin() {
  const host = (await headers()).get("host");
  return `${host?.startsWith("localhost") ? "http" : "https"}://${host}`;
}

export async function startPayoutOnboardingAction() {
  const context = await legacyBillingContext();
  if (!context) redirect("/sign-in");
  const result = await legacyOutcome(async () => startPayoutOnboarding(context.client, context.identity, legacyBilling, await getOrigin()));
  if (!result.ok) redirect("/dashboard/tutor/payouts");
  redirect(result.value.url);
}

export async function openStripeDashboardAction() {
  const context = await legacyBillingContext();
  if (!context) redirect("/sign-in");
  const result = await legacyOutcome(() => openPayoutDashboard(context.client, context.identity, legacyBilling));
  redirect(result.ok ? result.value.url : "/dashboard/tutor/payouts");
}

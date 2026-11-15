"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { legacyBilling, legacyBillingContext, legacyOutcome } from "@/lib/billing-adapter";
import { openBillingPortal, setAutoCharge, startPaymentMethodSetup } from "../../../../../packages/domain/src/billing";

export type BillingActionState = { error?: string; success?: boolean };

async function getOrigin() {
  const host = (await headers()).get("host");
  return `${host?.startsWith("localhost") ? "http" : "https"}://${host}`;
}

/** Sends the student to hosted Checkout (setup mode) so card details never reach this app. */
export async function savePaymentMethodAction() {
  const context = await legacyBillingContext();
  if (!context) redirect("/sign-in");
  const result = await legacyOutcome(async () => startPaymentMethodSetup(context.client, context.identity, legacyBilling, await getOrigin()));
  if (!result.ok) redirect(`/dashboard/student/billing?error=${result.code === "payments_unavailable" ? "unconfigured" : "setup"}`);
  redirect(result.value.url);
}

/** Stripe's own UI for saved methods, invoice history and cancellation. */
export async function openBillingPortalAction() {
  const context = await legacyBillingContext();
  if (!context) redirect("/sign-in");
  const result = await legacyOutcome(async () => openBillingPortal(context.client, context.identity, legacyBilling, await getOrigin()));
  if (!result.ok) redirect(`/dashboard/student/billing?error=${result.code === "payments_unavailable" ? "unconfigured" : "setup"}`);
  redirect(result.value.url);
}

export async function setAutoChargeAction(_previous: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const enabled = z.enum(["on", "off"]).safeParse(formData.get("enabled"));
  if (!enabled.success) return { error: "We couldn’t read that preference." };
  const context = await legacyBillingContext();
  if (!context) return { error: "Please sign in again." };
  const result = await legacyOutcome(() => setAutoCharge(context.client, context.identity, legacyBilling, enabled.data === "on"));
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard/student/billing");
  return { success: true };
}

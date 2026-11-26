import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../../contracts/src/index";
import { PLATFORM_FEE_RATE, type PayoutState, type RedirectUrl, type SavedMethod, type StudentBilling, type UnpaidLesson } from "../../contracts/src/billing";
import { AppError } from "./errors";
import { databaseResult, requireRole } from "./portal";

/** Everything the domain needs from a payment processor. Stripe is one adapter for it. */
export interface BillingProvider {
  /** Idempotent per user: concurrent first uses must resolve to one processor customer. */
  createCustomer(input: { userId: string; email: string; name: string }): Promise<string>;
  savedMethod(customerId: string): Promise<SavedMethod | null>;
  setupSession(input: { customerId: string; successUrl: string; cancelUrl: string }): Promise<string>;
  portalSession(input: { customerId: string; returnUrl: string }): Promise<string>;
  createPayoutAccount(input: { userId: string; email: string }): Promise<string>;
  onboardingLink(input: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<string>;
  dashboardLink(accountId: string): Promise<string>;
  /** True once the tutor's account can take card payments, which is what invoicing on it needs. */
  payoutsReady(accountId: string): Promise<boolean>;
  /** The student's customer on the tutor's own account. Idempotent per (account, student). */
  createConnectedCustomer(input: { accountId: string; userId: string; email: string; name: string }): Promise<string>;
  /**
   * Direct charge: the invoice is created on the tutor's account (`accountId`), with the platform's share as the application fee.
   * `customerId` is the student's customer ON that account. `autoChargeFromCustomerId` is the student's platform customer whose
   * saved card is cloned onto the account for automatic payment; without it a hosted invoice is emailed.
   */
  sendInvoice(input: { bookingId: string; accountId: string; customerId: string; description: string; itemDescription: string; amountPence: number;
    chargeAutomatically: boolean; autoChargeFromCustomerId: string | null; feePence: number }): Promise<{ id: string; url: string | null }>;
}
export type Billing = () => BillingProvider;
const unavailable = () => new AppError(503, "payments_unavailable", "Payments are not configured for this environment");
const provider = (billing: Billing | null) => { if (!billing) throw unavailable(); return billing(); };
async function viaProvider<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof AppError) throw error;
    // Class and code only: provider messages can carry personal data, but "connection error" versus "invalid request" is
    // what an operator needs to tell a runtime problem from a configuration one.
    const detail = error as { type?: string; code?: string; statusCode?: number; name?: string; cause?: { code?: string } };
    console.error(JSON.stringify({ event: "payment_provider_failed", type: detail?.type ?? detail?.name, code: detail?.code, status: detail?.statusCode, cause: detail?.cause?.code }));
    throw new AppError(502, "payments_failed", "The payment provider could not complete that; please try again");
  }
}

async function customerFor(client: SupabaseClient, identity: Identity, billing: BillingProvider) {
  const row = await client.from("profiles").select("stripe_customer_id,email,full_name").eq("id", identity.id).maybeSingle();
  databaseResult(row.error);
  const profile = row.data;
  if (!profile) throw new AppError(404, "not_found", "Account not found");
  if (profile.stripe_customer_id) return profile.stripe_customer_id as string;
  const created = await viaProvider(() => billing.createCustomer({ userId: identity.id, email: profile.email, name: profile.full_name }));
  // First write wins; a concurrent request that lost the race adopts the stored customer.
  const claimed = await client.rpc("claim_stripe_customer_v1", { p_customer: created });
  databaseResult(claimed.error);
  return claimed.data as string;
}

export async function studentBilling(client: SupabaseClient, identity: Identity, billing: Billing | null): Promise<StudentBilling> {
  requireRole(identity, ["student"]);
  const [profile, unpaid] = await Promise.all([
    client.from("profiles").select("stripe_customer_id,auto_charge_enabled").eq("id", identity.id).maybeSingle(),
    client.from("bookings").select("id,start_time,amount_gbp_pence,stripe_invoice_url,payment_status,lesson_name").eq("student_id", identity.id)
      .eq("payment_status", "pending").not("stripe_invoice_url", "is", null).order("start_time", { ascending: false }).limit(100).returns<UnpaidLesson[]>(),
  ]);
  databaseResult(profile.error); databaseResult(unpaid.error);
  const customerId = profile.data?.stripe_customer_id as string | null | undefined;
  let savedMethod: SavedMethod | null = null;
  // Money moves against the processor's record, so read it there. An outage still renders the page.
  if (billing && customerId) savedMethod = await billing().savedMethod(customerId).catch(() => null);
  return { configured: Boolean(billing), hasCustomer: Boolean(customerId), autoChargeEnabled: Boolean(profile.data?.auto_charge_enabled) && Boolean(savedMethod),
    savedMethod, unpaid: unpaid.data ?? [] };
}
export async function startPaymentMethodSetup(client: SupabaseClient, identity: Identity, billing: Billing | null, origin: string): Promise<RedirectUrl> {
  requireRole(identity, ["student"]);
  const provider_ = provider(billing);
  const customerId = await customerFor(client, identity, provider_);
  return { url: await viaProvider(() => provider_.setupSession({ customerId, successUrl: `${origin}/dashboard/student/billing?setup=complete`, cancelUrl: `${origin}/dashboard/student/billing?setup=cancelled` })) };
}
export async function openBillingPortal(client: SupabaseClient, identity: Identity, billing: Billing | null, origin: string): Promise<RedirectUrl> {
  requireRole(identity, ["student"]);
  const provider_ = provider(billing);
  const customerId = await customerFor(client, identity, provider_);
  return { url: await viaProvider(() => provider_.portalSession({ customerId, returnUrl: `${origin}/dashboard/student/billing` })) };
}
export async function setAutoCharge(client: SupabaseClient, identity: Identity, billing: Billing | null, enabled: boolean) {
  requireRole(identity, ["student"]);
  if (enabled) {
    // Enabling without a saved method would promise automatic payment and quietly email a link instead.
    const state = await studentBilling(client, identity, billing);
    if (!state.savedMethod) throw new AppError(409, "no_payment_method", "Save a payment method before turning on automatic payment.");
  }
  const result = await client.from("profiles").update({ auto_charge_enabled: enabled }).eq("id", identity.id);
  databaseResult(result.error);
}

export async function payoutState(client: SupabaseClient, identity: Identity, billing: Billing | null): Promise<PayoutState> {
  requireRole(identity, ["tutor"]);
  const row = await client.from("tutor_profiles").select("stripe_account_id,stripe_payouts_enabled").eq("id", identity.id).maybeSingle();
  databaseResult(row.error);
  const accountId = row.data?.stripe_account_id as string | null | undefined;
  let payoutsEnabled = Boolean(row.data?.stripe_payouts_enabled);
  if (billing && accountId) {
    // Synchronise on read as before, but through the privileged function rather than a direct column write.
    const ready = await billing().payoutsReady(accountId).catch(() => null);
    if (ready !== null && ready !== payoutsEnabled) {
      databaseResult((await client.rpc("set_payouts_enabled_v1", { p_enabled: ready })).error);
      payoutsEnabled = ready;
    }
  }
  return { configured: Boolean(billing), connected: Boolean(accountId), payoutsEnabled };
}
export async function startPayoutOnboarding(client: SupabaseClient, identity: Identity, billing: Billing | null, origin: string): Promise<RedirectUrl> {
  requireRole(identity, ["tutor"]);
  const provider_ = provider(billing);
  const row = await client.from("tutor_profiles").select("stripe_account_id").eq("id", identity.id).maybeSingle();
  databaseResult(row.error);
  let accountId = row.data?.stripe_account_id as string | null | undefined;
  if (!accountId) {
    const created = await viaProvider(() => provider_.createPayoutAccount({ userId: identity.id, email: identity.email }));
    const claimed = await client.rpc("claim_stripe_account_v1", { p_account: created });
    databaseResult(claimed.error); accountId = claimed.data as string;
  }
  const connected = accountId!;
  return { url: await viaProvider(() => provider_.onboardingLink({ accountId: connected, refreshUrl: `${origin}/dashboard/tutor/payouts`, returnUrl: `${origin}/dashboard/tutor/payouts?onboarding=return` })) };
}
export async function openPayoutDashboard(client: SupabaseClient, identity: Identity, billing: Billing | null): Promise<RedirectUrl> {
  requireRole(identity, ["tutor"]);
  const provider_ = provider(billing);
  const row = await client.from("tutor_profiles").select("stripe_account_id").eq("id", identity.id).maybeSingle();
  databaseResult(row.error);
  if (!row.data?.stripe_account_id) throw new AppError(409, "not_connected", "Connect a payout account first");
  const accountId = row.data.stripe_account_id as string;
  return { url: await viaProvider(() => provider_.dashboardLink(accountId)) };
}

const subjectName = (subject: string | null) => (subject ?? "Tutoring").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export async function sendLessonInvoice(client: SupabaseClient, identity: Identity, billing: Billing | null, bookingId: string): Promise<{ invoiceId: string }> {
  requireRole(identity, ["tutor"]);
  const provider_ = provider(billing);
  const found = await client.from("bookings").select("id,tutor_id,student_id,status,is_trial,stripe_invoice_id,amount_gbp_pence,subject,start_time").eq("id", bookingId).maybeSingle();
  databaseResult(found.error);
  const booking = found.data;
  // Each condition has its own message; one shared string once hid which rule had refused.
  if (!booking || booking.tutor_id !== identity.id) throw new AppError(404, "not_found", "That session is not yours to invoice.");
  if (booking.status !== "completed") throw new AppError(409, "not_completed", "Mark the session complete before invoicing it.");
  if (booking.is_trial) throw new AppError(409, "trial_session", "This session was a free trial, so there is nothing to invoice.");
  if (booking.stripe_invoice_id) throw new AppError(409, "already_invoiced", "An invoice has already been sent for this session.");
  if (!booking.amount_gbp_pence) throw new AppError(409, "no_price", "This session has no price recorded, so it cannot be invoiced.");
  const [student, tutor] = await Promise.all([
    client.from("profiles").select("id,email,full_name,stripe_customer_id,auto_charge_enabled").eq("id", booking.student_id).maybeSingle(),
    client.from("tutor_profiles").select("stripe_account_id").eq("id", identity.id).maybeSingle(),
  ]);
  databaseResult(student.error); databaseResult(tutor.error);
  if (!student.data) throw new AppError(404, "not_found", "We couldn’t find the student for this session.");
  // The tutor is the seller (direct charge), so the invoice can only be raised on their own Stripe account. There is no
  // fallback to the platform account: that would make the platform the seller of record and bear the refund and dispute risk.
  const accountId = tutor.data?.stripe_account_id as string | null | undefined;
  const notReady = () => new AppError(409, "payouts_not_ready", "Finish connecting your Stripe account in Payouts before invoicing a lesson.");
  if (!accountId) throw notReady();
  if (!(await viaProvider(() => provider_.payoutsReady(accountId)))) throw notReady();
  // The student's customer on the tutor's account is recorded through a narrow, first-write-wins function, one per
  // (student, tutor account), so later lessons reuse it and a retry after the idempotency window cannot duplicate it.
  const stored = await client.rpc("connected_customer_for_booking_v1", { p_booking: booking.id });
  databaseResult(stored.error);
  let connectedCustomer = stored.data as string | null;
  if (!connectedCustomer) {
    const created = await viaProvider(() => provider_.createConnectedCustomer({ accountId, userId: student.data!.id, email: student.data!.email, name: student.data!.full_name }));
    const claimed = await client.rpc("claim_connected_customer_v1", { p_booking: booking.id, p_customer: created });
    databaseResult(claimed.error); connectedCustomer = claimed.data as string;
  }
  const platformCustomer = student.data.stripe_customer_id as string | null;
  const sent = await viaProvider(async () => {
    // Automatic payment needs a saved card on the student's platform customer; otherwise a hosted invoice is emailed.
    const method = student.data!.auto_charge_enabled && platformCustomer ? await provider_.savedMethod(platformCustomer) : null;
    return provider_.sendInvoice({ bookingId: booking.id, accountId, customerId: connectedCustomer!, description: `${subjectName(booking.subject)} lesson`,
      itemDescription: `${subjectName(booking.subject)} lesson · ${new Date(booking.start_time).toLocaleDateString("en-GB")}`, amountPence: booking.amount_gbp_pence,
      chargeAutomatically: Boolean(method), autoChargeFromCustomerId: method ? platformCustomer : null, feePence: Math.round(booking.amount_gbp_pence * PLATFORM_FEE_RATE) });
  });
  const recorded = await client.rpc("record_booking_invoice_v1", { p_booking: booking.id, p_invoice: sent.id, p_url: sent.url });
  databaseResult(recorded.error);
  // The invoice is already with the student; say so rather than implying it failed.
  if (!recorded.data) throw new AppError(409, "invoice_not_recorded", "The invoice was sent, but we could not record it against this session. Refresh before sending another.");
  return { invoiceId: sent.id };
}

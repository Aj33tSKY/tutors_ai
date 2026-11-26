import Stripe from "stripe";
import type { BillingProvider } from "../../domain/src/billing";

/**
 * Stripe adapter. Every create call carries a deterministic idempotency key so a retry after a
 * partial failure resumes the same objects instead of billing twice. Stripe keeps keys for 24 hours;
 * durable duplicate protection is the database's first-write-wins identifiers and invoice recording.
 */
export function stripeBilling(secretKey = process.env.STRIPE_SECRET_KEY, stripe = secretKey ? new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20000 }) : null): (() => BillingProvider) | null {
  if (!stripe) return null;
  const api = stripe;
  const provider: BillingProvider = {
    async createCustomer({ userId, email, name }) {
      return (await api.customers.create({ email, name, metadata: { supabase_user_id: userId } }, { idempotencyKey: `customer:${userId}` })).id;
    },
    async savedMethod(customerId) {
      const customer = await api.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
      const method = customer.deleted ? null : customer.invoice_settings?.default_payment_method;
      if (!method || typeof method === "string") return null;
      return { kind: method.type, brand: method.card?.brand ?? method.type, last4: method.card?.last4 ?? method.bacs_debit?.last4 ?? "" };
    },
    async setupSession({ customerId, successUrl, cancelUrl }) {
      // Setup-mode Checkout keeps card details off this app and surfaces whichever methods the account enables.
      // Stripe's current API version rejects a setup-mode session without a currency (parameter_missing), which is what lets it
      // choose the payment methods to offer. Lessons are priced in pounds.
      const session = await api.checkout.sessions.create({ mode: "setup", currency: "gbp", customer: customerId, success_url: successUrl, cancel_url: cancelUrl });
      if (!session.url) throw new Error("Checkout returned no URL");
      return session.url;
    },
    async portalSession({ customerId, returnUrl }) { return (await api.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })).url; },
    async createPayoutAccount({ userId, email }) {
      // Direct charges: the tutor is the seller, so this is a full-dashboard account in which Stripe collects fees and carries
      // negative balances. That is the generally available combination Stripe documents for a full dashboard (both collectors
      // must be "stripe"); it leaves the platform with no liability for a tutor's refunds or disputes. Only the merchant
      // configuration is needed: the tutor takes the payment themselves, nothing is transferred to them.
      const account = await api.v2.core.accounts.create({
        contact_email: email, dashboard: "full", identity: { country: "GB" },
        defaults: { currency: "gbp", responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      }, { idempotencyKey: `payout-account:${userId}` });
      return account.id;
    },
    async onboardingLink({ accountId, refreshUrl, returnUrl }) {
      return (await api.v2.core.accountLinks.create({ account: accountId, use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], refresh_url: refreshUrl, return_url: returnUrl } } })).url;
    },
    // A full-dashboard account owns its Stripe dashboard (Stripe login links exist only for Express accounts).
    async dashboardLink() { return "https://dashboard.stripe.com/"; },
    async payoutsReady(accountId) {
      // "Ready" means the tutor can take card payments, which is what invoicing on their account needs.
      const account = await api.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant"] });
      return account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
    },
    async createConnectedCustomer({ accountId, userId, email, name }) {
      // The student's customer on the TUTOR's account. One per (student, tutor): the database remembers it.
      return (await api.customers.create({ email, name, metadata: { supabase_user_id: userId } }, { stripeAccount: accountId, idempotencyKey: `connected-customer:${accountId}:${userId}` })).id;
    },
    async sendInvoice(input) {
      // Direct charge: every call runs ON the tutor's account (stripeAccount), so the tutor is the seller of record and the
      // refund and dispute risk sits with their balance. The platform's share is the application fee.
      const on = (step: string) => ({ stripeAccount: input.accountId, idempotencyKey: `${step}:${input.bookingId}` });
      let defaultPaymentMethod: string | undefined;
      if (input.chargeAutomatically && input.autoChargeFromCustomerId) {
        // The card was saved on the platform customer. Clone it onto the tutor's account and attach it to the connected
        // customer so the invoice can be charged off-session there.
        const platform = await api.customers.retrieve(input.autoChargeFromCustomerId);
        const methodId = platform.deleted ? null : (typeof platform.invoice_settings?.default_payment_method === "string" ? platform.invoice_settings.default_payment_method : platform.invoice_settings?.default_payment_method?.id);
        if (methodId) {
          const clone = await api.paymentMethods.create({ customer: input.autoChargeFromCustomerId, payment_method: methodId }, on("method-clone"));
          await api.paymentMethods.attach(clone.id, { customer: input.customerId }, on("method-attach"));
          defaultPaymentMethod = clone.id;
        }
      }
      const charge = Boolean(defaultPaymentMethod);
      const invoice = await api.invoices.create({
        customer: input.customerId,
        // charge_automatically tries the saved method when the invoice finalises and needs auto_advance;
        // send_invoice emails a hosted link and waits.
        ...(charge ? { collection_method: "charge_automatically" as const, auto_advance: true, default_payment_method: defaultPaymentMethod } : { collection_method: "send_invoice" as const, days_until_due: 7, auto_advance: false }),
        description: input.description, metadata: { booking_id: input.bookingId }, application_fee_amount: input.feePence,
      }, on("invoice"));
      await api.invoiceItems.create({ customer: input.customerId, invoice: invoice.id, currency: "gbp", amount: input.amountPence, description: input.itemDescription, metadata: { booking_id: input.bookingId } }, on("invoice-item"));
      const finalized = await api.invoices.finalizeInvoice(invoice.id, undefined, on("invoice-finalize"));
      const sent = charge ? finalized : await api.invoices.sendInvoice(finalized.id, undefined, on("invoice-send"));
      return { id: sent.id, url: sent.hosted_invoice_url ?? null };
    },
  };
  return () => provider;
}

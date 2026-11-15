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
      const session = await api.checkout.sessions.create({ mode: "setup", customer: customerId, success_url: successUrl, cancel_url: cancelUrl });
      if (!session.url) throw new Error("Checkout returned no URL");
      return session.url;
    },
    async portalSession({ customerId, returnUrl }) { return (await api.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })).url; },
    async createPayoutAccount({ userId, email }) {
      // Recipient + stripe_transfers needs merchant card_payments alongside it on this platform (verified in sandbox).
      const account = await api.v2.core.accounts.create({
        contact_email: email, dashboard: "express", identity: { country: "GB" },
        defaults: { currency: "gbp", responsibilities: { fees_collector: "application", losses_collector: "application" } },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } }, merchant: { capabilities: { card_payments: { requested: true } } } },
      }, { idempotencyKey: `payout-account:${userId}` });
      return account.id;
    },
    async onboardingLink({ accountId, refreshUrl, returnUrl }) {
      return (await api.v2.core.accountLinks.create({ account: accountId, use_case: { type: "account_onboarding", account_onboarding: { configurations: ["recipient", "merchant"], refresh_url: refreshUrl, return_url: returnUrl } } })).url;
    },
    async dashboardLink(accountId) { return (await api.accounts.createLoginLink(accountId)).url; },
    async payoutsReady(accountId) {
      const account = await api.v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient"] });
      return account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
    },
    async sendInvoice(input) {
      const key = (step: string) => ({ idempotencyKey: `${step}:${input.bookingId}` });
      const invoice = await api.invoices.create({
        customer: input.customerId,
        // charge_automatically tries the saved method when the invoice finalises and needs auto_advance;
        // send_invoice emails a hosted link and waits.
        ...(input.chargeAutomatically ? { collection_method: "charge_automatically" as const, auto_advance: true } : { collection_method: "send_invoice" as const, days_until_due: 7, auto_advance: false }),
        description: input.description, metadata: { booking_id: input.bookingId },
        ...(input.destinationAccountId ? { transfer_data: { destination: input.destinationAccountId }, application_fee_amount: input.feePence } : {}),
      }, key("invoice"));
      await api.invoiceItems.create({ customer: input.customerId, invoice: invoice.id, currency: "gbp", amount: input.amountPence, description: input.itemDescription, metadata: { booking_id: input.bookingId } }, key("invoice-item"));
      const finalized = await api.invoices.finalizeInvoice(invoice.id, undefined, key("invoice-finalize"));
      const sent = await api.invoices.sendInvoice(finalized.id, undefined, key("invoice-send"));
      return { id: sent.id, url: sent.hosted_invoice_url ?? null };
    },
  };
  return () => provider;
}

import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { stripeBilling } from "../../packages/data/src/stripe.js";
import { stripeVerifier } from "../../apps/api/src/stripe-webhook.js";

// A fake Stripe that enforces what the real one now enforces, which the earlier fakes did not: a setup-mode Checkout Session
// must carry a currency, otherwise Stripe answers parameter_missing and saving a card silently fails for every student.
test("saving a card creates a setup-mode checkout session with a currency", async () => {
  const calls: Record<string, unknown>[] = [];
  const stripe = { checkout: { sessions: { create: async (params: Record<string, unknown>) => {
    if (params.mode === "setup" && !params.currency) throw Object.assign(new Error("Missing required param: currency."), { type: "StripeInvalidRequestError", code: "parameter_missing" });
    calls.push(params); return { url: "https://checkout.stripe.com/c/pay/cs_test_x" };
  } } } };
  const billing = stripeBilling("sk_test_fake", stripe as never)!();
  const url = await billing.setupSession({ customerId: "cus_1", successUrl: "https://app.test/billing?setup=complete", cancelUrl: "https://app.test/billing?setup=cancelled" });
  assert.equal(url, "https://checkout.stripe.com/c/pay/cs_test_x");
  assert.equal(calls[0].currency, "gbp");
  assert.equal(calls[0].mode, "setup");
  assert.equal(calls[0].customer, "cus_1");
});

type Call = { op: string; params: Record<string, unknown>; options: Record<string, unknown> | undefined };
// Records every call with its request options. A direct charge is defined by running ON the tutor's account, so the fake
// refuses to create an invoice, invoice item or cloned method without a stripeAccount, and refuses transfer_data (that is a
// destination charge, which would make the platform the seller of record).
function fakeStripe(calls: Call[], opts: { defaultMethod?: string | null } = {}) {
  const need = (op: string, options?: Record<string, unknown>) => { if (!options?.stripeAccount) throw new Error(`${op} must run on the connected account`); };
  const record = (op: string, params: Record<string, unknown>, options?: Record<string, unknown>) => { calls.push({ op, params, options }); };
  return {
    customers: {
      retrieve: async () => ({ deleted: false, invoice_settings: { default_payment_method: opts.defaultMethod === undefined ? "pm_platform" : opts.defaultMethod } }),
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => { need("customers.create", options); record("customers.create", params, options); return { id: "cus_connected" }; },
    },
    paymentMethods: {
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => { need("paymentMethods.create", options); record("paymentMethods.create", params, options); return { id: "pm_clone" }; },
      attach: async (id: string, params: Record<string, unknown>, options?: Record<string, unknown>) => { need("paymentMethods.attach", options); record("paymentMethods.attach", { id, ...params }, options); return { id }; },
    },
    invoices: {
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        need("invoices.create", options);
        if ("transfer_data" in params) throw new Error("transfer_data makes this a destination charge");
        record("invoices.create", params, options); return { id: "in_1" };
      },
      finalizeInvoice: async (id: string, _params: unknown, options?: Record<string, unknown>) => { need("invoices.finalizeInvoice", options); record("invoices.finalizeInvoice", { id }, options); return { id, hosted_invoice_url: "https://invoice.stripe.com/i/acct/in_1" }; },
      sendInvoice: async (id: string, _params: unknown, options?: Record<string, unknown>) => { need("invoices.sendInvoice", options); record("invoices.sendInvoice", { id }, options); return { id, hosted_invoice_url: "https://invoice.stripe.com/i/acct/in_1" }; },
    },
    invoiceItems: { create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => { need("invoiceItems.create", options); record("invoiceItems.create", params, options); return { id: "ii_1" }; } },
  };
}
const lesson = { bookingId: "11111111-1111-4111-8111-111111111111", accountId: "acct_tutor", customerId: "cus_connected", description: "Maths lesson", itemDescription: "Maths lesson · 26/11/2026", amountPence: 4000, feePence: 600 };

test("a hosted invoice is a direct charge: created on the tutor's account, with the platform's share as the application fee", async () => {
  const calls: Call[] = [];
  const billing = stripeBilling("sk_test_fake", fakeStripe(calls) as never)!();
  const sent = await billing.sendInvoice({ ...lesson, chargeAutomatically: false, autoChargeFromCustomerId: null });
  assert.deepEqual(sent, { id: "in_1", url: "https://invoice.stripe.com/i/acct/in_1" });
  assert.ok(calls.every((call) => call.options?.stripeAccount === "acct_tutor"), "every call runs on the tutor's account");
  const invoice = calls.find((call) => call.op === "invoices.create")!.params;
  assert.equal(invoice.application_fee_amount, 600);
  assert.equal(invoice.collection_method, "send_invoice");
  assert.equal("transfer_data" in invoice, false);
  assert.deepEqual(calls.map((call) => call.op), ["invoices.create", "invoiceItems.create", "invoices.finalizeInvoice", "invoices.sendInvoice"]);
  assert.ok(calls.every((call) => String(call.options?.idempotencyKey).endsWith(lesson.bookingId)), "retries resume the same objects");
});

test("automatic payment clones the student's saved card onto the tutor's account and charges it there", async () => {
  const calls: Call[] = [];
  const billing = stripeBilling("sk_test_fake", fakeStripe(calls) as never)!();
  await billing.sendInvoice({ ...lesson, chargeAutomatically: true, autoChargeFromCustomerId: "cus_platform" });
  const clone = calls.find((call) => call.op === "paymentMethods.create")!;
  assert.deepEqual(clone.params, { customer: "cus_platform", payment_method: "pm_platform" });
  assert.deepEqual(calls.find((call) => call.op === "paymentMethods.attach")!.params, { id: "pm_clone", customer: "cus_connected" });
  const invoice = calls.find((call) => call.op === "invoices.create")!.params;
  assert.deepEqual([invoice.collection_method, invoice.default_payment_method, invoice.auto_advance, invoice.application_fee_amount], ["charge_automatically", "pm_clone", true, 600]);
  assert.equal(calls.some((call) => call.op === "invoices.sendInvoice"), false, "a charged invoice is paid on finalising, not emailed as a link");
});

test("if the platform customer has no saved card the lesson falls back to a hosted invoice", async () => {
  const calls: Call[] = [];
  const billing = stripeBilling("sk_test_fake", fakeStripe(calls, { defaultMethod: null }) as never)!();
  await billing.sendInvoice({ ...lesson, chargeAutomatically: true, autoChargeFromCustomerId: "cus_platform" });
  assert.equal(calls.find((call) => call.op === "invoices.create")!.params.collection_method, "send_invoice");
  assert.equal(calls.some((call) => call.op === "paymentMethods.create"), false);
});

test("the student's customer is created on the tutor's account", async () => {
  const calls: Call[] = [];
  const billing = stripeBilling("sk_test_fake", fakeStripe(calls) as never)!();
  assert.equal(await billing.createConnectedCustomer({ accountId: "acct_tutor", userId: "u1", email: "s@example.test", name: "S" }), "cus_connected");
  assert.equal(calls[0].options?.stripeAccount, "acct_tutor");
});

test("a tutor's account is full-dashboard with Stripe collecting fees and losses, and takes payments itself", async () => {
  let created: Record<string, unknown> = {}; let link: Record<string, unknown> = {};
  const stripe = { v2: { core: { accounts: {
    create: async (params: Record<string, unknown>) => {
      // Stripe's rule for a full dashboard: both collectors must be "stripe".
      const responsibilities = (params.defaults as { responsibilities: Record<string, string> }).responsibilities;
      if (params.dashboard === "full" && (responsibilities.fees_collector !== "stripe" || responsibilities.losses_collector !== "stripe")) throw new Error("full dashboard requires both collectors to be stripe");
      created = params; return { id: "acct_new" };
    },
    retrieve: async () => ({ configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } } }),
  }, accountLinks: { create: async (params: Record<string, unknown>) => { link = params; return { url: "https://connect.stripe.com/setup/x" }; } } } } };
  const billing = stripeBilling("sk_test_fake", stripe as never)!();
  assert.equal(await billing.createPayoutAccount({ userId: "u1", email: "t@example.test" }), "acct_new");
  assert.equal(created.dashboard, "full");
  assert.deepEqual(Object.keys(created.configuration as object), ["merchant"], "no recipient configuration: nothing is transferred to the tutor");
  await billing.onboardingLink({ accountId: "acct_new", refreshUrl: "https://app.test/r", returnUrl: "https://app.test/ok" });
  assert.deepEqual((link.use_case as { account_onboarding: { configurations: string[] } }).account_onboarding.configurations, ["merchant"]);
  assert.equal(await billing.payoutsReady("acct_new"), true);
  assert.equal(await billing.dashboardLink("acct_new"), "https://dashboard.stripe.com/");
});

test("webhooks are accepted when signed with the platform secret or the Connect secret, and refused otherwise", async () => {
  const platform = "whsec_platform_test"; const connect = "whsec_connect_test"; const body = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });
  const sign = (secret: string) => Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  const verify = stripeVerifier([platform, connect])!;
  assert.equal((await verify(body, sign(platform))).id, "evt_1");
  assert.equal((await verify(body, sign(connect))).id, "evt_1");
  await assert.rejects(verify(body, sign("whsec_someone_else")));
  await assert.rejects(verify(body.replace("evt_1", "evt_2"), sign(platform)), "a tampered body fails");
  assert.equal(stripeVerifier([undefined, ""]), null, "with no secret configured there is no verifier");
  assert.equal((await stripeVerifier([platform, undefined])!(body, sign(platform))).id, "evt_1", "the Connect secret is optional");
});

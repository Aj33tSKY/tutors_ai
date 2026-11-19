import assert from "node:assert/strict";
import test from "node:test";
import { stripeBilling } from "../../packages/data/src/stripe.js";

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

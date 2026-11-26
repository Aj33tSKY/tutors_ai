// Proves the direct-charge invoice flow against the real Stripe SANDBOX, using the app's own Stripe adapter:
//   - the student's customer is created on the tutor's account;
//   - automatic payment: the saved card is cloned onto the tutor's account, the invoice is paid there, and the platform's share
//     arrives as an application fee (the tutor, not the platform, is the seller);
//   - without a saved card the invoice is a hosted link (open).
// The connected account is a throwaway Custom account with Stripe's published test data, deleted at the end. The charge mechanics
// are identical to a Standard account's; only onboarding differs, and that needs a person. Needs Connect enabled on the sandbox.
import Stripe from "stripe";
import { readFileSync } from "node:fs"; import { homedir } from "node:os";
import { stripeBilling } from "../../packages/data/src/stripe.js";

const env = Object.fromEntries(readFileSync(`${homedir()}/.tutors-backups/staging-env/worker.env`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const key = env.STRIPE_SECRET_KEY; if (!key?.startsWith("sk_test_")) throw new Error("Refusing: not a sandbox key.");
const api = new Stripe(key); const billing = stripeBilling(key)!();
const step = (name: string, detail = "") => console.log(`ok   ${name}${detail ? ` (${detail})` : ""}`);
const stamp = Date.now();

const account = await api.accounts.create({
  type: "custom", country: "GB", email: `direct-charge-${stamp}@example.com`, business_type: "individual",
  capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  business_profile: { mcc: "8299", url: "https://staging.hybridtutors.co.uk", product_description: "Tutoring" },
  individual: { first_name: "Test", last_name: "Tutor", email: `direct-charge-${stamp}@example.com`, phone: "+447700900123", dob: { day: 1, month: 1, year: 1990 }, address: { line1: "1 Test Street", city: "London", postal_code: "SW1A 1AA", country: "GB" } },
  external_account: { object: "bank_account", country: "GB", currency: "gbp", account_number: "00012345", routing_number: "108800" },
  tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
});
try {
  for (let i = 0; i < 15; i++) { const a = await api.accounts.retrieve(account.id); if (a.capabilities?.card_payments === "active") break; await new Promise((r) => setTimeout(r, 2000)); }
  step("throwaway connected account can take card payments", account.id);

  const platformCustomer = await api.customers.create({ email: "direct-charge-student@example.com", name: "Direct Charge Student" });
  const method = await api.paymentMethods.attach("pm_card_visa", { customer: platformCustomer.id });
  await api.customers.update(platformCustomer.id, { invoice_settings: { default_payment_method: method.id } });
  step("student's card saved on the platform customer", `${method.card?.brand} ${method.card?.last4}`);

  const connectedCustomer = await billing.createConnectedCustomer({ accountId: account.id, userId: `e2e-${stamp}`, email: "direct-charge-student@example.com", name: "Direct Charge Student" });
  step("student's customer created on the tutor's account", connectedCustomer);

  const base = { accountId: account.id, customerId: connectedCustomer, description: "Maths lesson", itemDescription: "Maths lesson · e2e", amountPence: 4000, feePence: 600 };
  const paid = await billing.sendInvoice({ ...base, bookingId: crypto.randomUUID(), chargeAutomatically: true, autoChargeFromCustomerId: platformCustomer.id });
  const invoice = await api.invoices.retrieve(paid.id, { expand: ["charge"] }, { stripeAccount: account.id }) as Stripe.Invoice & { charge?: Stripe.Charge | string | null };
  if (invoice.status !== "paid") throw new Error(`automatic payment did not settle: ${invoice.status}`);
  step("automatic payment settled on the tutor's account", `invoice ${invoice.id}, ${invoice.amount_paid} pence`);
  const fees = await api.applicationFees.list({ limit: 5 });
  const fee = fees.data.find((f) => f.account === account.id && f.amount === 600);
  if (!fee) throw new Error("the platform's 600p application fee was not created");
  step("the platform's share arrived as an application fee", `${fee.id}, ${fee.amount} pence`);

  const hosted = await billing.sendInvoice({ ...base, bookingId: crypto.randomUUID(), chargeAutomatically: false, autoChargeFromCustomerId: null });
  const open = await api.invoices.retrieve(hosted.id, undefined, { stripeAccount: account.id });
  if (open.status !== "open" || !hosted.url) throw new Error(`hosted invoice not open (${open.status})`);
  step("without a saved card the invoice is a hosted link", hosted.url.slice(0, 40) + "…");
  console.log("\nDirect-charge flow passed against the Stripe sandbox.");
} finally {
  await api.accounts.del(account.id).then(() => console.log("(throwaway connected account deleted)")).catch((e: Error) => console.log("could not delete throwaway account:", e.message.slice(0, 80)));
}

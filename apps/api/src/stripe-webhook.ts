import Stripe from "stripe";

/**
 * Stripe signs events from two kinds of endpoint, each with its own secret: the platform's own events (a card saved through
 * Checkout) and Connect events from tutors' accounts (their lesson invoices being paid). Both post to the same URL, so a
 * signature is accepted if EITHER secret verifies it. Anything signed with neither is rejected.
 * The async form runs on Node and on runtimes that only provide asynchronous Web Crypto (Cloudflare Workers).
 */
export function stripeVerifier(secrets: Array<string | undefined>) {
  const usable = secrets.filter((secret): secret is string => Boolean(secret));
  if (!usable.length) return null;
  return async (raw: string, header: string) => {
    let failure: unknown;
    for (const secret of usable) {
      try { return await Stripe.webhooks.constructEventAsync(raw, header, secret); } catch (error) { failure = error; }
    }
    throw failure;
  };
}

import "server-only";
import Stripe from "stripe";

// Lazy singleton: reading STRIPE_SECRET_KEY at module load time would crash
// `next build` before Marketplace provisioning ever sets it.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

/** GBP pence, matching how rates are already stored in tutor_profiles.hourly_rate. */
export function gbp(pence: number) {
  return (pence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

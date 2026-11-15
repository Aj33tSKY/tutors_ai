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

export { gbp } from "./money";

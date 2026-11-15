import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { stripeBilling } from "../../packages/data/src/stripe";
import { AppError } from "../../packages/domain/src/errors";
import type { Identity } from "../../packages/contracts/src";

/**
 * Bridges the legacy Next runtime to the shared billing domain, so there is one
 * implementation of every payment rule. Removed with the Next runtime.
 */
export const legacyBilling = stripeBilling();
export async function legacyBillingContext() {
  const { userId, email, profile } = await getCurrentProfile();
  if (!userId || !profile) return null;
  const identity: Identity = { id: userId, email, profile: { id: profile.id, full_name: profile.full_name, role: profile.role } };
  return { client: await createClient(), identity };
}
/** Domain failures become the action's user-facing message; anything unexpected is not echoed. */
export async function legacyOutcome<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string; code: string }> {
  try { return { ok: true, value: await work() }; }
  catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message, code: error.code };
    console.error("Legacy billing action failed unexpectedly");
    return { ok: false, error: "Something went wrong. Please try again.", code: "internal_error" };
  }
}

/** Same context for non-billing legacy routes that delegate to shared domain code. */
export const legacyContext = legacyBillingContext;

import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for contexts with no user session to read cookies
 * from — webhooks, cron jobs. Bypasses RLS entirely, so every query must
 * scope itself explicitly. Never import this into anything that handles a
 * browser request directly.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

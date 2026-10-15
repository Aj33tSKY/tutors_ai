import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Public catalogue reads use the anonymous RLS role and no request cookies. */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Release smoke check, polled by the deploy workflows after a migration and
 * deploy. A successful `vercel deploy` only proves the build uploaded, so this
 * confirms the running build has its environment and can reach the database.
 * Returns booleans only — never anything about the data itself.
 */
export async function GET() {
  const checks = {
    env: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    database: false,
  };

  if (checks.env) {
    try {
      // head:true sends no rows back; this is a connectivity and schema probe.
      const { error } = await createAdminClient().from("profiles").select("id", { head: true });
      checks.database = !error;
      if (error) console.error("Health check could not reach the database:", error.message);
    } catch (error) {
      console.error("Health check threw while reaching the database:", error);
    }
  }

  const healthy = checks.env && checks.database;
  return Response.json({ status: healthy ? "ok" : "degraded", checks }, { status: healthy ? 200 : 503 });
}

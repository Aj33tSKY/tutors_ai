import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Only authenticated app pages need the proxy's token refresh and redirect.
  // Public pages, webhooks, cron jobs and health checks should not make an
  // additional Supabase Auth request before their own work begins.
  matcher: ["/dashboard/:path*", "/session/:path*"],
};

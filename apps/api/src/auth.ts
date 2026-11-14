import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ApiConfig } from "./config.js";
import type { Identity } from "../../../packages/contracts/src/index.js";
import { AppError } from "../../../packages/domain/src/errors.js";

export function requestClient(c: Context, config: ApiConfig): SupabaseClient {
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookieOptions: { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => Object.entries(getCookie(c)).map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) {
          setCookie(c, name, value, { ...options, httpOnly: true, secure: config.secureCookies, sameSite: "Lax", path: "/" });
        }
      },
    },
  });
}

export async function identify(client: SupabaseClient): Promise<Identity> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new AppError(401, "unauthenticated", "Please sign in");
  const { data: profile, error: profileError } = await client.from("profiles").select("id,full_name,role").eq("id", user.id).maybeSingle();
  if (profileError) throw new AppError(503, "database_unavailable", "Could not load your profile");
  if (!profile) throw new AppError(403, "profile_required", "Your account profile is unavailable");
  return { id: user.id, email: user.email ?? "", profile };
}

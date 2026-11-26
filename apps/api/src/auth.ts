import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ApiConfig } from "./config.js";
import type { Identity } from "../../../packages/contracts/src/index.js";
import { AppError } from "../../../packages/domain/src/errors.js";

// Supabase Auth rate-limits sign-ins and token refreshes per IP address, and this API calls Auth from the server, so without
// help every visitor shares one budget. With a secret key and the Sb-Forwarded-For header (and "IP address forwarding" switched
// on in the project's Auth rate-limit settings) Auth limits per visitor instead. The secret key is attached ONLY to /auth/v1/
// requests; data queries keep the anon key and the user's own token, so row-level security still applies to every one of them.
export function authForwarding(config: ApiConfig, ip: string | undefined, base: typeof fetch = fetch): typeof fetch {
  const secret = config.supabaseAuthSecretKey;
  if (!secret || !ip) return base;
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!new URL(url).pathname.startsWith("/auth/v1/")) return base(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("apikey", secret);
    if (headers.get("authorization") === `Bearer ${config.supabaseAnonKey}`) headers.set("authorization", `Bearer ${secret}`);
    headers.set("Sb-Forwarded-For", ip);
    return base(input, { ...init, headers });
  };
}

export function requestClient(c: Context, config: ApiConfig): SupabaseClient {
  const ip = c.req.header("cf-connecting-ip");
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { fetch: authForwarding(config, ip) },
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

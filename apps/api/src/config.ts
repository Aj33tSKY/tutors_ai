import { z } from "zod";

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
}, "Use an HTTPS origin without a trailing slash (HTTP is allowed on loopback only)");

export const configSchema = z.object({
  webOrigin: origin,
  supabaseUrl: z.url(),
  supabaseAnonKey: z.string().min(1),
  secureCookies: z.boolean(),
  commit: z.string().min(1).max(100),
});
export type ApiConfig = z.infer<typeof configSchema>;
export function readConfig(): ApiConfig {
  return configSchema.parse({
    webOrigin: process.env.APP_WEB_ORIGIN,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    secureCookies: process.env.NODE_ENV === "production",
    commit: process.env.APP_COMMIT_SHA ?? "local",
  });
}

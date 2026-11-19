import assert from "node:assert/strict";
import test from "node:test";
import { authForwarding } from "../../apps/api/src/auth.js";
import type { ApiConfig } from "../../apps/api/src/config.js";

const config = (secret?: string): ApiConfig => ({ webOrigin: "https://app.test", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", supabaseAuthSecretKey: secret, secureCookies: true, commit: "t" });
const spy = () => { const seen: Array<{ url: string; headers: Headers }> = []; const base = (async (input: RequestInfo | URL, init?: RequestInit) => { seen.push({ url: String(input), headers: new Headers(init?.headers) }); return new Response("{}"); }) as typeof fetch; return { seen, base }; };

test("auth calls carry the secret key and the visitor's IP; data calls are untouched", async () => {
  const { seen, base } = spy();
  const f = authForwarding(config("sb_secret_x"), "203.0.113.9", base);
  await f("https://x.supabase.co/auth/v1/token?grant_type=password", { headers: { apikey: "anon", authorization: "Bearer anon" } });
  await f("https://x.supabase.co/auth/v1/user", { headers: { apikey: "anon", authorization: "Bearer user-jwt" } });
  await f("https://x.supabase.co/rest/v1/profiles", { headers: { apikey: "anon", authorization: "Bearer user-jwt" } });
  assert.deepEqual([seen[0].headers.get("apikey"), seen[0].headers.get("authorization"), seen[0].headers.get("sb-forwarded-for")], ["sb_secret_x", "Bearer sb_secret_x", "203.0.113.9"]);
  assert.deepEqual([seen[1].headers.get("apikey"), seen[1].headers.get("authorization")], ["sb_secret_x", "Bearer user-jwt"], "a user's own token is kept");
  assert.deepEqual([seen[2].headers.get("apikey"), seen[2].headers.get("sb-forwarded-for")], ["anon", null], "the secret key never reaches data queries");
});

test("without a secret key or an IP nothing changes", async () => {
  const { seen, base } = spy();
  await authForwarding(config(), "203.0.113.9", base)("https://x.supabase.co/auth/v1/token", { headers: { apikey: "anon" } });
  await authForwarding(config("sb_secret_x"), undefined, base)("https://x.supabase.co/auth/v1/token", { headers: { apikey: "anon" } });
  assert.deepEqual(seen.map((s) => [s.headers.get("apikey"), s.headers.get("sb-forwarded-for")]), [["anon", null], ["anon", null]]);
});

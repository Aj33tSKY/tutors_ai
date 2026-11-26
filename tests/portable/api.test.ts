import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../../apps/api/src/app.js";
import { AppError } from "../../packages/domain/src/errors.js";

const config = { webOrigin: "http://localhost:5173", supabaseUrl: "http://127.0.0.1:54321", supabaseAnonKey: "local-test-key", secureCookies: false, commit: "test-commit" };
const app = createApp(config, { client: () => ({} as SupabaseClient), identify: async () => { throw new AppError(401, "unauthenticated", "Please sign in"); } });

test("unknown POST paths are 404, never a successful HTML page", async () => {
  const response = await app.request("/wrong-webhook", { method: "POST", headers: { origin: config.webOrigin } });
  assert.equal(response.status, 404); assert.match(response.headers.get("content-type")!, /json/);
});
test("untrusted and missing origins cannot mutate cookie-authenticated state", async () => {
  for (const origin of [undefined, "https://attacker.example"]) {
    const response = await app.request("/v1/auth/sign-in", { method: "POST", headers: origin ? { origin } : {}, body: "{}" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "invalid_origin");
  }
});
test("protected bookings fail closed before touching data", async () => {
  const response = await app.request("/v1/bookings/aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
});
test("signup rejects a caller-supplied admin role", async () => {
  const response = await app.request("/v1/auth/sign-up", { method: "POST", headers: { origin: config.webOrigin, "content-type": "application/json" }, body: JSON.stringify({ email: "a@example.test", password: "password123", fullName: "A", role: "admin" }) });
  assert.equal(response.status, 400);
});
test("health identifies the running commit without exposing configuration", async () => {
  const response = await app.request("/health/live");
  assert.deepEqual(await response.json(), { status: "ok", commit: "test-commit" });
  assert.ok(response.headers.get("x-request-id"));
});
test("CORS grants credentials to the exact configured origin", async () => {
  const response = await app.request("/health/live", { headers: { origin: config.webOrigin } });
  assert.equal(response.headers.get("access-control-allow-origin"), config.webOrigin);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});
test("availability endpoints require authentication before database access", async () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const path = method === "DELETE" ? "/v1/tutor/availability/aaaaaaaa-0000-4000-8000-000000000001" : "/v1/tutor/availability";
    const response = await app.request(path, { method, headers: { origin: config.webOrigin } });
    assert.equal(response.status, 401);
  }
});

test("Google sign-in returns the provider URL and sends the user back to the confirm page", async () => {
  const calls: unknown[] = [];
  const fake = { auth: { signInWithOAuth: async (options: unknown) => { calls.push(options); return { data: { url: "https://accounts.google.test/auth" }, error: null }; } } } as unknown as SupabaseClient;
  const google = createApp(config, { client: () => fake });
  const ok = await google.request("/v1/auth/oauth/google", { method: "POST", headers: { origin: config.webOrigin, "content-type": "application/json" }, body: "{}" });
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { url: "https://accounts.google.test/auth" });
  assert.deepEqual(calls, [{ provider: "google", options: { redirectTo: `${config.webOrigin}/auth/confirm?oauth=1`, skipBrowserRedirect: true } }]);
  const wrongOrigin = await google.request("/v1/auth/oauth/google", { method: "POST", headers: { origin: "https://attacker.example" }, body: "{}" });
  assert.equal(wrongOrigin.status, 403);
  const failing = createApp(config, { client: () => ({ auth: { signInWithOAuth: async () => ({ data: { url: null }, error: new Error("provider disabled") }) } }) as unknown as SupabaseClient });
  const off = await failing.request("/v1/auth/oauth/google", { method: "POST", headers: { origin: config.webOrigin }, body: "{}" });
  assert.equal(off.status, 503); assert.equal((await off.json()).error.code, "oauth_unavailable");
});

test("choosing an account type works once for an unconfirmed account and only student or tutor", async () => {
  const identity = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "g@example.test", profile: { id: "aaaaaaaa-0000-4000-8000-000000000001", full_name: "G", role: "tutor" as const, role_confirmed: true } };
  const updates: unknown[] = [];
  const clientFor = (rows: unknown[]) => ({ from: () => ({ update: (values: unknown) => { updates.push(values); const chain = { eq: () => chain, select: async () => ({ data: rows, error: null }) }; return chain; } }) }) as unknown as SupabaseClient;
  const post = (application: ReturnType<typeof createApp>, role: string) => application.request("/v1/auth/role", { method: "POST", headers: { origin: config.webOrigin, "content-type": "application/json" }, body: JSON.stringify({ role }) });
  const first = createApp(config, { client: () => clientFor([{ id: identity.id }]), identify: async () => identity });
  assert.equal((await post(first, "tutor")).status, 200);
  assert.deepEqual(updates, [{ role: "tutor", role_confirmed: true }]);
  assert.equal((await post(first, "admin")).status, 400);
  assert.equal((await post(first, "parent")).status, 400);
  const second = createApp(config, { client: () => clientFor([]), identify: async () => identity });
  const again = await post(second, "student");
  assert.equal(again.status, 409); assert.equal((await again.json()).error.code, "role_already_chosen");
});

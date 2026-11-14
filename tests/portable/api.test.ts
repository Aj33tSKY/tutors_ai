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

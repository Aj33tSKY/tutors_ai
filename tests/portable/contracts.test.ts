import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../apps/api/src/app.js";
import { openapi } from "../../packages/contracts/src/openapi.js";

test("every implemented versioned API operation has an OpenAPI entry", () => {
  const app = createApp({ webOrigin: "http://localhost:5173", supabaseUrl: "http://127.0.0.1:54321", supabaseAnonKey: "test-key", secureCookies: false, commit: "test" });
  const actual = app.routes.filter((route) => route.path.startsWith("/v1/") && route.method !== "ALL")
    .map((route) => `${route.method.toLowerCase()} ${route.path.replace(/:([a-z]+)/g, "{$1}")}`).sort();
  const documented = Object.entries(openapi.paths).flatMap(([path, methods]) => Object.keys(methods).filter((method) => ["get", "post", "patch"].includes(method)).map((method) => `${method} ${path}`)).sort();
  assert.deepEqual(actual, documented);
});

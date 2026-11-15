import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeHandler } from "../../apps/web/src/edge.js";

const assets = { fetch: async () => new Response("asset") };
test("edge relays cookie auth without caching, redirecting or buffering the API response", async () => {
  const handler = edgeHandler(async (request) => {
    assert.equal(request.url, "https://api.example.test/v1/auth/sign-in?next=calendar");
    assert.equal(request.headers.get("origin"), "https://app.example.test");
    assert.equal(request.headers.get("cookie"), "fixture=value");
    assert.equal(request.headers.get("x-forwarded-host"), null);
    assert.equal(request.redirect, "manual");
    assert.deepEqual(await request.json(), { email: "fixture@example.test" });
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "part0=first; HttpOnly; Secure; SameSite=Lax; Path=/");
    headers.append("set-cookie", "part1=second; HttpOnly; Secure; SameSite=Lax; Path=/");
    return new Response('{"success":true}', { headers });
  });
  const response = await handler(new Request("https://app.example.test/v1/auth/sign-in?next=calendar", {
    method: "POST", headers: { origin: "https://app.example.test", cookie: "fixture=value", "x-forwarded-host": "attacker.example" },
    body: JSON.stringify({ email: "fixture@example.test" }),
  }), { APP_API_ORIGIN: "https://api.example.test", ASSETS: assets });
  assert.equal(response.status, 200);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(await response.json(), { success: true });
});
test("edge serves assets separately and rejects unsafe or missing API origins", async () => {
  const handler = edgeHandler(async () => { throw new Error("must not send credentials"); });
  assert.equal(await (await handler(new Request("https://app.example.test/assets/index.js"), { APP_API_ORIGIN: "", ASSETS: assets })).text(), "asset");
  for (const origin of ["", "http://api.example.test", "https://api.example.test/path", "https://app.example.test", "https://user:password@api.example.test"]) {
    assert.equal((await handler(new Request("https://app.example.test/v1/auth/me"), { APP_API_ORIGIN: origin, ASSETS: assets })).status, 503);
  }
});
test("edge returns streaming data before completion and propagates cancellation", { timeout: 1000 }, async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("first chunk")); }, cancel() { cancelled = true; } });
  const handler = edgeHandler(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  const response = await handler(new Request("https://app.example.test/v1/chat"), { APP_API_ORIGIN: "https://api.example.test", ASSETS: assets });
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "first chunk");
  await reader.cancel();
  assert.equal(cancelled, true);
});

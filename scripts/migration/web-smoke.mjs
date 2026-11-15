// Runs the real web and API images on a private Docker network and checks what a browser would
// see through Caddy: routing, caching, security headers and the API proxy. Nothing is published
// beyond a loopback port, and no credentials are used.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const [webImage, apiImage] = process.argv.slice(2);
if (!webImage || !apiImage) throw new Error("Usage: node scripts/migration/web-smoke.mjs <web-image> <api-image>");
const docker = (...args) => promisify(execFile)("docker", args, { timeout: 120000 }).then((r) => r.stdout.trim());
const suffix = process.pid;
const network = `web-smoke-${suffix}`;
const cleanup = async () => { for (const name of [`web-smoke-web-${suffix}`, `web-smoke-api-${suffix}`]) await docker("rm", "-f", name).catch(() => {}); await docker("network", "rm", network).catch(() => {}); };
try {
  await docker("network", "create", network);
  await docker("run", "-d", "--name", `web-smoke-api-${suffix}`, "--network", network, "--network-alias", "api",
    "-e", "APP_WEB_ORIGIN=http://127.0.0.1", "-e", "APP_COMMIT_SHA=web-smoke", "-e", "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321", "-e", "NEXT_PUBLIC_SUPABASE_ANON_KEY=smoke", apiImage);
  await docker("run", "-d", "--name", `web-smoke-web-${suffix}`, "--network", network, "-e", "SITE_ADDRESS=http://:80", "-p", "127.0.0.1::80", webImage);
  const port = (await docker("port", `web-smoke-web-${suffix}`, "80/tcp")).split(":").pop();
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await fetch(`${base}/health/live`).then((r) => r.ok).catch(() => false); if (!ready) await new Promise((r) => setTimeout(r, 500)); }
  assert.ok(ready, "the proxy must reach the API");

  const home = await fetch(`${base}/`);
  const html = await home.text();
  assert.equal(home.status, 200); assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(home.headers.get("cache-control"), /no-cache/, "pages revalidate on every load");
  assert.equal(home.headers.get("x-content-type-options"), "nosniff"); assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(home.headers.get("strict-transport-security"), /max-age/); assert.match(home.headers.get("permissions-policy"), /camera=\(self\)/);
  assert.equal(home.headers.get("server"), null, "no server banner");
  assert.equal((await fetch(`${base}/tutors/00000000-0000-4000-8000-000000000000`)).status, 200, "unknown app routes get the shell, which shows its own not-found page");
  assert.equal((await fetch(`${base}/dashboard/anything`)).status, 200);
  assert.equal((await fetch(`${base}/assets/does-not-exist.js`)).status, 404, "a missing asset is a real 404");
  assert.equal((await fetch(`${base}/missing.png`)).status, 404);
  const asset = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
  assert.ok(asset, "the shell references a hashed bundle");
  const bundle = await fetch(`${base}${asset}`);
  assert.equal(bundle.status, 200); assert.match(bundle.headers.get("cache-control"), /immutable/);
  assert.match(bundle.headers.get("content-type"), /javascript/);

  const live = await (await fetch(`${base}/health/live`)).json();
  assert.equal(live.commit, "web-smoke");
  const denied = await fetch(`${base}/v1/bookings/aaaaaaaa-0000-4000-8000-000000000001`);
  assert.equal(denied.status, 401); assert.match(denied.headers.get("cache-control"), /no-store/, "API responses are never cached");
  assert.ok(denied.headers.get("x-request-id"));
  const crossOrigin = await fetch(`${base}/v1/auth/sign-in`, { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}" });
  assert.equal(crossOrigin.status, 403, "the origin check still protects mutations behind the proxy");
  console.info("Web smoke passed: routing, caching, security headers, API proxy and mutation protection through Caddy");
} finally { await cleanup(); }

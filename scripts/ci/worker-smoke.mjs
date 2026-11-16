// Boots the real Worker in Cloudflare's runtime (wrangler dev, workerd) and checks the behaviour that differs between Node
// and Workers. Node-only tests cannot catch these: Stripe's synchronous signature check failed on Workers while every Node
// test passed. Needs `npm run build:portable && npm run build:edge-assets` first. No credentials, no network services.
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessToken } from "livekit-server-sdk";

const port = 8790;
const base = `http://127.0.0.1:${port}`;
const stripeSecret = "whsec_ci_only_not_a_real_secret";
const livekit = { key: "ci-key", secret: "ci-secret-ci-secret-ci-secret-1234" };
const dir = mkdtempSync(join(tmpdir(), "worker-smoke-"));
const envFile = join(dir, "smoke.env");
writeFileSync(envFile, [
  `APP_WEB_ORIGIN=${base}`,
  // Nothing listens here: health must report degraded, not crash.
  "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-anon",
  `STRIPE_WEBHOOK_SECRET=${stripeSecret}`,
  `LIVEKIT_API_KEY=${livekit.key}`,
  `LIVEKIT_API_SECRET=${livekit.secret}`,
  "APP_COMMIT_SHA=worker-smoke",
].join("\n") + "\n");

const worker = spawn("npx", ["--no-install", "wrangler", "dev", "--local", "--port", String(port), "--ip", "127.0.0.1", "--env-file", envFile, "--show-interactive-dev-session=false"],
  { cwd: "apps/edge", env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false", WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let output = "";
worker.stdout.on("data", (d) => { output += d; });
worker.stderr.on("data", (d) => { output += d; });
const stop = () => { try { process.kill(-worker.pid, "SIGTERM"); } catch { /* already gone */ } rmSync(dir, { recursive: true, force: true }); };

const failures = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failures.push(name); };

try {
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(`${base}/health/live`)).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
  if (!up) throw new Error(`Worker did not start:\n${output.slice(-2000)}`);

  const live = await fetch(`${base}/health/live`);
  check("API answers from inside the Worker", live.status === 200 && (await live.json()).commit === "worker-smoke");
  const ready = await fetch(`${base}/health/ready`);
  check("readiness reports a missing database cleanly", ready.status === 503 && (await ready.json()).status === "degraded", `status ${ready.status}`);

  const page = await fetch(`${base}/`);
  check("static shell served", page.status === 200 && (await page.text()).includes("<html"));
  check("static files carry the security headers", page.headers.get("x-frame-options") === "DENY" && page.headers.get("strict-transport-security") !== null);
  check("unknown page gets the app shell", (await fetch(`${base}/some/client/route`)).status === 200);
  check("missing file is a real 404", (await fetch(`${base}/assets/does-not-exist.js`)).status === 404);
  check("POST to a static path is 405, not an exception", (await fetch(`${base}/graphql`, { method: "POST", body: "{}" })).status === 405);

  // Stripe: an event type the app ignores is acknowledged only after its signature verifies (async Web Crypto on Workers).
  const body = JSON.stringify({ id: "evt_smoke", object: "event", type: "customer.created", data: { object: {} } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac("sha256", stripeSecret).update(`${t}.${body}`).digest("hex")}`;
  const stripeOk = await fetch(`${base}/v1/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body });
  check("Stripe signature verifies on Workers", stripeOk.status === 200, `status ${stripeOk.status}`);
  const stripeBad = await fetch(`${base}/v1/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: body.replace("evt_smoke", "evt_tampered") });
  check("tampered Stripe event rejected", stripeBad.status === 400, `status ${stripeBad.status}`);

  // LiveKit: same rule with its JWT signature.
  const lkBody = JSON.stringify({ event: "room_started", id: "EV_smoke", createdAt: t, room: { name: "smoke" } });
  const token = new AccessToken(livekit.key, livekit.secret);
  token.sha256 = createHash("sha256").update(lkBody).digest("base64");
  const lkOk = await fetch(`${base}/v1/webhooks/livekit`, { method: "POST", headers: { authorization: await token.toJwt(), "content-type": "application/webhook+json" }, body: lkBody });
  check("LiveKit signature verifies on Workers", lkOk.status === 200, `status ${lkOk.status}`);
  const lkBad = await fetch(`${base}/v1/webhooks/livekit`, { method: "POST", headers: { authorization: "not.a.token", "content-type": "application/webhook+json" }, body: lkBody });
  check("bad LiveKit signature rejected", lkBad.status === 401, `status ${lkBad.status}`);

  check("no uncaught exceptions in the Worker log", !/Uncaught|error code: 1101/i.test(output));
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  stop();
}
if (failures.length) { console.error(`\n${failures.length} Worker runtime check(s) failed.`); process.exit(1); }
console.log("\nWorker runtime checks passed.");

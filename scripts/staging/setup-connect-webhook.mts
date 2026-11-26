// One-off for staging: creates the Stripe sandbox webhook endpoint that listens to CONNECTED accounts (lesson invoices are
// direct charges on tutors' accounts, so their paid/failed events arrive there) and stores its signing secret as the staging
// Worker secret STRIPE_CONNECT_WEBHOOK_SECRET. The secret is piped straight into wrangler and never printed.
// Needs Connect enabled on the Stripe account. Refuses anything but a sandbox (sk_test_) key and the staging URL.
import Stripe from "stripe";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs"; import { homedir } from "node:os";

const env = Object.fromEntries(readFileSync(`${homedir()}/.tutors-backups/staging-env/worker.env`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const key = env.STRIPE_SECRET_KEY; if (!key?.startsWith("sk_test_")) throw new Error("Refusing: not a sandbox key.");
const url = "https://staging.hybridtutors.co.uk/v1/webhooks/stripe";
const api = new Stripe(key);
const mine = (await api.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url === url && e.description === "connect-invoices");
if (mine.length) { console.log("Connect endpoint already exists:", mine[0].id, "(its secret is only shown at creation; delete it in the dashboard to recreate)"); process.exit(0); }
// A Connect endpoint is created with connect: true; the platform endpoint on the same URL is a separate one with its own secret.
const endpoint = await api.webhookEndpoints.create({ url, connect: true, description: "connect-invoices", enabled_events: ["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"] });
console.log("created Connect endpoint:", endpoint.id);
const result = spawnSync("npx", ["--no-install", "wrangler", "secret", "put", "STRIPE_CONNECT_WEBHOOK_SECRET", "--env", "staging"], { cwd: "apps/edge", input: endpoint.secret!, encoding: "utf8" });
console.log(result.status === 0 ? "staging Worker secret STRIPE_CONNECT_WEBHOOK_SECRET set" : `wrangler failed: ${(result.stderr ?? "").slice(0, 200)}`);
process.exit(result.status === 0 ? 0 : 1);

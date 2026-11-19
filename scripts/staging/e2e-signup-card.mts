// End-to-end check on the live staging site: sign up with a throwaway mailbox, confirm through the real email link, then
// save Stripe's published TEST card through the sandbox checkout and wait for the webhook to attach it to the customer.
// It refuses to type a card number unless the Stripe page says it is in test/sandbox mode.
//
// Usage: npx tsx scripts/staging/e2e-signup-card.mts [--existing] [https://staging.hybridtutors.co.uk]
// Supabase's built-in email sender allows about 2 emails an hour per project, so the sign-up half cannot be repeated often
// until the project has custom SMTP; --existing runs only the card half.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const existing = args.includes("--existing");   // skip sign-up: sign in as the pre-confirmed test student and only do the card step
const base = args.find((a) => a.startsWith("http")) ?? "https://staging.hybridtutors.co.uk";
if (!/^https:\/\/staging\./.test(base) && !base.startsWith("http://localhost")) throw new Error("Refusing to run against anything but staging or localhost.");
const shots = process.env.E2E_SHOTS ?? "/tmp/e2e-shots"; mkdirSync(shots, { recursive: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const step = (name: string, detail = "") => console.log(`ok   ${name}${detail ? ` (${detail})` : ""}`);

let mailToken = ""; let address = "";
async function mail(method: string, path: string, body?: unknown, token?: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`https://api.mail.tm${path}`, { method, headers: { "content-type": "application/json", "user-agent": UA, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 429) { await new Promise((r) => setTimeout(r, 6000)); continue; }
    return { status: response.status, data: await response.json().catch(() => ({})) as Record<string, unknown> };
  }
  throw new Error("mail.tm kept rate limiting");
}
if (!existing) {
  // A throwaway inbox (mail.tm): random address and password, nothing personal.
  const domain = ((await mail("GET", "/domains")).data["hydra:member"] as Array<{ domain: string }>)[0].domain;
  address = `tutors-e2e-${randomBytes(4).toString("hex")}@${domain}`;
  const mailPassword = randomBytes(12).toString("base64url");
  if ((await mail("POST", "/accounts", { address, password: mailPassword })).status !== 201) throw new Error("could not create the throwaway inbox");
  mailToken = (await mail("POST", "/token", { address, password: mailPassword })).data.token as string;
  step("throwaway inbox created", address.replace(/^.*@/, "@"));
}

const appPassword = `${randomBytes(12).toString("base64url")}Aa1!`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
const fail = async (message: string): Promise<never> => { await page.screenshot({ path: `${shots}/failure.png`, fullPage: true }).catch(() => undefined); await browser.close(); throw new Error(`${message} (screenshot: ${shots}/failure.png, url: ${page.url()})`); };

if (!existing) {
// 1. Sign up through the real form.
await page.goto(`${base}/sign-up`);
await page.getByLabel("Full name").fill("Mock Signup Student");
await page.getByLabel("Email").fill(address);
await page.getByLabel("Password").fill(appPassword);
await page.getByLabel("I am a").selectOption("student");
await page.locator("form button").first().click();
await page.getByRole("status").filter({ hasText: /check your email/i }).waitFor({ timeout: 30000 }).catch(() => fail("sign-up did not report that an email was sent"));
step("sign-up accepted by the app");

// 2. Wait for the confirmation email and open its link in the SAME browser (the login handshake cookie lives here).
let link = "";
for (let i = 0; i < 24 && !link; i++) {
  const list = (await mail("GET", "/messages", undefined, mailToken)).data["hydra:member"] as Array<{ id: string }> | undefined;
  if (list?.length) {
    const message = (await mail("GET", `/messages/${list[0].id}`, undefined, mailToken)).data;
    const body = `${(message.text as string | undefined) ?? ""} ${((message.html as string[] | undefined) ?? []).join(" ")}`;
    link = (body.match(/https:\/\/[^\s"'<>)]+\/auth\/v1\/verify[^\s"'<>)]+/) ?? [""])[0].replace(/&amp;/g, "&");
    if (!link) await fail("the email had no confirmation link");
  } else await new Promise((r) => setTimeout(r, 8000));
}
if (!link) await fail("no confirmation email arrived");
const redirectTo = new URL(link).searchParams.get("redirect_to") ?? "";
if (!redirectTo.startsWith(base)) await fail(`the link redirects to ${redirectTo || "(nothing)"}, not the staging site`);
step("confirmation email received", `link redirects to ${new URL(redirectTo).origin}`);

await page.goto(link);
await page.waitForURL(/\/auth\/confirm/, { timeout: 30000 }).catch(() => fail("the email link did not land on the app's confirm page"));
await page.waitForLoadState("networkidle").catch(() => undefined);
{ const u = new URL(page.url()); console.log(`     confirm page: ${u.pathname} params=[${[...u.searchParams.keys()].join(",")}] hash=[${u.hash.replace(/=.*/, "=…").slice(0, 60)}] text="${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160)}"`); }
await page.screenshot({ path: `${shots}/confirm.png` });
await page.getByRole("button").first().click({ timeout: 8000 }).catch(() => undefined);
await page.getByRole("heading", { name: /Welcome back, Mock Signup Student/ }).waitFor({ timeout: 30000 }).catch(() => fail("confirming did not sign the new student in"));
step("email confirmed and signed in", "dashboard shows the new student");
await page.screenshot({ path: `${shots}/dashboard.png` });

} else {
  const { readFileSync } = await import("node:fs"); const { homedir } = await import("node:os");
  const creds = Object.fromEntries(readFileSync(`${homedir()}/.tutors-backups/cf-test/student.txt`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  await page.goto(`${base}/sign-in`);
  await page.getByLabel("Email", { exact: true }).fill(creds.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: /Welcome back/ }).waitFor({ timeout: 30000 }).catch(() => fail("sign-in as the test student failed"));
  step("signed in as the pre-confirmed test student");
}

// 3. Save a card through the sandbox checkout.
await page.goto(`${base}/dashboard/student/billing`);
// A student who already has a card sees "Replace payment method" instead.
await page.getByRole("button", { name: /^(Save a payment method|Replace payment method)$/ }).click();
await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45000 }).catch(() => fail("did not reach Stripe's checkout"));
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);
const stripeText = (await page.locator("body").innerText()).toLowerCase();
if (!/test mode|sandbox|test environment/.test(stripeText) && !new URL(page.url()).pathname.includes("/c/pay/cs_test_")) await fail("Stripe's page is not visibly in test mode; refusing to enter a card number");
step("Stripe checkout is in test mode", new URL(page.url()).pathname.slice(0, 22) + "…");
await page.screenshot({ path: `${shots}/stripe-checkout.png` });
if (process.env.E2E_DEBUG) for (const f of page.frames()) console.log("     frame", (f.url() || "").slice(8, 60), "| text:", JSON.stringify((await f.locator("body").innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ").slice(0, 90)));
if (process.env.E2E_DEBUG) console.log("     frames:", page.frames().map((f) => new URL(f.url() || "about:blank").host + new URL(f.url() || "about:blank").pathname.slice(0, 24)).join(" | "), "| radios:", await page.getByRole("radio").count(), "| inputs:", await page.locator("input").count());
// Stripe's payment form is served from its own iframe. The page offers several methods; the card fields appear once Card is chosen.
const pay = page.frameLocator('iframe[src*="elements-inner-habanero"]').first();
if (process.env.E2E_DEBUG) console.log("     ARIA:", (await pay.locator("body").ariaSnapshot({ timeout: 8000 }).catch((e) => String(e).slice(0, 80))).replace(/\n/g, " ⏎ ").slice(0, 700));
await pay.getByRole("button", { name: "Card", exact: true }).click({ timeout: 20000 }).catch(() => fail("Stripe did not offer the Card method"));
const cardNumber = pay.getByLabel(/card number/i).first();
await cardNumber.waitFor({ timeout: 20000 }).catch(() => fail("Stripe did not show the card fields"));
await cardNumber.fill("4242 4242 4242 4242");
await pay.getByLabel(/expiration|expiry/i).first().fill("12 / 34");
await pay.getByLabel(/security code|cvc/i).first().fill("123");
const holder = pay.getByLabel(/name on card|cardholder/i); if (await holder.count()) await holder.first().fill("Test Student");
const zip = pay.getByLabel(/zip|postal|postcode/i); if (await zip.count()) await zip.first().fill("SW1A 1AA");
await page.screenshot({ path: `${shots}/stripe-filled.png` });
await pay.getByRole("button", { name: /^(save|save card|set up)$/i }).first().click();
// A visible captcha challenge is not something to solve or bypass: stop and hand over to a person.
if (await page.frameLocator('iframe[src*="hcaptcha.com/captcha"][title*="challenge" i]').locator("body").isVisible({ timeout: 4000 }).catch(() => false)) await fail("Stripe is showing a CAPTCHA challenge; a person must complete this step");
await page.waitForURL(new RegExp(`${base.replace(/[.]/g, "\\.")}/dashboard/student/billing`), { timeout: 90000 }).catch(() => fail("Stripe did not return to the app after saving the card"));
step("card saved in the Stripe sandbox and returned to the app");

// 4. The webhook (via the Worker and its queue) should attach the card to the customer.
let saved = false;
for (let i = 0; i < 30 && !saved; i++) {
  const response = await page.request.get(`${base}/v1/student/billing`);
  const billing = await response.json() as Record<string, unknown>;
  saved = Boolean(billing.savedMethod ?? billing.paymentMethod ?? billing.card ?? billing.defaultPaymentMethod);
  if (!saved) { await page.waitForTimeout(4000); }
  else step("saved card shows on the account", JSON.stringify(billing.savedMethod ?? billing.paymentMethod ?? billing.card).slice(0, 60));
}
if (!saved) await fail("the saved card never appeared on the account (webhook or setDefaultPaymentMethod problem)");
await page.screenshot({ path: `${shots}/billing-saved.png` });
if (errors.length) console.log("page script errors:", errors.slice(0, 3));
await browser.close();
console.log("\nSign-up, email confirmation and card setup passed on", base);

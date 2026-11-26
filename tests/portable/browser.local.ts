import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { createApp } from "../../apps/api/src/app.js";
import { edgeHandler } from "../../apps/web/src/edge.js";

async function withBrowser(input: { url: string; anonKey: string }, run: (page: import("@playwright/test").Page, origin: string) => Promise<void>) {
  let handler: (request: Request) => Response | Promise<Response> = () => new Response("Starting", { status: 503 });
  let apiServer!: ReturnType<typeof serve>;
  const apiPort = await new Promise<number>((ready) => {
    apiServer = serve({ fetch: (request) => handler(request), hostname: "127.0.0.1", port: 0 }, (info) => ready(info.port));
  });
  const web = await createServer({ configFile: resolve("apps/web/vite.config.ts"), server: { host: "127.0.0.1", port: 0, proxy: { "/v1": `http://127.0.0.1:${apiPort}` } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const application = createApp({ webOrigin: origin, supabaseUrl: input.url, supabaseAnonKey: input.anonKey, secureCookies: false, commit: "browser-integration" }, {
      live: { serverUrl: "wss://video.example.test", token: async () => "fixture-token", tutorPresent: async () => true },
    });
    const proxy = edgeHandler(async (request) => application.fetch(request));
    handler = (request) => proxy(request, { APP_API_ORIGIN: "https://api.example.test", ASSETS: { fetch: async () => new Response("not an API path", { status: 404 }) } });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await run(page, origin);
    await context.close();
  } finally {
    await browser?.close();
    await web.close();
    await new Promise<void>((done) => apiServer.close(() => done()));
  }
}

export async function checkBrowser(input: { url: string; anonKey: string; studentEmail: string; tutorEmail: string; adminEmail: string; outsiderEmail: string; password: string; bookingId: string }) {
  return withBrowser(input, async (page, origin) => {
    // Public pages render from the static bundle with no script errors, in the marketing frame.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const [path, title, text] of [["/", /^Hybrid Tutors/, null], ["/pricing", /Pricing/, null], ["/how-it-works", /How it works/, null], ["/about", /Safeguarding/, null], ["/tutors", /Find a tutor/, "Find your"]] as const) {
      await page.goto(`${origin}${path}`);
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole("link", { name: /^Sign in$/i }).first()).toBeVisible();
      if (text) await expect(page.getByRole("heading", { name: new RegExp(text) })).toBeVisible();
    }
    assert.deepEqual(pageErrors, [], "public pages raise no script errors");
    for (const [path, heading] of [["/terms", "Terms of service"], ["/privacy", "Privacy policy"]] as const) {
      await page.goto(`${origin}${path}`);
      await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
    }
    await page.goto(`${origin}/sign-up`);
    await expect(page.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    await page.goto(`${origin}/sign-in`);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByLabel("Email", { exact: true }).fill(input.studentEmail);
    await page.getByLabel("Password", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Welcome back, / })).toBeVisible();
    assert.equal((await page.evaluate(() => document.cookie)).includes("sb-"), false, "Supabase credentials must be HttpOnly");
    await page.goto(`${origin}/dashboard/bookings/${input.bookingId}`);
    await page.getByLabel("Lesson name", { exact: true }).fill("Browser revision");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Browser revision", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Browser revision", exact: true })).toBeVisible();
    await page.goto(`${origin}/dashboard/student/billing`);
    await expect(page.getByRole("heading", { name: "Payment settings", exact: true })).toBeVisible();
    await expect(page.getByText("Payments are not configured for this environment.", { exact: true })).toBeVisible();
    await expect(page.getByText("£40.00", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pay now", exact: true })).toHaveAttribute("href", "https://invoice.example/hosted");
    await expect(page.getByRole("button", { name: "Save a payment method", exact: true })).toBeDisabled();
    await page.goto(`${origin}/dashboard`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
    await page.goto(`${origin}/dashboard/bookings/${input.bookingId}`);
    await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(input.outsiderEmail);
    await page.getByLabel("Password", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Welcome back, / })).toBeVisible();
    await page.goto(`${origin}/dashboard/bookings/${input.bookingId}`);
    await expect(page.getByRole("alert")).toHaveText("Booking not found");
    assert.equal(await page.getByText("Browser revision", { exact: true }).count(), 0);
    await page.goto(`${origin}/dashboard`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(input.tutorEmail);
    await page.getByLabel("Password", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "Weekly availability", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Weekly availability", exact: true })).toBeVisible();
    await page.getByLabel("From", { exact: true }).fill("16:00");
    await page.getByLabel("To", { exact: true }).fill("17:00");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Monday · 16:00–17:00", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Monday · 16:00–17:00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove slot", exact: true }).click();
    await expect(page.getByText("No availability set yet.", { exact: true })).toBeVisible();
    await page.goto(`${origin}/dashboard/tutor/students`);
    await expect(page.getByRole("heading", { name: "My students", exact: true })).toBeVisible();
    await expect(page.getByText(input.studentEmail, { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "Message", exact: true }).click();
    await expect(page.getByText("Direct messages and homework", { exact: true })).toBeVisible();
    await page.getByPlaceholder(/^Message /).fill("Browser hello");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("Browser hello", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Browser hello", { exact: true })).toBeVisible();
    await page.goto(`${origin}/dashboard/tutor`);
    await page.getByRole("link", { name: "Accept & schedule", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Confirm lesson schedule", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Confirm and message student", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Welcome back, / })).toBeVisible();
    await page.goto(`${origin}/session/${input.bookingId}`);
    await expect(page.getByRole("heading", { name: "Ready to begin?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start session", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Continue this session", exact: true })).toBeVisible();
    await page.goto(`${origin}/dashboard`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(input.adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Platform overview", exact: true })).toBeVisible();
    await page.getByLabel("Evidence checked", { exact: true }).fill("Local fixture evidence inspected for integration test");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Approve tutor", exact: true }).click();
    await expect(page.getByText("No tutors waiting on DBS review.", { exact: true })).toBeVisible();
  });
}

export async function checkReviewBrowser(input: { url: string; anonKey: string; tutorEmail: string; password: string; bookingId: string }) {
  return withBrowser(input, async (page, origin) => {
    await page.goto(`${origin}/sign-in`);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByLabel("Email", { exact: true }).fill(input.tutorEmail);
    await page.getByLabel("Password", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Welcome back, / })).toBeVisible();
    await page.goto(`${origin}/dashboard/student/bookings/${input.bookingId}`);
    await expect(page.getByRole("heading", { name: "Browser revision", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Session notes (markdown)", { exact: true }).fill("## Browser tutor notes\n\nVerified saved notes");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Verified saved notes", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Verified saved notes", { exact: true })).toBeVisible();
  });
}

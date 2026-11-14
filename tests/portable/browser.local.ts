import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { createApp } from "../../apps/api/src/app.js";

export async function checkBrowser(input: { url: string; anonKey: string; studentEmail: string; outsiderEmail: string; password: string; bookingId: string }) {
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
    handler = createApp({ webOrigin: origin, supabaseUrl: input.url, supabaseAnonKey: input.anonKey, secureCookies: false, commit: "browser-integration" }).fetch;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/sign-in`);
    await page.getByLabel("Email", { exact: true }).fill(input.studentEmail);
    await page.getByLabel("Password", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    assert.equal((await page.evaluate(() => document.cookie)).includes("sb-"), false, "Supabase credentials must be HttpOnly");
    await page.getByRole("link", { name: "Integration revision", exact: true }).click();
    await page.getByLabel("Lesson name", { exact: true }).fill("Browser revision");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Browser revision", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Browser revision", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Your lessons", exact: false }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in to Kindling" })).toBeVisible();
    await page.goto(`${origin}/dashboard/bookings/${input.bookingId}`);
    await expect(page.getByRole("heading", { name: "Sign in to Kindling" })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(input.outsiderEmail);
    await page.getByLabel("Password", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    await page.goto(`${origin}/dashboard/bookings/${input.bookingId}`);
    await expect(page.getByRole("alert")).toHaveText("Booking not found");
    assert.equal(await page.getByText("Browser revision", { exact: true }).count(), 0);
    await context.close();
  } finally {
    await browser?.close();
    await web.close();
    await new Promise<void>((done) => apiServer.close(() => done()));
  }
}

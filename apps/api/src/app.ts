import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { credentials, signup, resetRequest, passwordUpdate, authCode, uuid, renameBooking, calendarRange, type Identity } from "../../../packages/contracts/src/index.js";
import { getBooking, renameLesson } from "../../../packages/domain/src/bookings.js";
import { AppError } from "../../../packages/domain/src/errors.js";
import { bookingRepository, bookingColumns } from "../../../packages/data/src/bookings.js";
import { requestClient, identify } from "./auth.js";
import { configSchema, type ApiConfig } from "./config.js";
import { openapi } from "../../../packages/contracts/src/openapi.js";

type Variables = { requestId: string; client: SupabaseClient; identity: Identity };
type Dependencies = { client?: typeof requestClient; identify?: typeof identify };

export function createApp(input: ApiConfig, dependencies: Dependencies = {}) {
  const config = configSchema.parse(input);
  const app = new Hono<{ Variables: Variables }>();
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    c.header("X-Request-Id", c.get("requestId"));
    c.header("Cache-Control", "no-store");
    const started = performance.now();
    await next();
    console.info(JSON.stringify({ event: "http_request", requestId: c.get("requestId"), method: c.req.method, status: c.res.status, durationMs: Math.round(performance.now() - started) }));
  });
  app.use("*", cors({ origin: config.webOrigin, credentials: true, allowMethods: ["GET", "POST", "PATCH", "OPTIONS"], allowHeaders: ["Content-Type"], exposeHeaders: ["X-Request-Id"] }));
  app.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: { code: "body_too_large", message: "Request is too large", requestId: c.get("requestId") } }, 413) }));
  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("origin") !== config.webOrigin) {
      throw new AppError(403, "invalid_origin", "Request origin is not allowed");
    }
    c.set("client", (dependencies.client ?? requestClient)(c, config));
    await next();
  });
  app.get("/health/live", (c) => c.json({ status: "ok", commit: config.commit }));
  app.get("/openapi.json", (c) => c.json(openapi));
  app.get("/health/ready", async (c) => {
    const { error } = await c.get("client").from("tutor_profiles").select("id", { head: true }).limit(1);
    return c.json({ status: error ? "degraded" : "ok", commit: config.commit }, error ? 503 : 200);
  });
  app.post("/v1/auth/sign-in", async (c) => {
    const input = credentials.parse(await c.req.json());
    const { error } = await c.get("client").auth.signInWithPassword(input);
    if (error) throw new AppError(401, "invalid_credentials", "Email or password is incorrect");
    return c.json({ identity: await (dependencies.identify ?? identify)(c.get("client")) });
  });
  app.post("/v1/auth/sign-up", async (c) => {
    const input = signup.parse(await c.req.json());
    const { error } = await c.get("client").auth.signUp({ email: input.email, password: input.password, options: { emailRedirectTo: `${config.webOrigin}/auth/confirm`, data: { full_name: input.fullName, role: input.role } } });
    if (error) throw new AppError(400, "signup_failed", "Could not create this account");
    return c.json({ message: "Check your email to confirm your account" }, 202);
  });
  app.post("/v1/auth/refresh", async (c) => {
    // getUser refreshes expired cookie sessions through the SSR client adapter.
    return c.json({ identity: await (dependencies.identify ?? identify)(c.get("client")) });
  });
  app.post("/v1/auth/exchange", async (c) => {
    const { code } = authCode.parse(await c.req.json());
    const { error } = await c.get("client").auth.exchangeCodeForSession(code);
    if (error) throw new AppError(400, "invalid_auth_link", "This link is invalid or has expired");
    return c.json({ success: true });
  });
  app.post("/v1/auth/reset-password", async (c) => {
    const { email } = resetRequest.parse(await c.req.json());
    const { error } = await c.get("client").auth.resetPasswordForEmail(email, { redirectTo: `${config.webOrigin}/auth/confirm?recovery=1` });
    if (error) throw new AppError(503, "email_unavailable", "Could not send a reset link; please try again later");
    return c.json({ message: "If an account exists, check your email for a reset link" }, 202);
  });
  app.post("/v1/auth/password", async (c) => {
    await (dependencies.identify ?? identify)(c.get("client"));
    const { password } = passwordUpdate.parse(await c.req.json());
    const { error } = await c.get("client").auth.updateUser({ password });
    if (error) throw new AppError(400, "password_update_failed", "Could not update your password");
    return c.json({ success: true });
  });
  app.post("/v1/auth/sign-out", async (c) => {
    const { error } = await c.get("client").auth.signOut({ scope: "local" });
    if (error) throw new AppError(503, "logout_failed", "Could not sign out; please try again");
    return c.json({ success: true });
  });
  app.get("/v1/auth/me", async (c) => c.json({ identity: await (dependencies.identify ?? identify)(c.get("client")) }));
  app.use("/v1/bookings/*", async (c, next) => {
    c.set("identity", await (dependencies.identify ?? identify)(c.get("client")));
    await next();
  });
  app.get("/v1/bookings/calendar", async (c) => {
    const input = calendarRange.parse(c.req.query());
    const identity = c.get("identity");
    if (!["student", "tutor"].includes(identity.profile.role)) throw new AppError(403, "forbidden", "Calendar access denied");
    const { data, error } = await c.get("client").from("bookings").select(bookingColumns)
      .eq(identity.profile.role === "student" ? "student_id" : "tutor_id", identity.id)
      .gte("start_time", input.from).lt("start_time", input.to).neq("status", "cancelled").order("start_time");
    if (error) throw new AppError(503, "database_unavailable", "Could not load your calendar");
    return c.json({ bookings: data ?? [] });
  });
  app.get("/v1/bookings/:id", async (c) => c.json(await getBooking(bookingRepository(c.get("client")), c.get("identity"), uuid.parse(c.req.param("id")))));
  app.patch("/v1/bookings/:id/name", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = renameBooking.parse(await c.req.json());
    return c.json({ booking: await renameLesson(bookingRepository(c.get("client")), c.get("identity"), id, input.lessonName) });
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Endpoint not found", requestId: c.get("requestId") } }, 404));
  app.onError((error, c) => {
    const known = error instanceof AppError;
    const invalid = error instanceof ZodError || error instanceof SyntaxError;
    const status = known ? error.status : invalid ? 400 : 500;
    if (!known && !invalid) console.error(JSON.stringify({ level: "error", event: "request_failed", requestId: c.get("requestId") }));
    return c.json({ error: { code: known ? error.code : invalid ? "invalid_request" : "internal_error", message: known ? error.message : invalid ? "Check the request fields" : "Request failed", requestId: c.get("requestId") } }, status as 400);
  });
  return app;
}

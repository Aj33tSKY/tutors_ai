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
import { availabilityInput, tutorApproval, type AvailabilitySlot } from "../../../packages/contracts/src/portal.js";
import { contacts, familyOverview, adminOverview, requireRole, databaseResult } from "../../../packages/domain/src/portal.js";
import { participantLesson } from "../../../packages/domain/src/lessons.js";
import { liveProvider, type LiveProvider } from "./livekit-provider.js";
import { sessionReview } from "../../../packages/domain/src/reviews.js";
import { notesInput } from "../../../packages/contracts/src/reviews.js";
import { recordingStore } from "../../../packages/jobs/src/recording-store.js";

type Variables = { requestId: string; client: SupabaseClient; identity: Identity };
type Dependencies = { client?: typeof requestClient; identify?: typeof identify; live?: LiveProvider | null };

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
  app.use("*", cors({ origin: config.webOrigin, credentials: true, allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type"], exposeHeaders: ["X-Request-Id"] }));
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
  const live = () => dependencies.live === undefined ? liveProvider() : dependencies.live;
  app.use("/v1/lessons/*", async (c, next) => {
    c.set("identity", await (dependencies.identify ?? identify)(c.get("client"))); await next();
  });
  app.get("/v1/lessons/:id", async (c) => {
    const booking = await participantLesson(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id")));
    const consent = await c.get("client").from("session_recording_consents").select("booking_id").eq("booking_id", booking.id).maybeSingle();
    databaseResult(consent.error);
    return c.json({ booking, isTutor: booking.tutor_id === c.get("identity").id, recordingConsented: Boolean(consent.data), configured: Boolean(live()) });
  });
  app.post("/v1/lessons/:id/token", async (c) => {
    const identity = c.get("identity");
    const booking = await participantLesson(c.get("client"), identity, uuid.parse(c.req.param("id")));
    if (booking.status !== "scheduled" || !booking.started_at) throw new AppError(409, "lesson_not_open", "This lesson is not open");
    const provider = live();
    if (!provider) throw new AppError(503, "video_unavailable", "Video is temporarily unavailable");
    return c.json({ token: await provider.token({ bookingId: booking.id, identity: identity.id, name: identity.profile.full_name,
      role: booking.tutor_id === identity.id ? "tutor" : "student" }), serverUrl: provider.serverUrl, roomName: `booking-${booking.id}` });
  });
  app.post("/v1/lessons/:id/start", async (c) => {
    const booking = await participantLesson(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id")));
    if (booking.tutor_id !== c.get("identity").id) throw new AppError(403, "forbidden", "Only the tutor can start this lesson");
    const result = await c.get("client").rpc("start_booking_lesson", { p_booking_id: booking.id });
    databaseResult(result.error);
    if (!result.data) throw new AppError(409, "lesson_not_open", "This lesson cannot be started");
    return c.json({ success: true });
  });
  app.post("/v1/lessons/:id/consent", async (c) => {
    const booking = await participantLesson(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id")));
    if (booking.tutor_id !== c.get("identity").id || booking.status !== "scheduled") throw new AppError(403, "forbidden", "Only the tutor can consent to recording this lesson");
    const result = await c.get("client").rpc("consent_booking_recording", { p_booking_id: booking.id });
    databaseResult(result.error); return c.json({ success: true });
  });
  app.get("/v1/lessons/:id/presence", async (c) => {
    const identity = c.get("identity");
    const booking = await participantLesson(c.get("client"), identity, uuid.parse(c.req.param("id")));
    if (booking.student_id !== identity.id || booking.status !== "scheduled" || !booking.started_at) throw new AppError(404, "not_found", "Lesson not available");
    const provider = live();
    if (!provider) throw new AppError(503, "video_unavailable", "Video is temporarily unavailable");
    return c.json({ tutorPresent: await provider.tutorPresent(booking.id, booking.tutor_id) });
  });
  app.get("/v1/contacts", async (c) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    return c.json({ contacts: await contacts(c.get("client"), identity) });
  });
  app.get("/v1/parent/overview", async (c) => c.json(await familyOverview(c.get("client"), await (dependencies.identify ?? identify)(c.get("client")))));
  app.get("/v1/admin/overview", async (c) => c.json(await adminOverview(c.get("client"), await (dependencies.identify ?? identify)(c.get("client")))));
  app.post("/v1/admin/tutors/:id/approve", async (c) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    requireRole(identity, ["admin"]);
    const id = uuid.parse(c.req.param("id"));
    const input = tutorApproval.parse(await c.req.json());
    const { error } = await c.get("client").rpc("approve_tutor_verification", { p_tutor_id: id, p_evidence_note: input.evidenceNote });
    databaseResult(error); return c.json({ success: true });
  });
  app.use("/v1/tutor/*", async (c, next) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    requireRole(identity, ["tutor"]); c.set("identity", identity); await next();
  });
  app.get("/v1/tutor/availability", async (c) => {
    const { data, error } = await c.get("client").from("availability").select("id,tutor_id,day_of_week,start_time,end_time")
      .eq("tutor_id", c.get("identity").id).order("day_of_week").order("start_time").returns<AvailabilitySlot[]>();
    databaseResult(error); return c.json({ slots: data ?? [] });
  });
  app.post("/v1/tutor/availability", async (c) => {
    const input = availabilityInput.parse(await c.req.json());
    // Legacy pages lazily provision this row while reading the profile. Keep
    // API reads side-effect free and bootstrap only during this tutor mutation.
    const bootstrap = await c.get("client").from("tutor_profiles").upsert({ id: c.get("identity").id,
      hourly_rate: 3500, subjects: [], boards: [] }, { onConflict: "id", ignoreDuplicates: true });
    databaseResult(bootstrap.error);
    const { data, error } = await c.get("client").from("availability").insert({ tutor_id: c.get("identity").id,
      day_of_week: input.dayOfWeek, start_time: input.startTime, end_time: input.endTime })
      .select("id,tutor_id,day_of_week,start_time,end_time").single<AvailabilitySlot>();
    databaseResult(error); return c.json({ slot: data }, 201);
  });
  app.delete("/v1/tutor/availability/:id", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const { data, error } = await c.get("client").from("availability").delete().eq("id", id)
      .eq("tutor_id", c.get("identity").id).select("id");
    databaseResult(error);
    if (!data?.length) throw new AppError(404, "not_found", "Slot not found");
    return c.json({ success: true });
  });
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
  app.get("/v1/bookings/:id/review", async (c) => c.json(await sessionReview(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id")),
    async (path) => { try { return await recordingStore().sign(path, 3600); } catch { return null; } })));
  app.patch("/v1/bookings/:id/notes", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = notesInput.parse(await c.req.json());
    const booking = await getBooking(bookingRepository(c.get("client")), c.get("identity"), id);
    if (booking.booking.tutor_id !== c.get("identity").id || booking.booking.status !== "completed") throw new AppError(403, "forbidden", "Only the tutor can edit notes on a completed lesson");
    const { data, error } = await c.get("client").from("session_analytics").update({ notes_markdown: input.notesMarkdown }).eq("booking_id", id).select("booking_id");
    databaseResult(error);
    if (!data?.length) throw new AppError(409, "notes_not_ready", "Notes are not available yet");
    return c.json({ success: true });
  });
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

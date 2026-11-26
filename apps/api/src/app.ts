import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z, ZodError } from "zod";
import { credentials, signup, resetRequest, passwordUpdate, authCode, roleChoice, uuid, renameBooking, calendarRange, type Identity } from "../../../packages/contracts/src/index.js";
import { getBooking, renameLesson } from "../../../packages/domain/src/bookings.js";
import { AppError } from "../../../packages/domain/src/errors.js";
import { bookingRepository, bookingColumns } from "../../../packages/data/src/bookings.js";
import { requestClient, identify } from "./auth.js";
import { configSchema, type ApiConfig } from "./config.js";
import { openapi } from "../../../packages/contracts/src/openapi.js";
import { availabilityInput, tutorApproval, type AvailabilitySlot } from "../../../packages/contracts/src/portal.js";
import { contacts, adminOverview, requireRole, databaseResult } from "../../../packages/domain/src/portal.js";
import { participantLesson } from "../../../packages/domain/src/lessons.js";
import { liveProvider, type LiveProvider } from "./livekit-provider.js";
import { sessionReview } from "../../../packages/domain/src/reviews.js";
import { notesInput } from "../../../packages/contracts/src/reviews.js";
import { recordingStore } from "../../../packages/jobs/src/recording-store.js";
import { calendarSessions, schedulingError } from "../../../packages/domain/src/calendar.js";
import { autoChargeInput } from "../../../packages/contracts/src/billing.js";
import { studentBilling, startPaymentMethodSetup, openBillingPortal, setAutoCharge, payoutState, startPayoutOnboarding, openPayoutDashboard, sendLessonInvoice, type Billing } from "../../../packages/domain/src/billing.js";
import { stripeBilling } from "../../../packages/data/src/stripe.js";
import { eventIntake, normalizeStripeEvent, type EventIntake } from "../../../packages/jobs/src/provider-events.js";
import Stripe from "stripe";
import { WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";
import { normalizeLiveKitEvent } from "../../../packages/jobs/src/livekit-events.js";
import { tutorQuery, lessonRequestInput } from "../../../packages/contracts/src/tutors.js";
import { publicTutors, publicTutor, openSlots, requestLesson } from "../../../packages/domain/src/tutors.js";
import { createClient } from "@supabase/supabase-js";
import { chatRequest } from "../../../packages/contracts/src/chat.js";
import { chatTurn, chatConversations, createChatConversation, chatTranscript, deleteChatConversation } from "../../../packages/domain/src/chat.js";
import type { LanguageModel } from "ai";
import { messagesQuery, MAX_ATTACHMENT_BYTES } from "../../../packages/contracts/src/messaging.js";
import { conversationMessages, openThread, sendMessage } from "../../../packages/domain/src/messages.js";
import { scheduleInput, requestScheduleInput, rescheduleInput, cancelInput, requestsQuery } from "../../../packages/contracts/src/scheduling.js";

type Variables = { requestId: string; client: SupabaseClient; identity: Identity };
type VerifiedStripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };
type StripeEventVerifier = (rawBody: string, signature: string) => VerifiedStripeEvent | Promise<VerifiedStripeEvent>;
type Dependencies = {
  /** Called after a provider event is newly stored, so a host can process it at once. Failure here never fails the webhook:
   * the event is durable and the next sweep applies it. */
  onEventAccepted?: () => Promise<void>;
  client?: typeof requestClient; identify?: typeof identify; live?: LiveProvider | null; billing?: Billing | null; events?: EventIntake | null; verifyStripe?: StripeEventVerifier | null; chatModel?: LanguageModel; verifyLiveKit?: ((rawBody: string, authorization: string | undefined) => Promise<WebhookEvent>) | null };

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
  const tooLarge = (c: { get(key: "requestId"): string; json(body: unknown, status: 413): Response }) => c.json({ error: { code: "body_too_large", message: "Request is too large", requestId: c.get("requestId") } }, 413);
  const jsonLimit = bodyLimit({ maxSize: 64 * 1024, onError: tooLarge });
  // Only multipart message uploads may carry a file; everything else stays small.
  const uploadLimit = bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + 256 * 1024, onError: tooLarge });
  const webhookLimit = bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge });
  app.use("*", (c, next) => c.req.path.startsWith("/v1/webhooks/") ? webhookLimit(c, next) : next());
  app.use("*", (c, next) => c.req.path.startsWith("/v1/webhooks/") ? next() : c.req.method === "POST" && /^\/v1\/conversations\/[^/]+\/messages$/.test(c.req.path)
    && c.req.header("content-type")?.startsWith("multipart/form-data") ? uploadLimit(c, next) : jsonLimit(c, next));
  app.use("*", async (c, next) => {
    // Provider webhooks are authenticated by their signature, not by a browser origin.
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !c.req.path.startsWith("/v1/webhooks/") && c.req.header("origin") !== config.webOrigin) {
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
  // Google sign-in (PKCE). The browser asks for the provider URL; the verifier cookie is set on this response, so the
  // return to /auth/confirm completes in the same browser. New Google accounts start as unconfirmed students and choose
  // student or tutor once afterwards (POST /v1/auth/role).
  app.post("/v1/auth/oauth/google", async (c) => {
    const { data, error } = await c.get("client").auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${config.webOrigin}/auth/confirm?oauth=1`, skipBrowserRedirect: true } });
    if (error || !data.url) throw new AppError(503, "oauth_unavailable", "Google sign-in is not available right now");
    return c.json({ url: data.url });
  });
  // An account made with Google starts as an unconfirmed student; the database lets its owner choose student or tutor once.
  app.post("/v1/auth/role", async (c) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    const { role } = roleChoice.parse(await c.req.json());
    const { data, error } = await c.get("client").from("profiles").update({ role, role_confirmed: true }).eq("id", identity.id).eq("role_confirmed", false).select("id");
    if (error) throw new AppError(503, "database_unavailable", "Could not save your choice; please try again");
    if (!data?.length) throw new AppError(409, "role_already_chosen", "Your account type has already been chosen");
    return c.json({ identity: await (dependencies.identify ?? identify)(c.get("client")) });
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
  app.get("/v1/calendar", async (c) => {
    const range = calendarRange.parse(c.req.query());
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    return c.json({ sessions: await calendarSessions(c.get("client"), identity, range.from, range.to) });
  });
  let eventsCache: EventIntake | null | undefined;
  const notifyAccepted = async () => {
    if (!dependencies.onEventAccepted) return;
    try { await dependencies.onEventAccepted(); }
    catch { console.error(JSON.stringify({ event: "event_notify_failed" })); }
  };
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
  app.use("/v1/conversations/*", async (c, next) => {
    c.set("identity", await (dependencies.identify ?? identify)(c.get("client"))); await next();
  });
  app.get("/v1/conversations/with/:counterpartId", async (c) => c.json(await openThread(c.get("client"), c.get("identity"), uuid.parse(c.req.param("counterpartId")))));
  app.get("/v1/conversations/:id/messages", async (c) => c.json(await conversationMessages(c.get("client"), uuid.parse(c.req.param("id")), messagesQuery.parse(c.req.query()))));
  app.post("/v1/conversations/:id/messages", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    let body = ""; let file: File | null = null;
    if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form = await c.req.parseBody();
      body = typeof form.body === "string" ? form.body : "";
      file = form.file instanceof File && form.file.size > 0 ? form.file : null;
    } else {
      const json = z.object({ body: z.string() }).strict().parse(await c.req.json()); body = json.body;
    }
    return c.json({ message: await sendMessage(c.get("client"), c.get("identity"), id, { body, file }) }, 201);
  });
  // Public catalogue: anonymous RLS role, no cookies, short browser cache. Only approved real tutors are visible.
  const anonymous = () => createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicCache = (c: { header(name: string, value: string): void }) => c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  app.get("/v1/public/tutors", async (c) => { publicCache(c); return c.json(await publicTutors(anonymous(), tutorQuery.parse(c.req.query()))); });
  app.get("/v1/public/tutors/:id", async (c) => { publicCache(c); return c.json({ tutor: await publicTutor(anonymous(), uuid.parse(c.req.param("id"))) }); });
  // Open times change as lessons are booked, so they are never cached.
  app.get("/v1/public/tutors/:id/slots", async (c) => c.json({ slots: await openSlots(anonymous(), uuid.parse(c.req.param("id"))) }));
  let stripeCache: Billing | null | undefined;
  const billing = (): Billing | null => dependencies.billing !== undefined ? dependencies.billing : (stripeCache === undefined ? (stripeCache = stripeBilling()) : stripeCache);
  app.use("/v1/student/*", async (c, next) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    requireRole(identity, ["student"]); c.set("identity", identity); await next();
  });
  // Streams over the same cookie session. A 429 here means the daily allowance is spent.
  app.post("/v1/student/chat", async (c) => chatTurn(c.get("client"), c.get("identity"), chatRequest.parse(await c.req.json()), { model: dependencies.chatModel, keepAlive: (work) => { try { c.executionCtx.waitUntil(Promise.resolve(work)); } catch { /* no execution context on Node: the process keeps running */ } } }));
  app.get("/v1/student/chat/conversations", async (c) => c.json({ conversations: await chatConversations(c.get("client"), c.get("identity")) }));
  app.post("/v1/student/chat/conversations", async (c) => c.json(await createChatConversation(c.get("client"), c.get("identity")), 201));
  app.get("/v1/student/chat/conversations/:id", async (c) => c.json(await chatTranscript(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id")))));
  app.delete("/v1/student/chat/conversations/:id", async (c) => { await deleteChatConversation(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id"))); return c.json({ success: true }); });
  app.post("/v1/student/tutors/:id/requests", async (c) => c.json(await requestLesson(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id")), lessonRequestInput.parse(await c.req.json())), 201));
  app.get("/v1/student/billing", async (c) => c.json(await studentBilling(c.get("client"), c.get("identity"), billing())));
  app.post("/v1/student/billing/setup", async (c) => c.json(await startPaymentMethodSetup(c.get("client"), c.get("identity"), billing(), config.webOrigin)));
  app.post("/v1/student/billing/portal", async (c) => c.json(await openBillingPortal(c.get("client"), c.get("identity"), billing(), config.webOrigin)));
  app.put("/v1/student/billing/auto-charge", async (c) => {
    const input = autoChargeInput.parse(await c.req.json());
    await setAutoCharge(c.get("client"), c.get("identity"), billing(), input.enabled);
    return c.json({ success: true });
  });
  // Signed provider events are persisted before they are acknowledged. A persistence failure answers 503 so the
  // provider retries; everything after persistence is the worker's job. Unhandled event types are acknowledged unstored.
  app.post("/v1/webhooks/stripe", async (c) => {
    const signature = c.req.header("stripe-signature");
    const verify = dependencies.verifyStripe !== undefined ? dependencies.verifyStripe : (process.env.STRIPE_WEBHOOK_SECRET
      // The async form runs on Node and on runtimes that only provide asynchronous Web Crypto (Cloudflare Workers).
      ? (raw: string, header: string) => Stripe.webhooks.constructEventAsync(raw, header, process.env.STRIPE_WEBHOOK_SECRET!) as unknown as Promise<VerifiedStripeEvent> : null);
    if (!signature || !verify) throw new AppError(400, "webhook_not_configured", "Webhook not configured");
    let event: VerifiedStripeEvent;
    try { event = await verify(await c.req.text(), signature); } catch { throw new AppError(400, "invalid_signature", "Invalid signature"); }
    const normalized = normalizeStripeEvent(event);
    if (!normalized) return c.json({ received: true });
    const intake = dependencies.events !== undefined ? dependencies.events : (eventsCache ??= eventIntake());
    if (!intake) throw new AppError(503, "events_unavailable", "Event intake is not configured");
    let accepted: boolean;
    try { accepted = await intake.accept("stripe", event.id, event.type, normalized); }
    catch { throw new AppError(503, "events_unavailable", "Could not record this event; please retry"); }
    if (accepted) await notifyAccepted();
    return c.json({ received: true });
  });
  // LiveKit events follow the same rule: persist the signed event, acknowledge, let the worker act on it.
  // A wrong path elsewhere answers 404 rather than a page, so a misconfigured webhook is visible to LiveKit.
  app.post("/v1/webhooks/livekit", async (c) => {
    const key = process.env.LIVEKIT_API_KEY; const secret = process.env.LIVEKIT_API_SECRET;
    const verify = dependencies.verifyLiveKit !== undefined ? dependencies.verifyLiveKit : (key && secret ? (raw: string, header: string | undefined) => new WebhookReceiver(key, secret).receive(raw, header) : null);
    if (!verify) throw new AppError(503, "webhook_not_configured", "Webhook not configured");
    let event: WebhookEvent;
    try { event = await verify(await c.req.text(), c.req.header("authorization")); } catch { throw new AppError(401, "invalid_signature", "Invalid LiveKit webhook signature"); }
    const normalized = normalizeLiveKitEvent(event);
    if (!normalized || !event.id) return c.json({ received: true });
    const intake = dependencies.events !== undefined ? dependencies.events : (eventsCache ??= eventIntake());
    if (!intake) throw new AppError(503, "events_unavailable", "Event intake is not configured");
    let accepted: boolean;
    try { accepted = await intake.accept("livekit", event.id, event.event, normalized); }
    catch { throw new AppError(503, "events_unavailable", "Could not record this event; please retry"); }
    if (accepted) await notifyAccepted();
    return c.json({ received: true });
  });
  app.get("/v1/contacts", async (c) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    return c.json({ contacts: await contacts(c.get("client"), identity) });
  });
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
  app.post("/v1/tutor/lessons", async (c) => {
    const input = scheduleInput.parse(await c.req.json());
    const result = await c.get("client").rpc("schedule_lessons_v1", { p_student_id: input.studentId, p_start: input.startTime,
      p_hours: input.durationHours, p_count: input.count, p_name: input.lessonName, p_request_id: input.requestId ?? null, p_command_id: input.commandId });
    schedulingError(result.error); return c.json(result.data, 201);
  });
  app.get("/v1/tutor/payouts", async (c) => c.json(await payoutState(c.get("client"), c.get("identity"), billing())));
  app.post("/v1/tutor/payouts/onboarding", async (c) => c.json(await startPayoutOnboarding(c.get("client"), c.get("identity"), billing(), config.webOrigin)));
  app.post("/v1/tutor/payouts/dashboard", async (c) => c.json(await openPayoutDashboard(c.get("client"), c.get("identity"), billing())));
  app.get("/v1/tutor/requests", async (c) => {
    const { page } = requestsQuery.parse(c.req.query());
    const result = await c.get("client").from("lesson_requests").select("*", { count: "exact" }).eq("tutor_id", c.get("identity").id)
      .eq("status", "pending").order("created_at", { ascending: false }).order("id").range(page * 50, page * 50 + 49);
    databaseResult(result.error);
    const ids = [...new Set((result.data ?? []).map((r) => r.student_id))];
    const students = ids.length ? await c.get("client").from("profiles").select("id,full_name").in("id", ids) : { data: [], error: null };
    databaseResult(students.error);
    return c.json({ requests: result.data ?? [], studentNames: Object.fromEntries((students.data ?? []).map((student) => [student.id, student.full_name])), total: result.count ?? 0, page, pageSize: 50 });
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
  app.get("/v1/bookings/:id/review", async (c) => {
    let store: ReturnType<typeof recordingStore> | undefined;
    return c.json(await sessionReview(c.get("client"), c.get("identity"), uuid.parse(c.req.param("id")),
      async (path) => { try { store ??= recordingStore(); return await store.sign(path, 3600); } catch { return null; } }));
  });
  app.post("/v1/bookings/:id/invoice", async (c) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    return c.json(await sendLessonInvoice(c.get("client"), identity, billing(), uuid.parse(c.req.param("id"))), 201);
  });
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
  for (const kind of ["complete", "reopen", "cancel", "reschedule"] as const) app.post(`/v1/bookings/:id/${kind}`, async (c) => {
    requireRole(c.get("identity"), ["tutor"]);
    const id = uuid.parse(c.req.param("id"));
    const input = kind === "reschedule" ? rescheduleInput.parse(await c.req.json()) : kind === "cancel" ? cancelInput.parse(await c.req.json()) : {};
    const result = await c.get("client").rpc("tutor_change_lesson_v1", { p_id: id, p_kind: kind, p_input: input });
    schedulingError(result.error); return c.json(result.data);
  });
  app.use("/v1/requests/*", async (c, next) => {
    const identity = await (dependencies.identify ?? identify)(c.get("client"));
    requireRole(identity, ["tutor"]); c.set("identity", identity); await next();
  });
  app.get("/v1/requests/:id", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const result = await c.get("client").from("lesson_requests").select("*").eq("id", id).eq("tutor_id", c.get("identity").id).maybeSingle();
    databaseResult(result.error);
    if (!result.data) throw new AppError(404, "not_found", "Request not found");
    const student = await c.get("client").from("profiles").select("full_name").eq("id", result.data.student_id).maybeSingle();
    databaseResult(student.error); return c.json({ request: result.data, studentName: student.data?.full_name ?? "Student" });
  });
  app.post("/v1/requests/:id/schedule", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = requestScheduleInput.parse(await c.req.json());
    const request = await c.get("client").from("lesson_requests").select("student_id,subject").eq("id", id).eq("tutor_id", c.get("identity").id).maybeSingle();
    databaseResult(request.error);
    if (!request.data) throw new AppError(404, "not_found", "Request not found");
    const result = await c.get("client").rpc("schedule_lessons_v1", { p_student_id: request.data.student_id, p_start: input.startTime,
      p_hours: 1, p_count: input.count, p_name: input.lessonName || request.data.subject.replaceAll("_", " "), p_request_id: id, p_command_id: input.commandId });
    schedulingError(result.error); return c.json(result.data);
  });
  app.post("/v1/requests/:id/decline", async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const result = await c.get("client").from("lesson_requests").update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("id", id).eq("tutor_id", c.get("identity").id).eq("status", "pending").select("id");
    databaseResult(result.error);
    if (!result.data?.length) throw new AppError(409, "request_changed", "This request is no longer pending");
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

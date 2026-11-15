import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { createApp } from "../../apps/api/src/app.js";
import { assertJobRuntimePrivileges, migrateQueue, queue, queues } from "../../packages/jobs/src/queue.js";
import { checkBrowser, checkReviewBrowser } from "./browser.local.js";
import { grantJobRuntime } from "../../packages/jobs/src/permissions.js";
import { transcribeRecording, pruneRecordings } from "../../packages/jobs/src/lesson-jobs.js";
import { eventIntake, processProviderEvents, normalizeStripeEvent } from "../../packages/jobs/src/provider-events.js";
import { grantEventIntake } from "../../packages/jobs/src/permissions.js";
import { handleRecordingEvent, reconcileRecordings, type EgressControl } from "../../packages/jobs/src/recording-control.js";
import { normalizeLiveKitEvent } from "../../packages/jobs/src/livekit-events.js";
import { serve } from "@hono/node-server";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { TrackSource, TrackType, type WebhookEvent } from "livekit-server-sdk";
import type { BillingProvider } from "../../packages/domain/src/billing.js";
import { summarizeLesson } from "../../packages/jobs/src/summarization.js";

test("portable authentication, UI, RLS and durable lesson processing", async (t) => {
  const url = process.env.LOCAL_API_URL!;
  const dbUrl = process.env.LOCAL_DATABASE_URL!;
  for (const target of [url, dbUrl]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname), "local targets only");
  const admin = createClient(url, process.env.LOCAL_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const pool = new Pool({ connectionString: dbUrl, max: 2 });
  const users: string[] = [];
  const cleanupIds: string[] = [];
  t.after(async () => {
    await pool.query("update public.student_profiles set parent_id=null where parent_id=any($1::uuid[])", [users]);
    for (const id of cleanupIds) await pool.query("delete from public.bookings where id=$1", [id]);
    for (const id of users.reverse()) await admin.auth.admin.deleteUser(id);
    await pool.end();
  });
  const password = "LocalFixturePassword123!";
  async function user(role: string) {
    const email = `${role}-${crypto.randomUUID()}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: role } });
    assert.equal(error, null); assert.ok(data.user); users.push(data.user.id);
    return { id: data.user.id, email };
  }
  const student = await user("student"); const tutor = await user("tutor"); const outsider = await user("student");
  const parent = await user("parent"); const administrator = await user("student");
  await pool.query("update public.profiles set role='admin' where id=$1", [administrator.id]);
  await pool.query("insert into public.student_profiles(id,parent_id) values($1,$2)", [student.id, parent.id]);
  const { rows } = await pool.query("insert into public.bookings(student_id,tutor_id,subject,exam_board,start_time,end_time,amount_gbp_pence) values($1,$2,'Mathematics','AQA',now(),now()+interval '1 hour',3500) returning id", [student.id, tutor.id]);
  const bookingId = rows[0].id as string;
  cleanupIds.push(bookingId);
  const origin = "http://localhost:5173";
  const app = createApp({ webOrigin: origin, supabaseUrl: url, supabaseAnonKey: process.env.LOCAL_ANON_KEY!, secureCookies: false, commit: "integration" }, {
    live: { serverUrl: "wss://video.example.test", token: async (input) => `fixture:${input.identity}`, tutorPresent: async () => true },
  });
  async function signIn(email: string) {
    const response = await app.request("/v1/auth/sign-in", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.length > 0); assert.ok(cookies.every((cookie) => /httponly/i.test(cookie)));
    const payload = await response.json(); assert.equal("access_token" in payload, false);
    return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  }
  const cookie = await signIn(student.email);
  const tutorCookie = await signIn(tutor.email);
  const otherCookie = await signIn(outsider.email);
  const parentCookie = await signIn(parent.email);
  assert.equal((await app.request(`/v1/lessons/${bookingId}`, { headers: { cookie: parentCookie } })).status, 404, "linked parent cannot access live room");
  assert.equal((await app.request(`/v1/lessons/${bookingId}/token`, { method: "POST", headers: { cookie, origin } })).status, 409, "student cannot obtain token before tutor starts");
  assert.equal((await app.request(`/v1/lessons/${bookingId}/start`, { method: "POST", headers: { cookie, origin } })).status, 403);
  assert.equal((await app.request("/v1/parent/overview", { headers: { cookie } })).status, 403);
  const family = await app.request("/v1/parent/overview", { headers: { cookie: parentCookie } });
  assert.equal(family.status, 200);
  assert.equal((await family.json()).children[0].id, student.id);
  assert.equal((await app.request("/v1/admin/overview", { headers: { cookie } })).status, 403);
  assert.equal((await app.request(`/v1/admin/tutors/${tutor.id}/approve`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ evidenceNote: "Forged approval from student", confirmed: true }) })).status, 403);
  const deniedSlot = await app.request("/v1/tutor/availability", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ dayOfWeek: 1, startTime: "16:00", endTime: "17:00" }) });
  assert.equal(deniedSlot.status, 403);
  const invalidSlot = await app.request("/v1/tutor/availability", { method: "POST", headers: { cookie: tutorCookie, origin, "content-type": "application/json" }, body: JSON.stringify({ dayOfWeek: 8, startTime: "18:00", endTime: "17:00" }) });
  assert.equal(invalidSlot.status, 400);
  const newSlot = await app.request("/v1/tutor/availability", { method: "POST", headers: { cookie: tutorCookie, origin, "content-type": "application/json" }, body: JSON.stringify({ dayOfWeek: 1, startTime: "16:00", endTime: "17:00" }) });
  assert.equal(newSlot.status, 201, await newSlot.clone().text());
  const slotId = (await newSlot.json()).slot.id;
  const removedSlot = await app.request(`/v1/tutor/availability/${slotId}`, { method: "DELETE", headers: { cookie: tutorCookie, origin } });
  assert.equal(removedSlot.status, 200);
  const pendingRequest = await pool.query(`insert into public.lesson_requests(student_id,tutor_id,subject,exam_board,requested_start_time,requested_end_time)
    values($1,$2,'Mathematics','AQA',date_trunc('day',now())+interval '2 days 16 hours',date_trunc('day',now())+interval '2 days 17 hours') returning id`, [student.id, tutor.id]);
  const contactList = await app.request("/v1/contacts", { headers: { cookie } });
  assert.equal(contactList.status, 200);
  assert.deepEqual((await contactList.json()).contacts, [{ id: tutor.id, fullName: "tutor", email: tutor.email, sessionCount: 1 }]);
  // Messaging: participant-only, server-derived sender, validated attachments, bounded history.
  assert.equal((await app.request(`/v1/conversations/with/${tutor.id}`, { headers: { cookie: otherCookie } })).status, 404, "strangers cannot open a conversation");
  const opened = await Promise.all([1, 2].map(() => app.request(`/v1/conversations/with/${tutor.id}`, { headers: { cookie } })));
  for (const response of opened) assert.equal(response.status, 200, await response.clone().text());
  const thread = await opened[0].json();
  assert.equal(thread.conversationId, (await opened[1].json()).conversationId, "concurrent first opens share one conversation");
  const conversationId = thread.conversationId as string;
  const send = (cookieValue: string, body: BodyInit, headers: Record<string, string> = {}) => app.request(`/v1/conversations/${conversationId}/messages`, { method: "POST", headers: { cookie: cookieValue, origin, ...headers }, body });
  const json = { "content-type": "application/json" };
  assert.equal((await send(cookie, JSON.stringify({ body: "Hello tutor" }), json)).status, 201);
  assert.equal((await send(cookie, JSON.stringify({ body: "x", sender_id: tutor.id }), json)).status, 400, "client cannot choose the sender");
  assert.equal((await send(cookie, JSON.stringify({ body: "   " }), json)).status, 400, "empty messages are rejected");
  assert.equal((await send(otherCookie, JSON.stringify({ body: "intruder" }), json)).status, 404, "strangers cannot send");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const upload = (file: File | null, text = "") => { const form = new FormData(); form.set("body", text); if (file) form.set("file", file); return send(cookie, form); };
  const withImage = await upload(new File([png], "../homework photo.png", { type: "image/png" }), "See attached");
  assert.equal(withImage.status, 201, await withImage.clone().text());
  const sentImage = (await withImage.json()).message;
  assert.equal(sentImage.sender_id, student.id); assert.ok(sentImage.attachmentUrl, "attachment is signed after RLS passes");
  assert.equal("attachment_path" in sentImage, false, "storage paths are not exposed");
  const fetched = await fetch(sentImage.attachmentUrl);
  assert.equal(fetched.status, 200); assert.equal(fetched.headers.get("content-type"), "image/png");
  const stored = await pool.query("select attachment_path from public.direct_messages where id=$1", [sentImage.id]);
  assert.match(stored.rows[0].attachment_path, new RegExp(`^${conversationId}/${student.id}/[0-9a-f-]{36}-[a-zA-Z0-9._-]+$`));
  assert.equal(stored.rows[0].attachment_path.includes(".."), false, "file names cannot traverse");
  assert.equal((await upload(new File(["<svg onload=alert(1)>"], "x.png", { type: "image/png" }))).status, 415, "bytes must match the declared type");
  assert.equal((await upload(new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "x.svg", { type: "image/svg+xml" }))).status, 415, "SVG is refused");
  assert.equal((await upload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" }))).status, 413, "oversized attachment");
  const tutorPoll = await app.request(`/v1/conversations/${conversationId}/messages?after=${encodeURIComponent("1970-01-01T00:00:00Z")}`, { headers: { cookie: tutorCookie } });
  assert.equal(tutorPoll.status, 200);
  assert.deepEqual((await tutorPoll.json()).messages.map((m: { body: string }) => m.body), ["Hello tutor", "See attached"]);
  assert.equal((await app.request(`/v1/conversations/${conversationId}/messages`, { headers: { cookie: otherCookie } })).status, 404, "strangers cannot read or poll");
  await pool.query(`insert into public.direct_messages(conversation_id,sender_id,body,created_at)
    select $1,$2,'bulk '||g,now()+g*interval '1 second' from generate_series(1,55) g`, [conversationId, student.id]);
  const firstPage = await (await app.request(`/v1/conversations/with/${tutor.id}`, { headers: { cookie } })).json();
  assert.equal(firstPage.messages.length, 50); assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.messages.at(-1).body, "bulk 55", "newest page is oldest-first and ends at the latest message");
  const earlier = await (await app.request(`/v1/conversations/${conversationId}/messages?before=${encodeURIComponent(firstPage.messages[0].created_at)}`, { headers: { cookie } })).json();
  assert.equal(earlier.messages.length, 7); assert.equal(earlier.hasMore, false);
  // Billing: a fake processor stands in for Stripe; no real charges are possible here.
  const invoiceCalls: Array<{ chargeAutomatically: boolean; destinationAccountId: string | null; amountPence: number }> = [];
  let customers = 0; let savedMethod: { brand: string; last4: string; kind: string } | null = null;
  const fakeBilling: BillingProvider = {
    createCustomer: async () => `cus_test${++customers}`,
    savedMethod: async () => savedMethod,
    setupSession: async () => "https://checkout.example/setup", portalSession: async () => "https://portal.example/session",
    createPayoutAccount: async () => "acct_test1", onboardingLink: async () => "https://connect.example/onboard", dashboardLink: async () => "https://connect.example/dash",
    payoutsReady: async () => false,
    sendInvoice: async (input) => { invoiceCalls.push(input); return { id: `in_${input.bookingId.slice(0, 8)}`, url: "https://invoice.example/hosted" }; },
  };
  const billingApp = createApp({ webOrigin: origin, supabaseUrl: url, supabaseAnonKey: process.env.LOCAL_ANON_KEY!, secureCookies: false, commit: "integration" }, { billing: () => fakeBilling });
  const post = (cookieValue: string, path: string, body?: object, method = "POST") => billingApp.request(path, { method, headers: { cookie: cookieValue, origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await app.request("/v1/student/billing", { headers: { cookie } })).status, 200, "billing reads degrade when payments are unconfigured");
  assert.equal((await app.request("/v1/student/billing/setup", { method: "POST", headers: { cookie, origin } })).status, 503, "setup without a processor is refused plainly");
  assert.equal((await billingApp.request("/v1/student/billing", { headers: { cookie: tutorCookie } })).status, 403, "tutors have no student billing");
  const setups = await Promise.all([post(cookie, "/v1/student/billing/setup"), post(cookie, "/v1/student/billing/setup")]);
  for (const response of setups) { assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).url, "https://checkout.example/setup"); }
  const storedCustomer = await pool.query("select stripe_customer_id from public.profiles where id=$1", [student.id]);
  assert.match(storedCustomer.rows[0].stripe_customer_id, /^cus_test\d+$/, "the first customer written wins");
  assert.equal((await post(cookie, "/v1/student/billing/auto-charge", { enabled: true }, "PUT")).status, 409, "no automatic payment without a saved method");
  savedMethod = { brand: "visa", last4: "4242", kind: "card" };
  assert.equal((await post(cookie, "/v1/student/billing/auto-charge", { enabled: true }, "PUT")).status, 200);
  const billingState = await (await billingApp.request("/v1/student/billing", { headers: { cookie } })).json();
  assert.deepEqual([billingState.autoChargeEnabled, billingState.savedMethod?.last4], [true, "4242"]);
  savedMethod = null;
  assert.equal((await billingApp.request("/v1/tutor/payouts", { headers: { cookie: tutorCookie } })).status, 200);
  assert.equal((await post(cookie, "/v1/tutor/payouts/onboarding")).status, 403, "students cannot start payouts");
  assert.equal((await post(tutorCookie, "/v1/tutor/payouts/dashboard")).status, 409, "dashboard needs a connected account");
  assert.equal((await post(tutorCookie, "/v1/tutor/payouts/onboarding")).status, 200);
  assert.equal((await pool.query("select stripe_account_id from public.tutor_profiles where id=$1", [tutor.id])).rows[0].stripe_account_id, "acct_test1");
  const invoiced = await pool.query(`insert into public.bookings(student_id,tutor_id,subject,exam_board,start_time,end_time,status,amount_gbp_pence)
    values($1,$2,'Mathematics','AQA',now()-interval '2 hours',now()-interval '1 hour','completed',4000) returning id`, [student.id, tutor.id]);
  const invoicedId = invoiced.rows[0].id as string; cleanupIds.push(invoicedId);
  assert.equal((await post(cookie, `/v1/bookings/${invoicedId}/invoice`)).status, 403, "students cannot invoice");
  const sentInvoice = await post(tutorCookie, `/v1/bookings/${invoicedId}/invoice`);
  assert.equal(sentInvoice.status, 201, await sentInvoice.clone().text());
  assert.equal((await post(tutorCookie, `/v1/bookings/${invoicedId}/invoice`)).status, 409, "an invoice is sent once");
  assert.deepEqual(invoiceCalls.map((call) => [call.chargeAutomatically, call.destinationAccountId, call.amountPence]), [[false, null, 4000]]);
  const recorded = await pool.query("select stripe_invoice_id, payment_status from public.bookings where id=$1", [invoicedId]);
  assert.deepEqual(recorded.rows[0], { stripe_invoice_id: `in_${invoicedId.slice(0, 8)}`, payment_status: "pending" });
  // Revision chat: a mock model stands in for the AI Gateway, so no model call or cost is possible here.
  const prompts: Array<{ system: string; messages: number }> = [];
  const mockModel = new MockLanguageModelV4({ doStream: async (options) => {
    const system = options.prompt.find((part) => part.role === "system");
    prompts.push({ system: typeof system?.content === "string" ? system.content : "", messages: options.prompt.filter((part) => part.role !== "system").length });
    return { stream: simulateReadableStream({ chunks: [
      { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "Hello, " }, { type: "text-delta", id: "t1", delta: "world!" }, { type: "text-end", id: "t1" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, logprobs: undefined,
        usage: { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined } } },
    ] }) };
  } });
  const chatApp = createApp({ webOrigin: origin, supabaseUrl: url, supabaseAnonKey: process.env.LOCAL_ANON_KEY!, secureCookies: false, commit: "integration" }, { chatModel: mockModel });
  const chatPost = (cookieValue: string, body: unknown) => chatApp.request("/v1/student/chat", { method: "POST", headers: { cookie: cookieValue, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  const turnBody = (chatId: string, text: string, id = `u-${crypto.randomUUID()}`) => ({ chatId, message: { id, role: "user", parts: [{ type: "text", text }] } });
  const created = await chatApp.request("/v1/student/chat/conversations", { method: "POST", headers: { cookie, origin } });
  assert.equal(created.status, 201);
  const chatId = (await created.json()).id as string;
  assert.equal((await chatApp.request("/v1/student/chat/conversations", { method: "POST", headers: { cookie: tutorCookie, origin } })).status, 403, "only students chat");
  assert.equal((await chatPost(otherCookie, turnBody(chatId, "intruder"))).status, 404, "other students cannot use this conversation");
  assert.equal((await chatPost(cookie, { chatId, message: { id: "m", role: "user", parts: [{ type: "file", url: "x" }] } })).status, 400, "only text parts are accepted");
  // With no AI credential the assistant is unavailable, and that must not spend the student's allowance.
  const unconfigured = createApp({ webOrigin: origin, supabaseUrl: url, supabaseAnonKey: process.env.LOCAL_ANON_KEY!, secureCookies: false, commit: "integration" });
  const spentBefore = (await pool.query("select coalesce(sum(used),0)::int as n from private.chat_usage where student_id=$1", [student.id])).rows[0].n;
  const refused = await unconfigured.request("/v1/student/chat", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(turnBody(chatId, "Is anyone there?")) });
  assert.equal(refused.status, 503, await refused.clone().text());
  assert.equal((await pool.query("select coalesce(sum(used),0)::int as n from private.chat_usage where student_id=$1", [student.id])).rows[0].n, spentBefore, "an unavailable assistant costs nothing");
  const reply = await chatPost(cookie, turnBody(chatId, "Explain centripetal force"));
  assert.equal(reply.status, 200, await reply.clone().text());
  assert.match(await reply.text(), /Hello, /);
  for (let i = 0; i < 50 && (await pool.query("select count(*)::int as n from public.chat_messages where conversation_id=$1", [chatId])).rows[0].n < 2; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  const chatRows = await pool.query("select role from public.chat_messages where conversation_id=$1 order by created_at", [chatId]);
  assert.deepEqual(chatRows.rows.map((row) => row.role), ["user", "assistant"], "both turns persist");
  assert.match(prompts[0].system, /revision assistant/); assert.match(prompts[0].system, /The student has [1-9]\d* completed lessons?\./, "grounding reflects the real lesson count");
  assert.equal((await pool.query("select title from public.chat_conversations where id=$1", [chatId])).rows[0].title, "Explain centripetal force");
  const transcript = await (await chatApp.request(`/v1/student/chat/conversations/${chatId}`, { headers: { cookie } })).json();
  assert.equal(transcript.messages.length, 2); assert.equal(transcript.conversations.length, 1);
  assert.equal((await chatApp.request(`/v1/student/chat/conversations/${chatId}`, { headers: { cookie: otherCookie } })).status, 404);
  // History is bounded at the source: a long thread still sends at most 12 messages.
  await pool.query(`insert into public.chat_messages(id,conversation_id,student_id,role,message,created_at)
    select 'old-'||g,$1,$2,case when g%2=0 then 'assistant' else 'user' end,
      jsonb_build_object('id','old-'||g,'role',case when g%2=0 then 'assistant' else 'user' end,'parts',jsonb_build_array(jsonb_build_object('type','text','text','old '||g))),now()-interval '1 day'+g*interval '1 second'
    from generate_series(1,40) g`, [chatId, student.id]);
  assert.equal((await chatPost(cookie, turnBody(chatId, "And now?"))).status, 200);
  assert.ok(prompts.at(-1)!.messages <= 12, `history sent to the model is bounded (${prompts.at(-1)!.messages})`);
  // The allowance is exact under concurrency and cannot be reset by deleting messages.
  await pool.query("update private.chat_usage set used=37 where student_id=$1", [student.id]);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => chatPost(cookie, turnBody(chatId, `burst ${i}`))));
  assert.equal(burst.filter((response) => response.status === 200).length, 3, "exactly the remaining allowance is spent");
  assert.equal(burst.filter((response) => response.status === 429).length, 3);
  await Promise.all(burst.map((response) => response.text()));
  await pool.query("delete from public.chat_messages where student_id=$1", [student.id]);
  assert.equal((await chatPost(cookie, turnBody(chatId, "after deleting"))).status, 429, "deleting history does not reset the cap");
  assert.equal((await chatApp.request(`/v1/student/chat/conversations/${chatId}`, { method: "DELETE", headers: { cookie, origin } })).status, 200);
  assert.equal((await app.request(`/v1/bookings/${bookingId}`, { headers: { cookie } })).status, 200);
  assert.equal((await app.request(`/v1/bookings/${bookingId}`, { headers: { cookie: otherCookie } })).status, 404);
  assert.equal((await app.request(`/v1/bookings/${bookingId}/name`, { method: "PATCH", headers: { cookie: otherCookie, origin, "content-type": "application/json" }, body: JSON.stringify({ lessonName: "Forged" }) })).status, 404);
  const renamed = await app.request(`/v1/bookings/${bookingId}/name`, { method: "PATCH", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ lessonName: "  Integration revision  " }) });
  assert.equal(renamed.status, 200, await renamed.clone().text());
  assert.equal((await renamed.json()).booking.lesson_name, "Integration revision");
  const persisted = await pool.query("select lesson_name, amount_gbp_pence from public.bookings where id=$1", [bookingId]);
  assert.deepEqual(persisted.rows[0], { lesson_name: "Integration revision", amount_gbp_pence: 3500 });
  const anonymous = createClient(url, process.env.LOCAL_ANON_KEY!, { auth: { persistSession: false } });
  assert.ok((await anonymous.rpc("rename_booking_lesson", { p_booking_id: bookingId, p_lesson_name: "Anonymous" })).error);
  const logout = await app.request("/v1/auth/sign-out", { method: "POST", headers: { cookie, origin } });
  assert.equal(logout.status, 200); assert.ok(logout.headers.getSetCookie().some((value) => /max-age=0/i.test(value)));
  await checkBrowser({ url, anonKey: process.env.LOCAL_ANON_KEY!, studentEmail: student.email, tutorEmail: tutor.email, parentEmail: parent.email, adminEmail: administrator.email, outsiderEmail: outsider.email, password, bookingId });
  // Public catalogue, UK-time slots and the transactional lesson request.
  const publicGet = (path: string) => app.request(path);
  await pool.query("update public.tutor_profiles set dbs_verified=false where id=$1", [tutor.id]); // the browser journey approved this tutor
  assert.deepEqual((await (await publicGet("/v1/public/tutors")).json()).tutors, [], "an unapproved tutor is not public");
  assert.equal((await publicGet(`/v1/public/tutors/${tutor.id}`)).status, 404);
  const injected = "</script><script>alert(1)</script>";
  await pool.query("update public.tutor_profiles set dbs_verified=true, is_demo=false, subjects='{Mathematics}', boards='{AQA}', headline=$2, bio='Experienced tutor', hourly_rate=3500 where id=$1", [tutor.id, injected]);
  await pool.query("insert into public.availability(tutor_id,day_of_week,start_time,end_time) select $1,d,'10:00','12:00' from generate_series(0,6) d", [tutor.id]);
  const catalogueResponse = await publicGet("/v1/public/tutors");
  assert.match(catalogueResponse.headers.get("cache-control")!, /^public/, "the catalogue may be cached briefly");
  const catalogue = await catalogueResponse.json();
  assert.equal(catalogue.total, 1); assert.equal(catalogue.approved, 1);
  assert.deepEqual(Object.keys(catalogue.tutors[0]).sort(), ["availableDays", "avatarUrl", "bio", "boards", "fullName", "headline", "hourlyRatePence", "id", "subjects", "yearsExperience"], "no private fields are exposed");
  assert.equal((await (await publicGet("/v1/public/tutors?subject=Physics")).json()).total, 0, "filters apply");
  assert.equal((await (await publicGet("/v1/public/tutors?maxPrice=999&day=nonsense")).json()).total, 1, "invalid filters are ignored, not errors");
  assert.equal((await publicGet(`/v1/public/tutors/${tutor.id}`)).status, 200);
  const slotsResponse = await publicGet(`/v1/public/tutors/${tutor.id}/slots`);
  assert.match(slotsResponse.headers.get("cache-control")!, /no-store/, "open times are never cached");
  const slotsBody = await slotsResponse.json(); assert.equal(slotsResponse.status, 200, JSON.stringify(slotsBody));
  const openTimes: string[] = slotsBody.slots;
  assert.ok(openTimes.length >= 20);
  assert.ok(openTimes.every((time) => ["10", "11"].includes(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).format(new Date(time)))), "slots are UK wall-clock hours");
  const requestCookie = await signIn(student.email);
  const requestSlot = (time: string, extra: object = {}, cookieValue = requestCookie) => app.request(`/v1/student/tutors/${tutor.id}/requests`, { method: "POST", headers: { cookie: cookieValue, origin, "content-type": "application/json" }, body: JSON.stringify({ subject: "Mathematics", examBoard: "AQA", startTime: time, ...extra }) });
  assert.equal((await app.request(`/v1/student/tutors/${tutor.id}/requests`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await requestSlot(openTimes[0], {}, await signIn(tutor.email))).status, 403, "tutors cannot request lessons");
  const firstRequest = await requestSlot(openTimes[0]);
  assert.equal(firstRequest.status, 201, await firstRequest.clone().text());
  assert.equal((await firstRequest.json()).isTrial, false, "the pair already has lessons, so this is not a free trial");
  assert.equal((await (await requestSlot(openTimes[0])).json()).duplicate, true, "a repeat is recognised");
  assert.equal((await requestSlot(openTimes[0], { subject: "Physics" })).status, 409, "an unoffered subject is refused");
  assert.equal((await requestSlot(new Date(Date.parse(openTimes[1]) + 30 * 60000).toISOString())).status, 409, "an off-grid time is refused");
  assert.equal((await requestSlot(openTimes[1], { surprise: true })).status, 400, "unknown fields are rejected");
  assert.equal((await requestSlot(openTimes[1])).status, 201); assert.equal((await requestSlot(openTimes[2])).status, 201);
  assert.equal((await requestSlot(openTimes[3])).status, 429, "open requests per tutor are bounded");
  const forged = createClient(url, process.env.LOCAL_ANON_KEY!, { auth: { persistSession: false } });
  await forged.auth.signInWithPassword({ email: student.email, password });
  assert.ok((await forged.from("lesson_requests").insert({ student_id: student.id, tutor_id: tutor.id, subject: "Mathematics", exam_board: "AQA", requested_start_time: openTimes[5], requested_end_time: openTimes[6], is_trial: true })).error, "direct inserts are closed");
  assert.equal((await pool.query("select count(*)::int as n from public.direct_messages where body like 'New lesson request%' and sender_id=$1", [student.id])).rows[0].n, 3, "each request notified the tutor atomically");
  await pool.query("delete from public.lesson_requests where student_id=$1 and status='pending' and requested_start_time = any($2::timestamptz[])", [student.id, openTimes.slice(0, 3)]);
  // Prerendering: crawlable HTML from the same API, with tutor-written text unable to break out of the data script.
  const apiServer = serve({ fetch: (request) => app.fetch(request), hostname: "127.0.0.1", port: 0 });
  const apiAddress = await new Promise<number>((ready) => { if (apiServer.listening) ready((apiServer.address() as { port: number }).port); else apiServer.on("listening", () => ready((apiServer.address() as { port: number }).port)); });
  const publicDist = await mkdtemp(join(tmpdir(), "tutors-prerender-"));
  await writeFile(join(publicDist, "index.html"), '<!doctype html><html><head><title>Kindling</title></head><body><div id="root"></div></body></html>');
  try {
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/migration/prerender.mts"], { env: { ...process.env, PRERENDER_API_ORIGIN: `http://127.0.0.1:${apiAddress}`, PUBLIC_SITE_ORIGIN: "https://kindling.example", PRERENDER_DIST: publicDist, PRERENDER_REQUIRED: "1" }, timeout: 60000 });
    const listing = await readFile(join(publicDist, "tutors/index.html"), "utf8");
    const profilePage = await readFile(join(publicDist, `tutors/${tutor.id}/index.html`), "utf8");
    assert.match(listing, /<link rel="canonical" href="https:\/\/kindling.example\/tutors"\/>/); assert.match(listing, /Find your/);
    assert.match(profilePage, /<title>tutor, Mathematics tutor \| Kindling<\/title>/); assert.match(profilePage, /application\/ld\+json/);
    for (const html of [listing, profilePage]) assert.equal(html.includes(injected), false, "tutor text cannot close a script or inject markup");
    assert.match(await readFile(join(publicDist, "sitemap.xml"), "utf8"), new RegExp(`https://kindling.example/tutors/${tutor.id}`));
    for (const [slug, text] of [["", /A little <span>more<\/span> from every lesson/], ["pricing", /[Pp]ricing/], ["how-it-works", /<h1/], ["about", /<h1/]] as const) {
      const html = await readFile(join(publicDist, slug, "index.html"), "utf8");
      assert.match(html, /<div id="root">/); assert.match(html, text, `marketing page /${slug} is prerendered with its content`); assert.match(html, /<header class="sticky/, "inside the marketing frame");
    }
    assert.match(await readFile(join(publicDist, "sitemap.xml"), "utf8"), /kindling.example\/pricing/);
    assert.match(await readFile(join(publicDist, "robots.txt"), "utf8"), /Disallow: \/dashboard/);
  } finally { apiServer.close(); }
  const browserCreated = await pool.query("select id from public.bookings where lesson_request_id=$1", [pendingRequest.rows[0].id]);
  assert.equal(browserCreated.rows.length, 1); cleanupIds.push(browserCreated.rows[0].id);
  const consent = await app.request(`/v1/lessons/${bookingId}/consent`, { method: "POST", headers: { cookie: tutorCookie, origin } });
  assert.equal(consent.status, 200, await consent.clone().text());
  const roomToken = await app.request(`/v1/lessons/${bookingId}/token`, { method: "POST", headers: { cookie: tutorCookie, origin } });
  assert.equal(roomToken.status, 200);
  assert.equal((await roomToken.json()).token, `fixture:${tutor.id}`);
  const nextStart = new Date(); nextStart.setUTCDate(nextStart.getUTCDate() + 1); nextStart.setUTCHours(16, 0, 0, 0);
  const schedule = { studentId: student.id, startTime: nextStart.toISOString(), durationHours: 1, count: 2,
    lessonName: "Concurrent API schedule", commandId: crypto.randomUUID() };
  const createSchedule = (body = schedule) => app.request("/v1/tutor/lessons", { method: "POST", headers: { cookie: tutorCookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  const parallelSchedules = await Promise.all([createSchedule(), createSchedule()]);
  const scheduledIds: string[][] = [];
  for (const response of parallelSchedules) {
    assert.equal(response.status, 201, await response.clone().text()); scheduledIds.push((await response.json()).bookingIds);
  }
  assert.deepEqual(scheduledIds[0], scheduledIds[1], "concurrent same-key submissions return one committed schedule");
  assert.equal(scheduledIds[0].length, 2); cleanupIds.push(...scheduledIds[0]);
  assert.equal((await createSchedule({ ...schedule, lessonName: "Forged retry" })).status, 400);
  assert.equal((await createSchedule({ ...schedule, commandId: crypto.randomUUID() })).status, 409, "calendar clash fails without creating duplicates");

  await migrateQueue(dbUrl);
  const role = `portable_jobs_${process.pid}`;
  const secret = crypto.randomUUID();
  await pool.query(`create role ${role} login password '${secret}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
  // This role belongs to the runner-owned disposable cluster. The runner deletes
  // that cluster; the Supabase postgres role cannot DROP OWNED for another role.
  await pool.query("revoke all on schema app_jobs from public,anon,authenticated");
  await grantJobRuntime(pool, role);
  const runtime = new URL(dbUrl); runtime.username = role; runtime.password = secret;
  await assertJobRuntimePrivileges(runtime.toString());
  await pool.query(`grant authenticated to ${role}`);
  await assert.rejects(assertJobRuntimePrivileges(runtime.toString()), /must not own migrations/, "NOINHERIT must not conceal permission to SET ROLE authenticated");
  await assert.rejects(grantJobRuntime(pool, role), /excessive privileges/);
  await pool.query(`revoke authenticated from ${role}`);
  await assert.rejects(assertJobRuntimePrivileges(dbUrl), /must not own migrations/);
  const boss = queue(runtime.toString());
  await boss.start();
  try {
    const id = await boss.send(queues.heartbeat, { version: 1 }); assert.ok(id);
    const jobs = await boss.fetch<{ version: number }>(queues.heartbeat);
    assert.equal(jobs[0]?.data.version, 1);
    await boss.complete(queues.heartbeat, jobs[0].id);
    await boss.supervise(queues.heartbeat);
  } finally { await boss.stop(); }
  const restricted = new Pool({ connectionString: runtime.toString() });
  try {
    // Signed provider events: persisted before acknowledgement, deduplicated, applied later by the worker.
    const intakeRole = `portable_events_${process.pid}`; const intakeSecret = crypto.randomUUID();
    await pool.query(`create role ${intakeRole} login password '${intakeSecret}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
    await grantEventIntake(pool, intakeRole);
    const intakeUrl = new URL(dbUrl); intakeUrl.username = intakeRole; intakeUrl.password = intakeSecret;
    const intakePool = new Pool({ connectionString: intakeUrl.toString() });
    await assert.rejects(intakePool.query("select * from private.provider_events"), "intake cannot read stored events");
    await assert.rejects(intakePool.query("select * from public.bookings"), "intake cannot read application data");
    await assert.rejects(intakePool.query("select private.apply_invoice_status($1,'x','paid')", [invoicedId]), "intake cannot apply events");
    await intakePool.end();
    const hooks = createApp({ webOrigin: origin, supabaseUrl: url, supabaseAnonKey: process.env.LOCAL_ANON_KEY!, secureCookies: false, commit: "integration" }, {
      events: eventIntake(intakeUrl.toString()),
      verifyStripe: (raw, signature) => { if (signature !== "good") throw new Error("bad signature"); return JSON.parse(raw); },
    });
    const hook = (event: object, signature = "good") => hooks.request("/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: JSON.stringify(event) });
    const invoiceEvent = (id: string, type: string, invoice: string, booking = invoicedId) => ({ id, type, data: { object: { id: invoice, metadata: { booking_id: booking } } } });
    const paidInvoice = `in_${invoicedId.slice(0, 8)}`;
    assert.equal((await hook(invoiceEvent("evt_a", "invoice.paid", paidInvoice), "forged")).status, 400, "unsigned events are rejected");
    assert.equal((await hooks.request("/v1/webhooks/stripe", { method: "POST", body: "{}" })).status, 400, "a missing signature is rejected");
    assert.equal((await hook({ id: "evt_ignored", type: "customer.created", data: { object: {} } })).status, 200);
    assert.equal((await hook(invoiceEvent("evt_a", "invoice.paid", paidInvoice))).status, 200);
    assert.equal((await hook(invoiceEvent("evt_a", "invoice.paid", paidInvoice))).status, 200, "redelivery is acknowledged");
    assert.equal((await pool.query("select count(*)::int as n from private.provider_events where provider='stripe'")).rows[0].n, 1, "one stored event per provider id; unhandled types are not stored");
    const stored = await pool.query("select payload from private.provider_events where event_id='evt_a'");
    assert.deepEqual(stored.rows[0].payload, { kind: "invoice_status", bookingId: invoicedId, invoiceId: paidInvoice, status: "paid" }, "only minimal facts are kept");
    const setupCalls: string[] = [];
    const effects = { setDefaultPaymentMethod: async (customerId: string, intent: string) => { setupCalls.push(`${customerId}:${intent}`); } };
    assert.equal(await processProviderEvents(restricted, effects), 1);
    assert.equal((await pool.query("select payment_status from public.bookings where id=$1", [invoicedId])).rows[0].payment_status, "paid");
    await hook(invoiceEvent("evt_b", "invoice.payment_failed", paidInvoice));
    assert.equal(await processProviderEvents(restricted, effects), 1);
    assert.equal((await pool.query("select payment_status from public.bookings where id=$1", [invoicedId])).rows[0].payment_status, "paid", "a late failure cannot undo payment");
    // The webhook can beat the request that records the invoice: the event waits and retries, it is not lost.
    const early = await pool.query(`insert into public.bookings(student_id,tutor_id,subject,exam_board,start_time,end_time,status,amount_gbp_pence)
      values($1,$2,'Mathematics','AQA',now()-interval '4 hours',now()-interval '3 hours','completed',4000) returning id`, [student.id, tutor.id]);
    const earlyId = early.rows[0].id as string; cleanupIds.push(earlyId);
    await hook(invoiceEvent("evt_early", "invoice.paid", "in_early", earlyId));
    assert.equal(await processProviderEvents(restricted, effects), 0, "unmatched invoice is not applied");
    const waiting = await pool.query("select attempts, last_error, processed_at from private.provider_events where event_id='evt_early'");
    assert.deepEqual([waiting.rows[0].attempts, waiting.rows[0].last_error, waiting.rows[0].processed_at], [1, "invoice_not_recorded_yet", null]);
    await pool.query("update public.bookings set stripe_invoice_id='in_early', payment_status='pending' where id=$1", [earlyId]);
    assert.equal(await processProviderEvents(restricted, effects), 0, "backoff keeps the event leased");
    await pool.query("update private.provider_events set lease_until=now() where event_id='evt_early'");
    assert.equal(await processProviderEvents(restricted, effects), 1);
    assert.equal((await pool.query("select payment_status from public.bookings where id=$1", [earlyId])).rows[0].payment_status, "paid");
    await hook({ id: "evt_setup", type: "checkout.session.completed", data: { object: { mode: "setup", customer: "cus_x", setup_intent: "seti_x" } } });
    await hook({ id: "evt_pay_mode", type: "checkout.session.completed", data: { object: { mode: "payment", customer: "cus_x", setup_intent: null } } });
    assert.equal(await processProviderEvents(restricted, effects), 1);
    assert.deepEqual(setupCalls, ["cus_x:seti_x"]);
    // LiveKit: recording control is durable, idempotent and reconcilable. A fake media server records every call.
    const mediaCalls: string[] = []; let failNextAudio = false; let audioStarts = 0; let screenStarts = 0;
    const described = new Map<string, { finished: boolean; outcome: { ok: boolean; endedAt: string; filename?: string } } | null>();
    const media: EgressControl = {
      startAudio: async () => { if (failNextAudio) { failNextAudio = false; throw new Error("egress refused"); } mediaCalls.push("audio"); return `eg_audio_${++audioStarts}`; },
      startScreen: async () => { mediaCalls.push("screen"); return `eg_screen_${++screenStarts}`; },
      stop: async (id) => { mediaCalls.push(`stop:${id}`); },
      stopStray: async (_room, keep) => { mediaCalls.push(`stray:${keep.join(",")}`); },
      describe: async (id) => described.get(id) ?? null,
    };
    const live = { ...effects, recording: (event: Parameters<typeof handleRecordingEvent>[2], attempts: number) => handleRecordingEvent(restricted, media, event, attempts) };
    const lessonResult = await pool.query(`insert into public.bookings(student_id,tutor_id,subject,exam_board,start_time,end_time,amount_gbp_pence)
      values($1,$2,'Mathematics','AQA',now(),now()+interval '1 hour',3500) returning id`, [student.id, tutor.id]);
    const roomBooking = lessonResult.rows[0].id as string; cleanupIds.push(roomBooking);
    const room = { name: `booking-${roomBooking}` };
    const screenTrack = (sid: string) => ({ sid, type: TrackType.VIDEO, source: TrackSource.SCREEN_SHARE, mimeType: "video/H264", codecs: [] });
    const sdkHooks = createApp({ webOrigin: origin, supabaseUrl: url, supabaseAnonKey: process.env.LOCAL_ANON_KEY!, secureCookies: false, commit: "integration" }, {
      events: eventIntake(intakeUrl.toString()),
      verifyLiveKit: async (raw, authorization) => { if (authorization !== "good") throw new Error("bad signature"); return JSON.parse(raw) as WebhookEvent; },
    });
    const send = (event: object, authorization = "good") => sdkHooks.request("/v1/webhooks/livekit", { method: "POST", headers: { authorization }, body: JSON.stringify(event) });
    const run = async () => { let total = 0; for (let i = 0; i < 5; i++) total += await processProviderEvents(restricted, live); return total; };
    const state = async () => (await pool.query("select kind,status,egress_id,track_sid,storage_path from public.session_recordings where booking_id=$1 order by created_at", [roomBooking])).rows;
    assert.equal((await send({ id: "lk_bad", event: "participant_joined", room, participant: { identity: tutor.id } }, "forged")).status, 401, "unsigned LiveKit events are rejected");
    assert.equal((await send({ id: "lk_ignored", event: "room_started", room })).status, 200);
    assert.equal((await send({ id: "lk_audio_track", event: "track_published", room, participant: { identity: tutor.id }, track: { sid: "TR_a", type: TrackType.AUDIO, source: TrackSource.MICROPHONE, codecs: [] } })).status, 200);
    assert.equal((await pool.query("select count(*)::int as n from private.provider_events where provider='livekit'")).rows[0].n, 0, "irrelevant events are not stored");
    await send({ id: "lk_join_0", event: "participant_joined", room, participant: { identity: tutor.id } });
    await run();
    assert.deepEqual(await state(), [], "no recording without the tutor's consent");
    await pool.query("insert into public.session_recording_consents(booking_id,tutor_id) values($1,$2)", [roomBooking, tutor.id]);
    await send({ id: "lk_join_student", event: "participant_joined", room, participant: { identity: student.id } });
    await run();
    assert.deepEqual(await state(), [], "a student joining never starts recording");
    await send({ id: "lk_join_1", event: "participant_joined", room, participant: { identity: tutor.id } });
    await send({ id: "lk_join_1", event: "participant_joined", room, participant: { identity: tutor.id } });
    await send({ id: "lk_join_2", event: "participant_joined", room, participant: { identity: tutor.id } });
    await run();
    let rows = await state();
    assert.equal(rows.length, 1, "duplicate joins reserve one recording"); assert.deepEqual([rows[0].kind, rows[0].status, rows[0].egress_id], ["audio", "active", "eg_audio_1"]);
    assert.equal(mediaCalls.filter((call) => call === "audio").length, 1, "one Egress job per call");
    await send({ id: "lk_screen_1", event: "track_published", room, participant: { identity: student.id }, track: screenTrack("TR_student") });
    await send({ id: "lk_screen_2", event: "track_published", room, participant: { identity: tutor.id }, track: screenTrack("TR_tutor") });
    await send({ id: "lk_screen_3", event: "track_published", room, participant: { identity: tutor.id }, track: screenTrack("TR_tutor") });
    await run();
    rows = await state();
    assert.deepEqual(rows.filter((row) => row.kind === "screen").map((row) => [row.track_sid, row.status, row.egress_id]), [["TR_tutor", "active", "eg_screen_1"]], "only the tutor's share, once");
    assert.match(rows.find((row) => row.kind === "screen")!.storage_path, /\/screen-TR_tutor\.mp4$/);
    await send({ id: "lk_screen_end", event: "track_unpublished", room, participant: { identity: tutor.id }, track: screenTrack("TR_tutor") });
    await run();
    assert.equal((await state()).find((row) => row.kind === "screen")!.status, "stopping"); assert.ok(mediaCalls.includes("stop:eg_screen_1"));
    await send({ id: "lk_egress_screen", event: "egress_ended", egressInfo: { egressId: "eg_screen_1", startedAt: 0, fileResults: [{ filename: `${roomBooking}/screen-TR_tutor.mp4`, size: 10, startedAt: 1700000000000000000, duration: 5000000000 }] } });
    await run();
    const finishedScreen = (await pool.query("select status, started_at, ended_at from public.session_recordings where egress_id='eg_screen_1'")).rows[0];
    assert.equal(finishedScreen.status, "ready"); assert.equal(finishedScreen.started_at.toISOString(), "2023-11-14T22:13:20.000Z", "the file's own media start is kept for playback alignment");
    assert.equal(finishedScreen.ended_at.toISOString(), "2023-11-14T22:13:25.000Z");
    await send({ id: "lk_left", event: "participant_left", room, participant: { identity: tutor.id } });
    await run();
    assert.equal((await state()).find((row) => row.kind === "audio")!.status, "stopping"); assert.ok(mediaCalls.includes("stop:eg_audio_1"));
    await send({ id: "lk_egress_audio_fail", event: "egress_ended", egressInfo: { egressId: "eg_audio_1", startedAt: 0, error: "x", fileResults: [] } });
    await run();
    assert.equal((await state()).find((row) => row.kind === "audio")!.status, "failed", "an Egress that saved nothing is a failed recording");
    // A refused start is retried with a short delay and never leaves the slot reserved.
    failNextAudio = true;
    await send({ id: "lk_rejoin", event: "participant_joined", room, participant: { identity: tutor.id } });
    assert.equal(await processProviderEvents(restricted, live), 0);
    assert.equal((await state()).filter((row) => row.kind === "audio" && row.status === "failed").length, 2, "failed reservation frees the slot");
    await pool.query("update private.provider_events set lease_until=now() where event_id='lk_rejoin'");
    assert.equal(await processProviderEvents(restricted, live), 1);
    assert.equal((await state()).filter((row) => row.kind === "audio" && row.status === "active").length, 1);
    // Reconciliation: a reservation that never reached LiveKit, and a job whose end webhook was lost.
    await pool.query("update public.session_recordings set status='stopping', created_at=now()-interval '20 minutes' where booking_id=$1 and status='active'", [roomBooking]);
    await pool.query("insert into public.session_recordings(booking_id,storage_path,status,kind,created_at) values($1,'stale/path.ogg','starting','audio',now()-interval '10 minutes')", [roomBooking]);
    described.set("eg_audio_2", { finished: true, outcome: { ok: true, endedAt: "2026-11-15T12:00:00.000Z", filename: `${roomBooking}/final.ogg` } });
    assert.equal(await reconcileRecordings(restricted, media), 2);
    rows = await state();
    assert.ok(rows.some((row) => row.storage_path === `${roomBooking}/final.ogg` && row.status === "ready"), "a lost egress_ended is settled from LiveKit's own record");
    assert.equal(rows.find((row) => row.storage_path === "stale/path.ogg")!.status, "failed");
    assert.equal(await reconcileRecordings(restricted, media), 0, "reconciliation is idempotent");
    assert.deepEqual(normalizeLiveKitEvent({ event: "participant_joined", room: { name: "lobby" }, participant: { identity: "x" } } as unknown as WebhookEvent), null, "rooms that are not bookings are ignored");
    assert.equal(normalizeStripeEvent({ type: "invoice.paid", data: { object: { id: "in_1", metadata: { booking_id: "not-a-uuid" } } } }), null, "events without a valid booking are ignored");
    await assert.rejects(restricted.query("select * from auth.users"));
    await assert.rejects(restricted.query("select * from public.bookings"));
    await assert.rejects(restricted.query("select * from private.lesson_segment_results"));
    await assert.rejects(restricted.query("update private.lesson_job_control set owner='worker'"));
    const { rows: recordings } = await pool.query(`insert into public.session_recordings(booking_id,storage_path,status,started_at)
      values($1,$2,'ready',now()),($1,$3,'ready',now()+interval '1 minute') returning id,storage_path`,
    [bookingId, `${bookingId}/first.ogg`, `${bookingId}/second.ogg`]);
    await pool.query("insert into public.session_analytics(booking_id,full_transcript) values($1,'[Tutor 0:00] Legacy words')", [bookingId]);
    let calls = 0;
    const store = { sign: async (path: string) => `https://recordings.example.test/${path}`, remove: async () => {} };
    const provider = async () => { calls++; return [{ role: "tutor" as const, start: 0, text: "New words" }]; };
    await transcribeRecording(restricted, recordings[0].id, store, provider);
    assert.equal(calls, 0, "legacy ownership fences worker processing");
    await pool.query("update private.lesson_job_control set owner='worker'");
    await Promise.all([transcribeRecording(restricted, recordings[0].id, store, provider), transcribeRecording(restricted, recordings[0].id, store, provider)]);
    assert.equal(calls, 1, "concurrent claims call provider once");
    await transcribeRecording(restricted, recordings[0].id, store, provider);
    assert.equal(calls, 1, "completion replay skips provider");
    // Simulate provider success followed by a process crash, then an expired lease.
    const { rows: claimed } = await restricted.query("select private.lesson_transcription_claim($1) as claim", [recordings[1].id]);
    const stale = claimed[0].claim;
    await pool.query("update private.lesson_segment_results set lease_until=now()-interval '1 second' where recording_id=$1", [recordings[1].id]);
    await transcribeRecording(restricted, recordings[1].id, store, provider);
    const late = await restricted.query("select private.lesson_transcription_publish($1,$2,'Stale words') as saved", [recordings[1].id, stale.token]);
    assert.equal(late.rows[0].saved, false, "a stale worker cannot publish over a new lease");
    const analytics = await pool.query("select full_transcript from public.session_analytics where booking_id=$1", [bookingId]);
    assert.equal(analytics.rows[0].full_transcript.match(/Legacy words/g)?.length, 1);
    assert.equal(analytics.rows[0].full_transcript.match(/New words/g)?.length, 2);
    const completed = await app.request(`/v1/bookings/${bookingId}/complete`, { method: "POST", headers: { cookie: tutorCookie, origin } });
    assert.equal(completed.status, 200, await completed.clone().text());
    await assert.rejects(summarizeLesson(restricted, bookingId, async () => { throw new Error("Embedding provider unavailable"); }), /provider unavailable/);
    const unprocessed = await pool.query("select summary_notes from public.session_analytics where booking_id=$1", [bookingId]);
    assert.equal(unprocessed.rows[0].summary_notes, null, "provider failure cannot publish partial summary");
    let generations = 0;
    const generate = async () => {
      generations++;
      await pool.query("update public.session_analytics set notes_markdown='Tutor edited while generating' where booking_id=$1", [bookingId]);
      return { summary: { whatWeCovered: "New words" }, notes: "Generated notes", ratio: 1,
        chunks: [{ content: "New words", embedding: Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0) }] };
    };
    await summarizeLesson(restricted, bookingId, generate);
    await summarizeLesson(restricted, bookingId, generate);
    assert.equal(generations, 1, "summary replay skips model and embedding calls");
    const published = await pool.query("select summary_notes,notes_markdown from public.session_analytics where booking_id=$1", [bookingId]);
    assert.deepEqual(published.rows[0].summary_notes, { whatWeCovered: "New words" });
    assert.equal(published.rows[0].notes_markdown, "Tutor edited while generating");
    const embeddings = await pool.query("select count(*)::int as total from public.session_embeddings where booking_id=$1", [bookingId]);
    assert.equal(embeddings.rows[0].total, 1);
    assert.equal((await pool.query("select count(*)::int as total from private.lesson_summary_pending where booking_id=$1", [bookingId])).rows[0].total, 0, "publication commits its wake-up marker deletion");
    const reviewCookie = await signIn(student.email);
    const review = await app.request(`/v1/bookings/${bookingId}/review`, { headers: { cookie: reviewCookie } });
    assert.equal(review.status, 200);
    assert.equal((await review.json()).canEditNotes, false);
    assert.equal((await app.request(`/v1/bookings/${bookingId}/review`, { headers: { cookie: otherCookie } })).status, 404);
    assert.equal((await app.request(`/v1/bookings/${bookingId}/notes`, { method: "PATCH", headers: { cookie: reviewCookie, origin, "content-type": "application/json" }, body: JSON.stringify({ notesMarkdown: "Student forgery" }) })).status, 403);
    await checkReviewBrowser({ url, anonKey: process.env.LOCAL_ANON_KEY!, tutorEmail: tutor.email, password, bookingId });
    const reopened = await app.request(`/v1/bookings/${bookingId}/reopen`, { method: "POST", headers: { cookie: tutorCookie, origin } });
    assert.equal(reopened.status, 200, await reopened.clone().text());
    const reset = await pool.query("select full_transcript,summary_notes,notes_markdown from public.session_analytics where booking_id=$1", [bookingId]);
    assert.match(reset.rows[0].full_transcript, /Legacy words/);
    assert.equal(reset.rows[0].summary_notes, null); assert.equal(reset.rows[0].notes_markdown, null);
    assert.equal((await pool.query("select count(*)::int as total from private.lesson_summary_pending where booking_id=$1", [bookingId])).rows[0].total, 1, "reopening durably requests derived-output regeneration");
    assert.equal((await pool.query("select count(*)::int as total from public.session_embeddings where booking_id=$1", [bookingId])).rows[0].total, 0);
    await pool.query("update public.session_recordings set expires_at=now()-interval '1 second' where booking_id=$1", [bookingId]);
    let deleted = 0;
    await pruneRecordings(restricted, { ...store, remove: async () => { deleted++; } });
    await pruneRecordings(restricted, { ...store, remove: async () => { deleted++; } });
    assert.equal(deleted, 2, "retention replay skips already expired rows");
  } finally { await restricted.end(); }
});

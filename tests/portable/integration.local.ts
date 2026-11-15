import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { createApp } from "../../apps/api/src/app.js";
import { assertJobRuntimePrivileges, migrateQueue, queue, queues } from "../../packages/jobs/src/queue.js";
import { checkBrowser, checkReviewBrowser } from "./browser.local.js";
import { grantJobRuntime } from "../../packages/jobs/src/permissions.js";
import { transcribeRecording, pruneRecordings } from "../../packages/jobs/src/lesson-jobs.js";
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
  const contactList = await app.request("/v1/contacts", { headers: { cookie } });
  assert.equal(contactList.status, 200);
  assert.deepEqual((await contactList.json()).contacts, [{ id: tutor.id, fullName: "tutor", email: tutor.email, sessionCount: 1 }]);
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
  const consent = await app.request(`/v1/lessons/${bookingId}/consent`, { method: "POST", headers: { cookie: tutorCookie, origin } });
  assert.equal(consent.status, 200, await consent.clone().text());
  const roomToken = await app.request(`/v1/lessons/${bookingId}/token`, { method: "POST", headers: { cookie: tutorCookie, origin } });
  assert.equal(roomToken.status, 200);
  assert.equal((await roomToken.json()).token, `fixture:${tutor.id}`);

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
    await pool.query("update public.bookings set status='completed' where id=$1", [bookingId]);
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
    const reviewCookie = await signIn(student.email);
    const review = await app.request(`/v1/bookings/${bookingId}/review`, { headers: { cookie: reviewCookie } });
    assert.equal(review.status, 200);
    assert.equal((await review.json()).canEditNotes, false);
    assert.equal((await app.request(`/v1/bookings/${bookingId}/review`, { headers: { cookie: otherCookie } })).status, 404);
    assert.equal((await app.request(`/v1/bookings/${bookingId}/notes`, { method: "PATCH", headers: { cookie: reviewCookie, origin, "content-type": "application/json" }, body: JSON.stringify({ notesMarkdown: "Student forgery" }) })).status, 403);
    await checkReviewBrowser({ url, anonKey: process.env.LOCAL_ANON_KEY!, tutorEmail: tutor.email, password, bookingId });
    await pool.query("update public.session_recordings set expires_at=now()-interval '1 second' where booking_id=$1", [bookingId]);
    let deleted = 0;
    await pruneRecordings(restricted, { ...store, remove: async () => { deleted++; } });
    await pruneRecordings(restricted, { ...store, remove: async () => { deleted++; } });
    assert.equal(deleted, 2, "retention replay skips already expired rows");
  } finally { await restricted.end(); }
});

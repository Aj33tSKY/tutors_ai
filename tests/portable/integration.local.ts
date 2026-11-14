import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { createApp } from "../../apps/api/src/app.js";
import { assertJobRuntimePrivileges, migrateQueue, queue, queues } from "../../packages/jobs/src/queue.js";
import { checkBrowser } from "./browser.local.js";

test("real Supabase cookies, RLS, transactional mutation and restricted job role", async (t) => {
  const url = process.env.LOCAL_API_URL!;
  const dbUrl = process.env.LOCAL_DATABASE_URL!;
  for (const target of [url, dbUrl]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(target).hostname), "local targets only");
  const admin = createClient(url, process.env.LOCAL_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const pool = new Pool({ connectionString: dbUrl, max: 2 });
  const users: string[] = [];
  const cleanupIds: string[] = [];
  t.after(async () => {
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
  const { rows } = await pool.query("insert into public.bookings(student_id,tutor_id,subject,exam_board,start_time,end_time,amount_gbp_pence) values($1,$2,'Mathematics','AQA',now(),now()+interval '1 hour',3500) returning id", [student.id, tutor.id]);
  const bookingId = rows[0].id as string;
  cleanupIds.push(bookingId);
  const origin = "http://localhost:5173";
  const app = createApp({ webOrigin: origin, supabaseUrl: url, supabaseAnonKey: process.env.LOCAL_ANON_KEY!, secureCookies: false, commit: "integration" });
  async function signIn(email: string) {
    const response = await app.request("/v1/auth/sign-in", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.length > 0); assert.ok(cookies.every((cookie) => /httponly/i.test(cookie)));
    const payload = await response.json(); assert.equal("access_token" in payload, false);
    return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  }
  const cookie = await signIn(student.email);
  const otherCookie = await signIn(outsider.email);
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
  await checkBrowser({ url, anonKey: process.env.LOCAL_ANON_KEY!, studentEmail: student.email, outsiderEmail: outsider.email, password, bookingId });

  await migrateQueue(dbUrl);
  const role = `portable_jobs_${process.pid}`;
  const secret = crypto.randomUUID();
  await pool.query(`create role ${role} login password '${secret}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
  // This role belongs to the runner-owned disposable cluster. The runner deletes
  // that cluster; the Supabase postgres role cannot DROP OWNED for another role.
  await pool.query(`revoke all on schema app_jobs from public,anon,authenticated; grant usage on schema app_jobs to ${role}; grant select,insert,update,delete on all tables in schema app_jobs to ${role}; grant usage,select on all sequences in schema app_jobs to ${role}; grant execute on all functions in schema app_jobs to ${role}`);
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
  try { await assert.rejects(restricted.query("select * from auth.users")); } finally { await restricted.end(); }
});

// Staging-only fixtures, safe to run repeatedly. Refuses to touch any project other than staging (tutors_dev).
//
//  1. Lists the seeded demo tutors in the public catalogue. `is_demo` is a trust control (a row-level-security policy and
//     the lesson-request function both exclude demo tutors so fake profiles never reach real users); staging only ever
//     holds fake data, so there it is switched off. Re-running supabase/seed.mjs sets it back on.
//  2. Creates a pre-confirmed test tutor with a generated password, kept in ~/.tutors-backups/cf-test/tutor.txt (never in the
//     repo), plus a weekly availability pattern so the profile is bookable.
//
// Usage: npx tsx scripts/staging/seed-fixtures.mts
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "khxcdmtppyzslxjecbgq";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(STAGING_REF) || !env.TUTORS_DEV_DATABASE_URL?.includes(STAGING_REF)) throw new Error("Refusing to run: .env.local does not point at the staging project.");

const db = new pg.Client({ connectionString: env.TUTORS_DEV_DATABASE_URL });
await db.connect();
const listed = await db.query(`update public.tutor_profiles t set is_demo = false from auth.users u
  where u.id = t.id and u.email like '%@demo.kindling.app' and t.is_demo returning t.id`);
console.log(`demo tutors now listed in the catalogue: ${listed.rowCount} newly listed`);

const dir = join(homedir(), ".tutors-backups", "cf-test");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = join(dir, "tutor.txt");
const email = "cf-test-tutor@demo.kindling.app";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const password = existsSync(file) ? /password=(.*)/.exec(readFileSync(file, "utf8"))![1] : randomBytes(18).toString("base64url");
let { data: existing } = await db.query("select id from auth.users where email = $1", [email]).then((r) => ({ data: r.rows[0] }));
if (!existing) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "CF Test Tutor", role: "tutor" } });
  if (created.error) throw created.error;
  existing = { id: created.data.user.id };
  console.log("created test tutor");
} else {
  const updated = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
  if (updated.error) throw updated.error;
  console.log("test tutor already existed; password re-applied");
}
writeFileSync(file, `email=${email}\npassword=${password}\nnote=staging only; created for end-to-end tests; delete when done\n`, { mode: 0o600 });
chmodSync(file, 0o600);
const profile = await admin.from("tutor_profiles").upsert({ id: existing.id, bio: "Test tutor for end-to-end checks.", headline: "End-to-end test tutor", hourly_rate: 4000,
  dbs_verified: true, is_demo: false, subjects: ["Physics"], boards: ["AQA"], years_experience: 5, rating: null }, { onConflict: "id" });
if (profile.error) throw profile.error;
await db.query("delete from public.availability where tutor_id = $1", [existing.id]);
for (const day of [1, 2, 3, 4, 5]) await db.query("insert into public.availability (tutor_id, day_of_week, start_time, end_time) values ($1,$2,'09:00','20:00')", [existing.id, day]);
console.log("test tutor profile and weekly availability ready");
const total = await db.query("select count(*)::int n from public.tutor_profiles where dbs_verified and not is_demo");
console.log(`publicly listed tutors on staging: ${total.rows[0].n}`);
await db.end();

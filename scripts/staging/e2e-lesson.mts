// End-to-end lesson on the live staging site, with simulated people: two real browsers (tutor and student) join a LiveKit room
// with a fake camera and microphone fed from synthesised speech, the tutor records and then completes the lesson, and this script
// follows the recording -> transcript -> summary pipeline until the summary lands.
//
// Needs macOS (`say`, `afconvert`) for the speech, the staging test accounts from scripts/staging/seed-fixtures.mts and
// e2e-signup-card.mts, and .env.local pointing at staging (used only to create the booking and to read the result).
// Usage: npx tsx scripts/staging/e2e-lesson.mts [https://staging.hybridtutors.co.uk]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const STAGING_REF = "khxcdmtppyzslxjecbgq";
const base = process.argv.find((a) => a.startsWith("http")) ?? "https://staging.hybridtutors.co.uk";
if (!/^https:\/\/staging\./.test(base)) throw new Error("Refusing to run against anything but staging.");
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(STAGING_REF) || !env.TUTORS_DEV_DATABASE_URL?.includes(STAGING_REF)) throw new Error("Refusing to run: .env.local does not point at the staging project.");
const work = process.env.E2E_WORK ?? "/tmp/e2e-lesson"; mkdirSync(work, { recursive: true });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);
const creds = (file: string) => Object.fromEntries(readFileSync(join(homedir(), ".tutors-backups", "cf-test", file), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) as Record<string, string>;
const student = creds("student.txt"), tutor = creds("tutor.txt");

// ---- 1. Speech for both people. Each file is silent while the other speaks, so the stereo recording separates the two voices.
const LEAD = 22; // seconds of silence first: both people connect and the recorder starts before anyone speaks
const script: Array<{ who: "tutor" | "student"; voice: string; text: string }> = [
  { who: "tutor", voice: "Daniel", text: "Hello, and welcome. Today we are revising Newton's second law of motion for A level physics. The resultant force equals mass multiplied by acceleration." },
  { who: "student", voice: "Flo (English (UK))", text: "So if a two kilogram trolley accelerates at three metres per second squared, the resultant force is six newtons." },
  { who: "tutor", voice: "Daniel", text: "Exactly right. Now suppose a friction force of two newtons acts against a six newton push. What is the acceleration of the trolley?" },
  { who: "student", voice: "Flo (English (UK))", text: "The resultant force is then four newtons, so the acceleration is two metres per second squared." },
  { who: "tutor", voice: "Daniel", text: "Perfect. You handled the resultant force correctly without any prompting, which is a real improvement. Well done, that is the end of our short lesson." },
];
function wavSamples(path: string): Int16Array { const b = readFileSync(path); const data = b.indexOf("data") + 8; return new Int16Array(b.buffer.slice(b.byteOffset + data, b.byteOffset + b.length - ((b.length - data) % 2))); }
function writeWav(path: string, samples: Int16Array) {
  const h = Buffer.alloc(44); h.write("RIFF", 0); h.writeUInt32LE(36 + samples.length * 2, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(samples.length * 2, 40);
  writeFileSync(path, Buffer.concat([h, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]));
}
const parts: Array<{ who: "tutor" | "student"; at: number; pcm: Int16Array }> = [];
let t = LEAD * 48000;
script.forEach((line, i) => {
  const aiff = join(work, `line${i}.aiff`), wav = join(work, `line${i}.wav`);
  execFileSync("say", ["-v", line.voice, "-o", aiff, line.text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", "-c", "1", aiff, wav]);
  const pcm = wavSamples(wav); parts.push({ who: line.who, at: t, pcm }); t += pcm.length + Math.round(1.2 * 48000);
});
const total = t + 6 * 48000;
for (const who of ["tutor", "student"] as const) { const track = new Int16Array(total); for (const p of parts.filter((x) => x.who === who)) track.set(p.pcm, p.at); writeWav(join(work, `${who}.wav`), track); }
const speechSeconds = Math.round(total / 48000);
log(`speech prepared: ${speechSeconds}s per person, speaking starts after ${LEAD}s`);

// ---- 2. A booking that is open now, between the two test accounts.
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const db = new pg.Client({ connectionString: env.TUTORS_DEV_DATABASE_URL }); await db.connect();
const idOf = async (email: string) => (await db.query("select id from auth.users where email = $1", [email])).rows[0].id as string;
const [studentId, tutorId] = [await idOf(student.email), await idOf(tutor.email)];
const start = new Date(Date.now() - 2 * 60000), end = new Date(start.getTime() + 60 * 60000);
const created = await admin.from("bookings").insert({ student_id: studentId, tutor_id: tutorId, subject: "Physics", exam_board: "AQA", start_time: start.toISOString(), end_time: end.toISOString(),
  status: "scheduled", payment_status: "paid", amount_gbp_pence: 4000 }).select("id").single();
if (created.error) throw created.error;
const bookingId = created.data.id as string; log(`booking ${bookingId} created for the test student and tutor`);

// ---- 3. Two browsers with fake devices.
const flags = (wav: string) => ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required"];
const tutorBrowser = await chromium.launch({ headless: true, args: flags(join(work, "tutor.wav")) });
const studentBrowser = await chromium.launch({ headless: true, args: flags(join(work, "student.wav")) });
const open = async (browser: typeof tutorBrowser, who: Record<string, string>) => {
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, permissions: ["camera", "microphone"] });
  const page = await context.newPage(); page.on("pageerror", (e) => log(`  page error: ${e.message.slice(0, 120)}`));
  await page.goto(`${base}/sign-in`);
  await page.getByLabel("Email", { exact: true }).fill(who.email); await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: /^Welcome back, / }).waitFor({ timeout: 30000 });
  return page;
};
const [tutorPage, studentPage] = [await open(tutorBrowser, tutor), await open(studentBrowser, student)];
log("both people signed in");
const shot = async (page: Page, name: string) => page.screenshot({ path: join(work, `${name}.png`) }).catch(() => undefined);
const fail = async (message: string): Promise<never> => { await shot(tutorPage, "tutor-failure"); await shot(studentPage, "student-failure"); await tutorBrowser.close(); await studentBrowser.close(); await db.end(); throw new Error(`${message} (screenshots in ${work})`); };

// Tutor starts the session, consents to recording and joins.
await tutorPage.goto(`${base}/session/${bookingId}`);
await tutorPage.getByRole("button", { name: /Start session/i }).click({ timeout: 30000 }).catch(() => fail("the tutor could not start the session"));
await tutorPage.getByText(/Continue this session/i).waitFor({ timeout: 30000 }).catch(() => fail("the lesson room did not open for the tutor"));
await tutorPage.getByRole("checkbox").check();
await tutorPage.getByRole("button", { name: /Continue and record/i }).click();
log("tutor started the session, consented to recording and joined");
await studentPage.goto(`${base}/session/${bookingId}`);
const joinButton = studentPage.getByRole("button", { name: /Join session/i });
await joinButton.waitFor({ timeout: 60000 }).catch(() => fail("the student never saw the join button"));
await studentPage.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => /Join session/i.test(x.textContent ?? "")); return b && !(b as HTMLButtonElement).disabled; }, undefined, { timeout: 60000 }).catch(() => fail("the student was never told the tutor had arrived"));
await joinButton.click();
log("student saw the tutor arrive and joined");
await tutorPage.waitForTimeout(8000); await shot(tutorPage, "tutor-in-call"); await shot(studentPage, "student-in-call");

// ---- 4. The conversation plays out through the fake microphones.
const callMs = (speechSeconds - 6) * 1000 + 4000;
log(`in the call; the conversation runs for about ${Math.round(callMs / 1000)}s`);
await tutorPage.waitForTimeout(callMs);
await tutorPage.getByRole("button", { name: /^Leave/i }).first().click({ timeout: 15000 }).catch(() => log("  (tutor Leave button not found; closing the browser instead)"));
await studentPage.getByRole("button", { name: /^Leave/i }).first().click({ timeout: 15000 }).catch(() => undefined);
await tutorPage.waitForTimeout(6000);
log("both people left the call");

// ---- 5. The tutor completes the lesson (an API call from the tutor's own session), then follow the pipeline.
const complete = await tutorPage.request.post(`${base}/v1/bookings/${bookingId}/complete`, { data: {}, headers: { origin: base } });
log(`tutor completed the lesson: HTTP ${complete.status()}`);
await tutorBrowser.close(); await studentBrowser.close();

const state = async () => {
  const rec = (await db.query("select kind, status, storage_path, transcribe_attempts, transcribed_at is not null as transcribed from public.session_recordings where booking_id = $1 order by started_at", [bookingId])).rows;
  const a = (await db.query("select length(full_transcript)::int as chars, summary_notes is not null as summary, talk_ratio from public.session_analytics where booking_id = $1", [bookingId])).rows[0];
  const emb = (await db.query("select count(*)::int n from public.session_embeddings where booking_id = $1", [bookingId])).rows[0].n;
  return { rec, a, emb };
};
let last = "";
const deadline = Date.now() + 14 * 60000; let final = await state();
while (Date.now() < deadline) {
  final = await state();
  const line = `recordings=${JSON.stringify(final.rec.map((r) => `${r.kind}:${r.status}${r.transcribed ? "+transcribed" : ""}`))} transcript=${final.a?.chars ?? 0} chars summary=${final.a?.summary ?? false} embeddings=${final.emb}`;
  if (line !== last) { log(line); last = line; }
  if (final.a?.summary && final.emb > 0) break;
  await new Promise((r) => setTimeout(r, 15000));
}
const ok = Boolean(final.a?.summary && final.emb > 0);
if (ok) {
  const notes = (await db.query("select summary_notes, talk_ratio from public.session_analytics where booking_id = $1", [bookingId])).rows[0];
  const transcript = (await db.query("select left(full_transcript, 260) t from public.session_analytics where booking_id = $1", [bookingId])).rows[0].t;
  log(`transcript begins: ${JSON.stringify(transcript)}`);
  log(`talk ratio: ${JSON.stringify(notes.talk_ratio)}; summary fields: ${Object.keys(notes.summary_notes ?? {}).join(", ")}`);
}
await db.end();
console.log(ok ? "\nEnd-to-end lesson passed: joined, recorded, transcribed, summarised." : "\nThe pipeline did not finish within 14 minutes; see the state lines above.");
process.exit(ok ? 0 : 1);

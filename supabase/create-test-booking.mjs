// Dev helper: creates a paid booking directly, bypassing Stripe Checkout,
// so you can jump straight to testing /session/[id] without paying every time.
// Usage: node supabase/create-test-booking.mjs <student-email>
//   - student must already exist (sign up at /sign-up first)
//   - books with the first seeded demo tutor (see supabase/seed.mjs)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const idx = l.indexOf("=");
        const key = l.slice(0, idx);
        let val = l.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        return [key, val];
      }),
  );
}

const studentEmail = process.argv[2];
if (!studentEmail) {
  console.error("Usage: node supabase/create-test-booking.mjs <student-email>");
  process.exit(1);
}

const env = loadEnv(new URL("../.env.local", import.meta.url));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: users } = await supabase.auth.admin.listUsers();
const student = users.users.find((u) => u.email === studentEmail);
if (!student) {
  console.error(`No user found with email ${studentEmail} — sign up at /sign-up first.`);
  process.exit(1);
}

const { data: tutor } = await supabase
  .from("tutor_profiles")
  .select("id, subjects, boards")
  .limit(1)
  .single();

const { data: tutorUser } = await supabase.auth.admin.getUserById(tutor.id);

const start = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
const end = new Date(start.getTime() + 60 * 60 * 1000);

const { data: booking, error } = await supabase
  .from("bookings")
  .insert({
    student_id: student.id,
    tutor_id: tutor.id,
    subject: tutor.subjects[0],
    exam_board: tutor.boards[0],
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: "scheduled",
    payment_status: "paid",
  })
  .select()
  .single();

if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}

console.log(`Booking created: ${booking.id}`);
console.log(`Student: ${studentEmail}`);
console.log(`Tutor:   ${tutorUser.user.email}`);
console.log(`\nJoin as either:`);
console.log(`  http://localhost:3000/session/${booking.id}`);
console.log(`\n(Sign in as the tutor with password KindlingDemo2026! in a second browser/tab to test both sides.)`);

// Dev helper: creates (or resets) a confirmed demo student account, so testing
// a session does not require a real signup. Signup sends a confirmation email
// whose link points at whatever Site URL the Supabase project is configured
// with — on tutors_dev that is still localhost — so `email_confirm: true` here
// sidesteps the email entirely.
//
// Usage: node supabase/create-demo-student.mjs [email]
//   defaults to student.demo@demo.kindling.app
//   targets whichever project .env.local points at (tutors_dev)
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

const env = loadEnv(new URL("../.env.local", import.meta.url));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

// Never let this touch production by accident.
if (!url.includes("khxcdmtppyzslxjecbgq")) {
  console.error(`Refusing to run: .env.local points at ${url}, which is not tutors_dev.`);
  process.exit(1);
}

const email = process.argv[2] ?? "student.demo@demo.kindling.app";
const password = "KindlingDemo2026!"; // same as supabase/seed.mjs
const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Demo Student", role: "student" },
});

if (createErr) {
  if (!createErr.message.includes("already been registered")) {
    console.error(`✗ ${createErr.message}`);
    process.exit(1);
  }
  // Already exists — reset its password so the credentials below are correct.
  const { data: list } = await supabase.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === email);
  if (!existing) {
    console.error(`✗ ${email} reported as registered but could not be found`);
    process.exit(1);
  }
  const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (updateErr) {
    console.error(`✗ could not reset password: ${updateErr.message}`);
    process.exit(1);
  }
  console.log(`Reset the existing account ${email}.`);
} else {
  console.log(`Created ${email}.`);
}

console.log(`\n  email:    ${email}`);
console.log(`  password: ${password}`);
console.log(`\nSign in at https://tutors-dev.vercel.app/sign-in`);

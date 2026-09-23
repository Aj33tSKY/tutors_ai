// Seeds demo tutor accounts + availability into the live Supabase project.
// Usage: node supabase/seed.mjs   (reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { MOCK_TUTORS_RAW } from "./seed-data.mjs";

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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoConfirm: true },
});

const DEMO_PASSWORD = "KindlingDemo2026!";

for (const t of MOCK_TUTORS_RAW) {
  const email = `${t.id.replace(/-/g, ".")}@demo.kindling.app`;

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: t.name, role: "tutor" },
  });

  let userId = created?.user?.id;

  if (createErr) {
    if (createErr.message.includes("already been registered")) {
      const { data: list } = await supabase.auth.admin.listUsers();
      userId = list.users.find((u) => u.email === email)?.id;
    } else {
      console.error(`✗ ${t.name}: ${createErr.message}`);
      continue;
    }
  }
  if (!userId) continue;

  await supabase
    .from("tutor_profiles")
    .upsert(
      {
        id: userId,
        bio: t.bio,
        headline: t.headline,
        hourly_rate: t.hourlyRate * 100,
        dbs_verified: true,
        subjects: t.subjects,
        boards: t.boards,
        years_experience: t.yearsExperience,
        rating: t.rating,
      },
      { onConflict: "id" },
    );

  await supabase.from("availability").delete().eq("tutor_id", userId);
  const slots = [
    { day_of_week: 1, start_time: "16:00", end_time: "19:00" },
    { day_of_week: 3, start_time: "16:00", end_time: "19:00" },
    { day_of_week: 6, start_time: "10:00", end_time: "14:00" },
  ];
  await supabase.from("availability").insert(slots.map((s) => ({ ...s, tutor_id: userId })));

  console.log(`✓ ${t.name} (${email})`);
}

console.log("\nDemo tutor password for all seeded accounts:", DEMO_PASSWORD);

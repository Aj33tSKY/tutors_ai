import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Loads the current user's profile and lazily creates the role-specific
 * row (student_profiles / tutor_profiles) the first time it's needed —
 * signup only writes `profiles` via the DB trigger, since email
 * confirmation may delay the first authenticated session.
 */
export async function getCurrentProfile(): Promise<{
  userId: string;
  email: string;
  profile: Profile | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { userId: "", email: "", profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) {
    if (profile.role === "student") {
      await supabase
        .from("student_profiles")
        .upsert({ id: user.id }, { onConflict: "id", ignoreDuplicates: true });
    } else if (profile.role === "tutor") {
      await supabase.from("tutor_profiles").upsert(
        { id: user.id, hourly_rate: 3500, subjects: [], boards: [] },
        { onConflict: "id", ignoreDuplicates: true },
      );
    }
  }

  return { userId: user.id, email: user.email ?? "", profile: profile as Profile | null };
}

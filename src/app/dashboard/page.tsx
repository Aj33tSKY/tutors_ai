import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";

export default async function DashboardRootPage() {
  const { profile } = await getCurrentProfile();
  if (!profile) redirect("/sign-in");

  redirect(`/dashboard/${profile.role}`);
}

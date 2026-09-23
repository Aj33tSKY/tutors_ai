import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardTopbar } from "@/components/dashboard/topbar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, email } = await getCurrentProfile();

  if (!profile) redirect("/sign-in");

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar role={profile.role} fullName={profile.full_name} email={email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopbar role={profile.role} />
        <main className="flex-1 bg-background p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}

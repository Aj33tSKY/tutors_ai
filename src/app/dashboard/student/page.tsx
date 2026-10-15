import { loadCalendarSessions } from "@/app/dashboard/calendar-data";
import { initialCalendarWindow } from "@/lib/calendar-window";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { SessionsPanel } from "@/components/dashboard/sessions-panel";
import { RefreshDashboardOnHistoryNavigation } from "@/components/dashboard/refresh-dashboard-on-history-navigation";
import { DashboardHighlights } from "@/components/dashboard/dashboard-highlights";

export default async function StudentDashboardPage() {
  const range = initialCalendarWindow(new Date());
  const { profile } = await getCurrentProfile();
  const sessions = await loadCalendarSessions(range.from, range.to);

  return (
    <div className="space-y-8">
      <RefreshDashboardOnHistoryNavigation />
      {/* The welcome header reads best at a capped width; the calendar below
          is left unconstrained to use the full page. */}
      <div className="flex max-w-6xl flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="display-md">
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Your lessons, all in one place.</p>
        </div>
        <Button asChild size="md">
          <Link href="/tutors"><CalendarPlus className="size-4" /> Book a new session</Link>
        </Button>
      </div>
      <DashboardHighlights sessions={sessions} role="student" />
      <h3 className="text-xl font-semibold">All lessons</h3>
      <SessionsPanel
        sessions={sessions}
        initialRange={range}
      />
    </div>
  );
}
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

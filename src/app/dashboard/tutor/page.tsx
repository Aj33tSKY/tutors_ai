import { SessionsPanel } from "@/components/dashboard/sessions-panel";
import { LessonRequests } from "@/components/dashboard/lesson-requests";
import { RefreshDashboardOnHistoryNavigation } from "@/components/dashboard/refresh-dashboard-on-history-navigation";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { createClient } from "@/lib/supabase/server";
import { loadCalendarSessions } from "@/app/dashboard/calendar-data";
import { initialCalendarWindow } from "@/lib/calendar-window";
import type { LessonRequest, Profile } from "@/lib/types";

export default async function TutorDashboardPage() {
  const { userId, profile } = await getCurrentProfile();
  const supabase = await createClient();
  const range = initialCalendarWindow(new Date());

  const [sessions, { data: requests }, { data: relatedBookings }] = await Promise.all([
    loadCalendarSessions(range.from, range.to),
    supabase
      .from("lesson_requests")
      .select("id, student_id, subject, exam_board, requested_start_time, is_trial")
      .eq("tutor_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .returns<Pick<LessonRequest, "id" | "student_id" | "subject" | "exam_board" | "requested_start_time" | "is_trial">[]>(),
    supabase.from("bookings").select("student_id").eq("tutor_id", userId),
  ]);

  const studentIds = [...new Set([...(relatedBookings ?? []).map((booking) => booking.student_id), ...(requests ?? []).map((request) => request.student_id)])];
  const { data: students } = studentIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", studentIds)
    : { data: [] as Pick<Profile, "id" | "full_name">[] };
  const studentNames = new Map((students ?? []).map((student) => [student.id, student.full_name]));

  return (
    <div className="space-y-8">
      <RefreshDashboardOnHistoryNavigation />
      {/* The welcome header and lesson requests read best at a capped width;
          the calendar below is left unconstrained to use the full page. */}
      <div className="max-w-6xl space-y-8">
        <div>
          <h2 className="display-md">
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Your lessons, all in one place.</p>
        </div>
        <LessonRequests requests={requests ?? []} names={studentNames} />
      </div>
      <SessionsPanel
        initialRange={range}
        counterpartLabel="Student"
        canMarkComplete
        canSendInvoice
        canCreateSession
        students={(students ?? []).map((student) => ({ id: student.id, fullName: student.full_name }))}
        sessions={sessions}
      />
    </div>
  );
}

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SessionsView, SessionsOperationsProvider, type SessionsOperations } from "../../../src/components/dashboard/sessions-view.js";
import { DashboardHighlights } from "../../../src/components/dashboard/dashboard-highlights.js";
import { LessonRequestsView } from "../../../src/components/dashboard/lesson-requests-view.js";
import { initialCalendarWindow } from "../../../packages/contracts/src/calendar-window.js";
import type { Identity } from "../../../packages/contracts/src/index.js";
import { api } from "./api.js";

export function CalendarView({ identity }: { identity: Identity }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const keys = useRef(new Map<string, string>());
  const [page, setPage] = useState(0);
  const [requestError, setRequestError] = useState<string>();
  const range = useMemo(() => initialCalendarWindow(new Date()), []);
  const calendar = useQuery({ queryKey: ["sessions", identity.id, range.from, range.to], queryFn: () => api.calendarSessions(range.from, range.to) });
  const contacts = useQuery({ queryKey: ["contacts", identity.id], queryFn: api.contacts, enabled: identity.profile.role === "tutor" });
  const requests = useQuery({ queryKey: ["requests", identity.id, page], queryFn: () => api.requests(page), enabled: identity.profile.role === "tutor" });
  const operations = useMemo<SessionsOperations>(() => {
    async function run(operation: () => Promise<unknown>) {
      try { await operation(); await Promise.all([client.invalidateQueries({ queryKey: ["sessions"] }), client.invalidateQueries({ queryKey: ["requests"] })]); return { success: true }; }
      catch (error) { return { error: error instanceof Error ? error.message : "Could not save this lesson" }; }
    }
    return {
      loadCalendarSessions: async (from, to) => (await api.calendarSessions(from, to)).sessions,
      cancelSessionAction: async (_previous, form) => run(() => api.lessonChange(String(form.get("booking_id")), "cancel", { series: form.get("cancel_series") === "on" })),
      markSessionCompleteAction: async (_previous, form) => run(() => api.lessonChange(String(form.get("booking_id")), "complete")),
      markSessionUpcomingAction: async (form) => {
        const result = await run(() => api.lessonChange(String(form.get("booking_id")), "reopen"));
        if (result.error) { window.alert(result.error); return; }
        void navigate("/dashboard/tutor");
      },
      updateSessionDetailsAction: async (_previous, form) => run(() => api.lessonChange(String(form.get("booking_id")), "reschedule", {
        lessonName: String(form.get("lesson_name")), startTime: new Date(String(form.get("start_time"))).toISOString(),
      })),
      createTutorSessionAction: async (_previous, form) => {
        const input = { studentId: String(form.get("student_id")), startTime: new Date(String(form.get("start_time"))).toISOString(),
          durationHours: Number(form.get("duration_hours")), count: form.get("schedule_type") === "weekly" ? Number(form.get("recurrence_count")) : 1, lessonName: String(form.get("lesson_name")) };
        const fingerprint = JSON.stringify(input);
        const commandId = keys.current.get(fingerprint) ?? crypto.randomUUID();
        keys.current.set(fingerprint, commandId);
        const result = await run(() => api.scheduleLessons({ ...input, commandId }));
        if (result.success) keys.current.delete(fingerprint);
        return result;
      },
      sendSessionInvoiceAction: async (_previous, form) => run(() => api.sendInvoice(String(form.get("booking_id")))),
    };
  }, [client, navigate]);
  if (calendar.error || contacts.error || requests.error) return <p role="alert">{(calendar.error || contacts.error || requests.error)?.message}</p>;
  if (!calendar.data) return <p role="status">Loading your calendar…</p>;
  const tutor = identity.profile.role === "tutor";
  return <div className="space-y-6"><DashboardHighlights sessions={calendar.data.sessions} role={tutor ? "tutor" : "student"} requestCount={requests.data?.total ?? 0}/>
    {requestError && <p role="alert">{requestError}</p>}
    {tutor && requests.data && <section id="lesson-requests"><LessonRequestsView requests={requests.data.requests} names={new Map(Object.entries(requests.data.studentNames))} declineAction={async (form) => {
      setRequestError(undefined);
      try { await api.declineRequest(String(form.get("request_id"))); await client.invalidateQueries({ queryKey: ["requests"] }); }
      catch (error) { setRequestError(error instanceof Error ? error.message : "Could not decline request"); }
    }}/>{requests.data.total > requests.data.pageSize && <nav className="mt-3 flex gap-4" aria-label="Lesson request pages"><button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * requests.data.pageSize >= requests.data.total} onClick={() => setPage((p) => p + 1)}>Next</button></nav>}</section>}
    <SessionsOperationsProvider value={operations}>
    <SessionsView sessions={calendar.data.sessions} initialRange={range} counterpartLabel={tutor ? "Student" : "Tutor"}
      canMarkComplete={tutor} canCreateSession={tutor} students={(contacts.data?.contacts ?? []).map((person) => ({ id: person.id, fullName: person.fullName }))}/>
  </SessionsOperationsProvider></div>;
}

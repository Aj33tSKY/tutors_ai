import Link from "next/link";
import { ArrowRight, CalendarDays, FileText, MessageCircle } from "lucide-react";
import { subjectLabel } from "@/lib/subjects";
import type { CalendarSession } from "@/lib/types";

function lessonLabel(session: CalendarSession) {
  return session.lesson_name || subjectLabel(session.subject);
}

function lessonTime(session: CalendarSession) {
  return new Date(session.start_time).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function DashboardHighlights({ sessions, role, requestCount = 0 }: {
  sessions: CalendarSession[];
  role: "student" | "tutor";
  requestCount?: number;
}) {
  const upcoming = sessions.filter((session) => session.status === "scheduled")
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  const recent = sessions.filter((session) => session.status === "completed")
    .sort((a, b) => b.start_time.localeCompare(a.start_time))[0];
  const invoicesToSend = sessions.filter((session) => session.status === "completed" && !session.is_trial && !session.stripe_invoice_id).length;

  return <section aria-label="Your next steps" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><CalendarDays className="size-4" /> Next lesson</div>
      {upcoming ? <>
        <h3 className="mt-5 text-xl font-semibold">{lessonLabel(upcoming)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">With {upcoming.counterpartName} · {lessonTime(upcoming)}</p>
        <Link href={`/session/${upcoming.id}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-strong">Open lesson <ArrowRight className="size-4" /></Link>
      </> : <>
        <h3 className="mt-5 text-xl font-semibold">Nothing scheduled yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">{role === "student" ? "Find the right specialist for your next topic." : "Your next lesson will appear here once scheduled."}</p>
        {role === "student" && <Link href="/tutors" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-strong">Find a tutor <ArrowRight className="size-4" /></Link>}
      </>}
    </div>

    {role === "tutor" ? <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><MessageCircle className="size-4" /> Lesson requests</div>
      <h3 className="mt-5 text-xl font-semibold">{requestCount ? `${requestCount} awaiting a reply` : "All caught up"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{requestCount ? "Respond so students can plan their week." : "New requests will appear here."}</p>
      {requestCount > 0 && <a href="#lesson-requests" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-strong">Review requests <ArrowRight className="size-4" /></a>}
    </div> : <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><FileText className="size-4" /> Latest review</div>
      <h3 className="mt-5 text-xl font-semibold">{recent ? lessonLabel(recent) : "Your learning record starts here"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{recent ? `${lessonTime(recent)} · notes and recording` : "Completed lessons, notes and recordings will be saved here."}</p>
      {recent && <Link href={`/dashboard/student/bookings/${recent.id}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-strong">Review lesson <ArrowRight className="size-4" /></Link>}
    </div>}

    <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">{role === "student" ? <MessageCircle className="size-4" /> : <FileText className="size-4" />} {role === "student" ? "Keep learning" : "Payment follow-up"}</div>
      <h3 className="mt-5 text-xl font-semibold">{role === "student" ? "Revise between lessons" : invoicesToSend ? `${invoicesToSend} lesson${invoicesToSend === 1 ? "" : "s"} to invoice` : "No invoices to send"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{role === "student" ? "Ask about material from your session transcripts." : "Completed paid lessons can be invoiced from their session details."}</p>
      {role === "student" && <Link href="/dashboard/student/chat" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-strong">Open Revision AI <ArrowRight className="size-4" /></Link>}
    </div>
  </section>;
}

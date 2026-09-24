"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { subjectLabel } from "@/lib/subjects";
import type { Booking } from "@/lib/types";
import { cancelSessionAction, markSessionCompleteAction, markSessionUpcomingAction, sendSessionInvoiceAction, updateSessionDetailsAction } from "@/app/dashboard/session-actions";
import { createTutorSessionAction } from "@/app/dashboard/tutor/create-session-action";

type SessionRow = Pick<Booking, "id" | "subject" | "start_time" | "end_time" | "status" | "lesson_name" | "is_trial" | "stripe_invoice_id" | "started_at" | "recurrence_rule" | "recurrence_series_id"> & { counterpartName: string; counterpartId: string };
type Filter = "upcoming" | "completed";
type CalendarView = "day" | "week" | "month";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_HEIGHT = 64;
const QUARTER_HOUR_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

function dateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}
function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function addDays(date: Date, count: number) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count); }
function startOfWeek(date: Date) { return addDays(date, -date.getDay()); }
function dateTimeLocalValue(date: Date, time = "09:00") {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${time}`;
}
function localDateTimeValue(value: string) {
  const date = new Date(value);
  return dateTimeLocalValue(date, `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`);
}
function nextQuarterHour() {
  const next = new Date();
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + (15 - (next.getMinutes() % 15)));
  return { date: next, time: `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}` };
}
function rangeLabel(anchor: Date, view: CalendarView) {
  if (view === "month") return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  if (view === "day") return anchor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const end = addDays(startOfWeek(anchor), 6);
  return `${startOfWeek(anchor).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

export function SessionsPanel({ sessions, title = "Sessions", counterpartLabel = "Tutor", canMarkComplete = false, canSendInvoice = false, canCreateSession = false, students = [] }: { sessions: SessionRow[]; title?: string; counterpartLabel?: string; canMarkComplete?: boolean; canSendInvoice?: boolean; canCreateSession?: boolean; students?: { id: string; fullName: string }[] }) {
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [newSessionStart, setNewSessionStart] = useState<{ date: Date; time: string } | null>(null);
  const visible = useMemo(() => sessions.filter((session) => {
    const matchesName = session.counterpartName.toLowerCase().includes(query.trim().toLowerCase());
    return matchesName && (filter === "upcoming" ? session.status === "scheduled" : session.status === "completed");
  }), [filter, query, sessions]);
  const byDay = useMemo(() => {
    const result = new Map<string, SessionRow[]>();
    visible.forEach((session) => {
      const key = dateKey(new Date(session.start_time));
      result.set(key, [...(result.get(key) ?? []), session].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    });
    return result;
  }, [visible]);
  const cells = monthCells(anchor);
  const today = dateKey(new Date());

  return <>
    <Card>
      <CardHeader className="gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3"><CardTitle>{title}</CardTitle><span className="text-sm text-muted-foreground">{visible.length} shown</span>{canCreateSession && <Button type="button" size="lg" onClick={() => setNewSessionStart(nextQuarterHour())}><CalendarPlus className="size-4" />New session</Button>}</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-hairline p-0.5">{(["upcoming", "completed"] as Filter[]).map((option) => <button key={option} type="button" onClick={() => setFilter(option)} className={`rounded-sm px-3 py-1 text-xs capitalize transition-colors ${filter === option ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{option}</button>)}</div>
          <label className="relative block"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${counterpartLabel.toLowerCase()}`} aria-label={`Search by ${counterpartLabel.toLowerCase()} name`} className="w-44 pl-8" /></label>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1"><Button type="button" size="icon-sm" variant="ghost" onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : addDays(anchor, view === "week" ? -7 : -1))} aria-label="Previous period"><ChevronLeft className="size-4" /></Button><h3 className="min-w-48 text-center font-heading text-lg font-semibold">{rangeLabel(anchor, view)}</h3><Button type="button" size="icon-sm" variant="ghost" onClick={() => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(anchor, view === "week" ? 7 : 1))} aria-label="Next period"><ChevronRight className="size-4" /></Button></div>
          <div className="flex items-center gap-2"><div className="flex rounded-md border border-hairline p-0.5">{(["day", "week", "month"] as CalendarView[]).map((option) => <button key={option} type="button" onClick={() => setView(option)} className={`rounded-sm px-2.5 py-1 text-xs capitalize ${view === option ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{option}</button>)}</div><Button type="button" size="sm" variant="outline" onClick={() => setAnchor(new Date())}>Today</Button></div>
        </div>
        {view === "month" ? <div className="overflow-x-auto"><div className="min-w-[700px] overflow-hidden rounded-xl border border-hairline">
          <div className="grid grid-cols-7 border-b border-hairline bg-muted/30">{WEEKDAYS.map((day) => <div key={day} className="px-2 py-2 text-center text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">{day}</div>)}</div>
          <div className="grid grid-cols-7">{cells.map((day) => {
            const inMonth = day.getMonth() === anchor.getMonth(); const key = dateKey(day); const daySessions = byDay.get(key) ?? [];
            return <div key={key} onClick={(event) => { if (canCreateSession && !(event.target as Element).closest("button")) setNewSessionStart({ date: day, time: "09:00" }); }} className={`min-h-28 border-r border-b border-hairline p-1.5 last:border-r-0 ${inMonth ? "bg-card" : "bg-muted/20 text-muted-foreground"} ${canCreateSession ? "cursor-pointer hover:bg-muted/30" : ""}`}>
              <span className={`mb-1 flex size-6 items-center justify-center rounded-full text-xs ${key === today ? "bg-saffron font-semibold text-white" : ""}`}>{day.getDate()}</span>
              <div className="space-y-1">{daySessions.slice(0, 3).map((session) => <button key={session.id} type="button" onClick={() => setSelected(session)} className={`block w-full truncate rounded-md px-1.5 py-1 text-left text-xs font-medium transition-opacity hover:opacity-80 ${session.status === "completed" ? "bg-muted text-foreground" : "bg-saffron/15 text-foreground"}`}><span className="mr-1 text-muted-foreground">{timeLabel(session.start_time)}</span>{session.lesson_name || subjectLabel(session.subject)} · {session.counterpartName}</button>)}{daySessions.length > 3 && <button type="button" className="px-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(daySessions[3])}>+{daySessions.length - 3} more</button>}</div>
            </div>;
          })}</div>
        </div></div> : <TimeCalendar view={view} anchor={anchor} byDay={byDay} onSelect={setSelected} onEmptySlot={canCreateSession ? (date, time) => setNewSessionStart({ date, time }) : undefined} />}
        {visible.length === 0 && <p className="mt-4 text-center text-sm text-muted-foreground">{query ? `No sessions match that ${counterpartLabel.toLowerCase()}.` : `No ${filter} sessions yet.`}</p>}
      </CardContent>
    </Card>
    <SessionDialog key={selected?.id ?? "none"} session={selected} open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} counterpartLabel={counterpartLabel} canMarkComplete={canMarkComplete} canSendInvoice={canSendInvoice} />
    {canCreateSession && <NewSessionDialog key={newSessionStart ? dateTimeLocalValue(newSessionStart.date, newSessionStart.time) : "new-session"} open={Boolean(newSessionStart)} onOpenChange={(open) => !open && setNewSessionStart(null)} start={newSessionStart} students={students} />}
  </>;
}

function TimeCalendar({ view, anchor, byDay, onSelect, onEmptySlot }: { view: Exclude<CalendarView, "month">; anchor: Date; byDay: Map<string, SessionRow[]>; onSelect: (session: SessionRow) => void; onEmptySlot?: (date: Date, time: string) => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const days = view === "week" ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index)) : [anchor];
  const totalHeight = (LAST_HOUR - FIRST_HOUR) * HOUR_HEIGHT;
  const nowDay = dateKey(now);
  const nowTop = ((now.getHours() * 60 + now.getMinutes() - FIRST_HOUR * 60) / 60) * HOUR_HEIGHT;
  const activeNow = nowTop >= 0 && nowTop <= totalHeight;
  return <div className="overflow-x-auto"><div className="overflow-hidden rounded-xl border border-hairline" style={{ minWidth: view === "week" ? 760 : 420 }}>
    <div className="grid border-b border-hairline bg-muted/30" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}><div />{days.map((day) => <div key={dateKey(day)} className="border-l border-hairline px-2 py-2 text-center"><p className="text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">{day.toLocaleDateString("en-GB", { weekday: "short" })}</p><span className={`mx-auto mt-1 flex size-7 items-center justify-center rounded-full text-sm ${dateKey(day) === nowDay ? "bg-saffron font-semibold text-white" : ""}`}>{day.getDate()}</span></div>)}</div>
    <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}><div className="relative" style={{ height: totalHeight }}>{Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, index) => <div key={index} className="absolute left-0 w-full -translate-y-2 text-right text-[0.65rem] text-muted-foreground" style={{ top: index * HOUR_HEIGHT }}>{String(FIRST_HOUR + index).padStart(2, "0")}:00</div>)}</div>{days.map((day) => <div key={dateKey(day)} onClick={(event) => { if (!onEmptySlot || (event.target as Element).closest("button")) return; const offset = event.clientY - event.currentTarget.getBoundingClientRect().top; const minutes = Math.max(FIRST_HOUR * 60, Math.min(LAST_HOUR * 60 - 15, FIRST_HOUR * 60 + Math.round((offset / HOUR_HEIGHT) * 4) * 15)); onEmptySlot(day, `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`); }} className={`relative border-l border-hairline bg-card ${onEmptySlot ? "cursor-pointer" : ""}`} style={{ height: totalHeight }}>
      {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, index) => <div key={index} className="absolute inset-x-0 border-t border-hairline/80" style={{ top: index * HOUR_HEIGHT }} />)}
      {dateKey(day) === nowDay && activeNow && <div className="pointer-events-none absolute z-20 inset-x-0 border-t-2 border-red-500" style={{ top: nowTop }}><span className="absolute -left-1 -top-1.5 size-2.5 rounded-full bg-red-500" /></div>}
      {(byDay.get(dateKey(day)) ?? []).map((session) => { const start = new Date(session.start_time); const end = new Date(session.end_time); const top = ((start.getHours() * 60 + start.getMinutes() - FIRST_HOUR * 60) / 60) * HOUR_HEIGHT; const height = Math.max(HOUR_HEIGHT - 3, ((end.getTime() - start.getTime()) / (60 * 60 * 1000)) * HOUR_HEIGHT - 3); if (top < -HOUR_HEIGHT || top > totalHeight) return null; return <button key={session.id} type="button" onClick={() => onSelect(session)} className={`absolute z-10 mx-1 block overflow-hidden rounded-md px-2 py-1.5 text-left shadow-sm transition-opacity hover:opacity-80 ${session.status === "completed" ? "bg-muted text-foreground ring-1 ring-border" : "bg-saffron/20 text-foreground ring-1 ring-saffron/30"}`} style={{ top: Math.max(0, top + 1), height: Math.min(height, totalHeight - Math.max(0, top) - 2), left: 0, right: 0 }}><span className="block truncate text-xs font-semibold">{session.lesson_name || subjectLabel(session.subject)}</span><span className="block truncate text-xs">{session.counterpartName}</span><span className="block text-[0.65rem] text-muted-foreground">{timeLabel(session.start_time)}</span></button>; })}
    </div>)}</div>
  </div></div>;
}

function NewSessionDialog({ open, onOpenChange, start, students }: { open: boolean; onOpenChange: (open: boolean) => void; start: { date: Date; time: string } | null; students: { id: string; fullName: string }[] }) {
  const [state, action, pending] = useActionState(createTutorSessionAction, {});
  const defaultStart = start ? dateTimeLocalValue(start.date, start.time) : dateTimeLocalValue(new Date());
  const [selectedDate, setSelectedDate] = useState(defaultStart.slice(0, 10));
  const [selectedTime, setSelectedTime] = useState(defaultStart.slice(11, 16));
  const selectedDateTime = `${selectedDate}T${selectedTime}`;
  const utcOffsetMinutes = -new Date(selectedDateTime).getTimezoneOffset();
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; fullName: string } | null>(null);
  const [scheduleType, setScheduleType] = useState<"single" | "weekly">("single");
  const matchingStudents = useMemo(() => students.filter((student) => student.fullName.toLocaleLowerCase().includes(studentSearch.trim().toLocaleLowerCase())).slice(0, 6), [studentSearch, students]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg p-6"><DialogHeader><DialogTitle>New session</DialogTitle><DialogDescription>Give the session a clear name so it is easy to find later.</DialogDescription></DialogHeader>
    {students.length ? <form action={action} className="grid gap-4">
      <div className="relative grid gap-1.5 text-sm font-medium"><label htmlFor="session-student">Student</label><Input id="session-student" value={selectedStudent?.fullName ?? studentSearch} onChange={(event) => { setSelectedStudent(null); setStudentSearch(event.target.value); }} placeholder="Type a student’s name" autoComplete="off" />
        <input type="hidden" name="student_id" value={selectedStudent?.id ?? ""} />
        {!selectedStudent && studentSearch.trim() && <div className="absolute top-full z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">{matchingStudents.length ? matchingStudents.map((student) => <button key={student.id} type="button" onClick={() => { setSelectedStudent(student); setStudentSearch(""); }} className="block w-full rounded-sm px-3 py-2 text-left text-sm font-normal hover:bg-muted">{student.fullName}</button>) : <p className="px-3 py-2 text-sm font-normal text-muted-foreground">No matching students.</p>}</div>}
      </div>
      <label className="grid gap-1.5 text-sm font-medium">Session name<Input name="lesson_name" required maxLength={120} placeholder="e.g. Algebra: quadratic equations practice" /></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Date<Input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} required /></label><label className="grid gap-1.5 text-sm font-medium">Start time<select value={selectedTime} onChange={(event) => setSelectedTime(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">{QUARTER_HOUR_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</select><input type="hidden" name="start_time" value={selectedDateTime} /><input type="hidden" name="utc_offset_minutes" value={utcOffsetMinutes} /></label></div>
      <label className="grid gap-1.5 text-sm font-medium">Duration<select name="duration_hours" defaultValue="1" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"><option value="1">1 hour</option><option value="2">2 hours</option><option value="3">3 hours</option></select></label>
      <div className="grid gap-1.5"><span className="text-sm font-medium">Schedule</span><div className="flex rounded-md border border-hairline p-0.5"><button type="button" onClick={() => setScheduleType("single")} className={`flex-1 rounded-sm px-3 py-2 text-sm ${scheduleType === "single" ? "bg-raised font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Single session</button><button type="button" onClick={() => setScheduleType("weekly")} className={`flex-1 rounded-sm px-3 py-2 text-sm ${scheduleType === "weekly" ? "bg-raised font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Weekly recurring</button></div><input type="hidden" name="schedule_type" value={scheduleType} />
        {scheduleType === "weekly" && <label className="mt-1 grid gap-1.5 text-sm font-medium">Repeat weekly for<select name="recurrence_count" defaultValue="4" className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">{Array.from({ length: 11 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count} sessions</option>)}</select></label>}
        {scheduleType === "single" && <input type="hidden" name="recurrence_count" value="2" />}
      </div>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      {state.success ? <p className="text-sm text-emerald-700">Session created — it is now on both calendars.</p> : <Button type="submit" size="md" disabled={pending || !selectedStudent}>{pending ? "Creating…" : "Create session"}</Button>}
    </form> : <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">You can create a session once you have a student.</p>}
  </DialogContent></Dialog>;
}

function SessionDialog({ session, open, onOpenChange, counterpartLabel, canMarkComplete, canSendInvoice }: { session: SessionRow | null; open: boolean; onOpenChange: (open: boolean) => void; counterpartLabel: string; canMarkComplete: boolean; canSendInvoice: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [detailsState, detailsAction, detailsPending] = useActionState(updateSessionDetailsAction, {});
  const [completeState, completeAction, completePending] = useActionState(markSessionCompleteAction, {});
  const initialEditDateTime = localDateTimeValue(session?.start_time ?? new Date().toISOString());
  const [editedDate, setEditedDate] = useState(initialEditDateTime.slice(0, 10));
  const [editedTime, setEditedTime] = useState(initialEditDateTime.slice(11, 16));
  const editedDateTime = `${editedDate}T${editedTime}`;
  const utcOffsetMinutes = -new Date(editedDateTime).getTimezoneOffset();
  useEffect(() => {
    if (completeState.success || detailsState.success) onOpenChange(false);
  }, [completeState.success, detailsState.success, onOpenChange]);
  if (!session) return null;
  const completed = session.status === "completed";
  const name = session.lesson_name || subjectLabel(session.subject);
  const canEdit = canMarkComplete && !completed;
  return <><Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md p-6"><DialogHeader><div className="flex items-center gap-2"><DialogTitle>{name}</DialogTitle>{canEdit && !editing && <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit</Button>}</div><DialogDescription>{new Date(session.start_time).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {counterpartLabel}: <Link href={`/dashboard/messages/${session.counterpartId}`} className="font-medium text-foreground hover:underline">{session.counterpartName}</Link></DialogDescription></DialogHeader>
    <div className="flex items-center gap-2"><Badge variant={completed ? "secondary" : "default"} className="capitalize">{session.status}</Badge>{session.is_trial && <Badge variant="outline">Free trial</Badge>}{session.stripe_invoice_id && <Badge variant="outline">Invoice sent</Badge>}</div>
    {editing && <form action={detailsAction} className="grid gap-3 rounded-lg border border-hairline p-3"><input type="hidden" name="booking_id" value={session.id} /><label className="grid gap-1.5 text-sm font-medium">Session name<Input name="lesson_name" defaultValue={session.lesson_name ?? ""} placeholder={subjectLabel(session.subject)} autoFocus required /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Date<Input type="date" value={editedDate} onChange={(event) => setEditedDate(event.target.value)} required /></label><label className="grid gap-1.5 text-sm font-medium">Start time<select value={editedTime} onChange={(event) => setEditedTime(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">{QUARTER_HOUR_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}</select><input type="hidden" name="start_time" value={editedDateTime} /><input type="hidden" name="utc_offset_minutes" value={utcOffsetMinutes} /></label></div>{session.started_at && <p className="text-xs text-muted-foreground">This changes the planned resume time only; the original start, recording, and transcript stay intact.</p>}<div className="flex gap-2"><Button type="submit" size="sm" disabled={detailsPending}>{detailsPending ? "Saving…" : "Save changes"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>{detailsState.error && <p className="text-xs text-destructive">{detailsState.error}</p>}{detailsState.success && <p className="text-xs text-emerald-700">Saved.</p>}</form>}
    <div className="grid gap-2 border-t border-hairline pt-4"><Button asChild><Link href={completed ? `/dashboard/student/bookings/${session.id}` : `/session/${session.id}`}>{completed ? "View session" : session.started_at ? "Resume session" : "Start session"}</Link></Button>{canMarkComplete && !completed && Boolean(session.started_at) && <form action={completeAction}><input type="hidden" name="booking_id" value={session.id} /><Button type="submit" className="w-full" variant="secondary" disabled={completePending}>{completePending ? "Completing…" : "Mark complete"}</Button>{completeState.error && <p role="alert" className="text-xs text-destructive">{completeState.error}</p>}</form>}{canMarkComplete && !completed && !session.started_at && <Button type="button" className="w-full" variant="destructive" onClick={() => setConfirmingCancel(true)}>Cancel session</Button>}{canMarkComplete && completed && <form action={markSessionUpcomingAction}><input type="hidden" name="booking_id" value={session.id} /><Button type="submit" className="w-full" variant="outline">Move to upcoming</Button></form>}{canSendInvoice && completed && !session.is_trial && !session.stripe_invoice_id && <form action={sendSessionInvoiceAction}><input type="hidden" name="booking_id" value={session.id} /><Button type="submit" className="w-full" variant="secondary">Send invoice</Button></form>}</div>
  </DialogContent></Dialog><CancelSessionDialog session={session} open={confirmingCancel} onOpenChange={setConfirmingCancel} /></>;
}

function CancelSessionDialog({ session, open, onOpenChange }: { session: SessionRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, action, pending] = useActionState(cancelSessionAction, {});
  const isRecurring = Boolean(session.recurrence_rule);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md p-6"><DialogHeader><DialogTitle>Cancel this session?</DialogTitle><DialogDescription>This cannot be undone. The student will no longer see the cancelled session on their calendar.</DialogDescription></DialogHeader><form action={action} className="grid gap-4"><input type="hidden" name="booking_id" value={session.id} />{isRecurring && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="cancel_series" className="mt-0.5 size-4 accent-foreground" /><span>Cancel this and all future sessions in this recurring series.</span></label>}{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}{state.success ? <p className="text-sm text-emerald-700">Session cancelled.</p> : <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Keep session</Button><Button type="submit" variant="destructive" disabled={pending}>{pending ? "Cancelling…" : "Cancel session"}</Button></div>}</form></DialogContent></Dialog>;
}

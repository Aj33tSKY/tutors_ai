"use client";

import { useState, type ReactNode } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { boardLabel, subjectLabel, SUBJECTS, EXAM_BOARDS } from "../../../packages/contracts/src/subjects";
import { PRICE_BANDS, type PublicTutor, type TutorCatalogue, type TutorQuery } from "../../../packages/contracts/src/tutors";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pounds = (pence: number) => `£${(pence / 100).toFixed(0)}`;

/** Builds a filter href without dropping the other active filters. */
function filterHref(next: TutorQuery) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) if (value !== undefined) q.set(key, String(value));
  const s = q.toString();
  return s ? `/tutors?${s}` : "/tutors";
}
const initial = (tutor: PublicTutor) => tutor.fullName.charAt(0) || "T";

export function TutorCatalogueView({ catalogue, query }: { catalogue: TutorCatalogue; query: TutorQuery }) {
  const { tutors, total, approved } = catalogue;
  const active = Object.values(query).some((value) => value !== undefined);
  return <div className="shell py-12 md:py-16">
    <h1 className="display-lg max-w-[13ch]">Find your <span className="whitespace-nowrap">A-Level</span> tutor</h1>
    <p className="mt-3 text-sm text-muted-foreground">{total} {total === 1 ? "tutor" : "tutors"} available</p>
    <div className="mt-8 grid grid-cols-1 gap-6 md:mt-12 lg:grid-cols-[13rem_1fr] lg:gap-12">
      <details className="rounded-2xl border border-border bg-card p-4 lg:hidden"><summary className="cursor-pointer font-medium">Filters {active ? "· Active" : ""}</summary><div className="mt-6"><Filters query={query}/></div></details>
      <aside className="hidden space-y-8 lg:sticky lg:top-24 lg:block lg:self-start"><Filters query={query}/></aside>
      {total === 0 ? <div className="rounded-2xl border border-dashed border-border p-12">
        <h2 className="display-md">{approved === 0 ? "More specialists are coming" : "No tutors match those filters"}</h2>
        <p className="mt-4 text-muted-foreground">{approved === 0 ? "We're onboarding approved specialists. Check back soon." : "Try widening your search, or "}{approved > 0 && <AppLink href="/tutors" className="link-draw text-brand-strong">clear all filters</AppLink>}</p>
      </div> : <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm sm:grid-cols-2">
        {tutors.map((t) => <li key={t.id} className="bg-card"><AppLink href={`/tutors/${t.id}`} className="flex h-full flex-col p-7 transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-secondary/50">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.avatarUrl ? <img src={t.avatarUrl} alt="" className="size-14 shrink-0 rounded-full object-cover"/> : <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-semibold">{initial(t)}</span>}
            <h2 className="display-md">{t.fullName}</h2>
          </div>
          <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{t.bio}</p>
          <dl className="mt-6 space-y-2 text-xs">
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted-foreground">Subjects</dt><dd className="text-foreground/70">{t.subjects.map(subjectLabel).join(" · ")}</dd></div>
            <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted-foreground">Boards</dt><dd className="text-foreground/70">{t.boards.map(boardLabel).join(" · ")}</dd></div>
          </dl>
          <div className="mt-auto flex items-baseline justify-between border-t border-hairline pt-5"><span className="eyebrow">Approved tutor · {t.availableDays.length ? "Weekly slots available" : "Ask about availability"}</span>
            <span className="font-heading text-2xl text-brand-strong tabular-nums">{pounds(t.hourlyRatePence)}<span className="font-mono text-xs text-muted-foreground">/hr</span></span></div>
          <span className="mt-4 text-sm font-medium text-brand-strong">View profile and request a free first lesson →</span>
        </AppLink></li>)}
      </ul>}
    </div>
  </div>;
}

function Filters({ query }: { query: TutorQuery }) {
  return <div className="space-y-8">
    <FilterGroup label="Subject"><FilterLink label="All subjects" active={!query.subject} href={filterHref({ ...query, subject: undefined })}/>{SUBJECTS.map((item) => <FilterLink key={item.value} label={item.label} active={query.subject === item.value} href={filterHref({ ...query, subject: item.value })}/>)}</FilterGroup>
    <FilterGroup label="Exam board"><FilterLink label="All boards" active={!query.board} href={filterHref({ ...query, board: undefined })}/>{EXAM_BOARDS.map((item) => <FilterLink key={item.value} label={item.label} active={query.board === item.value} href={filterHref({ ...query, board: item.value })}/>)}</FilterGroup>
    <FilterGroup label="Hourly rate"><FilterLink label="Any rate" active={!query.maxPrice} href={filterHref({ ...query, maxPrice: undefined })}/>{PRICE_BANDS.map((price) => <FilterLink key={price} label={`Up to £${price}`} active={query.maxPrice === price} href={filterHref({ ...query, maxPrice: price })}/>)}</FilterGroup>
    <FilterGroup label="Weekly availability"><FilterLink label="Any day" active={query.day === undefined} href={filterHref({ ...query, day: undefined })}/>{weekdays.map((label, index) => <FilterLink key={label} label={label} active={query.day === index} href={filterHref({ ...query, day: index })}/>)}</FilterGroup>
  </div>;
}
function FilterGroup({ label, children }: { label: string; children: ReactNode }) { return <div><h2 className="eyebrow">{label}</h2><div className="mt-5 flex flex-col items-start gap-3">{children}</div></div>; }
function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return <AppLink href={href} aria-current={active ? "true" : undefined} className={cn("text-sm transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]", active ? "text-brand-strong" : "link-draw text-muted-foreground hover:text-foreground")}>{active && <span aria-hidden className="mr-2 text-brand-strong">—</span>}{label}</AppLink>;
}

export type LessonRequestSubmit = (input: { subject: string; examBoard: string; startTime: string }) => Promise<{ error?: string; success?: string }>;
const ukSlot = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** Slots arrive as exact instants computed in UK time by the server; this only displays them. */
export function LessonRequestForm({ tutor, slots, submit }: { tutor: PublicTutor; slots: string[]; submit: LessonRequestSubmit }) {
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, setPending] = useState(false);
  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setState({});
    const form = new FormData(event.currentTarget);
    try { setState(await submit({ subject: String(form.get("subject")), examBoard: String(form.get("exam_board")), startTime: String(form.get("requested_start")) })); }
    catch { setState({ error: "We couldn't send that request. Please try again." }); }
    finally { setPending(false); }
  }}>
    <div className="space-y-1.5"><Label htmlFor="subject">Subject</Label><Select name="subject" required><SelectTrigger id="subject" className="w-full"><SelectValue placeholder="Choose a subject"/></SelectTrigger><SelectContent>{tutor.subjects.map((s) => <SelectItem key={s} value={s}>{subjectLabel(s)}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1.5"><Label htmlFor="exam_board">Exam board</Label><Select name="exam_board" required><SelectTrigger id="exam_board" className="w-full"><SelectValue placeholder="Choose an exam board"/></SelectTrigger><SelectContent>{tutor.boards.map((b) => <SelectItem key={b} value={b}>{boardLabel(b)}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1.5"><Label htmlFor="requested_start">Available slot (UK time)</Label><Select name="requested_start" required disabled={!slots.length}><SelectTrigger id="requested_start" className="w-full"><SelectValue placeholder={slots.length ? "Choose an available slot" : "No availability set"}/></SelectTrigger><SelectContent>{slots.map((slot) => <SelectItem key={slot} value={slot}>{ukSlot.format(new Date(slot))}</SelectItem>)}</SelectContent></Select></div>
    {state.error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
    {state.success && <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{state.success}</p>}
    <Button type="submit" disabled={pending || !slots.length} className="w-full" size="lg" aria-busy={pending}>{pending ? <Loader2 className="size-4 animate-spin"/> : <CalendarPlus className="size-4"/>} Send free trial request</Button>
    <p className="text-center text-xs text-muted-foreground">Your first session with this tutor is free. They’ll confirm the final time and any recurring lessons in messages.</p>
  </form>;
}

export function TutorProfileView({ tutor, request }: { tutor: PublicTutor; request: ReactNode }) {
  const facts = [{ label: "Experience", value: tutor.yearsExperience ? `${tutor.yearsExperience} yrs` : "Ask tutor" }, { label: "Status", value: "Approved" }, { label: "Rate", value: `${pounds(tutor.hourlyRatePence)}/hr` }];
  return <div className="shell py-20"><div className="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_22rem] lg:gap-20"><div>
    <div className="flex items-center gap-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {tutor.avatarUrl ? <img src={tutor.avatarUrl} alt="" className="size-20 rounded-full object-cover sm:size-28"/> : <span aria-hidden className="flex size-20 items-center justify-center rounded-full bg-secondary text-3xl font-semibold sm:size-28">{initial(tutor)}</span>}
      <h1 className="display-xl">{tutor.fullName}</h1>
    </div>
    <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">{tutor.headline}</p>
    <dl className="mt-12 grid grid-cols-3 border-t border-hairline">{facts.map((f, i) => <div key={f.label} className={`border-hairline py-7 pr-3 ${i > 0 ? "border-l pl-3 sm:pl-5" : ""}`}><dt className="eyebrow">{f.label}</dt><dd className="mt-3 text-lg font-semibold text-brand-strong sm:text-2xl">{f.value}</dd></div>)}</dl>
    <div className="mt-16 grid gap-10 border-t border-hairline pt-10 sm:grid-cols-[8rem_1fr]"><h2 className="eyebrow">About</h2><p className="max-w-xl leading-relaxed text-muted-foreground">{tutor.bio}</p></div>
    <div className="mt-10 grid gap-10 border-t border-hairline pt-10 sm:grid-cols-[8rem_1fr]"><h2 className="eyebrow">Teaches</h2><div className="space-y-4"><p className="font-heading text-xl">{tutor.subjects.map(subjectLabel).join(", ")}</p><p className="font-mono text-[0.6875rem] tracking-[0.08em] text-muted-foreground uppercase">{tutor.boards.map(boardLabel).join(" · ")}</p></div></div>
  </div><aside className="h-fit rounded-3xl border border-border/70 bg-card p-7 shadow-md lg:sticky lg:top-24"><h2 className="display-md">Request a lesson</h2>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Your first lesson with this tutor is free. Later lessons are {pounds(tutor.hourlyRatePence)} per hour and invoiced after completion.</p><div className="mt-7">{request}</div></aside></div></div>;
}

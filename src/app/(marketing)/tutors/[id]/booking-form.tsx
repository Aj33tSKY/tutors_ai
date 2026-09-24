"use client";

import { useActionState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import { createLessonRequestAction, type BookingFormState } from "./actions";
import type { Availability, ExamBoard, StemSubject } from "@/lib/types";

const initialState: BookingFormState = {};
function optionsFor(slots: Availability[]) {
  const output: { value: string; label: string }[] = [];
  const now = new Date();
  for (let offset = 0; offset < 28; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const slot of slots.filter((item) => item.day_of_week === date.getDay())) {
      const [startHour, startMinute] = slot.start_time.slice(0, 5).split(":").map(Number);
      const [endHour, endMinute] = slot.end_time.slice(0, 5).split(":").map(Number);
      for (let minutes = startHour * 60 + startMinute; minutes + 60 <= endHour * 60 + endMinute; minutes += 60) {
        const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60);
        if (candidate > now) output.push({ value: `${candidate.toISOString()}|${date.getDay()}|${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, label: candidate.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) });
      }
    }
  }
  return output;
}

export function BookingForm({ tutorId, subjects, boards, availability }: { tutorId: string; subjects: StemSubject[]; boards: ExamBoard[]; availability: Availability[] }) {
  const action = createLessonRequestAction.bind(null, tutorId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const slots = optionsFor(availability);
  return <form action={formAction} className="space-y-4">
    <div className="space-y-1.5"><Label htmlFor="subject">Subject</Label><Select name="subject" required><SelectTrigger id="subject" className="w-full"><SelectValue placeholder="Choose a subject" /></SelectTrigger><SelectContent>{subjects.map((s) => <SelectItem key={s} value={s}>{subjectLabel(s)}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1.5"><Label htmlFor="exam_board">Exam board</Label><Select name="exam_board" required><SelectTrigger id="exam_board" className="w-full"><SelectValue placeholder="Choose an exam board" /></SelectTrigger><SelectContent>{boards.map((b) => <SelectItem key={b} value={b}>{boardLabel(b)}</SelectItem>)}</SelectContent></Select></div>
    <div className="space-y-1.5"><Label htmlFor="requested_start">Available slot</Label><Select name="requested_start" required disabled={!slots.length}><SelectTrigger id="requested_start" className="w-full"><SelectValue placeholder={slots.length ? "Choose an available slot" : "No availability set"} /></SelectTrigger><SelectContent>{slots.map((slot) => <SelectItem key={slot.value} value={slot.value}>{slot.label}</SelectItem>)}</SelectContent></Select></div>
    {state.error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
    {state.success && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{state.success}</p>}
    <Button type="submit" disabled={pending || !slots.length} className="w-full" size="lg" aria-busy={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />} Send free trial request</Button>
    <p className="text-center text-xs text-muted-foreground">Your first session with this tutor is free. They’ll confirm the final time and any recurring lessons in messages.</p>
  </form>;
}

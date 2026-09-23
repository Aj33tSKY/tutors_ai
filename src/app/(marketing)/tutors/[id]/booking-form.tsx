"use client";

import { useActionState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import { createBookingAction, type BookingFormState } from "./actions";
import type { ExamBoard, StemSubject } from "@/lib/types";

const initialState: BookingFormState = {};

export function BookingForm({
  tutorId,
  subjects,
  boards,
  hourlyRate,
}: {
  tutorId: string;
  subjects: StemSubject[];
  boards: ExamBoard[];
  hourlyRate: number;
}) {
  const action = createBookingAction.bind(null, tutorId);
  const [state, formAction, pending] = useActionState(action, initialState);

  const today = new Date().toISOString().split("T")[0];

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Select name="subject" required>
          <SelectTrigger id="subject" className="w-full">
            <SelectValue placeholder="Choose a subject" />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s} value={s}>
                {subjectLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="exam_board">Exam board</Label>
        <Select name="exam_board" required>
          <SelectTrigger id="exam_board" className="w-full">
            <SelectValue placeholder="Choose an exam board" />
          </SelectTrigger>
          <SelectContent>
            {boards.map((b) => (
              <SelectItem key={b} value={b}>
                {boardLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" min={today} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="time">Time</Label>
          <Input id="time" name="time" type="time" required />
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full" size="lg" aria-busy={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
        Book · £{hourlyRate}/hr
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        1-hour session · billed after signup completes
      </p>
    </form>
  );
}

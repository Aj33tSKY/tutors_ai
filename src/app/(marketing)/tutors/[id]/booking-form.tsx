"use client";

import { LessonRequestForm } from "@/components/tutors/tutors-view";
import type { PublicTutor } from "../../../../../packages/contracts/src/tutors";
import { createLessonRequestAction } from "./actions";

export function BookingForm({ tutor, slots }: { tutor: PublicTutor; slots: string[] }) {
  return <LessonRequestForm tutor={tutor} slots={slots} submit={(input) => createLessonRequestAction(tutor.id, input)}/>;
}

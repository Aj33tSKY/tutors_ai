"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ExamBoard, StemSubject } from "@/lib/types";

export interface BookingFormState {
  error?: string;
}

export async function createBookingAction(
  tutorId: string,
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/sign-in?next=/tutors/${tutorId}`);

  const subject = String(formData.get("subject")) as StemSubject;
  const examBoard = String(formData.get("exam_board")) as ExamBoard;
  const date = String(formData.get("date"));
  const time = String(formData.get("time"));

  if (!subject || !examBoard || !date || !time) {
    return { error: "Please choose a subject, exam board, date and time." };
  }

  const start = new Date(`${date}T${time}:00`);
  if (Number.isNaN(start.getTime()) || start < new Date()) {
    return { error: "Please choose a valid, future time." };
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const { error } = await supabase.from("bookings").insert({
    student_id: user.id,
    tutor_id: tutorId,
    subject,
    exam_board: examBoard,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: "scheduled",
  });

  if (error) return { error: error.message };

  redirect("/dashboard/student/bookings?booked=1");
}

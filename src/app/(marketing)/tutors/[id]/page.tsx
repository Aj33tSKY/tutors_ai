import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { TutorProfileView } from "@/components/tutors/tutors-view";
import { AppError } from "../../../../../packages/domain/src/errors";
import { openSlots, publicTutor } from "../../../../../packages/domain/src/tutors";
import { BookingForm } from "./booking-form";

export const dynamic = "force-dynamic";

export default async function TutorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createPublicClient();
  const tutor = await publicTutor(supabase, id).catch((error) => { if (error instanceof AppError && error.status === 404) return null; throw error; });
  if (!tutor) notFound();
  return <TutorProfileView tutor={tutor} request={<BookingForm tutor={tutor} slots={await openSlots(supabase, tutor.id)}/>}/>;
}

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { signRecordingUrl } from "@/lib/recordings-storage";
import { SessionReviewView } from "@/components/dashboard/session-review";
import { updateSessionNotesAction } from "@/app/dashboard/session-actions";
import { sessionReview } from "../../../../../../packages/domain/src/reviews";
import { AppError } from "../../../../../../packages/domain/src/errors";

export default async function StudentSessionReviewPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const { userId, email, profile } = await getCurrentProfile();
  if (!profile) notFound();
  const review = await sessionReview(await createClient(), { id: userId, email, profile }, bookingId,
    (path) => signRecordingUrl(path, 3600).catch(() => null)).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return <SessionReviewView review={review} notesAction={updateSessionNotesAction} />;
}

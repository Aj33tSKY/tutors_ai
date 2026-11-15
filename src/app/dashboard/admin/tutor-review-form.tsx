"use client";

import { TutorReviewFields } from "@/components/dashboard/tutor-review-fields";
import { approveTutorAction } from "./actions";

export function TutorReviewForm({ tutorId }: { tutorId: string }) {
  return <TutorReviewFields tutorId={tutorId} approveAction={approveTutorAction} />;
}

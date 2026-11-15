import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SessionReviewView } from "../../../src/components/dashboard/session-review.js";
import { api, ApiFailure } from "./api.js";

export function ReviewPage() {
  const { id = "" } = useParams();
  const review = useQuery({ queryKey: ["review", id], queryFn: () => api.review(id), refetchOnWindowFocus: false });
  if (review.error instanceof ApiFailure && review.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (review.error) return <p role="alert">{review.error.message}</p>;
  if (!review.data) return <p role="status">Loading session review…</p>;
  return <main className="mx-auto max-w-7xl p-6"><SessionReviewView review={review.data} notesAction={async (_previous, form) => {
    try { await api.saveNotes(id, String(form.get("notes_markdown"))); return { success: true }; }
    catch (error) { return { error: error instanceof Error ? error.message : "Could not save notes" }; }
  }}/></main>;
}

import { lazy, Suspense, useCallback } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SessionLobbyView } from "../../../src/components/dashboard/session-lobby.js";
import { api, ApiFailure } from "./api.js";

const VideoRoom = lazy(() => import("../../../src/components/dashboard/video-room.js").then((module) => ({ default: module.VideoRoom })));
const presenceAction = async (id: string) => (await api.lessonPresence(id)).tutorPresent;
const consentAction = async (id: string) => {
  try { await api.consentRecording(id); return {}; }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not save recording consent" }; }
};
export function LessonPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const room = useQuery({ queryKey: ["lesson", id], queryFn: () => api.lesson(id) });
  const token = useQuery({ queryKey: ["lesson-token", id], queryFn: () => api.lessonToken(id),
    enabled: Boolean(room.data?.configured && room.data.booking.started_at && room.data.booking.status === "scheduled"),
    staleTime: 3 * 60 * 60 * 1000, refetchOnWindowFocus: false });
  const refreshAction = useCallback(() => { void client.invalidateQueries({ queryKey: ["lesson", id] }); }, [client, id]);
  if (room.error instanceof ApiFailure && room.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (room.error || token.error) return <p role="alert">{(room.error || token.error)?.message}</p>;
  if (!room.data) return <p role="status">Loading your lesson…</p>;
  const { booking, isTutor, configured, recordingConsented } = room.data;
  if (booking.status !== "scheduled") return <main className="p-8"><h1 className="display-md">This session is {booking.status}</h1><Link to="/dashboard">Back to dashboard</Link></main>;
  if (!configured) return <main className="p-8"><h1 className="display-md">Video is temporarily unavailable</h1><p>Please try again shortly.</p><Link to="/dashboard">Back to dashboard</Link></main>;
  return <main className="mx-auto min-h-screen w-full space-y-5 p-5"><header className="flex justify-between"><Link to="/dashboard">← Back to dashboard</Link><p>{booking.lesson_name || booking.subject?.replaceAll("_", " ") || "Lesson"} · {new Date(booking.start_time).toLocaleString("en-GB")}</p></header>
    {!booking.started_at ? <SessionLobbyView bookingId={id} isTutor={isTutor} refreshAction={refreshAction} startAction={async () => {
      try { await api.startLesson(id); return { success: true }; }
      catch (error) { return { error: error instanceof Error ? error.message : "Could not start this lesson" }; }
    }}/> : token.data ? <Suspense fallback={<p role="status">Preparing your lesson room…</p>}><VideoRoom {...token.data} bookingId={id}
      subject={booking.lesson_name || booking.subject || "Lesson"} isTutor={isTutor} tutorIdentity={booking.tutor_id}
      recordingConsented={recordingConsented} consentAction={consentAction} presenceAction={presenceAction}/></Suspense> : <p role="status">Opening your lesson…</p>}
  </main>;
}

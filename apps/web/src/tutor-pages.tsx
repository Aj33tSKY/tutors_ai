import { useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LessonRequestForm, TutorCatalogueView, TutorProfileView, type LessonRequestSubmit } from "../../../src/components/tutors/tutors-view.js";
import { tutorQuery } from "../../../packages/contracts/src/tutors.js";
import { api, ApiFailure } from "./api.js";

function useTitle(title: string) { useEffect(() => { document.title = title; }, [title]); }

/** Prerendered pages embed their data so the first paint already has content; the API then revalidates it. */
export function TutorsPage() {
  const [params] = useSearchParams();
  const query = tutorQuery.parse(Object.fromEntries(params));
  const key = JSON.stringify(query);
  const embedded = typeof window !== "undefined" && key === "{}" ? window.__PUBLIC_DATA__?.catalogue : undefined;
  const result = useQuery({ queryKey: ["public-tutors", key], queryFn: () => api.publicTutors(params.toString()), initialData: embedded, staleTime: 60_000 });
  useTitle("Find a tutor | Hybrid Tutors");
  if (result.error) return <main className="shell py-16"><p role="alert">We couldn’t load tutors. Please try again.</p></main>;
  if (!result.data) return <main className="shell py-16"><p role="status">Loading tutors…</p></main>;
  return <TutorCatalogueView catalogue={result.data} query={query}/>;
}

export function TutorProfilePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const embedded = typeof window !== "undefined" ? window.__PUBLIC_DATA__?.tutor : undefined;
  const profile = useQuery({ queryKey: ["public-tutor", id], queryFn: async () => (await api.publicTutor(id)).tutor, initialData: embedded?.id === id ? embedded : undefined, staleTime: 60_000, retry: false });
  // Open times change as lessons are booked, so they are always fetched fresh.
  const slots = useQuery({ queryKey: ["tutor-slots", id], queryFn: async () => (await api.tutorSlots(id)).slots, enabled: Boolean(profile.data), staleTime: 0, gcTime: 0 });
  useEffect(() => {
    // A withdrawn tutor's old static page must not stay indexed once the client has seen it gone.
    if (!(profile.error instanceof ApiFailure && profile.error.status === 404)) return;
    const meta = document.createElement("meta"); meta.name = "robots"; meta.content = "noindex"; document.head.append(meta);
    return () => meta.remove();
  }, [profile.error]);
  useTitle(profile.data ? `${profile.data.fullName} | Hybrid Tutors` : "Tutor | Hybrid Tutors");
  if (profile.error instanceof ApiFailure && profile.error.status === 404) return <main className="shell py-16"><h1 className="display-md">This tutor is no longer available</h1><Link to="/tutors">Find another tutor</Link></main>;
  if (profile.error) return <main className="shell py-16"><p role="alert">We couldn’t load this tutor. Please try again.</p></main>;
  if (!profile.data) return <main className="shell py-16"><p role="status">Loading tutor…</p></main>;
  const submit: LessonRequestSubmit = async (input) => {
    try {
      await api.requestLesson(id, input as Parameters<typeof api.requestLesson>[1]);
      await slots.refetch();
      return { success: "Request sent. Your tutor will confirm the actual lesson time in messages." };
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) { navigate(`/sign-in?next=${encodeURIComponent(`/tutors/${id}`)}`); return {}; }
      if (error instanceof ApiFailure && error.status === 409) await slots.refetch();
      return { error: error instanceof Error ? error.message : "We couldn't send that request. Please try again." };
    }
  };
  return <TutorProfileView tutor={profile.data} request={<LessonRequestForm tutor={profile.data} slots={slots.data ?? []} submit={submit}/>}/>;
}

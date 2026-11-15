import type { ApiError, BookingDetail, BookingSummary, Identity } from "../../../packages/contracts/src/index.js";
import type { AvailabilitySlot, Contact, AdminOverview, FamilyOverview } from "../../../packages/contracts/src/portal.js";
import type { LessonRoom, LessonToken } from "../../../packages/contracts/src/lessons.js";
import type { SessionReview } from "../../../packages/contracts/src/reviews.js";

const configured = import.meta.env.VITE_API_ORIGIN as string | undefined;
if (configured && new URL(configured).origin !== configured) throw new Error("VITE_API_ORIGIN must be an origin without a trailing slash");
const base = configured ?? "";
export class ApiFailure extends Error { constructor(public status: number, message: string) { super(message); } }
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, credentials: "include", headers: { ...init.headers, "Content-Type": "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiError | null;
    throw new ApiFailure(response.status, body?.error?.message ?? "Request failed");
  }
  return response.json() as Promise<T>;
}
export const api = {
  review: (id: string) => request<SessionReview>(`/v1/bookings/${encodeURIComponent(id)}/review`),
  saveNotes: (id: string, notesMarkdown: string) => request(`/v1/bookings/${encodeURIComponent(id)}/notes`, { method: "PATCH", body: JSON.stringify({ notesMarkdown }) }),
  lesson: (id: string) => request<LessonRoom>(`/v1/lessons/${encodeURIComponent(id)}`),
  lessonToken: (id: string) => request<LessonToken>(`/v1/lessons/${encodeURIComponent(id)}/token`, { method: "POST" }),
  startLesson: (id: string) => request(`/v1/lessons/${encodeURIComponent(id)}/start`, { method: "POST" }),
  consentRecording: (id: string) => request(`/v1/lessons/${encodeURIComponent(id)}/consent`, { method: "POST" }),
  lessonPresence: (id: string) => request<{ tutorPresent: boolean }>(`/v1/lessons/${encodeURIComponent(id)}/presence`),
  family: () => request<FamilyOverview>("/v1/parent/overview"),
  admin: () => request<AdminOverview>("/v1/admin/overview"),
  approveTutor: (id: string, evidenceNote: string, confirmed: boolean) => request(`/v1/admin/tutors/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ evidenceNote, confirmed }) }),
  contacts: () => request<{ contacts: Contact[] }>("/v1/contacts"),
  availability: () => request<{ slots: AvailabilitySlot[] }>("/v1/tutor/availability"),
  addAvailability: (dayOfWeek: number, startTime: string, endTime: string) => request("/v1/tutor/availability", { method: "POST", body: JSON.stringify({ dayOfWeek, startTime, endTime }) }),
  removeAvailability: (id: string) => request(`/v1/tutor/availability/${encodeURIComponent(id)}`, { method: "DELETE" }),
  me: () => request<{ identity: Identity }>("/v1/auth/me"),
  signIn: (email: string, password: string) => request<{ identity: Identity }>("/v1/auth/sign-in", { method: "POST", body: JSON.stringify({ email, password }) }),
  signOut: () => request("/v1/auth/sign-out", { method: "POST", body: "{}" }),
  signUp: (email: string, password: string, fullName: string, role: string) => request<{ message: string }>("/v1/auth/sign-up", { method: "POST", body: JSON.stringify({ email, password, fullName, role }) }),
  resetPassword: (email: string) => request<{ message: string }>("/v1/auth/reset-password", { method: "POST", body: JSON.stringify({ email }) }),
  updatePassword: (password: string) => request("/v1/auth/password", { method: "POST", body: JSON.stringify({ password }) }),
  exchange: (code: string) => request("/v1/auth/exchange", { method: "POST", body: JSON.stringify({ code }) }),
  calendar: (from: string, to: string) => request<{ bookings: BookingSummary[] }>(`/v1/bookings/calendar?${new URLSearchParams({ from, to })}`),
  booking: (id: string) => request<BookingDetail>(`/v1/bookings/${encodeURIComponent(id)}`),
  rename: (id: string, lessonName: string) => request(`/v1/bookings/${encodeURIComponent(id)}/name`, { method: "PATCH", body: JSON.stringify({ lessonName }) }),
};

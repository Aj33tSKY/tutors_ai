import type { ApiError, BookingDetail, BookingSummary, Identity } from "../../../packages/contracts/src/index.js";
import type { AvailabilitySlot, Contact, AdminOverview, FamilyOverview } from "../../../packages/contracts/src/portal.js";
import type { LessonRoom, LessonToken } from "../../../packages/contracts/src/lessons.js";
import type { SessionReview } from "../../../packages/contracts/src/reviews.js";
import type { CalendarSession } from "../../../packages/contracts/src/models.js";
import type { PublicTutor, TutorCatalogue, LessonRequestResult } from "../../../packages/contracts/src/tutors.js";
import type { ChatConversationSummary, ChatTranscript } from "../../../packages/contracts/src/chat.js";
import type { StudentBilling, PayoutState, RedirectUrl } from "../../../packages/contracts/src/billing.js";
import type { Thread, MessagePage, ThreadMessage } from "../../../packages/contracts/src/messaging.js";
import type { ScheduledLessons, RequestInbox, RequestDetail } from "../../../packages/contracts/src/scheduling.js";

const configured = import.meta.env.VITE_API_ORIGIN as string | undefined;
if (configured && new URL(configured).origin !== configured) throw new Error("VITE_API_ORIGIN must be an origin without a trailing slash");
const base = configured ?? "";
/** Absolute URL for transports that build their own requests (streaming chat). */
export const apiPath = (path: string) => `${base}${path}`;
export class ApiFailure extends Error { constructor(public status: number, message: string) { super(message); } }
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, credentials: "include", headers: { ...init.headers, "Content-Type": "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiError | null;
    throw new ApiFailure(response.status, body?.error?.message ?? "Request failed");
  }
  return response.json() as Promise<T>;
}
async function upload(path: string, form: FormData): Promise<ThreadMessage> {
  // No explicit content-type: the browser must add the multipart boundary itself.
  const response = await fetch(`${base}${path}`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) { const payload = await response.json().catch(() => null) as ApiError | null; throw new ApiFailure(response.status, payload?.error?.message ?? "Could not send this message"); }
  return (await response.json() as { message: ThreadMessage }).message;
}
export const api = {
  publicTutors: (query: string) => request<TutorCatalogue>(`/v1/public/tutors${query ? `?${query}` : ""}`),
  publicTutor: (id: string) => request<{ tutor: PublicTutor }>(`/v1/public/tutors/${encodeURIComponent(id)}`),
  tutorSlots: (id: string) => request<{ slots: string[] }>(`/v1/public/tutors/${encodeURIComponent(id)}/slots`),
  requestLesson: (id: string, input: { subject: string; examBoard: string; startTime: string }) => request<LessonRequestResult>(`/v1/student/tutors/${encodeURIComponent(id)}/requests`, { method: "POST", body: JSON.stringify(input) }),
  chatConversations: () => request<{ conversations: ChatConversationSummary[] }>("/v1/student/chat/conversations"),
  createChat: () => request<{ id: string }>("/v1/student/chat/conversations", { method: "POST" }),
  chat: (id: string) => request<ChatTranscript>(`/v1/student/chat/conversations/${encodeURIComponent(id)}`),
  deleteChat: (id: string) => request(`/v1/student/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  studentBilling: () => request<StudentBilling>("/v1/student/billing"),
  startPaymentSetup: () => request<RedirectUrl>("/v1/student/billing/setup", { method: "POST" }),
  openBillingPortal: () => request<RedirectUrl>("/v1/student/billing/portal", { method: "POST" }),
  setAutoCharge: (enabled: boolean) => request("/v1/student/billing/auto-charge", { method: "PUT", body: JSON.stringify({ enabled }) }),
  payouts: () => request<PayoutState>("/v1/tutor/payouts"),
  startPayoutOnboarding: () => request<RedirectUrl>("/v1/tutor/payouts/onboarding", { method: "POST" }),
  openPayoutDashboard: () => request<RedirectUrl>("/v1/tutor/payouts/dashboard", { method: "POST" }),
  sendInvoice: (bookingId: string) => request(`/v1/bookings/${encodeURIComponent(bookingId)}/invoice`, { method: "POST" }),
  thread: (counterpartId: string) => request<Thread>(`/v1/conversations/with/${encodeURIComponent(counterpartId)}`),
  messagesAfter: (conversationId: string, after: string | null) => request<MessagePage>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages?${new URLSearchParams(after ? { after } : {})}`),
  messagesBefore: (conversationId: string, before: string) => request<MessagePage>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages?${new URLSearchParams({ before })}`),
  sendMessage: (conversationId: string, input: { body: string; file: File | null }) => {
    const form = new FormData(); form.set("body", input.body); if (input.file) form.set("file", input.file);
    return upload(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, form);
  },
  calendarSessions: (from: string, to: string) => request<{ sessions: CalendarSession[] }>(`/v1/calendar?${new URLSearchParams({ from, to })}`),
  scheduleLessons: (input: { studentId: string; startTime: string; durationHours: number; count: number; lessonName: string; commandId: string }) => request<ScheduledLessons>("/v1/tutor/lessons", { method: "POST", body: JSON.stringify(input) }),
  lessonChange: (id: string, kind: "complete" | "reopen" | "cancel" | "reschedule", input: object = {}) => request<ScheduledLessons>(`/v1/bookings/${encodeURIComponent(id)}/${kind}`, { method: "POST", body: JSON.stringify(input) }),
  requests: (page = 0) => request<RequestInbox>(`/v1/tutor/requests?${new URLSearchParams({ page: String(page) })}`),
  lessonRequest: (id: string) => request<RequestDetail>(`/v1/requests/${encodeURIComponent(id)}`),
  scheduleRequest: (id: string, input: { startTime: string; count: number; lessonName: string; commandId: string }) => request<ScheduledLessons>(`/v1/requests/${encodeURIComponent(id)}/schedule`, { method: "POST", body: JSON.stringify(input) }),
  declineRequest: (id: string) => request(`/v1/requests/${encodeURIComponent(id)}/decline`, { method: "POST" }),
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

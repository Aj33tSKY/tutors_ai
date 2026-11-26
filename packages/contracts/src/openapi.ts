import { z } from "zod";
import { notesInput } from "./reviews.js";
import { availabilityInput, tutorApproval } from "./portal.js";
import { scheduleInput, requestScheduleInput, rescheduleInput, cancelInput } from "./scheduling.js";
import { lessonRequestInput } from "./tutors.js";
import { chatRequest } from "./chat.js";
import { autoChargeInput } from "./billing.js";
import { credentials, signup, resetRequest, passwordUpdate, authCode, roleChoice, renameBooking } from "./index.js";

const jsonBody = (schema: z.ZodType) => ({ required: true, content: { "application/json": { schema: z.toJSONSchema(schema) } } });
const result = { description: "JSON result; error responses use the shared ApiError envelope" };
const operation = (summary: string, body?: z.ZodType, authenticated = true) => ({
  summary,
  ...(body ? { requestBody: jsonBody(body) } : {}),
  ...(authenticated ? { security: [{ sessionCookie: [] }] } : {}),
  responses: { "200": result, "400": { description: "Invalid input" }, "401": { description: "Authentication required" }, "403": { description: "Forbidden or untrusted origin" }, "503": { description: "Dependency unavailable" } },
});

export const openapi = {
  openapi: "3.1.0",
  info: { title: "Hybrid Tutors portable API", version: "0.2.0", description: "Extracted authentication, portal, booking reviews and live lesson operations. Remaining legacy billing, messaging, scheduling and webhook operations are not exposed by this API yet." },
  components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "sb-project-auth-token", description: "Example name only: HttpOnly cookies are issued by the API and their names depend on the Supabase project hostname. Supabase may chunk long cookies." } } },
  paths: {
    "/v1/public/tutors": { get: { summary: "Approved tutors, filterable by subject, board, price band and weekday (public, short cache)", parameters: ["subject", "board", "maxPrice", "day"].map((name) => ({ name, in: "query", schema: { type: "string" } })), responses: { "200": result } } },
    "/v1/public/tutors/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: { summary: "One approved tutor's public profile", responses: { "200": result, "404": { description: "Not an approved tutor" } } } },
    "/v1/public/tutors/{id}/slots": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: { summary: "Open one-hour starts over the next 28 days, in UTC instants (never cached)", responses: { "200": result } } },
    "/v1/student/tutors/{id}/requests": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: { ...operation("Request a lesson in one transaction (trial rule, slot and volume checks, tutor notification)", lessonRequestInput), responses: { "201": result, "409": { description: "Slot or offer no longer available" }, "429": { description: "Too many open requests" } } } },
    "/v1/student/chat": { post: { ...operation("Send one chat turn and stream the reply as UI message chunks", chatRequest), responses: { "200": { description: "text/event-stream of AI SDK UI message chunks" }, "404": { description: "Not the student's conversation" }, "429": { description: "Daily allowance spent" }, "503": { description: "Dependency unavailable" } } } },
    "/v1/student/chat/conversations": { get: operation("List the student's conversations"), post: operation("Start a conversation") },
    "/v1/student/chat/conversations/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Read the newest messages of a conversation"), delete: operation("Delete a conversation") },
    "/v1/student/billing": { get: operation("Read payment settings, the saved method and lessons awaiting payment") },
    "/v1/student/billing/setup": { post: operation("Start hosted payment-method setup and return its redirect URL") },
    "/v1/student/billing/portal": { post: operation("Open the hosted billing portal and return its redirect URL") },
    "/v1/student/billing/auto-charge": { put: operation("Turn automatic payment on or off", autoChargeInput) },
    "/v1/tutor/payouts": { get: operation("Read payout connection state") },
    "/v1/tutor/payouts/onboarding": { post: operation("Start or resume payout onboarding and return its redirect URL") },
    "/v1/tutor/payouts/dashboard": { post: operation("Open the payout provider dashboard") },
    "/v1/bookings/{id}/invoice": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Invoice a completed paid lesson exactly once") },
    "/v1/webhooks/livekit": { post: { summary: "Signed LiveKit room, track and egress events, persisted before acknowledgement", responses: { "200": result, "401": { description: "Invalid signature" }, "503": { description: "Not recorded; LiveKit will retry" } } } },
    "/v1/webhooks/stripe": { post: { summary: "Signed Stripe events, persisted before acknowledgement", responses: { "200": result, "400": { description: "Missing or invalid signature" }, "503": { description: "Not recorded; the provider will retry" } } } },
    "/v1/conversations/with/{counterpartId}": { parameters: [{ name: "counterpartId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Open the caller's conversation with a booked counterpart and read the latest messages") },
    "/v1/conversations/{id}/messages": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: { ...operation("Read messages after or before a created_at cursor"), parameters: ["after", "before"].map((name) => ({ name, in: "query", schema: { type: "string", format: "date-time" } })) },
      post: { ...operation("Send a message as the authenticated caller, optionally with one validated attachment (multipart/form-data fields body and file)"), responses: { "201": result, "400": { description: "Invalid input" }, "413": { description: "Attachment too large" }, "415": { description: "Unsupported attachment type" } } },
    },
    "/v1/calendar": { get: { ...operation("Read the participant calendar with contact names and lesson controls"), parameters: ["from", "to"].map((name) => ({ name, in: "query", required: true, schema: { type: "string", format: "date-time" } })) } },
    "/v1/tutor/lessons": { post: { ...operation("Transactionally create lessons with an idempotency key", scheduleInput), responses: { "201": result, "409": { description: "Calendar conflict or lesson state changed" } } } },
    "/v1/tutor/requests": { get: { ...operation("Read a page of pending lesson requests"), parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 0 } }] } },
    "/v1/requests/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Read an owned lesson request") },
    "/v1/requests/{id}/schedule": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Accept a request and atomically create lessons and confirmation", requestScheduleInput) },
    "/v1/requests/{id}/decline": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Decline a pending owned request") },
    ...Object.fromEntries((["complete", "reopen", "cancel", "reschedule"] as const).map((kind) => [`/v1/bookings/{id}/${kind}`, {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      post: operation(`Tutor ${kind} with transactional state checks`, kind === "reschedule" ? rescheduleInput : kind === "cancel" ? cancelInput : undefined),
    }])),
    "/v1/bookings/{id}/review": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Read an authorized completed session review and short-lived media grants") },
    "/v1/bookings/{id}/notes": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], patch: operation("Tutor edits completed lesson notes", notesInput) },
    "/v1/lessons/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Read participant-only lesson room state") },
    "/v1/lessons/{id}/token": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Issue a participant token for an open lesson") },
    "/v1/lessons/{id}/start": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Tutor starts a scheduled lesson") },
    "/v1/lessons/{id}/consent": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Tutor records consent using caller-scoped RLS") },
    "/v1/lessons/{id}/presence": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Student checks tutor presence in their open lesson") },
    "/v1/admin/overview": { get: operation("Read administrator counts and verification queue") },
    "/v1/admin/tutors/{id}/approve": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Approve a tutor with recorded safeguarding evidence", tutorApproval) },
    "/v1/contacts": { get: operation("Read contacts related by bookings or lesson requests") },
    "/v1/tutor/availability": { get: operation("Read own weekly availability"), post: { ...operation("Create an availability slot", availabilityInput), responses: { "201": result, "400": { description: "Invalid slot" }, "401": { description: "Unauthenticated" }, "403": { description: "Tutor required" } } } },
    "/v1/tutor/availability/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], delete: operation("Delete an owned availability slot") },
    "/v1/auth/sign-in": { post: operation("Sign in without exposing tokens", credentials, false) },
    "/v1/auth/sign-up": { post: { ...operation("Create a public-role account", signup, false), responses: { "202": result, "400": { description: "Invalid signup" } } } },
    "/v1/auth/oauth/google": { post: operation("Start Google sign-in; returns the provider URL", undefined, false) },
    "/v1/auth/role": { post: operation("Choose student or tutor once, for an account made with Google", roleChoice) },
    "/v1/auth/refresh": { post: operation("Refresh the cookie session") },
    "/v1/auth/exchange": { post: operation("Exchange a one-time PKCE email code", authCode, false) },
    "/v1/auth/reset-password": { post: { ...operation("Request a reset email", resetRequest, false), responses: { "202": result, "503": { description: "Email unavailable" } } } },
    "/v1/auth/password": { post: operation("Update the current user's password", passwordUpdate) },
    "/v1/auth/sign-out": { post: operation("Sign out the current session") },
    "/v1/auth/me": { get: operation("Read the current verified identity") },
    "/v1/bookings/calendar": { get: { ...operation("Read a participant's bounded calendar"), parameters: ["from", "to"].map((name) => ({ name, in: "query", required: true, schema: { type: "string", format: "date-time" } })) } },
    "/v1/bookings/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Read an RLS-visible booking") },
    "/v1/bookings/{id}/name": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], patch: operation("Rename a participant's noncancelled lesson", renameBooking) },
  },
};

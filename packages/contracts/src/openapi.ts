import { z } from "zod";
import { notesInput } from "./reviews.js";
import { availabilityInput, tutorApproval } from "./portal.js";
import { credentials, signup, resetRequest, passwordUpdate, authCode, renameBooking } from "./index.js";

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
  info: { title: "Kindling portable API", version: "0.2.0", description: "Extracted authentication, portal, booking reviews and live lesson operations. Remaining legacy billing, messaging, scheduling and webhook operations are not exposed by this API yet." },
  components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "sb-project-auth-token", description: "Example name only: HttpOnly cookies are issued by the API and their names depend on the Supabase project hostname. Supabase may chunk long cookies." } } },
  paths: {
    "/v1/bookings/{id}/review": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Read an authorized completed session review and short-lived media grants") },
    "/v1/bookings/{id}/notes": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], patch: operation("Tutor edits completed lesson notes", notesInput) },
    "/v1/lessons/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Read participant-only lesson room state") },
    "/v1/lessons/{id}/token": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Issue a participant token for an open lesson") },
    "/v1/lessons/{id}/start": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Tutor starts a scheduled lesson") },
    "/v1/lessons/{id}/consent": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Tutor records consent using caller-scoped RLS") },
    "/v1/lessons/{id}/presence": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], get: operation("Student checks tutor presence in their open lesson") },
    "/v1/parent/overview": { get: operation("Read linked children and their upcoming and recent lessons") },
    "/v1/admin/overview": { get: operation("Read administrator counts and verification queue") },
    "/v1/admin/tutors/{id}/approve": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], post: operation("Approve a tutor with recorded safeguarding evidence", tutorApproval) },
    "/v1/contacts": { get: operation("Read contacts related by bookings or lesson requests") },
    "/v1/tutor/availability": { get: operation("Read own weekly availability"), post: { ...operation("Create an availability slot", availabilityInput), responses: { "201": result, "400": { description: "Invalid slot" }, "401": { description: "Unauthenticated" }, "403": { description: "Tutor required" } } } },
    "/v1/tutor/availability/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], delete: operation("Delete an owned availability slot") },
    "/v1/auth/sign-in": { post: operation("Sign in without exposing tokens", credentials, false) },
    "/v1/auth/sign-up": { post: { ...operation("Create a public-role account", signup, false), responses: { "202": result, "400": { description: "Invalid signup" } } } },
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

import { z } from "zod";
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
  info: { title: "Kindling portable API", version: "0.1.0", description: "First authenticated migration slice. Not a replacement for every legacy application endpoint yet." },
  components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "sb-project-auth-token", description: "Example name only: HttpOnly cookies are issued by the API and their names depend on the Supabase project hostname. Supabase may chunk long cookies." } } },
  paths: {
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

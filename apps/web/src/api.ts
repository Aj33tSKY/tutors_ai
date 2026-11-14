import type { ApiError, BookingDetail, BookingSummary, Identity } from "../../../packages/contracts/src/index.js";

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

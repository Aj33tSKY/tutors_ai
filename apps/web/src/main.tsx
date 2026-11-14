import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiFailure } from "./api.js";
import { AccountForm, AuthConfirm } from "./auth-pages.js";
import "../../../src/app/globals.css";

const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } });
function Notice({ error }: { error: unknown }) { return <p role="alert">{error instanceof Error ? error.message : "Could not load this page"}</p>; }
function SignIn() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  return <main className="mx-auto max-w-md space-y-5 p-8"><h1 className="display-md">Sign in to Kindling</h1><form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(undefined);
    const form = new FormData(event.currentTarget);
    try { const result = await api.signIn(String(form.get("email")), String(form.get("password"))); client.clear(); client.setQueryData(["identity"], result); navigate("/dashboard"); }
    catch (cause) { setError(cause); } finally { setPending(false); }
  }}><label className="block">Email<input className="block w-full rounded border p-2" name="email" type="email" autoComplete="email" required/></label><label className="block">Password<input className="block w-full rounded border p-2" name="password" type="password" autoComplete="current-password" required/></label><button className="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>{error ? <Notice error={error}/> : null}</form><p><Link to="/sign-up">Create an account</Link> · <Link to="/forgot-password">Forgot password?</Link></p></main>;
}
function Dashboard() {
  const identity = useQuery({ queryKey: ["identity"], queryFn: api.me });
  const from = new Date(); from.setUTCDate(1); from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 2);
  const lessons = useQuery({ queryKey: ["calendar", identity.data?.identity.id, from.toISOString(), to.toISOString()], queryFn: () => api.calendar(from.toISOString(), to.toISOString()), enabled: Boolean(identity.data && ["student", "tutor"].includes(identity.data.identity.profile.role)) });
  const navigate = useNavigate();
  const client = useQueryClient();
  if (identity.error instanceof ApiFailure && identity.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (identity.error) return <Notice error={identity.error}/>;
  if (!identity.data) return <p role="status">Loading your account…</p>;
  return <main className="mx-auto max-w-5xl space-y-6 p-8"><header className="flex items-center justify-between"><h1 className="display-md">Welcome back, {identity.data.identity.profile.full_name}</h1><button onClick={async () => { try { await api.signOut(); client.clear(); navigate("/sign-in"); } catch { window.alert("Could not sign out. Please try again."); } }}>Sign out</button></header><h2 className="text-xl">Your lessons</h2>{lessons.error ? <Notice error={lessons.error}/> : lessons.isLoading ? <p role="status">Loading lessons…</p> : <ul className="space-y-3">{lessons.data?.bookings.map((booking) => <li className="rounded border p-4" key={booking.id}><Link to={`/dashboard/bookings/${booking.id}`}>{booking.lesson_name || booking.subject || "Lesson"}</Link><p>{new Date(booking.start_time).toLocaleString("en-GB")} · {booking.status}</p></li>)}</ul>}{lessons.data?.bookings.length === 0 && <p>No lessons in this date range.</p>}</main>;
}
function Booking() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const result = useQuery({ queryKey: ["booking", id], queryFn: () => api.booking(id) });
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  if (result.error instanceof ApiFailure && result.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (result.error) return <Notice error={result.error}/>;
  if (!result.data) return <p role="status">Loading lesson…</p>;
  const { booking, counterpartName, canRename } = result.data;
  return <main className="mx-auto max-w-3xl space-y-5 p-8"><Link to="/dashboard">← Your lessons</Link><h1 className="display-md">{booking.lesson_name || booking.subject || "Lesson"}</h1><p>{counterpartName} · {new Date(booking.start_time).toLocaleString("en-GB")}</p><p>{booking.status}</p>{canRename && <form className="space-y-3" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(undefined);
    const form = new FormData(event.currentTarget);
    try { await api.rename(id, String(form.get("name"))); await Promise.all([client.invalidateQueries({ queryKey: ["booking", id] }), client.invalidateQueries({ queryKey: ["calendar"] })]); }
    catch (cause) { setError(cause); } finally { setPending(false); }
  }}><label className="block">Lesson name<input className="block w-full rounded border p-2" key={booking.lesson_name} name="name" maxLength={120} defaultValue={booking.lesson_name ?? ""}/></label><button disabled={pending} className="rounded bg-primary px-4 py-2 text-primary-foreground">{pending ? "Saving…" : "Save name"}</button>{error ? <Notice error={error}/> : null}</form>}</main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={cache}><BrowserRouter><Routes><Route path="/sign-in" element={<SignIn/>}/><Route path="/sign-up" element={<AccountForm mode="signup"/>}/><Route path="/forgot-password" element={<AccountForm mode="reset"/>}/><Route path="/reset-password" element={<AccountForm mode="password"/>}/><Route path="/auth/confirm" element={<AuthConfirm/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/dashboard/bookings/:id" element={<Booking/>}/><Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="*" element={<main className="p-8"><h1>Page not found</h1><Link to="/dashboard">Return to your lessons</Link></main>}/></Routes></BrowserRouter></QueryClientProvider></React.StrictMode>);

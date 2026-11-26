import React, { useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiFailure } from "./api.js";
import { AccountForm, AuthConfirm, GoogleButton } from "./auth-pages.js";
import { WebNavigationProvider } from "./navigation-provider.js";
import { DashboardLayout, MarketingLayout } from "./layouts.js";
import { ThemeProvider } from "../../../src/components/theme-provider.js";
import "./fonts.css";
import "../../../src/app/globals.css";

const AvailabilityPage = lazy(() => import("./portal-pages.js").then((module) => ({ default: module.AvailabilityPage })));
const ContactsPage = lazy(() => import("./portal-pages.js").then((module) => ({ default: module.ContactsPage })));
const FamilyPage = lazy(() => import("./portal-pages.js").then((module) => ({ default: module.FamilyPage })));
const AdminPage = lazy(() => import("./portal-pages.js").then((module) => ({ default: module.AdminPage })));
const CalendarView = lazy(() => import("./calendar-view.js").then((module) => ({ default: module.CalendarView })));
const RequestPage = lazy(() => import("./request-page.js").then((module) => ({ default: module.RequestPage })));
const StudentBillingPage = lazy(() => import("./billing-pages.js").then((module) => ({ default: module.StudentBillingPage })));
const PayoutsPage = lazy(() => import("./billing-pages.js").then((module) => ({ default: module.PayoutsPage })));
const ChatPage = lazy(() => import("./chat-page.js").then((module) => ({ default: module.ChatPage })));
const ChatIndexPage = lazy(() => import("./chat-page.js").then((module) => ({ default: module.ChatIndexPage })));
const TutorsPage = lazy(() => import("./tutor-pages.js").then((module) => ({ default: module.TutorsPage })));
const TutorProfilePage = lazy(() => import("./tutor-pages.js").then((module) => ({ default: module.TutorProfilePage })));
const LandingPage = lazy(() => import("./marketing-pages.js").then((module) => ({ default: module.LandingPage })));
const PricingPage = lazy(() => import("./marketing-pages.js").then((module) => ({ default: module.PricingPage })));
const HowItWorksPage = lazy(() => import("./marketing-pages.js").then((module) => ({ default: module.HowItWorksPage })));
const AboutPage = lazy(() => import("./marketing-pages.js").then((module) => ({ default: module.AboutPage })));
const MessagesPage = lazy(() => import("./messages-page.js").then((module) => ({ default: module.MessagesPage })));
const ReviewPage = lazy(() => import("./review-page.js").then((module) => ({ default: module.ReviewPage })));
const LessonPage = lazy(() => import("./lesson-page.js").then((module) => ({ default: module.LessonPage })));

const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10000 } } });
function Notice({ error }: { error: unknown }) { return <p role="alert">{error instanceof Error ? error.message : "Could not load this page"}</p>; }
function SignIn() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  // Only same-site paths are honoured, so a crafted link cannot send a signed-in user elsewhere.
  const next = search.get("next"); const destination = next && /^\/(?![/\\])/.test(next) ? next : "/dashboard";
  return <main className="mx-auto max-w-md space-y-5 p-8"><h1 className="display-md">Sign in to Kindling</h1><GoogleButton label="Continue with Google"/><form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(undefined);
    const form = new FormData(event.currentTarget);
    try { const result = await api.signIn(String(form.get("email")), String(form.get("password"))); client.clear(); client.setQueryData(["identity"], result); navigate(destination); }
    catch (cause) { setError(cause); } finally { setPending(false); }
  }}><label className="block">Email<input className="block w-full rounded border p-2" name="email" type="email" autoComplete="email" required/></label><label className="block">Password<input className="block w-full rounded border p-2" name="password" type="password" autoComplete="current-password" required/></label><button className="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>{error ? <Notice error={error}/> : null}</form><p><Link to="/sign-up">Create an account</Link> · <Link to="/forgot-password">Forgot password?</Link></p></main>;
}
function Dashboard() {
  const identity = useQuery({ queryKey: ["identity"], queryFn: api.me });
  if (identity.error instanceof ApiFailure && identity.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (identity.error) return <Notice error={identity.error}/>;
  if (!identity.data) return <p role="status">Loading your account…</p>;
  if (identity.data.identity.profile.role === "parent") return <Navigate to="/dashboard/parent" replace/>;
  if (identity.data.identity.profile.role === "admin") return <Navigate to="/dashboard/admin" replace/>;
  return <main className="mx-auto max-w-5xl space-y-6 p-8"><header><h1 className="display-md">Welcome back, {identity.data.identity.profile.full_name}</h1></header><nav className="flex gap-4">{identity.data.identity.profile.role === "tutor" ? <><Link to="/dashboard/tutor/availability">Weekly availability</Link><Link to="/dashboard/tutor/students">My students</Link><Link to="/dashboard/tutor/payouts">Payouts</Link></> : identity.data.identity.profile.role === "student" ? <><Link to="/dashboard/student/tutors">My tutors</Link><Link to="/tutors">Find a tutor</Link><Link to="/dashboard/student/chat">Revision assistant</Link><Link to="/dashboard/student/billing">Payment settings</Link></> : null}</nav><CalendarView identity={identity.data.identity}/></main>;
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
  return <main className="mx-auto max-w-3xl space-y-5 p-8"><Link to="/dashboard">← Your lessons</Link><h1 className="display-md">{booking.lesson_name || booking.subject || "Lesson"}</h1><p>{counterpartName} · {new Date(booking.start_time).toLocaleString("en-GB")}</p><p>{booking.status}</p>{booking.status === "scheduled" && <Link to={`/session/${booking.id}`}>Open lesson room</Link>}{booking.status === "completed" && <Link to={`/dashboard/student/bookings/${booking.id}`}>Review lesson</Link>}{canRename && <form className="space-y-3" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(undefined);
    const form = new FormData(event.currentTarget);
    try { await api.rename(id, String(form.get("name"))); await Promise.all([client.invalidateQueries({ queryKey: ["booking", id] }), client.invalidateQueries({ queryKey: ["calendar"] })]); }
    catch (cause) { setError(cause); } finally { setPending(false); }
  }}><label className="block">Lesson name<input className="block w-full rounded border p-2" key={booking.lesson_name} name="name" maxLength={120} defaultValue={booking.lesson_name ?? ""}/></label><button disabled={pending} className="rounded bg-primary px-4 py-2 text-primary-foreground">{pending ? "Saving…" : "Save name"}</button>{error ? <Notice error={error}/> : null}</form>}</main>;
}
// Client-rendered routes use the provider effects; its SSR bootstrap script stays inert.
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={cache}><BrowserRouter><ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} scriptProps={{ type: "text/plain" }}><WebNavigationProvider><Suspense fallback={<p role="status">Loading page…</p>}><Routes><Route path="/sign-in" element={<SignIn/>}/><Route path="/sign-up" element={<AccountForm mode="signup"/>}/><Route path="/forgot-password" element={<AccountForm mode="reset"/>}/><Route path="/reset-password" element={<AccountForm mode="password"/>}/><Route path="/auth/confirm" element={<AuthConfirm/>}/><Route path="/session/:id" element={<LessonPage/>}/>
<Route element={<MarketingLayout/>}><Route path="/" element={<LandingPage/>}/><Route path="/pricing" element={<PricingPage/>}/><Route path="/how-it-works" element={<HowItWorksPage/>}/><Route path="/about" element={<AboutPage/>}/><Route path="/tutors" element={<TutorsPage/>}/><Route path="/tutors/:id" element={<TutorProfilePage/>}/></Route>
<Route element={<DashboardLayout/>}><Route path="/dashboard/student/bookings/:id" element={<ReviewPage/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/dashboard/parent" element={<FamilyPage/>}/><Route path="/dashboard/admin" element={<AdminPage/>}/><Route path="/dashboard/student" element={<Dashboard/>}/><Route path="/dashboard/tutor" element={<Dashboard/>}/><Route path="/dashboard/tutor/requests/:id" element={<RequestPage/>}/><Route path="/dashboard/tutor/availability" element={<AvailabilityPage/>}/><Route path="/dashboard/tutor/students" element={<ContactsPage role="tutor"/>}/><Route path="/dashboard/student/tutors" element={<ContactsPage role="student"/>}/><Route path="/dashboard/student/chat" element={<ChatIndexPage/>}/><Route path="/dashboard/student/chat/:id" element={<ChatPage/>}/><Route path="/dashboard/student/billing" element={<StudentBillingPage/>}/><Route path="/dashboard/tutor/payouts" element={<PayoutsPage/>}/><Route path="/dashboard/messages/:counterpartId" element={<MessagesPage/>}/><Route path="/dashboard/bookings/:id" element={<Booking/>}/><Route path="/dashboard/student/bookings" element={<Navigate to="/dashboard/student" replace/>}/></Route>
<Route path="*" element={<main className="p-8"><h1>Page not found</h1><Link to="/dashboard">Return to your lessons</Link></main>}/></Routes></Suspense></WebNavigationProvider></ThemeProvider></BrowserRouter></QueryClientProvider></React.StrictMode>);

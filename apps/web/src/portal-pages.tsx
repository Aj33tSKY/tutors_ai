import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AvailabilityView } from "../../../src/components/dashboard/availability-view.js";
import { ContactsList } from "../../../src/components/dashboard/contacts-list.js";
import { FamilyOverviewView } from "../../../src/components/dashboard/family-overview.js";
import { AdminOverviewView } from "../../../src/components/dashboard/admin-overview.js";
import { TutorReviewFields } from "../../../src/components/dashboard/tutor-review-fields.js";
import { api, ApiFailure } from "./api.js";

function Failure({ error }: { error: unknown }) {
  if (error instanceof ApiFailure && error.status === 401) return <Navigate to="/sign-in" replace/>;
  return <p role="alert">{error instanceof Error ? error.message : "Could not load this page"}</p>;
}
function PortalFrame({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  return <main className="mx-auto max-w-6xl space-y-6 p-8"><header className="flex justify-between"><Link to="/dashboard">Dashboard</Link><button onClick={async () => {
    try { await api.signOut(); client.clear(); navigate("/sign-in"); }
    catch (cause) { setError(cause); }
  }}>Sign out</button></header>{error ? <Failure error={error}/> : null}{children}</main>;
}
export function AvailabilityPage() {
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ["identity"], queryFn: api.me });
  const slots = useQuery({ queryKey: ["availability", identity.data?.identity.id], queryFn: api.availability, enabled: identity.data?.identity.profile.role === "tutor" });
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  async function change(operation: () => Promise<unknown>) {
    setPending(true); setError(undefined);
    try { await operation(); await client.invalidateQueries({ queryKey: ["availability"] }); }
    catch (cause) { setError(cause); } finally { setPending(false); }
  }
  if (identity.error || slots.error) return <Failure error={identity.error || slots.error}/>;
  if (!identity.data) return <p role="status">Loading your account…</p>;
  if (identity.data.identity.profile.role !== "tutor") return <Failure error={new Error("Tutor access required")}/>;
  if (!slots.data) return <p role="status">Loading availability…</p>;
  return <main className="mx-auto max-w-5xl space-y-6 p-8"><Link to="/dashboard">← Dashboard</Link>{error ? <Failure error={error}/> : null}<AvailabilityView slots={slots.data.slots} pending={pending}
    addAvailabilityAction={(data) => change(() => api.addAvailability(Number(data.get("day_of_week")), String(data.get("start_time")), String(data.get("end_time"))))}
    removeAvailabilityAction={(data) => change(() => api.removeAvailability(String(data.get("id"))))}/></main>;
}
export function ContactsPage({ role }: { role: "student" | "tutor" }) {
  const identity = useQuery({ queryKey: ["identity"], queryFn: api.me });
  const contacts = useQuery({ queryKey: ["contacts", identity.data?.identity.id], queryFn: api.contacts, enabled: identity.data?.identity.profile.role === role });
  if (identity.error || contacts.error) return <Failure error={identity.error || contacts.error}/>;
  if (!identity.data) return <p role="status">Loading your account…</p>;
  if (identity.data.identity.profile.role !== role) return <Failure error={new Error("This page is unavailable for this account")}/>;
  if (!contacts.data) return <p role="status">Loading contacts…</p>;
  const singular = role === "student" ? "Tutor" : "Student";
  return <main className="mx-auto max-w-6xl space-y-6 p-8"><Link to="/dashboard">← Dashboard</Link><ContactsList title={`My ${singular.toLowerCase()}s`} singular={singular} contacts={contacts.data.contacts}/></main>;
}
export function FamilyPage() {
  const data = useQuery({ queryKey: ["family"], queryFn: api.family });
  if (data.error) return <Failure error={data.error}/>;
  if (!data.data) return <p role="status">Loading family overview…</p>;
  return <PortalFrame><FamilyOverviewView family={data.data}/></PortalFrame>;
}
export function AdminPage() {
  const client = useQueryClient();
  const data = useQuery({ queryKey: ["admin"], queryFn: api.admin });
  if (data.error) return <Failure error={data.error}/>;
  if (!data.data) return <p role="status">Loading platform overview…</p>;
  return <PortalFrame><AdminOverviewView {...data.data} renderReview={(id) => <TutorReviewFields tutorId={id} approveAction={async (_previous, form) => {
    try {
      await api.approveTutor(id, String(form.get("evidence_note")), form.get("confirmed") === "on");
      await client.invalidateQueries({ queryKey: ["admin"] });
      return { success: true };
    } catch (error) { return { error: error instanceof Error ? error.message : "Could not approve tutor" }; }
  }}/>}/></PortalFrame>;
}

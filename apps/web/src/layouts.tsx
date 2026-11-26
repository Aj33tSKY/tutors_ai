import { useEffect } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SiteHeader } from "../../../src/components/marketing/site-header.js";
import { SiteFooter } from "../../../src/components/marketing/site-footer.js";
import { DashboardSidebar } from "../../../src/components/dashboard/sidebar.js";
import { DashboardTopbar } from "../../../src/components/dashboard/topbar.js";
import { api, ApiFailure } from "./api.js";

export function MarketingLayout() {
  return <><SiteHeader/><main className="flex-1"><Outlet/></main><SiteFooter/></>;
}

/** The signed-in frame. Identity comes from the API; an expired session returns to sign-in. */
export function DashboardLayout() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const identity = useQuery({ queryKey: ["identity"], queryFn: api.me });
  useEffect(() => { document.title = "Dashboard | Hybrid Tutors"; }, []);
  if (identity.error instanceof ApiFailure && identity.error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (identity.error) return <p role="alert">Could not load your account.</p>;
  if (!identity.data) return <p role="status">Loading your account…</p>;
  const { profile, email } = identity.data.identity;
  const signOut = async () => {
    try { await api.signOut(); client.clear(); navigate("/sign-in"); } catch { window.alert("Could not sign out. Please try again."); }
  };
  return <div className="flex min-h-screen">
    <DashboardSidebar role={profile.role} fullName={profile.full_name} email={email} signOut={signOut}/>
    <div className="flex min-w-0 flex-1 flex-col"><DashboardTopbar role={profile.role}/><main className="flex-1 bg-background p-5 md:p-8"><Outlet/></main></div>
  </div>;
}

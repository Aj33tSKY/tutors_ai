"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { LayoutDashboard, Users, MessageCircle, Clock, Landmark, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/marketing/wordmark";
import type { UserRole } from "@/lib/types";
import { signOutAction } from "@/app/(auth)/actions";

/** Remembered across visits, same key the sidebar reads and writes. */
const COLLAPSE_STORAGE_KEY = "dashboard-sidebar-collapsed";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

/**
 * One entry per route. Earlier revisions listed "Children"/"Students"/
 * "Verification queue" pointing back at the role's own overview URL, which
 * lit two items as current at once — those sections live on the overview page.
 */
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  student: [
    { href: "/dashboard/student", label: "Overview", icon: LayoutDashboard },
    { href: "/dashboard/student/tutors", label: "My tutors", icon: Users },
    { href: "/dashboard/student/chat", label: "Revision AI", icon: MessageCircle },
  ],
  parent: [{ href: "/dashboard/parent", label: "Overview", icon: LayoutDashboard }],
  tutor: [
    { href: "/dashboard/tutor", label: "Overview", icon: LayoutDashboard },
    { href: "/dashboard/tutor/students", label: "My students", icon: Users },
    { href: "/dashboard/tutor/availability", label: "Availability", icon: Clock },
    { href: "/dashboard/tutor/payouts", label: "Payouts", icon: Landmark },
  ],
  admin: [{ href: "/dashboard/admin", label: "Overview", icon: LayoutDashboard }],
};

export function DashboardNav({
  role,
  onNavigate,
  collapsed = false,
}: {
  role: UserRole;
  onNavigate?: () => void;
  /** Icon-only rail. Only the desktop sidebar offers this — the mobile sheet is always full width. */
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-1 p-3">
      {NAV_BY_ROLE[role].map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors duration-200",
              collapsed && "justify-center px-0",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground",
            )}
          >
            <item.icon className="size-[1.1rem] shrink-0" />
            <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardSidebar({
  role,
  fullName,
  email,
}: {
  role: UserRole;
  fullName: string;
  email: string;
}) {
  const initial = fullName.trim().charAt(0).toUpperCase() || "?";
  // useSyncExternalStore (not state + an effect) reads the saved preference:
  // it renders the server's snapshot (false — there's no localStorage during
  // that render) for the initial paint, then correctly reconciles against the
  // client's actual value right after hydration, with no flash and no
  // hydration-mismatch warning either one of the simpler options would have.
  const persistedCollapsed = useSyncExternalStore(
    () => () => {},
    () => window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1",
    () => false,
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? persistedCollapsed;
  function toggle() {
    const next = !collapsed;
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
    setOverride(next);
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border/70 bg-sidebar transition-[width] duration-200 lg:flex",
        collapsed ? "w-20" : "w-72",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center justify-between", collapsed ? "px-3" : "px-5")}>
        <Link href="/" aria-label="Kindling — home">
          <Wordmark compact={collapsed} />
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        <DashboardNav role={role} collapsed={collapsed} />
      </div>

      {/* Pinned to the bottom of the viewport (the aside is sticky and
          h-screen) rather than scrolling away with a tall nav list. */}
      <div className="shrink-0 p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card p-2 shadow-sm">
            <div
              title={fullName}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-saffron/15 text-sm font-semibold text-saffron"
            >
              {initial}
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Sign out"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-saffron/15 text-sm font-semibold text-saffron">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label="Sign out"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}

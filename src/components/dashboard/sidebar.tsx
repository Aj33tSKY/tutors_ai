"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, MessageCircle, Clock, Landmark, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/marketing/wordmark";
import type { UserRole } from "@/lib/types";
import { signOutAction } from "@/app/(auth)/actions";

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
}: {
  role: UserRole;
  onNavigate?: () => void;
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
            className={cn(
              "flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-colors duration-200",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground",
            )}
          >
            <item.icon className="size-[1.1rem] shrink-0" />
            {item.label}
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

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-border/70 bg-sidebar lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Kindling — home">
          <Wordmark />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        <DashboardNav role={role} />
      </div>

      <div className="p-3">
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
      </div>
    </aside>
  );
}

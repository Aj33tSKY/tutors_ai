"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CalendarDays, MessageCircle, Clock, Landmark, LogOut } from "lucide-react";
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
    { href: "/dashboard/student/bookings", label: "Bookings", icon: CalendarDays },
    { href: "/dashboard/student/chat", label: "Revision AI", icon: MessageCircle },
  ],
  parent: [{ href: "/dashboard/parent", label: "Overview", icon: LayoutDashboard }],
  tutor: [
    { href: "/dashboard/tutor", label: "Overview", icon: LayoutDashboard },
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
              "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]",
              active
                ? "bg-raised text-saffron"
                : "text-muted-foreground hover:bg-raised hover:text-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0" />
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
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-hairline bg-sidebar lg:flex">
      <div className="flex h-16 items-center border-b border-hairline px-5">
        <Link href="/" aria-label="Kindling — home">
          <Wordmark />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DashboardNav role={role} />
      </div>

      <div className="border-t border-hairline p-5">
        <p className="truncate text-sm">{fullName}</p>
        <p className="eyebrow mt-1.5 truncate">{email}</p>
        <form action={signOutAction} className="mt-5">
          <button
            type="submit"
            className="flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.1em] text-muted-foreground uppercase transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:text-saffron"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

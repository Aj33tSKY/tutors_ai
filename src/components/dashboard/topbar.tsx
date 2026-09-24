"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Wordmark } from "@/components/marketing/wordmark";
import { DashboardNav, NAV_BY_ROLE } from "./sidebar";
import type { UserRole } from "@/lib/types";

export function DashboardTopbar({ role, title }: { role: UserRole; title?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const resolvedTitle =
    title ?? NAV_BY_ROLE[role].find((i) => i.href === pathname)?.label ?? "Dashboard";

  return (
    <header className="flex h-16 items-center gap-4 border-b border-border/70 bg-background/85 px-5 backdrop-blur-md md:px-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="-ml-2 flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 border-border/70 bg-sidebar p-0">
          <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
          <div className="flex h-16 items-center px-5">
            <Link href="/" aria-label="Kindling — home">
              <Wordmark />
            </Link>
          </div>
          <DashboardNav role={role} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <h1 className="text-lg font-semibold">{resolvedTitle}</h1>
    </header>
  );
}

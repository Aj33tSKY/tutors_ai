"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Wordmark } from "@/components/marketing/wordmark";
import { DashboardNav } from "./sidebar";
import type { UserRole } from "@/lib/types";

/**
 * Every dashboard page already carries its own heading as the first thing in
 * its content — some generic ("Payouts"), some personalised ("Welcome back,
 * Yusuf") — styled the same way a page's own <h1> normally would be. This bar
 * used to repeat that as a second, chrome-level title ("Payouts" twice on
 * one screen); it's now just navigation chrome, the way Stripe's or Linear's
 * top bar is on pages that don't need a page-level search or action there.
 * The mobile menu button is still essential below the lg breakpoint, where
 * the sidebar itself is hidden.
 */
export function DashboardTopbar({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);

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
    </header>
  );
}

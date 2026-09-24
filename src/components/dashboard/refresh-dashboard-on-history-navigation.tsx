"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Browser Back/Forward can restore a cached App Router payload. Session status
 * is mutable, so refresh the dashboard payload on that history navigation.
 */
export function RefreshDashboardOnHistoryNavigation() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener("popstate", refresh);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}

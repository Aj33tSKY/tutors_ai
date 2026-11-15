"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { NavigationProvider, type AppLinkProps } from "./navigation";

function NextLink(props: AppLinkProps) { return <Link {...props}/>; }
export function NextNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const value = useMemo(() => ({ Link: NextLink, pathname: pathname ?? "/", navigate: (path: string) => router.push(path), refresh: () => router.refresh() }), [router, pathname]);
  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}

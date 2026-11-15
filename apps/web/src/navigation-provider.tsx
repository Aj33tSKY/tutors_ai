import { useMemo, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { NavigationProvider, type AppLinkProps } from "../../../src/components/navigation.js";

function RouterLink({ href, ...props }: AppLinkProps) { return <Link to={href} {...props}/>; }
export function WebNavigationProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const value = useMemo(() => ({ Link: RouterLink, pathname, navigate: (path: string) => { void navigate(path); }, refresh: () => { void client.invalidateQueries(); } }), [client, navigate, pathname]);
  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}

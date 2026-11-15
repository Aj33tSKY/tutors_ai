"use client";

import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from "react";
export type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };
export type AppNavigation = { Link: ComponentType<AppLinkProps>; pathname: string; navigate(path: string): void; refresh(): void };
function NativeLink(props: AppLinkProps) { return <a {...props}/>; }
const Navigation = createContext<AppNavigation>({ Link: NativeLink, pathname: "/", navigate: (path) => window.location.assign(path), refresh: () => window.location.reload() });
export function NavigationProvider({ value, children }: { value: AppNavigation; children: ReactNode }) { return <Navigation.Provider value={value}>{children}</Navigation.Provider>; }
export function useAppNavigation() { return useContext(Navigation); }
export function AppLink(props: AppLinkProps) { const Component = useAppNavigation().Link; return <Component {...props}/>; }

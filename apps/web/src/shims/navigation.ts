import { useAppNavigation } from "../../../../src/components/navigation.js";

/** The subset of `next/navigation` the shared components use. */
export function usePathname() { return useAppNavigation().pathname; }
export function useRouter() { const navigation = useAppNavigation(); return { push: navigation.navigate, replace: navigation.navigate, refresh: navigation.refresh }; }

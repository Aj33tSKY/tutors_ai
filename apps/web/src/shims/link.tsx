import type { AnchorHTMLAttributes } from "react";
import { AppLink } from "../../../../src/components/navigation.js";

/** Stands in for `next/link` in the Vite build so shared marketing components need no changes. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `prefetch` is a Next-only prop and must not reach the DOM.
export default function Link({ href, prefetch, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; prefetch?: boolean }) {
  return <AppLink href={href} {...props}/>;
}

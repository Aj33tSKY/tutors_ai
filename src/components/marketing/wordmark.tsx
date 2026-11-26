import { useId } from "react";

/**
 * The Hybridtutors mark. Three identical slabs make the H: two stems and a crossbar that is the same slab turned on its side.
 * The crossbar is violet (the complement of the green) and see-through; where it passes over a stem the colour deepens, and that overlap is bounded by a curve running from
 * the band's lower edge at the stem's left to its upper edge at the stem's right. The geometry is generated, so keep
 * public/favicon.svg and public/logo.svg (same shapes) in step if you change it.
 */
const SLAB = "M0 0L10.00 2.10Q16.0 3.36 16.0 11.36V48.6L6.00 46.50Q0 45.24 0 37.24Z";
const LENS = ["M11.90 23.00H27.90A16.0 22.56 0 0 1 11.90 45.56Z", "M36.10 17.64H52.10A16.0 22.56 0 0 1 36.10 40.20Z"] as const;
const UNDER = ["M10.90 36.28L28.90 32.29V70H10.90Z", "M35.10 30.91L53.10 26.92V70H35.10Z"] as const;
const STEMS = ["translate(11.9 4)", "translate(36.1 10.6)"] as const;
const BAND = "translate(32.0 31.60) rotate(77.5) scale(1.16) translate(-8.0 -24.3)";
const COLORS = { upper: "#58CC02", lower: "#34B857", band: "#9A8BFF", deep: "#2E1F73" };

export function LogoMark({ className = "size-8" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="none">
      <defs>
        <clipPath id={`all-${id}`}>{STEMS.map((t) => <path key={t} d={SLAB} transform={t} />)}</clipPath>
        <clipPath id={`lens-${id}`}>{LENS.map((d) => <path key={d} d={d} />)}</clipPath>
        {STEMS.map((t, i) => <clipPath key={t} id={`stem${i}-${id}`}><path d={SLAB} transform={t} /></clipPath>)}
      </defs>
      {STEMS.map((t, i) => (
        <g key={t}>
          <path d={SLAB} transform={t} fill={COLORS.upper} />
          <g clipPath={`url(#stem${i}-${id})`}><path d={UNDER[i]} fill={COLORS.lower} /></g>
        </g>
      ))}
      <g transform={BAND}><path d={SLAB} fill={COLORS.band} /></g>
      <g clipPath={`url(#all-${id})`}><g clipPath={`url(#lens-${id})`}><g transform={BAND}><path d={SLAB} fill={COLORS.deep} /></g></g></g>
    </svg>
  );
}

/** Mark plus name. The collapsed sidebar keeps just the mark: the name does not fit a 4.5rem rail. */
export function Wordmark({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="size-9 shrink-0" />
      {!compact && (
        <span className="font-heading text-[1.25rem] leading-none tracking-[-0.025em]">
          <span className="font-semibold">Hybrid</span><span className="font-normal">tutors</span>
        </span>
      )}
    </span>
  );
}

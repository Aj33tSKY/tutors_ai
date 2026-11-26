import { useId } from "react";

/**
 * The Hybrid Tutors mark: an "H" of two offset stems crossed by a translucent band, so two things (in-person warmth and online
 * reach) overlap into something new, and the overlap is where the colour deepens. Colours are fixed: the mark reads on light and dark.
 * Keep public/favicon.svg and public/logo.svg in step with these shapes.
 */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const left = "M9 4h8a10 10 0 0 1 10 10v38h-8A10 10 0 0 1 9 42z";
  const right = "M37 12h8a10 10 0 0 1 10 10v38h-8a10 10 0 0 1-10-10z";
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="none">
      <defs><clipPath id={`stems-${id}`}><path d={left} /><path d={right} /></clipPath></defs>
      <path d={left} fill="#58CC02" />
      <path d={right} fill="#3FA700" />
      <g transform="rotate(-10 32 34)"><rect x="3" y="28" width="58" height="12" rx="6" fill="#3DD6B0" fillOpacity=".93" /></g>
      <g clipPath={`url(#stems-${id})`}><g transform="rotate(-10 32 34)"><rect x="3" y="28" width="58" height="12" rx="6" fill="#0F5132" /></g></g>
    </svg>
  );
}

/** Mark plus name. The collapsed sidebar keeps just the mark: the name does not fit a 4.5rem rail. */
export function Wordmark({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="size-8 shrink-0" />
      {!compact && (
        <span className="font-heading text-[1.25rem] leading-none tracking-[-0.025em]">
          <span className="font-semibold">Hybrid</span> <span className="font-normal">Tutors</span>
        </span>
      )}
    </span>
  );
}

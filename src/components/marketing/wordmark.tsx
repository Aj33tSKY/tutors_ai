/**
 * Wordmark. The mark is a struck match — "kindling" — drawn as a hairline
 * so it sits in the same weight class as the rest of the chrome.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 16 20" className="size-4 shrink-0" aria-hidden fill="none">
        <path
          d="M8 1c0 3.2-4.5 4.4-4.5 9a4.5 4.5 0 0 0 9 0c0-2.2-1.6-3.6-2.6-5.4"
          stroke="var(--saffron)"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M8 19v-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
      <span className="font-heading text-[1.35rem] leading-none tracking-[-0.03em]">
        Kindling
      </span>
    </span>
  );
}

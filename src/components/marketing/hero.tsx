import Link from "next/link";
import { Button } from "@/components/ui/button";

const SUBJECTS = ["Physics", "Chemistry", "Mathematics", "Biology", "Computing"] as const;

// The in-flow sizer below reserves space for the longest entry, so the
// rotating slot never has to guess a `ch` width.
const WIDEST = SUBJECTS.reduce((a, b) => (b.length > a.length ? b : a));

const STATS = [
  { value: "6", label: "A-Level STEM subjects" },
  { value: "6", label: "Exam board options" },
  { value: "1:1", label: "Live online lessons" },
  { value: "90 days", label: "Recording retention" },
];

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="grain absolute inset-0 -z-10" />

      <div className="shell pt-16 pb-[var(--section-y)] sm:pt-24">
        <h1 className="display-xl max-w-[13ch]">
          Tutoring that{" "}
          <span className="text-brand-strong">remembers</span> every lesson.
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          A-Level STEM · AQA / Edexcel / OCR / WJEC / CIE
        </p>

        <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_auto] lg:items-start lg:gap-16">
          <div className="min-w-0 max-w-xl">
            {/* The rotating slot ends its own line on purpose: it reserves the
                width of the longest subject, and any slack is invisible at a
                line end rather than showing as a gap mid-sentence. */}
            <p className="font-heading text-2xl leading-[1.25] sm:text-3xl">
              Book vetted A-Level tutors for
              <br />
              <RotatingSubject />
            </p>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Review lesson recordings and notes, then practise with a revision assistant
              that can use your session transcripts.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/tutors">Find your tutor</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-up?role=tutor">Become a tutor</Link>
              </Button>
            </div>
          </div>

          <SessionPanel />
        </div>
      </div>

      {/* Stat rail — soft cards on a tinted strip. */}
      <div className="border-y border-border/70 bg-secondary/60">
        <div className="shell">
          <dl className="grid grid-cols-2 gap-4 py-10 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-2xl bg-card p-5 shadow-sm">
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <span className="display-md block text-brand-strong">{s.value}</span>
                  <span className="eyebrow mt-2 block">{s.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/**
 * Rotating subject word.
 *
 * Two things keep it from clipping or drifting off the baseline:
 *  1. An in-flow, invisible copy of the longest subject sets the width, so no
 *     word is ever cut off horizontally.
 *  2. That same copy — not an `overflow-hidden` box — is what the surrounding
 *     line takes its baseline from. The clipping layer is absolutely
 *     positioned on top, so it can't pull the baseline to its bottom edge.
 */
function RotatingSubject() {
  return (
    <span className="relative inline-block leading-[1.25] whitespace-nowrap text-brand-strong">
      <span className="sr-only">
        maths, further maths, physics, chemistry, biology and computing
      </span>

      {/* width + baseline source */}
      <span aria-hidden className="invisible">
        {WIDEST}
      </span>

      <span aria-hidden className="absolute inset-0 overflow-hidden">
        {SUBJECTS.map((word, i) => (
          <span
            key={word}
            className="hero-subject absolute inset-x-0 top-0"
            style={{ animationDelay: `${i * 3.6}s` }}
          >
            {word}
          </span>
        ))}
      </span>
    </span>
  );
}

function SessionPanel() {
  return (
    <div className="w-full min-w-0 max-w-md overflow-hidden rounded-3xl border border-border/70 bg-card shadow-lg lg:w-[26rem]">
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <span className="eyebrow flex items-center gap-2 text-foreground">
          <span className="size-1.5 rounded-full bg-saffron" />
          Example lesson · Physics
        </span>
        <span className="font-mono text-xs text-muted-foreground">Lesson review</span>
      </div>

      <div className="space-y-4 px-5 py-5">
        <TranscriptLine speaker="Tutor" text="So for the particle accelerator question…" />
        <TranscriptLine speaker="Student" text="Is that the same as the centripetal force equation?" />
        <TranscriptLine speaker="Tutor" text="Exactly — let's derive it together." />
      </div>

      <div className="border-t border-border/70 bg-secondary/50 px-5 py-5">
        <p className="font-heading text-lg font-semibold">Particle accelerators</p>
        <p className="mt-1 text-sm text-muted-foreground">After a lesson, return to its recording, transcript and notes.</p>
      </div>
    </div>
  );
}

function TranscriptLine({ speaker, text }: { speaker: "Tutor" | "Student"; text: string }) {
  return (
    <p className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
      <span
        className={`eyebrow pt-1 ${speaker === "Tutor" ? "text-brand-strong" : "text-violet"}`}
      >
        {speaker}
      </span>
      <span className="leading-relaxed text-muted-foreground">{text}</span>
    </p>
  );
}

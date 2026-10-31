import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LessonSignal } from "./lesson-signal";

const SUBJECTS = ["Physics", "Chemistry", "Mathematics", "Biology", "Computing"] as const;
const WIDEST = SUBJECTS.reduce((a, b) => (b.length > a.length ? b : a));

const STATS = [
  { value: "6", label: "A-Level STEM subjects" },
  { value: "6", label: "Exam board options" },
  { value: "1:1", label: "Live online lessons" },
  { value: "90 days", label: "Recording retention" },
];

export function Hero() {
  return (
    <>
      <section className="marketing-hero relative isolate overflow-hidden bg-[#070b12] text-white">
        <div className="shell relative z-10 grid min-h-[680px] items-center gap-8 py-16 sm:py-20 lg:min-h-[740px] lg:grid-cols-[0.9fr_1.1fr] lg:gap-4">
          <div className="relative z-10 min-w-0 max-w-xl">
            <p className="eyebrow mb-6 flex items-center gap-2 text-white/55">
              <span className="fluid-hero__signal-dot" />
              A-Level STEM · tutoring that remembers
            </p>
            <h1 className="display-xl max-w-[12ch] text-white">
              Tutoring that <span className="hero-brand-word">remembers</span> every lesson.
            </h1>
            <p className="mt-4 text-sm text-white/55">AQA / Edexcel / OCR / WJEC / CIE</p>

            <p className="mt-12 font-heading text-2xl leading-[1.25] text-white sm:text-3xl">
              Book vetted A-Level tutors for
              <br />
              <RotatingSubject />
            </p>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/65">
              Review lesson recordings and notes, then practise with a revision assistant
              that can use your session transcripts.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/tutors">Find your tutor</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/35 text-white hover:border-white hover:bg-white hover:text-ink"
              >
                <Link href="/sign-up?role=tutor">Become a tutor</Link>
              </Button>
            </div>
          </div>

          <LessonSignal />
        </div>
      </section>

      <div className="hero-stats border-y border-white/10 bg-[#0d1720] text-white">
        <div className="shell">
          <dl className="grid grid-cols-2 gap-3 py-6 sm:gap-4 sm:py-8 lg:grid-cols-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="hero-stat border-l border-white/15 py-2 pl-4 sm:pl-6">
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="display-md block text-[#c4f17a]">{stat.value}</span>
                  <span className="eyebrow mt-2 block text-white/60">{stat.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </>
  );
}

function RotatingSubject() {
  return (
    <span className="relative inline-block leading-[1.25] whitespace-nowrap text-[#c4f17a]">
      <span className="sr-only">
        maths, further maths, physics, chemistry, biology and computing
      </span>
      <span aria-hidden className="invisible">{WIDEST}</span>
      <span aria-hidden className="absolute inset-0 overflow-hidden">
        {SUBJECTS.map((word, index) => (
          <span
            key={word}
            className="hero-subject absolute inset-x-0 top-0"
            style={{ animationDelay: `${index * 3.6}s` }}
          >
            {word}
          </span>
        ))}
      </span>
    </span>
  );
}

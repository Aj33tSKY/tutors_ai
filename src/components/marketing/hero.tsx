"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";

const SUBJECTS = ["Physics", "Chemistry", "Mathematics", "Biology", "Computing"] as const;

// The in-flow sizer below reserves space for the longest entry, so the
// rotating slot never has to guess a `ch` width.
const WIDEST = SUBJECTS.reduce((a, b) => (b.length > a.length ? b : a));

const HOLD = 3.6;
const CYCLE = HOLD * SUBJECTS.length;

const STATS = [
  { value: "6", label: "A-Level STEM subjects" },
  { value: "5", label: "Exam boards covered" },
  { value: "100%", label: "DBS-verified tutors" },
  { value: "24/7", label: "Grounded revision AI" },
];

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-hairline">
      <div aria-hidden className="grain absolute inset-0 -z-10" />

      <div className="shell pt-28 pb-[var(--section-y)] sm:pt-36">
        <p className="eyebrow">A-Level STEM · AQA / Edexcel / OCR / CIE</p>

        <h1 className="display-xl mt-10 max-w-[13ch]">
          Tutoring that{" "}
          <span className="text-saffron">remembers</span> every lesson.
        </h1>

        <div className="mt-16 grid grid-cols-1 gap-14 lg:grid-cols-[1fr_auto] lg:items-start lg:gap-20">
          <div className="min-w-0 max-w-xl">
            {/* The rotating slot ends its own line on purpose: it reserves the
                width of the longest subject, and any slack is invisible at a
                line end rather than showing as a gap mid-sentence. */}
            <p className="font-heading text-3xl leading-[1.15] sm:text-4xl">
              Book vetted A-Level tutors for
              <br />
              <RotatingSubject />
            </p>
            <p className="mt-7 text-lg leading-relaxed text-muted-foreground">
              Every live session is transcribed, mapped to your exam spec, and turned into a
              revision AI grounded in your own tutor&apos;s words.
            </p>

            <div className="mt-12 flex flex-wrap items-center gap-3">
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

      {/* Stat rail — hairline-divided, mono labels, no cards. */}
      <div className="shell">
        <dl className="grid grid-cols-2 border-t border-hairline lg:grid-cols-4">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={`border-hairline py-8 pr-6 ${i % 2 === 1 ? "border-l pl-6" : ""} ${
                i < 2 ? "border-b lg:border-b-0" : ""
              } lg:border-l lg:pl-6 lg:first:border-l-0 lg:first:pl-0`}
            >
              <dt className="sr-only">{s.label}</dt>
              <dd>
                <span className="display-md block text-saffron">{s.value}</span>
                <span className="eyebrow mt-3 block">{s.label}</span>
              </dd>
            </div>
          ))}
        </dl>
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
  const reduceMotion = useReducedMotion();

  return (
    <span className="relative inline-block leading-[1.25] whitespace-nowrap text-saffron">
      <span className="sr-only">
        maths, further maths, physics, chemistry, biology and computing
      </span>

      {/* width + baseline source */}
      <span aria-hidden className="invisible">
        {WIDEST}
      </span>

      {/* Every subject is always rendered, in the same order, whatever the
          motion preference: only `animate` and `transition` may branch, or
          the server and client markup diverge and hydration fails. */}
      <span aria-hidden className="absolute inset-0 overflow-hidden">
        {SUBJECTS.map((word, i) => (
          <motion.span
            key={word}
            className="absolute inset-x-0 top-0"
            initial={{ y: "100%" }}
            animate={
              reduceMotion
                ? { y: "0%", opacity: i === 0 ? 1 : 0 }
                : { y: ["100%", "0%", "0%", "-100%"] }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: HOLD,
                    times: [0, 0.18, 0.82, 1],
                    ease: [0.19, 1, 0.22, 1],
                    repeat: Infinity,
                    repeatDelay: CYCLE - HOLD,
                    delay: i * HOLD,
                  }
            }
          >
            {word}
          </motion.span>
        ))}
      </span>
    </span>
  );
}

function SessionPanel() {
  return (
    <div className="w-full min-w-0 max-w-md border border-hairline bg-raised lg:w-[26rem]">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <span className="eyebrow flex items-center gap-2 text-foreground">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-saffron opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-saffron" />
          </span>
          Live · Physics
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">34:12</span>
      </div>

      <div className="space-y-4 px-5 py-5">
        <TranscriptLine speaker="Tutor" text="So for the particle accelerator question…" />
        <TranscriptLine speaker="Student" text="Is that the same as the centripetal force equation?" />
        <TranscriptLine speaker="Tutor" text="Exactly — let's derive it together." />
      </div>

      <div className="border-t border-hairline px-5 py-5">
        <p className="eyebrow">Auto-detected spec point</p>
        <p className="mt-3 font-heading text-lg">Edexcel Physics 4.2 — Particle Accelerators</p>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-hairline">
            <motion.div
              className="h-px bg-saffron"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 0.72 }}
              viewport={{ once: true }}
              style={{ transformOrigin: "left" }}
              transition={{ duration: 1.1, delay: 0.3, ease: [0.19, 1, 0.22, 1] }}
            />
          </div>
          <span className="font-mono text-xs text-saffron tabular-nums">72%</span>
        </div>
      </div>
    </div>
  );
}

function TranscriptLine({ speaker, text }: { speaker: "Tutor" | "Student"; text: string }) {
  return (
    <p className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm">
      <span
        className={`eyebrow pt-1 ${speaker === "Tutor" ? "text-saffron" : "text-violet"}`}
      >
        {speaker}
      </span>
      <span className="leading-relaxed text-muted-foreground">{text}</span>
    </p>
  );
}

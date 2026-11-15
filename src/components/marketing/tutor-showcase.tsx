import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { subjectLabel } from "@/lib/subjects";
import type { PublicTutor } from "../../../packages/contracts/src/tutors";
import { Reveal } from "./reveal";

/** Presentational: the host supplies the featured tutors (Next server query, or the public API). */
export function TutorShowcase({ tutors }: { tutors: PublicTutor[] }) {
  if (tutors.length === 0) return null;

  return (
    <section className="landing-tutors landing-shell">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="landing-kicker">The people behind the progress</p>
            <h2 className="landing-tutors__title">Your subject.<br />Their thing.</h2>
          </div>
          <Link
            href="/tutors"
            className="landing-text-link"
          >
            Browse all tutors
            <ArrowUpRight className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </Reveal>

      {/* gap-px over a border background draws the grid rules for free */}
      <ul className="landing-tutors__grid">
        {tutors.map((tutor, i) => {
          const subjects = tutor.subjects;
          return (
            <Reveal as="li" key={tutor.id} delay={(i % 3) * 0.08} className="landing-tutors__card">
              <Link
                href={`/tutors/${tutor.id}`}
                className="group flex h-full flex-col p-7 transition-colors duration-300 hover:bg-secondary/50"
              >
                <div className="flex items-start justify-between gap-4">
                  {tutor.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tutor.avatarUrl} alt="" className="size-20 rounded-xl object-cover" />
                  ) : <span aria-hidden className="flex size-20 items-center justify-center rounded-xl bg-secondary text-2xl font-semibold">{tutor.fullName.charAt(0) || "T"}</span>}
                  <ArrowUpRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-all duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:text-brand-strong md:group-hover:translate-x-1 md:group-hover:-translate-y-1" />
                </div>
                <h3 className="display-md mt-4 text-balance">{tutor.fullName}</h3>

                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {tutor.headline}
                </p>

                <p className="mt-5 mb-8 text-xs text-muted-foreground">
                  {subjects.map(subjectLabel).join(" · ")}
                </p>

                {/* mt-auto pins the price rail to the card's bottom edge so the
                    row lines up even when names wrap to two lines */}
                <div className="mt-auto flex items-baseline justify-between border-t border-border/70 pt-5">
                  <span className="eyebrow">
                    Approved tutor
                  </span>
                  <span className="font-heading text-2xl text-brand-strong tabular-nums">
                    £{(tutor.hourlyRatePence / 100).toFixed(0)}
                    <span className="font-mono text-xs text-muted-foreground">/hr</span>
                  </span>
                </div>
              </Link>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}

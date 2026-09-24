import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { subjectLabel } from "@/lib/subjects";
import { Reveal } from "./reveal";
import type { Profile, StemSubject, TutorProfile } from "@/lib/types";

type TutorRow = TutorProfile & { profiles: Profile | Profile[] };

export async function TutorShowcase() {
  const supabase = await createClient();
  const { data: tutors } = await supabase
    .from("tutor_profiles")
    .select("*, profiles!tutor_profiles_id_fkey(full_name, avatar_url)")
    .order("rating", { ascending: false })
    .limit(6)
    .returns<TutorRow[]>();

  if (!tutors || tutors.length === 0) return null;

  return (
    <section className="section shell">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <h2 className="display-lg max-w-[13ch]">
              Vetted specialists,
              <br />
              not generalists
            </h2>
          </div>
          <Link
            href="/tutors"
            className="link-draw group flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.1em] text-saffron uppercase"
          >
            Browse all tutors
            <ArrowUpRight className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </Reveal>

      {/* gap-px over a border background draws the grid rules for free */}
      <ul className="mt-20 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        {tutors.map((tutor, i) => {
          const p = Array.isArray(tutor.profiles) ? tutor.profiles[0] : tutor.profiles;
          const subjects = tutor.subjects as StemSubject[];
          return (
            <Reveal as="li" key={tutor.id} delay={(i % 3) * 0.08} className="bg-card">
              <Link
                href={`/tutors/${tutor.id}`}
                className="group flex h-full flex-col p-7 transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-secondary/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="display-md text-balance">{p?.full_name}</h3>
                  <ArrowUpRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-all duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:text-saffron md:group-hover:translate-x-1 md:group-hover:-translate-y-1" />
                </div>

                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {tutor.headline}
                </p>

                <p className="mt-6 mb-8 font-mono text-[0.6875rem] tracking-[0.08em] text-foreground/60 uppercase">
                  {subjects.map(subjectLabel).join(" · ")}
                </p>

                {/* mt-auto pins the price rail to the card's bottom edge so the
                    row lines up even when names wrap to two lines */}
                <div className="mt-auto flex items-baseline justify-between border-t border-border/70 pt-5">
                  <span className="eyebrow">
                    {tutor.dbs_verified ? "DBS verified" : "Verification pending"}
                  </span>
                  <span className="font-heading text-2xl text-saffron tabular-nums">
                    £{(tutor.hourly_rate / 100).toFixed(0)}
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

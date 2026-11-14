import Link from "next/link";
import { unstable_cache } from "next/cache";
import { ArrowUpRight } from "lucide-react";
import { createPublicClient } from "@/lib/supabase/public";
import { subjectLabel } from "@/lib/subjects";
import { Reveal } from "./reveal";
import type { Profile, StemSubject, TutorProfile } from "@/lib/types";

type TutorRow = TutorProfile & { profiles: Profile | Profile[] };

const getFeaturedTutors = unstable_cache(async () => {
  const supabase = createPublicClient();
  const { data: tutors, error } = await supabase
    .from("tutor_profiles")
    .select("*, profiles!tutor_profiles_id_fkey(full_name, avatar_url)")
    .eq("dbs_verified", true)
    .eq("is_demo", false)
    .order("hourly_rate", { ascending: true })
    .limit(6)
    .returns<TutorRow[]>();
  if (error) throw new Error("Could not load featured tutors");
  return tutors ?? [];
}, ["featured-tutors"], { revalidate: 300, tags: ["tutor-catalogue"] });

export async function TutorShowcase() {
  let tutors: TutorRow[] | null;
  try {
    tutors = await getFeaturedTutors();
  } catch {
    // A catalogue outage must not take the landing page down with it.
    return null;
  }

  if (!tutors || tutors.length === 0) return null;

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
          const p = Array.isArray(tutor.profiles) ? tutor.profiles[0] : tutor.profiles;
          const subjects = tutor.subjects as StemSubject[];
          return (
            <Reveal as="li" key={tutor.id} delay={(i % 3) * 0.08} className="landing-tutors__card">
              <Link
                href={`/tutors/${tutor.id}`}
                className="group flex h-full flex-col p-7 transition-colors duration-300 hover:bg-secondary/50"
              >
                <div className="flex items-start justify-between gap-4">
                  {p?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar_url} alt="" className="size-20 rounded-xl object-cover" />
                  ) : <span aria-hidden className="flex size-20 items-center justify-center rounded-xl bg-secondary text-2xl font-semibold">{p?.full_name?.charAt(0) ?? "T"}</span>}
                  <ArrowUpRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-all duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:text-brand-strong md:group-hover:translate-x-1 md:group-hover:-translate-y-1" />
                </div>
                <h3 className="display-md mt-4 text-balance">{p?.full_name}</h3>

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

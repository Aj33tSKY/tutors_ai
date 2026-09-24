import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { boardLabel, subjectLabel, SUBJECTS, EXAM_BOARDS } from "@/lib/subjects";
import { cn } from "@/lib/utils";
import type { ExamBoard, Profile, StemSubject, TutorProfile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find a tutor" };

type TutorRow = TutorProfile & { profiles: Profile | Profile[] };

/** Builds a filter href without dropping the other active filter. */
function filterHref(next: { subject?: string; board?: string }) {
  const q = new URLSearchParams();
  if (next.subject) q.set("subject", next.subject);
  if (next.board) q.set("board", next.board);
  const s = q.toString();
  return s ? `/tutors?${s}` : "/tutors";
}

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; board?: string }>;
}) {
  const { subject, board } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("tutor_profiles")
    .select("*, profiles!tutor_profiles_id_fkey(full_name, avatar_url)")
    .order("rating", { ascending: false });

  if (subject) query = query.contains("subjects", [subject]);
  if (board) query = query.contains("boards", [board]);

  const { data: tutors } = await query.returns<TutorRow[]>();
  const count = tutors?.length ?? 0;

  return (
    <div className="shell py-20">
      <h1 className="display-lg max-w-[13ch]">
        Find your <span className="whitespace-nowrap">A-Level</span> tutor
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {count} {count === 1 ? "tutor" : "tutors"} available
      </p>

      <div className="mt-20 grid grid-cols-1 gap-12 lg:grid-cols-[13rem_1fr] lg:gap-16">
        <aside className="space-y-10 lg:sticky lg:top-24 lg:self-start">
          <FilterGroup label="Subject">
            <FilterLink label="All subjects" active={!subject} href={filterHref({ board })} />
            {SUBJECTS.map((s) => (
              <FilterLink
                key={s.value}
                label={s.label}
                active={subject === s.value}
                href={filterHref({ subject: s.value, board })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Exam board">
            <FilterLink label="All boards" active={!board} href={filterHref({ subject })} />
            {EXAM_BOARDS.map((b) => (
              <FilterLink
                key={b.value}
                label={b.label}
                active={board === b.value}
                href={filterHref({ subject, board: b.value })}
              />
            ))}
          </FilterGroup>
        </aside>

        {count === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12">
            <h2 className="display-md">No tutors match those filters</h2>
            <p className="mt-4 text-muted-foreground">
              Try widening your search — or{" "}
              <Link href="/tutors" className="link-draw text-saffron">
                clear all filters
              </Link>
              .
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm sm:grid-cols-2">
            {tutors!.map((t) => {
              const p = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
              return (
                <li key={t.id} className="bg-card">
                  <Link
                    href={`/tutors/${t.id}`}
                    className="flex h-full flex-col p-7 transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-secondary/50"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="display-md">{p?.full_name}</h2>
                      <span className="font-mono text-sm text-saffron tabular-nums">
                        ★ {t.rating}
                      </span>
                    </div>

                    <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {t.bio}
                    </p>

                    <dl className="mt-6 space-y-2 font-mono text-[0.6875rem] tracking-[0.08em] uppercase">
                      <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">Subjects</dt>
                        <dd className="text-foreground/70">
                          {(t.subjects as StemSubject[]).map(subjectLabel).join(" · ")}
                        </dd>
                      </div>
                      <div className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">Boards</dt>
                        <dd className="text-foreground/70">{(t.boards as ExamBoard[]).map(boardLabel).join(" · ")}</dd>
                      </div>
                    </dl>

                    {/* mt-auto pins this rail to the bottom of every card so the
                        grid rows line up regardless of bio length */}
                    <div className="mt-auto flex items-baseline justify-between border-t border-hairline pt-5">
                      <span className="eyebrow">
                        {t.dbs_verified ? "DBS verified" : "Verification pending"}
                      </span>
                      <span className="font-heading text-2xl text-saffron tabular-nums">
                        £{(t.hourly_rate / 100).toFixed(0)}
                        <span className="font-mono text-xs text-muted-foreground">/hr</span>
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="eyebrow">{label}</h2>
      <div className="mt-5 flex flex-col items-start gap-3">{children}</div>
    </div>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "text-sm transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]",
        active
          ? "text-saffron"
          : "link-draw text-muted-foreground hover:text-foreground",
      )}
    >
      {active && <span aria-hidden className="mr-2 text-saffron">—</span>}
      {label}
    </Link>
  );
}

import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { boardLabel, subjectLabel, SUBJECTS, EXAM_BOARDS } from "@/lib/subjects";
import { cn } from "@/lib/utils";
import type { Availability, ExamBoard, Profile, StemSubject, TutorProfile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find a tutor" };

type TutorRow = TutorProfile & { profiles: Profile | Profile[] };
type TutorCatalogue = { tutors: TutorRow[]; availableDays: Record<string, number[]> };

const getTutors = unstable_cache(async (): Promise<TutorCatalogue> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("tutor_profiles")
    .select("*, profiles!tutor_profiles_id_fkey(full_name, avatar_url)")
    .eq("dbs_verified", true)
    .eq("is_demo", false)
    .order("hourly_rate", { ascending: true })
    .returns<TutorRow[]>();
  if (error) throw new Error("Could not load tutors");
  const tutors = data ?? [];
  const ids = tutors.map((tutor) => tutor.id);
  const { data: slots, error: slotsError } = ids.length
    ? await supabase.from("availability").select("tutor_id, day_of_week").in("tutor_id", ids).returns<Pick<Availability, "tutor_id" | "day_of_week">[]>()
    : { data: [], error: null };
  if (slotsError) throw new Error("Could not load tutor availability");
  const availableDays: Record<string, number[]> = {};
  for (const slot of slots ?? []) {
    availableDays[slot.tutor_id] ??= [];
    if (!availableDays[slot.tutor_id].includes(slot.day_of_week)) availableDays[slot.tutor_id].push(slot.day_of_week);
  }
  return { tutors, availableDays };
}, ["tutor-catalogue"], { revalidate: 300, tags: ["tutor-catalogue"] });

/** Builds a filter href without dropping the other active filter. */
function filterHref(next: { subject?: string; board?: string; maxPrice?: string; day?: string }) {
  const q = new URLSearchParams();
  if (next.subject) q.set("subject", next.subject);
  if (next.board) q.set("board", next.board);
  if (next.maxPrice) q.set("maxPrice", next.maxPrice);
  if (next.day) q.set("day", next.day);
  const s = q.toString();
  return s ? `/tutors?${s}` : "/tutors";
}

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; board?: string; maxPrice?: string; day?: string }>;
}) {
  const { subject, board, maxPrice, day } = await searchParams;
  const { tutors, availableDays } = await getTutors();
  const priceLimit = maxPrice && [35, 45, 60].includes(Number(maxPrice)) ? Number(maxPrice) : null;
  const weekday = day && /^[0-6]$/.test(day) ? Number(day) : null;
  const filtered = tutors.filter((tutor) =>
    (!subject || tutor.subjects.includes(subject as StemSubject)) &&
    (!board || tutor.boards.includes(board as ExamBoard)) &&
    (!priceLimit || tutor.hourly_rate <= priceLimit * 100) &&
    (weekday === null || (availableDays[tutor.id] ?? []).includes(weekday)),
  );
  const count = filtered.length;

  return (
    <div className="shell py-12 md:py-16">
      <h1 className="display-lg max-w-[13ch]">
        Find your <span className="whitespace-nowrap">A-Level</span> tutor
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {count} {count === 1 ? "tutor" : "tutors"} available
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 md:mt-12 lg:grid-cols-[13rem_1fr] lg:gap-12">
        <details className="rounded-2xl border border-border bg-card p-4 lg:hidden">
          <summary className="cursor-pointer font-medium">Filters {subject || board || maxPrice || day ? "· Active" : ""}</summary>
          <div className="mt-6"><Filters subject={subject} board={board} maxPrice={maxPrice} day={day} /></div>
        </details>
        <aside className="hidden space-y-8 lg:sticky lg:top-24 lg:block lg:self-start">
          <Filters subject={subject} board={board} maxPrice={maxPrice} day={day} />
        </aside>

        {count === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12">
            <h2 className="display-md">{tutors.length === 0 ? "More specialists are coming" : "No tutors match those filters"}</h2>
            <p className="mt-4 text-muted-foreground">
              {tutors.length === 0 ? "We're onboarding approved specialists. Check back soon." : "Try widening your search — or "}
              {tutors.length > 0 && (
              <Link href="/tutors" className="link-draw text-brand-strong">
                clear all filters
              </Link>
              )}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm sm:grid-cols-2">
            {filtered.map((t) => {
              const p = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
              return (
                <li key={t.id} className="bg-card">
                  <Link
                    href={`/tutors/${t.id}`}
                    className="flex h-full flex-col p-7 transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-secondary/50"
                  >
                    <div className="flex items-center gap-4">
                      {p?.avatar_url ? (
                        // Tutor-uploaded photos may use a Storage URL outside Next's image allow-list.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatar_url} alt="" className="size-14 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-semibold">{p?.full_name?.charAt(0) ?? "T"}</span>
                      )}
                      <h2 className="display-md">{p?.full_name}</h2>
                    </div>

                    <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {t.bio}
                    </p>

                    <dl className="mt-6 space-y-2 text-xs">
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
                      <span className="eyebrow">Approved tutor · {availableDays[t.id]?.length ? "Weekly slots available" : "Ask about availability"}</span>
                      <span className="font-heading text-2xl text-brand-strong tabular-nums">
                        £{(t.hourly_rate / 100).toFixed(0)}
                        <span className="font-mono text-xs text-muted-foreground">/hr</span>
                      </span>
                    </div>
                    <span className="mt-4 text-sm font-medium text-brand-strong">View profile and request a free first lesson →</span>
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

function Filters({ subject, board, maxPrice, day }: { subject?: string; board?: string; maxPrice?: string; day?: string }) {
  const current = { subject, board, maxPrice, day };
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return <div className="space-y-8">
    <FilterGroup label="Subject">
      <FilterLink label="All subjects" active={!subject} href={filterHref({ ...current, subject: undefined })} />
      {SUBJECTS.map((item) => <FilterLink key={item.value} label={item.label} active={subject === item.value} href={filterHref({ ...current, subject: item.value })} />)}
    </FilterGroup>
    <FilterGroup label="Exam board">
      <FilterLink label="All boards" active={!board} href={filterHref({ ...current, board: undefined })} />
      {EXAM_BOARDS.map((item) => <FilterLink key={item.value} label={item.label} active={board === item.value} href={filterHref({ ...current, board: item.value })} />)}
    </FilterGroup>
    <FilterGroup label="Hourly rate">
      <FilterLink label="Any rate" active={!maxPrice} href={filterHref({ ...current, maxPrice: undefined })} />
      {[35, 45, 60].map((price) => <FilterLink key={price} label={`Up to £${price}`} active={maxPrice === String(price)} href={filterHref({ ...current, maxPrice: String(price) })} />)}
    </FilterGroup>
    <FilterGroup label="Weekly availability">
      <FilterLink label="Any day" active={!day} href={filterHref({ ...current, day: undefined })} />
      {weekdays.map((label, index) => <FilterLink key={label} label={label} active={day === String(index)} href={filterHref({ ...current, day: String(index) })} />)}
    </FilterGroup>
  </div>;
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
          ? "text-brand-strong"
          : "link-draw text-muted-foreground hover:text-foreground",
      )}
    >
      {active && <span aria-hidden className="mr-2 text-brand-strong">—</span>}
      {label}
    </Link>
  );
}

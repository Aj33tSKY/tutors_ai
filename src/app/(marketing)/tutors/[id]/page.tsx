import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { boardLabel, subjectLabel } from "@/lib/subjects";
import { BookingForm } from "./booking-form";
import type { Availability, ExamBoard, Profile, StemSubject, TutorProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TutorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createPublicClient();

  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("*, profiles!tutor_profiles_id_fkey(full_name, avatar_url)")
    .eq("id", id)
    .eq("dbs_verified", true)
    .eq("is_demo", false)
    .maybeSingle<TutorProfile & { profiles: Profile | Profile[] }>();

  if (!tutor || tutor.is_demo) notFound();

  const p = Array.isArray(tutor.profiles) ? tutor.profiles[0] : tutor.profiles;
  const subjects = tutor.subjects as StemSubject[];
  const boards = tutor.boards as ExamBoard[];
  const { data: availability } = await supabase
    .from("availability")
    .select("*")
    .eq("tutor_id", tutor.id)
    .returns<Availability[]>();

  const facts = [
    { label: "Experience", value: tutor.years_experience ? `${tutor.years_experience} yrs` : "Ask tutor" },
    { label: "Status", value: "Approved" },
    { label: "Rate", value: `£${(tutor.hourly_rate / 100).toFixed(0)}/hr` },
  ];

  return (
    <div className="shell py-20">
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_22rem] lg:gap-20">
        <div>
          <div className="flex items-center gap-5">
            {p?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatar_url} alt="" className="size-20 rounded-full object-cover sm:size-28" />
            ) : <span aria-hidden className="flex size-20 items-center justify-center rounded-full bg-secondary text-3xl font-semibold sm:size-28">{p?.full_name?.charAt(0) ?? "T"}</span>}
            <h1 className="display-xl">{p?.full_name}</h1>
          </div>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {tutor.headline}
          </p>

          <dl className="mt-12 grid grid-cols-3 border-t border-hairline">
            {facts.map((f, i) => (
              <div
                key={f.label}
                className={`border-hairline py-7 pr-3 ${i > 0 ? "border-l pl-3 sm:pl-5" : ""}`}
              >
                <dt className="eyebrow">{f.label}</dt>
                <dd className="mt-3 text-lg font-semibold text-brand-strong sm:text-2xl">{f.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-16 grid gap-10 border-t border-hairline pt-10 sm:grid-cols-[8rem_1fr]">
            <h2 className="eyebrow">About</h2>
            <p className="max-w-xl leading-relaxed text-muted-foreground">{tutor.bio}</p>
          </div>

          <div className="mt-10 grid gap-10 border-t border-hairline pt-10 sm:grid-cols-[8rem_1fr]">
            <h2 className="eyebrow">Teaches</h2>
            <div className="space-y-4">
              <p className="font-heading text-xl">{subjects.map(subjectLabel).join(", ")}</p>
              <p className="font-mono text-[0.6875rem] tracking-[0.08em] text-muted-foreground uppercase">
                {boards.map(boardLabel).join(" · ")}
              </p>
            </div>
          </div>
        </div>

        <aside className="h-fit rounded-3xl border border-border/70 bg-card p-7 shadow-md lg:sticky lg:top-24">
          <h2 className="display-md">Request a lesson</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Your first lesson with this tutor is free. Later lessons are £{(tutor.hourly_rate / 100).toFixed(0)} per hour and invoiced after completion.
          </p>
          <div className="mt-7">
            <BookingForm
              tutorId={tutor.id}
              subjects={subjects}
              boards={boards}
              availability={availability ?? []}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

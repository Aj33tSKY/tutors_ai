import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();

  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("*, profiles!tutor_profiles_id_fkey(full_name, avatar_url)")
    .eq("id", id)
    .maybeSingle<TutorProfile & { profiles: Profile | Profile[] }>();

  if (!tutor) notFound();

  const p = Array.isArray(tutor.profiles) ? tutor.profiles[0] : tutor.profiles;
  const subjects = tutor.subjects as StemSubject[];
  const boards = tutor.boards as ExamBoard[];
  const { data: availability } = await supabase
    .from("availability")
    .select("*")
    .eq("tutor_id", tutor.id)
    .returns<Availability[]>();

  const facts = [
    { label: "Rating", value: String(tutor.rating) },
    { label: "Experience", value: `${tutor.years_experience ?? 0} yrs` },
    { label: "DBS", value: tutor.dbs_verified ? "Verified" : "Pending" },
    { label: "Rate", value: `£${(tutor.hourly_rate / 100).toFixed(0)}/hr` },
  ];

  return (
    <div className="shell py-20">
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_22rem] lg:gap-20">
        <div>
          <h1 className="display-xl">{p?.full_name}</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {tutor.headline}
          </p>

          <dl className="mt-16 grid grid-cols-2 border-t border-hairline sm:grid-cols-4">
            {facts.map((f, i) => (
              <div
                key={f.label}
                className={`border-hairline py-7 pr-5 ${i % 2 === 1 ? "border-l pl-5" : ""} ${
                  i < 2 ? "border-b sm:border-b-0" : ""
                } sm:border-l sm:pl-5 sm:first:border-l-0 sm:first:pl-0`}
              >
                <dt className="eyebrow">{f.label}</dt>
                <dd className="display-md mt-3 text-saffron">{f.value}</dd>
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
          <h2 className="display-md">Book a session</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Choose a subject and one of the tutor&apos;s available slots.
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

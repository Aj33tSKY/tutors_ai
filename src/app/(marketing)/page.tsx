import { Suspense } from "react";
import { Hero } from "@/components/marketing/hero";
import { SubjectsStrip } from "@/components/marketing/subjects-strip";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { FeatureShowcase } from "@/components/marketing/feature-showcase";
import { TutorShowcase } from "@/components/marketing/tutor-showcase";
import { CtaSection } from "@/components/marketing/cta-section";

// The tutor catalogue is streamed after the landing-page shell and cached.
// Keep the route request-time so CI's placeholder Supabase URL is never read
// during the build.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <>
      <Hero />
      <SubjectsStrip />
      <HowItWorks />
      <FeatureShowcase />
      <Suspense fallback={<TutorShowcaseFallback />}><TutorShowcase /></Suspense>
      <CtaSection />
    </>
  );
}

function TutorShowcaseFallback() {
  return (
    <section className="section shell" aria-hidden="true">
      <div className="h-16 w-72 max-w-full rounded-xl bg-secondary" />
      <div className="mt-20 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="min-h-80 bg-card p-7">
            <div className="h-8 w-2/3 rounded-md bg-secondary" />
            <div className="mt-6 h-4 w-full rounded bg-secondary" />
            <div className="mt-3 h-4 w-4/5 rounded bg-secondary" />
          </div>
        ))}
      </div>
    </section>
  );
}

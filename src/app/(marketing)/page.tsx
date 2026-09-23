import { Hero } from "@/components/marketing/hero";
import { SubjectsStrip } from "@/components/marketing/subjects-strip";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { FeatureShowcase } from "@/components/marketing/feature-showcase";
import { TutorShowcase } from "@/components/marketing/tutor-showcase";
import { Testimonials } from "@/components/marketing/testimonials";
import { CtaSection } from "@/components/marketing/cta-section";

export default function HomePage() {
  return (
    <>
      <Hero />
      <SubjectsStrip />
      <HowItWorks />
      <FeatureShowcase />
      <TutorShowcase />
      <Testimonials />
      <CtaSection />
    </>
  );
}

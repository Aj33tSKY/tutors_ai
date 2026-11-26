import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hero } from "../../../src/components/marketing/hero.js";
import { LearningConnection } from "../../../src/components/marketing/learning-connection.js";
import { FeatureShowcase } from "../../../src/components/marketing/feature-showcase.js";
import { TutorShowcase } from "../../../src/components/marketing/tutor-showcase.js";
import { HowItWorks } from "../../../src/components/marketing/how-it-works.js";
import { CtaSection } from "../../../src/components/marketing/cta-section.js";
import PricingContent, { metadata as pricing } from "../../../src/app/(marketing)/pricing/page.js";
import HowItWorksContent, { metadata as howItWorks } from "../../../src/app/(marketing)/how-it-works/page.js";
import AboutContent, { metadata as about } from "../../../src/app/(marketing)/about/page.js";
import TermsContent, { metadata as terms } from "../../../src/app/(marketing)/terms/page.js";
import PrivacyContent, { metadata as privacy } from "../../../src/app/(marketing)/privacy/page.js";
import "../../../src/components/marketing/landing-page.css";
import { api } from "./api.js";

function useTitle(title: string) { useEffect(() => { document.title = title; }, [title]); }
const titleOf = (metadata: { title?: unknown }, fallback: string) => `${typeof metadata.title === "string" ? metadata.title : fallback} · Kindling`;

export function LandingPage() {
  useTitle("Kindling — A-Level STEM Tutoring, Grounded in Every Session");
  // A catalogue outage must not take the landing page down: it simply shows no tutors.
  const tutors = useQuery({ queryKey: ["featured-tutors"], queryFn: async () => (await api.publicTutors("")).tutors.slice(0, 6), staleTime: 60_000, initialData: window.__PUBLIC_DATA__?.catalogue?.tutors.slice(0, 6) });
  return <><Hero/><LearningConnection/><FeatureShowcase/><TutorShowcase tutors={tutors.data ?? []}/><HowItWorks/><CtaSection/></>;
}
export function PricingPage() { useTitle(titleOf(pricing, "Pricing")); return <PricingContent/>; }
export function HowItWorksPage() { useTitle(titleOf(howItWorks, "How it works")); return <HowItWorksContent/>; }
export function TermsPage() { useTitle(titleOf(terms, "Terms of service")); return <TermsContent/>; }
export function PrivacyPage() { useTitle(titleOf(privacy, "Privacy policy")); return <PrivacyContent/>; }
export function AboutPage() { useTitle(titleOf(about, "About")); return <AboutContent/>; }

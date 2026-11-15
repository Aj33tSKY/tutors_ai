// Loaded only by the prerender script, through Vite's SSR loader, so it sees the same aliases and
// stylesheet handling as the browser build. Rendering here must stay free of browser-only state.
import { renderToString } from "react-dom/server";
import { SiteHeader } from "../../../src/components/marketing/site-header.js";
import { SiteFooter } from "../../../src/components/marketing/site-footer.js";
import { Hero } from "../../../src/components/marketing/hero.js";
import { LearningConnection } from "../../../src/components/marketing/learning-connection.js";
import { FeatureShowcase } from "../../../src/components/marketing/feature-showcase.js";
import { TutorShowcase } from "../../../src/components/marketing/tutor-showcase.js";
import { HowItWorks } from "../../../src/components/marketing/how-it-works.js";
import { CtaSection } from "../../../src/components/marketing/cta-section.js";
import { TutorCatalogueView, TutorProfileView, LessonRequestForm } from "../../../src/components/tutors/tutors-view.js";
import Pricing from "../../../src/app/(marketing)/pricing/page.js";
import HowItWorksPage from "../../../src/app/(marketing)/how-it-works/page.js";
import About from "../../../src/app/(marketing)/about/page.js";
import type { PublicTutor, TutorCatalogue } from "../../../packages/contracts/src/tutors.js";

const framed = (content: React.ReactNode) => renderToString(<div><SiteHeader/><main className="flex-1">{content}</main><SiteFooter/></div>);
export const marketingPages = (catalogue: TutorCatalogue): Array<{ slug: string; title: string; description: string; html: string }> => [
  { slug: "", title: "Kindling — A-Level STEM Tutoring, Grounded in Every Session", description: "UK A-Level Maths, Further Maths, Physics, Chemistry, Biology and Computing tutoring. Live sessions, automatic topic mapping, and an AI revision assistant grounded in your own tutor's words.",
    html: framed(<><Hero/><LearningConnection/><FeatureShowcase/><TutorShowcase tutors={catalogue.tutors.slice(0, 6)}/><HowItWorks/><CtaSection/></>) },
  { slug: "pricing", title: "Pricing · Kindling", description: "Your first lesson with every tutor is free. Later lessons are invoiced after they happen.", html: framed(<Pricing/>) },
  { slug: "how-it-works", title: "How it works · Kindling", description: "Request a lesson, meet your tutor live, and revise from your own session notes.", html: framed(<HowItWorksPage/>) },
  { slug: "about", title: "Safeguarding & compliance · Kindling", description: "How tutors are approved, how recordings are consented to and kept, and how your data is protected.", html: framed(<About/>) },
];
export const catalogueHtml = (catalogue: TutorCatalogue) => framed(<TutorCatalogueView catalogue={catalogue} query={{}}/>);
// Open times are dynamic, so the static form renders with none and the app fills them in.
export const profileHtml = (tutor: PublicTutor) => framed(<TutorProfileView tutor={tutor} request={<LessonRequestForm tutor={tutor} slots={[]} submit={async () => ({})}/>}/>);

import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LessonSignal } from "./lesson-signal";

// Choose a different treatment here to compare without changing the demo.
const HERO_PHOTO_LOOK: "full-bleed" | "framed" | "human" = "full-bleed";
const HERO_PHOTOS = {
  "full-bleed": "/images/marketing/study-desk-editorial.webp",
  framed: "/images/marketing/study-desk.webp",
  human: "/images/marketing/learning-together.webp",
};

export function Hero() {
  return (
    <section className="landing-hero" data-photo-look={HERO_PHOTO_LOOK} aria-labelledby="landing-title">
      <div className="landing-hero__photograph" aria-hidden="true">
        <Image src={HERO_PHOTOS[HERO_PHOTO_LOOK]} alt="" fill sizes="(max-width: 1099px) 100vw, 50vw" preload className="landing-hero__image" />
      </div>
      <div className="landing-shell landing-hero__layout">
        <div className="landing-hero__copy">
          <h1 id="landing-title">A little <span>more</span> from every lesson.</h1>
          <p className="landing-hero__description">
            Learn one-to-one with a specialist tutor. Come back to their explanations,
            your breakthroughs, and what to practise next.
          </p>
          <div className="landing-hero__actions">
            <Button asChild size="lg"><Link href="/tutors">Find your tutor <ArrowUpRight size={16} /></Link></Button>
            <Link href="#lesson-memory" className="landing-text-link">See what stays with you <ArrowDown size={14} /></Link>
          </div>
          <p className="landing-hero__subjects">A-Level Maths, Physics, Chemistry, Biology &amp; Computing</p>
        </div>
        <div className="landing-hero__scene">
          <div className="landing-hero__demo"><LessonSignal /></div>
        </div>
      </div>
    </section>
  );
}

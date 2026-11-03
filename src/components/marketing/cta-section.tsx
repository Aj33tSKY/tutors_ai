import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "./reveal";

export function CtaSection() {
  return (
    <section className="landing-cta landing-shell" aria-labelledby="next-lesson-title">
      <Reveal className="landing-cta__inner">
        <div className="landing-cta__copy"><p className="landing-kicker">Your next chapter</p><h2 id="next-lesson-title">Let’s find your<br />next <em>“I get it.”</em></h2><p>A specialist to learn with.<br />A lesson to come back to.</p><Button asChild size="lg"><Link href="/tutors">Find your tutor <ArrowUpRight size={16} /></Link></Button><small>No subscription required to get started.</small></div>
        <div className="landing-cta__photo"><Image src="/images/marketing/revision-moment.webp" alt="A learner returning to their notes and laptop at a sunlit desk" fill sizes="(max-width: 799px) 100vw, 50vw" /></div>
      </Reveal>
    </section>
  );
}

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "./reveal";

export function LearningConnection() {
  return (
    <section className="landing-connection landing-shell" aria-labelledby="connection-title">
      <Reveal className="landing-connection__photo">
        <Image src="/images/marketing/learning-together.webp" alt="A tutor and learner exploring a worked example together at a desk" fill sizes="(max-width: 799px) 100vw, 52vw" />
        <span className="landing-photo-caption">The human part makes the difference.</span>
      </Reveal>
      <Reveal className="landing-connection__copy" delay={0.08}>
        <p className="landing-kicker">A person who gets how you think</p>
        <h2 id="connection-title">The right tutor.<br />That <em>“oh, I get it”</em> feeling.</h2>
        <p>A different explanation. A question at just the right moment. Someone who gives you the space to work it out.</p>
        <p>Our subject specialists teach you live. Your recordings and lesson notes help you find your way back to the parts that mattered.</p>
        <Link className="landing-text-link" href="/tutors">Meet your next tutor <ArrowUpRight size={15} /></Link>
        <div className="landing-connection__facts"><span>Subject specialists</span><span>Live, one-to-one lessons</span><span>UK &amp; international exam boards</span></div>
      </Reveal>
    </section>
  );
}

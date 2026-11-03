import { ArrowUpRight, CalendarDays, NotebookPen, Video } from "lucide-react";
import Link from "next/link";
import { Reveal } from "./reveal";

const STEPS = [
  { icon: CalendarDays, title: "Find your person", body: "Choose by subject, exam board, availability and price. Request a free first lesson to see how you get on." },
  { icon: Video, title: "Make things click", body: "Meet online, work through the tricky parts and ask the questions you’ve been holding back." },
  { icon: NotebookPen, title: "Take the lesson with you", body: "Return to recordings, tutor-editable notes and revision grounded in available lesson transcripts." },
];

export function HowItWorks() {
  return (
    <section className="landing-how landing-shell" aria-labelledby="how-title">
      <Reveal className="landing-how__heading"><div><p className="landing-kicker">A little easier, from the start</p><h2 id="how-title">From finding a tutor<br />to finding your feet.</h2></div><Link href="/how-it-works" className="landing-text-link">How Kindling works <ArrowUpRight size={15} /></Link></Reveal>
      <div className="landing-how__steps">
        {STEPS.map((step, index) => <Reveal key={step.title} delay={index * .06} className="landing-how__step"><span className="landing-how__icon"><step.icon size={21} strokeWidth={1.5} /></span><span className="landing-how__index">0{index + 1}</span><h3>{step.title}</h3><p>{step.body}</p></Reveal>)}
      </div>
      <p className="landing-how__practical">When recording is enabled, recordings and transcripts are prepared after the lesson. <Link href="/about#privacy">Your recordings &amp; privacy <ArrowUpRight size={12} /></Link></p>
    </section>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";

const DETAILS = [
  {
    n: "01",
    title: "Find the right specialist",
    body: "Compare tutors by subject, exam board, price and weekly availability. Read their teaching approach before requesting a free first lesson.",
  },
  {
    n: "02",
    title: "Vetting you can trust",
    body: "Only approved tutors appear in search. Linked parents can follow lesson schedules and completed lesson reviews.",
  },
  {
    n: "03",
    title: "Learn live, in your browser",
    body: "Meet in a browser lesson room with video and screen sharing. Your tutor confirms the requested time and can schedule future weekly lessons.",
  },
  {
    n: "04",
    title: "Automatic transcription",
    body: "With recording enabled, lesson audio is saved and transcribed after the lesson. Recordings expire after 90 days.",
  },
  {
    n: "05",
    title: "Spec-mapped analytics",
    body: "A session review brings together the recording, transcript and editable tutor notes after processing finishes.",
  },
  {
    n: "06",
    title: "A revision AI that remembers",
    body: "Ask the revision assistant about your lessons and practise exam-style questions. It will say when your session material does not answer a question.",
  },
];

export const metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <div className="shell section">
      <Reveal>
        <h1 className="display-xl max-w-[10ch]">
          Every step, explained
        </h1>
      </Reveal>

      <ol className="mt-24 border-t border-hairline">
        {DETAILS.map((d, i) => (
          <Reveal as="li" key={d.n} delay={i * 0.05}>
            <div className="group grid gap-4 border-b border-hairline py-10 md:grid-cols-[5rem_1fr_1.2fr] md:items-baseline md:gap-10">
              <span className="font-mono text-sm text-brand-strong tabular-nums">{d.n}</span>
              <h2 className="display-md transition-transform duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] md:group-hover:translate-x-2">
                {d.title}
              </h2>
              <p className="max-w-lg leading-relaxed text-muted-foreground">{d.body}</p>
            </div>
          </Reveal>
        ))}
      </ol>

      <Reveal>
        <div className="mt-20 flex flex-col items-start justify-between gap-8 rounded-3xl border border-border/70 bg-card p-10 shadow-sm sm:flex-row sm:items-center">
          <div>
            <h2 className="display-md">Ready to get started?</h2>
            <p className="mt-3 text-muted-foreground">Book your first session in minutes.</p>
          </div>
          <Button asChild size="lg">
            <Link href="/tutors">Find a tutor</Link>
          </Button>
        </div>
      </Reveal>
    </div>
  );
}

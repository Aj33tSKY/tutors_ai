import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";

const DETAILS = [
  {
    n: "01",
    title: "Find the right specialist",
    body: "Filter by subject, exam board (AQA, Edexcel, OCR A/B, WJEC, CIE), price and weekly availability. Every profile shows verified qualifications and real session counts.",
  },
  {
    n: "02",
    title: "Vetting you can trust",
    body: "Every tutor uploads a DBS certificate and proof of qualification before they can appear in search. Parent accounts get full visibility into every session.",
  },
  {
    n: "03",
    title: "Learn live, in your browser",
    body: "HD video, a shared whiteboard, screen share and a KaTeX formula editor — no downloads required. Book single sessions or a recurring weekly slot.",
  },
  {
    n: "04",
    title: "Automatic transcription",
    body: "Session audio is streamed to real-time speech-to-text with speaker diarization, so we know exactly what the tutor said versus the student.",
  },
  {
    n: "05",
    title: "Spec-mapped analytics",
    body: "An LLM maps the transcript to official UK specification points, flags misconceptions, and logs homework — visible on your dashboard within minutes.",
  },
  {
    n: "06",
    title: "A revision AI that remembers",
    body: "Chat 24/7 with an assistant grounded in your own transcripts — same explanations, same methods, custom exam-style practice questions.",
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
              <span className="font-mono text-sm text-saffron tabular-nums">{d.n}</span>
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

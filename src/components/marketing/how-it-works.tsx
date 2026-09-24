import { Reveal } from "./reveal";

const STEPS = [
  {
    n: "01",
    title: "Match with a specialist",
    body: "Filter by subject, exam board, price and availability. Every tutor is DBS-verified before they teach a minute.",
  },
  {
    n: "02",
    title: "Learn, live, in-browser",
    body: "HD video, a shared whiteboard and a formula editor — no downloads. Sessions are transcribed in real time.",
  },
  {
    n: "03",
    title: "Revise with your tutor's words",
    body: "Topics are auto-mapped to your spec, misconceptions are flagged, and a grounded AI is ready 24/7.",
  },
];

export function HowItWorks() {
  return (
    <section className="section shell">
      <Reveal>
        <h2 className="display-lg max-w-[16ch]">
          From booking to breakthrough
        </h2>
      </Reveal>

      {/* Hairline-ruled rows, not floating cards. */}
      <ol className="mt-20 border-t border-hairline">
        {STEPS.map((step, i) => (
          <Reveal as="li" key={step.n} delay={i * 0.08}>
            <div className="group grid gap-4 border-b border-hairline py-10 md:grid-cols-[6rem_1fr_1.1fr] md:items-baseline md:gap-10">
              <span className="font-mono text-sm text-saffron tabular-nums">{step.n}</span>
              <h3 className="display-md transition-transform duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] md:group-hover:translate-x-2">
                {step.title}
              </h3>
              <p className="max-w-md leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

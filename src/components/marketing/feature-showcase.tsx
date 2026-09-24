import { Reveal } from "./reveal";
import { ProgressRing } from "@/components/progress-ring";

const FLAGS = [
  "Misconception: confusing centripetal with centrifugal force",
  "Homework: 3× past-paper questions on particle accelerators",
];

export function FeatureShowcase() {
  return (
    // The one full-bleed colour block on the page — rust, from the palette.
    <section className="relative isolate overflow-hidden bg-rust text-cream">
      <div aria-hidden className="grain absolute inset-0" />

      <div className="shell section relative">
        <Reveal>
          <h2 className="display-lg max-w-[16ch]">
            It already knows what your tutor taught you
          </h2>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-cream/70">
            No generic answers. The assistant is grounded in your own session transcripts — same
            methods, same explanations, same exam board.
          </p>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 gap-px border border-cream/15 bg-cream/15 lg:grid-cols-2">
          <Reveal className="bg-rust">
            <div className="flex h-full flex-col p-8">
              <p className="eyebrow text-cream/60">Chat · 12 Sept, Priya M.</p>

              <div className="mt-8 flex-1 space-y-4">
                <p className="ml-auto max-w-[85%] border border-cream/20 px-4 py-3 text-sm leading-relaxed">
                  Can you set me a 6-mark question on particle accelerators, like the one from
                  Tuesday?
                </p>
                <p className="mr-auto max-w-[90%] bg-saffron px-4 py-3 text-sm leading-relaxed text-ink">
                  Sure — using the same approach your tutor walked through: &ldquo;Describe how a
                  linear accelerator increases the speed of a charged particle…&rdquo; (6 marks,
                  Edexcel 4.2)
                </p>
              </div>

              <p className="eyebrow mt-8 text-cream/60">
                Grounded in 4 transcripts · 0 hallucinated spec points
              </p>
            </div>
          </Reveal>

          <Reveal className="bg-rust" delay={0.1}>
            <div className="flex h-full flex-col p-8">
              <p className="eyebrow text-cream/60">Specification coverage</p>

              <div className="mt-10 flex flex-wrap items-start justify-around gap-8">
                <ProgressRing value={78} color="var(--saffron)" track="rgb(236 231 224 / 0.2)" label="Mechanics" />
                <ProgressRing value={54} color="var(--saffron)" track="rgb(236 231 224 / 0.2)" label="Electricity" />
                <ProgressRing value={91} color="var(--saffron)" track="rgb(236 231 224 / 0.2)" label="Waves" />
              </div>

              <p className="eyebrow mt-14 text-cream/60">Flagged this week</p>
              <ul className="mt-4 space-y-px">
                {FLAGS.map((f) => (
                  <li
                    key={f}
                    className="border-t border-cream/15 py-3 text-sm leading-relaxed text-cream/80"
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

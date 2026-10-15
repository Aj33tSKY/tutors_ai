import { Reveal } from "./reveal";

export function FeatureShowcase() {
  return (
    // The one full-bleed colour block on the page — rust, from the palette.
    <section className="relative isolate overflow-hidden bg-rust text-cream">
      <div aria-hidden className="grain absolute inset-0" />

      <div className="shell section relative">
        <Reveal>
          <h2 className="display-lg max-w-[16ch]">
            A useful record of every lesson
          </h2>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-cream/70">
            Go back to your tutor&apos;s explanation, read their notes and pick up where you left off.
            The revision assistant can draw on available session transcripts.
          </p>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 gap-px border border-cream/15 bg-cream/15 lg:grid-cols-2">
          <Reveal className="bg-rust">
            <div className="flex h-full flex-col p-8">
              <p className="eyebrow text-cream/60">Example lesson review</p>

              <div className="mt-8 flex-1 space-y-4">
                <p className="ml-auto max-w-[85%] border border-cream/20 px-4 py-3 text-sm leading-relaxed">
                  What did we cover in the lesson?
                </p>
                <p className="mr-auto max-w-[90%] bg-saffron px-4 py-3 text-sm leading-relaxed text-ink">
                  Open your session notes for the tutor&apos;s summary, then replay the recording
                  where you need more detail.
                </p>
              </div>

              <p className="eyebrow mt-8 text-cream/60">
                An illustrative example of the review experience
              </p>
            </div>
          </Reveal>

          <Reveal className="bg-rust" delay={0.1}>
            <div className="flex h-full flex-col p-8">
              <p className="eyebrow text-cream/60">After the lesson</p>
              <ol className="mt-8 space-y-5 text-base text-cream/90">
                <li className="border-t border-cream/15 pt-5"><strong className="text-cream">01 · Replay</strong><p className="mt-1 text-sm text-cream/70">Listen back to the explanation or screen share.</p></li>
                <li className="border-t border-cream/15 pt-5"><strong className="text-cream">02 · Review</strong><p className="mt-1 text-sm text-cream/70">Read the notes your tutor can edit.</p></li>
                <li className="border-t border-cream/15 pt-5"><strong className="text-cream">03 · Practise</strong><p className="mt-1 text-sm text-cream/70">Ask a follow-up question in Revision AI.</p></li>
              </ol>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

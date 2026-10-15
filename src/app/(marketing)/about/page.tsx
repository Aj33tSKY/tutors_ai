import { Reveal } from "@/components/marketing/reveal";

const POINTS = [
  {
    id: "dbs",
    title: "Tutor verification",
    body: "Only tutors approved by our team appear in public search. We review their identity and relevant safeguarding evidence before approving a profile.",
  },
  {
    id: "parents",
    title: "Parent linkage for under-18 students",
    body: "Linked parent accounts can see their children's lesson schedule and completed session reviews. Private student conversations and revision chats remain private.",
  },
  {
    id: "privacy",
    title: "GDPR & data retention",
    body: "When recording is enabled, lesson audio and shared screens are saved for review and automatically expire after 90 days. Session transcripts and notes remain available to authorised lesson participants.",
  },
  {
    id: "compliance",
    title: "UK exam board alignment",
    body: "Tutor profiles show the A-Level subjects and exam boards they teach. Session notes help students revisit what their own tutor covered.",
  },
];

export const metadata = { title: "Safeguarding & compliance" };

export default function AboutPage() {
  return (
    <div className="shell section">
      <Reveal>
        <h1 className="display-xl max-w-[12ch]">
          Built for UK families, from day one
        </h1>
        <p className="mt-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Kindling is designed around child safety and data protection requirements specific to UK
          tutoring — not retrofitted onto a generic platform.
        </p>
      </Reveal>

      <div className="mt-24 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm sm:grid-cols-2">
        {POINTS.map((p, i) => (
          // ids are anchor targets for the footer's deep links
          <Reveal key={p.id} delay={i * 0.06} className="bg-card">
            <section id={p.id} className="h-full scroll-mt-24 p-9">
              <h2 className="display-md">{p.title}</h2>
              <p className="mt-5 leading-relaxed text-muted-foreground">{p.body}</p>
            </section>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

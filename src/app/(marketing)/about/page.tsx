import { Reveal } from "@/components/marketing/reveal";

const POINTS = [
  {
    id: "dbs",
    title: "DBS verification, mandatory",
    body: "Every tutor uploads an enhanced DBS (Disclosure and Barring Service) certificate before their profile can go live. Admins review and approve manually.",
  },
  {
    id: "parents",
    title: "Parent linkage for under-18 students",
    body: "Parents can link their account to a child's profile, giving them full visibility into every session's transcript, analytics and chatbot log.",
  },
  {
    id: "privacy",
    title: "GDPR & data retention",
    body: "Audio is streamed for live transcription and discarded immediately after — it is never stored. Raw transcripts are encrypted at rest.",
  },
  {
    id: "compliance",
    title: "UK exam board alignment",
    body: "Topic mapping is aligned to official AQA, Edexcel, OCR A/B, WJEC and CIE specification points, not generic curricula.",
  },
];

export const metadata = { title: "Safeguarding & compliance" };

export default function AboutPage() {
  return (
    <div className="shell section">
      <Reveal>
        <p className="eyebrow">Safeguarding &amp; compliance</p>
        <h1 className="display-xl mt-6 max-w-[12ch]">
          Built for UK families, from day one
        </h1>
        <p className="mt-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Kindling is designed around child safety and data protection requirements specific to UK
          tutoring — not retrofitted onto a generic platform.
        </p>
      </Reveal>

      <div className="mt-24 grid grid-cols-1 gap-px border border-hairline bg-hairline sm:grid-cols-2">
        {POINTS.map((p, i) => (
          // ids are anchor targets for the footer's deep links
          <Reveal key={p.id} delay={i * 0.06} className="bg-background">
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

import type { ReactNode } from "react";

/** Facts every legal page states. The business is run by a sole trader for now; change `company` if it is incorporated. The contact
 * mailbox must exist before launch (forward it to the founder): a privacy policy must give people a way to reach the controller. */
export const LEGAL = {
  company: "Ajeet Joseph Prabu, trading as Hybridtutors",
  product: "Hybridtutors",
  updated: "26 November 2026",
  contactEmail: "hello@hybridtutors.co.uk" as string | null,
};

export const Contact = () => LEGAL.contactEmail
  ? <a href={`mailto:${LEGAL.contactEmail}`} className="underline underline-offset-4">{LEGAL.contactEmail}</a>
  : <span>our contact email (to be confirmed before launch)</span>;

export const P = ({ children }: { children: ReactNode }) => <p className="mt-4 leading-relaxed text-muted-foreground">{children}</p>;
export const List = ({ items }: { items: ReactNode[] }) => <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-muted-foreground">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;

export type LegalSection = { id: string; title: string; body: ReactNode };

export function LegalDocument({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  return <div className="shell section">
    <div className="max-w-2xl">
      <h1 className="display-lg">{title}</h1>
      <p className="mt-4 text-sm text-muted-foreground">Last updated {LEGAL.updated}</p>
      <div className="mt-8 text-lg leading-relaxed text-muted-foreground">{intro}</div>
      <nav aria-label="Contents" className="mt-10 rounded-xl border bg-card p-5">
        <p className="eyebrow">Contents</p>
        <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-sm sm:grid-cols-2">
          {sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className="underline-offset-4 hover:underline">{section.title}</a></li>)}
        </ol>
      </nav>
      {sections.map((section) => <section key={section.id} id={section.id} className="mt-12 scroll-mt-24">
        <h2 className="display-md">{section.title}</h2>
        {section.body}
      </section>)}
    </div>
  </div>;
}

import { TESTIMONIALS } from "@/lib/mock-data";
import { Reveal } from "./reveal";

export function Testimonials() {
  return (
    <section className="section border-y border-hairline">
      <div className="shell">
        <ul className="grid grid-cols-1 gap-px bg-hairline md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal as="li" key={t.name} delay={i * 0.08} className="bg-background">
              <figure className="flex h-full flex-col p-8">
                <span aria-hidden className="font-heading text-5xl leading-none text-saffron">
                  &ldquo;
                </span>
                <blockquote className="mt-4 flex-1 text-lg leading-relaxed text-balance">
                  {t.quote}
                </blockquote>
                <figcaption className="mt-8 border-t border-hairline pt-5">
                  <span className="block font-heading text-lg">{t.name}</span>
                  <span className="eyebrow mt-2 block">{t.role}</span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

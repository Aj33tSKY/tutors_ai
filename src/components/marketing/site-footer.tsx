import Link from "next/link";
import { Wordmark } from "./wordmark";

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "/tutors", label: "Find a tutor" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/sign-up?role=tutor", label: "Become a tutor" },
    ],
  },
  {
    title: "Subjects",
    links: [
      { href: "/tutors?subject=Mathematics", label: "Mathematics" },
      { href: "/tutors?subject=Physics", label: "Physics" },
      { href: "/tutors?subject=Chemistry", label: "Chemistry" },
      { href: "/tutors?subject=Computing", label: "Computing" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/about", label: "Safeguarding & DBS" },
      { href: "/about#privacy", label: "GDPR & data retention" },
      { href: "/about#compliance", label: "Compliance" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="shell py-20">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:gap-10">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              A-Level STEM tutoring, grounded in every session — for AQA, Edexcel, OCR and CIE
              students across the UK.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="eyebrow">{col.title}</h2>
              <ul className="mt-5 space-y-3.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="link-draw text-sm text-muted-foreground transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-20 flex flex-col gap-3 border-t border-hairline pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="eyebrow">
            © {new Date().getFullYear()} Kindling Education Ltd
          </p>
          <p className="eyebrow">DBS-checked · GDPR compliant · UK-based</p>
        </div>
      </div>
    </footer>
  );
}

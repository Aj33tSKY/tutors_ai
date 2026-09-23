import Link from "next/link";
import { SUBJECTS } from "@/lib/subjects";

/**
 * Continuous subject marquee. The list is rendered twice and the track is
 * translated -50%, so the loop is seamless; the duplicate is hidden from
 * assistive tech and the whole thing freezes under reduced motion.
 */
export function SubjectsStrip() {
  return (
    <section
      aria-label="Subjects covered"
      className="overflow-hidden border-b border-hairline py-6"
    >
      <div className="marquee-track flex w-max items-center">
        {[0, 1].map((pass) => (
          <ul
            key={pass}
            aria-hidden={pass === 1 || undefined}
            className="flex w-max items-center"
          >
            {SUBJECTS.map((s) => (
              <li key={s.value} className="flex items-center">
                <Link
                  href={`/tutors?subject=${s.value}`}
                  tabIndex={pass === 1 ? -1 : undefined}
                  className="display-md px-8 text-muted-foreground transition-colors duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] hover:text-saffron"
                >
                  {s.label}
                </Link>
                <span aria-hidden className="text-saffron">
                  ✳
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}

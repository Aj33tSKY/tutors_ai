import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Reveal } from "./reveal";

export function CtaSection() {
  return (
    <section className="section shell">
      <Reveal>
        <div className="flex flex-col items-start gap-12 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="display-xl max-w-[11ch]">
              A grade that actually <span className="text-saffron">sticks</span>
            </h2>
          </div>

          <div className="shrink-0">
            <p className="max-w-xs text-muted-foreground">
              Book your first session this week. No subscription required to get started.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/tutors">Find your tutor</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/how-it-works">See how it works</Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

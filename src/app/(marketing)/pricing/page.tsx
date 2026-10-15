import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";

const PLANS = [
  {
    name: "Pay as you go",
    highlighted: false,
    price: "Tutor-set",
    period: "hourly rate",
    features: [
      "First lesson with a tutor is free",
      "Pay for completed lessons by invoice",
      "Session recording and notes when enabled",
      "No subscription required",
    ],
    cta: "Browse tutors",
    href: "/tutors",
  },
  {
    name: "For tutors",
    highlighted: false,
    price: "0%",
    period: "signup fee",
    features: [
      "Set your own hourly rate",
      "Set weekly availability and your hourly rate",
      "Review and edit session notes",
      "Connect Stripe for direct payouts",
      "See students and lesson requests in one place",
    ],
    cta: "Apply to teach",
    href: "/sign-up?role=tutor",
  },
];

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="shell section">
      <Reveal>
        <h1 className="display-xl max-w-[11ch]">
          Simple, transparent pricing
        </h1>
        <p className="mt-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Tutors set their hourly rates, shown before you request a lesson. Your first lesson
          with a tutor is free; later completed lessons are invoiced individually.
        </p>
      </Reveal>

      <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm md:grid-cols-2">
        {PLANS.map((plan, i) => (
          <Reveal
            key={plan.name}
            delay={i * 0.08}
            className={plan.highlighted ? "bg-rust text-cream" : "bg-card"}
          >
            <div className="flex h-full flex-col p-9">
              <h2 className={`eyebrow ${plan.highlighted ? "text-cream/60" : ""}`}>
                {plan.name}
              </h2>

              <p className="mt-8">
                {/* two lines' worth of height so the period label and the
                    feature list start at the same y across all three plans */}
                <span
                  className={`display-lg block min-h-[1.9em] ${
                    plan.highlighted ? "text-brand-strong" : "text-foreground"
                  }`}
                >
                  {plan.price}
                </span>
                <span
                  className={`eyebrow mt-4 block ${plan.highlighted ? "text-cream/60" : ""}`}
                >
                  {plan.period}
                </span>
              </p>

              <ul className="mt-10 flex-1 space-y-px">
                {plan.features.map((f) => (
                  <li
                    key={f}
                    className={`border-t py-4 text-sm leading-relaxed ${
                      plan.highlighted
                        ? "border-cream/15 text-cream/80"
                        : "border-hairline text-muted-foreground"
                    }`}
                  >
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                asChild
                size="lg"
                variant={plan.highlighted ? "default" : "outline"}
                className="mt-10 w-full"
              >
                <Link href={plan.href}>{plan.cta}</Link>
              </Button>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

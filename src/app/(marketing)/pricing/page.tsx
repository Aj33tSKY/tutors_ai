import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";

const PLANS = [
  {
    name: "Pay as you go",
    price: "From £35",
    period: "per session",
    features: [
      "Book any tutor, any time",
      "Full transcript & topic breakdown",
      "Revision AI access for 30 days",
      "No commitment",
    ],
    cta: "Browse tutors",
    href: "/tutors",
  },
  {
    name: "Weekly subscription",
    price: "Custom",
    period: "per month",
    highlighted: true,
    features: [
      "Recurring weekly slot with your tutor",
      "Full analytics dashboard & coverage rings",
      "Unlimited revision AI access",
      "Priority rescheduling",
    ],
    cta: "Find your tutor",
    href: "/tutors",
  },
  {
    name: "For tutors",
    price: "0%",
    period: "signup fee",
    features: [
      "Set your own hourly rate",
      "Automated session notes save you hours",
      "Fast payouts via Stripe Connect",
      "Grow your student base",
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
          Tutors set their own rates. Kindling adds analytics, transcription and a revision AI to
          every session at no extra cost.
        </p>
      </Reveal>

      <div className="mt-24 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm lg:grid-cols-3">
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
                    plan.highlighted ? "text-saffron" : "text-foreground"
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

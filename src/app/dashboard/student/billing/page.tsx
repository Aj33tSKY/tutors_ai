import Link from "next/link";
import { CreditCard, ExternalLink, Receipt, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReturnToDashboardLink } from "@/components/dashboard/return-to-dashboard-link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { getStripe } from "@/lib/stripe";
import { gbp } from "@/lib/stripe";
import { AutoChargeToggle } from "./billing-controls";
import { openBillingPortalAction, savePaymentMethodAction } from "./actions";

type SavedMethod = { brand: string; last4: string; kind: string } | null;

export default async function StudentBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string; error?: string }>;
}) {
  const { setup, error } = await searchParams;
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, auto_charge_enabled")
    .eq("id", userId)
    .maybeSingle<{ stripe_customer_id: string | null; auto_charge_enabled: boolean }>();

  // Read the saved method from Stripe rather than a local copy: money moves
  // against Stripe's record, so a cached column would be the one that lies.
  let savedMethod: SavedMethod = null;
  if (stripeConfigured && profile?.stripe_customer_id) {
    try {
      const customer = await getStripe().customers.retrieve(profile.stripe_customer_id, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (!customer.deleted) {
        const method = customer.invoice_settings?.default_payment_method;
        if (method && typeof method !== "string") {
          savedMethod = {
            kind: method.type,
            brand: method.card?.brand ?? method.type,
            last4: method.card?.last4 ?? method.bacs_debit?.last4 ?? "",
          };
        }
      }
    } catch {
      // A billing page that cannot reach Stripe should still render the rest.
      savedMethod = null;
    }
  }

  const { data: unpaid } = await supabase
    .from("bookings")
    .select("id, start_time, amount_gbp_pence, stripe_invoice_url, payment_status, lesson_name")
    .eq("student_id", userId)
    .eq("payment_status", "pending")
    .not("stripe_invoice_url", "is", null)
    .order("start_time", { ascending: false })
    .returns<
      {
        id: string;
        start_time: string;
        amount_gbp_pence: number;
        stripe_invoice_url: string | null;
        payment_status: string;
        lesson_name: string | null;
      }[]
    >();

  const autoCharge = Boolean(profile?.auto_charge_enabled) && Boolean(savedMethod);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <ReturnToDashboardLink />
        <h2 className="display-md mt-3">Payment settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How your lessons get paid for. Card details are handled entirely by Stripe and never
          reach this site.
        </p>
      </div>

      {setup === "complete" && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Payment method saved.
        </p>
      )}
      {setup === "cancelled" && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          No payment method was saved.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error === "unconfigured"
            ? "Payments are not configured for this environment."
            : "We couldn’t start that. Please try again."}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4" /> Payment method
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {savedMethod ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="capitalize">
                {savedMethod.brand}
              </Badge>
              {savedMethod.last4 && <span className="text-muted-foreground">ending {savedMethod.last4}</span>}
              <span className="text-muted-foreground">
                · {savedMethod.kind === "bacs_debit" ? "Direct Debit" : "Card"}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No payment method saved. You will be emailed a payment link for each lesson.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <form action={savePaymentMethodAction}>
              <Button type="submit" variant={savedMethod ? "outline" : "default"} disabled={!stripeConfigured}>
                {savedMethod ? "Replace payment method" : "Save a payment method"}
              </Button>
            </form>
            {profile?.stripe_customer_id && (
              <form action={openBillingPortalAction}>
                <Button type="submit" variant="ghost" disabled={!stripeConfigured}>
                  Manage billing <ExternalLink className="size-3.5" />
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Automatic payment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {autoCharge
              ? "Lessons are charged to your saved payment method when your tutor sends the invoice. You will still get a receipt for every payment."
              : "Lessons are invoiced by email and you pay each one yourself. Turn this on to have them charged automatically instead."}
          </p>
          <AutoChargeToggle
            enabled={Boolean(profile?.auto_charge_enabled)}
            canEnable={Boolean(savedMethod)}
          />
          {profile?.auto_charge_enabled && !savedMethod && (
            <p role="alert" className="text-sm text-destructive">
              Automatic payment is on but no payment method is saved, so lessons will be invoiced by
              email until you save one.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4" /> Awaiting payment
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unpaid?.length ? (
            <ul className="divide-y divide-hairline">
              {unpaid.map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="text-sm">
                    <p className="font-medium">{booking.lesson_name ?? "Lesson"}</p>
                    <p className="text-muted-foreground">
                      {new Date(booking.start_time).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}{" "}
                      · {gbp(booking.amount_gbp_pence)}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={booking.stripe_invoice_url!} target="_blank" rel="noopener noreferrer">
                      Pay now <ExternalLink className="size-3.5" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is awaiting payment.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

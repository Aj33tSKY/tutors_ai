import { CheckCircle2, ExternalLink, Landmark } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/profile";
import { getStripe } from "@/lib/stripe";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { startPayoutOnboardingAction, openStripeDashboardAction } from "./actions";

export default async function TutorPayoutsPage() {
  const { userId } = await getCurrentProfile();
  const supabase = await createClient();
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .maybeSingle();

  const connected = Boolean(tutor?.stripe_account_id);

  // Always check live rather than trust a cached flag — this is a
  // money-movement decision, not just a display. See the checkout action
  // for the same live check before enabling a destination charge.
  let payoutsEnabled = false;
  if (stripeConfigured && connected && tutor?.stripe_account_id) {
    const account = await getStripe().v2.core.accounts.retrieve(tutor.stripe_account_id, {
      include: ["configuration.recipient"],
    });
    payoutsEnabled =
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ===
      "active";
    await supabase
      .from("tutor_profiles")
      .update({ stripe_payouts_enabled: payoutsEnabled })
      .eq("id", userId);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="display-md">Payouts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a bank account with Stripe to get paid directly for bookings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-4 text-saffron" /> Stripe Connect
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!stripeConfigured ? (
            <p className="text-sm text-muted-foreground">
              Payments aren&apos;t set up on this platform yet — check back soon.
            </p>
          ) : payoutsEnabled ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-saffron" />
                Payouts are enabled. Bookings pay out to your connected account, minus the
                platform fee.
              </div>
              <form action={openStripeDashboardAction}>
                <Button type="submit" variant="outline" size="sm">
                  Open Stripe dashboard <ExternalLink className="size-3.5" />
                </Button>
              </form>
            </>
          ) : connected ? (
            <>
              <p className="text-sm text-muted-foreground">
                You&apos;ve started setup but Stripe still needs a few more details before payouts
                can go live.
              </p>
              <form action={startPayoutOnboardingAction}>
                <Button type="submit" size="sm">
                  Continue setup
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Until this is set up, booking payments settle to the platform and you&apos;ll be
                paid out manually. Connecting Stripe gets you paid automatically per session.
              </p>
              <form action={startPayoutOnboardingAction}>
                <Button type="submit" size="sm">
                  Set up payouts
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

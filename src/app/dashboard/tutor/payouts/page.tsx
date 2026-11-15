import { CheckCircle2, ExternalLink, Landmark } from "lucide-react";
import { legacyBilling, legacyBillingContext } from "@/lib/billing-adapter";
import { payoutState } from "../../../../../packages/domain/src/billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { startPayoutOnboardingAction, openStripeDashboardAction } from "./actions";

export default async function TutorPayoutsPage() {
  const context = await legacyBillingContext();
  const state = context
    ? await payoutState(context.client, context.identity, legacyBilling).catch(() => null)
    : null;
  const stripeConfigured = Boolean(state?.configured);
  const connected = Boolean(state?.connected);
  const payoutsEnabled = Boolean(state?.payoutsEnabled);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="display-md">Payouts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect a bank account with Stripe to get paid directly for bookings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-4 text-brand-strong" /> Stripe Connect
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
                <CheckCircle2 className="size-4 text-brand-strong" />
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

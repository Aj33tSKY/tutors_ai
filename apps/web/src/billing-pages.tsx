import { useState, type ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, ExternalLink, Landmark, Receipt, ShieldCheck } from "lucide-react";
import { Badge } from "../../../src/components/ui/badge.js";
import { Button } from "../../../src/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../../src/components/ui/card.js";
import { gbp } from "../../../src/lib/money.js";
import { api, ApiFailure } from "./api.js";

function Frame({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return <main className="mx-auto max-w-3xl space-y-6 p-8"><div><Link to="/dashboard">← Dashboard</Link><h1 className="display-md mt-3">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{intro}</p></div>{children}</main>;
}
function useRedirect(start: () => Promise<{ url: string }>) {
  const [error, setError] = useState<string>();
  const mutation = useMutation({ mutationFn: start, onSuccess: ({ url }) => window.location.assign(url), onError: (cause) => setError(cause instanceof Error ? cause.message : "We couldn’t start that. Please try again.") });
  return { run: () => { setError(undefined); mutation.mutate(); }, pending: mutation.isPending, error };
}
function Guard({ error }: { error: unknown }) {
  if (error instanceof ApiFailure && error.status === 401) return <Navigate to="/sign-in" replace/>;
  if (error instanceof ApiFailure && error.status === 403) return <Navigate to="/dashboard" replace/>;
  return <p role="alert">Could not load this page. Please try again.</p>;
}

export function StudentBillingPage() {
  const [params] = useSearchParams();
  const client = useQueryClient();
  const billing = useQuery({ queryKey: ["student-billing"], queryFn: api.studentBilling });
  const setup = useRedirect(api.startPaymentSetup);
  const portal = useRedirect(api.openBillingPortal);
  const [toggleError, setToggleError] = useState<string>();
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api.setAutoCharge(enabled), onSuccess: () => client.invalidateQueries({ queryKey: ["student-billing"] }),
    onError: (cause) => setToggleError(cause instanceof Error ? cause.message : "We couldn’t save that preference. Please try again.") });
  if (billing.error) return <Guard error={billing.error}/>;
  if (!billing.data) return <p role="status">Loading payment settings…</p>;
  const { configured, hasCustomer, savedMethod, autoChargeEnabled, unpaid } = billing.data;
  return <Frame title="Payment settings" intro="How your lessons get paid for. Card details are handled entirely by Stripe and never reach this site.">
    {params.get("setup") === "complete" && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">Payment method saved. It can take a moment to appear.</p>}
    {params.get("setup") === "cancelled" && <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">No payment method was saved.</p>}
    {!configured && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Payments are not configured for this environment.</p>}
    {(setup.error || portal.error) && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{setup.error ?? portal.error}</p>}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="size-4"/> Payment method</CardTitle></CardHeader><CardContent className="space-y-4">
      {savedMethod ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline" className="capitalize">{savedMethod.brand}</Badge>{savedMethod.last4 && <span className="text-muted-foreground">ending {savedMethod.last4}</span>}<span className="text-muted-foreground">· {savedMethod.kind === "bacs_debit" ? "Direct Debit" : "Card"}</span></div>
        : <p className="text-sm text-muted-foreground">No payment method saved. You will be emailed a payment link for each lesson.</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" variant={savedMethod ? "outline" : "default"} disabled={!configured || setup.pending} onClick={setup.run}>{savedMethod ? "Replace payment method" : "Save a payment method"}</Button>
        {hasCustomer && <Button type="button" variant="ghost" disabled={!configured || portal.pending} onClick={portal.run}>Manage billing <ExternalLink className="size-3.5"/></Button>}</div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4"/> Automatic payment</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{autoChargeEnabled ? "Lessons are charged to your saved payment method when your tutor sends the invoice. You will still get a receipt for every payment." : "Lessons are invoiced by email and you pay each one yourself. Turn this on to have them charged automatically instead."}</p>
      <Button type="button" variant={autoChargeEnabled ? "outline" : "default"} disabled={toggle.isPending || (!autoChargeEnabled && !savedMethod)} onClick={() => { setToggleError(undefined); toggle.mutate(!autoChargeEnabled); }}>{toggle.isPending ? "Saving…" : autoChargeEnabled ? "Turn off automatic payment" : "Turn on automatic payment"}</Button>
      {toggleError && <p role="alert" className="text-sm text-destructive">{toggleError}</p>}
      {!autoChargeEnabled && !savedMethod && <p className="text-sm text-muted-foreground">Save a payment method first.</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="size-4"/> Awaiting payment</CardTitle></CardHeader><CardContent>
      {unpaid.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is waiting for payment.</p> : <ul className="divide-y divide-border/70">{unpaid.map((lesson) => <li key={lesson.id} className="flex items-center justify-between gap-3 py-3 text-sm">
        <span>{lesson.lesson_name || "Lesson"} · {new Date(lesson.start_time).toLocaleDateString("en-GB")}</span><span className="flex items-center gap-3"><span>{gbp(lesson.amount_gbp_pence)}</span>{lesson.stripe_invoice_url && <Button asChild size="sm"><a href={lesson.stripe_invoice_url} target="_blank" rel="noreferrer">Pay now</a></Button>}</span></li>)}</ul>}
    </CardContent></Card>
  </Frame>;
}

export function PayoutsPage() {
  const payouts = useQuery({ queryKey: ["payouts"], queryFn: api.payouts });
  const onboarding = useRedirect(api.startPayoutOnboarding);
  const dashboard = useRedirect(api.openPayoutDashboard);
  if (payouts.error) return <Guard error={payouts.error}/>;
  if (!payouts.data) return <p role="status">Loading payouts…</p>;
  const { configured, connected, payoutsEnabled } = payouts.data;
  return <Frame title="Payouts" intro="Connect your own Stripe account. Students pay you directly through it, and you are the seller of each lesson.">
    {(onboarding.error || dashboard.error) && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{onboarding.error ?? dashboard.error}</p>}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Landmark className="size-4"/> Stripe Connect</CardTitle></CardHeader><CardContent className="space-y-3">
      {!configured ? <p className="text-sm text-muted-foreground">Payments are not configured for this environment.</p>
        : payoutsEnabled ? <><p className="text-sm text-muted-foreground">Your Stripe account is ready. When you invoice a lesson, the student pays you directly and Hybridtutors takes its platform fee. Refunds and card disputes are handled in your Stripe dashboard.</p><Button type="button" variant="outline" disabled={dashboard.pending} onClick={dashboard.run}>Open Stripe dashboard <ExternalLink className="size-3.5"/></Button></>
        : connected ? <><p className="text-sm text-muted-foreground">You&apos;ve started setup but Stripe still needs a few more details before you can invoice lessons.</p><Button type="button" disabled={onboarding.pending} onClick={onboarding.run}>Continue setup</Button></>
        : <><p className="text-sm text-muted-foreground">You haven&apos;t connected a Stripe account yet. You need one before you can invoice a lesson, because students pay you through it.</p><Button type="button" disabled={onboarding.pending} onClick={onboarding.run}>Connect Stripe</Button></>}
    </CardContent></Card>
  </Frame>;
}

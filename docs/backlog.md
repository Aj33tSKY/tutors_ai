# Backlog

Known work that is deliberately not done yet. Each entry says what the problem is and why it matters, so a later reader can judge priority without rediscovering it.

For things that must happen before real payments, see [Before taking real payments](CI-CD.md#before-taking-real-payments) instead — those are launch blockers rather than backlog.

## Audit the Server Actions for silent failures

**Problem.** Several Server Actions return bare `undefined` from their guard clauses. The form submits, the request returns HTTP 200, nothing is logged, and the UI does not change — so a refused operation is indistinguishable from a broken one.

This has already cost real debugging time three times:

| Action | Symptom | Cause |
| --- | --- | --- |
| `scheduleLessonRequestAction` | Confirm did nothing | Conflict check rejected any booking within a week |
| `sendSessionInvoiceAction` | Send invoice did nothing | Required `amount_gbp_pence`, which was null |
| LiveKit `track_published` handler | No transcripts, ever | Read a field the payload does not carry, returned 200 |

**What to do.** Convert the remaining actions to return `{ error?: string; success?: boolean }` and consume them with `useActionState`, as `markSessionCompleteAction` and now `sendSessionInvoiceAction` do. Give each guard its own message rather than one shared string — a single message for four conditions sends the reader to the wrong place, which is what happened with "Only a started tutor session can be marked complete" appearing for an already-completed session.

Actions still on the old pattern:

- `cancelSessionAction`
- `markSessionUpcomingAction`
- `declineLessonRequestAction`
- `scheduleLessonRequestAction` — redirects with an error code, which is better than silence but still loses detail
- `consentToSessionRecording`

**Why it matters.** Every one of these is a tutor or student action whose failure is invisible. The pattern is the bug, not the individual instances.

## Surface a payment route in the app

**Problem.** Invoices are emailed by Stripe and paid on a Stripe-hosted page. `bookings.stripe_invoice_url` is stored but not shown anywhere, so a student who loses the email has no way to pay.

**Smallest fix.** Show a "Pay now" link on the student's booking view when `payment_status` is `pending` and `stripe_invoice_url` is set. The hosted page already handles cards, wallets and PCI scope.

**Larger option.** Embedded Checkout, so paying never leaves the app. Costs the invoice semantics — numbers, PDFs, and Stripe's own dunning — which are worth keeping for a service parents pay for.

## Billing preferences: direct debit and pay-as-you-go

**Problem.** The only model is invoice-per-lesson after the fact. Weekly tutoring suits a mandate the parent authorises once.

**Shape.** BACS Direct Debit for UK recurring billing, via Stripe Billing subscriptions rather than hand-rolled renewals, with the Stripe Customer Portal for self-service management instead of a bespoke settings page. Enable payment methods in the Dashboard rather than passing `payment_method_types`, which locks out methods and hurts conversion.

Needs a product decision first: is a subscription per student, per tutor, or per lesson block? That choice drives the schema.

## Application test coverage

Database authorisation is covered by `supabase/tests/`. Nothing tests routing, cookies, or the Server Actions above. Designed in [testing-plan.md](testing-plan.md), not implemented.

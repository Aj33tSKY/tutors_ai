# Billing and Stripe webhook handover

Billing, payouts and invoicing now live in `packages/domain/src/billing.ts` behind a
`BillingProvider` interface; `packages/data/src/stripe.ts` is the only Stripe code. The
Hono API and the legacy Next Server Actions call the same functions, so each payment rule
has one implementation.

## What changed in the database (migration `20261115160000`)

- Participants could previously write **any** column of their own booking, so a student
  could mark a lesson `paid` at a price of zero, and any user could set their own
  `stripe_customer_id` or a tutor their `stripe_account_id`. A trigger now rejects direct
  client writes to billing fields; the service role and `SECURITY DEFINER` functions are
  unaffected. Students can no longer insert bookings directly.
- Stripe identifiers are first-write-wins through narrow functions, so they can never be
  re-pointed. Invoice recording is tutor-only, once, for a completed paid lesson.
- Stripe calls carry deterministic idempotency keys, so a retried invoice resumes rather
  than duplicates.

## Webhook: durable inbox

`POST /v1/webhooks/stripe` verifies the signature, stores only the minimal facts of
handled events in `private.provider_events` (unique per provider event id) and then
answers 200. If persistence fails it answers 503 so Stripe redelivers. The worker applies
events with leases and backed-off retries (12 attempts). A payment event that arrives
before its invoice id is recorded on the booking waits and retries instead of being lost.
`paid` and `refunded` are never downgraded by a late event.

Credentials (all separate; none is the owner or job login):

| Runtime | Variable | Notes |
| --- | --- | --- |
| API | `APP_EVENTS_DATABASE_URL` | Login granted by `grantEventIntake` (execute on one function, nothing else) |
| API | `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` | Per environment |
| Worker | `STRIPE_SECRET_KEY` | Only used to set the default payment method after setup |

Backlog check (release owner): `select * from private.provider_event_backlog;` shows
pending and dead (12 attempts) events per provider without exposing payloads.

## Cutover order (staging first)

1. Apply migrations, then deploy API and worker. The legacy Next webhook keeps working
   throughout; it now also answers 500 on failure and no longer downgrades `paid`.
2. Create the intake login, then run `grantEventIntake` for it (release command, as for
   the job role). Set the API/worker variables above.
3. Create a **new** Stripe webhook endpoint for `https://<api-domain>/v1/webhooks/stripe`
   with the four handled events (`invoice.paid`, `invoice.payment_failed`,
   `invoice.payment_action_required`, `checkout.session.completed`). Its signing secret
   goes to the API as `STRIPE_WEBHOOK_SECRET`.
4. Send a test event and confirm a row appears and is processed. Then disable the old
   endpoint in Stripe. Never leave both enabled: processing is idempotent, but there is no
   reason to double-deliver.
5. Rollback: re-enable the old endpoint; stored-but-unprocessed events stay in the inbox
   and are applied by the worker when it returns. Do not delete them.

## Not changed

Charges, fees (15 % destination-charge fee), Checkout setup mode and the hosted invoice
page keep their existing Stripe semantics. No real charge is made by any test.

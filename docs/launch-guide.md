# Launch guide: business, payments and what is left

Written 26 November 2026 for the founder. It records decisions, the reasoning behind them, and what to do next, so none of it has to be rediscovered. Items marked **verify** are my understanding and were not confirmed against official documentation.

Related: [cloudflare-migration-plan.md](cloudflare-migration-plan.md) (hosting phases), [cloudflare-deployment.md](cloudflare-deployment.md) (runbook), [backlog.md](backlog.md).

## 1. Where things stand

- **Staging** runs entirely on one Cloudflare Worker at `https://staging.hybridtutors.co.uk` (web, API, jobs). Merging to `main` deploys it.
- **Verified end to end on staging:** a recorded lesson through to transcript and summary; sign-up with email confirmation through Resend; saving a card in the Stripe sandbox; Google sign-in as far as Google's own login page (a person must complete the last step once).
- **Brand:** the product is **Hybridtutors** (one word). Logo, colours (green `#58CC02`, violet `#7C5CFF`) and name are in the repo; see the memory note on branding.
- **Email:** Resend is the sender for Supabase Auth, with `hybridtutors.co.uk` verified. This replaced Supabase's built-in sender, which allowed about two emails an hour.
- **Production does not exist yet** (phase D of the migration plan).

## 2. Business structure: sole trader to start

Decision: launch as a **sole trader**, trading as Hybridtutors.

What this means:

- No Companies House registration. Register with **HMRC as self-employed** once income passes the trading allowance (£1,000, **verify**).
- **You are personally liable** for the business. This service handles children's data, lesson recordings and payments, so that is a real exposure. Strongly consider forming a limited company before real students pay. Incorporating is cheap and limits personal exposure, and it makes insurance, contracts and Stripe verification simpler. Moving later means re-papering Stripe, the legal pages and tutor agreements, so earlier is cheaper.
- **ICO data protection fee:** UK organisations that process personal data usually must pay it, including sole traders. A small business is normally in the lowest tier, about £40 to £52 a year (**verify the current figure**). Register through the ICO's self-assessment, found via [GOV.UK](https://www.gov.uk/data-protection-register-notify-ico-personal-data/how-much-it-costs).
- **Insurance:** consider public liability, professional indemnity and cyber cover before launch.
- **VAT:** only needed above the registration threshold (£90,000 at the time of writing, **verify**).

**Open item: the legal text still says "Hybridtutors Ltd".** The Terms and Privacy pages (`src/components/marketing/legal-document.tsx`, constant `LEGAL`) and the footer name a limited company. For a sole trader this must read "[your legal name], trading as Hybridtutors", with a real contact email. Needs from the founder: legal name and contact email. Until then the pages name a controller that does not exist.

## 3. Stripe: what to do, in order

These steps need personal and bank details, so the founder does them in the Stripe dashboard.

1. **Activate the account (live mode).** Business type **Individual / sole proprietor**. Provide legal name, date of birth, home address, phone, bank account for payouts, and an identity document. Website: `hybridtutors.co.uk` (the production site should be live before this is reviewed; staging works as a stopgap). Description: "online one-to-one A-Level tutoring marketplace". Statement descriptor: `HYBRIDTUTORS`.
2. **Enable Connect** (marketplace or platform). Accept the Connect terms. Stripe may review the platform before enabling live payouts.
3. **Branding** (Settings, Business, Branding): logo and colours.
4. **Keys:** the live secret key never goes in chat or a file. When production is built, the founder runs the secret-setting command themselves. Prefer a **restricted key** with only the permissions the app needs; the list will be produced when production is built.
5. **Staging stays on sandbox keys.** Nothing in the app changes until production exists.
6. **Publish a refund and cancellation policy** and link it. Stripe typically wants one on the site. The Terms currently do not cover refunds or cancellations; the founder needs to decide the rules (for example free cancellation up to 24 hours before a lesson).

Whether a sole trader can run a Connect platform in the UK is **not confirmed from Stripe's own documentation**; check by starting activation and reading what Connect offers. The general guidance is that sole traders need only HMRC registration ([Stripe's UK guide](https://stripe.com/resources/more/how-to-register-a-business-in-the-uk)).

## 4. Payments: the design and a cleaner alternative

### How it works today

Each lesson invoice is created on the **platform's** Stripe account and charged to the student. The tutor's share moves to their connected account with `transfer_data.destination`, and the platform keeps `application_fee_amount` (15%, `PLATFORM_FEE_RATE`). Connected accounts are created with `losses_collector: "application"` (`packages/data/src/stripe.ts`).

Consequence: this is a **destination charge**, so the platform (the founder, personally, as a sole trader) is the seller of record. Per [Stripe's risk guidance](https://docs.stripe.com/connect/risk-management), for charges created on the platform the platform is responsible for related negative balances. Refunds and card disputes land on the platform, and the setting above makes the platform liable for tutors' negative balances too.

### Recommended: direct charges

Charge **on the tutor's connected account** (direct charges). Stripe's guidance is that refunds and disputes then affect the connected account's balance, so the seller carries that risk, and Stripe recommends giving Stripe responsibility for negative balances on those accounts ([recommended integrations](https://docs.stripe.com/connect/integration-recommendations)). The platform still takes its fee through `application_fee_amount`.

| | Today (destination) | Direct charges |
| --- | --- | --- |
| Seller of record | Platform | The tutor |
| Who bears refunds and disputes | Platform | The tutor's balance |
| Negative balances | Platform (`losses_collector: application`) | Stripe, if set to `stripe` (**verify** it is allowed with the account type used) |
| Card statement and invoice name | Hybridtutors | The tutor (a platform note can be added) |
| Platform fee | Kept via application fee | Kept via application fee |
| Student support work | Platform | Still the platform in practice |

Changes needed to adopt it:

- Create the invoice with the connected account as the Stripe account (the `Stripe-Account` header) and keep `application_fee_amount`; drop `transfer_data`.
- The student's saved card lives on the platform customer. To charge on a tutor's account, the payment method must be shared or cloned to that account (Stripe supports sharing customers and payment methods across connected accounts; **verify** the exact calls and any fee impact).
- Set the account responsibilities so Stripe collects losses and requirements, and confirm which dashboard type Stripe allows with that combination.
- Tutor onboarding gets slightly heavier, because the tutor becomes the merchant. They already pass identity checks, so the extra friction is small.
- Update webhooks: events for direct charges arrive as Connect events carrying the account id, and the job code must handle that.
- Rewrite the tests that assume destination charges, and re-run the sandbox end-to-end card check.
- Update the Terms so the tutor is clearly the seller and responsible for refunds for lesson quality, with the platform handling only its own fee and support.

### Other options, and why I would not lead with them

- **Off-platform payment** (tutors invoice students themselves): zero liability for you, but you lose the fee, payment protection and the lesson history that makes the product worth using. Students and tutors also drift off-platform.
- **Pre-paid credits sold by the platform:** the platform is the seller and holds customers' money, which raises both liability and regulatory questions.
- **Other marketplace payment providers:** they also generally leave the platform responsible for sellers unless a Connect-style structure is used. Stripe Connect with direct charges is the cleanest fit for this app.

### Until the switch is made

If launch must happen before direct charges are built: form the limited company first, publish the refund policy, keep the lesson price small and the first lesson free (as now), and make the Terms explicit about who handles complaints. Reconsider before volumes grow.

## 5. Email

Resend sends Supabase Auth emails from the verified domain `hybridtutors.co.uk`. Custom SMTP lifts the old two-emails-an-hour cap (Supabase's default for a custom provider is about 30 new users an hour, adjustable under Authentication, Rate Limits). Resend's free tier is 100 emails a day and 3,000 a month, which a busy sign-up day could hit. The staging sign-up test (form, email, confirm link, saved card) passes through it.

Still to do:

- Confirm the sender name and address in a real email (it should read as Hybridtutors).
- Rename Supabase's email templates to the new brand.
- A mailbox for receiving: Resend only sends. A free option is Cloudflare Email Routing forwarding `hello@hybridtutors.co.uk` to the founder's mailbox, which also gives the Privacy policy a contact address.

## 6. Surfaces outside the repo that still need the new name

- **Google consent screen:** app name and logo (users see it when they click Sign in with Google).
- **Stripe:** business name, statement descriptor, branding.
- **Supabase:** Auth email templates and sender name.
- **Resend:** sender name.

## 7. Engineering still to do for production (phase D)

See the migration plan for detail. In short:

- A paid Supabase project and plan; production secrets and the `app.hybridtutors.co.uk` DNS.
- Production LiveKit server (reuse or add a second Hetzner box).
- Live Stripe keys set by the founder; a production OpenAI key, and rotating the current one; separate Deepgram keys already exist for staging and production.
- Auth IP forwarding secret for production (staging already has it).
- Re-verify database role timeouts, then observe for several days.
- Phase E retirement: old worker code, pg-boss, Docker, Caddy, Oracle VMs and the legacy Vercel projects, after production is stable.

## 8. Decisions waiting on the founder

1. Legal name and contact email for the legal pages (sole trader wording).
2. Refund and cancellation rules, for the policy and the Terms.
3. Whether to move to direct charges before launch (recommended) or form the company and launch on today's design.
4. When to form a limited company.
5. Whether to set up the `hello@` forwarding address.

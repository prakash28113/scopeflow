# Payments (Razorpay)

Paid plans are Razorpay **subscriptions** paid in Razorpay's own Checkout window (UPI, cards, netbanking).
ScopeFlow never sees card, UPI or bank details.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Plan & usage page | `src/routes/plan.tsx`, `src/lib/billing.ts` | "Upgrade to Solo" → opens Razorpay Checkout; "Cancel plan" |
| `billing` Edge Function | `supabase/functions/billing/` | `checkout` creates the Razorpay plan (once) and subscription; `verify` checks Checkout's signature (`HMAC-SHA256(payment_id + "|" + subscription_id, key secret)`) and applies the plan at once; `webhook` verifies Razorpay's signature (`HMAC-SHA256(raw body, webhook secret)`) and records each event once; `cancel` cancels at the end of the paid period |
| Database | `supabase/migrations/20261112000000_razorpay_billing.sql` | Prices (₹499/₹4,999 Solo, ₹999/₹9,999 Studio), checkout records, idempotent event processing. Only service role can call it |
| Release | `scripts/ci/release.mjs` | Copies the Razorpay secrets into the function's secrets, deploys the function, and puts plans on sale |

- The **key secret** and **webhook secret** live only in GitHub Actions secrets and Supabase function secrets. They
  never go into the repository, the app's JavaScript, or a `.env` file.
- **Test keys** (`rzp_test_…`): nothing is on sale; only accounts listed in `BILLING_TESTERS` see "Upgrade".
- **Live keys** (`rzp_live_…`): the plans in `config/public-site.json` → `billingPlans` go on sale (Solo; Studio stays in
  early access until its team and white-label features exist).
- The plan changes only after Razorpay confirms the payment. A failed renewal gives a 7-day grace period; exhausted retries move the
  account to Free limits. Nothing is ever deleted.

## Owner setup

1. **Razorpay account:** sign up at razorpay.com. Test mode works straight away; live mode needs KYC and website approval
   (the site has Terms, Privacy, Refund & cancellation, and Contact pages).
2. **API keys:** Razorpay Dashboard (Test mode) → Account & Settings → API Keys → Generate. Never paste them into chat or email.
3. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   - `RAZORPAY_KEY_ID`: `rzp_test_…` (later `rzp_live_…`)
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`: a long random password you choose
   - Variable `BILLING_TESTERS`: your own ScopeFlow account email(s), comma-separated
4. **Supabase token:** the `SUPABASE_ACCESS_TOKEN` must be allowed to manage **Edge Functions** and **Secrets**. If not, the
   release says so and leaves payments off.
5. **Release** (the usual "Make it live"). The run summary shows the webhook address.
6. **Webhook:** Razorpay Dashboard → Account & Settings → Webhooks → Add new webhook:
   - URL: `https://<project-ref>.supabase.co/functions/v1/billing/webhook` (from the run summary)
   - Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
   - Events: all `subscription.*` events
7. **Test purchase:** sign in with a tester account → Plan & usage → Upgrade to Solo. Pay with a Razorpay test card
   (e.g. 5312 6865 5677 9641, any future expiry, any CVV). Solo switches on, the payment shows under Billing history, and
   Cancel plan keeps Solo until the period ends.
8. **Going live:** after KYC approval, generate live keys, replace the three secrets with live values, add a live-mode
   webhook (same URL, new secret → update `RAZORPAY_WEBHOOK_SECRET`), and release.

Fees: Razorpay charges a percentage per successful payment; there's no monthly fee. Whether to charge GST on plan
prices depends on your registration; check with a tax adviser before going live.

## Checks

`tests/db/razorpay.test.ts` (database), `tests/unit/billing-handler.test.ts` (function), `tests/unit/release-deploy.test.ts`
(release), and the e2e step "paid plans", which runs the real function against a Razorpay stand-in.

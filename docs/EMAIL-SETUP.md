# Turning on password-reset emails (free, about 15 minutes, works from a phone)

ScopeFlow's password-reset pages are built and tested. They stay switched off because Supabase's built-in email only reaches members of your Supabase team, so other freelancers would never get the link. A free email provider fixes that.

**Cost:** ₹0. Brevo's free plan sends up to 300 emails a day, far more than password resets need.
**Who does it:** you, in the Brevo, Cloudflare and Supabase dashboards. Never paste the SMTP key into a chat; it goes only into Supabase.

## 1. Create a free Brevo account
1. Open brevo.com → **Sign up free**, using your own email.
2. Skip any paid-plan offers; stay on **Free**.

## 2. Let Brevo send as `no-reply@scopeflow.in`
1. Brevo → **Senders, Domains & Dedicated IPs → Domains → Add a domain** → `scopeflow.in`.
2. Brevo shows a few DNS records (a Brevo code, DKIM and DMARC). Because scopeflow.in uses Cloudflare, Brevo may offer to add them for you; if not:
   Cloudflare → **scopeflow.in → DNS → Records → Add record**, and copy each record exactly (type, name, value). For CNAME records, set the proxy to **DNS only** (grey cloud).
3. Back in Brevo, tap **Authenticate**. It usually turns green within minutes but can take up to 48 hours.
4. Brevo → **Senders → Add a sender**: name `ScopeFlow`, email `no-reply@scopeflow.in`.

## 3. Get the SMTP details
Brevo → **SMTP & API → SMTP** tab:
- **SMTP server:** `smtp-relay.brevo.com`, **Port:** `587`
- **Login:** shown on that page (usually like `xxxxxx@smtp-brevo.com`; older accounts use the account email)
- **SMTP key:** tap **Generate a new SMTP key**, name it `supabase`, and keep the page open. The key is shown only once.

## 4. Put them into Supabase
Supabase → your ScopeFlow project → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `no-reply@scopeflow.in` (must exactly match the Brevo sender) |
| Sender name | `ScopeFlow` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | the Brevo **Login** |
| Password | the Brevo **SMTP key** |

Save. Supabase now sends through Brevo. Its default limit is about 30 auth emails an hour, which is plenty; it's under **Authentication → Rate Limits** if you ever need more.

*(Optional)* **Authentication → Emails → Templates → Reset password**: change the subject to "Reset your ScopeFlow password". Keep `{{ .ConfirmationURL }}` in the body.

## 5. Test it
Open scopeflow.in/forgot-password. Until step 6 it shows the "email support" message, so test this way instead: in Supabase → **Authentication → Users**, open your user → **Send password recovery**. The email should arrive from `no-reply@scopeflow.in` within a minute. If it lands in spam, wait for the Brevo domain to finish authenticating.

## 6. Tell Claude "email is set up"
Claude then switches `passwordResetEmail` to `true` in `config/public-site.json`, runs all checks and asks for your approval to release. After release:
- **Sign in → Forgot your password?** sends a reset link (the same message whether or not the account exists, so nobody can probe for accounts);
- the link opens `/reset-password`, which removes the one-time code from the address bar, asks for the new password twice and signs you in;
- links work once, expire after an hour and can only return to ScopeFlow's own addresses (the release sets Supabase's redirect allow-list automatically).

**To undo:** turn off custom SMTP in Supabase, or ask Claude to set the flag back to `false`. Nothing else changes.

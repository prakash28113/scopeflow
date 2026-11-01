import type { ReactNode } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/ui";
import { BetaBadge, SiteFooter } from "@/components/site-footer";
import { LEGAL_UPDATED, SUPPORT_EMAIL, supportMailto } from "@/lib/site";

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" aria-label="ScopeFlow home">
          <Logo className="text-[15px]" />
        </Link>
        <BetaBadge />
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-8 pt-8 sm:px-6">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-2 text-[13px] text-muted">Last updated {LEGAL_UPDATED}</p>
        <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-ink-2 [&_h2]:mb-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

const Contact = () => (
  <a href={supportMailto("ScopeFlow privacy")} className="font-medium text-accent hover:underline">
    {SUPPORT_EMAIL}
  </a>
);

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <section>
        <p>
          ScopeFlow helps freelancers and studios agree project scope with their clients. This policy explains what we store, why, and
          the choices you have. ScopeFlow is currently a free beta run by an independent developer in India. Questions: <Contact />.
        </p>
      </section>
      <section>
        <h2>What we store</h2>
        <ul>
          <li><strong>Your account:</strong> name, email address and a securely hashed password. We never see your password.</li>
          <li><strong>Your business details:</strong> what you enter in onboarding and settings, such as business name and currency.</li>
          <li><strong>Your projects:</strong> client names and email addresses, deliverables, prices, dates, milestones, change orders and payments you record.</li>
          <li>
            <strong>Client decisions:</strong> when your client approves, declines or requests changes through a client link, we record
            the name they enter, any comment, the time, and their IP address and browser type. This is the evidence of who approved what,
            and it can&apos;t be edited afterwards.
          </li>
          <li><strong>Abuse protection:</strong> a one-way hash of visitors&apos; IP addresses to limit excessive requests. These counters are deleted within a day.</li>
        </ul>
      </section>
      <section>
        <h2>What we don&apos;t do</h2>
        <ul>
          <li>No advertising, tracking or analytics cookies. Your browser only keeps your sign-in session.</li>
          <li>We don&apos;t sell or share your data, and we don&apos;t email your clients. You share client links yourself.</li>
          <li>We don&apos;t process payments or store card details.</li>
        </ul>
      </section>
      <section>
        <h2>Where it&apos;s kept</h2>
        <p>
          Data is stored with Supabase (database and sign-in) and the app is served by Cloudflare. Password-reset emails are sent through Brevo, which receives only your email address and the reset link. These providers may process data outside India.
          Access to your data is restricted by database security rules: only you can see your projects, and a client link shows only that
          one project&apos;s client-facing details.
        </p>
      </section>
      <section>
        <h2>Your clients&apos; information</h2>
        <p>
          You decide what client information to add and are responsible for having a reason to share it with us. If your client asks
          about their data, you can edit or delete draft projects, or contact us for help.
        </p>
      </section>
      <section>
        <h2>Keeping and deleting data</h2>
        <p>
          We keep your data while your account is active. To get a copy, correct something, or delete your account and projects, email{" "}
          <Contact /> from your account email. Approved scope records are kept unchanged for as long as the project exists, because that
          is their purpose.
        </p>
      </section>
      <section>
        <h2>Beta</h2>
        <p>
          ScopeFlow is in beta. Supabase&apos;s free plan has no automatic backups, so keep your own copies of anything critical. We&apos;ll
          update this policy as the product changes and show the date at the top.
        </p>
      </section>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Use">
      <section>
        <p>
          By creating an account you agree to these terms. If you don&apos;t agree, please don&apos;t use ScopeFlow. Questions: <Contact />.
        </p>
      </section>
      <section>
        <h2>The service</h2>
        <ul>
          <li>ScopeFlow is a free beta. Features may change, and the service may be paused or discontinued with reasonable notice where possible.</li>
          <li>It is provided &ldquo;as is&rdquo;, without guarantees of availability or fitness for a particular purpose.</li>
          <li>ScopeFlow records agreements and payments you enter. It isn&apos;t a payment processor, a law firm or a substitute for a written contract or legal advice. UPI payments go directly from your client to your UPI ID; ScopeFlow never receives, holds or confirms them, so check your bank app and mark payments as received yourself.</li>
        </ul>
      </section>
      <section>
        <h2>Your account</h2>
        <ul>
          <li>Use your own email address and keep your password safe. If you forget it, use “Forgot your password?” on the sign-in page; the reset link is sent to your account email.</li>
          <li>You&apos;re responsible for what you and your clients enter, and for having the right to share client details with us.</li>
          <li>Keep client links private. Anyone with a link can view and act on that project until you replace or revoke it.</li>
        </ul>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Don&apos;t use ScopeFlow for anything unlawful, to send spam, to impersonate others, or to try to access accounts or data that
          aren&apos;t yours. We may suspend accounts that do.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          Your projects remain yours. You allow us to store and display them only to run the service for you and the clients you share
          them with.
        </p>
      </section>
      <section>
        <h2>Liability</h2>
        <p>
          To the extent the law allows, ScopeFlow isn&apos;t liable for indirect losses, lost profits or lost data arising from use of the
          beta. Keep your own records of important agreements.
        </p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>
          We may update these terms; the date at the top shows the latest version. See also our{" "}
          <Link to="/privacy" className="font-medium text-accent hover:underline">Privacy Policy</Link>.
        </p>
      </section>
    </LegalLayout>
  );
}

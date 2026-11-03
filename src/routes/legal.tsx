import type { ReactNode } from "react";
import { Link } from "react-router";
import { PublicHeader } from "@/components/public-header";
import { BetaBadge, SiteFooter } from "@/components/site-footer";
import { LEGAL_UPDATED, OPERATOR_NAME, SUPPORT_EMAIL, supportMailto } from "@/lib/site";
import { useSeo } from "@/lib/seo";

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <PublicHeader badge={<BetaBadge />} />
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

const Contact = ({ subject = "ScopeFlow privacy" }: { subject?: string }) => (
  <a href={supportMailto(subject)} className="font-medium text-accent hover:underline">
    {SUPPORT_EMAIL}
  </a>
);

export function PrivacyPage() {
  useSeo("/privacy");
  return (
    <LegalLayout title="Privacy Policy">
      <section>
        <p>
          ScopeFlow helps freelancers and studios agree project scope with their clients. This policy explains what we store, why, and
          the choices you have. ScopeFlow is run by {OPERATOR_NAME}, an independent developer in Hyderabad, India, and is in beta with a free plan. Questions: <Contact />.
        </p>
      </section>
      <section>
        <h2>What we store</h2>
        <ul>
          <li><strong>Your account:</strong> name, email address and a securely hashed password. We never see your password. If you continue with Google, Google shares only your name, email address and profile picture with us, and we never see your Google password.</li>
          <li><strong>Your business details:</strong> what you enter in onboarding and settings, such as business name, currency, UPI ID, business address, GSTIN and invoice prefix.</li>
          <li><strong>Your clients:</strong> names, email addresses, company, phone, billing address, GSTIN and your private notes about them (never shown to the client).</li>
          <li><strong>Your projects and money records:</strong> deliverables, prices, dates, milestones, change orders, requests you log for a client, invoices you issue (with the seller and buyer details on them), payments you record (amount, date, method, reference), your expense log and your follow-up reminders.</li>
          <li>
            <strong>Client decisions:</strong> when your client approves, declines or requests changes through a client link, we record
            the name they enter, any comment, the time, and their IP address and browser type. This is the evidence of who approved what,
            and it can&apos;t be edited afterwards.
          </li>
          <li><strong>How you found us:</strong> if you arrived from a link with campaign tags (utm_source, utm_medium, utm_campaign) or from another website, your browser keeps that for up to 30 days, and it&apos;s saved with your account when you sign up. We use it only to count which channels bring sign-ups.</li>
          <li><strong>Abuse protection:</strong> a one-way hash of visitors&apos; IP addresses to limit excessive requests. These counters are deleted within a day.</li>
        </ul>
      </section>
      <section>
        <h2>What we don&apos;t do</h2>
        <ul>
          <li>No advertising, tracking or analytics cookies. Your browser only keeps your sign-in session and, if you came from a campaign link or another site, where you came from (above).</li>
          <li>We count visits with Cloudflare Web Analytics, which uses no cookies, doesn&apos;t follow you across other websites and doesn&apos;t identify you.</li>
          <li>We don&apos;t sell or share your data, and we don&apos;t email your clients. You share client links yourself.</li>
          <li>We never see or store your card, UPI or bank details. If you buy a paid plan, you pay in Razorpay&apos;s own payment window.</li>
        </ul>
      </section>
      <section>
        <h2>Where it&apos;s kept</h2>
        <p>
          Data is stored with Supabase (database and sign-in) and the app is served by Cloudflare. Once a week the database is backed up so it can be restored after an outage: the backup is encrypted (AES-256) as it is made, stored with GitHub for up to 90 days, and can&apos;t be opened without a passphrase only the operator holds. Password-reset emails are sent through Brevo, which receives only your email address and the reset link. If you buy a paid plan, Razorpay (Razorpay Software Private Limited) processes the payment: it receives your name, email address and the payment details you enter, under its own privacy policy, and we receive back only the payment&apos;s amount, status, date and references. These providers may process data outside India.
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
          ScopeFlow is in beta. ScopeFlow keeps a weekly encrypted backup, so up to a week of changes could be lost in a serious outage; keep your own copies of anything critical. We&apos;ll
          update this policy as the product changes and show the date at the top.
        </p>
      </section>
    </LegalLayout>
  );
}

/** Plain-language Terms & Conditions. Operator and courts confirmed by the owner (1 Nov 2026). */
const OPERATOR = OPERATOR_NAME;
const COURTS = "Hyderabad, Telangana";
const CITY = "Hyderabad, Telangana";

export function TermsPage() {
  useSeo("/terms");
  const Mail = () => <Contact subject="ScopeFlow terms" />;
  return (
    <LegalLayout title="Terms & Conditions">
      <section>
        <p>
          These terms are an agreement between you and {OPERATOR}, who runs ScopeFlow (&ldquo;ScopeFlow&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;). By creating an account or using ScopeFlow you agree to them. If you don&apos;t agree, please don&apos;t use
          ScopeFlow. Questions: <Mail />.
        </p>
      </section>

      <section>
        <h2>1. Who can use ScopeFlow</h2>
        <ul>
          <li>You must be at least 18 and able to enter into a binding contract under Indian law.</li>
          <li>If you use ScopeFlow for a business, you confirm you&apos;re allowed to accept these terms for it.</li>
        </ul>
      </section>

      <section>
        <h2>2. What ScopeFlow does, and doesn&apos;t do</h2>
        <ul>
          <li>ScopeFlow helps you write a project scope, share it with your client by link, record their approval, count revisions, price extra work as change orders and keep track of payments.</li>
          <li>The agreement about the work is between <strong>you and your client</strong>. ScopeFlow is not a party to it, doesn&apos;t check the work and doesn&apos;t settle disputes between you.</li>
          <li>ScopeFlow keeps a record of what was approved and when. It isn&apos;t a law firm, and it isn&apos;t a substitute for legal advice or a formal contract where you need one.</li>
          <li>Templates and the scope checker are suggestions. You decide what goes into your agreements.</li>
        </ul>
      </section>

      <section>
        <h2>3. Your account</h2>
        <ul>
          <li>Give accurate details and use an email address you control. One account is for one person.</li>
          <li>Keep your password safe. You&apos;re responsible for activity on your account. Tell us at once if you think someone else has accessed it.</li>
          <li>If you forget your password, use &ldquo;Forgot your password?&rdquo; on the sign-in page; the reset link is sent to your account email.</li>
        </ul>
      </section>

      <section>
        <h2>4. Your clients and client links</h2>
        <ul>
          <li>Your clients don&apos;t need an account. They open the link you share, and can review, approve, request changes and see payments.</li>
          <li>Anyone who has a client link can view and act on that project until the link expires, or you replace or revoke it. Share links only with your client and keep them private.</li>
          <li>Actions taken through a client link (such as approving a scope or a change order) are recorded as your client&apos;s actions. Approved versions can&apos;t be edited afterwards.</li>
          <li>You&apos;re responsible for having your client&apos;s permission to store their name, email and other details in ScopeFlow and to share project links with them.</li>
        </ul>
      </section>

      <section>
        <h2>5. Plans and fees</h2>
        <ul>
          <li>The <strong>Free plan</strong> costs nothing and has the limits shown on the <Link to="/pricing" className="font-medium text-accent hover:underline">Pricing</Link> page (currently 2 active projects and 5 clients).</li>
          <li><strong>Paid plans</strong> are subscriptions, priced in Indian rupees and billed in advance, monthly or yearly, through Razorpay. A plan marked &ldquo;Not on sale yet&rdquo; can&apos;t be bought. You&apos;re charged only after you choose a paid plan yourself and approve the payment in Razorpay&apos;s window.</li>
          <li>A subscription renews automatically at the end of each period, at the price you signed up at, until you cancel. You can cancel at any time from Plan &amp; usage; you keep the paid plan until the end of the period already paid for, and you won&apos;t be charged again.</li>
          <li>If a renewal payment fails, Razorpay retries it. Paid features stay on for a short grace period; if the payment still fails, the account moves to the Free plan&apos;s limits.</li>
          <li>Refunds follow our <Link to="/refunds" className="font-medium text-accent hover:underline">Refund and cancellation policy</Link>.</li>
          <li>If a paid plan ends or you move to a lower plan, your existing projects, client links and approval records keep working. Only new projects above the plan&apos;s limits are blocked.</li>
          <li>We may change plan limits or prices in the future. A new price applies to a plan you pay for only from a renewal at least 30 days after we tell you, and you can cancel before it does.</li>
        </ul>
      </section>

      <section>
        <h2>6. Payments between you and your client</h2>
        <ul>
          <li>ScopeFlow is not a payment service. It never receives, holds, transfers or refunds money between you and your client.</li>
          <li>If you add a UPI ID, your client&apos;s UPI app pays you directly. ScopeFlow can&apos;t see or confirm those payments. Check your bank or UPI app, then mark a payment as received yourself.</li>
          <li>Invoices, taxes (including GST) and any payment disputes are between you and your client.</li>
        </ul>
      </section>

      <section>
        <h2>7. Acceptable use</h2>
        <p>Don&apos;t use ScopeFlow to:</p>
        <ul>
          <li>do anything unlawful, fraudulent or misleading, or collect payments for goods or services you don&apos;t provide;</li>
          <li>upload content that is defamatory, obscene, hateful, or that infringes someone else&apos;s rights;</li>
          <li>send spam, impersonate anyone, or share client links with people who aren&apos;t part of the project;</li>
          <li>try to access accounts or data that aren&apos;t yours, test or bypass our security, or overload or disrupt the service;</li>
          <li>copy, resell or reverse-engineer the service, or access it with bots or scrapers.</li>
        </ul>
      </section>

      <section>
        <h2>8. Your content and our rights</h2>
        <ul>
          <li>Your projects, agreements and client details remain yours. You give us permission to store, process and display them only to run ScopeFlow for you and the clients you share them with.</li>
          <li>The ScopeFlow name, logo, design and software belong to {OPERATOR}. These terms don&apos;t give you any rights to them beyond using the service.</li>
          <li>If you send us feedback or ideas, we may use them to improve ScopeFlow without owing you anything.</li>
        </ul>
      </section>

      <section>
        <h2>9. Privacy</h2>
        <p>
          How we handle personal data is explained in our{" "}
          <Link to="/privacy" className="font-medium text-accent hover:underline">Privacy Policy</Link>, which is part of these terms.
        </p>
      </section>

      <section>
        <h2>10. Availability and changes to the service</h2>
        <ul>
          <li>ScopeFlow is in beta. We work to keep it available and your data safe, but we can&apos;t promise it will always be available, error-free or never lose data. Keep your own copies of important agreements (the printable quote and PDF help with this).</li>
          <li>We may add, change or remove features. If we ever shut ScopeFlow down, we&apos;ll give at least 30 days&apos; notice by email where possible, so you can save your records.</li>
        </ul>
      </section>

      <section>
        <h2>11. Suspension and closing your account</h2>
        <ul>
          <li>You can stop using ScopeFlow at any time. To delete your account and projects, email <Mail /> from your account email.</li>
          <li>We may suspend or close an account that breaks these terms or the law, or that puts other users or the service at risk. Where reasonable, we&apos;ll tell you why first.</li>
          <li>When an account is closed, its client links stop working.</li>
        </ul>
      </section>

      <section>
        <h2>12. Disclaimer</h2>
        <p>
          ScopeFlow is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent the law allows, we make no promises
          about it beyond those in these terms, including that it will suit a particular purpose.
        </p>
      </section>

      <section>
        <h2>13. Limitation of liability</h2>
        <p>
          To the extent the law allows, we aren&apos;t liable for indirect or consequential losses, lost profits, lost business or lost
          data. We also aren&apos;t liable for disputes between you and your clients. Our total liability for any claim about ScopeFlow
          is limited to the greater of the amount you paid us in the 12 months before the claim and ₹1,000. Nothing in these terms
          limits liability that can&apos;t be limited by law.
        </p>
      </section>

      <section>
        <h2>14. Indemnity</h2>
        <p>
          If someone makes a claim against us because of content you put into ScopeFlow, your dealings with your clients, or your
          breach of these terms or the law, you agree to cover our reasonable losses and costs from that claim.
        </p>
      </section>

      <section>
        <h2>15. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of India. Please contact us first; most issues can be sorted out quickly. Any dispute
          that can&apos;t be resolved informally will be handled exclusively by the courts at {COURTS}.
        </p>
      </section>

      <section>
        <h2>16. Grievance officer</h2>
        <p>
          In line with the Information Technology Act, 2000 and the rules under it, complaints about content on ScopeFlow or about
          these terms can be sent to our grievance officer, <strong>{OPERATOR}</strong>, at <Mail />. We&apos;ll acknowledge your
          complaint within 24 hours and aim to resolve it within 15 days.
        </p>
      </section>

      <section>
        <h2>17. Changes to these terms</h2>
        <p>
          We may update these terms. The date at the top shows the latest version. For important changes, we&apos;ll tell you by email
          or in the app at least 7 days before they apply. If you keep using ScopeFlow after that, you accept the new terms.
        </p>
      </section>

      <section>
        <h2>18. Contact</h2>
        <p>
          {OPERATOR}, ScopeFlow · <Mail />
        </p>
      </section>
    </LegalLayout>
  );
}

export function RefundsPage() {
  useSeo("/refunds");
  return (
    <LegalLayout title="Refund and cancellation policy">
      <section>
        <p>
          This policy covers payments for ScopeFlow&apos;s paid plans. ScopeFlow never handles money between you and your clients, so it
          can&apos;t refund those payments: ask your client or freelancer directly.
        </p>
      </section>
      <section>
        <h2>Cancelling</h2>
        <ul>
          <li>You can cancel a paid plan at any time from Plan &amp; usage in your account. No email or call is needed.</li>
          <li>After you cancel, you keep the paid plan until the end of the period you&apos;ve already paid for, and you won&apos;t be charged again.</li>
          <li>When the period ends, the account moves to the Free plan&apos;s limits. Nothing is deleted: every project, client link and approval record keeps working.</li>
        </ul>
      </section>
      <section>
        <h2>Refunds</h2>
        <ul>
          <li>We refund in full if you were charged by mistake, charged twice for the same period, or charged after you cancelled. Write to <Contact subject="ScopeFlow refund" /> within 7 days of the charge, from your account email.</li>
          <li>Otherwise, payments for a period that has started aren&apos;t refunded, including for the unused part of a month or year; cancelling stops the next charge.</li>
          <li>If ScopeFlow is unavailable for a long time or we close a paid plan, we refund the unused part of the period you paid for.</li>
          <li>Approved refunds are made to the original payment method through Razorpay. We confirm by email within 2 working days of approving; banks usually show the money within 5 to 7 working days.</li>
        </ul>
      </section>
      <section>
        <h2>Delivery</h2>
        <p>
          ScopeFlow is an online service: nothing is shipped. A paid plan starts as soon as Razorpay confirms the payment, usually within a
          minute, and you can see it on the Plan &amp; usage page. If it hasn&apos;t started within an hour of paying, write to <Contact subject="ScopeFlow payment" />.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          {OPERATOR}, ScopeFlow, {CITY} · <Contact subject="ScopeFlow refund" />
        </p>
      </section>
    </LegalLayout>
  );
}

export function ContactPage() {
  useSeo("/contact");
  return (
    <LegalLayout title="Contact us">
      <section>
        <p>
          ScopeFlow is run by <strong>{OPERATOR}</strong>, an independent developer in {CITY}, India.
        </p>
      </section>
      <section>
        <h2>Email</h2>
        <p>
          For support, billing, refunds, privacy requests or feedback: <Contact subject="ScopeFlow support" />. We usually reply within 1
          working day.
        </p>
      </section>
      <section>
        <h2>Complaints</h2>
        <p>
          Our grievance officer is {OPERATOR}, at the same email address. We acknowledge complaints within 24 hours and aim to resolve them
          within 15 days. See the <Link to="/terms" className="font-medium text-accent hover:underline">Terms &amp; Conditions</Link>.
        </p>
      </section>
    </LegalLayout>
  );
}

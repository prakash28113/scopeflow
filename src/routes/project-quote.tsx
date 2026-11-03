import { Link, useParams } from "react-router";
import { Alert } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { AgreementTerms } from "@/components/agreement";
import { DownloadPdfButton, PrintButton, QuoteTable, pricingFrom } from "@/components/quote";
import { useProject } from "@/lib/queries";
import { displayName, useProfile } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { shortHash } from "@/lib/format";
import NotFound from "./not-found";
import { Party } from "@/components/invoice-document";
import type { InvoiceParty } from "@/lib/invoice";
import { stateName, stateOf } from "@/lib/gst";

const stateLabel = (code: string | null) => (code ? `${stateName(code)} (${code})` : undefined);

/** A clean, printable quote. Uses the latest version sent to the client, or the current draft. */
export default function ProjectQuotePage() {
  const { id } = useParams();
  const q = useProject(id);
  const profile = useProfile();
  if (q.isLoading || profile.isLoading) return <PageSpinner />;
  if (q.isError) return <Alert>Couldn't load this project. Please refresh.</Alert>;
  if (!q.data) return <NotFound />;
  const { project: p, snapshots } = q.data;
  const sent = snapshots[0];
  const d = sent
    ? { ...sent.data, pricing: sent.data.pricing ?? null }
    : {
        title: p.title,
        summary: p.summary,
        currency: p.currency,
        budget_cents: Number(p.budget_cents),
        start_date: p.start_date,
        due_date: p.due_date,
        exclusions: p.exclusions,
        terms: p.terms,
        extra_revision_cents: p.extra_revision_cents,
        valid_until: p.valid_until ?? null,
        client: { name: p.clients.name, company: p.clients.company },
        deliverables: p.deliverables,
        milestones: p.milestones,
        pricing: pricingFrom(p.deliverables, p.discount_bps, p.tax_bps, p.tax_label),
      };
  const from = profile.data ? profile.data.business_name || displayName(profile.data) : "";
  const seller: InvoiceParty = {
    name: from,
    person: profile.data?.business_name ? (profile.data.full_name ?? undefined) : undefined,
    email: profile.data?.email,
    address: profile.data?.business_address ?? undefined,
    gstin: profile.data?.gstin ?? undefined,
    state: stateLabel(stateOf(profile.data)),
  };
  const buyer: InvoiceParty = {
    name: d.client.name,
    company: d.client.company ?? undefined,
    email: p.clients.email,
    address: p.clients.billing_address ?? undefined,
    gstin: p.clients.gstin ?? undefined,
    state: stateLabel(stateOf(p.clients)),
  };
  const fmt = (n: number) => formatMoney(Number(n), d.currency);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/projects/${p.id}`} className="text-[13px] text-muted hover:text-ink">
          ← {p.title}
        </Link>
        <div className="flex gap-2">
          <PrintButton label="Print" size="md" />
          <DownloadPdfButton name={`Quote ${p.quote_number ? `${p.quote_number} ` : ""}${d.title}`} size="md" variant="primary" />
        </div>
      </div>
      <article data-print-scope className="rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10">
        <header className="border-b border-line pb-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">Quote</p>
          {p.quote_number ? (
            <p className="num mt-1 text-[15px] font-semibold" data-testid="quote-number">
              {p.quote_number}
            </p>
          ) : null}
          <h1 className="display mt-1 text-[26px] font-semibold leading-tight">{d.title}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {sent ? `Version ${sent.version} · ${formatDate(sent.created_at)} · ref ${shortHash(sent.content_hash)}` : `Draft · ${formatDate(new Date().toISOString())} · the quote number is given when you send it`}
          </p>
          <div className="mt-5 grid gap-6 sm:grid-cols-2" data-testid="quote-parties">
            <Party label="From" p={seller} />
            <Party label="Prepared for" p={buyer} />
          </div>
        </header>

        {d.summary ? <p className="whitespace-pre-line border-b border-line py-5 text-sm leading-relaxed text-ink-2">{d.summary}</p> : null}

        <section className="border-b border-line py-5">
          {d.pricing ? (
            <QuoteTable lines={d.deliverables} pricing={d.pricing} currency={d.currency} />
          ) : (
            <>
              <ul className="space-y-2 text-[13px]">
                {d.deliverables.map((x) => (
                  <li key={x.id}>{x.title}</li>
                ))}
              </ul>
              <p className="num mt-4 flex justify-between border-t border-line-strong pt-2 text-[15px] font-semibold">
                <span>Total</span>
                <span>{fmt(d.budget_cents)}</span>
              </p>
            </>
          )}
        </section>

        <section className="grid grid-cols-2 gap-4 border-b border-line py-5 text-[13px]">
          <div>
            <p className="text-muted">Start</p>
            <p className="font-medium">{formatDate(d.start_date)}</p>
          </div>
          <div>
            <p className="text-muted">Due</p>
            <p className="font-medium">{formatDate(d.due_date)}</p>
          </div>
          {d.valid_until ? (
            <div>
              <p className="text-muted">Valid until</p>
              <p className="font-medium">{formatDate(d.valid_until)}</p>
            </div>
          ) : null}
        </section>

        {d.milestones.length ? (
          <section className="border-b border-line py-5">
            <h2 className="mb-2 text-[13px] font-semibold">Payment schedule</h2>
            <ul className="space-y-1.5 text-[13px]">
              {d.milestones.map((m, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {m.title}
                    {m.due_date ? <span className="text-muted"> · {formatDate(m.due_date)}</span> : null}
                  </span>
                  <span className="num">{fmt(m.amount_cents)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <AgreementTerms exclusions={d.exclusions} terms={d.terms} extraRevisionCents={d.extra_revision_cents} currency={d.currency} className="border-t-0 [&>section]:px-0" />

        <p className="mt-6 text-[11px] text-muted">
          {sent ? "This quote matches the version shared with the client for approval." : "Draft — not yet sent to the client."} Prepared with ScopeFlow.
        </p>
      </article>
    </div>
  );
}

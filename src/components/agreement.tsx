import { Meter, cx } from "./ui";
import { formatMoney } from "@/lib/money";
import { splitLines } from "@/lib/validation";

/** "Not included", extra-revision price and terms — shown identically to freelancer and client. */
export function AgreementTerms({
  exclusions,
  terms,
  extraRevisionCents,
  currency,
  className,
}: {
  exclusions?: string | null;
  terms?: string | null;
  extraRevisionCents?: number | null;
  currency: string;
  className?: string;
}) {
  const items = splitLines(exclusions);
  const hasPrice = extraRevisionCents !== null && extraRevisionCents !== undefined;
  if (!items.length && !terms && !hasPrice) return null;
  return (
    <div className={cx("divide-y divide-line border-t border-line", className)}>
      {items.length ? (
        <section className="px-5 py-4">
          <h3 className="text-[13px] font-semibold text-ink">Not included</h3>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
            {items.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mt-[7px] h-px w-2.5 shrink-0 bg-line-strong" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hasPrice ? (
        <section className="flex items-baseline justify-between gap-4 px-5 py-4">
          <h3 className="text-[13px] font-semibold text-ink">Each extra revision round</h3>
          <p className="num text-sm font-medium">{formatMoney(Number(extraRevisionCents), currency)}</p>
        </section>
      ) : null}
      {terms ? (
        <section className="px-5 py-4">
          <h3 className="text-[13px] font-semibold text-ink">Terms</h3>
          <p className="mt-1.5 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink-2">{terms}</p>
        </section>
      ) : null}
    </div>
  );
}

export function revisionLabel(used: number, included: number): string {
  if (included === 0) return used ? `No revisions included · ${used} extra` : "No revisions included";
  if (used < included) return `${used} of ${included} used · ${included - used} left`;
  if (used === included) return `All ${included} used`;
  return `All ${included} used · ${used - included} extra`;
}

/** Included / used / remaining revision rounds for one deliverable. */
export function RevisionMeter({ used, included }: { used: number; included: number }) {
  return (
    <div className="mt-3 max-w-xs">
      <Meter value={used} max={included} tone={used >= included ? "warning" : "accent"} />
      <p className={cx("num mt-1.5 text-[12px]", used >= included ? "text-warning" : "text-muted")}>{revisionLabel(used, included)}</p>
    </div>
  );
}

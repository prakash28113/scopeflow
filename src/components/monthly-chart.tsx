import { useEffect, useRef, useState } from "react";
import { formatMoney, minorDigits } from "@/lib/money";
import { monthLabel, niceScale, type MonthRow } from "@/lib/analytics";

/**
 * Received vs expenses per month: grouped columns on one axis.
 * Palette validated (scripts/validate_palette.js): received #005dd4, expenses #eb6834; all checks pass in light mode.
 * Columns ≤ 24px, 4px rounded tops, 2px surface gap between the pair; hover/tap a month for the tooltip;
 * a table view carries every value.
 */
const RECEIVED = "#005dd4";
const EXPENSES = "#eb6834";
const WIDE = { W: 720, H: 240, left: 56 };
/** Phones: fewer months in a narrower drawing, so labels render at a readable size. */
const NARROW = { W: 360, H: 220, left: 48 };
const NARROW_BELOW_PX = 520;
const NARROW_MONTHS = 6;

function compact(minor: number, currency: string) {
  const major = minor / 10 ** minorDigits(currency);
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(major);
}

export function MonthlyChart({ rows: allRows, currency, selected, onSelect }: { rows: MonthRow[]; currency: string; selected: string; onSelect: (m: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setNarrow(el.getBoundingClientRect().width < NARROW_BELOW_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = narrow ? NARROW : WIDE;
  const { W, H } = size;
  const PAD = { top: 12, right: 8, bottom: 28, left: size.left };
  const rows = narrow ? allRows.slice(-NARROW_MONTHS) : allRows;
  const scale = niceScale(Math.max(...rows.map((r) => Math.max(r.received, r.expenses)), 0));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / rows.length;
  const bar = Math.min(18, (band - 10) / 2);
  const y = (v: number) => PAD.top + plotH - (v / scale.max) * plotH;
  const col = (x: number, v: number, color: string) => {
    if (v <= 0) return null;
    const top = y(v);
    const h = PAD.top + plotH - top;
    const r = Math.min(4, h);
    return <path d={`M${x},${PAD.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${PAD.top + plotH} Z`} fill={color} />;
  };
  const active = rows.find((r) => r.month === (hover ?? ""));
  const fmt = (n: number) => formatMoney(n, currency);

  return (
    <div ref={box} data-testid="monthly-chart" data-months={rows.length}>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-2" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: RECEIVED }} /> Received
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: EXPENSES }} /> Expenses
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Money received and expenses per month in ${currency}, last ${rows.length} months. Values for all 12 months are in the table below.`}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e6e6e1" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
                {compact(t, currency)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x0 = PAD.left + i * band;
            const pair = bar * 2 + 2;
            const left = x0 + (band - pair) / 2;
            const isSel = r.month === selected;
            return (
              <g key={r.month}>
                {isSel ? <rect x={x0 + 1} y={PAD.top} width={band - 2} height={plotH} rx={6} fill="#ebf3fe" /> : null}
                {col(left, r.received, RECEIVED)}
                {col(left + bar + 2, r.expenses, EXPENSES)}
                <text x={x0 + band / 2} y={H - 8} textAnchor="middle" className={`text-[11px] ${isSel ? "fill-ink font-semibold" : "fill-muted"}`}>
                  {monthLabel(r.month)}
                </text>
                {/* Hit target: the whole month band, bigger than the marks. */}
                <rect
                  x={x0}
                  y={0}
                  width={band}
                  height={H}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(r.month)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect(r.month)}
                >
                  <title>{monthLabel(r.month, "long")}</title>
                </rect>
              </g>
            );
          })}
        </svg>
        {active ? (
          <div
            className="pointer-events-none absolute top-2 z-10 w-48 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-[0_12px_32px_-16px_rgba(22,24,29,0.35)]"
            style={{ left: `clamp(0px, calc(${((PAD.left + (rows.findIndex((r) => r.month === active.month) + 0.5) * band) / W) * 100}% - 96px), calc(100% - 192px))` }}
            role="status"
          >
            <p className="mb-1 font-semibold text-ink">{monthLabel(active.month, "long")}</p>
            <p className="num flex justify-between gap-3 text-ink-2">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: RECEIVED }} />Received</span>
              {fmt(active.received)}
            </p>
            <p className="num flex justify-between gap-3 text-ink-2">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: EXPENSES }} />Expenses</span>
              {fmt(active.expenses)}
            </p>
            <p className="num mt-1 flex justify-between gap-3 border-t border-line pt-1 font-medium text-ink">
              <span>Profit</span>
              {fmt(active.profit)}
            </p>
          </div>
        ) : null}
      </div>
      <details className="mt-3 text-[12px]">
        <summary className="cursor-pointer text-muted hover:text-ink">Show as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="num w-full min-w-[420px] text-left" data-testid="monthly-table">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">Month</th>
                <th className="py-1 text-right font-medium">Received</th>
                <th className="py-1 text-right font-medium">Invoiced</th>
                <th className="py-1 text-right font-medium">Expenses</th>
                <th className="py-1 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {[...allRows].reverse().map((r) => (
                <tr key={r.month} className="border-t border-line">
                  <td className="py-1">{monthLabel(r.month, "long")}</td>
                  <td className="py-1 text-right">{fmt(r.received)}</td>
                  <td className="py-1 text-right">{fmt(r.invoiced)}</td>
                  <td className="py-1 text-right">{fmt(r.expenses)}</td>
                  <td className="py-1 text-right">{fmt(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

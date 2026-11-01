/**
 * One-tap PDF: draws a document exactly as it looks on screen (at A4 width, even on a phone) and
 * saves it as a PDF file. Everything happens in the browser; nothing is uploaded.
 * Libraries (MIT, loaded only when someone taps Download): html-to-image, jsPDF.
 */

/** A4 at 96 dpi: the width documents are laid out at for the PDF. */
export const PAGE_CSS_WIDTH = 794;
const A4 = { w: 595.28, h: 841.89 }; // points
const MARGIN = 36; // points (½ inch)

/** Where a page may end without cutting through a line of text (in CSS px from the top). */
export function safeBreaks(root: HTMLElement): number[] {
  const top = root.getBoundingClientRect().top;
  const ys = new Set<number>();
  root.querySelectorAll("header, section, li, tr, p, h1, h2, h3, dl > *, table, ol, ul, article > div").forEach((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.height > 0) ys.add(Math.round(r.bottom - top));
  });
  return [...ys].sort((a, b) => a - b);
}

/**
 * Splits a document of `total` px into page slices no taller than `max`, ending each page at the last
 * safe break that fills at least half of it (otherwise a hard cut). Returns [start, end) pairs.
 */
export function pageSlices(total: number, max: number, breaks: number[]): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  while (start < total) {
    let end = Math.min(start + max, total);
    if (end < total) {
      const ok = breaks.filter((b) => b > start + max * 0.5 && b <= start + max);
      if (ok.length) end = ok[ok.length - 1];
    }
    out.push([start, end]);
    start = end;
  }
  return out;
}

/** "Invoice RS-2026-001" → "Invoice-RS-2026-001.pdf" (safe on every system). */
export function pdfFileName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "document";
  return `${base}.pdf`;
}

/**
 * The page's @font-face rules with each font file inlined, so the drawing uses the same fonts.
 * Done here (same-origin fetches) instead of by html-to-image, whose own method sets a <base> URL
 * that the site's security policy (base-uri 'none') rightly blocks.
 */
async function inlineFontCss(): Promise<string> {
  const toDataUrl = async (url: string) => {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  };
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's stylesheet: not readable, and not ours
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      let css = rule.cssText;
      const base = sheet.href ?? location.href;
      for (const m of [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) {
        const abs = new URL(m[1], base);
        if (abs.origin !== location.origin) continue;
        css = css.replace(m[0], `url("${await toDataUrl(abs.href)}")`);
      }
      out.push(css);
    }
  }
  return out.join("\n");
}

export async function downloadPdf(source: HTMLElement, name: string): Promise<void> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);

  // Lay the document out at A4 width off screen, without buttons and other screen-only parts.
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  Object.assign(holder.style, { position: "fixed", left: "-10000px", top: "0", width: `${PAGE_CSS_WIDTH}px`, background: "#ffffff", zIndex: "-1" });
  const doc = source.cloneNode(true) as HTMLElement;
  doc.querySelectorAll(".print\\:hidden, [data-pdf-hidden], button").forEach((n) => n.remove());
  doc.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
  Object.assign(doc.style, { width: `${PAGE_CSS_WIDTH}px`, maxWidth: "none", margin: "0", background: "#ffffff", border: "0", borderRadius: "0", boxShadow: "none", padding: "40px" });
  holder.appendChild(doc);
  document.body.appendChild(holder);
  try {
    await document.fonts?.ready;
    const breaks = safeBreaks(doc);
    const height = Math.ceil(doc.getBoundingClientRect().height);
    const scale = 2;
    const canvas = await toCanvas(doc, { pixelRatio: scale, backgroundColor: "#ffffff", width: PAGE_CSS_WIDTH, height, fontEmbedCSS: await inlineFontCss() });

    const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
    const contentW = A4.w - MARGIN * 2;
    const ptPerCss = contentW / PAGE_CSS_WIDTH;
    const maxCss = Math.floor((A4.h - MARGIN * 2) / ptPerCss);
    const slices = pageSlices(height, maxCss, breaks);
    slices.forEach(([from, to], i) => {
      const part = document.createElement("canvas");
      part.width = canvas.width;
      part.height = Math.max(1, Math.round((to - from) * scale));
      const ctx = part.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, part.width, part.height);
      ctx.drawImage(canvas, 0, Math.round(from * scale), canvas.width, part.height, 0, 0, part.width, part.height);
      if (i > 0) pdf.addPage();
      pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, MARGIN, contentW, (to - from) * ptPerCss, undefined, "FAST");
      if (slices.length > 1) {
        pdf.setFontSize(8);
        pdf.setTextColor(140);
        pdf.text(`${i + 1} / ${slices.length}`, A4.w - MARGIN, A4.h - MARGIN / 2, { align: "right" });
      }
    });
    pdf.setProperties({ title: name, creator: "ScopeFlow" });
    pdf.save(pdfFileName(name));
  } finally {
    holder.remove();
  }
}

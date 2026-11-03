/**
 * Blog content helpers shared by the app and the Worker (which renders posts for search engines).
 * Pure functions only: no React, no network.
 *
 * Markdown is rendered by a small, strict renderer: every character of the author's text is
 * HTML-escaped first, and only the formatting below becomes markup. Links must be http(s) or mailto.
 *   ## Heading / ### Subheading     paragraphs (blank line between)     **bold**  *italic*  `code`
 *   [text](https://…)   - bullets   1. numbered   > quote   --- (line)   ``` code blocks ```
 *   | tables | with | pipes |  (first row is the header; a |---| line under it is optional)
 *   ![description](image address)   images: only images uploaded to ScopeFlow's blog storage are shown;
 *                                    any other image becomes a plain link (the site's security policy
 *                                    wouldn't load it anyway).
 */

export type BlogCategory = "strategies" | "success-stories" | "market-prices" | "tools" | "news";
export const CATEGORIES: { id: BlogCategory; label: string; tone: string }[] = [
  { id: "strategies", label: "Strategies", tone: "#005dd4" },
  { id: "success-stories", label: "Success stories", tone: "#0f8a5f" },
  { id: "market-prices", label: "Market prices", tone: "#b25e09" },
  { id: "tools", label: "Tools", tone: "#6941c6" },
  { id: "news", label: "News", tone: "#c4320a" },
];
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  category: BlogCategory;
  body: string;
  author_name: string;
  published_at: string;
  updated_at: string;
  cover_image: string | null;
};
export const POST_COLUMNS = "slug, title, description, category, body, author_name, published_at, updated_at, cover_image";
export const LIST_COLUMNS = "slug, title, description, category, author_name, published_at, updated_at, cover_image";

/** Where uploaded blog images live: <Supabase URL>/storage/v1/object/public/blog/… */
export const imagePrefix = (supabaseUrl: string) => `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/blog/`;
export type RenderOptions = { imagePrefix?: string };

export const readingMinutes = (body: string) => Math.max(1, Math.round(body.trim().split(/\s+/).length / 200));

export function formatPostDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^\/(?!\/)/.test(url)) return url; // a page on this site
  return null;
}

/** Inline formatting on already-escaped text. */
function inline(escaped: string, opts: RenderOptions = {}): string {
  const codes: string[] = [];
  let s = escaped.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Images first (before links): ![alt](url)
  s = s.replace(/!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, alt, href) => {
    const url = href.replace(/&amp;/g, "&");
    if (opts.imagePrefix && url.startsWith(opts.imagePrefix) && /^[\w./%-]+$/.test(url.slice(opts.imagePrefix.length))) {
      codes.push(`<img src="${escapeHtml(url)}" alt="${alt}" loading="lazy" decoding="async">`);
      return `\u0000${codes.length - 1}\u0000`;
    }
    const safe = safeUrl(url);
    return safe ? `[${alt || "image"}](${href})` : alt;
  });
  s = s.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (whole, text, href) => {
    // href is escaped text; unescape only &amp; for the URL check, keep it escaped in the attribute.
    const url = safeUrl(href.replace(/&amp;/g, "&"));
    if (!url) return text;
    const external = /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?scopeflow\.in(\/|$)/i.test(url);
    return `<a href="${escapeHtml(url)}"${external ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** Markdown → safe HTML. */
export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|```|\s*\|.*\|\s*$|-{3,}\s*$|\*{3,}\s*$)/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      // The post title is the page's only h1, so # and ## both become h2.
      const level = Math.min(4, Math.max(2, h[1].length));
      out.push(`<h${level}>${inline(escapeHtml(h[2].replace(/\s+#+\s*$/, "")), opts)}</h${level}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(q.join("\n"), opts)}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(escapeHtml(c), opts)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(escapeHtml(c), opts)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const ul = /^[-*+]\s+/;
    const ol = /^\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        let item = lines[i++].replace(re, "");
        // Continuation lines (indented) belong to the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i].trim())) item += " " + lines[i++].trim();
        items.push(`<li>${inline(escapeHtml(item), opts)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) para.push(lines[i++].trim());
    // A paragraph that is only an image shows as a figure.
    const p = inline(escapeHtml(para.join(" ")), opts);
    out.push(/^<img [^>]+>$/.test(p) ? `<figure>${p}</figure>` : `<p>${p}</p>`);
  }
  return out.join("\n");
}

/** Plain text of a post (for previews and structured data). */
export const plainText = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

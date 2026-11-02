import { describe, expect, it } from "vitest";
import { plainText, readingMinutes, renderMarkdown } from "@/lib/blog-content";

describe("blog Markdown", () => {
  it("renders the supported formatting", () => {
    const html = renderMarkdown(`# Title-ish
## Pricing

Charge **per project**, not *per hour*. Use \`₹\` signs.
Second line of the same paragraph.

- one
- two
  continued

1. first
2. second

> Quote here

---

| Service | Price |
|---|---|
| Logo | ₹8,000 |

\`\`\`
<b>code</b>
\`\`\`

[Our pricing](/pricing) and [Google](https://google.com).`);
    expect(html).toContain("<h2>Title-ish</h2>");
    expect(html).toContain("<h2>Pricing</h2>");
    expect(html).toContain("<p>Charge <strong>per project</strong>, not <em>per hour</em>. Use <code>₹</code> signs. Second line of the same paragraph.</p>");
    expect(html).toContain("<ul><li>one</li><li>two continued</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<blockquote><p>Quote here</p></blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<thead><tr><th>Service</th><th>Price</th></tr></thead><tbody><tr><td>Logo</td><td>₹8,000</td></tr></tbody>");
    expect(html).toContain("<pre><code>&lt;b&gt;code&lt;/b&gt;</code></pre>");
    expect(html).toContain('<a href="/pricing">Our pricing</a>');
    expect(html).toContain('<a href="https://google.com" target="_blank" rel="noopener">Google</a>');
  });

  it("never lets HTML or script through", () => {
    const attacks = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "[click](javascript:alert(1))",
      "[click](JaVaScRiPt:alert(1))",
      '[x](https://a.com"onmouseover="alert(1))',
      "[x](data:text/html,<script>alert(1)</script>)",
      "**<iframe src=//evil>**",
      "| <svg onload=alert(1)> | b |\n|---|---|",
      "## <a href=javascript:alert(1)>x</a>",
    ];
    for (const a of attacks) {
      const html = renderMarkdown(a);
      expect(html, a).not.toMatch(/<(script|img|iframe|svg)\b/i);
      expect(html, a).not.toMatch(/href="(javascript|data):/i);
      expect(html, a).not.toMatch(/\son\w+="/i);
    }
    expect(renderMarkdown("[click](javascript:alert(1))")).toBe("<p>click</p>");
  });

  it("estimates reading time and plain text", () => {
    expect(readingMinutes("word ".repeat(1000))).toBe(5);
    expect(readingMinutes("short")).toBe(1);
    expect(plainText("## Hi **there** [link](https://x.com)")).toBe("Hi there link");
  });
});

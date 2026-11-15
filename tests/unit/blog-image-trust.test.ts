import { describe, expect, it } from "vitest";
import { imagePrefix, isTrustedBlogImage, renderMarkdown } from "../../src/lib/blog-content";

const prefix = imagePrefix("https://abcdefghijklmnopqrst.supabase.co");
describe("trusted blog cover images", () => {
  it("accepts uploaded images in this project", () => {
    expect(isTrustedBlogImage(prefix + "2026/11/abc-123.webp", prefix)).toBe(true);
    expect(isTrustedBlogImage(prefix + "2026/11/abc.jpg", prefix)).toBe(true);
  });
  it("rejects external tracking images and URL tricks", () => {
    for (const url of [
      "https://tracker.example/pixel.png",
      "https://other.supabase.co/storage/v1/object/public/blog/a.png",
      prefix + "image.png?tracking=1",
      prefix + "../private/image.png",
      prefix + "image.svg",
      prefix + "image.png#fragment",
    ]) expect(isTrustedBlogImage(url, prefix)).toBe(false);
  });
});


describe("blog markdown image rendering", () => {
  it("renders only trusted uploaded images", () => {
    const good = renderMarkdown(`![Cover](${prefix}2026/11/abc.webp)`, { imagePrefix: prefix });
    expect(good).toContain("<img ");
    for (const path of ["../private/x.png", "x.svg", "x.png?track=1", "x.png#fragment"]) {
      const html = renderMarkdown(`![Cover](${prefix}${path})`, { imagePrefix: prefix });
      expect(html).not.toContain("<img ");
    }
  });
});

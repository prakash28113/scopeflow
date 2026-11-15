import { describe, expect, it } from "vitest";
import { imagePrefix, isTrustedBlogImage, renderMarkdown } from "../../src/lib/blog-content";

const prefix = imagePrefix("https://abcdefghijklmnopqrst.supabase.co");
describe("trusted blog cover images", () => {
  it("accepts uploaded images in this project", () => {
    expect(isTrustedBlogImage(prefix + "2026/11/abc-123.webp", prefix)).toBe(true);
    expect(isTrustedBlogImage(prefix + "2026/11/abc.jpg", prefix)).toBe(true);
  });
  it("renders uploads from an explicitly configured local Supabase bucket", () => {
    for (const origin of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]) {
      const localPrefix = imagePrefix(origin);
      const uploaded = localPrefix + "2026/11/abc-123.webp";
      expect(isTrustedBlogImage(uploaded, localPrefix)).toBe(true);
      expect(renderMarkdown(`![icon 512](${uploaded})`, { imagePrefix: localPrefix })).toContain(`<img src="${uploaded}"`);
      expect(isTrustedBlogImage(uploaded, prefix)).toBe(false);
      expect(isTrustedBlogImage(prefix + "cover.png", localPrefix)).toBe(false);
      for (const path of ["../private/x.png", "%2e%2e/x.png", "x.svg", "x.png?track=1", "x.png#fragment"]) {
        expect(isTrustedBlogImage(localPrefix + path, localPrefix)).toBe(false);
      }
    }
  });
  it("rejects remote HTTP storage and loopback lookalikes even when configured", () => {
    for (const origin of [
      "http://abcdefghijklmnopqrst.supabase.co", "http://192.168.1.1:54321",
      "http://127.0.0.1.evil.example:54321", "http://localhost.evil.example",
      "http://127.0.0.1@evil.example", "http://evil.example@127.0.0.1:54321",
    ]) {
      const badPrefix = imagePrefix(origin);
      expect(isTrustedBlogImage(badPrefix + "cover.png", badPrefix)).toBe(false);
    }
    const localPrefix = imagePrefix("http://127.0.0.1:54321");
    expect(isTrustedBlogImage(imagePrefix("http://localhost:54321") + "cover.png", localPrefix)).toBe(false);
    expect(isTrustedBlogImage(imagePrefix("http://127.0.0.1:54322") + "cover.png", localPrefix)).toBe(false);
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

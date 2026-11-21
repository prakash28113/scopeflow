import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain JavaScript module (scripts run by GitHub Actions)
import { checkManifest, manifestOf, pack, unpack } from "../../scripts/backup/lib.mjs";
// @ts-expect-error plain JavaScript module
import { checkStorage, exportStorage, findStorageReferences, restoreStorage, safeName } from "../../scripts/backup/storage.mjs";

const URL_ = "https://abcdefghijklmnopqrst.supabase.co";
const PASS = "correct horse battery staple 2026";
const img = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + n) % 256));
const FILES: Record<string, Buffer> = { "2026/11/cover.webp": img(300), "2026/11/a b.png": img(120) };

type Row = Record<string, unknown>;
function sqlFor({ pub = true, exists = true, sizeOverride }: { pub?: boolean; exists?: boolean; sizeOverride?: number } = {}) {
  return async (q: string): Promise<Row[]> => {
    if (q.includes("from storage.buckets")) return exists ? [{ id: "blog", public: pub, file_size_limit: 3145728, allowed_mime_types: ["image/webp", "image/png"] }] : [];
    if (q.includes("from storage.objects")) return Object.entries(FILES).map(([name, b]) => ({ name, size: sizeOverride ?? b.length, mimetype: name.endsWith("png") ? "image/png" : "image/webp" }));
    throw new Error(`unexpected query ${q}`);
  };
}
const serve = (files = FILES, status: Record<string, number> = {}) =>
  vi.fn(async (url: string) => {
    const name = decodeURIComponent(url.replace(`${URL_}/storage/v1/object/public/blog/`, ""));
    if (status[name]) return new Response("x", { status: status[name] });
    return files[name] ? new Response(new Uint8Array(files[name])) : new Response("missing", { status: 404 });
  });
const run = (o: Record<string, unknown> = {}) => exportStorage({ sql: sqlFor(), fetch: serve(), supabaseUrl: URL_, sleep: async () => {}, ...o });

describe("Storage backup", () => {
  it("reads every object from the public bucket, with size and SHA-256, and records them in the manifest", async () => {
    const f = serve();
    const s = await run({ fetch: f });
    expect(s.buckets.blog.objects.map((o: { name: string }) => o.name)).toEqual(["2026/11/cover.webp", "2026/11/a b.png"]);
    expect(f).toHaveBeenCalledWith(`${URL_}/storage/v1/object/public/blog/2026/11/a%20b.png`, expect.anything());
    expect(s.buckets.blog.objects[0]).toMatchObject({ size: 300, mimetype: "image/webp", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const b = { tables: { "public.blog_posts": [] }, storage: s, manifest: manifestOf({ "public.blog_posts": [] }, s) };
    expect(checkManifest(b)).toEqual([]);
    expect(Object.keys(b.manifest.storage.blog.objects)).toHaveLength(2);
  });

  it("fails closed: unreadable object, wrong size, private bucket, too much data, unsafe name", async () => {
    await expect(run({ fetch: serve(FILES, { "2026/11/cover.webp": 404 }) })).rejects.toThrow(/Could not read Storage object "blog\/2026\/11\/cover.webp" \(HTTP 404\).*not saved/);
    await expect(run({ sql: sqlFor({ sizeOverride: 5 }) })).rejects.toThrow(/is 300 bytes but Storage lists 5/);
    await expect(run({ sql: sqlFor({ pub: false }) })).rejects.toThrow(/not public.*service key/);
    await expect(run({ maxTotalBytes: 100 })).rejects.toThrow(/over the 0 MB backup limit|backup limit/);
    const evil = async (q: string) => (q.includes("storage.buckets") ? [{ id: "blog", public: true }] : [{ name: "../../etc/passwd", size: 1 }]);
    await expect(run({ sql: evil })).rejects.toThrow(/not safe to back up/);
  });

  it("retries busy answers, then gives up with the status (no secret involved)", async () => {
    let n = 0;
    const flaky = vi.fn(async () => (++n < 3 ? new Response("", { status: 503 }) : new Response(new Uint8Array(FILES["2026/11/cover.webp"]))));
    const one = async (q: string) => (q.includes("storage.buckets") ? [{ id: "blog", public: true }] : [{ name: "2026/11/cover.webp", size: 300 }]);
    expect((await run({ sql: one, fetch: flaky })).buckets.blog.objects).toHaveLength(1);
    expect(flaky).toHaveBeenCalledTimes(3);
    await expect(run({ sql: one, fetch: vi.fn(async () => new Response("", { status: 503 })) })).rejects.toThrow(/HTTP 503/);
  });

  it("an empty or missing bucket is recorded, not an error", async () => {
    expect((await run({ sql: sqlFor({ exists: false }) })).buckets.blog).toEqual({ config: null, objects: [] });
  });
});

describe("Storage restore (isolated)", () => {
  it("survives encryption and restores byte-identical files into a throwaway folder", async () => {
    const storage = await run();
    const backup = { format: "scopeflow-backup/1", created_at: "2026-11-22T00:00:00Z", migrations: ["m"], tables: { "public.blog_posts": [] }, storage, manifest: manifestOf({ "public.blog_posts": [] }, storage) };
    const opened = unpack(pack(backup, PASS), PASS);
    expect(checkManifest(opened)).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "sf-test-"));
    try {
      const r = restoreStorage(opened, dir);
      expect(r).toMatchObject({ files: 2, bytes: 420 });
      expect(readFileSync(join(dir, "blog", "2026/11/cover.webp")).equals(FILES["2026/11/cover.webp"])).toBe(true);
      expect(readFileSync(join(dir, "blog", "2026/11/a b.png")).equals(FILES["2026/11/a b.png"])).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses damaged contents, a changed manifest, and names that would escape the folder", async () => {
    const storage = await run();
    const dir = mkdtempSync(join(tmpdir(), "sf-test-"));
    try {
      const tampered = structuredClone(storage);
      tampered.buckets.blog.objects[0].data = Buffer.from("not the image").toString("base64");
      expect(checkStorage(tampered).join(" ")).toMatch(/contents don't match the checksum/);
      expect(() => restoreStorage({ storage: tampered }, dir)).toThrow(/refused/);
      const escape = structuredClone(storage);
      escape.buckets.blog.objects[0].name = "../escape.webp";
      expect(() => restoreStorage({ storage: escape }, dir)).toThrow(/refused/);
      expect(existsSync(join(dir, "..", "escape.webp"))).toBe(false);
      const dropped = structuredClone(storage);
      const manifest = manifestOf({}, storage);
      dropped.buckets.blog.objects.pop();
      expect(checkManifest({ tables: {}, storage: dropped, manifest }).join(" ")).toMatch(/don't match the manifest/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a backup made before Storage was included is still consistent", () => {
    expect(checkManifest({ tables: { "public.x": [] }, manifest: manifestOf({ "public.x": [] }) })).toEqual([]);
  });

  it("finds images that posts point to but the backup doesn't hold", async () => {
    const storage = await run();
    const posts = [{ cover: `${URL_}/storage/v1/object/public/blog/2026/11/cover.webp` }, { body: `![x](${URL_}/storage/v1/object/public/blog/2026/11/gone.png)` }];
    const r = findStorageReferences({ tables: { "public.blog_posts": posts, "auth.users": [{ x: `${URL_}/storage/v1/object/public/blog/ignored.png` }] }, storage });
    expect(r).toEqual({ referenced: 2, missing: ["2026/11/gone.png"] });
  });

  it("safeName", () => {
    for (const ok of ["a.png", "2026/11/a b.png"]) expect(safeName(ok)).toBe(true);
    for (const bad of ["", "/a", "../a", "a/../b", "a//b", "a\\b", "a\u0000b", "."]) expect(safeName(bad)).toBe(false);
  });
});

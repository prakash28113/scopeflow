/** Blog data for the app: public posts (anyone) and the author's tools (drafts, saving, publishing keys). */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { LIST_COLUMNS, POST_COLUMNS, imagePrefix, type BlogCategory, type BlogPost } from "./blog-content";

export type BlogListItem = Omit<BlogPost, "body">;
export type MyPost = BlogPost & { id: string; status: "draft" | "published"; published_at: string | null };
export type BlogKey = { id: string; label: string; created_at: string; last_used_at: string | null; revoked: boolean };
export type PostInput = { title: string; description: string; category: BlogCategory; body: string; publish: boolean; cover_image: string | null };

/** Query keys shared with the Worker, which embeds the same data in the page it sends. */
export const blogKeys = { list: ["blog", "list"] as const, post: (slug: string) => ["blog", "post", slug] as const };

export const blogListQuery = {
  queryKey: blogKeys.list,
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.from("blog_posts").select(LIST_COLUMNS).order("published_at", { ascending: false }).limit(100);
    if (error) throw error;
    return data as BlogListItem[];
  },
};

export const useBlogList = (enabled = true) => useQuery({ ...blogListQuery, enabled });

export function useBlogPost(slug: string) {
  return useQuery({
    queryKey: blogKeys.post(slug),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("blog_posts").select(POST_COLUMNS).eq("slug", slug).maybeSingle();
      if (error) throw error;
      return (data as BlogPost | null) ?? null;
    },
  });
}

export function useIsBlogAuthor(enabled = true) {
  return useQuery({
    queryKey: ["blog", "is-author"],
    enabled,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_blog_author");
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function useMyPosts(enabled = true) {
  return useQuery({
    queryKey: ["blog", "mine"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("blog_my_posts");
      if (error) throw error;
      return data as MyPost[];
    },
  });
}

export function useBlogKeys(enabled = true) {
  return useQuery({
    queryKey: ["blog", "keys"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("blog_my_keys");
      if (error) throw error;
      return data as BlogKey[];
    },
  });
}

/** The publishing API address for tools (Grok automations, Make, Zapier…). */
export const BLOG_API_URL = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/blog/posts`;

/** Where uploaded blog images are served from (public storage bucket "blog"). */
export const BLOG_IMAGE_PREFIX = imagePrefix(String(import.meta.env.VITE_SUPABASE_URL ?? ""));

const MAX_WIDTH = 1600;
const MAX_BYTES = 3 * 1024 * 1024;

/** Shrinks a photo to at most 1600 px wide and re-encodes it (WebP, or JPEG where WebP isn't available). */
export async function prepareImage(file: File): Promise<{ blob: Blob; type: string; ext: string }> {
  if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name)) {
    throw new Error("Choose a photo (JPG, PNG or WebP).");
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This photo couldn't be read. Try a JPG or PNG.");
  });
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const encode = (type: string, quality: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
  let blob = await encode("image/webp", 0.82);
  let type = "image/webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await encode("image/jpeg", 0.85);
    type = "image/jpeg";
  }
  if (!blob) throw new Error("This photo couldn't be prepared. Try another one.");
  if (blob.size > MAX_BYTES) throw new Error("This photo is too large even after shrinking it. Try a smaller one.");
  return { blob, type, ext: type === "image/webp" ? "webp" : "jpg" };
}

/** Uploads a photo for the blog and returns its public address. Only blog authors can upload. */
export async function uploadBlogImage(file: File): Promise<string> {
  const { blob, type, ext } = await prepareImage(file);
  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("blog").upload(path, await blob.arrayBuffer(), { contentType: type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(/row-level security|Unauthorized|403/i.test(error.message) ? "Only blog authors can upload photos." : "The photo didn't upload. Check your connection and try again.");
  return BLOG_IMAGE_PREFIX + path;
}

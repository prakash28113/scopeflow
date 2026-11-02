/** Blog data for the app: public posts (anyone) and the author's tools (drafts, saving, publishing keys). */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { LIST_COLUMNS, POST_COLUMNS, type BlogCategory, type BlogPost } from "./blog-content";

export type BlogListItem = Omit<BlogPost, "body">;
export type MyPost = BlogPost & { id: string; status: "draft" | "published"; published_at: string | null };
export type BlogKey = { id: string; label: string; created_at: string; last_used_at: string | null; revoked: boolean };
export type PostInput = { title: string; description: string; category: BlogCategory; body: string; publish: boolean };

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

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { ActionButton, CopyButton } from "@/components/form-bits";
import { PageSpinner } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { supabase } from "@/lib/supabase";
import { call } from "@/lib/use-action";
import { formatDateTime } from "@/lib/format";
import { BLOG_API_URL, BLOG_IMAGE_PREFIX, uploadBlogImage, useBlogKeys, useIsBlogAuthor, useMyPosts, type MyPost } from "@/lib/blog";
import { CATEGORIES, categoryOf, readingMinutes, renderMarkdown, type BlogCategory } from "@/lib/blog-content";

type Draft = { id: string | null; title: string; description: string; category: BlogCategory; body: string; status: "draft" | "published"; cover_image: string | null };
const EMPTY: Draft = { id: null, title: "", description: "", category: "strategies", body: "", status: "draft", cover_image: null };

const MARKDOWN_HELP = [
  ["## Heading", "section heading"],
  ["**bold**  *italic*", "emphasis"],
  ["- item", "bullet list"],
  ["1. item", "numbered list"],
  ["[text](https://…)", "link"],
  ["> quote", "quote"],
  ["![text](photo)", "photo (use Add photo)"],
  ["| a | b |", "table (first row = header)"],
];

/** Blog authors only: write, publish and manage posts, and publishing keys for tools. */
export default function BlogWritePage() {
  const author = useIsBlogAuthor();
  const posts = useMyPosts(author.data === true);
  const [draft, setDraft] = useState<Draft | null>(null);

  if (author.isLoading) return <PageSpinner />;
  if (!author.data) {
    return (
      <Card>
        <EmptyState title="Only blog authors can write here" body="Ask the ScopeFlow team to add your account as a blog author." action={<Link to="/blog" className="text-[14px] font-medium text-accent hover:underline">Read the blog</Link>} />
      </Card>
    );
  }
  if (draft) return <Editor initial={draft} onDone={() => setDraft(null)} />;

  return (
    <>
      <PageHeader
        title="Blog"
        description="Write and publish posts for scopeflow.in/blog. Published posts appear on the blog, the home page and in Google."
        actions={
          <>
            <Link to="/blog" className="inline-flex h-9 items-center rounded-lg px-3 text-[14px] font-medium text-accent hover:underline">
              View blog
            </Link>
            <Button onClick={() => setDraft(EMPTY)}>Write a post</Button>
          </>
        }
      />
      <Card>
        <CardHeader title="Your posts" />
        {posts.isLoading ? (
          <p className="px-5 py-5 text-[13px] text-muted">Loading…</p>
        ) : !posts.data?.length ? (
          <EmptyState title="No posts yet" body="Your first post can be live in a few minutes." action={<Button onClick={() => setDraft(EMPTY)}>Write a post</Button>} />
        ) : (
          <ul className="divide-y divide-line" data-testid="my-posts">
            {posts.data.map((p: MyPost) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                  <span className="block text-[12px] text-muted">
                    {categoryOf(p.category).label} · {p.published_at ? `published ${formatDateTime(p.published_at)}` : `saved ${formatDateTime(p.updated_at)}`}
                  </span>
                </span>
                <Badge tone={p.status === "published" ? "positive" : "neutral"}>{p.status === "published" ? "Published" : "Draft"}</Badge>
                {p.status === "published" ? (
                  <Link to={`/blog/${p.slug}`} className="text-[13px] font-medium text-accent hover:underline">
                    View
                  </Link>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => setDraft({ id: p.id, title: p.title, description: p.description, category: p.category, body: p.body, status: p.status, cover_image: p.cover_image ?? null })}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <PublishingKeys />
    </>
  );
}

function Editor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const html = useMemo(() => (preview ? renderMarkdown(d.body, { imagePrefix: BLOG_IMAGE_PREFIX }) : ""), [preview, d.body]);
  const [uploading, setUploading] = useState<"cover" | "body" | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLInputElement>(null);

  async function upload(e: ChangeEvent<HTMLInputElement>, where: "cover" | "body") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(where);
    try {
      const url = await uploadBlogImage(file);
      if (where === "cover") {
        set("cover_image", url);
      } else {
        // Insert at the cursor, on its own line.
        const el = bodyRef.current;
        const at = el ? el.selectionStart : d.body.length;
        const alt = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/[\[\]()]/g, "").trim() || "Photo";
        const snippet = `\n\n![${alt}](${url})\n\n`;
        set("body", (d.body.slice(0, at) + snippet + d.body.slice(at)).replace(/^\n+/, ""));
      }
      toast("positive", where === "cover" ? "Cover photo added." : "Photo added to the post.");
    } catch (err) {
      toast("danger", err instanceof Error ? err.message : "The photo didn't upload.");
    } finally {
      setUploading(null);
    }
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save(publish: boolean, e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setSaving(publish ? "publish" : "draft");
    const r = await call(() =>
      supabase.rpc("save_blog_post", { p_id: d.id, p: { title: d.title, description: d.description, category: d.category, body: d.body, cover_image: d.cover_image, publish } }),
    );
    setSaving(null);
    if (!r.ok) return setError(r.message);
    const saved = r.data as { id: string; slug: string; status: "draft" | "published" };
    setD((x) => ({ ...x, id: saved.id, status: saved.status }));
    await qc.invalidateQueries({ queryKey: ["blog"] });
    toast("positive", publish ? "Published. It's live on the blog now." : "Draft saved. Only you can see it.");
    if (publish) onDone();
  }

  async function remove() {
    const r = await call(() => supabase.rpc("delete_blog_post", { p_id: d.id }));
    if (!r.ok) return toast("danger", r.message);
    await qc.invalidateQueries({ queryKey: ["blog"] });
    toast("positive", "Post deleted.");
    onDone();
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <button type="button" onClick={onDone} className="hover:text-ink">
            ← Blog
          </button>
        }
        title={d.id ? "Edit post" : "Write a post"}
        meta={d.status === "published" ? <Badge tone="positive">Published</Badge> : <Badge>Draft</Badge>}
      />
      <form onSubmit={(e) => save(true, e)} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]" noValidate>
        <Card className="space-y-5 p-5">
          {error ? <Alert>{error}</Alert> : null}
          <Field label="Title" htmlFor="post-title" hint={`${d.title.trim().length}/120`}>
            <Input id="post-title" value={d.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="How much should a logo cost in India?" />
          </Field>
          <Field label="Category" htmlFor="post-category">
            <Select id="post-category" value={d.category} onChange={(e) => set("category", e.target.value as BlogCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Summary" htmlFor="post-summary" hint={`Shown on the blog and in Google. ${d.description.trim().length}/200`}>
            <Textarea id="post-summary" rows={2} value={d.description} maxLength={200} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-ink-2">Cover photo</p>
            {d.cover_image ? (
              <div className="relative overflow-hidden rounded-lg border border-line" data-testid="cover-preview">
                <img src={d.cover_image} alt="Cover" className="aspect-[2/1] w-full object-cover" />
                <div className="absolute right-2 top-2 flex gap-2">
                  <Button type="button" size="sm" variant="secondary" disabled={Boolean(uploading)} onClick={() => coverInput.current?.click()}>
                    Change
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => set("cover_image", null)}>
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInput.current?.click()}
                disabled={Boolean(uploading)}
                className="flex aspect-[3/1] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-sunken text-[13px] text-muted transition-colors hover:border-accent hover:text-accent"
              >
                <span className="font-medium text-ink-2">{uploading === "cover" ? "Uploading…" : "Add a cover photo"}</span>
                <span>Optional. Without one, the post gets a cover in its category's colour.</span>
              </button>
            )}
            <input ref={coverInput} type="file" accept="image/*" className="sr-only" aria-label="Cover photo file" onChange={(e) => upload(e, "cover")} />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="post-body" className="text-[13px] font-medium text-ink-2">
                Post
              </label>
              {!preview ? (
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(uploading)} onClick={() => bodyInput.current?.click()}>
                  {uploading === "body" ? "Uploading…" : "Add photo"}
                </Button>
              ) : null}
              <input ref={bodyInput} type="file" accept="image/*" className="sr-only" aria-label="Photo file for the post" onChange={(e) => upload(e, "body")} />
              <div className="flex rounded-lg border border-line-strong bg-sunken p-0.5 text-[12px] font-medium" role="tablist">
                <button type="button" role="tab" aria-selected={!preview} onClick={() => setPreview(false)} className={cx("rounded-md px-3 py-1", !preview ? "bg-surface text-ink shadow-sm" : "text-muted")}>
                  Write
                </button>
                <button type="button" role="tab" aria-selected={preview} onClick={() => setPreview(true)} className={cx("rounded-md px-3 py-1", preview ? "bg-surface text-ink shadow-sm" : "text-muted")}>
                  Preview
                </button>
              </div>
            </div>
            {preview ? (
              <div className="blog-prose min-h-[320px] rounded-lg border border-line bg-surface px-4 py-3" data-testid="post-preview" dangerouslySetInnerHTML={{ __html: html || "<p>Nothing to preview yet.</p>" }} />
            ) : (
              <Textarea ref={bodyRef} id="post-body" rows={18} value={d.body} onChange={(e) => set("body", e.target.value)} className="font-mono text-[14px] leading-relaxed" placeholder={"Paste or write the post here.\n\n## A section heading\n\nA paragraph with **bold** text."} />
            )}
            <p className="text-[12px] text-muted">
              {d.body.trim() ? `${readingMinutes(d.body)} min read · ` : ""}Paste text from Grok or any writer; Markdown formatting is kept.
            </p>
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <Button type="submit" className="w-full" disabled={Boolean(saving)}>
              {saving === "publish" ? "Publishing…" : d.status === "published" ? "Update post" : "Publish"}
            </Button>
            <Button type="button" variant="secondary" className="w-full" disabled={Boolean(saving)} onClick={() => save(false)}>
              {saving === "draft" ? "Saving…" : d.status === "published" ? "Unpublish (back to draft)" : "Save draft"}
            </Button>
            {d.id ? (
              <ActionButton variant="ghost" className="w-full text-danger" onAction={remove} confirm="Delete this post? This can't be undone." confirmLabel="Delete post" pendingLabel="Deleting…">
                Delete post
              </ActionButton>
            ) : null}
          </Card>
          <Card className="p-4">
            <p className="text-[13px] font-medium text-ink">Formatting</p>
            <dl className="mt-2 space-y-1.5 text-[12px]">
              {MARKDOWN_HELP.map(([code, what]) => (
                <div key={code} className="flex justify-between gap-3">
                  <dt className="font-mono text-ink-2">{code}</dt>
                  <dd className="text-right text-muted">{what}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </form>
    </>
  );
}

function PublishingKeys() {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useBlogKeys();
  const [label, setLabel] = useState("Grok");
  const [created, setCreated] = useState<{ key: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call(() => supabase.rpc("create_blog_key", { p_label: label }));
    setBusy(false);
    if (!r.ok) return toast("danger", r.message);
    setCreated(r.data as { key: string; label: string });
    await qc.invalidateQueries({ queryKey: ["blog", "keys"] });
  }

  async function revoke(id: string) {
    const r = await call(() => supabase.rpc("revoke_blog_key", { p_id: id }));
    if (!r.ok) return toast("danger", r.message);
    await qc.invalidateQueries({ queryKey: ["blog", "keys"] });
    toast("positive", "Key revoked. Anything using it can no longer post.");
  }

  const example = `POST ${BLOG_API_URL}
Authorization: Bearer <your key>
Content-Type: application/json

{
  "title": "How much should a logo cost in India?",
  "description": "Typical logo prices for Indian freelancers in 2026, and how to set yours.",
  "category": "market-prices",
  "body": "## Typical prices\\n\\nMost freelancers charge…"
}`;

  return (
    <Card className="mt-6">
      <CardHeader
        title="Publishing keys"
        description="Let a tool post for you (for example an automation that sends Grok's posts). Posts sent with a key are published straight away, as you, up to 20 a day per key."
      />
      <div className="space-y-5 px-5 py-4">
        {created ? (
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-4" data-testid="new-key">
            <p className="text-[13px] font-medium text-ink">Copy your “{created.label}” key now. It won't be shown again.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-3 py-2 font-mono text-[12px]">{created.key}</code>
              <CopyButton value={created.key} />
            </div>
            <p className="mt-2 text-[12px] text-muted">Paste it only into the tool that posts for you. Never share it in a chat, email or document.</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={create} className="flex flex-wrap items-end gap-2">
            <Field label="Key name" htmlFor="key-label" className="min-w-[200px] flex-1">
              <Input id="key-label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? "Creating…" : "Create key"}
            </Button>
          </form>
        )}
        {keys.data?.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line" data-testid="blog-keys">
            {keys.data.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{k.label}</span>
                  <span className="block text-[12px] text-muted">
                    Created {formatDateTime(k.created_at)} · {k.last_used_at ? `last used ${formatDateTime(k.last_used_at)}` : "never used"}
                  </span>
                </span>
                {k.revoked ? (
                  <Badge>Revoked</Badge>
                ) : (
                  <ActionButton variant="secondary" size="sm" onAction={() => revoke(k.id)} confirm={`Revoke “${k.label}”? Anything using this key stops working at once.`} confirmLabel="Revoke key" pendingLabel="Revoking…">
                    Revoke
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <details>
          <summary className="cursor-pointer text-[13px] font-medium text-accent">How a tool sends a post</summary>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-chrome p-4 font-mono text-[12px] leading-relaxed text-white/90">{example}</pre>
          <p className="mt-2 text-[12px] text-muted">
            Categories: {CATEGORIES.map((c) => c.id).join(", ")}. Add <code>"draft": true</code> to save a draft instead. The reply includes the post's address.
          </p>
        </details>
      </div>
    </Card>
  );
}

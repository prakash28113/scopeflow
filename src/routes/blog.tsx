import { useMemo, type CSSProperties } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { buttonClass, cx, Logo } from "@/components/ui";
import { SiteFooter } from "@/components/site-footer";
import { useAuth } from "@/lib/auth";
import { BLOG_IMAGE_PREFIX, useBlogList, useBlogPost, useIsBlogAuthor, type BlogListItem } from "@/lib/blog";
import { CATEGORIES, categoryOf, formatPostDate, readingMinutes, renderMarkdown, type BlogCategory } from "@/lib/blog-content";
import { SITE_URL, usePageHead } from "@/lib/seo";
import NotFound from "./not-found";

/**
 * The public blog. The Worker sends these pages fully rendered (with the same data embedded) so
 * search engines and link previews see the real post; this code takes over in the browser.
 */

export const BLOG_TITLE = "Freelancing blog: pricing, clients and growth | ScopeFlow";
export const BLOG_DESCRIPTION = "Practical advice for freelancers in India: pricing and market rates, winning and keeping clients, scope, contracts, tools and success stories.";

function BlogHeader() {
  const { session } = useAuth();
  const author = useIsBlogAuthor(Boolean(session));
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="ScopeFlow home">
            <Logo className="text-[15px]" />
          </Link>
          <span className="h-5 w-px bg-line" aria-hidden />
          <Link to="/blog" className="text-[14px] font-semibold text-ink">
            Blog
          </Link>
        </div>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Blog">
          {author.data ? (
            <Link to="/blog/write" className={buttonClass("ghost", "sm")}>
              Write
            </Link>
          ) : null}
          <Link to="/pricing" className="px-2 text-[14px] font-medium text-ink-2 hover:text-ink sm:px-3">
            Pricing
          </Link>
          {session ? (
            <Link to="/dashboard" className={buttonClass("primary", "sm")}>
              Open ScopeFlow
            </Link>
          ) : (
            <Link to="/signup" className={buttonClass("primary", "sm")}>
              Start free
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/** The post's cover photo, or a designed cover in the category's colour when there's none. */
export function PostCover({ category, title, large, image, alt }: { category: BlogCategory; title?: string; large?: boolean; image?: string | null; alt?: string }) {
  const c = categoryOf(category);
  const shape = large ? "aspect-[2/1] rounded-2xl sm:aspect-[5/2]" : "aspect-[16/9] rounded-xl";
  if (image) {
    return (
      <div className={cx("relative overflow-hidden bg-sunken", shape)}>
        <img src={image} alt={alt ?? ""} loading={large ? "eager" : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div className={cx("blog-cover relative overflow-hidden", shape)} style={{ "--tone": c.tone } as CSSProperties} aria-hidden>
      <span className="blog-cover-grid" />
      <span className="absolute left-4 top-4 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: c.tone }}>
        {c.label}
      </span>
      {title ? <span className="display absolute inset-x-4 bottom-4 line-clamp-3 text-[22px] font-semibold leading-[1.1] text-white sm:inset-x-6 sm:bottom-6 sm:text-[34px]">{title}</span> : null}
    </div>
  );
}

function Meta({ post, className }: { post: BlogListItem & { body?: string }; className?: string }) {
  return (
    <p className={cx("text-[13px] text-muted", className)}>
      <time dateTime={post.published_at}>{formatPostDate(post.published_at)}</time>
      {post.body ? <> · {readingMinutes(post.body)} min read</> : null}
    </p>
  );
}

function PostCard({ post, featured }: { post: BlogListItem; featured?: boolean }) {
  return (
    <article className={cx("group", featured && "grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-center")}>
      <Link to={`/blog/${post.slug}`} className="block" tabIndex={-1} aria-hidden>
        <div className="transition-transform duration-300 group-hover:-translate-y-0.5">
          <PostCover category={post.category} title={featured ? post.title : undefined} large={featured} image={post.cover_image} />
        </div>
      </Link>
      <div className={featured ? "" : "mt-4"}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: categoryOf(post.category).tone }}>
          {categoryOf(post.category).label}
        </p>
        <h2 className={cx("mt-1.5 font-semibold tracking-[-0.02em] text-ink", featured ? "display text-[28px] leading-[1.1] sm:text-[34px]" : "text-[18px] leading-snug")}>
          <Link to={`/blog/${post.slug}`} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        <p className={cx("mt-2 text-ink-2", featured ? "text-[16px] leading-relaxed" : "line-clamp-3 text-[14px]")}>{post.description}</p>
        <Meta post={post} className="mt-3" />
      </div>
    </article>
  );
}

export function BlogIndexPage() {
  const [params] = useSearchParams();
  const active = CATEGORIES.find((c) => c.id === params.get("category"))?.id ?? null;
  const list = useBlogList();
  usePageHead(
    active
      ? { title: `${categoryOf(active).label} | ScopeFlow blog`, description: BLOG_DESCRIPTION, url: `${SITE_URL}/blog?category=${active}` }
      : { title: BLOG_TITLE, description: BLOG_DESCRIPTION, url: `${SITE_URL}/blog` },
  );
  const posts = useMemo(() => (list.data ?? []).filter((p) => !active || p.category === active), [list.data, active]);
  const [first, ...rest] = posts;

  return (
    <div className="min-h-dvh bg-canvas">
      <BlogHeader />
      <main className="mx-auto max-w-6xl px-4 pb-8 pt-10 sm:px-6 sm:pt-14">
        <div className="max-w-2xl">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">The ScopeFlow blog</p>
          <h1 className="display mt-3 text-[38px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[52px]">Run your freelance business better.</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{BLOG_DESCRIPTION}</p>
        </div>
        <nav className="mt-8 flex flex-wrap gap-2" aria-label="Categories">
          <Link to="/blog" className={cx("rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors", !active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-ink/40")}>
            All posts
          </Link>
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              to={`/blog?category=${c.id}`}
              aria-current={active === c.id ? "page" : undefined}
              className={cx("rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors", active === c.id ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-ink/40")}
            >
              {c.label}
            </Link>
          ))}
        </nav>

        {list.isLoading ? (
          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton aspect-[16/9] rounded-xl" />
            ))}
          </div>
        ) : list.isError ? (
          <p className="mt-10 text-muted">Couldn't load the posts. Please refresh.</p>
        ) : !first ? (
          <div className="mt-10 rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            <p className="text-[16px] font-medium text-ink">{active ? "No posts in this category yet." : "The first posts are on their way."}</p>
            <p className="mt-1 text-[14px] text-muted">New posts are on the way.</p>
          </div>
        ) : (
          <>
            <div className="mt-10 border-b border-line pb-12" data-testid="blog-featured">
              <PostCard post={first} featured />
            </div>
            {rest.length ? (
              <div className="mt-12 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3" data-testid="blog-list">
                {rest.map((p) => (
                  <PostCard key={p.slug} post={p} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export function BlogPostPage() {
  const { slug = "" } = useParams();
  const q = useBlogPost(slug);
  const list = useBlogList();
  const post = q.data;
  usePageHead(post ? { title: `${post.title} | ScopeFlow blog`, description: post.description, url: `${SITE_URL}/blog/${post.slug}` } : null);
  const html = useMemo(() => (post ? renderMarkdown(post.body, { imagePrefix: BLOG_IMAGE_PREFIX }) : ""), [post]);

  if (q.isLoading) {
    return (
      <div className="min-h-dvh bg-canvas">
        <BlogHeader />
        <div className="mx-auto max-w-[720px] px-4 pt-14" aria-busy>
          <div className="skeleton h-10 w-3/4 rounded" />
          <div className="skeleton mt-4 h-5 w-full rounded" />
        </div>
      </div>
    );
  }
  if (!post) return <NotFound />;
  const c = categoryOf(post.category);
  const more = (list.data ?? []).filter((p) => p.slug !== post.slug).slice(0, 3);

  return (
    <div className="min-h-dvh bg-canvas">
      <BlogHeader />
      <main>
        <article className="mx-auto max-w-[720px] px-4 pb-6 pt-10 sm:px-6 sm:pt-14">
          <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
            <Link to="/blog" className="hover:text-ink">
              Blog
            </Link>
            <span aria-hidden> / </span>
            <Link to={`/blog?category=${c.id}`} className="font-medium hover:underline" style={{ color: c.tone }}>
              {c.label}
            </Link>
          </nav>
          <h1 className="display mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[46px]">{post.title}</h1>
          <p className="mt-4 text-[18px] leading-relaxed text-ink-2">{post.description}</p>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 text-[14px] text-muted">
            <span className="font-medium text-ink">{post.author_name}</span>
            <span aria-hidden>·</span>
            <time dateTime={post.published_at}>{formatPostDate(post.published_at)}</time>
            <span aria-hidden>·</span>
            <span>{readingMinutes(post.body)} min read</span>
          </p>
          <div className="mt-8">
            <PostCover category={post.category} large image={post.cover_image} alt={post.title} />
          </div>
          <div className="blog-prose mt-10" data-testid="blog-body" dangerouslySetInnerHTML={{ __html: html }} />
          <aside className="mt-14 rounded-2xl bg-chrome px-6 py-7 text-white sm:px-8">
            <p className="display text-[22px] font-semibold leading-tight">Every client job, on the record.</p>
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              Quote it, get it approved by link, check every “small change” against it, and invoice with GST. Free for 2 active projects.
            </p>
            <Link to="/signup" className={cx(buttonClass("primary"), "mt-5")}>
              Start free
            </Link>
          </aside>
        </article>
        {more.length ? (
          <section className="mx-auto mt-10 max-w-6xl border-t border-line px-4 pt-12 sm:px-6" aria-labelledby="more-posts">
            <h2 id="more-posts" className="text-[20px] font-semibold tracking-[-0.02em]">
              More from the blog
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}

-- =====================================================================
-- ScopeFlow — blog.
--
--   blog_authors  Emails allowed to write posts. Synced by the release from
--                 config/public-site.json (blogAuthors); never writable from the API.
--   blog_posts    Posts in Markdown. Anyone can read published posts (the public blog);
--                 drafts are visible only to authors, through blog_my_posts().
--   blog_api_keys Publishing keys an author creates for a tool that posts on their behalf
--                 (the "blog" Edge Function). Only a SHA-256 hash is stored; the key is shown once.
--
-- Authors write only through save_blog_post / delete_blog_post (checked against blog_authors);
-- tools write only through blog_publish_with_key (service role, after the function hashes the key).
-- Safe to re-run. Rollback: supabase/rollback/20261113000000_blog_down.sql
-- =====================================================================

create table if not exists public.blog_authors (
  email      text primary key check (email = lower(email) and char_length(email) <= 254),
  created_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title        text not null check (char_length(title) between 5 and 120),
  description  text not null check (char_length(description) between 20 and 200),
  category     text not null check (category in ('strategies', 'success-stories', 'market-prices', 'tools', 'news')),
  body         text not null check (char_length(body) between 1 and 60000),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  author_name  text not null check (char_length(author_name) between 1 and 80),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (status = 'draft' or published_at is not null)
);
create table if not exists public.blog_api_keys (
  id           uuid primary key default gen_random_uuid(),
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label        text not null check (char_length(label) between 1 and 60),
  author_email text not null references public.blog_authors (email) on delete cascade,
  author_name  text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  -- Posts made with this key in the current 24-hour window (limit 20).
  window_start timestamptz not null default now(),
  window_posts integer not null default 0
);

create index if not exists blog_posts_published_idx on public.blog_posts (published_at desc) where status = 'published';

alter table public.blog_authors enable row level security;
alter table public.blog_posts   enable row level security;
alter table public.blog_api_keys enable row level security;
revoke all on public.blog_authors, public.blog_posts, public.blog_api_keys from public, anon, authenticated;
grant select on public.blog_posts to anon, authenticated;

drop policy if exists "published posts are public" on public.blog_posts;
create policy "published posts are public" on public.blog_posts for select to anon, authenticated
  using (status = 'published' and published_at <= now());

-- True when the signed-in account may write posts.
create or replace function public.is_blog_author()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blog_authors a join public.profiles p on p.email = a.email
     where p.id = auth.uid());
$$;

create or replace function public._require_blog_author()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles;
begin
  select * into v from public.profiles where id = public._uid();
  if not exists (select 1 from public.blog_authors where email = v.email) then
    raise exception 'Only blog authors can do this.' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- "How to price a logo" → "how-to-price-a-logo"
create or replace function public._slugify(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(trim(both '-' from regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g')), 70);
$$;

-- Every post, drafts included, for the author's list (newest first).
create or replace function public.blog_my_posts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._require_blog_author();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'title', b.title, 'description', b.description, 'category', b.category,
      'body', b.body, 'status', b.status, 'published_at', b.published_at, 'updated_at', b.updated_at,
      'author_name', b.author_name) order by coalesce(b.published_at, b.updated_at) desc)
    from public.blog_posts b), '[]'::jsonb);
end;
$$;

-- Creates (p_id null) or updates a post. p: { title, description, category, body, slug?, publish: bool }.
-- Publishing sets the publish date once; editing a published post keeps it. Returns { id, slug, status }.
create or replace function public._save_blog_post(p_id uuid, p jsonb, p_author_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_post public.blog_posts;
  v_title text := trim(coalesce(p ->> 'title', ''));
  v_desc text := trim(coalesce(p ->> 'description', ''));
  v_body text := trim(coalesce(p ->> 'body', ''));
  v_cat text := coalesce(p ->> 'category', '');
  v_publish boolean := coalesce((p ->> 'publish')::boolean, false);
  v_base text;
  v_slug text;
  n integer := 1;
begin
  if char_length(v_title) not between 5 and 120 then
    raise exception 'Give the post a title of 5 to 120 characters.' using errcode = '22023';
  end if;
  if char_length(v_desc) not between 20 and 200 then
    raise exception 'Write a short summary of 20 to 200 characters (it shows in Google and on the blog).' using errcode = '22023';
  end if;
  if v_cat not in ('strategies', 'success-stories', 'market-prices', 'tools', 'news') then
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  if char_length(v_body) not between 1 and 60000 then
    raise exception 'Write the post (up to 60,000 characters).' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_post from public.blog_posts where id = p_id for update;
    if not found then
      raise exception 'Post not found.' using errcode = 'P0002';
    end if;
  end if;

  -- A published post keeps its address (links and Google results keep working).
  if v_post.id is not null and v_post.published_at is not null then
    v_slug := v_post.slug;
  else
    v_base := public._slugify(coalesce(nullif(p ->> 'slug', ''), v_title));
    if v_base = '' then
      v_base := 'post';
    end if;
    v_slug := v_base;
    while exists (select 1 from public.blog_posts where slug = v_slug and id is distinct from v_post.id) loop
      n := n + 1;
      v_slug := v_base || '-' || n;
    end loop;
  end if;

  if v_post.id is null then
    insert into public.blog_posts (slug, title, description, category, body, status, author_name, published_at)
    values (v_slug, v_title, v_desc, v_cat, v_body, case when v_publish then 'published' else 'draft' end,
            left(coalesce(nullif(trim(p_author_name), ''), 'ScopeFlow'), 80),
            case when v_publish then now() end)
    returning * into v_post;
  else
    update public.blog_posts
       set slug = v_slug, title = v_title, description = v_desc, category = v_cat, body = v_body,
           status = case when v_publish then 'published' else 'draft' end,
           published_at = case when v_publish then coalesce(published_at, now()) else published_at end,
           updated_at = now()
     where id = v_post.id
    returning * into v_post;
  end if;
  return jsonb_build_object('id', v_post.id, 'slug', v_post.slug, 'status', v_post.status);
end;
$$;

create or replace function public.save_blog_post(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author public.profiles := public._require_blog_author();
begin
  return public._save_blog_post(p_id, p, coalesce(nullif(v_author.full_name, ''), v_author.business_name));
end;
$$;

-- ---------------------------------------------------------------------
-- Publishing keys (for a tool that posts on the author's behalf)
-- ---------------------------------------------------------------------
-- Returns the key once: { id, key, label }. At most 5 active keys per author.
create or replace function public.create_blog_key(p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author public.profiles := public._require_blog_author();
  v_key text := 'sfblog_' || public._new_token();
  v_id uuid;
  v_label text := left(trim(coalesce(p_label, '')), 60);
begin
  if v_label = '' then
    raise exception 'Name the key (e.g. "Grok").' using errcode = '22023';
  end if;
  if (select count(*) from public.blog_api_keys where author_email = v_author.email and revoked_at is null) >= 5 then
    raise exception 'You have 5 active keys. Revoke one first.' using errcode = '22023';
  end if;
  insert into public.blog_api_keys (key_hash, label, author_email, author_name)
  values (public._hash_token(v_key), v_label, v_author.email,
          left(coalesce(nullif(v_author.full_name, ''), v_author.business_name, 'ScopeFlow'), 80))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key, 'label', v_label);
end;
$$;

create or replace function public.blog_my_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_author public.profiles := public._require_blog_author();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', k.id, 'label', k.label, 'created_at', k.created_at,
                                        'last_used_at', k.last_used_at, 'revoked', k.revoked_at is not null)
                     order by k.created_at desc)
      from public.blog_api_keys k where k.author_email = v_author.email), '[]'::jsonb);
end;
$$;

create or replace function public.revoke_blog_key(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author public.profiles := public._require_blog_author();
begin
  update public.blog_api_keys set revoked_at = coalesce(revoked_at, now())
   where id = p_id and author_email = v_author.email;
  if not found then
    raise exception 'Key not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- Called by the "blog" Edge Function (service role) with the SHA-256 of the key it received.
-- The key's author must still be a blog author. At most 20 posts per key per 24 hours.
create or replace function public.blog_publish_with_key(p_key_hash text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.blog_api_keys;
begin
  select * into k from public.blog_api_keys
   where key_hash = p_key_hash and revoked_at is null
     and author_email in (select email from public.blog_authors)
   for update;
  if not found then
    raise exception 'Invalid or revoked publishing key.' using errcode = '28000';
  end if;
  if k.window_start <= now() - interval '24 hours' then
    k.window_start := now();
    k.window_posts := 0;
  end if;
  if k.window_posts >= 20 then
    raise exception 'Daily limit reached (20 posts per key). Try again tomorrow.' using errcode = '54000';
  end if;
  update public.blog_api_keys
     set last_used_at = now(), window_start = k.window_start, window_posts = k.window_posts + 1
   where id = k.id;
  return public._save_blog_post(null, p, k.author_name);
end;
$$;

create or replace function public.delete_blog_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_blog_author();
  delete from public.blog_posts where id = p_id;
  if not found then
    raise exception 'Post not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.is_blog_author(), public._require_blog_author(), public._slugify(text),
  public.blog_my_posts(), public._save_blog_post(uuid, jsonb, text), public.save_blog_post(uuid, jsonb),
  public.delete_blog_post(uuid), public.create_blog_key(text), public.blog_my_keys(), public.revoke_blog_key(uuid),
  public.blog_publish_with_key(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.is_blog_author(), public.blog_my_posts(), public.save_blog_post(uuid, jsonb),
  public.delete_blog_post(uuid), public.create_blog_key(text), public.blog_my_keys(), public.revoke_blog_key(uuid)
  to authenticated;
grant execute on function public.blog_publish_with_key(text, jsonb) to service_role;

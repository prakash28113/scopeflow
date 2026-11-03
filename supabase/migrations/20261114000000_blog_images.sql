-- =====================================================================
-- ScopeFlow — blog images.
--
--   blog_posts.cover_image  Optional cover photo (an uploaded image's public address).
--   Storage bucket "blog"   Public images (WebP/JPEG/PNG, up to 3 MB each). Only blog authors can
--                           upload or delete; anyone can view (they're published on the blog).
--
-- Safe to re-run. Rollback: supabase/rollback/20261114000000_blog_images_down.sql
-- =====================================================================

alter table public.blog_posts add column if not exists cover_image text
  check (cover_image is null or (cover_image ~ '^https?://[^\s"<>'']+$' and char_length(cover_image) <= 500));

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
  v_cover text := nullif(trim(coalesce(p ->> 'cover_image', '')), '');
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

  -- The app only sends addresses of photos it uploaded (https on Supabase; http on the local test stand-in).
  if v_cover is not null and (v_cover !~ '^https?://[^\s"<>'']+$' or char_length(v_cover) > 500) then
    raise exception 'The cover image must be an uploaded image.' using errcode = '22023';
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
    insert into public.blog_posts (slug, title, description, category, body, status, author_name, published_at, cover_image)
    values (v_slug, v_title, v_desc, v_cat, v_body, case when v_publish then 'published' else 'draft' end,
            left(coalesce(nullif(trim(p_author_name), ''), 'ScopeFlow'), 80),
            case when v_publish then now() end, v_cover)
    returning * into v_post;
  else
    update public.blog_posts
       set slug = v_slug, title = v_title, description = v_desc, category = v_cat, body = v_body,
           -- Leaving cover_image out keeps the current cover (tools that don't send one); null removes it.
           cover_image = case when p ? 'cover_image' then v_cover else cover_image end,
           status = case when v_publish then 'published' else 'draft' end,
           published_at = case when v_publish then coalesce(published_at, now()) else published_at end,
           updated_at = now()
     where id = v_post.id
    returning * into v_post;
  end if;
  return jsonb_build_object('id', v_post.id, 'slug', v_post.slug, 'status', v_post.status);
end;
$$;

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
      'author_name', b.author_name, 'cover_image', b.cover_image) order by coalesce(b.published_at, b.updated_at) desc)
    from public.blog_posts b), '[]'::jsonb);
end;
$$;


-- Storage (present on Supabase; the database tests use a stand-in schema).
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('blog', 'blog', true, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update
      set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists "blog authors upload images" on storage.objects';
    execute $p$create policy "blog authors upload images" on storage.objects for insert to authenticated
      with check (bucket_id = 'blog' and public.is_blog_author())$p$;
    execute 'drop policy if exists "blog authors delete images" on storage.objects';
    execute $p$create policy "blog authors delete images" on storage.objects for delete to authenticated
      using (bucket_id = 'blog' and public.is_blog_author())$p$;
  end if;
end
$do$;

revoke all on function public._save_blog_post(uuid, jsonb, text), public.blog_my_posts() from public, anon, authenticated;
grant execute on function public.blog_my_posts() to authenticated;

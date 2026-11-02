-- Rollback for the blog (20261113000000_blog.sql). Removes posts and authors. Safe to re-run.
begin;
drop function if exists public.blog_publish_with_key(text, jsonb);
drop function if exists public.revoke_blog_key(uuid);
drop function if exists public.blog_my_keys();
drop function if exists public.create_blog_key(text);
drop function if exists public._save_blog_post(uuid, jsonb, text);
drop function if exists public.delete_blog_post(uuid);
drop function if exists public.save_blog_post(uuid, jsonb);
drop function if exists public.blog_my_posts();
drop function if exists public._slugify(text);
drop function if exists public._require_blog_author();
drop function if exists public.is_blog_author();
drop table if exists public.blog_api_keys;
drop table if exists public.blog_posts;
drop table if exists public.blog_authors;
commit;

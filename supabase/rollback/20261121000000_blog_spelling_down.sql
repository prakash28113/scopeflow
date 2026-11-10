-- Rollback for 20261121000000_blog_spelling.sql: removes the spelling triggers and helpers.
-- The corrected text stays (it is the right spelling). Safe to re-run.
begin;
drop trigger if exists blog_posts_a_spelling on public.blog_posts;
drop trigger if exists blog_api_keys_spelling on public.blog_api_keys;
drop function if exists public._blog_spelling();
drop function if exists public._brand_spelling(text);
commit;

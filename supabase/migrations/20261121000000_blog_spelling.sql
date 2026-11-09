-- T2-02: "Prakash Mummidisetti" and "ScopeFlow" on every blog post, for good.
--
-- 20261117000000 corrected blog_posts and profiles but not blog_api_keys.author_name, which
-- publishing with a key copies into each new post, so the next post carried the old spelling again.
-- This corrects the stored rows and adds a trigger so a post or key can't be saved with either
-- misspelling, whichever path writes it (_save_blog_post from the editor or from a key).
-- The lowercase domain (scopeflow.in), addresses and emails are left alone. Safe to re-run.
-- (20261119000000 is left free for the AI layer.)
begin;

create or replace function public._brand_spelling(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    replace(t, 'Mummidisett' || 'y', 'Mummidisetti'),
    '(^|[^[:alnum:]_@./-])Scope' || 'flow(?![[:alnum:]_@]|\.[a-z])', '\1ScopeFlow', 'g');
$$;

create or replace function public._blog_spelling()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_name := public._brand_spelling(new.author_name);
  if tg_table_name = 'blog_posts' then
    new.title := public._brand_spelling(new.title);
    new.description := public._brand_spelling(new.description);
    new.body := public._brand_spelling(new.body);
  end if;
  return new;
end;
$$;

-- Named to run before blog_posts_unique_meta, so uniqueness is checked on the corrected text.
drop trigger if exists blog_posts_a_spelling on public.blog_posts;
create trigger blog_posts_a_spelling before insert or update on public.blog_posts
  for each row execute function public._blog_spelling();
drop trigger if exists blog_api_keys_spelling on public.blog_api_keys;
create trigger blog_api_keys_spelling before insert or update on public.blog_api_keys
  for each row execute function public._blog_spelling();

revoke all on function public._brand_spelling(text), public._blog_spelling() from public, anon, authenticated;

-- Existing rows (the triggers above do the rewriting).
update public.blog_api_keys set author_name = author_name
 where author_name is distinct from public._brand_spelling(author_name);
update public.blog_posts set author_name = author_name
 where author_name is distinct from public._brand_spelling(author_name)
    or title is distinct from public._brand_spelling(title)
    or description is distinct from public._brand_spelling(description)
    or body is distinct from public._brand_spelling(body);

commit;

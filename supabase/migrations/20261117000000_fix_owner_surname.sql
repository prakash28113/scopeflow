-- DEV-SF-SPELL-1: the owner's surname is "Mummidisetti". Reverts the name change in
-- 20261116000000_brand_growth.sql for blog authors and the owner's profile.
update public.blog_posts set author_name = replace(author_name, 'Mummidisett' || 'y', 'Mummidisetti')
 where author_name like '%Mummidisett' || 'y%';
update public.profiles set full_name = replace(full_name, 'Mummidisett' || 'y', 'Mummidisetti')
 where email = 'prakashmummidisetti@gmail.com' and full_name like '%Mummidisett' || 'y%';

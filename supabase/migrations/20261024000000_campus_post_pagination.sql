drop function if exists public.list_mtu_campus_posts_page(text, timestamptz, uuid, integer);
create function public.list_mtu_campus_posts_page(
  p_query text default '',
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 21
)
returns table (
  id uuid,
  author_id uuid,
  author_name text,
  author_meta text,
  body text,
  tone text,
  created_at timestamptz,
  likes integer,
  author_avatar_url text
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select post.id, post.author_id,
    coalesce(nullif(trim(profile.display_name), ''), post.author_name),
    coalesce(nullif(trim(concat_ws(' · ', profile.programme, profile.level)), ''), post.author_meta),
    post.body, post.tone, post.created_at, post.likes, profile.avatar_url
  from public.campus_posts post
  left join public.profiles profile on profile.id = post.author_id
  where auth.uid() is not null
    and public.is_mtu_account()
    and public.mtu_campus_post_is_visible(post.id)
    and (
      nullif(trim(coalesce(p_query, '')), '') is null
      or post.body ilike '%' || trim(p_query) || '%'
      or coalesce(profile.display_name, post.author_name) ilike '%' || trim(p_query) || '%'
      or coalesce(post.author_meta, '') ilike '%' || trim(p_query) || '%'
    )
    and (
      p_before_created_at is null
      or (post.created_at, post.id) < (p_before_created_at, p_before_id)
    )
  order by post.created_at desc, post.id desc
  limit greatest(1, least(coalesce(p_limit, 21), 51));
$$;

revoke execute on function public.list_mtu_campus_posts_page(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_mtu_campus_posts_page(text, timestamptz, uuid, integer) to authenticated;

notify pgrst, 'reload schema';

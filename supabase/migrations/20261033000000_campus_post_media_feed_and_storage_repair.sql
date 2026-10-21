do $$
begin
  if to_regclass('public.campus_post_media') is null then
    raise exception 'Apply 20261025000000_campus_post_media.sql before this repair';
  end if;
  if to_regclass('public.campus_posts') is null
     or to_regclass('public.profiles') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.is_mtu_account()') is null
     or to_regprocedure('public.mtu_campus_post_is_visible(uuid)') is null then
    raise exception 'Required campus post, profile, Storage, and visibility prerequisites are missing';
  end if;
end
$$;

create or replace function public.can_read_mtu_campus_post_media(p_media_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and exists (
      select 1
      from public.campus_post_media media
      where media.media_path = p_media_path
        and public.mtu_campus_post_is_visible(media.post_id)
    );
$$;

revoke all on function public.can_read_mtu_campus_post_media(text) from public, anon;
grant execute on function public.can_read_mtu_campus_post_media(text) to authenticated;

drop policy if exists "Eligible members read visible campus post media" on storage.objects;
create policy "Eligible members read visible campus post media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campus-post-media'
    and public.can_read_mtu_campus_post_media(name)
  );

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
  author_avatar_url text,
  media jsonb
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select post.id, post.author_id,
    coalesce(nullif(trim(profile.display_name), ''), post.author_name),
    coalesce(nullif(trim(concat_ws(' · ', profile.programme, profile.level)), ''), post.author_meta),
    post.body, post.tone, post.created_at, post.likes, profile.avatar_url,
    coalesce(media.items, '[]'::jsonb)
  from public.campus_posts post
  left join public.profiles profile on profile.id = post.author_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'media_path', item.media_path,
      'media_type', item.media_type,
      'mime_type', item.mime_type,
      'position', item.position
    ) order by item.position) as items
    from public.campus_post_media item
    where item.post_id = post.id
  ) media on true
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

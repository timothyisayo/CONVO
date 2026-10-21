create table if not exists public.campus_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.campus_posts(id) on delete cascade,
  media_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime')),
  position smallint not null check (position between 0 and 9),
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

create index if not exists campus_post_media_post_position_idx
  on public.campus_post_media (post_id, position);
alter table public.campus_post_media enable row level security;
revoke all on public.campus_post_media from public, anon, authenticated;
drop policy if exists "No direct access to campus post media metadata" on public.campus_post_media;
create policy "No direct access to campus post media metadata"
  on public.campus_post_media for all to authenticated
  using (false) with check (false);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campus-post-media', 'campus-post-media', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Eligible members upload their own campus post media" on storage.objects;
create policy "Eligible members upload their own campus post media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'campus-post-media'
    and public.is_mtu_account()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Eligible members read visible campus post media" on storage.objects;
create policy "Eligible members read visible campus post media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campus-post-media'
    and public.is_mtu_account()
    and exists (
      select 1
      from public.campus_post_media media
      where media.media_path = storage.objects.name
        and public.mtu_campus_post_is_visible(media.post_id)
    )
  );

drop policy if exists "Members delete their own unclaimed campus post media" on storage.objects;
create policy "Members delete their own unclaimed campus post media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'campus-post-media'
    and public.is_mtu_account()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.create_mtu_campus_post_with_media(p_body text, p_media jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result_id uuid;
  profile_name text;
  profile_meta text;
  media_item jsonb;
  item_position integer := 0;
  media_count integer;
  video_count integer;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to post';
  end if;
  if jsonb_typeof(coalesce(p_media, '[]'::jsonb)) <> 'array' then
    raise exception 'Post media must be a list of uploaded files';
  end if;
  media_count := jsonb_array_length(coalesce(p_media, '[]'::jsonb));
  if media_count > 10 then
    raise exception 'A post can include up to 10 images or one video';
  end if;
  if char_length(trim(coalesce(p_body, ''))) > 2000
     or (media_count = 0 and char_length(trim(coalesce(p_body, ''))) = 0) then
    raise exception 'Add text or media to your post; captions must be 2000 characters or fewer';
  end if;
  select count(*) into video_count
  from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) as media_rows(value)
  where media_rows.value ->> 'media_type' = 'video';
  if video_count > 0 and media_count <> 1 then
    raise exception 'A video post can include only one video';
  end if;

  select coalesce(nullif(trim(display_name), ''), 'Convo member'),
    coalesce(nullif(trim(concat_ws(' · ', programme, level)), ''), 'Convo community')
  into profile_name, profile_meta
  from public.profiles
  where id = auth.uid();

  insert into public.campus_posts (author_id, author_name, author_meta, body, tone)
  values (auth.uid(), coalesce(profile_name, 'Convo member'), coalesce(profile_meta, 'Convo community'),
    coalesce(nullif(trim(p_body), ''), ' '), 'rose')
  returning id into result_id;

  for media_item in select value from jsonb_array_elements(coalesce(p_media, '[]'::jsonb))
  loop
    if media_item ->> 'media_type' not in ('image', 'video')
       or media_item ->> 'mime_type' not in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime')
       or (media_item ->> 'media_type' = 'image' and media_item ->> 'mime_type' not like 'image/%')
       or (media_item ->> 'media_type' = 'video' and media_item ->> 'mime_type' not like 'video/%') then
      raise exception 'Unsupported post media type';
    end if;
    if coalesce(media_item ->> 'media_path', '') not like auth.uid()::text || '/%'
       or not exists (
         select 1 from storage.objects object
         where object.bucket_id = 'campus-post-media'
           and object.name = media_item ->> 'media_path'
       ) then
      raise exception 'Post media must be uploaded to your private Convo media folder first';
    end if;
    insert into public.campus_post_media (post_id, media_path, media_type, mime_type, position)
    values (result_id, media_item ->> 'media_path', media_item ->> 'media_type', media_item ->> 'mime_type', item_position);
    item_position := item_position + 1;
  end loop;
  return result_id;
end;
$$;
revoke execute on function public.create_mtu_campus_post_with_media(text, jsonb) from public, anon;
grant execute on function public.create_mtu_campus_post_with_media(text, jsonb) to authenticated;

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

create or replace function public.delete_mtu_campus_post(p_post_id uuid)
returns text[]
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  media_paths text[];
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to delete a post';
  end if;
  select coalesce(array_agg(media.media_path), '{}'::text[]) into media_paths
  from public.campus_post_media media
  join public.campus_posts post on post.id = media.post_id
  where post.id = p_post_id and post.author_id = auth.uid();
  delete from public.campus_posts
  where id = p_post_id and author_id = auth.uid();
  if not found then
    raise exception 'You can only delete your own post';
  end if;
  return media_paths;
end;
$$;
revoke execute on function public.delete_mtu_campus_post(uuid) from public, anon;
grant execute on function public.delete_mtu_campus_post(uuid) to authenticated;

notify pgrst, 'reload schema';

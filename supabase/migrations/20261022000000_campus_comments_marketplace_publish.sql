-- Repair the conversation appearance RPC return contract and add live profile
-- details, post discussions, and secure Marketplace publishing.

drop function if exists public.get_mtu_conversation_appearance(uuid);
drop function if exists public.set_mtu_conversation_appearance(uuid, text, text);
create function public.get_mtu_conversation_appearance(p_conversation_id uuid)
returns table(chat_theme text, wallpaper_variant text)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select coalesce(pref.chat_theme, 'convo'), coalesce(pref.wallpaper_variant, 'plain')
  from (select 1) anchor
  left join public.conversation_member_preferences pref
    on pref.conversation_id = p_conversation_id
   and pref.user_id = auth.uid()
  where auth.uid() is not null
    and public.is_mtu_account()
    and exists (
      select 1
      from public.conversation_members member
      where member.conversation_id = p_conversation_id
        and member.user_id = auth.uid()
    );
$$;

create function public.set_mtu_conversation_appearance(
  p_conversation_id uuid,
  p_chat_theme text,
  p_wallpaper_variant text
)
returns table(chat_theme text, wallpaper_variant text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or not exists (
    select 1
    from public.conversation_members member
    where member.conversation_id = p_conversation_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'You cannot change this conversation appearance';
  end if;
  if p_chat_theme not in ('convo', 'cream', 'peach', 'sage', 'lavender', 'midnight')
     or p_wallpaper_variant not in ('plain', 'organic', 'campus', 'gradient') then
    raise exception 'Unsupported appearance option';
  end if;
  insert into public.conversation_member_preferences(
    conversation_id, user_id, chat_theme, wallpaper_variant, updated_at
  )
  values (p_conversation_id, auth.uid(), p_chat_theme, p_wallpaper_variant, now())
  on conflict (conversation_id, user_id) do update
    set chat_theme = excluded.chat_theme,
        wallpaper_variant = excluded.wallpaper_variant,
        updated_at = now();
  return query select p_chat_theme, p_wallpaper_variant;
end;
$$;

revoke execute on function public.get_mtu_conversation_appearance(uuid), public.set_mtu_conversation_appearance(uuid, text, text) from public, anon;
grant execute on function public.get_mtu_conversation_appearance(uuid), public.set_mtu_conversation_appearance(uuid, text, text) to authenticated;

create or replace function public.list_mtu_campus_posts(p_query text default '')
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
  order by post.created_at desc
  limit 100;
$$;
revoke execute on function public.list_mtu_campus_posts(text) from public, anon;
grant execute on function public.list_mtu_campus_posts(text) to authenticated;

create table if not exists public.campus_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.campus_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists campus_post_comments_post_created_idx
  on public.campus_post_comments(post_id, created_at);
alter table public.campus_post_comments enable row level security;
revoke all on public.campus_post_comments from public, anon, authenticated;
drop policy if exists "No direct campus post comment access" on public.campus_post_comments;
create policy "No direct campus post comment access"
  on public.campus_post_comments for all to authenticated
  using (false) with check (false);

create or replace function public.list_mtu_campus_post_comments(p_post_id uuid)
returns table (
  id uuid,
  post_id uuid,
  author_id uuid,
  author_name text,
  author_avatar_url text,
  body text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select comment.id, comment.post_id, comment.author_id,
    coalesce(nullif(trim(profile.display_name), ''), 'Convo member'),
    profile.avatar_url, comment.body, comment.created_at
  from public.campus_post_comments comment
  join public.profiles profile on profile.id = comment.author_id
  where auth.uid() is not null
    and public.is_mtu_account()
    and public.mtu_campus_post_is_visible(p_post_id)
    and comment.post_id = p_post_id
  order by comment.created_at asc;
$$;

create or replace function public.create_mtu_campus_post_comment(p_post_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare comment_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to comment';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'Comments must contain 1 to 1000 characters';
  end if;
  if not public.mtu_campus_post_is_visible(p_post_id) then
    raise exception 'This post is unavailable';
  end if;
  insert into public.campus_post_comments(post_id, author_id, body)
  values (p_post_id, auth.uid(), trim(p_body))
  returning id into comment_id;
  return comment_id;
end;
$$;

create or replace function public.delete_mtu_campus_post_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to delete a comment';
  end if;
  delete from public.campus_post_comments comment
  where comment.id = p_comment_id
    and comment.author_id = auth.uid()
    and public.mtu_campus_post_is_visible(comment.post_id);
  return found;
end;
$$;

revoke execute on function public.list_mtu_campus_post_comments(uuid) from public, anon;
revoke execute on function public.create_mtu_campus_post_comment(uuid, text) from public, anon;
revoke execute on function public.delete_mtu_campus_post_comment(uuid) from public, anon;
grant execute on function public.list_mtu_campus_post_comments(uuid) to authenticated;
grant execute on function public.create_mtu_campus_post_comment(uuid, text) to authenticated;
grant execute on function public.delete_mtu_campus_post_comment(uuid) to authenticated;

create or replace function public.create_mtu_marketplace_listing(
  p_title text,
  p_description text,
  p_category text,
  p_condition text,
  p_price numeric,
  p_image_path text default null
)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare result public.marketplace_listings;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to publish a listing';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Titles must contain 1 to 120 characters';
  end if;
  if char_length(coalesce(p_description, '')) > 3000 then
    raise exception 'Descriptions must be 3,000 characters or fewer';
  end if;
  if p_category not in ('books', 'electronics', 'supplies', 'services', 'other') then
    raise exception 'Choose a valid Marketplace category';
  end if;
  if p_condition not in ('new', 'like_new', 'good', 'fair', 'service') then
    raise exception 'Choose a valid listing condition';
  end if;
  if p_price is null or p_price < 0 or p_price > 9999999999.99 then
    raise exception 'Enter a valid non-negative NGN price';
  end if;
  if p_image_path is not null and p_image_path not like auth.uid()::text || '/%' then
    raise exception 'Listing photo path must belong to the signed-in user';
  end if;

  insert into public.marketplace_listings(
    seller_id, title, description, category, item_condition, price, currency, image_path
  )
  values (
    auth.uid(), trim(p_title), trim(coalesce(p_description, '')), p_category,
    p_condition, p_price, 'NGN', p_image_path
  )
  returning * into result;
  return result;
end;
$$;
revoke execute on function public.create_mtu_marketplace_listing(text, text, text, text, numeric, text) from public, anon;
grant execute on function public.create_mtu_marketplace_listing(text, text, text, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';

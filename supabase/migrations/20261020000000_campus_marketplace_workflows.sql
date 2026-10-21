create table if not exists public.campus_post_reactions (
  post_id uuid not null references public.campus_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.campus_post_reactions enable row level security;
drop policy if exists "Campus post reactions are private" on public.campus_post_reactions;
create policy "Campus post reactions are private"
  on public.campus_post_reactions for all to authenticated
  using (false) with check (false);

drop policy if exists "MTU users can read posts" on public.campus_posts;
create policy "MTU users can read posts"
  on public.campus_posts for select to authenticated
  using (
    public.is_mtu_account()
    and not exists (
      select 1 from public.student_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = author_id)
         or (block.blocker_id = author_id and block.blocked_id = auth.uid())
    )
  );

revoke update on public.campus_posts from authenticated;
grant update (body) on public.campus_posts to authenticated;
grant delete on public.campus_posts to authenticated;
drop policy if exists "Authors can delete their own posts" on public.campus_posts;
create policy "Authors can delete their own posts"
  on public.campus_posts for delete to authenticated
  using (public.is_mtu_account() and auth.uid() = author_id);

create or replace function public.create_mtu_campus_post(p_body text, p_tone text default 'rose')
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  result_id uuid;
  profile_name text;
  profile_meta text;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to post';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Posts must contain 1 to 2000 characters';
  end if;

  select coalesce(nullif(trim(display_name), ''), 'Convo member'),
    coalesce(nullif(trim(concat_ws(' · ', programme, level)), ''), 'Convo community')
  into profile_name, profile_meta
  from public.profiles
  where id = auth.uid();

  insert into public.campus_posts (author_id, author_name, author_meta, body, tone)
  values (auth.uid(), coalesce(profile_name, 'Convo member'), coalesce(profile_meta, 'Convo community'),
    trim(p_body), case when p_tone in ('rose', 'sage', 'butter', 'apricot') then p_tone else 'rose' end)
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.update_mtu_campus_post(p_post_id uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to edit a post';
  end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Posts must contain 1 to 2000 characters';
  end if;

  update public.campus_posts
  set body = trim(p_body)
  where id = p_post_id and author_id = auth.uid();
  return found;
end;
$$;

create or replace function public.list_mtu_campus_post_reactions(p_post_ids uuid[] default null)
returns table (post_id uuid)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select reaction.post_id
  from public.campus_post_reactions reaction
  join public.campus_posts post on post.id = reaction.post_id
  where auth.uid() is not null
    and public.is_mtu_account()
    and reaction.user_id = auth.uid()
    and (p_post_ids is null or reaction.post_id = any(p_post_ids))
    and not exists (
      select 1 from public.student_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = post.author_id)
         or (block.blocker_id = post.author_id and block.blocked_id = auth.uid())
    );
$$;

create or replace function public.toggle_mtu_campus_post_reaction(p_post_id uuid)
returns table (liked boolean, like_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  deleted_count integer;
  inserted_count integer;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to react';
  end if;
  if not exists (
    select 1 from public.campus_posts post
    where post.id = p_post_id
      and not exists (
        select 1 from public.student_blocks block
        where (block.blocker_id = auth.uid() and block.blocked_id = post.author_id)
           or (block.blocker_id = post.author_id and block.blocked_id = auth.uid())
      )
  ) then
    raise exception 'This post is unavailable';
  end if;

  delete from public.campus_post_reactions
  where post_id = p_post_id and user_id = auth.uid();
  get diagnostics deleted_count = row_count;
  if deleted_count > 0 then
    update public.campus_posts set likes = greatest(0, likes - 1) where id = p_post_id;
    return query select false, post.likes from public.campus_posts post where post.id = p_post_id;
    return;
  end if;

  insert into public.campus_post_reactions (post_id, user_id)
  values (p_post_id, auth.uid())
  on conflict (post_id, user_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count > 0 then
    update public.campus_posts set likes = likes + 1 where id = p_post_id;
  end if;
  return query select true, post.likes from public.campus_posts post where post.id = p_post_id;
end;
$$;

revoke execute on function public.create_mtu_campus_post(text, text) from public, anon;
revoke execute on function public.update_mtu_campus_post(uuid, text) from public, anon;
revoke execute on function public.list_mtu_campus_post_reactions(uuid[]) from public, anon;
revoke execute on function public.toggle_mtu_campus_post_reaction(uuid) from public, anon;
grant execute on function public.create_mtu_campus_post(text, text) to authenticated;
grant execute on function public.update_mtu_campus_post(uuid, text) to authenticated;
grant execute on function public.list_mtu_campus_post_reactions(uuid[]) to authenticated;
grant execute on function public.toggle_mtu_campus_post_reaction(uuid) to authenticated;

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  category text not null default 'other'
    check (category in ('books', 'electronics', 'supplies', 'services', 'housing', 'other')),
  item_condition text not null default 'good'
    check (item_condition in ('new', 'like_new', 'good', 'fair', 'service')),
  price numeric(12, 2) not null default 0 check (price >= 0),
  currency text not null default 'NGN' check (currency in ('NGN', 'USD')),
  image_path text,
  status text not null default 'active' check (status in ('active', 'sold', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_path is null or image_path like seller_id::text || '/%')
);

create index if not exists marketplace_listings_active_created_idx
  on public.marketplace_listings (status, created_at desc);
create index if not exists marketplace_listings_seller_created_idx
  on public.marketplace_listings (seller_id, created_at desc);
create index if not exists marketplace_listings_category_created_idx
  on public.marketplace_listings (category, created_at desc);

alter table public.marketplace_listings enable row level security;
drop policy if exists "Eligible users can view available marketplace listings" on public.marketplace_listings;
create policy "Eligible users can view available marketplace listings"
  on public.marketplace_listings for select to authenticated
  using (
    public.is_mtu_account()
    and (
      seller_id = auth.uid()
      or (
        status = 'active'
        and not exists (
          select 1 from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = seller_id)
             or (block.blocker_id = seller_id and block.blocked_id = auth.uid())
        )
      )
    )
  );
drop policy if exists "Eligible users can create their own marketplace listings" on public.marketplace_listings;
create policy "Eligible users can create their own marketplace listings"
  on public.marketplace_listings for insert to authenticated
  with check (public.is_mtu_account() and seller_id = auth.uid());
drop policy if exists "Sellers can update their own marketplace listings" on public.marketplace_listings;
create policy "Sellers can update their own marketplace listings"
  on public.marketplace_listings for update to authenticated
  using (public.is_mtu_account() and seller_id = auth.uid())
  with check (public.is_mtu_account() and seller_id = auth.uid());
drop policy if exists "Sellers can delete their own marketplace listings" on public.marketplace_listings;
create policy "Sellers can delete their own marketplace listings"
  on public.marketplace_listings for delete to authenticated
  using (public.is_mtu_account() and seller_id = auth.uid());
grant select, insert, update, delete on public.marketplace_listings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace-media', 'marketplace-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Sellers upload their own marketplace images" on storage.objects;
create policy "Sellers upload their own marketplace images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'marketplace-media'
    and public.is_mtu_account()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "Eligible users can read listed marketplace images" on storage.objects;
create policy "Eligible users can read listed marketplace images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'marketplace-media'
    and public.is_mtu_account()
    and exists (
      select 1 from public.marketplace_listings listing
      where listing.image_path = storage.objects.name
        and (
          listing.seller_id = auth.uid()
          or (
            listing.status = 'active'
            and not exists (
              select 1 from public.student_blocks block
              where (block.blocker_id = auth.uid() and block.blocked_id = listing.seller_id)
                 or (block.blocker_id = listing.seller_id and block.blocked_id = auth.uid())
            )
          )
        )
    )
  );
drop policy if exists "Sellers delete their own marketplace images" on storage.objects;
create policy "Sellers delete their own marketplace images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'marketplace-media'
    and public.is_mtu_account()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.search_mtu_marketplace_listings(
  p_query text default '',
  p_category text default 'all'
)
returns setof public.marketplace_listings
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select listing.*
  from public.marketplace_listings listing
  where public.is_mtu_account()
    and (
      listing.seller_id = auth.uid()
      or (
        listing.status = 'active'
        and not exists (
          select 1 from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = listing.seller_id)
             or (block.blocker_id = listing.seller_id and block.blocked_id = auth.uid())
        )
      )
    )
    and (listing.seller_id = auth.uid() or listing.status = 'active')
    and (p_category = 'all' or listing.category = p_category)
    and (
      nullif(trim(coalesce(p_query, '')), '') is null
      or listing.title ilike '%' || trim(p_query) || '%'
      or listing.description ilike '%' || trim(p_query) || '%'
    )
  order by listing.created_at desc
  limit 100;
$$;
revoke execute on function public.search_mtu_marketplace_listings(text, text) from public, anon;
grant execute on function public.search_mtu_marketplace_listings(text, text) to authenticated;

create or replace function public.touch_marketplace_listing_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists marketplace_listings_touch_updated_at on public.marketplace_listings;
create trigger marketplace_listings_touch_updated_at
  before update on public.marketplace_listings
  for each row execute function public.touch_marketplace_listing_updated_at();

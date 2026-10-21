-- Preserve legacy listings and refuse the NGN-only change until an operator
-- has reviewed any USD or Housing records.
do $$
declare
  usd_listings bigint;
  housing_listings bigint;
begin
  select
    count(*) filter (where currency <> 'NGN'),
    count(*) filter (where category = 'housing')
  into usd_listings, housing_listings
  from public.marketplace_listings;

  if usd_listings > 0 or housing_listings > 0 then
    raise exception
      'Marketplace migration stopped without changing data: % non-NGN listing(s), % Housing listing(s). Review these records before retrying.',
      usd_listings, housing_listings
      using errcode = '23514';
  end if;
end;
$$;

-- Keep block relationships private while allowing row policies to check the
-- visibility of a specific post, listing, or conversation.
create or replace function public.mtu_campus_post_is_visible(p_post_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and exists (
      select 1
      from public.campus_posts post
      where post.id = p_post_id
        and not exists (
          select 1
          from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = post.author_id)
             or (block.blocker_id = post.author_id and block.blocked_id = auth.uid())
        )
    );
$$;

create or replace function public.mtu_marketplace_listing_is_visible(p_listing_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and exists (
      select 1
      from public.marketplace_listings listing
      where listing.id = p_listing_id
        and (
          listing.seller_id = auth.uid()
          or (
            listing.status = 'active'
            and not exists (
              select 1
              from public.student_blocks block
              where (block.blocker_id = auth.uid() and block.blocked_id = listing.seller_id)
                 or (block.blocker_id = listing.seller_id and block.blocked_id = auth.uid())
            )
          )
        )
    );
$$;

create or replace function public.mtu_conversation_allows_message(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and exists (
      select 1
      from public.conversations conversation
      join public.conversation_members member
        on member.conversation_id = conversation.id
       and member.user_id = auth.uid()
      where conversation.id = p_conversation_id
        and (
          conversation.kind <> 'direct'
          or not exists (
            select 1
            from public.conversation_members other_member
            join public.student_blocks block
              on (block.blocker_id = auth.uid() and block.blocked_id = other_member.user_id)
              or (block.blocker_id = other_member.user_id and block.blocked_id = auth.uid())
            where other_member.conversation_id = conversation.id
              and other_member.user_id <> auth.uid()
          )
        )
    );
$$;

revoke all on function public.mtu_campus_post_is_visible(uuid) from public, anon;
revoke all on function public.mtu_marketplace_listing_is_visible(uuid) from public, anon;
revoke all on function public.mtu_conversation_allows_message(uuid) from public, anon;
grant execute on function public.mtu_campus_post_is_visible(uuid) to authenticated;
grant execute on function public.mtu_marketplace_listing_is_visible(uuid) to authenticated;
grant execute on function public.mtu_conversation_allows_message(uuid) to authenticated;

drop policy if exists "MTU users can read posts" on public.campus_posts;
create policy "MTU users can read posts"
  on public.campus_posts for select to authenticated
  using (public.mtu_campus_post_is_visible(id));

drop policy if exists "Eligible users can view available marketplace listings" on public.marketplace_listings;
create policy "Eligible users can view available marketplace listings"
  on public.marketplace_listings for select to authenticated
  using (public.mtu_marketplace_listing_is_visible(id));

drop policy if exists "Eligible users can read listed marketplace images" on storage.objects;
create policy "Eligible users can read listed marketplace images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'marketplace-media'
    and public.is_mtu_account()
    and exists (
      select 1
      from public.marketplace_listings listing
      where listing.image_path = storage.objects.name
        and public.mtu_marketplace_listing_is_visible(listing.id)
    )
  );

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.mtu_conversation_allows_message(conversation_id)
  );

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_category_check;
alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_currency_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_category_check
    check (category in ('books', 'electronics', 'supplies', 'services', 'other'));
alter table public.marketplace_listings
  add constraint marketplace_listings_currency_check
    check (currency = 'NGN');

notify pgrst, 'reload schema';

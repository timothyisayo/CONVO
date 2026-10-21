do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.mtu_student_follows') is null
     or to_regclass('public.connection_requests') is null
     or to_regclass('public.student_blocks') is null
     or to_regclass('public.profile_approved_people') is null
     or to_regclass('public.status_posts') is null
     or to_regclass('public.status_views') is null
     or to_regclass('public.campus_posts') is null
     or to_regclass('public.campus_post_media') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.is_mtu_account()') is null
     or to_regprocedure('public.mtu_status_pair_allowed(uuid)') is null
     or to_regprocedure('public.mtu_status_user_unblocked(uuid)') is null
     or to_regprocedure('public.mtu_campus_post_is_visible(uuid)') is null then
    raise exception 'Apply the current profile, follow, connection, block, Campus Feed, media, and Stories migrations before this migration';
  end if;
end
$$;

revoke update on public.status_posts from authenticated;

create or replace function public.prevent_mtu_status_audience_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.audience is distinct from old.audience then
    raise exception 'A Story audience cannot be changed after publishing';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_mtu_status_audience_change() from public, anon, authenticated;
drop trigger if exists prevent_mtu_status_audience_change on public.status_posts;
create trigger prevent_mtu_status_audience_change
  before update of audience on public.status_posts
  for each row execute function public.prevent_mtu_status_audience_change();

create table if not exists public.mtu_student_social_privacy (
  user_id uuid primary key references auth.users(id) on delete cascade,
  followers_visibility text not null default 'private'
    check (followers_visibility in ('public', 'followers', 'private')),
  following_visibility text not null default 'private'
    check (following_visibility in ('public', 'followers', 'private')),
  updated_at timestamptz not null default now()
);
alter table public.mtu_student_social_privacy enable row level security;
revoke all on public.mtu_student_social_privacy from public, anon, authenticated;

create table if not exists public.mtu_student_content_restrictions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  restricted_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, restricted_user_id),
  check (owner_id <> restricted_user_id)
);
create index if not exists mtu_student_content_restrictions_target_idx
  on public.mtu_student_content_restrictions (restricted_user_id, owner_id);
alter table public.mtu_student_content_restrictions enable row level security;
revoke all on public.mtu_student_content_restrictions from public, anon, authenticated;

create or replace function public.mtu_student_content_visible(p_author_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and (
      p_author_id = auth.uid()
      or (
        public.mtu_status_user_unblocked(p_author_id)
        and not exists (
          select 1
          from public.mtu_student_content_restrictions restriction
          where restriction.owner_id = p_author_id
            and restriction.restricted_user_id = auth.uid()
        )
      )
    );
$$;
revoke all on function public.mtu_student_content_visible(uuid) from public, anon;
grant execute on function public.mtu_student_content_visible(uuid) to authenticated;

create or replace function public.mtu_campus_post_is_visible(p_post_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and exists (
      select 1
      from public.campus_posts post
      where post.id = p_post_id
        and public.mtu_student_content_visible(post.author_id)
    );
$$;
revoke all on function public.mtu_campus_post_is_visible(uuid) from public, anon;
grant execute on function public.mtu_campus_post_is_visible(uuid) to authenticated;

create or replace function public.set_mtu_student_follow_list_visibility(
  p_followers_visibility text,
  p_following_visibility text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to update profile privacy';
  end if;
  if p_followers_visibility is null
     or p_following_visibility is null
     or p_followers_visibility not in ('public', 'followers', 'private')
     or p_following_visibility not in ('public', 'followers', 'private') then
    raise exception 'Choose a valid visibility for each follow list';
  end if;
  insert into public.mtu_student_social_privacy (
    user_id, followers_visibility, following_visibility, updated_at
  )
  values (auth.uid(), p_followers_visibility, p_following_visibility, now())
  on conflict (user_id) do update
    set followers_visibility = excluded.followers_visibility,
        following_visibility = excluded.following_visibility,
        updated_at = excluded.updated_at;
  return true;
end;
$$;

create or replace function public.get_mtu_student_follow_list_visibility()
returns table (followers_visibility text, following_visibility text)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select coalesce(settings.followers_visibility, 'private'),
    coalesce(settings.following_visibility, 'private')
  from (select auth.uid() as user_id) current_user_row
  left join public.mtu_student_social_privacy settings
    on settings.user_id = current_user_row.user_id
  where auth.uid() is not null and public.is_mtu_account();
$$;

create or replace function public.list_mtu_student_follows_for(
  p_profile_id uuid,
  p_direction text
)
returns table (
  id uuid,
  display_name text,
  student_id text,
  programme text,
  department text,
  level text,
  avatar_url text,
  bio text,
  status_text text,
  follower_count bigint,
  following_count bigint
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
declare
  list_visibility text;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to view follow lists';
  end if;
  if p_profile_id is null
     or p_direction is null
     or p_direction not in ('followers', 'following')
     or not exists (select 1 from public.profiles profile where profile.id = p_profile_id) then
    raise exception 'This follow list is not available';
  end if;
  if exists (
    select 1 from public.student_blocks block
    where (block.blocker_id = auth.uid() and block.blocked_id = p_profile_id)
       or (block.blocker_id = p_profile_id and block.blocked_id = auth.uid())
  ) then
    return;
  end if;
  if p_profile_id <> auth.uid()
     and coalesce((
       select (profile.profile_visibility ->> 'incognito')::boolean
       from public.profiles profile where profile.id = p_profile_id
     ), false)
     and not exists (
       select 1 from public.connection_requests accepted
       where accepted.status = 'accepted'
         and ((accepted.requester_id = auth.uid() and accepted.recipient_id = p_profile_id)
           or (accepted.requester_id = p_profile_id and accepted.recipient_id = auth.uid()))
     )
     and not exists (
       select 1 from public.profile_approved_people approved
       where approved.profile_id = p_profile_id and approved.approved_user_id = auth.uid()
     ) then
    return;
  end if;

  select case when p_direction = 'followers'
    then settings.followers_visibility else settings.following_visibility end
  into list_visibility
  from public.mtu_student_social_privacy settings
  where settings.user_id = p_profile_id;
  list_visibility := coalesce(list_visibility, 'private');

  if p_profile_id <> auth.uid() and (
    list_visibility = 'private'
    or (list_visibility = 'followers' and not exists (
      select 1 from public.mtu_student_follows viewer_follow
      where viewer_follow.follower_id = auth.uid()
        and viewer_follow.followed_id = p_profile_id
    ))
  ) then
    return;
  end if;

  return query
  select profile.id,
    coalesce(nullif(trim(profile.display_name), ''), 'Convo member'),
    case when profile.id = auth.uid()
      or coalesce((profile.profile_visibility ->> 'allow_public_id_copy')::boolean, true)
      then profile.student_id else null end,
    profile.programme, profile.department, profile.level, profile.avatar_url, profile.bio, profile.status_text,
    case when profile.id = auth.uid()
      or coalesce(listed_profile_privacy.followers_visibility, 'private') = 'public'
      or (
        listed_profile_privacy.followers_visibility = 'followers'
        and exists (
          select 1 from public.mtu_student_follows viewer_follow
          where viewer_follow.follower_id = auth.uid()
            and viewer_follow.followed_id = profile.id
        )
      )
      then (
        select count(*)::bigint
        from public.mtu_student_follows follower
        where follower.followed_id = profile.id
          and not exists (
            select 1 from public.student_blocks block
            where (block.blocker_id = auth.uid() and block.blocked_id = follower.follower_id)
               or (block.blocker_id = follower.follower_id and block.blocked_id = auth.uid())
          )
      )
      else 0::bigint
    end,
    case when profile.id = auth.uid()
      or coalesce(listed_profile_privacy.following_visibility, 'private') = 'public'
      or (
        listed_profile_privacy.following_visibility = 'followers'
        and exists (
          select 1 from public.mtu_student_follows viewer_follow
          where viewer_follow.follower_id = auth.uid()
            and viewer_follow.followed_id = profile.id
        )
      )
      then (
        select count(*)::bigint
        from public.mtu_student_follows following
        where following.follower_id = profile.id
          and not exists (
            select 1 from public.student_blocks block
            where (block.blocker_id = auth.uid() and block.blocked_id = following.followed_id)
               or (block.blocker_id = following.followed_id and block.blocked_id = auth.uid())
          )
      )
      else 0::bigint
    end
  from public.profiles profile
  left join public.mtu_student_social_privacy listed_profile_privacy
    on listed_profile_privacy.user_id = profile.id
  where profile.id <> auth.uid()
    and (
      (p_direction = 'followers' and exists (
        select 1 from public.mtu_student_follows relationship
        where relationship.followed_id = p_profile_id
          and relationship.follower_id = profile.id
      ))
      or (p_direction = 'following' and exists (
        select 1 from public.mtu_student_follows relationship
        where relationship.follower_id = p_profile_id
          and relationship.followed_id = profile.id
      ))
    )
    and (
      coalesce((profile.profile_visibility ->> 'incognito')::boolean, false) = false
      or exists (
        select 1 from public.connection_requests accepted
        where accepted.status = 'accepted'
          and ((accepted.requester_id = auth.uid() and accepted.recipient_id = profile.id)
            or (accepted.requester_id = profile.id and accepted.recipient_id = auth.uid()))
      )
      or exists (
        select 1 from public.profile_approved_people approved
        where approved.profile_id = profile.id and approved.approved_user_id = auth.uid()
      )
    )
    and not exists (
      select 1 from public.student_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = profile.id)
         or (block.blocker_id = profile.id and block.blocked_id = auth.uid())
    )
  order by profile.display_name;
end;
$$;

create or replace function public.remove_mtu_student_follower(p_follower_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_mtu_account()
     or p_follower_id is null or p_follower_id = auth.uid() then
    raise exception 'Choose a valid follower to remove';
  end if;
  delete from public.mtu_student_follows
  where follower_id = p_follower_id and followed_id = auth.uid();
  return found;
end;
$$;

create or replace function public.set_mtu_student_content_restriction(
  p_student_id uuid,
  p_restricted boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_mtu_account()
     or p_student_id is null or p_student_id = auth.uid()
     or p_restricted is null
     or not exists (select 1 from public.profiles profile where profile.id = p_student_id) then
    raise exception 'Choose a valid Convo member';
  end if;
  if p_restricted then
    insert into public.mtu_student_content_restrictions (owner_id, restricted_user_id)
    values (auth.uid(), p_student_id)
    on conflict do nothing;
  else
    delete from public.mtu_student_content_restrictions
    where owner_id = auth.uid() and restricted_user_id = p_student_id;
  end if;
  return true;
end;
$$;

create or replace function public.list_mtu_student_content_restrictions()
returns table (user_id uuid, display_name text, avatar_url text, created_at timestamptz)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select profile.id, coalesce(nullif(trim(profile.display_name), ''), 'Convo member'),
    profile.avatar_url, restriction.created_at
  from public.mtu_student_content_restrictions restriction
  join public.profiles profile on profile.id = restriction.restricted_user_id
  where auth.uid() is not null
    and public.is_mtu_account()
    and restriction.owner_id = auth.uid()
  order by restriction.created_at desc;
$$;

create or replace function public.list_mtu_student_follow_state(p_student_ids uuid[])
returns table (student_id uuid, follower_count bigint, following_count bigint, followed_by_me boolean)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select profile.id,
    case when profile.id = auth.uid()
      or coalesce(follower_privacy.followers_visibility, 'private') = 'public'
      or (
        follower_privacy.followers_visibility = 'followers'
        and exists (
          select 1 from public.mtu_student_follows viewer_follow
          where viewer_follow.follower_id = auth.uid()
            and viewer_follow.followed_id = profile.id
        )
      )
      then (
        select count(*)::bigint
        from public.mtu_student_follows follow_row
        where follow_row.followed_id = profile.id
          and not exists (
            select 1 from public.student_blocks block
            where (block.blocker_id = auth.uid() and block.blocked_id = follow_row.follower_id)
               or (block.blocker_id = follow_row.follower_id and block.blocked_id = auth.uid())
          )
      )
      else 0::bigint
    end,
    case when profile.id = auth.uid()
      or coalesce(following_privacy.following_visibility, 'private') = 'public'
      or (
        following_privacy.following_visibility = 'followers'
        and exists (
          select 1 from public.mtu_student_follows viewer_follow
          where viewer_follow.follower_id = auth.uid()
            and viewer_follow.followed_id = profile.id
        )
      )
      then (
        select count(*)::bigint
        from public.mtu_student_follows follow_row
        where follow_row.follower_id = profile.id
          and not exists (
            select 1 from public.student_blocks block
            where (block.blocker_id = auth.uid() and block.blocked_id = follow_row.followed_id)
               or (block.blocker_id = follow_row.followed_id and block.blocked_id = auth.uid())
          )
      )
      else 0::bigint
    end,
    exists (
      select 1 from public.mtu_student_follows follow_row
      where follow_row.follower_id = auth.uid()
        and follow_row.followed_id = profile.id
    )
  from public.profiles profile
  left join public.mtu_student_social_privacy follower_privacy
    on follower_privacy.user_id = profile.id
  left join public.mtu_student_social_privacy following_privacy
    on following_privacy.user_id = profile.id
  where auth.uid() is not null
    and public.is_mtu_account()
    and profile.id = any(coalesce(p_student_ids, array[]::uuid[]))
    and (
      profile.id = auth.uid()
      or coalesce((profile.profile_visibility ->> 'incognito')::boolean, false) = false
      or exists (
        select 1 from public.connection_requests accepted
        where accepted.status = 'accepted'
          and ((accepted.requester_id = auth.uid() and accepted.recipient_id = profile.id)
            or (accepted.requester_id = profile.id and accepted.recipient_id = auth.uid()))
      )
      or exists (
        select 1 from public.profile_approved_people approved
        where approved.profile_id = profile.id and approved.approved_user_id = auth.uid()
      )
    )
    and not exists (
      select 1 from public.student_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = profile.id)
         or (block.blocker_id = profile.id and block.blocked_id = auth.uid())
    );
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
      join public.campus_posts post on post.id = media.post_id
      where media.media_path = p_media_path
        and public.mtu_campus_post_is_visible(media.post_id)
        and public.mtu_student_content_visible(post.author_id)
    );
$$;

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
    and public.mtu_student_content_visible(post.author_id)
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
revoke all on function public.can_read_mtu_campus_post_media(text) from public, anon;
grant execute on function public.can_read_mtu_campus_post_media(text) to authenticated;

drop policy if exists "MTU students can view active unblocked statuses" on public.status_posts;
create policy "MTU students can view active unblocked statuses"
  on public.status_posts for select to authenticated
  using (
    public.is_mtu_account()
    and expires_at > now()
    and (
      user_id = auth.uid()
      or (
        public.mtu_status_user_unblocked(user_id)
        and (audience <> 'public' or public.mtu_student_content_visible(user_id))
        and (
          audience = 'public'
          or (audience = 'connections' and public.mtu_status_pair_allowed(user_id))
        )
      )
    )
  );

drop policy if exists "Students record their own status views" on public.status_views;
create policy "Students record their own status views"
  on public.status_views for insert to authenticated
  with check (
    public.is_mtu_account()
    and viewer_id = auth.uid()
    and exists (
      select 1 from public.status_posts post
      where post.id = status_id
        and post.expires_at > now()
        and post.user_id <> auth.uid()
        and public.mtu_status_user_unblocked(post.user_id)
        and (post.audience <> 'public' or public.mtu_student_content_visible(post.user_id))
        and (
          post.audience = 'public'
          or (post.audience = 'connections' and public.mtu_status_pair_allowed(post.user_id))
        )
    )
  );

drop policy if exists "Students read status views they own or made" on public.status_views;
create policy "Students read status views they own or made"
  on public.status_views for select to authenticated
  using (
    public.is_mtu_account()
    and exists (
      select 1 from public.status_posts post
      where post.id = status_id
        and post.expires_at > now()
        and (
          (
            post.user_id = auth.uid()
            and not exists (
              select 1 from public.student_blocks block
              where (block.blocker_id = post.user_id and block.blocked_id = status_views.viewer_id)
                 or (block.blocker_id = status_views.viewer_id and block.blocked_id = post.user_id)
            )
            and (
              post.audience = 'public'
              or exists (
                select 1 from public.connection_requests accepted
                where accepted.status = 'accepted'
                  and ((accepted.requester_id = post.user_id and accepted.recipient_id = status_views.viewer_id)
                    or (accepted.requester_id = status_views.viewer_id and accepted.recipient_id = post.user_id))
              )
            )
          )
          or (
            viewer_id = auth.uid()
            and public.mtu_status_user_unblocked(post.user_id)
            and (post.audience <> 'public' or public.mtu_student_content_visible(post.user_id))
            and (
              post.audience = 'public'
              or (post.audience = 'connections' and public.mtu_status_pair_allowed(post.user_id))
            )
          )
        )
    )
  );

drop policy if exists "Students read active status media" on storage.objects;
create policy "Students read active status media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'status-media'
    and public.is_mtu_account()
    and exists (
      select 1 from public.status_posts post
      where post.media_path = storage.objects.name
        and post.expires_at > now()
        and (
          post.user_id = auth.uid()
          or (
            public.mtu_status_user_unblocked(post.user_id)
            and (post.audience <> 'public' or public.mtu_student_content_visible(post.user_id))
            and (
              post.audience = 'public'
              or (post.audience = 'connections' and public.mtu_status_pair_allowed(post.user_id))
            )
          )
        )
    )
  );

drop function if exists public.list_mtu_statuses_for(text);
create function public.list_mtu_statuses_for(p_audience text)
returns table (
  status_id uuid,
  user_id uuid,
  audience text,
  status_type text,
  text_content text,
  media_path text,
  metadata jsonb,
  created_at timestamptz,
  expires_at timestamptz,
  display_name text,
  avatar_url text,
  view_count bigint,
  viewed_by_me boolean,
  viewers jsonb
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to view Stories';
  end if;
  if p_audience not in ('public', 'connections') then
    raise exception 'Unsupported Story audience';
  end if;
  return query
  select post.id, post.user_id, post.audience, post.status_type, post.text_content,
    post.media_path, post.metadata, post.created_at, post.expires_at,
    coalesce(profile.display_name, 'Convo member'), profile.avatar_url,
    count(distinct view_row.viewer_id)::bigint,
    coalesce(bool_or(view_row.viewer_id = auth.uid()), false),
    case when post.user_id = auth.uid() then coalesce(
      jsonb_agg(jsonb_build_object(
        'user_id', viewer.id,
        'display_name', viewer.display_name,
        'avatar_url', viewer.avatar_url,
        'viewed_at', view_row.viewed_at
      ) order by view_row.viewed_at desc) filter (where view_row.viewer_id is not null),
      '[]'::jsonb
    ) else '[]'::jsonb end
  from public.status_posts post
  left join public.profiles profile on profile.id = post.user_id
  left join public.status_views view_row on view_row.status_id = post.id
    and (
      view_row.viewer_id is null
      or (
        exists (select 1 from public.profiles viewer_profile where viewer_profile.id = view_row.viewer_id)
        and not exists (
          select 1 from public.student_blocks block
          where (block.blocker_id = post.user_id and block.blocked_id = view_row.viewer_id)
             or (block.blocker_id = view_row.viewer_id and block.blocked_id = post.user_id)
        )
        and (
          post.audience = 'public'
          or exists (
            select 1 from public.connection_requests accepted
            where accepted.status = 'accepted'
              and ((accepted.requester_id = post.user_id and accepted.recipient_id = view_row.viewer_id)
                or (accepted.requester_id = view_row.viewer_id and accepted.recipient_id = post.user_id))
          )
        )
      )
    )
  left join public.profiles viewer on viewer.id = view_row.viewer_id
  where post.audience = p_audience
    and post.expires_at > now()
    and (
      post.user_id = auth.uid()
      or (
        public.mtu_status_user_unblocked(post.user_id)
        and (p_audience <> 'public' or public.mtu_student_content_visible(post.user_id))
        and (p_audience = 'public' or public.mtu_status_pair_allowed(post.user_id))
      )
    )
  group by post.id, profile.display_name, profile.avatar_url
  order by post.created_at asc;
end;
$$;

revoke all on function public.set_mtu_student_follow_list_visibility(text, text) from public, anon;
revoke all on function public.get_mtu_student_follow_list_visibility() from public, anon;
revoke all on function public.list_mtu_student_follows_for(uuid, text) from public, anon;
revoke all on function public.remove_mtu_student_follower(uuid) from public, anon;
revoke all on function public.set_mtu_student_content_restriction(uuid, boolean) from public, anon;
revoke all on function public.list_mtu_student_content_restrictions() from public, anon;
revoke all on function public.list_mtu_student_follow_state(uuid[]) from public, anon;
revoke all on function public.list_mtu_statuses_for(text) from public, anon;
grant execute on function public.set_mtu_student_follow_list_visibility(text, text) to authenticated;
grant execute on function public.get_mtu_student_follow_list_visibility() to authenticated;
grant execute on function public.list_mtu_student_follows_for(uuid, text) to authenticated;
grant execute on function public.remove_mtu_student_follower(uuid) to authenticated;
grant execute on function public.set_mtu_student_content_restriction(uuid, boolean) to authenticated;
grant execute on function public.list_mtu_student_content_restrictions() to authenticated;
grant execute on function public.list_mtu_student_follow_state(uuid[]) to authenticated;
grant execute on function public.list_mtu_statuses_for(text) to authenticated;

notify pgrst, 'reload schema';

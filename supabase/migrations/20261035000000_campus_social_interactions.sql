do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.connection_requests') is null
     or to_regclass('public.student_blocks') is null
     or to_regclass('public.profile_approved_people') is null
     or to_regclass('public.campus_posts') is null
     or to_regclass('public.mtu_notifications') is null
     or to_regprocedure('public.is_mtu_account()') is null
     or to_regprocedure('public.mtu_campus_post_is_visible(uuid)') is null then
    raise exception 'Apply the current profile, connection, block, and Campus Feed migrations before this migration';
  end if;
end
$$;

alter table public.mtu_notifications
  drop constraint if exists mtu_notifications_notification_type_check;
alter table public.mtu_notifications
  add constraint mtu_notifications_notification_type_check
  check (notification_type in ('message', 'connection', 'group', 'call', 'poll', 'task', 'event', 'announcement', 'follow'));

create table if not exists public.mtu_student_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
alter table public.mtu_student_follows
  add column if not exists notification_id uuid references public.mtu_notifications(id) on delete set null;
create index if not exists mtu_student_follows_followed_idx
  on public.mtu_student_follows (followed_id, created_at desc);
alter table public.mtu_student_follows enable row level security;
revoke all on public.mtu_student_follows from public, anon, authenticated;

create table if not exists public.campus_post_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.campus_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.campus_post_saves enable row level security;
revoke all on public.campus_post_saves from public, anon, authenticated;

create table if not exists public.campus_post_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.campus_posts(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'misinformation', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);
alter table public.campus_post_reports enable row level security;
revoke all on public.campus_post_reports from public, anon, authenticated;

create or replace function public.set_mtu_student_follow(p_student_id uuid, p_following boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to follow students';
  end if;
  if p_following is null then
    raise exception 'Choose whether to follow or unfollow this student';
  end if;
  if p_student_id is null or p_student_id = auth.uid() then
    raise exception 'You cannot follow yourself';
  end if;
  if p_following then
    if not exists (
      select 1
      from public.profiles profile
      where profile.id = p_student_id
        and (
          coalesce((profile.profile_visibility ->> 'incognito')::boolean, false) = false
          or exists (
            select 1 from public.connection_requests accepted
            where accepted.status = 'accepted'
              and ((accepted.requester_id = auth.uid() and accepted.recipient_id = p_student_id)
                or (accepted.requester_id = p_student_id and accepted.recipient_id = auth.uid()))
          )
          or exists (
            select 1 from public.profile_approved_people approved
            where approved.profile_id = p_student_id and approved.approved_user_id = auth.uid()
          )
        )
    ) then
      raise exception 'This student is not available to follow';
    end if;
    if exists (
      select 1 from public.student_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = p_student_id)
         or (block.blocker_id = p_student_id and block.blocked_id = auth.uid())
    ) then
      raise exception 'You cannot follow a blocked account';
    end if;
    insert into public.mtu_student_follows (follower_id, followed_id)
    values (auth.uid(), p_student_id)
    on conflict do nothing;
    if found then
      insert into public.mtu_notifications (
        recipient_id, actor_id, notification_type, title, body, entity_id, payload
      )
      select p_student_id, auth.uid(), 'follow',
        coalesce(nullif(trim(actor.display_name), ''), 'A Convo member') || ' followed you',
        'Followed you',
        auth.uid(),
        jsonb_build_object('follower_id', auth.uid())
      from public.profiles actor
      where actor.id = auth.uid()
      on conflict do nothing;

      update public.mtu_student_follows follow_row
      set notification_id = notification.id
      from public.mtu_notifications notification
      where follow_row.follower_id = auth.uid()
        and follow_row.followed_id = p_student_id
        and notification.recipient_id = p_student_id
        and notification.actor_id = auth.uid()
        and notification.notification_type = 'follow'
        and notification.entity_id = auth.uid();
    end if;
    return true;
  end if;

  update public.mtu_notifications notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = (
    select follow_row.notification_id
    from public.mtu_student_follows follow_row
    where follow_row.follower_id = auth.uid()
      and follow_row.followed_id = p_student_id
  )
    and notification.recipient_id = p_student_id
    and notification.notification_type = 'follow';
  delete from public.mtu_student_follows
  where follower_id = auth.uid() and followed_id = p_student_id;
  return true;
end;
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
    (
      select count(*)::bigint
      from public.mtu_student_follows follow_row
      where follow_row.followed_id = profile.id
        and not exists (
          select 1 from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = follow_row.follower_id)
             or (block.blocker_id = follow_row.follower_id and block.blocked_id = auth.uid())
        )
    ),
    (
      select count(*)::bigint
      from public.mtu_student_follows follow_row
      where follow_row.follower_id = profile.id
        and not exists (
          select 1 from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = follow_row.followed_id)
             or (block.blocker_id = follow_row.followed_id and block.blocked_id = auth.uid())
        )
    ),
    exists (
      select 1 from public.mtu_student_follows follow_row
      where follow_row.follower_id = auth.uid() and follow_row.followed_id = profile.id
    )
  from public.profiles profile
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

create or replace function public.list_mtu_student_follows(p_direction text default 'following')
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
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to view follows';
  end if;
  if p_direction is distinct from 'following' and p_direction is distinct from 'followers' then
    raise exception 'Choose following or followers';
  end if;

  return query
  select profile.id, profile.display_name,
    case when profile.id = auth.uid() or coalesce((profile.profile_visibility ->> 'allow_public_id_copy')::boolean, true)
      then profile.student_id else null end,
    profile.programme, profile.department, profile.level, profile.avatar_url, profile.bio, profile.status_text,
    (
      select count(*)::bigint
      from public.mtu_student_follows follow_row
      where follow_row.followed_id = profile.id
        and not exists (
          select 1 from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = follow_row.follower_id)
             or (block.blocker_id = follow_row.follower_id and block.blocked_id = auth.uid())
        )
    ),
    (
      select count(*)::bigint
      from public.mtu_student_follows follow_row
      where follow_row.follower_id = profile.id
        and not exists (
          select 1 from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = follow_row.followed_id)
             or (block.blocker_id = follow_row.followed_id and block.blocked_id = auth.uid())
        )
    )
  from public.profiles profile
  where profile.id <> auth.uid()
    and (
      (p_direction = 'following' and exists (
        select 1 from public.mtu_student_follows follow_row
        where follow_row.follower_id = auth.uid() and follow_row.followed_id = profile.id
      ))
      or (p_direction = 'followers' and exists (
        select 1 from public.mtu_student_follows follow_row
        where follow_row.followed_id = auth.uid() and follow_row.follower_id = profile.id
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

create or replace function public.list_mtu_follow_notifications(p_limit integer default 50)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  actor_avatar_url text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select notification.id,
    notification.actor_id,
    coalesce(nullif(trim(profile.display_name), ''), 'A Convo member'),
    profile.avatar_url,
    notification.created_at,
    notification.read_at
  from public.mtu_notifications notification
  left join public.profiles profile on profile.id = notification.actor_id
  where auth.uid() is not null
    and public.is_mtu_account()
    and notification.recipient_id = auth.uid()
    and notification.notification_type = 'follow'
    and notification.read_at is null
    and notification.actor_id is not null
    and not exists (
      select 1 from public.student_blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = notification.actor_id)
         or (block.blocker_id = notification.actor_id and block.blocked_id = auth.uid())
    )
    and exists (
      select 1 from public.mtu_student_follows follow_row
      where follow_row.follower_id = notification.actor_id
        and follow_row.followed_id = auth.uid()
    )
  order by notification.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.toggle_mtu_campus_post_save(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
begin
  if auth.uid() is null or not public.mtu_campus_post_is_visible(p_post_id) then
    raise exception 'This post is not available to save';
  end if;
  perform 1 from public.campus_posts where id = p_post_id for update;
  if exists (
    select 1 from public.campus_post_saves
    where user_id = auth.uid() and post_id = p_post_id
  ) then
    delete from public.campus_post_saves
    where user_id = auth.uid() and post_id = p_post_id;
    return false;
  end if;
  insert into public.campus_post_saves (user_id, post_id)
  values (auth.uid(), p_post_id);
  return true;
end;
$$;

create or replace function public.list_mtu_campus_post_saves(p_post_ids uuid[])
returns table (post_id uuid)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
set row_security = off
as $$
  select save.post_id
  from public.campus_post_saves save
  where auth.uid() is not null
    and public.is_mtu_account()
    and save.user_id = auth.uid()
    and save.post_id = any(coalesce(p_post_ids, array[]::uuid[]))
    and public.mtu_campus_post_is_visible(save.post_id);
$$;

create or replace function public.report_mtu_campus_post(p_post_id uuid, p_reason text, p_details text default '')
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
begin
  if auth.uid() is null or not public.mtu_campus_post_is_visible(p_post_id) then
    raise exception 'This post is not available to report';
  end if;
  if p_reason is null
     or p_reason not in ('spam', 'harassment', 'inappropriate', 'misinformation', 'other')
     or char_length(coalesce(p_details, '')) > 1000 then
    raise exception 'Choose a valid report reason and keep details under 1000 characters';
  end if;
  if exists (
    select 1 from public.campus_posts post
    where post.id = p_post_id and post.author_id = auth.uid()
  ) then
    raise exception 'You cannot report your own post';
  end if;
  insert into public.campus_post_reports (user_id, post_id, reason, details)
  values (auth.uid(), p_post_id, p_reason, coalesce(p_details, ''))
  on conflict (user_id, post_id) do nothing;
  return true;
end;
$$;

revoke all on function public.set_mtu_student_follow(uuid, boolean) from public, anon;
revoke all on function public.list_mtu_student_follow_state(uuid[]) from public, anon;
revoke all on function public.list_mtu_student_follows(text) from public, anon;
revoke all on function public.list_mtu_follow_notifications(integer) from public, anon;
revoke all on function public.toggle_mtu_campus_post_save(uuid) from public, anon;
revoke all on function public.list_mtu_campus_post_saves(uuid[]) from public, anon;
revoke all on function public.report_mtu_campus_post(uuid, text, text) from public, anon;
grant execute on function public.set_mtu_student_follow(uuid, boolean) to authenticated;
grant execute on function public.list_mtu_student_follow_state(uuid[]) to authenticated;
grant execute on function public.list_mtu_student_follows(text) to authenticated;
grant execute on function public.list_mtu_follow_notifications(integer) to authenticated;
grant execute on function public.toggle_mtu_campus_post_save(uuid) to authenticated;
grant execute on function public.list_mtu_campus_post_saves(uuid[]) to authenticated;
grant execute on function public.report_mtu_campus_post(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

alter table public.status_posts
  add column if not exists audience text not null default 'connections';

update public.status_posts
set audience = 'connections'
where audience is null or audience not in ('public', 'connections');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.status_posts'::regclass
      and conname = 'status_posts_audience_check'
  ) then
    alter table public.status_posts
      add constraint status_posts_audience_check
      check (audience in ('public', 'connections'));
  end if;
end
$$;

create index if not exists status_posts_audience_active_idx
  on public.status_posts (audience, expires_at, created_at desc);

create or replace function public.mtu_status_user_unblocked(p_owner_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
    and p_owner_id is not null
    and public.is_mtu_account()
    and (
      p_owner_id = auth.uid()
      or not exists (
        select 1
        from public.student_blocks block
        where (block.blocker_id = auth.uid() and block.blocked_id = p_owner_id)
           or (block.blocker_id = p_owner_id and block.blocked_id = auth.uid())
      )
    );
$$;
revoke execute on function public.mtu_status_user_unblocked(uuid) from public, anon;
grant execute on function public.mtu_status_user_unblocked(uuid) to authenticated;

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
        and (
          audience = 'public'
          or (
            audience = 'connections'
            and public.mtu_status_pair_allowed(user_id)
          )
        )
      )
    )
  );

create or replace function public.list_mtu_statuses_for(p_audience text)
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
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to view Stories';
  end if;
  if p_audience not in ('public', 'connections') then
    raise exception 'Unsupported Story audience';
  end if;

  return query
  select
    post.id,
    post.user_id,
    post.audience,
    post.status_type,
    post.text_content,
    post.media_path,
    post.metadata,
    post.created_at,
    post.expires_at,
    coalesce(profile.display_name, 'Convo member'),
    profile.avatar_url,
    count(distinct view_row.viewer_id)::bigint,
    coalesce(bool_or(view_row.viewer_id = auth.uid()), false),
    case
      when post.user_id = auth.uid() then coalesce(
        jsonb_agg(
          jsonb_build_object(
            'user_id', viewer.id,
            'display_name', viewer.display_name,
            'avatar_url', viewer.avatar_url,
            'viewed_at', view_row.viewed_at
          ) order by view_row.viewed_at desc
        ) filter (where view_row.viewer_id is not null),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end
  from public.status_posts post
  left join public.profiles profile on profile.id = post.user_id
  left join public.status_views view_row on view_row.status_id = post.id
  left join public.profiles viewer on viewer.id = view_row.viewer_id
  where post.audience = p_audience
    and post.expires_at > now()
    and (
      post.user_id = auth.uid()
      or (
        public.mtu_status_user_unblocked(post.user_id)
        and (
          p_audience = 'public'
          or public.mtu_status_pair_allowed(post.user_id)
        )
      )
    )
  group by post.id, profile.display_name, profile.avatar_url
  order by post.created_at asc;
end;
$$;

revoke execute on function public.list_mtu_statuses_for(text) from public, anon;
grant execute on function public.list_mtu_statuses_for(text) to authenticated;

drop policy if exists "Students read active status media" on storage.objects;
create policy "Students read active status media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'status-media'
    and public.is_mtu_account()
    and exists (
      select 1
      from public.status_posts post
      where post.media_path = storage.objects.name
        and post.expires_at > now()
        and (
          post.user_id = auth.uid()
          or (
            public.mtu_status_user_unblocked(post.user_id)
            and (
              post.audience = 'public'
              or (
                post.audience = 'connections'
                and public.mtu_status_pair_allowed(post.user_id)
              )
            )
          )
        )
    )
  );

notify pgrst, 'reload schema';

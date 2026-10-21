update public.status_posts
set audience = 'connections'
where audience is distinct from 'connections';

alter table public.status_posts
  alter column audience set default 'connections';

alter table public.status_posts
  drop constraint if exists status_posts_audience_check;

alter table public.status_posts
  add constraint status_posts_audience_check
  check (audience = 'connections');

drop policy if exists "Students create their own statuses" on public.status_posts;
create policy "Students create their own statuses"
  on public.status_posts for insert to authenticated
  with check (
    public.is_mtu_account()
    and user_id = auth.uid()
    and audience = 'connections'
    and expires_at > now()
    and expires_at <= now() + interval '24 hours 1 minute'
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );

drop policy if exists "MTU students can view active unblocked statuses" on public.status_posts;
create policy "MTU students can view active unblocked statuses"
  on public.status_posts for select to authenticated
  using (
    public.is_mtu_account()
    and expires_at > now()
    and audience = 'connections'
    and public.mtu_status_user_unblocked(user_id)
    and public.mtu_status_pair_allowed(user_id)
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
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to view Stories';
  end if;
  if p_audience is distinct from 'connections' then
    raise exception 'Stories are visible only to accepted connections';
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
  where post.audience = 'connections'
    and post.expires_at > now()
    and (
      post.user_id = auth.uid()
      or (
        public.mtu_status_user_unblocked(post.user_id)
        and public.mtu_status_pair_allowed(post.user_id)
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
        and post.audience = 'connections'
        and post.expires_at > now()
        and public.mtu_status_user_unblocked(post.user_id)
        and public.mtu_status_pair_allowed(post.user_id)
    )
  );

notify pgrst, 'reload schema';

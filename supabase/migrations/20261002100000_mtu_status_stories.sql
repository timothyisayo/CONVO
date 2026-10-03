create table if not exists public.status_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status_type text not null check (status_type in ('text', 'image', 'video')),
  text_content text not null default '',
  media_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint status_media_matches_type check (
    (status_type = 'text' and media_path is null)
    or (status_type in ('image', 'video') and media_path is not null)
  ),
  constraint status_content_required check (
    char_length(text_content) <= 700
    and (status_type <> 'text' or char_length(trim(text_content)) between 1 and 700)
  )
);

create index if not exists status_posts_active_created_idx
  on public.status_posts (expires_at, created_at desc);pn
create index if not exists status_posts_owner_active_idx
  on public.status_posts (user_id, expires_at, created_at desc);

create table if not exists public.status_views (
  status_id uuid not null references public.status_posts(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (status_id, viewer_id)
);
create index if not exists status_views_viewer_idx on public.status_views (viewer_id, viewed_at desc);

create or replace function public.mtu_status_pair_allowed(p_owner_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and (
      p_owner_id = auth.uid()
      or not exists (
        select 1 from public.student_blocks block
        where (block.blocker_id = auth.uid() and block.blocked_id = p_owner_id)
           or (block.blocker_id = p_owner_id and block.blocked_id = auth.uid())
      )
    );
$$;
revoke execute on function public.mtu_status_pair_allowed(uuid) from public, anon;
grant execute on function public.mtu_status_pair_allowed(uuid) to authenticated;

alter table public.status_posts enable row level security;
alter table public.status_views enable row level security;

drop policy if exists "MTU students can view active unblocked statuses" on public.status_posts;
create policy "MTU students can view active unblocked statuses"
  on public.status_posts for select to authenticated
  using (
    public.mtu_status_pair_allowed(user_id)
    and expires_at > now()
  );

drop policy if exists "Students create their own statuses" on public.status_posts;
create policy "Students create their own statuses"
  on public.status_posts for insert to authenticated
  with check (
    public.is_mtu_account()
    and user_id = auth.uid()
    and expires_at > now()
    and expires_at <= now() + interval '24 hours 1 minute'
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );

drop policy if exists "Students delete their own statuses" on public.status_posts;
create policy "Students delete their own statuses"
  on public.status_posts for delete to authenticated
  using (public.is_mtu_account() and user_id = auth.uid());

drop policy if exists "Students read status views they own or made" on public.status_views;
create policy "Students read status views they own or made"
  on public.status_views for select to authenticated
  using (
    public.is_mtu_account()
    and (
      viewer_id = auth.uid()
      or exists (select 1 from public.status_posts post where post.id = status_id and post.user_id = auth.uid())
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
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('status-media', 'status-media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Students upload their own status media" on storage.objects;
create policy "Students upload their own status media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'status-media'
    and public.is_mtu_account()
    and (storage.foldername(name))[1] = auth.uid()::text
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
    )
  );

drop policy if exists "Students delete their own status media" on storage.objects;
create policy "Students delete their own status media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'status-media'
    and public.is_mtu_account()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.list_mtu_statuses()
returns table (
  status_id uuid,
  user_id uuid,
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
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select
    post.id,
    post.user_id,
    post.status_type,
    post.text_content,
    post.media_path,
    post.metadata,
    post.created_at,
    post.expires_at,
    coalesce(profile.display_name, 'MTU student'),
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
  where public.is_mtu_account()
    and post.expires_at > now()
    and public.mtu_status_pair_allowed(post.user_id)
  group by post.id, profile.display_name, profile.avatar_url
  order by post.created_at asc;
$$;

revoke execute on function public.list_mtu_statuses() from public, anon;
grant execute on function public.list_mtu_statuses() to authenticated;
grant select, insert, delete on public.status_posts to authenticated;
grant select, insert on public.status_views to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'status_posts'
    )
  then alter publication supabase_realtime add table public.status_posts; end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'status_views'
    )
  then alter publication supabase_realtime add table public.status_views; end if;
end
$$;

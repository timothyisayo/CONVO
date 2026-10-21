create or replace function public.mtu_status_pair_allowed(p_owner_id uuid)
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
      or (
        exists (
          select 1
          from public.connection_requests accepted
          where accepted.status = 'accepted'
            and (
              (accepted.requester_id = auth.uid() and accepted.recipient_id = p_owner_id)
              or (accepted.requester_id = p_owner_id and accepted.recipient_id = auth.uid())
            )
        )
        and not exists (
          select 1
          from public.student_blocks block
          where (block.blocker_id = auth.uid() and block.blocked_id = p_owner_id)
             or (block.blocker_id = p_owner_id and block.blocked_id = auth.uid())
        )
      )
    );
$$;
revoke execute on function public.mtu_status_pair_allowed(uuid) from public, anon;
grant execute on function public.mtu_status_pair_allowed(uuid) to authenticated;

drop policy if exists "MTU students can view active unblocked statuses" on public.status_posts;
create policy "MTU students can view active unblocked statuses"
  on public.status_posts for select to authenticated
  using (public.mtu_status_pair_allowed(user_id) and expires_at > now());

drop policy if exists "Students read status views they own or made" on public.status_views;
create policy "Students read status views they own or made"
  on public.status_views for select to authenticated
  using (
    public.is_mtu_account()
    and (
      viewer_id = auth.uid()
      or exists (
        select 1 from public.status_posts post
        where post.id = status_id and post.user_id = auth.uid()
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
        and public.mtu_status_pair_allowed(post.user_id)
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
        and public.mtu_status_pair_allowed(post.user_id)
    )
  );

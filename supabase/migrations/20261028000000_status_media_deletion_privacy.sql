create or replace function public.can_delete_unclaimed_status_media(p_media_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select auth.uid() is not null
    and public.is_mtu_account()
    and p_media_path like auth.uid()::text || '/%'
    and not exists (
      select 1
      from public.status_posts post
      where post.media_path = p_media_path
    );
$$;
revoke all on function public.can_delete_unclaimed_status_media(text) from public, anon;
grant execute on function public.can_delete_unclaimed_status_media(text) to authenticated;

drop policy if exists "Students delete their own status media" on storage.objects;
drop policy if exists "Students delete their own unclaimed status media" on storage.objects;
create policy "Students delete their own unclaimed status media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'status-media'
    and public.can_delete_unclaimed_status_media(name)
  );

notify pgrst, 'reload schema';

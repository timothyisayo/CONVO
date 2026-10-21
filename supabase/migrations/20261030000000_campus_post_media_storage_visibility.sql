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
      where media.media_path = p_media_path
        and public.mtu_campus_post_is_visible(media.post_id)
    );
$$;

revoke all on function public.can_read_mtu_campus_post_media(text) from public, anon;
grant execute on function public.can_read_mtu_campus_post_media(text) to authenticated;

drop policy if exists "Eligible members read visible campus post media" on storage.objects;
create policy "Eligible members read visible campus post media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campus-post-media'
    and public.can_read_mtu_campus_post_media(name)
  );

notify pgrst, 'reload schema';

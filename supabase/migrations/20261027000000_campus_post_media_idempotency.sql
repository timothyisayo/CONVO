create table if not exists public.campus_post_media_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  body text not null,
  media_manifest jsonb not null,
  post_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.campus_post_media_requests enable row level security;
revoke all on public.campus_post_media_requests from public, anon, authenticated;
drop policy if exists "No direct campus post media request access" on public.campus_post_media_requests;
create policy "No direct campus post media request access"
  on public.campus_post_media_requests for all to authenticated
  using (false) with check (false);

create or replace function public.can_delete_unclaimed_campus_post_media(p_media_path text)
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
      from public.campus_post_media media
      where media.media_path = p_media_path
    );
$$;
revoke all on function public.can_delete_unclaimed_campus_post_media(text) from public, anon;
grant execute on function public.can_delete_unclaimed_campus_post_media(text) to authenticated;

drop policy if exists "Members delete their own unclaimed campus post media" on storage.objects;
create policy "Members delete their own unclaimed campus post media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'campus-post-media'
    and public.can_delete_unclaimed_campus_post_media(name)
  );

create or replace function public.create_mtu_campus_post_with_media_once(
  p_body text,
  p_media jsonb,
  p_request_id uuid
)
returns table(post_id uuid, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  request_row public.campus_post_media_requests%rowtype;
  normalized_body text := trim(coalesce(p_body, ''));
  normalized_media jsonb := coalesce(p_media, '[]'::jsonb);
  normalized_manifest jsonb;
  result_post_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to post';
  end if;
  if p_request_id is null then
    raise exception 'A post request id is required';
  end if;
  if jsonb_typeof(normalized_media) <> 'array' then
    raise exception 'Post media must be a list of uploaded files';
  end if;
  if char_length(normalized_body) > 2000
     or (char_length(normalized_body) = 0 and jsonb_array_length(normalized_media) = 0) then
    raise exception 'Add text or media to your post; captions must be 2000 characters or fewer';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(normalized_media) as media_item(value)
    where coalesce(media_item.value ->> 'media_path', '') = ''
       or coalesce(media_item.value ->> 'content_hash', '') !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Every uploaded media item must include its path and content fingerprint';
  end if;

  select coalesce(
    jsonb_agg(
      (media_item.value - 'media_path')
        || jsonb_build_object('position', media_item.ordinality - 1)
      order by media_item.ordinality
    ),
    '[]'::jsonb
  )
  into normalized_manifest
  from jsonb_array_elements(normalized_media) with ordinality as media_item(value, ordinality);

  insert into public.campus_post_media_requests(user_id, request_id, body, media_manifest)
  values (auth.uid(), p_request_id, normalized_body, normalized_manifest)
  on conflict (user_id, request_id) do nothing;

  select *
  into request_row
  from public.campus_post_media_requests request
  where request.user_id = auth.uid()
    and request.request_id = p_request_id
  for update;

  if request_row.body is distinct from normalized_body
     or request_row.media_manifest is distinct from normalized_manifest then
    raise exception 'This post request id was already used with different content';
  end if;

  if request_row.post_id is not null then
    return query select request_row.post_id, false;
    return;
  end if;

  result_post_id := public.create_mtu_campus_post_with_media(normalized_body, normalized_media);
  update public.campus_post_media_requests request
  set post_id = result_post_id
  where request.user_id = auth.uid()
    and request.request_id = p_request_id;

  return query select result_post_id, true;
end;
$$;

revoke all on function public.create_mtu_campus_post_with_media_once(text, jsonb, uuid) from public, anon;
grant execute on function public.create_mtu_campus_post_with_media_once(text, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';

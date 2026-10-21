create or replace function public.create_mtu_campus_post_once(
  p_body text,
  p_request_id uuid
)
returns table(post_id uuid, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
set row_security = off
as $$
declare
  normalized_body text := trim(coalesce(p_body, ''));
  request_row public.campus_post_media_requests%rowtype;
  result_post_id uuid;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in with an eligible Convo account to post';
  end if;
  if p_request_id is null then
    raise exception 'A post request id is required';
  end if;
  if char_length(normalized_body) not between 1 and 2000 then
    raise exception 'Posts must contain 1 to 2000 characters';
  end if;

  insert into public.campus_post_media_requests(user_id, request_id, body, media_manifest)
  values (auth.uid(), p_request_id, normalized_body, '[]'::jsonb)
  on conflict (user_id, request_id) do nothing;

  select *
  into request_row
  from public.campus_post_media_requests request
  where request.user_id = auth.uid()
    and request.request_id = p_request_id
  for update;

  if request_row.body is distinct from normalized_body
     or request_row.media_manifest is distinct from '[]'::jsonb then
    raise exception 'This post request id was already used with different content';
  end if;

  if request_row.post_id is not null then
    return query select request_row.post_id, false;
    return;
  end if;

  result_post_id := public.create_mtu_campus_post(normalized_body, 'rose');
  update public.campus_post_media_requests request
  set post_id = result_post_id
  where request.user_id = auth.uid()
    and request.request_id = p_request_id;

  return query select result_post_id, true;
end;
$$;

revoke all on function public.create_mtu_campus_post_once(text, uuid) from public, anon;
grant execute on function public.create_mtu_campus_post_once(text, uuid) to authenticated;

notify pgrst, 'reload schema';

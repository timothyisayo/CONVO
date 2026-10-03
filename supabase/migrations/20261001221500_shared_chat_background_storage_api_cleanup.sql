create or replace function public.set_mtu_conversation_appearance(
  p_conversation_id uuid,
  p_background_image_path text
)
returns table (background_image_path text)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage
as $$
begin
  if auth.uid() is null
    or not public.is_mtu_account()
    or not exists (
      select 1 from public.conversation_members member
      where member.conversation_id = p_conversation_id
        and member.user_id = auth.uid()
    )
  then
    raise exception 'You cannot change this conversation background';
  end if;

  perform 1 from public.conversations conversation
  where conversation.id = p_conversation_id
  for update;

  if p_background_image_path is not null then
    if p_background_image_path not like p_conversation_id::text || '/' || auth.uid()::text || '/%'
      or not exists (
        select 1 from storage.objects object
        where object.bucket_id = 'conversation-backgrounds'
          and object.name = p_background_image_path
      )
    then
      raise exception 'Invalid conversation background image';
    end if;
  end if;

  insert into public.conversation_appearance_settings (
    conversation_id, background_image_path, updated_by, updated_at
  )
  values (p_conversation_id, p_background_image_path, auth.uid(), now())
  on conflict (conversation_id) do update
    set background_image_path = excluded.background_image_path,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return query select p_background_image_path;
end;
$$;

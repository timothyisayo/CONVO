create or replace function public.end_mtu_group(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage
as $$
declare
  group_image_path_value text;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in to delete this group';
  end if;

  if not exists (
    select 1
    from public.conversation_members member
    join public.conversations conversation
      on conversation.id = member.conversation_id
     and conversation.kind = 'group'
    where member.conversation_id = p_conversation_id
      and member.user_id = auth.uid()
      and member.group_role = 'owner'
  ) then
    raise exception 'Only the group owner can delete this group';
  end if;

  select conversation.group_image_path
    into group_image_path_value
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.kind = 'group';

  if not found then
    return false;
  end if;

  if group_image_path_value is not null then
    delete from storage.objects
    where bucket_id = 'group-images'
      and name = group_image_path_value;
  end if;

  delete from public.conversations
  where id = p_conversation_id
    and kind = 'group';

  return found;
end;
$$;

revoke execute on function public.end_mtu_group(uuid) from public, anon;
grant execute on function public.end_mtu_group(uuid) to authenticated;

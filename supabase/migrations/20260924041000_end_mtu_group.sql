alter table public.conversations add column if not exists ended_at timestamptz;

create or replace function public.end_mtu_group(p_conversation_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Sign in to end this group';
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
    raise exception 'Only the group owner can end this group';
  end if;

  update public.conversations
  set ended_at = coalesce(ended_at, now()), updated_at = now()
  where id = p_conversation_id and kind = 'group';

  return found;
end;
$$;

revoke execute on function public.end_mtu_group(uuid) from public, anon;
grant execute on function public.end_mtu_group(uuid) to authenticated;

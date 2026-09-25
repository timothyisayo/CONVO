drop function if exists public.list_mtu_group_members(uuid);

create function public.list_mtu_group_members(p_conversation_id uuid)
returns table (user_id uuid, display_name text, student_id text, avatar_url text, group_role text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select cm.user_id, p.display_name, p.student_id, p.avatar_url, cm.group_role
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id and c.kind = 'group'
  join public.profiles p on p.id = cm.user_id
  where cm.conversation_id = p_conversation_id
    and public.is_mtu_account()
    and exists (
      select 1
      from public.conversation_members me
      where me.conversation_id = p_conversation_id
        and me.user_id = auth.uid()
    )
  order by case cm.group_role when 'owner' then 0 when 'admin' then 1 else 2 end, p.display_name;
$$;

revoke execute on function public.list_mtu_group_members(uuid) from public, anon;
grant execute on function public.list_mtu_group_members(uuid) to authenticated;

-- Allow group owners to hide groups from Communities while preserving member access.
alter table public.conversations add column if not exists is_private boolean not null default false;

create or replace function public.set_mtu_group_privacy(p_conversation_id uuid, p_is_private boolean)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, auth
as $$
begin
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id and user_id = auth.uid() and group_role = 'owner'
  ) then
    raise exception 'Only the group owner can change group privacy';
  end if;
  update public.conversations
    set is_private = coalesce(p_is_private, false), updated_at = now()
  where id = p_conversation_id and kind = 'group';
  return found;
end;
$$;

create or replace function public.search_mtu_groups(p_query text default '', p_category text default 'all')
returns table (conversation_id uuid, title text, category text, group_image_url text, member_count bigint, is_member boolean, my_request_status text)
language sql security definer stable set search_path = pg_catalog, public, auth
as $$
  select c.id, c.title, c.group_category, c.group_image_url,
    (select count(*) from public.conversation_members m where m.conversation_id = c.id),
    exists (select 1 from public.conversation_members mine where mine.conversation_id = c.id and mine.user_id = auth.uid()),
    (select r.status from public.group_join_requests r where r.conversation_id = c.id and r.user_id = auth.uid())
  from public.conversations c
  where public.is_mtu_account() and c.kind = 'group' and c.ended_at is null
    and not coalesce(c.is_private, false)
    and (nullif(trim(coalesce(p_query, '')), '') is null or c.title ilike '%' || trim(p_query) || '%')
    and (coalesce(p_category, 'all') = 'all' or c.group_category = p_category)
  order by c.updated_at desc, c.title asc limit 100;
$$;

revoke all on function public.set_mtu_group_privacy(uuid, boolean) from public, anon;
grant execute on function public.set_mtu_group_privacy(uuid, boolean) to authenticated;

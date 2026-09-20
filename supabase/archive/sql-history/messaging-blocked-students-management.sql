-- Run in Supabase Dashboard → SQL Editor after messaging-safety-and-identity.sql.
-- This exposes only the current student's own block list and permits only that student to remove their own block.

create or replace function public.list_mtu_blocked_students()
returns table(
  blocked_id uuid,
  display_name text,
  nickname text,
  student_id text,
  avatar_url text,
  blocked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU students can view blocked students';
  end if;

  return query
  select
    block.blocked_id,
    profile.display_name,
    profile.nickname,
    profile.student_id,
    profile.avatar_url,
    block.created_at
  from public.student_blocks block
  join public.profiles profile on profile.id = block.blocked_id
  where block.blocker_id = auth.uid()
  order by block.created_at desc;
end;
$$;

create or replace function public.unblock_mtu_student(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null or not public.is_mtu_account() or auth.uid() = p_student_id then
    raise exception 'Only verified MTU students can unblock a student';
  end if;

  delete from public.student_blocks
  where blocker_id = auth.uid()
    and blocked_id = p_student_id;

  -- Clear the prior local block status; neither student becomes connected automatically.
  update public.connection_requests
  set status = 'declined', updated_at = now()
  where status = 'blocked'
    and ((requester_id = auth.uid() and recipient_id = p_student_id)
      or (requester_id = p_student_id and recipient_id = auth.uid()));

  return true;
end;
$$;

revoke execute on function public.list_mtu_blocked_students(), public.unblock_mtu_student(uuid) from public, anon;
grant execute on function public.list_mtu_blocked_students(), public.unblock_mtu_student(uuid) to authenticated;

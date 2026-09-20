-- CONVO connection-request identity refinement
-- Run in Supabase Dashboard → SQL Editor after the directory/profile setup.
-- Returns only public nickname and public student ID; emails remain private.

drop function if exists public.list_mtu_connection_requests();

create function public.list_mtu_connection_requests()
returns table (
  id uuid,
  requester_id uuid,
  recipient_id uuid,
  status text,
  direction text,
  updated_at timestamptz,
  requester_display_name text,
  requester_student_id text
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select
    request.id,
    request.requester_id,
    request.recipient_id,
    request.status,
    case
      when request.requester_id = auth.uid() then 'sent'
      else 'received'
    end as direction,
    request.updated_at,
    requester.display_name as requester_display_name,
    requester.student_id as requester_student_id
  from public.connection_requests request
  left join public.profiles requester on requester.id = request.requester_id
  where request.requester_id = auth.uid()
     or request.recipient_id = auth.uid()
  order by request.updated_at desc;
$$;

revoke execute on function public.list_mtu_connection_requests() from public, anon;
grant execute on function public.list_mtu_connection_requests() to authenticated;

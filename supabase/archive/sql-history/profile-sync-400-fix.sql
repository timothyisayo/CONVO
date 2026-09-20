-- CONVO focused repair for: sync_my_mtu_profile() 400 / P0001
-- Run this entire file in Supabase Dashboard → SQL Editor.
-- The earlier regular-expression eligibility check can reject a valid MTU JWT.

create or replace function public.is_mtu_account()
returns boolean
language sql
stable
set search_path = pg_catalog, public, auth
as $$
  select
    right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@mtu.edu.ng'
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'ajewoletimothymtu@gmail.com';
$$;

revoke execute on function public.is_mtu_account() from public, anon;
grant execute on function public.is_mtu_account() to authenticated;

-- This must return true from the signed-in Convo app after the helper is fixed.
-- Do not call sync_my_mtu_profile() in SQL Editor because SQL Editor has no auth.uid().

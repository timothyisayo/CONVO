-- Include the public bio when an eligible connected student is found.
create or replace function public.search_mtu_students(p_query text default '')
returns table (
  id uuid,
  display_name text,
  student_id text,
  is_self boolean,
  level text,
  department text,
  programme text,
  avatar_url text,
  bio text,
  status_text text
)
language sql
security definer
stable
set search_path = pg_catalog, public, auth
as $$
  select
    p.id,
    p.display_name,
    p.student_id,
    p.id = auth.uid() as is_self,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'level')::boolean, true) then p.level else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'college')::boolean, true) then p.department else null end,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'programme')::boolean, true) then p.programme else null end,
    p.avatar_url,
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'bio')::boolean, true) then p.bio else null end,
    p.status_text
  from public.profiles p
  where public.is_mtu_account()
    and (
      p.id = auth.uid()
      or coalesce((p.profile_visibility ->> 'incognito')::boolean, false) = false
      or exists (
        select 1
        from public.connection_requests accepted
        where accepted.status = 'accepted'
          and ((accepted.requester_id = auth.uid() and accepted.recipient_id = p.id)
            or (accepted.requester_id = p.id and accepted.recipient_id = auth.uid()))
      )
      or exists (
        select 1
        from public.profile_approved_people approved
        where approved.profile_id = p.id
          and approved.approved_user_id = auth.uid()
      )
      or (
        coalesce((p.profile_visibility ->> 'incognito')::boolean, false)
        and coalesce((p.profile_visibility ->> 'allow_exact_id_lookup')::boolean, false)
        and lower(coalesce(p.student_id, '')) = lower(trim(p_query))
      )
    )
    and (
      nullif(trim(p_query), '') is null
      or p.display_name ilike '%' || trim(p_query) || '%'
      or lower(coalesce(p.student_id, '')) = lower(trim(p_query))
      or coalesce(p.level, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.department, '') ilike '%' || trim(p_query) || '%'
      or coalesce(p.programme, '') ilike '%' || trim(p_query) || '%'
    )
  order by (p.id = auth.uid()) desc, p.display_name asc
  limit 24;
$$;

revoke execute on function public.search_mtu_students(text) from public, anon;
grant execute on function public.search_mtu_students(text) to authenticated;

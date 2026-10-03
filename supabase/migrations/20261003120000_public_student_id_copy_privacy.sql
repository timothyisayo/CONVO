alter table public.profiles alter column profile_visibility set default
  '{"programme": true, "college": true, "level": true, "bio": true, "incognito": false, "allow_exact_id_lookup": false, "allow_public_id_copy": true}'::jsonb;

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
    case when p.id = auth.uid() or coalesce((p.profile_visibility ->> 'allow_public_id_copy')::boolean, true) then p.student_id else null end,
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
        select 1 from public.connection_requests accepted
        where accepted.status = 'accepted'
          and ((accepted.requester_id = auth.uid() and accepted.recipient_id = p.id)
            or (accepted.requester_id = p.id and accepted.recipient_id = auth.uid()))
      )
      or exists (
        select 1 from public.profile_approved_people approved
        where approved.profile_id = p.id and approved.approved_user_id = auth.uid()
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

create or replace function public.sync_my_mtu_profile()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  metadata jsonb;
  public_name text;
  visibility jsonb;
begin
  if auth.uid() is null or not public.is_mtu_account() then
    raise exception 'Only verified MTU users can synchronize a public profile';
  end if;
  select coalesce(u.raw_user_meta_data, '{}'::jsonb) into metadata
  from auth.users u where u.id = auth.uid();
  public_name := nullif(trim(coalesce(metadata ->> 'nickname', metadata ->> 'display_name', '')), '');
  if public_name is null then return false; end if;
  visibility := jsonb_build_object(
    'programme', coalesce((metadata -> 'profile_visibility' ->> 'programme')::boolean, true),
    'college', coalesce((metadata -> 'profile_visibility' ->> 'college')::boolean, true),
    'level', coalesce((metadata -> 'profile_visibility' ->> 'level')::boolean, true),
    'bio', coalesce((metadata -> 'profile_visibility' ->> 'bio')::boolean, true),
    'incognito', coalesce((metadata -> 'profile_visibility' ->> 'incognito')::boolean, false),
    'allow_exact_id_lookup', coalesce((metadata -> 'profile_visibility' ->> 'allow_exact_id_lookup')::boolean, false),
    'allow_public_id_copy', coalesce((metadata -> 'profile_visibility' ->> 'allow_public_id_copy')::boolean, true)
  );
  insert into public.profiles (id, display_name, student_id, level, department, programme, avatar_url, bio, profile_visibility)
  values (
    auth.uid(), public_name,
    coalesce(nullif(metadata ->> 'student_id', ''), 'MTU-' || upper(substr(replace(auth.uid()::text, '-', ''), 1, 8))),
    nullif(metadata ->> 'level', ''),
    nullif(coalesce(metadata ->> 'college', metadata ->> 'department'), ''),
    nullif(coalesce(metadata ->> 'programme', metadata ->> 'major'), ''),
    nullif(metadata ->> 'avatar_url', ''), nullif(metadata ->> 'bio', ''), visibility
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    student_id = coalesce(excluded.student_id, public.profiles.student_id),
    level = coalesce(excluded.level, public.profiles.level),
    department = coalesce(excluded.department, public.profiles.department),
    programme = coalesce(excluded.programme, public.profiles.programme),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    bio = coalesce(excluded.bio, public.profiles.bio),
    profile_visibility = excluded.profile_visibility;
  return true;
end;
$$;

revoke execute on function public.search_mtu_students(text) from public, anon;
grant execute on function public.search_mtu_students(text) to authenticated;
